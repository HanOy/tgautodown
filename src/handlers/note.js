import path from 'node:path';
import fs from 'node:fs';
import { log } from '../logger/index.js';

export async function handleNote(ctx, msg, info) {
  const text = msg.message ?? '';
  const savePath = path.join(ctx.saveDir('note'), `${msg.id}.md`);
  try {
    fs.writeFileSync(savePath, text, 'utf8');
    log.info('note saved', { savePath, msgid: msg.id, from: ctx.channel.title });
    await ctx.reply(msg, `笔记添加成功:\n- 消息ID: ${msg.id}\n- 保存路径: ${savePath}`);
  } catch (e) {
    log.error(e, 'note save fail');
    await ctx.reply(msg, `笔记添加失败:\n- 消息ID: ${msg.id}\n- 失败原因: ${e.message}`);
  }
}