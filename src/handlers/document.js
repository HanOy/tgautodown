import path from 'node:path';
import { saveMedia, fmtSize } from '../tg/download.js';

export async function handleDocument(ctx, msg, info) {
  const savePath = path.join(ctx.saveDir('documents'), info.fileName);
  await ctx.reply(msg, `正在下载文档: ${info.fileName}\n- 文件大小: ${fmtSize(info.fileSize)}\n- 消息ID: ${msg.id}`);
  await saveMedia(ctx.client, msg, savePath, async (err, saved) => {
    if (err) await ctx.reply(msg, `下载失败: ${info.fileName}\n- 消息ID: ${msg.id}\n- 失败原因: ${err.message}`);
    else     await ctx.reply(msg, `下载成功: ${info.fileName}\n- 消息ID: ${msg.id}\n- 保存路径: ${saved}`);
  }, info.fileSize);
}