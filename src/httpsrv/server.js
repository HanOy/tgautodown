import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../logger/index.js';
import { cfg } from '../config/cfg.js';
import { submitLoginCode, submit2faPassword } from '../tg/auth.js';
import { TgClient } from '../tg/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '..', '..', 'static');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function rid() { return Math.random().toString(36).slice(2, 12); }

function jsonRes(w, code, obj) {
  w.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  w.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export async function startHttp(state) {
  const server = http.createServer(async (req, res) => {
    const id = rid();
    log.info(`[${id}] ${req.method} ${req.url}`);

    try {
      if (req.url === '/') return serveStatic(res, 'index.html');
      if (req.url.startsWith('/static/')) return serveStatic(res, req.url.slice('/static/'.length));
      if (req.url === '/tgad/login/status') return handleLoginStatus(state, res);
      if (req.url === '/tgad/login/user'   && req.method === 'POST') { return handleLoginUser(state, req, res, id); }
      if (req.url === '/tgad/login/code'   && req.method === 'POST') { return handleLoginCode(state, req, res, id); }
      if (req.url === '/tgad/login/password' && req.method === 'POST') { return handleLoginPassword(state, req, res, id); }
      if (req.url === '/tgad/channels/list')     return handleChannelsList(state, res);
      if (req.url === '/tgad/channels/modify' && req.method === 'POST') { return handleChannelsModify(state, req, res, id); }
      if (req.url === '/tgad/messages/send' && req.method === 'POST') { return handleMessagesSend(state, req, res, id); }
      if (req.url === '/tgad/diag') return handleDiag(state, res);
      if (req.url === '/tgad/fetch-history' && req.method === 'POST') { return handleFetchHistory(state, req, res, id); }
      jsonRes(res, 404, { rtn: -1, msg: 'not found' });
    } catch (e) {
      log.error(e, `[${id}] http handler crash`);
      jsonRes(res, 500, { rtn: -1, msg: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const { host, port } = parseListenAddr(cfg.httpaddr);
    server.listen(port, host, () => {
      log.info('http listening', { addr: cfg.httpaddr, host, port });
      resolve(server);
    });
  });
}

function parseListenAddr(addr) {
  if (typeof addr === 'number') return { host: '', port: addr };
  const s = String(addr ?? '');
  const m = s.match(/^(?:\[[^\]]+\]|[^:]+)?(?::(\d+))?$/);
  if (m && (m[1] || !s.includes(':'))) {
    return { host: '', port: Number(m[1] ?? s) };
  }
  const lastColon = s.lastIndexOf(':');
  return { host: s.slice(0, lastColon), port: Number(s.slice(lastColon + 1)) || 0 };
}

function serveStatic(res, rel) {
  rel = rel.replace(/\.\.+/g, '');
  const fp = path.join(STATIC_DIR, rel);
  if (!fp.startsWith(STATIC_DIR)) return jsonRes(res, 403, { rtn: -1, msg: 'forbidden' });
  fs.readFile(fp, (err, buf) => {
    if (err) return jsonRes(res, 404, { rtn: -1, msg: 'not found' });
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------------- handlers ----------------

function handleLoginStatus(state, res) {
  const me = state.me;
  jsonRes(res, 200, {
    rtn: 0,
    msg: 'succ',
    status:  state.status,
    pwdHint: state.pwdHint ?? '',
    appid:   cfg.appid,
    apphash: cfg.apphash ? cfg.apphash.slice(0, 6) + '***' : '',
    phone:   cfg.phone,
    firstname: me?.firstName ?? '',
    username:  me?.username ?? '',
  });
}

async function handleLoginUser(state, req, res, id) {
  let body;
  try { body = await readBody(req); }
  catch { return jsonRes(res, 400, { rtn: -1, msg: 'bad json' }); }

  const { appid, apphash, phone } = body;
  if (!appid || !apphash || !phone) {
    return jsonRes(res, 400, { rtn: -1, msg: 'missing fields' });
  }
  cfg.appid = Number(appid);
  cfg.apphash = String(apphash);
  cfg.phone = String(phone);
  cfg.save();
  log.info(`[${id}] login user submitted`, { appid, phone });
  jsonRes(res, 200, { rtn: 0, msg: 'succ' });

  state.kickLogin().catch((e) => log.error(e, 'kick login fail'));
}

async function handleLoginCode(state, req, res, id) {
  let body;
  try { body = await readBody(req); }
  catch { return jsonRes(res, 400, { rtn: -1, msg: 'bad json' }); }

  if (!body.code) return jsonRes(res, 400, { rtn: -1, msg: 'missing code' });
  log.info(`[${id}] login code submitted`);
  submitLoginCode(String(body.code));
  jsonRes(res, 200, { rtn: 0, msg: 'succ' });
}

async function handleLoginPassword(state, req, res, id) {
  let body;
  try { body = await readBody(req); }
  catch { return jsonRes(res, 400, { rtn: -1, msg: 'bad json' }); }

  if (!body.password) return jsonRes(res, 400, { rtn: -1, msg: 'missing password' });
  if (state.status !== 'awaiting-2fa') {
    log.warn(`[${id}] password submitted but status is ${state.status}`);
    return jsonRes(res, 409, { rtn: -1, msg: `not awaiting password (status=${state.status})` });
  }
  log.info(`[${id}] 2fa password submitted (${String(body.password).length} chars)`);
  submit2faPassword(String(body.password));
  jsonRes(res, 200, { rtn: 0, msg: 'succ' });
}

function handleChannelsList(state, res) {
  jsonRes(res, 200, { rtn: 0, msg: 'succ', channels: cfg.channels, resolved: state.session?.resolved ?? [] });
}

async function handleChannelsModify(state, req, res, id) {
  let body;
  try { body = await readBody(req); }
  catch { return jsonRes(res, 400, { rtn: -1, msg: 'bad json' }); }

  const list = Array.isArray(body.channels) ? body.channels : null;
  if (!list) return jsonRes(res, 400, { rtn: -1, msg: 'channels[] required' });
  cfg.channels = list.map((s) => String(s).trim()).filter(Boolean);
  cfg.save();
  log.info(`[${id}] channels updated`, cfg.channels);

  // Apply live: remove old event handler, re-resolve channels, re-install handler.
  const result = await state.restartListener();
  if (!result.ok) log.warn(`[${id}] listener restart: ${result.msg}`);
  jsonRes(res, 200, {
    rtn: result.ok ? 0 : -1,
    msg: result.ok ? 'succ' : `cfg saved, but listener restart failed: ${result.msg}`,
    channels: cfg.channels,
    resolved: state.session?.resolved ?? [],
  });
}

async function handleMessagesSend(state, req, res, id) {
  let body;
  try { body = await readBody(req); }
  catch { return jsonRes(res, 400, { rtn: -1, msg: 'bad json' }); }

  const { channel, text, replyTo } = body;
  if (!channel || typeof channel !== 'string') {
    return jsonRes(res, 400, { rtn: -1, msg: 'channel (name) required' });
  }
  if (!text || typeof text !== 'string') {
    return jsonRes(res, 400, { rtn: -1, msg: 'text required' });
  }
  log.info(`[${id}] send request`, { channel, len: text.length, replyTo });
  const result = await state.sendMessage(channel.trim(), text, replyTo);
  jsonRes(res, result.ok ? 200 : 400, {
    rtn: result.ok ? 0 : -1,
    msg: result.ok ? 'succ' : result.msg,
    id:  result.id,
  });
}

function handleDiag(state, res) {
  const s = state.session;
  let sessionStat = null;
  if (cfg.sessionPath && fs.existsSync(cfg.sessionPath)) {
    const st = fs.statSync(cfg.sessionPath);
    sessionStat = { size: st.size, mtime: st.mtime.toISOString() };
  }
  const tg = state.tg;
  const sess = tg?.session;
  jsonRes(res, 200, {
    rtn: 0,
    status: state.status,
    paths: {
      cwd:        process.cwd(),
      cfgdir:     cfg.cfgdir,
      cfgPath:    cfg.cfgPath,
      session:    cfg.sessionPath,
      sessionExists: cfg.sessionPath ? fs.existsSync(cfg.sessionPath) : false,
      sessionStat,
    },
    sessionInfo: sess ? {
      dcId: sess.dcId,
      serverAddress: sess.serverAddress,
      port: sess.port,
      hasAuthKey: Boolean(sess.authKey?.getKey?.()),
    } : null,
    me: state.me ? { id: String(state.me.id), username: state.me.username, first: state.me.firstName } : null,
    session: s ? {
      status: s.status,
      channels: cfg.channels,
      resolved: s.resolved.map((c) => ({
        name: c.name, kind: c.kind, id: String(c.id), title: c.title,
      })),
      handlerInstalled: Boolean(s.handlerCallback && s.handlerEvent),
    } : null,
  });
}

async function handleFetchHistory(state, req, res, id) {
  let body;
  try { body = await readBody(req); }
  catch { return jsonRes(res, 400, { rtn: -1, msg: 'bad json' }); }

  const channel = (body.channel || '').toString().trim();
  const limit = Math.min(Number(body.limit) || 10, 50);
  if (!channel) return jsonRes(res, 400, { rtn: -1, msg: 'channel required' });

  log.info(`[${id}] fetch-history`, { channel, limit });
  const result = await state.fetchHistory(channel, limit);
  jsonRes(res, result.ok ? 200 : 400, {
    rtn: result.ok ? 0 : -1,
    msg: result.ok ? 'succ' : result.msg,
    fetched: result.fetched,
    dispatched: result.dispatched,
    errors: result.errors,
  });
}