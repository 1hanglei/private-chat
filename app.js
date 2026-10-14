/* 私聊房间 —— 前端逻辑（原生 JS，无依赖） */
'use strict';

/* ==================== 小工具 ==================== */
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, opts = {}, ...kids) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text != null) n.textContent = opts.text;
  if (opts.title) n.title = opts.title;
  if (opts.attrs) for (const k in opts.attrs) n.setAttribute(k, opts.attrs[k]);
  if (opts.style) Object.assign(n.style, opts.style);
  if (opts.on) for (const k in opts.on) n.addEventListener(k, opts.on[k]);
  kids.flat().forEach(k => { if (k == null || k === false) return; n.append(k); });
  return n;
}
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(ts) {
  const d = new Date(ts), n = new Date();
  const k = dayKey(ts);
  if (k === dayKey(n.getTime())) return '今天';
  if (k === dayKey(n.getTime() - 864e5)) return '昨天';
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + '分钟前';
  if (dayKey(ts) === dayKey(Date.now())) return hhmm(ts);
  if (dayKey(ts) === dayKey(Date.now() - 864e5)) return '昨天';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function hueBg(seed) {
  let h = 0;
  for (const ch of String(seed || 'x')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `linear-gradient(135deg,hsl(${h} 60% 47%),hsl(${(h + 44) % 360} 58% 38%))`;
}
function mutedText(until) {
  if (until == null) return '';
  if (until === -1) return '永久禁言';
  const left = until - Date.now();
  if (left <= 0) return '';
  const m = Math.ceil(left / 60e3);
  if (m < 60) return `禁言中 · 还剩 ${m} 分钟`;
  if (m < 1440) return `禁言中 · 还剩 ${Math.ceil(m / 60)} 小时`;
  return `禁言中 · 还剩 ${Math.ceil(m / 1440)} 天`;
}
const RANK = { owner: 3, admin: 2, member: 1 };
const ROLE_LABEL = { owner: '房主', admin: '管理员', member: '' };

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 3600 : 2200);
}

/* ==================== 状态 ==================== */
const S = {
  token: localStorage.getItem('pc_token') || '',
  me: null,
  rooms: [],
  roomId: null,
  members: {},
  msgs: {},
  hasMore: {},
  ws: null,
  wsOk: false,
  retry: 0,
  joined: new Set(),
  panelTab: 'members',
  lastTypingSent: 0,
  typingTimer: null,
  pending: {},
};

/* ==================== 接口 ==================== */
async function api(path, opt = {}) {
  const headers = {};
  const tok = 'token' in opt ? opt.token : S.token;
  if (tok) headers.Authorization = 'Bearer ' + tok;
  let body = opt.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { method: opt.method || 'GET', headers, body });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 无 JSON 体 */ }
  if (!res.ok) {
    let detail = data && data.detail;
    if (Array.isArray(detail)) detail = detail[0] && (detail[0].msg || '参数不对');
    const err = new Error(detail || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ==================== 头像 / 封面 ==================== */
function avatarNode(ent, size = 'av-32') {
  const av = (ent && ent.avatar) || '';
  const n = el('div', { class: 'av ' + size });
  if (av.startsWith('/media/')) n.append(el('img', { attrs: { src: av, alt: '' } }));
  else if (av) n.textContent = av;
  else {
    n.textContent = [...(ent && ent.nickname ? ent.nickname : '?')][0];
    n.style.background = hueBg((ent && ent.id) || (ent && ent.nickname));
    n.style.color = '#fff';
  }
  return n;
}
function onlineNode(ent, size, online) {
  const n = avatarNode(ent, size);
  n.classList.add('dot');
  if (online) n.classList.add('on');
  return n;
}
function coverNode(room, size = 'av-36') {
  const c = (room && room.cover) || '';
  const n = el('div', { class: 'av ' + size + ' room-cover' });
  if (c.startsWith('/media/')) n.append(el('img', { attrs: { src: c, alt: '' } }));
  else if (c) n.textContent = c;
  else {
    n.textContent = [...(room && room.name ? room.name : '房')][0];
    n.style.background = hueBg((room && room.id) || (room && room.name));
    n.style.color = '#fff';
  }
  return n;
}

/* ==================== 表情 ==================== */
const EMOJI_CATS = [
  ['常用', '😀 😁 😂 🤣 😅 😊 🙂 😉 😍 🥰 😘 😜 🤗 🤔 🤨 😐 😴 😌 😎 🤩 🥳 😢 😭 😤 😡 🥺 😳 🤯 😱 🙄 😬 🙃 😇 🤭 🤫 🫡 🫠 🥹 😮‍💨 🥱 🤤 😵 😷 🤒 🤕 🥴 😋 🤪 🧐 🤓'.split(' ')],
  ['手势', '👍 👎 👏 🙌 🤝 🙏 ✌️ 🤞 🤟 👌 🤙 👋 🫶 💪 🖐️ ✋ 👆 👇 👈 👉 ✊ 🤛 🤜 🫰 🤌 👐 🫂 🖖 ✍️'.split(' ')],
  ['心情', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💗 💓 💞 💕 💔 ❣️ 💘 💝 ✨ 🔥 💯 ✅ ❌ ⚡ 💥 💫 🎉 🎊 🎁 🎈 ⭐ 🌟 🏆 🥇 🎯 📌'.split(' ')],
  ['日常', '☕ 🍵 🧋 🍺 🍻 🍷 🍔 🍟 🍕 🍜 🍚 🍣 🍰 🎂 🍎 🍉 🍓 🍇 🍦 🍫 🌸 🌹 🌻 🌈 ☀️ 🌙 🌊 🐶 🐱 🐻 🐼 🐨 🐰 🦊 🐳 🦋 🌳 ⛰️ ✈️ 🚗 🚲 🎮 🎧 🎵 📷 💻 📚 🛌 🧗 🏃 ⚽ 🏀 🏸 🎬 🍲 🧧 🧦 🩹 🧸'.split(' ')],
];
function emojiGrid(onPick, current) {
  const wrap = el('div', { class: 'emoji-grid' });
  current = current || '';
  EMOJI_CATS.forEach(([name, list]) => {
    list.forEach(e => {
      const b = el('button', {
        class: 'emoji-btn' + (e === current ? ' on' : ''), text: e, attrs: { type: 'button' },
        on: { click: () => { wrap.querySelectorAll('.emoji-btn.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(e); } },
      });
      wrap.append(b);
    });
  });
  return wrap;
}

/* ==================== 头像选择器（表单里用） ==================== */
function avatarPicker(value, onChange) {
  let cur = value || '';
  const slot = el('div', { class: 'picker-slot' });
  const preview = el('div', { class: 'picker-current' });
  const fileInput = el('input', { attrs: { type: 'file', accept: 'image/*', style: 'display:none' } });
  const draw = () => {
    preview.innerHTML = '';
    preview.append(avatarNode({ avatar: cur, nickname: S.me ? S.me.nickname : '我' }, 'av-44'));
    preview.append(el('div', { class: 'muted-txt', text: cur.startsWith('/media/') ? '已上传图片头像' : (cur ? '选了一个 emoji' : '没选就自动用昵称首字') }));
    preview.append(el('span', { style: { flex: '1' } }));
    preview.append(el('button', { class: 'btn soft sm', text: '上传图片', attrs: { type: 'button' }, on: { click: () => fileInput.click() } }));
    if (cur) preview.append(el('button', {
      class: 'btn ghost sm', text: '清除', attrs: { type: 'button' },
      on: { click: () => { cur = ''; onChange(''); draw(); } },
    }));
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api('/api/upload', { method: 'POST', body: fd });
      cur = r.url; onChange(cur); draw(); toast('头像已上传');
    } catch (e) { toast(e.message, true); }
    fileInput.value = '';
  });
  draw();
  slot.append(preview, emojiGrid(e => { cur = e; onChange(cur); draw(); }, cur), fileInput);
  return slot;
}

/* ==================== 模态框 ==================== */
function openModal(title, bodyNodes, footNodes) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const card = el('div', { class: 'modal-card' });
  card.append(el('div', { class: 'modal-head' }, el('h2', { text: title }),
    el('button', { class: 'icon-btn', text: '✕', on: { click: closeModal } })));
  card.append(el('div', { class: 'modal-body' }, ...bodyNodes));
  if (footNodes && footNodes.length) card.append(el('div', { class: 'modal-foot' }, ...footNodes));
  root.append(card);
  root.classList.remove('hidden');
  root.onclick = e => { if (e.target === root) closeModal(); };
  return card;
}
function closeModal() {
  const r = $('#modal-root');
  r.classList.add('hidden');
  r.innerHTML = '';
}
function confirmBox(title, text, danger, okText) {
  return new Promise(resolve => {
    const ok = el('button', {
      class: 'btn ' + (danger ? 'danger' : 'primary'), text: okText || '确定',
      on: { click: () => { closeModal(); resolve(true); } },
    });
    const no = el('button', { class: 'btn ghost', text: '取消', on: { click: () => { closeModal(); resolve(false); } } });
    openModal(title, [el('p', { class: 'muted-txt', text })], [no, ok]);
  });
}

/* ==================== 视图切换 ==================== */
function show(name) {
  ['view-landing', 'view-join', 'view-app'].forEach(v => $('#' + v).classList.toggle('hidden', v !== name));
  $('#boot').classList.add('hidden');
}
function setConn(cls, text) {
  const n = $('#conn-state');
  n.className = 'conn ' + cls;
  n.textContent = text;
}

/* ==================== 启动 ==================== */
async function boot() {
  $('#emoji-pop') && $('#chat').append($('#emoji-pop'));   // 表情面板贴着聊天区定位
  buildEmojiPop();
  wire();
  const t = tokenFromUrl();
  if (t) return showJoin(t);
  if (!S.token) return show('view-landing');
  try {
    const d = await api('/api/me');
    S.me = d.user; S.rooms = d.rooms;
    enterApp();
  } catch (e) {
    localStorage.removeItem('pc_token'); S.token = '';
    show('view-landing');
  }
}
function tokenFromUrl() {
  const hash = location.hash || '';
  let m = hash.match(/join\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  const q = new URLSearchParams(location.search);
  return q.get('invite') || '';
}
function tokenFromInput(s) {
  s = (s || '').trim();
  if (!s) return '';
  let m = s.match(/join\/([A-Za-z0-9_\-]+)/) || s.match(/[?&]invite=([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_\-]{8,64}$/.test(s) ? s : '';
}

/* ==================== 加入房间页 ==================== */
let joinState = { token: '', avatar: '' };
async function showJoin(token) {
  joinState.token = token;
  show('view-join');
  const prev = $('#join-preview');
  prev.innerHTML = '';
  prev.append(el('div', { class: 'muted-txt', text: '正在读取邀请…' }));
  const me = S.token ? await api('/api/me').catch(() => null) : null;
  if (me) { S.me = me.user; S.rooms = me.rooms; }
  try {
    const p = await api('/api/invite/' + token, { token: S.token || null });
    prev.innerHTML = '';
    prev.append(coverNode({ id: p.room.id, name: p.room.name, cover: p.room.cover }, 'av-36'));
    prev.querySelector('.av').classList.add('jp-cover');
    prev.append(el('div', {},
      el('div', { class: 'jp-name', text: p.room.name }),
      el('div', { class: 'jp-desc', text: p.room.description || '这个房间还没有写简介' }),
      el('div', { class: 'jp-desc', text: `${p.room.member_count} 位成员` + (p.inviter ? ` · 由 ${p.inviter} 邀请` : '') }),
      !p.valid ? el('div', { class: 'jp-lock', text: '⚠️ ' + p.reason }) : null));
    $('#join-submit').disabled = !p.valid;
    $('#join-submit').textContent = p.valid ? (me ? '用「' + me.user.nickname + '」的身份加入' : '加入房间') : '邀请已失效';
    if (me) {
      $('#join-nickname').value = me.user.nickname || '';
      $('#join-bio').value = me.user.bio || '';
      joinState.avatar = me.user.avatar || '';
    }
  } catch (e) {
    prev.innerHTML = '';
    prev.append(el('div', { class: 'form-error', text: e.message }));
    $('#join-submit').disabled = true;
  }
}
function buildJoinAvatarPicker() {
  const slot = $('#join-avatar');
  slot.innerHTML = '';
  slot.append(avatarPicker(joinState.avatar, v => { joinState.avatar = v; }));
}

/* ==================== 进入主界面 ==================== */
function enterApp() {
  show('view-app');
  history.replaceState(null, '', '/');
  renderMe();
  renderRooms();
  connectWS();
  const last = localStorage.getItem('pc_room');
  const target = (S.rooms.find(r => r.id === last) || S.rooms[0] || {}).id;
  if (target) selectRoom(target);
  else clearChat();
}

function renderMe() {
  if (!S.me) return;
  const a = $('#me-avatar');
  a.replaceWith(Object.assign(avatarNode(S.me, 'av-44'), { id: 'me-avatar' }));
  $('#me-name').textContent = S.me.nickname;
  $('#me-bio').textContent = S.me.bio || '还没写一句话介绍';
}

/* ==================== 房间列表 ==================== */
function renderRooms() {
  const box = $('#room-list');
  box.innerHTML = '';
  if (!S.rooms.length) {
    box.append(el('div', { class: 'muted-txt', style: { padding: '14px 10px', lineHeight: '1.7' },
      text: '还没有房间。点上面的「建房间」创建你的第一个房间吧。' }));
    return;
  }
  S.rooms.forEach(r => {
    const last = r.last_message;
    let preview = '还没有消息';
    if (last) preview = last.kind === 'system' ? last.body : `${last.nickname || '有人'}：${last.body}`;
    const item = el('div', {
      class: 'room-item' + (r.id === S.roomId ? ' active' : ''),
      on: { click: () => { selectRoom(r.id); $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('on'); } },
    },
      coverNode(r, 'av-36'),
      el('div', { class: 'ri-main' },
        el('div', { class: 'ri-name' }, r.name, r.locked ? el('span', { class: 'lock', text: '🔒' }) : null),
        el('div', { class: 'ri-last', text: preview })),
      el('div', {},
        el('div', { class: 'ri-time', text: relTime(last ? last.created_at : r.created_at) }),
        el('div', { class: 'ri-count', text: r.member_count + ' 人' })));
    box.append(item);
  });
}

/* ==================== 选择房间 ==================== */
async function selectRoom(id) {
  S.roomId = id;
  localStorage.setItem('pc_room', id);
  renderRooms();
  renderChatHead();
  renderComposerState();
  if ($('#view-app').classList.contains('panel-open')) renderPanel();
  const scroller = $('#msg-scroll');
  scroller.innerHTML = '';
  $('#msg-list').innerHTML = '';
  if (!S.msgs[id]) {
    try { await loadMessages(id); } catch (e) { toast(e.message, true); }
  }
  renderMessages();
  api(`/api/rooms/${id}`).then(d => {
    S.members[id] = d.members;
    const i = S.rooms.findIndex(r => r.id === id);
    if (i >= 0) S.rooms[i] = Object.assign(S.rooms[i], d.room);
    renderRooms(); renderChatHead(); renderComposerState();
    if ($('#view-app').classList.contains('panel-open')) renderPanel();
    api(`/api/rooms/${id}`).catch(() => {});
  }).catch(e => { if (e.status === 403) dropRoom(id); });
}
async function loadMessages(id, before) {
  const q = before ? `?before_id=${before}&limit=40` : '?limit=40';
  const d = await api(`/api/rooms/${id}/messages${q}`);
  S.hasMore[id] = d.has_more;
  if (before) S.msgs[id] = d.messages.concat(S.msgs[id] || []);
  else S.msgs[id] = d.messages;
}
function clearChat() {
  $('#msg-scroll').innerHTML = '';
  const l = $('#msg-list');
  l.innerHTML = '';
  l.append(el('div', { class: 'empty-hint', text: '左边还没有房间。创建一个房间，把邀请链接发给朋友，就能开聊了。' }));
  $('#chat-name').textContent = '还没选房间';
  $('#chat-sub').textContent = '建一个房间，把链接发给朋友';
  const c = $('#chat-cover');
  c.replaceWith(Object.assign(coverNode({ name: '房' }, 'av-36'), { id: 'chat-cover' }));
  $('#composer').style.display = 'none';
}
function curRoom() { return S.rooms.find(r => r.id === S.roomId) || null; }
function myMember(roomId) {
  const ms = S.members[roomId || S.roomId] || [];
  return ms.find(m => m.id === (S.me && S.me.id)) || null;
}
function myRole(roomId) {
  const r = S.rooms.find(x => x.id === (roomId || S.roomId));
  const m = myMember(roomId);
  return (m && m.role) || (r && r.role) || null;
}
function canModerate(target) {
  const role = myRole();
  if (!role) return false;
  return RANK[role] >= 2 && RANK[role] > RANK[target.role || 'member'];
}

/* ==================== 聊天头部 ==================== */
function renderChatHead() {
  const r = curRoom();
  if (!r) return clearChat();
  const c = $('#chat-cover');
  c.replaceWith(Object.assign(coverNode(r, 'av-36'), { id: 'chat-cover' }));
  $('#chat-name').textContent = r.name;
  const ms = S.members[r.id] || [];
  const on = ms.filter(m => m.online).length;
  $('#chat-sub').textContent = `${r.member_count} 位成员${ms.length ? ` · ${on} 人在线` : ''}` +
    (r.description ? ` · ${r.description}` : '');
  $('#composer').style.display = '';
}
function showTyping(nick) {
  const r = curRoom();
  if (!r) return;
  const ms = S.members[r.id] || [];
  const on = ms.filter(m => m.online).length;
  $('#chat-sub').textContent = `${nick} 正在输入…`;
  clearTimeout(S.typingTimer);
  S.typingTimer = setTimeout(() => renderChatHead(), 3000);
}

/* ==================== 消息渲染 ==================== */
function renderMessages() {
  const r = curRoom();
  const scroller = $('#msg-scroll');
  if (!r) return clearChat();
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const prevH = scroller.scrollHeight, prevTop = scroller.scrollTop;
  const list = $('#msg-list');
  list.innerHTML = '';
  const msgs = S.msgs[r.id] || [];
  if (S.hasMore[r.id] && msgs.length) {
    list.append(el('button', {
      class: 'btn soft sm load-more', text: '↑ 看更早的消息',
      on: { click: async ev => { ev.currentTarget.disabled = true; await loadMessages(r.id, msgs[0].id); renderMessages(); } },
    }));
  }
  if (!msgs.length) {
    const invited = (S.members[r.id] || []).length > 1;
    list.append(el('div', { class: 'empty-hint' },
      el('p', { text: '房间里还很安静。' }),
      el('p', { class: 'muted-txt', text: invited ? '说点什么吧 👋' : '把邀请链接或二维码发给朋友，他们点开就能进来聊。' }),
      !invited ? el('button', { class: 'btn primary sm', style: { marginTop: '10px' }, text: '🔗 邀请朋友', on: { click: () => openInviteTab() } }) : null));
    return;
  }
  let lastDay = '', lastUser = '', lastTs = 0;
  msgs.forEach(m => {
    const dk = dayKey(m.created_at);
    if (dk !== lastDay) {
      list.append(el('div', { class: 'day-sep', text: dayLabel(m.created_at) }));
      lastDay = dk; lastUser = ''; lastTs = 0;
    }
    if (m.kind === 'system') {
      list.append(el('div', { class: 'sys-msg', text: m.body }));
      lastUser = ''; lastTs = 0;
      return;
    }
    const mine = m.user_id === (S.me && S.me.id);
    const grouped = m.user_id === lastUser && m.created_at - lastTs < 5 * 60e3 && !m.pending;
    lastUser = m.user_id; lastTs = m.created_at;
    const node = el('div', { class: 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (m.pending ? ' pending' : '') });
    node.append(el('div', { class: 'av-col' }, avatarNode({ id: m.user_id, nickname: m.nickname, avatar: m.avatar }, 'av-32')));
    const canDel = !m.deleted && !m.pending && (mine || RANK[myRole()] >= 2);
    const body = el('div', { class: 'msg-body' },
      el('div', { class: 'msg-who' },
        el('span', { class: 'b', text: m.nickname || '?' }),
        el('span', { text: hhmm(m.created_at) }),
        mine && m.pending ? el('span', { text: '· 发送中' }) : null));
    const bubble = el('div', { class: 'bubble' + (m.deleted ? ' deleted' : '') });
    if (m.deleted) bubble.textContent = '消息已撤回';
    else bubble.textContent = m.body;
    body.append(bubble);
    if (canDel) {
      body.append(el('div', { class: 'msg-tools' },
        el('button', { text: '撤回', on: { click: () => delMessage(m.id) } })));
    }
    node.append(body);
    list.append(node);
  });
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
  else scroller.scrollTop = prevTop + (scroller.scrollHeight - prevH);
}
async function delMessage(id) {
  if (typeof id === 'string' && id.startsWith('tmp')) return;
  if (!(await confirmBox('撤回这条消息？', '撤回后房间里所有人都会看到「消息已撤回」。', false, '撤回'))) return;
  try {
    await api('/api/messages/' + id, { method: 'DELETE' });
  } catch (e) { toast(e.message, true); }
}

/* ==================== 发送 ==================== */
function autoGrow() {
  const t = $('#composer-input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 132) + 'px';
}
function sendMessage() {
  const input = $('#composer-input');
  const text = input.value.trim();
  const r = curRoom();
  if (!text || !r || !S.wsOk) { if (!S.wsOk) toast('正在重新连接，稍等一下', true); return; }
  const cid = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
  const tmp = {
    id: 'tmp' + cid, client_id: cid, room_id: r.id, user_id: S.me.id, kind: 'text',
    body: text, created_at: Date.now(), nickname: S.me.nickname, avatar: S.me.avatar, pending: true,
  };
  S.msgs[r.id] = S.msgs[r.id] || [];
  S.msgs[r.id].push(tmp);
  S.pending[cid] = { roomId: r.id, body: text, at: Date.now() };
  input.value = '';
  autoGrow();
  renderMessages();
  S.ws.send(JSON.stringify({ type: 'send', room_id: r.id, body: text, client_id: cid }));
  setTimeout(() => {   // WS 没回音就退回 REST
    if (!S.pending[cid]) return;
    api(`/api/rooms/${r.id}/messages`, { method: 'POST', body: { body: text, client_id: cid } })
      .catch(e => { toast(e.message, true); dropPending(cid); });
  }, 2500);
}
function dropPending(cid) {
  for (const rid in S.msgs) {
    const i = S.msgs[rid].findIndex(m => m.client_id === cid);
    if (i >= 0) S.msgs[rid].splice(i, 1);
  }
  delete S.pending[cid];
  if (S.roomId) renderMessages();
}

/* ==================== 实时通道 ==================== */
function connectWS() {
  if (!S.token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try { ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(S.token)}`); }
  catch (e) { return setTimeout(connectWS, 2000); }
  S.ws = ws;
  ws.onopen = () => { S.wsOk = true; S.retry = 0; setConn('ok', '已连接'); };
  ws.onmessage = ev => { try { handleEvent(JSON.parse(ev.data)); } catch (e) { console.warn(e); } };
  ws.onclose = ev => {
    S.wsOk = false;
    setConn('bad', '连接断开，重连中…');
    if (ev && ev.code === 4401) { localStorage.removeItem('pc_token'); location.reload(); return; }
    const wait = Math.min(1000 * Math.pow(1.7, S.retry++), 15000);
    setTimeout(connectWS, wait);
  };
  ws.onerror = () => {};
}
function sendWS(obj) { if (S.ws && S.wsOk) { try { S.ws.send(JSON.stringify(obj)); } catch (e) {} } }

function handleEvent(ev) {
  switch (ev.type) {
    case 'hello':
      S.me = ev.user; S.rooms = ev.rooms;
      renderMe(); renderRooms(); renderChatHead(); renderComposerState();
      if (!S.roomId && S.rooms.length) selectRoom(S.rooms[0].id);
      break;
    case 'message': {
      const rid = ev.room_id, m = ev.message;
      S.msgs[rid] = S.msgs[rid] || [];
      if (m.client_id && S.pending[m.client_id]) delete S.pending[m.client_id];
      const idx = S.msgs[rid].findIndex(x => x.id === m.id || (m.client_id && x.client_id === m.client_id));
      delete m.client_id;
      if (idx >= 0) S.msgs[rid][idx] = m;
      else S.msgs[rid].push(m);
      const ri = S.rooms.findIndex(r => r.id === rid);
      if (ri >= 0 && m.kind === 'text') {
        S.rooms[ri].last_message = { body: m.body.slice(0, 80), kind: m.kind, nickname: m.nickname, created_at: m.created_at };
        const [r] = S.rooms.splice(ri, 1);
        S.rooms.unshift(r);
      }
      renderRooms();
      if (rid === S.roomId) { renderMessages(); }
      else if (!m.kind.startsWith('system') && m.user_id !== S.me.id) {
        const r = S.rooms.find(x => x.id === rid);
        toast(`💬 ${m.nickname}${r ? ' · ' + r.name : ''}：${m.body.slice(0, 40)}`);
      }
      break;
    }
    case 'message_deleted': {
      const arr = S.msgs[ev.room_id] || [];
      const i = arr.findIndex(m => m.id === ev.message_id);
      if (i >= 0) { arr[i].deleted = true; arr[i].body = ''; }
      if (ev.room_id === S.roomId) renderMessages();
      break;
    }
    case 'members': {
      S.members[ev.room_id] = ev.members;
      const ri = S.rooms.findIndex(r => r.id === ev.room_id);
      if (ri >= 0) S.rooms[ri].member_count = ev.members.length;
      if (ev.room_id === S.roomId) { renderChatHead(); renderComposerState(); renderMessages(); }
      renderRooms();
      if (S.panelTab && $('#view-app').classList.contains('panel-open')) renderPanel();
      break;
    }
    case 'presence': {
      const arr = S.members[ev.room_id] || [];
      const m = arr.find(x => x.id === ev.user_id);
      if (m) m.online = ev.online;
      if (ev.room_id === S.roomId) { renderChatHead(); if ($('#view-app').classList.contains('panel-open')) renderPanel(); }
      break;
    }
    case 'member_updated': {
      Object.values(S.members).forEach(arr => {
        const m = arr.find(x => x.id === ev.user.id);
        if (m) { m.nickname = ev.user.nickname; m.avatar = ev.user.avatar; m.bio = ev.user.bio; }
      });
      Object.values(S.msgs).forEach(arr => arr.forEach(m => {
        if (m.user_id === ev.user.id) { m.nickname = ev.user.nickname; m.avatar = ev.user.avatar; }
      }));
      if (ev.user.id === (S.me && S.me.id)) S.me = ev.user;
      renderMe(); renderMessages(); renderRooms();
      if ($('#view-app').classList.contains('panel-open')) renderPanel();
      break;
    }
    case 'room': {
      const ri = S.rooms.findIndex(r => r.id === ev.room.id);
      if (ri >= 0) S.rooms[ri] = Object.assign(S.rooms[ri], ev.room);
      else if (ev.room.role) S.rooms.unshift(ev.room);
      renderRooms(); renderChatHead();
      if ($('#view-app').classList.contains('panel-open')) renderPanel();
      break;
    }
    case 'muted': {
      const arr = S.members[ev.room_id] || [];
      const m = arr.find(x => x.id === S.me.id);
      if (m) m.muted_until = ev.muted_until;
      else if (S.roomId === ev.room_id) S.mutedSelf = ev.muted_until;
      if (ev.room_id === S.roomId) { renderComposerState(); }
      toast(ev.muted_until ? '你被禁言了：' + (mutedText(ev.muted_until) || '已生效') : '你的禁言已解除');
      break;
    }
    case 'typing':
      if (ev.room_id === S.roomId && ev.user_id !== S.me.id) showTyping(ev.nickname);
      break;
    case 'removed': {
      const r = S.rooms.find(x => x.id === ev.room_id);
      const name = ev.room_name || (r && r.name) || '房间';
      toast(ev.reason === 'dissolved' ? `房间「${name}」已被房主解散` : `你已被移出「${name}」`, true);
      dropRoom(ev.room_id);
      break;
    }
    case 'error':
      if (ev.client_id) dropPending(ev.client_id);
      toast(ev.detail || '发送失败', true);
      break;
  }
}
function dropRoom(id) {
  S.rooms = S.rooms.filter(r => r.id !== id);
  delete S.msgs[id]; delete S.members[id]; delete S.hasMore[id];
  if (S.roomId === id) {
    S.roomId = null;
    const next = S.rooms[0];
    if (next) selectRoom(next.id); else { renderRooms(); clearChat(); }
  }
  renderRooms();
}

/* ==================== 输入区状态 ==================== */
function renderComposerState() {
  const r = curRoom();
  const bar = $('#mute-bar');
  const input = $('#composer-input');
  const btn = $('#btn-send');
  if (!r) { bar.classList.add('hidden'); return; }
  const m = myMember(r.id);
  const until = m ? m.muted_until : S.mutedSelf;
  const txt = mutedText(until);
  if (txt) {
    bar.classList.remove('hidden');
    bar.textContent = `🔇 ${txt} —— 你现在只能看，不能发言`;
    input.disabled = true; input.placeholder = '禁言中…';
    btn.disabled = true;
  } else {
    bar.classList.add('hidden');
    input.disabled = false; input.placeholder = '说点什么…';
    btn.disabled = false;
  }
  if (r.locked && RANK[myRole(r.id)] >= 2) {
    bar.classList.remove('hidden');
    bar.textContent = '🔒 房间已锁定：现有邀请全部失效，也无法生成新邀请';
  }
}

/* ==================== 右侧面板 ==================== */
function openPanel(tab) {
  S.panelTab = tab || S.panelTab;
  $('#view-app').classList.add('panel-open');
  $('#panel').classList.remove('hidden');
  requestAnimationFrame(() => $('#panel').classList.add('open'));
  renderPanel();
}
function closePanel() {
  $('#panel').classList.remove('open');
  $('#view-app').classList.remove('panel-open');
  setTimeout(() => $('#panel').classList.add('hidden'), 220);
}
function openInviteTab() {
  if (!curRoom()) return toast('先选一个房间', true);
  openPanel('invite');
}
function renderPanel() {
  const r = curRoom();
  if (!r) return;
  document.querySelectorAll('#panel-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === S.panelTab));
  const body = $('#panel-body');
  body.innerHTML = '';
  if (S.panelTab === 'members') renderMembersTab(body, r);
  else if (S.panelTab === 'invite') renderInviteTab(body, r);
  else renderRoomTab(body, r);
}
function renderMembersTab(box, r) {
  const ms = S.members[r.id] || [];
  const role = myRole(r.id);
  box.append(el('div', { class: 'sec' },
    el('h3', {}, el('span', { text: `成员 · ${ms.length} 人` }),
      RANK[role] >= 2 ? el('button', { class: 'link-btn', text: '＋ 邀请', on: { click: () => { S.panelTab = 'invite'; renderPanel(); } } }) : null),
    ...ms.slice().sort((a, b) => RANK[b.role] - RANK[a.role] || (b.online ? 1 : 0) - (a.online ? 1 : 0))
      .map(m => {
        const isMe = m.id === S.me.id;
        const badge = ROLE_LABEL[m.role];
        const muted = mutedText(m.muted_until);
        const row = el('div', { class: 'member-row' },
          onlineNode(m, 'av-36', m.online),
          el('div', { class: 'mi' },
            el('div', { class: 'mi-name' }, m.nickname, isMe ? el('span', { class: 'muted-txt', text: '（我）' }) : null,
              badge ? el('span', { class: 'badge ' + m.role, text: badge }) : null,
              muted ? el('span', { class: 'badge muted', text: '禁言中' }) : null,
              !m.online ? el('span', { class: 'badge off', text: '离线' }) : null),
            el('div', { class: 'mi-bio', text: m.bio || (muted ? muted : '') || '　' })),
          (canModerate(m) || role === 'owner') && !isMe
            ? el('button', { class: 'icon-btn', text: '⋯', title: '管理', on: { click: () => memberSheet(m) } })
            : null);
        return row;
      })));
}
function memberSheet(m) {
  const r = curRoom();
  const role = myRole(r.id);
  const rows = [];
  const act = (label, sub, fn, danger) => el('button', {
    class: 'action-row' + (danger ? ' dangerous' : ''),
    on: { click: async () => { closeModal(); try { await fn(); } catch (e) { toast(e.message, true); } } },
  }, avatarNode(m, 'av-32'), el('span', { class: 'ar-txt' }, el('b', { text: label }), sub ? el('small', { text: sub }) : null));

  if (role === 'owner') {
    if (m.role === 'member') rows.push(act('设为管理员', '可以禁言、踢人、删消息、发邀请', () => api(`/api/rooms/${r.id}/members/${m.id}/role`, { method: 'POST', body: { role: 'admin' } }).then(() => toast('已设为管理员'))));
    if (m.role === 'admin') rows.push(act('取消管理员', '降为普通成员', () => api(`/api/rooms/${r.id}/members/${m.id}/role`, { method: 'POST', body: { role: 'member' } }).then(() => toast('已取消管理员'))));
    rows.push(act('转让房主', '他会成为新房主，你变成管理员', async () => {
      if (await confirmBox('转让房主？', `转让后「${m.nickname}」拥有全部管理权限，你会变成管理员。`, true, '确认转让'))
        await api(`/api/rooms/${r.id}/transfer`, { method: 'POST', body: { user_id: m.id } }).then(() => toast('已转让房主'));
    }, true));
  }
  if (canModerate(m)) {
    if (mutedText(m.muted_until)) {
      rows.push(act('解除禁言', '让他重新发言', () => api(`/api/rooms/${r.id}/members/${m.id}/unmute`, { method: 'POST', body: {} }).then(() => toast('已解除禁言'))));
    } else {
      const opts = [[1, '1 分钟'], [10, '10 分钟'], [60, '1 小时'], [1440, '1 天'], [0, '永久']];
      rows.push(el('div', { class: 'sec' },
        el('h3', {}, el('span', { text: '禁言' })),
        el('div', { class: 'seg' }, ...opts.map(([min, label]) => el('button', {
          class: 'chip', text: label,
          on: {
            click: async () => {
              try { await api(`/api/rooms/${r.id}/members/${m.id}/mute`, { method: 'POST', body: { minutes: min } }); toast(`已禁言 ${label}`); closeModal(); }
              catch (e) { toast(e.message, true); }
            },
          },
        })))));
    }
    rows.push(act('移出房间', '他可以再次用邀请链接进来', async () => {
      if (await confirmBox('移出房间？', `把「${m.nickname}」移出房间，他之后还能用邀请链接回来。`, true, '移出'))
        await api(`/api/rooms/${r.id}/members/${m.id}/kick`, { method: 'POST', body: { ban: false } }).then(() => toast('已移出'));
    }, true));
    rows.push(act('移出并拉黑', '他不能再进来（除非换新身份）', async () => {
      if (await confirmBox('移出并拉黑？', `「${m.nickname}」会被移出且不能再加入。注意：拉黑只认他当前这台设备上的身份；如果手里还有效的邀请链接，他仍可能换个新身份进来——必要时请到「邀请」里撤销链接。`, true, '拉黑'))
        await api(`/api/rooms/${r.id}/members/${m.id}/kick`, { method: 'POST', body: { ban: true } }).then(() => toast('已拉黑'));
    }, true));
  }
  if (!rows.length) rows.push(el('p', { class: 'muted-txt', text: '你是管理员，但对方权限不低于你，不能对他操作。' }));
  openModal(`${m.nickname} · ${ROLE_LABEL[m.role] || '成员'}`, rows);
}
const DUR = [[0, '永久有效'], [60, '1 小时'], [1440, '1 天'], [10080, '7 天']];
function renderInviteTab(box, r) {
  const role = myRole(r.id);
  if (RANK[role] < 2) {
    box.append(el('p', { class: 'muted-txt', text: '只有房主和管理员能发邀请。' }));
    return;
  }
  const note = el('input', { attrs: { placeholder: '备注（给谁用，可留空）', maxlength: '30' } });
  const uses = el('input', { attrs: { placeholder: '可用次数（留空 = 不限）', type: 'number', min: '1' } });
  let dur = 0;
  const seg = el('div', { class: 'seg' }, ...DUR.map(([v, label]) => el('button', {
    class: 'chip' + (v === 0 ? ' on' : ''), text: label,
    on: { click: ev => { dur = v; [...seg.children].forEach(c => c.classList.remove('on')); ev.currentTarget.classList.add('on'); } },
  })));
  const gen = el('button', {
    class: 'btn primary wide', text: '生成邀请链接 / 二维码',
    on: {
      click: async () => {
        try {
          await api(`/api/rooms/${r.id}/invites`, {
            method: 'POST',
            body: { note: note.value.trim(), expires_in_minutes: dur || null, max_uses: uses.value ? parseInt(uses.value, 10) : null },
          });
          toast('邀请已生成');
          renderPanel();
        } catch (e) { toast(e.message, true); }
      },
    },
  });
  box.append(el('div', { class: 'sec' },
    el('h3', {}, el('span', { text: '生成新邀请' })),
    el('div', { class: 'field' }, el('span', { text: '有效期' }), seg),
    el('div', { class: 'two-col' }, note, uses),
    gen));
  if (r.locked) box.append(el('div', { class: 'warn-note', text: '房间现在是锁定状态，所有邀请都失效了，也生成不了新的。到「房间」标签页解锁即可。' }));

  api(`/api/rooms/${r.id}/invites`).then(d => {
    const sec = el('div', { class: 'sec' }, el('h3', {},
      el('span', { text: `已有邀请 · ${d.invites.length} 条` }),
      d.invites.some(i => i.valid) ? el('button', {
        class: 'link-btn', text: '全部撤销',
        on: {
          click: async () => {
            if (!(await confirmBox('撤销全部邀请？', '所有还没被用掉的邀请链接都会失效。', true, '全部撤销'))) return;
            await api(`/api/rooms/${r.id}/invites/revoke-all`, { method: 'POST' }).then(() => { toast('已全部撤销'); renderPanel(); });
          },
        },
      }) : null));
    if (!d.invites.length) sec.append(el('p', { class: 'muted-txt', text: '还没有邀请链接。' }));
    d.invites.forEach(inv => {
      const row = el('div', { class: 'invite-row' + (inv.valid ? '' : ' dead') });
      const state = inv.revoked ? '已撤销' : (!inv.valid ? inv.reason : '有效');
      row.append(el('div', { class: 'ir-top' },
        el('span', { text: inv.note || '邀请链接' }),
        el('span', { class: 'ir-state ' + (inv.valid ? 'ok' : 'no'), text: state })));
      row.append(el('div', { class: 'ir-link', text: inv.url }));
      row.append(el('div', {},
        el('span', { class: 'muted-txt', text: `已用 ${inv.uses}${inv.max_uses ? '/' + inv.max_uses : ''} 次` })));
      const acts = el('div', { class: 'ir-acts', style: { marginTop: '8px' } },
        el('button', { class: 'btn soft sm', text: '复制链接', on: { click: () => copy(inv.url) } }),
        el('button', { class: 'btn soft sm', text: '二维码', on: { click: () => showQR(inv) } }),
        inv.valid ? el('button', {
          class: 'btn ghost sm', text: '撤销',
          on: { click: () => api(`/api/invites/${inv.token}/revoke`, { method: 'POST' }).then(() => { toast('已撤销'); renderPanel(); }) },
        }) : null);
      row.append(acts);
      sec.append(row);
    });
    box.append(sec);
  }).catch(e => toast(e.message, true));
}
async function showQR(inv) {
  const r = curRoom();
  const box = el('div', { class: 'qr-box', text: '生成中…' });
  const link = el('div', { class: 'ir-link', text: inv.url });
  const share = el('button', {
    class: 'btn soft wide', text: '复制链接',
    on: { click: () => copy(inv.url) },
  });
  const card = openModal('扫码进房间', [
    el('p', { class: 'muted-txt', text: '让对方用手机相机 / 微信扫这个码，打开就能加入。' }),
    box, link, share,
    el('div', { class: 'warn-note', text: '手机要和这台电脑连同一个 Wi-Fi。如果扫码后打不开，请确认页面地址用的是局域网 IP（启动时终端会打印出来），而不是 127.0.0.1。' }),
  ], [el('button', { class: 'btn ghost', text: '关闭', on: { click: closeModal } })]);
  try {
    const res = await fetch(`/api/rooms/${r.id}/qr.svg?token=${encodeURIComponent(inv.token)}`, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!res.ok) throw new Error('二维码生成失败');
    box.innerHTML = await res.text();
  } catch (e) { box.textContent = e.message; }
  return card;
}
function renderRoomTab(box, r) {
  const role = myRole(r.id);
  const owner = role === 'owner';
  const ms = S.members[r.id] || [];
  const created = ms.find(m => m.role === 'owner');

  box.append(el('div', { class: 'sec' },
    el('h3', {}, el('span', { text: '房间信息' })),
    el('div', { class: 'member-row', style: { background: 'var(--card)', border: '1px solid var(--line)' } },
      coverNode(r, 'av-36'),
      el('div', { class: 'mi' },
        el('div', { class: 'mi-name', text: r.name, r.locked ? el('span', { text: '🔒' }) : null),
        el('div', { class: 'mi-bio', text: r.description || '没写简介' })),
      el('span', { class: 'muted-txt', text: r.member_count + ' 人' })),
    el('p', { class: 'muted-txt', style: { marginTop: '9px' }, text: `房主：${created ? created.nickname : '—'} · 创建于 ${dayLabel(r.created_at)}` })));

  if (owner) {
    const name = el('input', { attrs: { value: r.name, maxlength: '40' } });
    const desc = el('textarea', { attrs: { rows: '2', maxlength: '300' } });
    desc.value = r.description || '';
    box.append(el('div', { class: 'sec' },
      el('h3', {}, el('span', { text: '房主设置' })),
      el('div', { class: 'field' }, el('span', { text: '房间名' }), name),
      el('div', { class: 'field' }, el('span', { text: '简介' }), desc),
      el('button', {
        class: 'btn primary wide', text: '保存房间信息',
        on: {
          click: async () => {
            try { await api('/api/rooms/' + r.id, { method: 'PATCH', body: { name: name.value, description: desc.value } }); toast('已保存'); }
            catch (e) { toast(e.message, true); }
          },
        },
      }),
      el('div', { class: 'switch-row' },
        el('div', {}, el('div', { text: '锁定房间' }), el('div', { class: 'muted-txt', text: '锁定后所有邀请立即失效' })),
        el('div', {
          class: 'switch' + (r.locked ? ' on' : ''),
          on: {
            click: async ev => {
              const on = !ev.currentTarget.classList.contains('on');
              try { await api('/api/rooms/' + r.id, { method: 'PATCH', body: { locked: on } }); toast(on ? '已锁定' : '已解锁'); }
              catch (e) { toast(e.message, true); }
            },
          },
        }))));

    const qrQuick = el('button', { class: 'btn soft wide', text: '🔗 生成邀请 / 二维码', on: { click: () => { S.panelTab = 'invite'; renderPanel(); } } });
    box.append(el('div', { class: 'sec' },
      el('h3', {}, el('span', { text: '邀请' })),
      qrQuick,
      el('p', { class: 'muted-txt', style: { marginTop: '8px' }, text: '房主密钥只在创建房间时显示一次。它能帮你在这台设备之外找回房主身份，请当时就保存好。' })));

    api(`/api/rooms/${r.id}/banned`).then(d => {
      if (!d.banned.length) return;
      const sec = el('div', { class: 'sec' }, el('h3', {}, el('span', { text: `黑名单 · ${d.banned.length} 人` })));
      d.banned.forEach(b => sec.append(el('div', { class: 'banned-row' },
        avatarNode(b, 'av-26'), el('span', { text: b.nickname }), el('span', { style: { flex: '1' } }),
        el('button', {
          class: 'btn soft sm', text: '解除',
          on: { click: () => api(`/api/rooms/${r.id}/members/${b.id}/unban`, { method: 'POST' }).then(() => { toast('已解除'); renderPanel(); }) },
        }))));
      box.append(sec);
    }).catch(() => {});
  }

  box.append(el('div', { class: 'list-sep' }));
  box.append(el('div', { class: 'sec' },
    el('h3', {}, el('span', { text: '我的身份' })),
    el('div', { class: 'member-row' },
      avatarNode(S.me, 'av-36'),
      el('div', { class: 'mi' },
        el('div', { class: 'mi-name', text: S.me.nickname, el('span', { class: 'badge ' + (role || 'member'), text: ROLE_LABEL[role] || '成员' }) }),
        el('div', { class: 'mi-bio', text: S.me.bio || '　' })),
      el('button', { class: 'btn soft sm', text: '改资料', on: { click: profileModal } }))));

  box.append(el('div', { class: 'sec' },
    owner
      ? el('button', {
        class: 'btn danger wide', text: '解散房间',
        on: {
          click: async () => {
            if (!(await confirmBox('解散房间？', `「${r.name}」的所有消息、成员、邀请都会被永久删除，无法恢复。`, true, '永久解散'))) return;
            try { await api('/api/rooms/' + r.id, { method: 'DELETE' }); dropRoom(r.id); closePanel(); toast('房间已解散'); }
            catch (e) { toast(e.message, true); }
          },
        },
      })
      : el('button', {
        class: 'btn danger wide', text: '退出房间',
        on: {
          click: async () => {
            if (!(await confirmBox('退出房间？', `退出后你会回到没有「${r.name}」的状态，需要新邀请才能再进来。`, true, '退出'))) return;
            try { await api(`/api/rooms/${r.id}/leave`, { method: 'POST' }); dropRoom(r.id); closePanel(); toast('已退出房间'); }
            catch (e) { toast(e.message, true); }
          },
        },
      })));
}

/* ==================== 资料 / 建房间 / 加入 ==================== */
function profileModal() {
  let avatar = S.me.avatar || '';
  const nick = el('input', { attrs: { value: S.me.nickname, maxlength: '24' } });
  const bio = el('input', { attrs: { value: S.me.bio || '', maxlength: '80', placeholder: '一句话介绍自己' } });
  const slot = el('div', {});
  const picker = avatarPicker(avatar, v => { avatar = v; });
  slot.append(picker);
  const save = el('button', {
    class: 'btn primary', text: '保存',
    on: {
      click: async () => {
        try {
          const d = await api('/api/me', { method: 'PATCH', body: { nickname: nick.value, bio: bio.value, avatar } });
          S.me = d.user; renderMe(); closeModal(); toast('资料已更新');
        } catch (e) { toast(e.message, true); }
      },
    },
  });
  openModal('我的资料', [
    el('div', { class: 'field' }, el('span', { text: '头像' }), slot),
    el('div', { class: 'field' }, el('span', { text: '昵称' }), nick),
    el('div', { class: 'field' }, el('span', { text: '一句话介绍' }), bio),
  ], [el('button', { class: 'btn ghost', text: '取消', on: { click: closeModal } }), save]);
}
function createRoomModal() {
  const name = el('input', { attrs: { placeholder: '比如：周末爬山群', maxlength: '40' } });
  const desc = el('input', { attrs: { placeholder: '这个房间是干嘛的（可留空）', maxlength: '300' } });
  let cover = '';
  const coverSlot = el('div', { class: 'picker-slot' });
  const drawCover = () => {
    coverSlot.innerHTML = '';
    coverSlot.append(emojiGrid(e => { cover = e; drawCover(); }, cover));
  };
  drawCover();
  let avatar = (S.me && S.me.avatar) || '';
  const nick = el('input', { attrs: { value: (S.me && S.me.nickname) || '', placeholder: '你在房间里的名字', maxlength: '24' } });
  const bio = el('input', { attrs: { value: (S.me && S.me.bio) || '', placeholder: '一句话介绍（可留空）', maxlength: '80' } });
  const avSlot = el('div', {});
  avSlot.append(avatarPicker(avatar, v => { avatar = v; }));
  const create = el('button', {
    class: 'btn primary', text: '创建房间',
    on: {
      click: async () => {
        if (!name.value.trim()) return toast('房间名不能为空', true);
        if (!nick.value.trim()) return toast('先给自己起个昵称', true);
        create.disabled = true;
        try {
          const d = await api('/api/rooms', {
            method: 'POST',
            token: '',
            body: { name: name.value, description: desc.value, cover, nickname: nick.value, avatar, bio: bio.value },
          });
          S.token = d.session; localStorage.setItem('pc_token', d.session);
          S.me = d.user;
          const me = await api('/api/me');
          S.rooms = me.rooms;
          closeModal();
          enterApp();
          selectRoom(d.room.id);
          showRecoveryKey(d.room, d.recovery_key);
        } catch (e) { toast(e.message, true); create.disabled = false; }
      },
    },
  });
  openModal('创建我的房间', [
    el('div', { class: 'field' }, el('span', { text: '房间名' }), name),
    el('div', { class: 'field' }, el('span', { text: '一句话简介' }), desc),
    el('div', { class: 'field' }, el('span', { text: '封面（选个 emoji）' }), coverSlot),
    el('div', { class: 'list-sep' }),
    el('div', { class: 'field' }, el('span', { text: '我的头像' }), avSlot),
    el('div', { class: 'field' }, el('span', { text: '我的昵称' }), nick),
    el('div', { class: 'field' }, el('span', { text: '一句话介绍' }), bio),
  ], [el('button', { class: 'btn ghost', text: '取消', on: { click: closeModal } }), create]);
  setTimeout(() => name.focus(), 60);
}
function showRecoveryKey(room, key) {
  openModal('房间建好了 🎉', [
    el('p', { class: 'muted-txt', text: `「${room.name}」已经创建，你是房主。` }),
    el('div', { class: 'warn-note', text: '下面这串「房主密钥」只显示这一次。万一换了设备 / 清了浏览器数据，用它就能找回房主身份。建议复制保存到备忘录。' }),
    el('div', { class: 'key-box', text: key }),
    el('div', { class: 'sec' },
      el('h3', {}, el('span', { text: '下一步' })),
      el('button', { class: 'btn primary wide', text: '🔗 邀请朋友进来', on: { click: () => { closeModal(); openInviteTab(); } } })),
  ], [
    el('button', { class: 'btn soft', text: '复制密钥', on: { click: () => copy(key) } }),
    el('button', { class: 'btn ghost', text: '我知道了', on: { click: closeModal } }),
  ]);
}
function joinByLinkModal() {
  const inp = el('input', { attrs: { placeholder: '把邀请链接或邀请码粘到这里' } });
  const go = el('button', {
    class: 'btn primary', text: '进入',
    on: {
      click: () => {
        const t = tokenFromInput(inp.value);
        if (!t) return toast('这看起来不是一条有效的邀请链接', true);
        closeModal();
        location.hash = '#/join/' + t;
        showJoin(t);
      },
    },
  });
  openModal('加入一个房间', [
    el('p', { class: 'muted-txt', text: '邀请机制：只有拿到链接或二维码的人才能进来，没有开放注册。' }),
    el('div', { class: 'field' }, el('span', { text: '邀请链接' }), inp),
  ], [el('button', { class: 'btn ghost', text: '取消', on: { click: closeModal } }), go]);
  setTimeout(() => inp.focus(), 60);
}
function recoverModal() {
  const rid = el('input', { attrs: { placeholder: '房间 ID（邀请链接里那一串也可以）' } });
  const key = el('input', { attrs: { placeholder: '房主密钥' } });
  const go = el('button', {
    class: 'btn primary', text: '找回房主身份',
    on: {
      click: async () => {
        const roomId = tokenFromInput(rid.value) || rid.value.trim();
        try {
          const d = await api('/api/recover', { method: 'POST', token: '', body: { room_id: roomId, recovery_key: key.value } });
          S.token = d.session; localStorage.setItem('pc_token', d.session); S.me = d.user;
          const me = await api('/api/me'); S.rooms = me.rooms;
          closeModal(); enterApp(); toast('已找回身份');
        } catch (e) { toast(e.message, true); }
      },
    },
  });
  openModal('用房主密钥找回身份', [
    el('p', { class: 'muted-txt', text: '密钥在创建房间时显示过一次，只能用它找回「创建房间的那个人」的身份。' }),
    el('div', { class: 'field' }, el('span', { text: '房间 ID' }), rid),
    el('div', { class: 'field' }, el('span', { text: '房主密钥' }), key),
  ], [el('button', { class: 'btn ghost', text: '取消', on: { click: closeModal } }), go]);
}

/* ==================== 表情面板（输入框用） ==================== */
function buildEmojiPop() {
  const pop = $('#emoji-pop');
  pop.innerHTML = '';
  EMOJI_CATS.forEach(([name, list]) => {
    pop.append(el('div', { class: 'cat', text: name }));
    const g = el('div', { class: 'grid' });
    list.forEach(e => g.append(el('button', { class: 'emoji-btn', text: e, on: { click: () => insertAtCursor(e) } })));
    pop.append(g);
  });
}
function insertAtCursor(text) {
  const t = $('#composer-input');
  const start = t.selectionStart == null ? t.value.length : t.selectionStart;
  const end = t.selectionEnd == null ? t.value.length : t.selectionEnd;
  t.value = t.value.slice(0, start) + text + t.value.slice(end);
  const pos = start + text.length;
  t.focus();
  try { t.setSelectionRange(pos, pos); } catch (e) {}
  autoGrow();
}
function copy(text) {
  const done = () => toast('已复制');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = el('textarea', { style: { position: 'fixed', top: '-1000px' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中', true); }
  ta.remove();
}

/* ==================== 事件绑定 ==================== */
function wire() {
  $('#go-create').onclick = createRoomModal;
  $('#go-join').onclick = joinByLinkModal;
  $('#side-create').onclick = createRoomModal;
  $('#side-join').onclick = joinByLinkModal;
  $('#edit-profile').onclick = profileModal;
  $('#panel-close').onclick = closePanel;
  $('#btn-panel').onclick = () => { if (!curRoom()) return toast('先选一个房间', true); openPanel('members'); };
  $('#btn-invite').onclick = openInviteTab;
  $('#btn-back').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('on'); };
  $('#scrim').onclick = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('on'); };
  $('#logout').onclick = async () => {
    if (!(await confirmBox('退出登录？', '只是清掉这台设备的登录状态。房间还在，重新用邀请链接或房主密钥就能回来。', true, '退出'))) return;
    api('/api/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('pc_token'); localStorage.removeItem('pc_room');
    S.token = ''; S.me = null; S.rooms = []; S.roomId = null; S.msgs = {}; S.members = {};
    if (S.ws) { try { S.ws.close(); } catch (e) {} }
    show('view-landing');
  };
  document.querySelectorAll('#panel-tabs .tab').forEach(t => {
    t.onclick = () => { S.panelTab = t.dataset.tab; renderPanel(); };
  });
  $('#btn-send').onclick = sendMessage;
  const inp = $('#composer-input');
  inp.addEventListener('input', () => { autoGrow(); maybeTyping(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  $('#btn-emoji').onclick = e => {
    e.stopPropagation();
    const p = $('#emoji-pop');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) p.scrollTop = 0;
  };
  document.addEventListener('click', e => {
    const p = $('#emoji-pop');
    if (!p.classList.contains('hidden') && !p.contains(e.target) && e.target.id !== 'btn-emoji') p.classList.add('hidden');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('#emoji-pop').classList.add('hidden'); } });
  window.addEventListener('hashchange', () => {
    const t = tokenFromUrl();
    if (t) showJoin(t);
  });
  $('#lightbox').onclick = () => $('#lightbox').classList.add('hidden');
  // 头像选择器只建一次
  buildJoinAvatarPicker();
  $('#join-submit').onclick = async () => {
    const nick = $('#join-nickname').value.trim();
    if (!nick) return toast('先给自己起个昵称', true);
    $('#join-submit').disabled = true;
    $('#join-error').classList.add('hidden');
    try {
      const d = await api('/api/join', {
        method: 'POST',
        body: { token: joinState.token, nickname: nick, bio: $('#join-bio').value, avatar: joinState.avatar },
      });
      S.token = d.session;
      localStorage.setItem('pc_token', d.session);
      S.me = d.user;
      const me = await api('/api/me');
      S.rooms = me.rooms;
      enterApp();
      selectRoom(d.room.id);
      toast(`欢迎来到「${d.room.name}」`);
    } catch (e) {
      const box = $('#join-error');
      box.textContent = e.message;
      box.classList.remove('hidden');
      $('#join-submit').disabled = false;
    }
  };
}
function maybeTyping() {
  const now = Date.now();
  if (now - S.lastTypingSent < 3500 || !S.roomId) return;
  S.lastTypingSent = now;
  sendWS({ type: 'typing', room_id: S.roomId });
}

boot();
