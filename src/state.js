import { EventEmitter } from 'node:events';
import { cfg } from './config/cfg.js';
import { log } from './logger/index.js';
import { waitForLoginCode, waitFor2faPassword } from './tg/auth.js';
import { TgClient } from './tg/client.js';
import { TgSession } from './session.js';
import { startHttp } from './httpsrv/server.js';
import { resolveChannel } from './tg/channel.js';
import { dispatchMessage } from './tg/handler.js';

// Shared state between HTTP server and TG listener.
class AppState extends EventEmitter {
  constructor() {
    super();
    this.status = 'init';
    // init | need-login | connecting | awaiting-code | awaiting-2fa
    //       | authorized | listening | error
    this.pwdHint = null;       // 2FA hint text from TG
    this.me = null;            // current user
    this.session = null;       // TgSession after auth
    this.tg = null;            // TgClient
    this.loginInFlight = null; // Promise
  }

  async kickLogin() {
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      try {
        this.status = 'connecting';
        const tg = new TgClient(cfg);
        this.tg = tg;
        await tg.connect();

        let me = await tg.getMe();
        if (!me) {
          log.warn('[FIX-2026-07-21-A] session loaded but getMe returned null — invalidating and re-connecting');
          tg.invalidateSession();
          await tg.connect();
          me = await tg.getMe();
          log.info(`[FIX-2026-07-21-A] second getMe: ${me ? 'OK user=' + me.id : 'still null'}`);
        }
        if (me) {
          this.me = me;
          this.status = 'authorized';
          tg.saveSession();
          await this.#startSession(tg);
          tg.saveSession();
          return;
        }

        this.status = 'awaiting-code';
        await tg.client.start({
          phoneNumber: () => cfg.phone,
          password: async (hint) => {
            this.status = 'awaiting-2fa';
            this.pwdHint = hint ?? '';
            log.info('tg asks for 2fa password');
            return await waitFor2faPassword();
          },
          phoneCode: async () => await waitForLoginCode(),
          onError: (err) => log.error(err, 'login flow error'),
        });

        tg.saveSession();

        this.me = await tg.getMe();
        this.status = 'authorized';
        await this.#startSession(tg);
        tg.saveSession();
      } catch (e) {
        log.error(e, 'login flow failed');
        this.status = 'error';
      } finally {
        this.loginInFlight = null;
      }
    })();
    return this.loginInFlight;
  }

  async #startSession(tg) {
    const session = new TgSession(cfg);
    session.client = tg.client;
    session.tg = tg;
    session.resolved = [];
    session.setStatus('starting');
    await session.beginListener();
    this.session = session;
    this.status = 'listening';
    this.emit('authorized');
  }

  async restartListener() {
    if (!this.session) return { ok: false, msg: 'no active session' };
    try {
      await this.session.restartListener();
      return { ok: true, channels: this.session.resolved.map((c) => c.name) };
    } catch (e) {
      log.error(e, 'restart listener failed');
      return { ok: false, msg: e.message };
    }
  }

  // Send a message to a channel. `channel` may be:
  //  - a name in session.resolved (no extra round-trip)
  //  - a fresh "+invitehash" / "@public_name" (resolves via MTProto)
  // `replyTo` is an optional message ID to reply to.
  async sendMessage(channel, text, replyTo = null) {
    if (!this.session?.client) return { ok: false, msg: 'no active session' };
    if (!text || !String(text).trim()) return { ok: false, msg: 'text is empty' };

    try {
      let ch = this.session.resolved.find((c) =>
        c.name === channel || c.title === channel || String(c.id) === String(channel));

      if (!ch) {
        ch = await resolveChannel(this.session.client, channel);
        if (!ch) return { ok: false, msg: `channel "${channel}" not found / not joined` };
      }

      const opts = { message: String(text) };
      if (replyTo != null && Number.isFinite(Number(replyTo))) opts.replyTo = Number(replyTo);

      const sent = await this.session.client.sendMessage(ch.entity, opts);
      log.info('msg sent', { channel, id: sent?.id, replyTo: opts.replyTo ?? null, len: text.length });
      return { ok: true, id: sent?.id, date: sent?.date };
    } catch (e) {
      log.error(e, 'send message failed', { channel });
      return { ok: false, msg: e.message };
    }
  }

  // Pull recent history of a channel and dispatch each message through the same
  // pipeline as live events. Used to backfill content that arrived while the
  // listener was offline, or after the user subscribed to a channel with
  // existing messages.
  async fetchHistory(channel, limit = 10) {
    if (!this.session?.client) return { ok: false, msg: 'no active session', fetched: 0, dispatched: 0, errors: [] };

    const max = Math.min(Math.max(Number(limit) || 10, 1), 50);
    let ch = this.session.resolved.find((c) =>
      c.name === channel || c.title === channel || String(c.id) === String(channel));

    if (!ch) {
      ch = await resolveChannel(this.session.client, channel);
      if (!ch) return { ok: false, msg: `channel "${channel}" not found / not joined`, fetched: 0, dispatched: 0, errors: [] };
    }

    let messages;
    try {
      messages = await this.session.client.getMessages(ch.entity, { limit: max });
    } catch (e) {
      log.error(e, 'fetchHistory getMessages fail', { channel, limit: max });
      return { ok: false, msg: e.message, fetched: 0, dispatched: 0, errors: [] };
    }

    if (!Array.isArray(messages) || !messages.length) {
      log.info('fetchHistory empty', { channel, limit: max });
      return { ok: true, fetched: 0, dispatched: 0, errors: [] };
    }

    log.info('fetchHistory', { channel, count: messages.length });
    const errors = [];
    let dispatched = 0;
    for (const msg of messages) {
      if (!msg) continue;
      try {
        await dispatchMessage(this, ch, msg);
        dispatched++;
      } catch (e) {
        log.warn(e, 'fetchHistory dispatch fail', { id: msg.id });
        errors.push({ id: msg.id, msg: e.message });
      }
    }
    return { ok: true, fetched: messages.length, dispatched, errors };
  }
}

export const state = new AppState();
export { startHttp };