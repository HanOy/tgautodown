import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger/index.js';
import { sanitizeFileName } from './download.js';

export class Ctx {
  constructor(client, cfg, channel) {
    this.client = client;
    this.cfg = cfg;
    this.channel = channel;
  }
  saveDir(sub) {
    const p = path.join(this.cfg.savedir, sub);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  async reply(msg, text) {
    try {
      await this.client.sendMessage(this.channel.entity, {
        message: text,
        replyTo: msg.id,
      });
    } catch (e) {
      log.warn(e, 'reply fail', { id: msg.id });
    }
  }
}

export async function dispatchMessage(tg, channel, msg) {
  const media = msg.media;
  let cls = null;
  let fileName = null;
  let fileSize = 0;

  if (!media) {
    const text = msg.message ?? '';
    if (text.toLowerCase().startsWith('magnet:?')) cls = 'magnet';
    else { cls = 'note'; fileName = `${msg.id}.md`; }
  } else if (media.className === 'MessageMediaPhoto') {
    cls = 'photo';
    fileName = `${channel.name}_${msg.id}.jpg`;
    let maxSize = 0;
    for (const s of media.photo?.sizes ?? []) {
      let sz = 0;
      if (s.className === 'PhotoSize' || s.className === 'PhotoSizeProgressive') sz = Number(s.size ?? 0);
      else if (s.className === 'PhotoCachedSize') sz = s.bytes?.length ?? 0;
      if (sz > maxSize) maxSize = sz;
    }
    fileSize = maxSize;
  } else if (media.className === 'MessageMediaDocument') {
    const doc = media.document;
    const mime = doc?.mimeType ?? '';
    if (mime.startsWith('video/')) cls = 'video';
    else if (mime.startsWith('audio/')) cls = 'audio';
    else cls = 'document';

    let attrName = null;
    for (const a of doc?.attributes ?? []) {
      if (a.className === 'DocumentAttributeFilename') attrName = a.fileName;
    }
    const text = sanitizeFileName(msg.message ?? '');
    const fallbackExt = cls === 'video' ? 'mp4' : cls === 'audio' ? 'mp3' : 'bin';
    fileName = attrName || (text ? `${text}.${fallbackExt}` : `${channel.name}_${msg.id}.${fallbackExt}`);
    fileSize = Number(doc?.size ?? 0);
  }

  if (!cls) return;
  const h = tg.handlers.get(cls);
  if (!h) return;

  const ctx = new Ctx(tg.client, tg.cfg, channel);
  try {
    await h(ctx, msg, { fileName, fileSize });
  } catch (e) {
    log.error(e, 'handler fail', { cls, id: msg.id });
  }
}