import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { log } from '../logger/index.js';
import fs from 'node:fs';
import path from 'node:path';

const APP_OPTS = {
  connectionRetries: 5,
  retryDelay: 1000,
  autoReconnect: true,
  floodSleepThreshold: 60,
  deviceModel: 'tgautodown-js',
  systemVersion: '1.0',
  appVersion: '1.0.0',
  langCode: 'en',
  systemLangCode: 'en',
};

export class TgClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = null;
    this.session = null;
    this.status = 'init';
    this.handlers = new Map();
    this.resolved = [];
  }

  async connect() {
    this.status = 'connecting';
    const saved = this.#readSession();
    this.session = new StringSession(saved);

    const opts = { ...APP_OPTS };
    if (this.cfg.socks5) opts.proxy = parseSocks(this.cfg.socks5);

    this.client = new TelegramClient(this.session, this.cfg.appid, this.cfg.apphash, opts);
    await this.client.connect();
    this.saveSession();
    this.status = 'connected';
    log.info('mtproto connected', {
      phone: this.cfg.phone,
      session: this.cfg.sessionPath,
      sessionLoadedBytes: saved.length,
      hasAuthKey: Boolean(this.session.authKey?.getKey?.()),
      dcId: this.session.dcId,
      serverAddress: this.session.serverAddress,
      port: this.session.port,
    });
  }

  // Wipe both the in-memory session and the on-disk file so a fresh login is forced.
  // Used when a stale auth key (e.g. across DC migration) makes getMe() fail.
  invalidateSession() {
    try {
      if (this.session) {
        this.session.authKey = undefined;
        this.session._key = undefined;
      }
      if (this.cfg.sessionPath && fs.existsSync(this.cfg.sessionPath)) {
        fs.unlinkSync(this.cfg.sessionPath);
        log.warn('session invalidated and file deleted');
      }
    } catch (e) {
      log.warn(e, 'session invalidate fail');
    }
  }

  // Persist current in-memory session (auth key + dc info) to disk.
  // Call after login too — auth key may be rotated by the server during sign-in.
  saveSession() {
    if (!this.session) return false;
    const str = this.session.save();
    if (!str) {
      log.warn('session.save() returned empty — auth key not set');
      return false;
    }
    this.#writeSession(str);
    log.debug('session persisted', { bytes: str.length, path: this.cfg.sessionPath });
    return true;
  }

  isAuthorized() {
    return Boolean(this.session?.save?.());
  }

  async getMe() {
    try { return await this.client.getMe(); }
    catch (e) {
      log.warn(e, 'getMe failed', { msg: e.message, code: e.code });
      return null;
    }
  }

  withHandler(cls, fn) { this.handlers.set(cls, fn); return this; }

  async ensureAuthorized() {
    const me = await this.getMe();
    if (me) {
      this.status = 'authorized';
      log.info('already authorized', { id: me.id, username: me.username });
      return;
    }
    throw new Error('not authorized');
  }

  #readSession() {
    if (!this.cfg.sessionPath) return '';
    try { return fs.readFileSync(this.cfg.sessionPath, 'utf8').trim(); }
    catch { return ''; }
  }

  #writeSession(str) {
    if (!this.cfg.sessionPath || !str) return;
    try {
      fs.mkdirSync(path.dirname(this.cfg.sessionPath), { recursive: true });
      // Atomic-ish: write to .tmp then rename. Avoids truncated file if killed mid-write.
      const tmp = this.cfg.sessionPath + '.tmp';
      fs.writeFileSync(tmp, str);
      fs.renameSync(tmp, this.cfg.sessionPath);
      log.debug('session saved', { bytes: str.length });
    } catch (e) {
      log.warn(e, 'session save fail');
    }
  }
}

function parseSocks(addr) {
  // GramJS's PromisedNetSockets accepts plain SOCKS only when proxy has NO `MTProxy` key.
  // Required fields: ip, port, socksType (4 | 5).
  try {
    const u = new URL(addr);
    return {
      ip: u.hostname,
      port: Number(u.port || 1080),
      socksType: 5,
      timeout: 10,
      username: u.username || undefined,
      password: u.password || undefined,
    };
  } catch (e) {
    log.warn(e, 'invalid socks5 url', { addr });
    return undefined;
  }
}