import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { log } from '../logger/index.js';

// Parse a single line of gopeed output. gopeed CLI emits JSON progress events on
// stderr that look like: {"id":"...","progress":0.42,"size":1234,"downloaded":518,"status":"running"}
// Older versions emit plain-text progress like `[#abc123] 42.0% 1KB/3KB`.
function parseGopeedLine(line) {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); }
    catch { return null; }
  }
  // Fallback: pull out "<pct>% <downloaded>/<total>"
  const m = trimmed.match(/(\d{1,3}(?:\.\d+)?)%\s+([\d.]+\s*\S+)\s*\/\s*([\d.]+\s*\S+)/);
  if (m) {
    return { progress: Number(m[1]) / 100, downloaded: m[2], size: m[3] };
  }
  return null;
}

export async function handleMagnet(ctx, msg, info) {
  const url = msg.message ?? '';
  const dir = ctx.saveDir('bt');
  log.info('recv magnet', { msgid: msg.id, url, from: ctx.channel.title });
  await ctx.reply(msg, `正在下载BT:\n- 消息ID: ${msg.id}`);

  if (!ctx.cfg.gopeed || !fs.existsSync(ctx.cfg.gopeed)) {
    const err = new Error(`gopeed binary not found at ${ctx.cfg.gopeed}`);
    await ctx.reply(msg, `BT下载失败:\n- 消息ID: ${msg.id}\n- 失败原因: ${err.message}`);
    return;
  }

  const child = spawn(ctx.cfg.gopeed, ['-C', '32', '-D', dir, url], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let lastProgressPct = -1;
  const report = async (parsed, source) => {
    if (!parsed || typeof parsed.progress !== 'number') return;
    const pct = Math.floor(parsed.progress * 100);
    if (pct === lastProgressPct) return;
    lastProgressPct = pct;
    log.debug(`magnet progress ${source}`, {
      msgid: msg.id,
      pct,
      downloaded: parsed.downloaded,
      size: parsed.size,
      status: parsed.status,
    });
  };

  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });
  rlOut.on('line', (l) => report(parseGopeedLine(l), 'stdout'));
  rlErr.on('line', (l) => report(parseGopeedLine(l), 'stderr'));

  // Also surface non-progress lines at debug level so failures aren't silent.
  rlErr.on('line', (l) => {
    const parsed = parseGopeedLine(l);
    if (!parsed) log.trace('magnet stderr', { msgid: msg.id, line: l.slice(0, 200) });
  });

  const code = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', (err) => {
      log.error(err, 'magnet spawn error', { msgid: msg.id });
      resolve({ code: -1, signal: null, err });
    });
  });

  if (code.code === 0) {
    log.info('magnet done', { msgid: msg.id, dir });
    await ctx.reply(msg, `BT下载成功:\n- 消息ID: ${msg.id}\n- 保存路径: ${dir}`);
  } else {
    const reason = code.err ? code.err.message : `exit ${code.code}${code.signal ? ` (signal ${code.signal})` : ''}`;
    log.warn('magnet fail', { msgid: msg.id, reason });
    await ctx.reply(msg, `BT下载失败:\n- 消息ID: ${msg.id}\n- 失败原因: ${reason}`);
  }
}