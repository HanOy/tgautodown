import { log } from './logger/index.js';
import { resolveAll } from './tg/channel.js';
import { dispatchMessage } from './tg/handler.js';
import { NewMessage } from 'telegram/events/index.js';
import { handlePhoto } from './handlers/photo.js';
import { handleVideo } from './handlers/video.js';
import { handleAudio } from './handlers/audio.js';
import { handleDocument } from './handlers/document.js';
import { handleNote } from './handlers/note.js';
import { handleMagnet } from './handlers/magnet.js';

export class TgSession {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = null;
    this.status = 'init';
    this.resolved = [];
    this.handlers = new Map();
    this.#wire();
  }

  #wire() {
    this.handlers.set('photo',    handlePhoto);
    this.handlers.set('video',    handleVideo);
    this.handlers.set('audio',    handleAudio);
    this.handlers.set('document', handleDocument);
    this.handlers.set('note',     handleNote);
    this.handlers.set('magnet',   handleMagnet);
  }

  async start(initialClient = null) {
    this.status = 'starting';
    const { TgClient } = await import('./tg/client.js');

    if (initialClient) {
      this.client = initialClient;
    } else {
      const tg = new TgClient(this.cfg);
      await tg.connect();
      this.client = tg.client;
      this.tg = tg;
    }
    this.status = 'connected';
  }

  async beginListener() {
    if (!this.client) throw new Error('client not started');
    this.resolved = await resolveAll(this.client, this.cfg.channels);
    if (!this.resolved.length) {
      log.error(null, 'no channels resolved — check -names');
      this.status = 'idle';
      this.handlerCallback = null;
      this.handlerEvent = null;
      return;
    }
// Pre-resolve channel IDs (BigInt) and pass them to NewMessage as a `chats` filter.
// Don't restrict by incoming/outgoing — for solo testing the user may post from
// their own logged-in account, and outgoing messages also need to be processed.
    const chatIds = this.resolved.map((c) => c.id);

    this.handlerEvent = new NewMessage({ chats: chatIds });
    this.handlerCallback = async (event) => {
      const msg = event.message;
      if (!msg) return;
      log.trace('incoming msg', {
        id: msg.id,
        peerCls: msg.peerId?.className,
        peerChannelId: msg.peerId?.channelId?.toString?.(),
        peerChannelIdType: typeof msg.peerId?.channelId,
        peerChatId: msg.peerId?.chatId?.toString?.(),
        hasMedia: !!msg.media,
        out: msg.out,
      });
      if (msg.replyTo) { log.trace('skip reply'); return; }
      // Belt-and-suspenders: re-check peerId even though `chats` filter should have caught it.
      const peerId = msg.peerId?.channelId ?? msg.peerId?.chatId;
      if (!peerId) {
        log.warn('no peerId', { id: msg.id, peerCls: msg.peerId?.className });
        return;
      }
      // Compare via string to sidestep BigInt vs Number / wrapper mismatches.
      const peerIdStr = String(peerId);
      const ch = this.resolved.find((c) => String(c.id) === peerIdStr);
      if (!ch) {
        log.warn('msg from unknown peer', {
          id: msg.id,
          peerId: peerIdStr,
          peerType: typeof peerId,
          knownIds: this.resolved.map((c) => String(c.id)),
          knownTypes: this.resolved.map((c) => typeof c.id),
        });
        return;
      }
      log.debug('recv msg', { id: msg.id, from: ch.title, cls: msg.media?.className ?? 'text' });
      try {
        await dispatchMessage(this, ch, msg);
      } catch (e) {
        log.error(e, 'dispatch error', { id: msg.id });
      }
    };
    this.client.addEventHandler(this.handlerCallback, this.handlerEvent);
    this.status = 'listening';
    log.info('listener installed', {
      channels: this.resolved.map((c) => `${c.name} (${c.title})`),
      ids: this.resolved.map((c) => String(c.id)),
    });
  }

  stopListener() {
    if (this.client && this.handlerCallback && this.handlerEvent) {
      this.client.removeEventHandler(this.handlerCallback, this.handlerEvent);
      log.info('listener removed');
    }
    this.handlerCallback = null;
    this.handlerEvent = null;
  }

  async restartListener() {
    this.stopListener();
    await this.beginListener();
  }

  setStatus(s) { this.status = s; }
}