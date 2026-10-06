import { SPRITE, cardEl, SUIT_SYMBOL, SUIT_NAME, isRed, rankLabel } from './cards.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const tg = window.Telegram?.WebApp;
const inTg = !!tg?.initData;

document.getElementById('sprite').innerHTML = SPRITE;

const S = {
  me: null,
  room: null,
  game: null,
  queue: null,
  config: {},
  screen: 'home',
  history: [],
  lastSeq: 0,
  clockSkew: 0,
  pendingQueen: null,
  pile: [],
  prevHandIds: new Set(),
};

// ---------- Telegram ----------
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#0b3d2a'); tg.setBackgroundColor('#083524'); } catch {}
  try { tg.disableVerticalSwipes?.(); } catch {}
  tg.BackButton?.onClick(goBack);
}
const haptic = (type = 'light') => {
  try {
    if (type === 'success' || type === 'error' || type === 'warning') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch {}
};

fetch('config').then(r => r.json()).then(c => (S.config = c)).catch(() => {});

// ---------- гость (вне Telegram) ----------
function guest() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem('guest')); } catch {}
  if (!g?.id) {
    g = { id: Math.random().toString(36).slice(2, 12), name: 'Гость ' + Math.floor(1000 + Math.random() * 9000) };
    try { localStorage.setItem('guest', JSON.stringify(g)); } catch {}
  }
  return g;
}

// ---------- соединение ----------
let ws, retry = 0;
let startParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('room');

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`);
  ws.onopen = () => {
    retry = 0;
    $('#conn').classList.add('on');
    ws.send(JSON.stringify({ type: 'hello', initData: tg?.initData || '', guest: inTg ? null : guest(), startParam }));
    startParam = null;
  };
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    $('#conn').classList.remove('on');
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
const send = msg => (ws?.readyState === 1 ? ws.send(JSON.stringify(msg)) : toast('Нет соединения…'));
connect();

function onMessage(m) {
  switch (m.type) {
    case 'welcome': S.me = m.me; renderMe(); break;
    case 'error': toast(m.message); haptic('error'); break;
    case 'queue': onQueue(m); break;
    case 'room': onRoom(m.room); break;
    case 'game': onGame(m.game); break;
  }
}

// ---------- навигация ----------
function show(name, { push = true } = {}) {
  if (S.screen === name) return;
  if (push && S.screen && !['queue', 'game', 'room'].includes(S.screen)) S.history.push(S.screen);
  S.screen = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  const canBack = !['home', 'game', 'queue'].includes(name);
  if (tg?.BackButton) canBack ? tg.BackButton.show() : tg.BackButton.hide();
}
function goBack() {
  if (S.screen === 'room') return leaveRoom();
  if (S.screen === 'queue') return send({ type: 'queue_cancel' });
  show(S.history.pop() || 'home', { push: false });
}
function home() { S.history = []; show('home', { push: false }); }

$$('[data-go]').forEach(b => b.addEventListener('click', () => { haptic(); show(b.dataset.go); }));
$$('[data-back]').forEach(b => b.addEventListener('click', goBack));
$$('[data-modal]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.modal)));
$$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal').id.replace('modal-', ''))));
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && !['round', 'over'].includes(m.id.slice(6))) m.classList.remove('open'); }));

function openModal(id) { $('#modal-' + id).classList.add('open'); }
function closeModal(id) { $('#modal-' + id).classList.remove('open'); }

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function avatar(p, cls = 'avatar') {
  const el = document.createElement('span');
  el.className = cls;
  if (p?.photo) el.style.backgroundImage = `url("${encodeURI(p.photo)}")`;
  else el.textContent = p?.bot ? '🤖' : (p?.name || '?').trim()[0]?.toUpperCase() || '?';
  return el;
}

// ---------- главный экран ----------
function renderMe() {
  $('#me-name').textContent = S.me.name;
  $('#me-avatar').replaceWith(Object.assign(avatar(S.me), { id: 'me-avatar' }));
}
(function logoFan() {
  const fan = $('#logo-fan');
  [['A', 'spades'], ['K', 'hearts'], ['Q', 'clubs'], ['6', 'diamonds']].forEach(([rank, suit], i) => {
    const el = cardEl({ id: rank + suit, rank, suit });
    el.style.transform = `translateX(-50%) rotate(${(i - 1.5) * 14}deg)`;
    el.style.animationDelay = `${i * 0.12}s`;
    fan.appendChild(el);
  });
})();

// ---------- матчмейкинг ----------
$$('[data-queue]').forEach(b => b.addEventListener('click', () => { haptic('medium'); send({ type: 'queue', size: Number(b.dataset.queue) }); }));
$$('[data-practice]').forEach(b => b.addEventListener('click', () => { haptic('medium'); send({ type: 'practice', bots: Number(b.dataset.practice) }); }));
$('#queue-cancel').addEventListener('click', () => send({ type: 'queue_cancel' }));
$('#queue-bots').addEventListener('click', () => send({ type: 'queue_bots' }));

let queueTimer;
function onQueue(m) {
  clearInterval(queueTimer);
  if (!m.size) { leaveQueueUi(); if (S.screen === 'queue') show(S.history.pop() || 'home', { push: false }); return; }
  S.queue = m;
  show('queue');
  $('#queue-count').textContent = `${m.count} / ${m.size}`;
  S.queueStart ??= Date.now();
  const tick = () => {
    const sec = Math.max(0, Math.floor((Date.now() - S.queueStart) / 1000));
    $('#queue-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('#queue-bots').classList.toggle('hidden', sec < 10);
  };
  tick();
  queueTimer = setInterval(tick, 500);
}
function leaveQueueUi() { clearInterval(queueTimer); S.queue = null; S.queueStart = null; }

// ---------- комнаты ----------
$('#room-create').addEventListener('click', () => { haptic('medium'); send({ type: 'room_create' }); });
$('#join-form').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length !== 5) return toast('Код — 5 символов');
  send({ type: 'room_join', code });
});
$('#join-code').addEventListener('input', e => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
$('#room-leave').addEventListener('click', leaveRoom);
$('#room-add-bot').addEventListener('click', () => send({ type: 'room_add_bot' }));
$('#room-start').addEventListener('click', () => { haptic('heavy'); send({ type: 'room_start' }); });
$('#room-code').addEventListener('click', () => copy(S.room?.code));
$('#room-share').addEventListener('click', shareRoom);

function leaveRoom() { send({ type: 'room_leave' }); }

function inviteLink(code) {
  const { botUsername, appShortName } = S.config;
  if (botUsername && appShortName) return `https://t.me/${botUsername}/${appShortName}?startapp=${code}`;
  if (botUsername) return `https://t.me/${botUsername}?start=${code}`;
  return `${location.origin}${location.pathname}?room=${code}`;
}
function shareRoom() {
  const code = S.room?.code;
  if (!code) return;
  const link = inviteLink(code);
  const text = `Го в 101! Код стола: ${code}`;
  haptic();
  if (tg && inTg) return tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  if (navigator.share) return navigator.share({ title: '101', text, url: link }).catch(() => {});
  copy(link);
}
function copy(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => toast('Скопировано'), () => toast(text));
}

function onRoom(room) {
  const prev = S.room;
  S.room = room;
  leaveQueueUi();
  if (!room) {
    S.game = null; S.lastSeq = 0; S.pile = [];
    $$('.modal').forEach(m => m.classList.remove('open'));
    if (['room', 'game', 'queue'].includes(S.screen)) home();
    return;
  }
  if (room.inGame) { if (S.game) show('game'); return; }
  if (S.game?.phase === 'gameOver' && S.screen === 'game') { renderOver(); return; }
  if (!prev || prev.code !== room.code) S.history = ['home'];
  renderRoom();
  show('room');
}

function renderRoom() {
  const r = S.room;
  const isHost = r.hostId === S.me?.id;
  $('#room-code').textContent = r.code;
  const ul = $('#seats');
  ul.innerHTML = '';
  for (const s of r.seats) {
    const li = document.createElement('li');
    li.className = 'seat';
    li.appendChild(avatar(s));
    li.insertAdjacentHTML('beforeend', `<span class="name">${esc(s.name)}${s.id === S.me?.id ? ' (вы)' : ''}</span>`
      + (s.id === r.hostId ? '<span class="tag">👑 создатель</span>' : '')
      + (!s.online ? '<span class="off">не в сети</span>' : ''));
    if (s.bot && isHost) {
      const b = document.createElement('button');
      b.className = 'rm'; b.textContent = '✕';
      b.onclick = () => send({ type: 'room_remove_bot', id: s.id });
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  if (r.seats.length < 6) ul.insertAdjacentHTML('beforeend', '<li class="seat empty">Ждём друзей… (до 6 игроков)</li>');
  $('#room-start').classList.toggle('hidden', !isHost);
  $('#room-add-bot').classList.toggle('hidden', !isHost || r.seats.length >= 6);
  $('#room-start').disabled = r.seats.length < 2;
  $('#room-wait').classList.toggle('hidden', isHost);
}

// ---------- игра ----------
$('#btn-draw').addEventListener('click', drawCard);
$('#deck').addEventListener('click', drawCard);
$('#btn-pass').addEventListener('click', () => { haptic(); send({ type: 'pass' }); });
$('#game-menu').addEventListener('click', () => openModal('menu'));
$('#game-scores').addEventListener('click', () => { renderScores(); openModal('scores'); });
$('#game-leave').addEventListener('click', () => {
  const doLeave = ok => { if (ok) { closeModal('menu'); leaveRoom(); } };
  if (tg?.showConfirm && inTg) tg.showConfirm('Покинуть стол? Вы выбываете из партии.', doLeave);
  else doLeave(confirm('Покинуть стол? Вы выбываете из партии.'));
});
$('#over-again').addEventListener('click', () => { closeModal('over'); send({ type: 'rematch' }); });
$('#over-home').addEventListener('click', () => { closeModal('over'); leaveRoom(); });
$$('#modal-suit [data-suit]').forEach(b => b.addEventListener('click', () => {
  closeModal('suit');
  if (S.pendingQueen) { haptic('medium'); send({ type: 'play', cardId: S.pendingQueen, suit: b.dataset.suit }); }
  S.pendingQueen = null;
}));

function myTurn() { return S.game?.phase === 'playing' && S.game.turn === S.me?.id; }
function drawCard() {
  if (!myTurn() || S.game.hasDrawn) return;
  haptic();
  send({ type: 'draw' });
}
function canPlay(card) {
  const g = S.game;
  if (!myTurn()) return false;
  if (g.drawnCardId && card.id !== g.drawnCardId) return false;
  return card.rank === 'Q' || card.suit === g.suit || card.rank === g.top.rank;
}
function playCard(card) {
  if (!myTurn()) return toast('Сейчас не ваш ход');
  if (!canPlay(card)) { haptic('error'); return toast('Эту карту сюда нельзя'); }
  if (card.rank === 'Q') { S.pendingQueen = card.id; return openModal('suit'); }
  haptic('medium');
  send({ type: 'play', cardId: card.id });
}

const nameOf = id => S.game?.players.find(p => p.id === id)?.name || '?';
const seatOf = id => S.game?.seats?.find(s => s.id === id) || S.game?.players.find(p => p.id === id);
const cardText = c => `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;

function onGame(g) {
  const prev = S.game;
  S.clockSkew = g.now ? Date.now() - g.now : 0;
  // Запоминаем положение элементов до перерисовки — для анимаций
  const rects = captureRects();
  S.game = g;
  if (!prev || prev.round !== g.round) { S.pile = []; S.prevHandIds = new Set(); }
  if (!S.pile.length || S.pile[S.pile.length - 1].id !== g.top.id) {
    S.pile.push({ ...g.top, rot: (Math.random() - 0.5) * 24, dx: (Math.random() - 0.5) * 10 });
    if (S.pile.length > 4) S.pile.shift();
  }
  show('game');
  renderGame();
  const ev = g.lastEvent;
  if (ev && ev.seq !== S.lastSeq) {
    S.lastSeq = ev.seq;
    if (prev) animateEvent(ev, rects, prev);
  }
  if (g.phase === 'playing') { closeModal('round'); closeModal('over'); }
  if (g.phase === 'roundOver') renderRound();
  if (g.phase === 'gameOver') { closeModal('round'); renderOver(); }
}

function captureRects() {
  const r = { opp: {}, hand: {} };
  r.pile = $('#pile').getBoundingClientRect();
  r.deck = $('#deck').getBoundingClientRect();
  r.handBox = $('#hand').getBoundingClientRect();
  $$('#opponents .opp').forEach(el => (r.opp[el.dataset.id] = el.querySelector('.ava-wrap').getBoundingClientRect()));
  $$('#hand .card').forEach(el => (r.hand[el.dataset.id] = el.getBoundingClientRect()));
  return r;
}

function renderGame() {
  const g = S.game;
  $('#round-label').textContent = `Раунд ${g.round} · колода ${g.deckCount}`;

  // соперники — по кругу, начиная со следующего после меня
  const ps = g.players;
  const meIdx = Math.max(0, ps.findIndex(p => p.id === S.me?.id));
  const opps = [...ps.slice(meIdx + 1), ...ps.slice(0, meIdx)];
  const box = $('#opponents');
  box.innerHTML = '';
  for (const p of opps) {
    const seat = seatOf(p.id);
    const el = document.createElement('div');
    el.className = 'opp' + (p.id === g.turn && g.phase === 'playing' ? ' turn' : '') + (p.out ? ' out' : '');
    el.dataset.id = p.id;
    const wrap = document.createElement('div');
    wrap.className = 'ava-wrap';
    wrap.appendChild(avatar({ ...seat, name: p.name, bot: seat?.bot }));
    if (p.id === g.turn && g.phase === 'playing') wrap.insertAdjacentHTML('beforeend', '<svg class="ring" viewBox="0 0 62 62"><circle cx="31" cy="31" r="28" pathLength="100" stroke-dasharray="100 100"/></svg>');
    if (!p.out) wrap.insertAdjacentHTML('beforeend', `<span class="cnt">${p.cards}</span>`);
    if (seat && seat.online === false && !seat.bot) wrap.insertAdjacentHTML('beforeend', '<span class="off-badge" title="не в сети">📵</span>');
    el.appendChild(wrap);
    el.insertAdjacentHTML('beforeend', `<div class="nm">${esc(p.name)}</div><div class="sc">${p.left ? 'вышел' : p.out ? 'выбыл' : p.score + ' очк.'}</div>`);
    const mini = document.createElement('div');
    mini.className = 'mini';
    for (let i = 0; i < Math.min(p.cards, 7) && !p.out; i++) mini.appendChild(cardEl(null, { back: true }));
    el.appendChild(mini);
    box.appendChild(el);
  }

  // колода и сброс
  const deck = $('#deck');
  deck.querySelectorAll('.card').forEach(c => c.remove());
  for (let i = 0; i < Math.min(3, Math.ceil(g.deckCount / 6)); i++) {
    const c = cardEl(null, { back: true });
    c.style.transform = `translate(${-i * 2}px, ${-i * 2}px)`;
    deck.appendChild(c);
  }
  $('#deck-count').textContent = g.deckCount;
  deck.classList.toggle('can', myTurn() && !g.hasDrawn && !g.hand.some(canPlay));

  const pile = $('#pile');
  pile.innerHTML = '';
  for (const c of S.pile) {
    const el = cardEl(c);
    el.style.transform = `translateX(${c.dx}px) rotate(${c.rot}deg)`;
    pile.appendChild(el);
  }

  const badge = $('#suit-badge');
  const changed = badge.dataset.suit !== g.suit;
  badge.dataset.suit = g.suit;
  badge.textContent = SUIT_SYMBOL[g.suit];
  badge.title = SUIT_NAME[g.suit];
  badge.className = 'suit-badge ' + (isRed(g.suit) ? 'red' : 'black') + (changed && g.top.rank === 'Q' ? ' changed' : '');

  // я
  const me = ps.find(p => p.id === S.me?.id);
  const info = $('#me-info');
  info.innerHTML = '';
  info.appendChild(avatar(S.me));
  info.insertAdjacentHTML('beforeend', `<span>${esc(S.me?.name)}</span><span class="sc">${me ? me.score : 0}</span>`);

  const st = $('#status');
  const mine = myTurn();
  st.classList.toggle('mine', mine);
  if (g.phase !== 'playing') st.textContent = '';
  else if (me?.out) st.textContent = 'Вы выбыли — наблюдаете';
  else if (mine) st.textContent = g.hasDrawn ? 'Положите взятую карту или пас' : g.hand.some(canPlay) ? 'Ваш ход' : 'Нечем ходить — берите карту';
  else st.textContent = `Ходит ${nameOf(g.turn)}…`;

  const drawBtn = $('#btn-draw'), passBtn = $('#btn-pass');
  drawBtn.disabled = !mine || g.hasDrawn;
  passBtn.disabled = !mine || !g.hasDrawn;
  drawBtn.classList.toggle('hot', mine && !g.hasDrawn && !g.hand.some(canPlay));
  passBtn.classList.toggle('hot', mine && g.hasDrawn);

  renderHand();
}

const SUIT_ORDER = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
const RANK_ORDER = { '6': 0, '7': 1, '8': 2, '9': 3, '10': 4, J: 5, Q: 6, K: 7, A: 8 };

function renderHand() {
  const g = S.game;
  const hand = [...g.hand].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
  const box = $('#hand');
  const mine = myTurn();
  box.classList.toggle('my-turn', mine);
  box.innerHTML = '';
  const n = hand.length;
  const W = box.clientWidth || 360;
  const cw = parseFloat(getComputedStyle(box).getPropertyValue('--card-w')) || 84;
  const step = n > 1 ? Math.min(cw * 0.62, (W - cw - 8) / (n - 1)) : 0;
  const angle = Math.min(5, 30 / Math.max(n, 1));
  hand.forEach((c, i) => {
    const off = i - (n - 1) / 2;
    const playable = mine && canPlay(c);
    const el = cardEl(c, { cls: (playable ? 'playable' : mine ? 'dim' : '') + (S.prevHandIds.has(c.id) ? '' : ' new') });
    const y = off * off * 2 - (playable ? 14 : 0);
    el.style.transform = `translateX(calc(-50% + ${off * step}px)) translateY(${y}px) rotate(${off * angle}deg)`;
    el.style.zIndex = i + 1;
    el.style.animationDelay = `${Math.random() * 0.15}s`;
    el.addEventListener('click', () => playCard(c));
    box.appendChild(el);
  });
  S.prevHandIds = new Set(hand.map(c => c.id));
}

// ---------- анимации ----------
function fly(el, from, to, { delay = 0, rotate = 0 } = {}) {
  if (!from || !to) return;
  el.classList.add('flyer');
  el.style.width = from.width + 'px';
  el.style.left = from.left + 'px';
  el.style.top = from.top + 'px';
  el.style.setProperty('--card-w', from.width + 'px');
  document.body.appendChild(el);
  const sx = to.width / from.width;
  requestAnimationFrame(() => setTimeout(() => {
    el.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${sx}) rotate(${rotate}deg)`;
  }, delay));
  setTimeout(() => el.remove(), 420 + delay);
}
const centerRect = (r, w) => ({ left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - (w * 1.4) / 2, width: w, height: w * 1.4 });

function animateEvent(ev, rects, prev) {
  const g = S.game;
  const pileNow = $('#pile').getBoundingClientRect();
  if (ev.type === 'play') {
    const isMe = ev.playerId === S.me?.id;
    const from = isMe ? rects.hand[ev.card.id] : rects.opp[ev.playerId] && centerRect(rects.opp[ev.playerId], 40);
    const topEl = $('#pile').lastElementChild;
    if (from && topEl) {
      topEl.style.opacity = 0;
      fly(cardEl(ev.card), from, pileNow, { rotate: S.pile[S.pile.length - 1]?.rot || 0 });
      setTimeout(() => (topEl.style.opacity = 1), 380);
    }
    haptic(isMe ? 'medium' : 'light');
    if (ev.card.rank === 'Q' && ev.suit) bubble(ev.playerId, `Заказ: ${SUIT_SYMBOL[ev.suit]}`);
  } else if (ev.type === 'draw' && ev.count) {
    flyDraw(ev.playerId, 1, rects);
  }
  // штраф/пропуск могли произойти в том же ходе — смотрим лог по изменению карт
  for (const p of g.players) {
    const before = prev.players.find(x => x.id === p.id);
    const diff = before ? p.cards - before.cards : 0;
    if (ev.type === 'play' && diff > 0) {
      flyDraw(p.id, diff, rects, 250);
      bubble(p.id, `+${diff} и пропуск`);
      if (p.id === S.me?.id) haptic('warning');
    }
  }
  if (ev.type === 'play' && ev.card.rank === 'A') {
    const ps = g.players.filter(p => !p.out);
    const i = ps.findIndex(p => p.id === ev.playerId);
    if (i >= 0 && ps.length > 1) bubble(ps[(i + 1) % ps.length].id, 'Пропуск');
  }
  if (ev.type === 'pass') bubble(ev.playerId, 'Пас');
  if (g.turn === S.me?.id && prev.turn !== S.me?.id && g.phase === 'playing') haptic('heavy');
}

function flyDraw(playerId, count, rects, delay = 0) {
  const deck = rects.deck;
  let to;
  if (playerId === S.me?.id) to = centerRect($('#hand').getBoundingClientRect(), 60);
  else { const r = $(`#opponents .opp[data-id="${CSS.escape(playerId)}"] .ava-wrap`)?.getBoundingClientRect(); to = r && centerRect(r, 30); }
  for (let i = 0; i < count; i++) fly(cardEl(null, { back: true }), deck, to, { delay: delay + i * 120 });
}

function bubble(playerId, text) {
  const host = playerId === S.me?.id ? $('#me-info') : $(`#opponents .opp[data-id="${CSS.escape(playerId)}"]`);
  if (!host) return;
  if (playerId === S.me?.id) return toast(text);
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  host.appendChild(b);
  setTimeout(() => b.remove(), 1700);
}

// таймер хода
(function tick() {
  const g = S.game;
  const bar = $('#turn-progress');
  if (g?.phase === 'playing' && g.turnStartedAt) {
    const total = g.turnSeconds * 1000;
    const left = Math.max(0, total - (Date.now() - S.clockSkew - g.turnStartedAt));
    const frac = left / total;
    const isMine = myTurn();
    bar.style.width = isMine ? frac * 100 + '%' : '0';
    bar.style.backgroundPosition = `${(1 - frac) * 100}% 0`;
    const ring = $('#opponents .opp.turn .ring circle');
    if (ring) ring.setAttribute('stroke-dasharray', `${frac * 100} 100`);
  } else bar.style.width = '0';
  requestAnimationFrame(tick);
})();

// ---------- итоги ----------
function resultRow(r, { win = false, showHand = true, target = 101 } = {}) {
  const row = document.createElement('div');
  row.className = 'res-row' + (win ? ' win' : '');
  const seat = seatOf(r.id);
  row.appendChild(avatar({ ...seat, name: r.name }));
  const mid = document.createElement('div');
  mid.className = 'nm';
  mid.innerHTML = `${esc(r.name)}${r.id === S.me?.id ? ' (вы)' : ''}`;
  if (showHand && r.hand?.length) {
    const cards = document.createElement('div');
    cards.className = 'res-cards';
    r.hand.forEach(c => cards.appendChild(cardEl(c)));
    mid.appendChild(cards);
  }
  const bar = document.createElement('div');
  bar.className = 'score-bar';
  bar.innerHTML = `<i style="width:${Math.min(100, Math.max(0, (r.score / target) * 100))}%"></i>`;
  mid.appendChild(bar);
  row.appendChild(mid);
  if (r.note) row.insertAdjacentHTML('beforeend', `<span class="note ${r.note}">${r.note === 'out' ? 'вылет' : 'обнуление!'}</span>`);
  if (r.delta !== undefined) row.insertAdjacentHTML('beforeend', `<span class="d ${r.delta > 0 ? 'plus' : r.delta < 0 ? 'minus' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</span>`);
  row.insertAdjacentHTML('beforeend', `<span class="tot">${r.score}</span>`);
  return row;
}

let roundTimer;
function renderRound() {
  const g = S.game, rr = g.roundResult;
  if (!rr || $('#modal-round').classList.contains('open')) return;
  const w = rr.winnerId === S.me?.id;
  $('#round-title').textContent = w ? 'Вы закрыли раунд!' : `Раунд за ${nameOf(rr.winnerId)}`;
  const body = $('#round-body');
  body.innerHTML = rr.lastCard && ['Q', 'K'].includes(rr.lastCard.rank)
    ? `<p class="hint center">Последняя карта: <b>${cardText(rr.lastCard)}</b></p>` : '';
  [...rr.results].sort((a, b) => a.delta - b.delta).forEach(r => body.appendChild(resultRow(r, { win: r.id === rr.winnerId, target: g.target })));
  haptic(w ? 'success' : 'warning');
  openModal('round');
  let s = 7;
  clearInterval(roundTimer);
  $('#round-next').textContent = `Следующий раунд через ${s}…`;
  roundTimer = setInterval(() => {
    s--;
    $('#round-next').textContent = s > 0 ? `Следующий раунд через ${s}…` : 'Раздаём…';
    if (s <= 0) clearInterval(roundTimer);
  }, 1000);
}

function renderOver() {
  const g = S.game;
  if (!g) return;
  const win = g.winnerId === S.me?.id;
  $('#over-title').textContent = win ? 'Победа!' : `Победил ${nameOf(g.winnerId)}`;
  $('.trophy').textContent = win ? '🏆' : '🃏';
  const body = $('#over-body');
  body.innerHTML = '';
  const order = [...g.players].sort((a, b) => (a.id === g.winnerId ? -1 : b.id === g.winnerId ? 1 : (a.out - b.out) || a.score - b.score));
  order.forEach(p => body.appendChild(resultRow({ ...p, note: p.out ? 'out' : null }, { win: p.id === g.winnerId, showHand: false, target: g.target })));
  const again = $('#over-again');
  const priv = S.room?.private;
  const host = S.room?.hostId === S.me?.id;
  again.disabled = priv && !host;
  again.textContent = !priv ? '🔍 Искать новую игру' : host ? '🔁 Ещё партию' : 'Ждём создателя стола…';
  if (!$('#modal-over').classList.contains('open')) { haptic(win ? 'success' : 'error'); openModal('over'); }
}

function renderScores() {
  const g = S.game;
  const body = $('#scores-body');
  body.innerHTML = '';
  if (!g) return;
  [...g.players].sort((a, b) => a.out - b.out || a.score - b.score)
    .forEach(p => body.appendChild(resultRow({ ...p, note: p.out ? 'out' : null }, { showHand: false, target: g.target })));
  body.insertAdjacentHTML('beforeend', `<p class="hint center">Больше ${g.target} — вылет · ровно ${g.target} — обнуление</p>`);
}

window.addEventListener('resize', () => S.game && renderHand());
