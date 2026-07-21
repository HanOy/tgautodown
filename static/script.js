const $ = (s) => document.querySelector(s);

const STATUS_LABELS = {
  init:         ['未初始化', 'status-warn'],
  'need-login': ['请提交登录信息', 'status-warn'],
  connecting:   ['正在连接 Telegram…', 'status-warn'],
  'awaiting-code': ['等待短信验证码', 'status-warn'],
  'awaiting-2fa':  ['等待两步验证密码', 'status-warn'],
  authorized:   ['已登录', 'status-ok'],
  listening:    ['正在监听频道', 'status-ok'],
  error:        ['错误', 'status-error'],
};

async function api(method, url, body) {
  const init = { method, headers: {} };
  if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(url, init);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function refresh() {
  const { body } = await api('GET', '/tgad/login/status');
  const [label, cls] = STATUS_LABELS[body.status] ?? [body.status, ''];
  let html = `<div>状态: <span class="${cls}">${label}</span> <span class="tag">${body.status}</span></div>`;
  html += `<div>AppID: ${body.appid || '-'}</div>`;
  html += `<div>Phone: ${body.phone || '-'}</div>`;
  if (body.firstname || body.username) {
    html += `<div>账户: ${body.firstname ?? ''} ${body.username ? '@' + body.username : ''}</div>`;
  }
  $('#status-content').innerHTML = html;

  $('#user-form').classList.toggle('hidden', body.status !== 'need-login');
  $('#code-form').classList.toggle('hidden', body.status !== 'awaiting-code');
  $('#password-form').classList.toggle('hidden', body.status !== 'awaiting-2fa');
  $('#pwd-hint').textContent = body.pwdHint ? `提示: ${body.pwdHint}` : '';
  $('#success-box').classList.toggle('hidden',
    !['authorized', 'listening'].includes(body.status) || !body.firstname);

  if (['authorized', 'listening'].includes(body.status) && body.firstname) {
    $('#success-info').textContent = `已登录为 ${body.firstname}${body.username ? ' (@' + body.username + ')' : ''}`;
  }

  const ch = await api('GET', '/tgad/channels/list');
  const list = ch.body.channels ?? [];
  const resolved = ch.body.resolved ?? [];
  $('#channels-current').textContent = `当前: ${list.length ? list.join(', ') : '(无)'}\n已解析: ${JSON.stringify(resolved, null, 2)}`;
  // Only seed the channel input if it's empty — never clobber the user's in-progress draft.
  const chanInput = $('#channels-form input[name=channels]');
  if (!chanInput.value) chanInput.value = list.join(',');

  // Populate send-target dropdown from resolved channels.
  const sel = $('#send-channel-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— 已解析频道 —</option>';
  for (const r of resolved) {
    const o = document.createElement('option');
    o.value = r.name;
    o.textContent = `${r.name}  ·  ${r.title}  [${r.kind}]`;
    sel.appendChild(o);
  }
  if (prev) sel.value = prev;

  // Only show the send panel when there's an active session.
  const sendBox = $('#send-box');
  if (['authorized', 'listening'].includes(body.status)) sendBox.classList.remove('hidden');
  else sendBox.classList.add('hidden');
}

$('#login-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = '提交中…';
  const { body } = await api('POST', '/tgad/login/user', {
    appid:   Number(fd.get('appid')),
    apphash: fd.get('apphash'),
    phone:   fd.get('phone'),
  });
  btn.textContent = body.rtn === 0 ? '已提交' : '失败';
  setTimeout(refresh, 800);
  setTimeout(refresh, 2500);
  setTimeout(refresh, 6000);
});

$('#login-code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = '提交中…';
  const { body } = await api('POST', '/tgad/login/code', { code: fd.get('code') });
  btn.textContent = body.rtn === 0 ? '已提交' : '失败';
  setTimeout(refresh, 1500);
  setTimeout(refresh, 4000);
});

$('#login-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const pwd = fd.get('password');
  const form = e.target;
  const btn = form.querySelector('button');
  const input = form.querySelector('input[name=password]');
  const errSpan = document.getElementById('pwd-error');

  errSpan.textContent = '';
  btn.disabled = true; btn.textContent = '提交中…';
  input.value = ''; // wipe before send

  const { body } = await api('POST', '/tgad/login/password', { password: pwd });
  if (body.rtn !== 0) {
    btn.disabled = false; btn.textContent = '提交';
    errSpan.textContent = body.msg || '提交失败';
    input.focus();
    return;
  }

  // Server accepted; poll to find out whether TG accepted too.
  // - wrong password  -> status stays awaiting-2fa (GramJS re-asks)
  // - right password  -> status -> authorized -> listening
  // - hard failure    -> status -> error
  let ticks = 0;
  const poll = setInterval(async () => {
    ticks++;
    const { body: st } = await api('GET', '/tgad/login/status');
    if (['authorized', 'listening'].includes(st.status)) {
      clearInterval(poll);
      btn.disabled = false; btn.textContent = '提交';
      refresh();
      return;
    }
    if (st.status === 'awaiting-2fa' && ticks >= 2) {
      clearInterval(poll);
      btn.disabled = false; btn.textContent = '提交';
      errSpan.textContent = '密码错误，请重新输入';
      input.focus();
      return;
    }
    if (st.status === 'error') {
      clearInterval(poll);
      btn.disabled = false; btn.textContent = '提交';
      errSpan.textContent = '登录失败：服务器拒绝或网络异常，可尝试重启服务';
      input.focus();
      return;
    }
    if (ticks > 12) clearInterval(poll);
  }, 1500);
});

$('#channels-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const raw = fd.get('channels') || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  await api('POST', '/tgad/channels/modify', { channels: list });
  refresh();
});

$('#send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button');
  const result = document.getElementById('send-result');
  const channel = (fd.get('channelOverride') || fd.get('channel') || '').toString().trim();
  const text = (fd.get('text') || '').toString();
  const replyToRaw = (fd.get('replyTo') || '').toString().trim();
  const replyTo = replyToRaw ? Number(replyToRaw) : null;

  if (!channel) { result.textContent = '请选择或填写目标频道'; return; }
  if (!text.trim()) { result.textContent = '请输入消息内容'; return; }

  btn.disabled = true; btn.textContent = '发送中…';
  result.textContent = '';
  const body = { channel, text };
  if (replyTo) body.replyTo = replyTo;
  const { status, body: res } = await api('POST', '/tgad/messages/send', body);
  btn.disabled = false; btn.textContent = '发送';
  if (res.rtn === 0) {
    result.className = 'status-ok';
    result.textContent = `已发送 (msg id: ${res.id ?? '?'})`;
    e.target.querySelector('textarea[name=text]').value = '';
  } else {
    result.className = 'status-error';
    result.textContent = `发送失败: ${res.msg} (HTTP ${status})`;
  }
});

refresh();
setInterval(refresh, 5000);