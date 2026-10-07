import { SPRITE, cardEl, SUIT_SYMBOL, SUIT_NAME, isRed, rankLabel } from './cards.js';
import { sfx, setMuted } from './sound.js';
import { settings, saveSettings, BACKS, ACHIEVEMENTS, ACH_GROUPS, progress, loadProgress, saveProgress } from './store.js';
import { GAMES, GAME } from './games-info.js';
import { initTable, onTableGame, resetTableUI, chatHost, rerender as rerenderTable } from './table.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const tg = window.Telegram?.WebApp;
const inTg = !!tg?.initData;

document.getElementById('sprite').innerHTML = SPRITE;

// Фактура бумаги: генерируем один раз маленькую текстуру и используем как фон везде
(function paperGrain() {
  try {
    const n = 140, c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d');
    const img = x.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random();
      img.data[i] = 90; img.data[i + 1] = 70; img.data[i + 2] = 40;
      img.data[i + 3] = v > 0.985 ? 40 : v * 14;
    }
    x.putImageData(img, 0, 0);
    x.strokeStyle = 'rgba(90,70,40,.07)';
    for (let k = 0; k < 18; k++) { // волокна
      x.beginPath();
      const sx = Math.random() * n, sy = Math.random() * n;
      x.moveTo(sx, sy);
      x.quadraticCurveTo(sx + Math.random() * 20 - 10, sy + Math.random() * 20 - 10, sx + Math.random() * 30 - 15, sy + Math.random() * 30 - 15);
      x.stroke();
    }
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL()})`);
  } catch {}
})();

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
};

// ---------- Telegram ----------
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#efe5cf'); tg.setBackgroundColor('#efe5cf'); tg.setBottomBarColor?.('#efe5cf'); } catch {}
  try { tg.disableVerticalSwipes?.(); } catch {}
  tg.BackButton?.onClick(goBack);
}
const haptic = (type = 'light') => {
  if (!settings.vibro) return;
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
    case 'error': toast(m.message); haptic('error'); sfx.error(); if (S.flying && !S.flying.top) cancelFlying(); else shakeCard(S.lastTried); S.lastTried = null; break;
    case 'queue': onQueue(m); break;
    case 'stats': onStats(m); break;
    case 'chat': onChat(m); break;
    case 'say': addChat(m.where, m.msg); break;
    case 'chat_history': (m.where === 'global' ? $('#global-list') : $('#room-list')).innerHTML = m.where === 'global' ? '' : ($('#table-list').innerHTML = '', ''); m.items.forEach(x => addChat(m.where, x, true)); break;
    case 'room': onRoom(m.room); break;
    case 'game': if (m.game.game && m.game.game !== '108') onTable(m.game); else onGame(m.game); break;
    case 'profile': onProfile(m.profile); break;
    case 'bonus': if (m.ok) { toast(`🎁 +${m.amount} монет!`); sfx.win(); haptic('success'); } else toast('Бонус уже забран — загляни позже'); break;
  }
}

// ---------- навигация ----------
const TABS = []; // нижняя панель убрана — все экраны с кнопкой «назад»
const inLiveGame = () => !!S.room && ((!!S.game && S.game.phase !== 'gameOver') || (!!S.tgame && S.tgame.phase !== 'gameOver'));
function show(name, { push = true } = {}) {
  if (S.screen === name) return;
  // вкладки нижней панели — без истории; из игры настройки открываются с кнопкой «назад»
  const tabMode = TABS.includes(name) && !inLiveGame();
  if (tabMode) S.history = [];
  else if (push && S.screen && !['queue', 'game', 'room'].includes(S.screen)) S.history.push(S.screen);
  S.screen = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  document.body.classList.toggle('has-tabs', tabMode);
  $$('#tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  const canBack = !tabMode && !['home', 'game', 'queue'].includes(name);
  if (tg?.BackButton) canBack ? tg.BackButton.show() : tg.BackButton.hide();
}
function goBack() {
  if (S.screen === 'room') return leaveRoom();
  if (inLiveGame() && !['game', 'table'].includes(S.screen)) return show(S.tgame ? 'table' : 'game', { push: false });
  if (S.screen === 'queue') return send({ type: 'queue_cancel' });
  show(S.history.pop() || 'home', { push: false });
}
function home() { S.history = []; show('home', { push: false }); }

// ---------- настройки ----------
function applySettings() {
  setMuted(!settings.sound);
  document.body.classList.toggle('lite', settings.lite);
  document.body.classList.toggle('big', settings.big);
  const b = BACKS[settings.back] || BACKS.red;
  document.documentElement.style.setProperty('--back', b.color);
  document.documentElement.style.setProperty('--back-line', b.line);
  if (S.game) renderHand(S.game);
}
function renderSettings() {
  $$('[data-set]').forEach(i => (i.checked = !!settings[i.dataset.set]));
  const box = $('#backs');
  box.innerHTML = '';
  for (const [id, b] of Object.entries(BACKS)) {
    const open = !b.need || progress.unlocked[b.need];
    const el = document.createElement('button');
    el.className = 'back-opt' + (settings.back === id ? ' sel' : '') + (open ? '' : ' locked');
    el.style.setProperty('--c', b.color);
    const ach = ACHIEVEMENTS.find(a => a.id === b.need);
    el.innerHTML = `<i></i><span>${b.name}</span>${open ? '' : `<small>🔒 ${esc(ach?.name || '')}</small>`}`;
    el.onclick = () => {
      if (!open) { toast(`Откроется за «${ach?.name}»: ${ach?.desc}`); return; }
      settings.back = id; saveSettings(); applySettings(); renderSettings(); haptic();
    };
    box.appendChild(el);
  }
}
$$('[data-set]').forEach(i => i.addEventListener('change', () => {
  settings[i.dataset.set] = i.checked;
  saveSettings(); applySettings(); haptic(); sfx.click();
}));
$('#menu-settings').addEventListener('click', () => { closeModal('menu'); renderSettings(); show('settings'); });
applySettings();

// ---------- достижения ----------
function renderAchievements() {
  const st = progress.stats;
  const rate = st.games ? Math.round((st.wins / st.games) * 100) : 0;
  $('#stats-row').innerHTML = [['Партий', st.games], ['Побед', st.wins], ['Винрейт', rate + '%'], ['Лучшая серия', st.bestStreak]]
    .map(([k, v]) => `<div class="stat-box"><b>${v}</b><span>${k}</span></div>`).join('');
  const done = ACHIEVEMENTS.filter(a => progress.unlocked[a.id]).length;
  const list = $('#ach-list');
  list.innerHTML = `<li class="ach-head">Открыто ${done} из ${ACHIEVEMENTS.length}</li>`;
  let i = 0;
  for (const [gid, title] of ACH_GROUPS) {
    const group = ACHIEVEMENTS.filter(a => a.game === gid);
    const n = group.filter(a => progress.unlocked[a.id]).length;
    list.insertAdjacentHTML('beforeend', `<li class="ach-group"><span>${title}</span><small>${n} / ${group.length}</small></li>`);
    for (const a of group) {
      const got = progress.unlocked[a.id];
      const [cur, max] = a.goal ? a.goal(st) : [0, 0];
      const li = document.createElement('li');
      li.className = 'ach' + (got ? ' got' : '');
      li.style.animationDelay = `${Math.min(i++, 14) * 30}ms`;
      li.innerHTML = `<span class="ico">${a.icon}</span><div><b>${esc(a.name)}</b><small>${esc(a.desc)}${a.reward ? ` · 🎁 ${esc(a.reward)}` : ''}</small>`
        + (a.goal && !got ? `<div class="ach-bar"><i style="width:${Math.min(100, (cur / max) * 100)}%"></i></div><small>${Math.min(cur, max)} / ${max}</small>` : '')
        + `</div>${got ? '<span class="tick">✓</span>' : ''}`;
      list.appendChild(li);
    }
  }
}
const achQueue = [];
function unlock(id) {
  if (progress.unlocked[id]) return;
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return;
  progress.unlocked[id] = Date.now();
  saveProgress();
  achQueue.push(a);
  if (achQueue.length === 1) showAch();
}
function showAch() {
  const a = achQueue[0];
  if (!a) return;
  const t = $('#ach-toast');
  t.innerHTML = `<span class="ico">${a.icon}</span><div><small>Достижение открыто!</small><b>${esc(a.name)}</b>${a.reward ? `<small>🎁 ${esc(a.reward)}</small>` : ''}</div>`;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  sfx.win(); haptic('success');
  setTimeout(() => { t.classList.remove('show'); achQueue.shift(); setTimeout(showAch, 400); }, 3200);
}
function checkGoals() {
  for (const a of ACHIEVEMENTS) if (a.goal) { const [c, m] = a.goal(progress.stats); if (c >= m) unlock(a.id); }
}
function renderMeSub() {
  const p = S.profile;
  $('#me-sub').textContent = p ? `Уровень ${p.level}` : 'новичок';
}
function openTab(name) {
  if (name === 'settings') renderSettings();
  if (name === 'achievements') renderAchievements();
  if (name === 'home') renderMeSub();
  show(name);
}
// правила выбранной игры
function renderRules(gid = S.gameId) {
  const g = GAME[gid];
  $('#rules-title').textContent = `Правила: ${g.name}`;
  if (g.rulesFrom) {
    const src = $(g.rulesFrom + ' .sheet').cloneNode(true);
    src.querySelector('h3')?.remove();
    src.querySelector('[data-close]')?.remove();
    $('#rules-body').innerHTML = src.innerHTML;
  } else $('#rules-body').innerHTML = g.rules;
}

loadProgress().then(() => { checkGoals(); renderMeSub(); if (S.screen === 'achievements') renderAchievements(); });
document.addEventListener('pointerdown', e => { if (e.target.closest('.btn, .mode-card, .mode-tile, .big-tile, .size-card, .icon-btn, .back, .suit-btn')) sfx.click(); });

$$('[data-go]').forEach(b => b.addEventListener('click', () => {
  haptic();
  if (b.dataset.go === 'settings') renderSettings();
  if (b.dataset.go === 'achievements') renderAchievements();
  if (b.dataset.go === 'rules') renderRules();
  if (b.dataset.go === 'profile') renderProfile();
  if (b.dataset.go === 'chat') { S.gUnread = 0; renderUnread(); if (!S.globalLoaded) { S.globalLoaded = true; send({ type: 'global_history' }); } setTimeout(() => scrollChat('#global-list'), 50); }
  show(b.dataset.go);
}));
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
  renderMeSub();
  $('#me-avatar').replaceWith(Object.assign(avatar(S.me), { id: 'me-avatar' }));
}
// ---------- главная: список игр ----------
S.gameId = (() => { try { const g = localStorage.getItem('game'); return GAME[g] ? g : '108'; } catch { return '108'; } })();
function miniFan(g, w = 46) {
  const fan = document.createElement('div');
  fan.className = 'mini-fan';
  const mid = (g.fan.length - 1) / 2;
  g.fan.forEach(([rank, suit], i) => {
    const c = cardEl({ id: `${g.id}-${rank}${suit}`, rank, suit });
    c.style.setProperty('--card-w', w + 'px');
    c.style.transform = `translateX(-50%) rotate(${(i - mid) * 12}deg)`;
    fan.appendChild(c);
  });
  return fan;
}
(function buildGamesList() {
  const box = $('#games-list');
  GAMES.forEach((g, i) => {
    const el = document.createElement('button');
    el.className = 'game-tile' + (i === 0 ? ' wide' : '');
    el.style.setProperty('--gc', g.color);
    el.style.animationDelay = `${i * 45}ms`;
    el.appendChild(miniFan(g, i === 0 ? 54 : 40));
    el.insertAdjacentHTML('beforeend', `<span class="gt-txt"><b>${g.name}</b><small>${g.tagline}</small><em><span data-live="${g.id}"></span>${g.players}</em></span><i class="chev">›</i>`);
    el.onclick = () => { haptic('light'); openHub(g.id); };
    box.appendChild(el);
  });
})();
function openHub(id) {
  S.gameId = id;
  try { localStorage.setItem('game', id); } catch {}
  const g = GAME[id];
  $('#hub-title').textContent = g.name;
  $('#hub-tag').textContent = g.tagline;
  $('#hub-fan').replaceChildren(miniFan(g, 74));
  $('#hub-hero').style.setProperty('--gc', g.color);
  $('#hub-online').classList.toggle('hidden', !!g.solo);
  $('#hub-bots').classList.toggle('hidden', !!g.solo);
  $('#solo-go').classList.toggle('hidden', !g.solo);
  $('#hub-stake').textContent = g.stake ? `· ставка ${g.stake} 🪙` : '';
  renderModes();
  renderBotsPick();
  show('hub');
}
$('#solo-go').addEventListener('click', () => { haptic('medium'); send({ type: 'practice', game: S.gameId }); });
$('#bots-go').addEventListener('click', () => { haptic('medium'); send({ type: 'practice', game: S.gameId, bots: S.bots || 1 }); });
['#code-btn', '#code-btn2'].forEach(sel => $(sel).addEventListener('click', () => { haptic(); openModal('code'); setTimeout(() => $('#join-code').focus(), 250); }));

function renderModes() {
  const g = GAME[S.gameId];
  const box = $('#modes');
  box.innerHTML = '';
  for (const [mode, [name, ppl, ico]] of Object.entries(g.modes)) {
    const b = document.createElement('button');
    b.className = 'mode-card';
    b.innerHTML = `<span class="mc-ico">${ico}</span><span class="mc-txt"><b>${name}</b><span class="ppl">${ppl}</span></span><span class="stat" data-stat="${mode}"></span>`;
    b.onclick = () => { haptic('medium'); send({ type: 'queue', game: g.id, mode }); };
    box.appendChild(b);
  }
  if (S.stats) onStats(S.stats);
}
function renderBotsPick() {
  const g = GAME[S.gameId];
  if (!g.bots) return;
  S.bots = Math.min(S.bots || 1, g.bots[g.bots.length - 1]);
  const box = $('#bots-pick');
  box.innerHTML = '<span>Ботов:</span>';
  for (const n of g.bots) {
    const b = document.createElement('button');
    b.className = 'pick' + (n === S.bots ? ' on' : '');
    b.textContent = n;
    b.onclick = () => { S.bots = n; sfx.click(); renderBotsPick(); };
    box.appendChild(b);
  }
}

// ---------- профиль и баланс ----------
const fmt = n => Number(n || 0).toLocaleString('ru-RU');
function onProfile(p) {
  if (!p) return;
  const prev = S.profile;
  S.profile = p;
  const el = $('#coins');
  el.textContent = fmt(p.coins);
  if (prev && prev.coins !== p.coins) { el.parentElement.classList.remove('pop'); void el.offsetWidth; el.parentElement.classList.add('pop'); }
  renderMeSub();
  if (S.screen === 'profile') renderProfile();
  if (prev && p.level > prev.level) { toast(`⭐ Новый уровень: ${p.level}!`); sfx.win(); }
}
let bonusTimer;
function renderProfile() {
  const p = S.profile;
  if (!p) return;
  $('#pf-avatar').replaceChildren(avatar(S.me || p, 'avatar big'));
  $('#pf-name').textContent = p.name;
  $('#pf-level').textContent = `Уровень ${p.level} · ${p.xp} опыта`;
  $('#pf-xp').style.width = `${Math.min(100, ((p.xp - p.levelFrom) / (p.levelTo - p.levelFrom)) * 100)}%`;
  $('#pf-coins').textContent = fmt(p.coins);
  const tick = () => {
    const left = p.bonusAt - Date.now();
    $('#bonus-btn').disabled = left > 0;
    $('#bonus-hint').textContent = left > 0 ? `Следующий бонус через ${Math.floor(left / 3600000)} ч ${Math.floor(left / 60000) % 60} мин` : 'Ежедневный бонус готов — +300 монет';
  };
  clearInterval(bonusTimer); tick(); bonusTimer = setInterval(tick, 30000);
  const rows = GAMES.map(g => {
    const st = p.stats?.[g.id] || { played: 0, won: 0 };
    return `<tr><td>${g.name}</td><td>${st.played}</td><td>${st.won}</td><td>${st.played ? Math.round((st.won / st.played) * 100) : 0}%</td></tr>`;
  }).join('');
  $('#pf-stats').innerHTML = `<tr><th>Игра</th><th>Партий</th><th>Побед</th><th>%</th></tr>${rows}`;
}
$('#bonus-btn').addEventListener('click', () => { haptic('medium'); send({ type: 'bonus' }); });

// ---------- столы новых игр ----------
initTable({
  send, me: () => S.me, sfx, haptic, toast, avatar, esc, openModal, lite: () => settings.lite, hints: () => settings.hints, track: g => trackTable(g),
  seatOf: id => S.tgame?.seats?.find(s => s.id === id),
  afterOver: iWon => {
    const priv = S.room?.private, host = S.room?.hostId === S.me?.id;
    const again = $('#over-again');
    again.disabled = priv && !host;
    again.textContent = !priv ? '🔍 Искать новую игру' : host ? '🔁 Ещё партию' : 'Ждём создателя стола…';
    if (!$('#modal-over').classList.contains('open')) { haptic(iWon ? 'success' : 'error'); iWon ? sfx.win() : sfx.lose(); openModal('over'); }
  },
});
$('#menu-rules').addEventListener('click', () => {
  closeModal('menu');
  if (S.tgame) { renderRules(S.tgame.game); show('rules'); } else openModal('rules');
});
function onTable(g) {
  S.tgame = g;
  show('table');
  if (g.phase === 'playing') closeModal('over');
  onTableGame(g);
}

// ---------- матчмейкинг ----------
$('#queue-cancel').addEventListener('click', () => send({ type: 'queue_cancel' }));
$('#queue-bots').addEventListener('click', () => send({ type: 'queue_bots' }));


const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

function onStats(m) {
  S.stats = m;
  for (const [gid, gs] of Object.entries(m.games || {})) {
    const live = $(`[data-live="${gid}"]`);
    if (live) live.textContent = gs.playing ? ` · ${gs.playing} ${plural(gs.playing, 'играет', 'играют', 'играют')}` : '';
  }
  const modes = m.games?.[S.gameId]?.modes || {};
  for (const [mode, st] of Object.entries(modes)) {
    const el = $(`[data-stat="${mode}"]`);
    if (!el) continue;
    const html = `<i class="dot play"></i>${st.playing} ${plural(st.playing, 'играет', 'играют', 'играют')} <i class="dot find"></i>${st.searching} ${plural(st.searching, 'ищет', 'ищут', 'ищут')}`;
    if (el.innerHTML !== html) { el.innerHTML = html; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  $('#online-count').textContent = `Сейчас онлайн: ${m.online}`;
  renderQueueStat();
}
function renderQueueStat() {
  const q = S.queue, st = q && S.stats?.games?.[q.game]?.modes[q.mode];
  if (!st) return;
  $('#queue-stat').innerHTML = `<b>${GAME[q.game].name} · ${GAME[q.game].modes[q.mode][0]}</b><br>${st.searching} ${plural(st.searching, 'ищет', 'ищут', 'ищут')} · ${st.playing} ${plural(st.playing, 'играет', 'играют', 'играют')}`;
}

let queueTimer;
function onQueue(m) {
  clearInterval(queueTimer);
  if (!m.mode) { leaveQueueUi(); if (S.screen === 'queue') show(S.history.pop() || 'home', { push: false }); return; }
  const prevCount = S.queue?.count;
  S.queue = m;
  show('queue');
  const cnt = $('#queue-count');
  cnt.textContent = m.min === m.max ? `${m.count} / ${m.max}` : `${m.count} / ${m.min}–${m.max}`;
  if (prevCount !== undefined && prevCount !== m.count) { cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); sfx.deal(); }
  renderQueueStat();
  S.queueStart ??= Date.now();
  const skew = m.now ? Date.now() - m.now : 0;
  const tick = () => {
    const sec = Math.max(0, Math.floor((Date.now() - S.queueStart) / 1000));
    $('#queue-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('#queue-bots').classList.toggle('hidden', sec < 10);
    const qs = $('#queue-start');
    if (m.startsAt) {
      const left = Math.max(0, Math.ceil((m.startsAt - (Date.now() - skew)) / 1000));
      qs.textContent = `Старт через ${left} с — ждём ещё игроков`;
      qs.classList.remove('hidden');
    } else qs.classList.add('hidden');
  };
  tick();
  queueTimer = setInterval(tick, 500);
}
function leaveQueueUi() { clearInterval(queueTimer); S.queue = null; S.queueStart = null; }

// ---------- комнаты ----------
$('#room-create').addEventListener('click', () => { haptic('medium'); send({ type: 'room_create', game: S.gameId }); });
$('#join-form').addEventListener('submit', e => {
  closeModal('code');
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
  const { bot, app } = window.CLUB || {};
  if (bot && app) return `https://t.me/${bot}/${app}?startapp=${code}`;
  if (bot) return `https://t.me/${bot}?start=r_${code}`;
  return `${location.origin}/?room=${code}`;
}
function shareRoom() {
  const code = S.room?.code;
  if (!code) return;
  const link = inviteLink(code);
  const text = `Садись ко мне за стол в nLuck — ${GAME[S.room.game]?.name || ''}! Код: ${code}`;
  haptic();
  if (tg && inTg) return tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  if (navigator.share) return navigator.share({ title: 'nLuck', text, url: link }).catch(() => {});
  copy(link);
}
$('#room-copy').addEventListener('click', () => S.room && copy(inviteLink(S.room.code)));
function copy(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => toast('Скопировано'), () => toast(text));
}

function onRoom(room) {
  const prev = S.room;
  S.room = room;
  leaveQueueUi();
  if (!room) {
    S.game = null; S.tgame = null; resetTable(); resetTableUI(); S.initialized = false;
    $$('.modal').forEach(m => m.classList.remove('open'));
    if (['room', 'game', 'queue', 'table'].includes(S.screen)) home();
    return;
  }
  if (room.inGame) { if (room.game !== '108' ? S.tgame : S.game) show(room.game !== '108' ? 'table' : 'game'); return; }
  if (S.game?.phase === 'gameOver' && S.screen === 'game') { renderOver(); return; }
  if (S.tgame?.phase === 'gameOver' && S.screen === 'table') return;
  if (!prev || prev.code !== room.code) S.history = ['home'];
  renderRoom();
  show('room');
}

function renderRoom() {
  const r = S.room;
  const isHost = r.hostId === S.me?.id;
  $('#room-code').textContent = r.code;
  $('#room-title').textContent = `Стол: ${GAME[r.game]?.name || ''}`;
  const ul = $('#seats');
  ul.innerHTML = '';
  for (const s of r.seats) {
    const li = document.createElement('li');
    li.className = 'seat';
    li.appendChild(avatar(s));
    li.insertAdjacentHTML('beforeend', `<span class="name">${esc(s.name)}${s.id === S.me?.id ? ' (вы)' : ''}</span>`
      + (s.id === r.hostId ? '<span class="tag">👑 создатель</span>' : s.spectator ? '<span class="tag">👀 смотрит</span>' : s.bot ? '<span class="off">бот</span>' : '')
      + (!s.online ? '<span class="off">не в сети</span>' : ''));
    if (s.bot && isHost) {
      const b = document.createElement('button');
      b.className = 'rm'; b.textContent = '✕';
      b.onclick = () => send({ type: 'room_remove_bot', id: s.id });
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  if (r.seats.length < r.max) ul.insertAdjacentHTML('beforeend', `<li class="seat empty">Ждём друзей… (до ${r.max} игроков)</li>`);
  $('#room-start').classList.toggle('hidden', !isHost);
  $('#room-add-bot').classList.toggle('hidden', !isHost || r.solo || r.seats.length >= r.max);
  $('#room-start').disabled = r.seats.length < r.min;
  $('#room-wait').classList.toggle('hidden', isHost);
  $('#room-wait').textContent = r.inGame ? 'Идёт партия — вы сядете в следующей' : 'Ждём, пока создатель стола начнёт игру…';
  $('#room-start').textContent = r.inGame ? 'Идёт партия…' : '▶ Начать';
  if (r.inGame) $('#room-start').disabled = true;
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
  if (S.pendingQueen) {
    haptic('medium');
    const c = S.game?.hand.find(x => x.id === S.pendingQueen);
    if (c) startThrow(c);
    send({ type: 'play', cardId: S.pendingQueen, suit: b.dataset.suit });
  }
  S.pendingQueen = null;
}));

function myTurn() { return S.game?.phase === 'playing' && S.game.turn === S.me?.id; }
function drawCard() {
  if (!myTurn()) return;
  haptic();
  send({ type: 'draw' });
}
function playCard(card) {
  if (!myTurn()) return;
  S.lastTried = card.id;
  if (card.rank === 'Q' && !S.game.pending) { S.pendingQueen = card.id; return openModal('suit'); }
  haptic('medium');
  startThrow(card);
  send({ type: 'play', cardId: card.id });
}

// ---------- мгновенный бросок: карта летит из руки сразу, не дожидаясь сервера ----------
S.thrown = new Set();
function startThrow(card) {
  const el = S.handEls.get(card.id);
  if (!el || settings.lite || S.flying) return;
  const from = el.getBoundingClientRect(), to = rectOf($('#pile'));
  const flyer = cardEl(card);
  flyer.classList.add('flyer', 'airborne');
  Object.assign(flyer.style, { width: from.width + 'px', left: from.left + 'px', top: from.top + 'px' });
  flyer.style.setProperty('--card-w', from.width + 'px');
  document.body.appendChild(flyer);
  el.style.visibility = 'hidden';
  const endRot = (Math.random() - 0.5) * 22;
  const dx = to.left - from.left, dy = to.top - from.top, sc = to.width / from.width;
  const arc = Math.min(120, 40 + Math.abs(dy) * 0.3);
  const f = { id: card.id, flyer, el, endRot, done: false, top: null };
  S.flying = f;
  S.thrown.add(card.id);
  sfx.flick();
  f.anim = flyer.animate([
    { transform: 'translate(0,0) rotate(0) scale(1)' },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.5 - arc}px) rotate(${endRot / 2 - 200}deg) scale(${(1 + sc) / 2 * 1.15})`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${endRot - 360}deg) scale(${sc})` },
  ], { duration: 520, easing: 'cubic-bezier(.12,.75,.25,1)', fill: 'forwards' });
  f.anim.onfinish = () => { f.done = true; if (f.top) landFlying(f); };
}
function adoptFlying(top) {
  const f = S.flying;
  top.style.setProperty('--r', `${f.endRot}deg`);
  top.style.setProperty('--x', '0px');
  if (f.done) landFlying(f, top);
  else { top.style.visibility = 'hidden'; f.top = top; }
}
function landFlying(f, top = f.top) {
  f.flyer.remove();
  top.style.visibility = '';
  top.classList.remove('thud'); void top.offsetWidth; top.classList.add('thud');
  const pr = rectOf($('#pile'));
  const puff = document.createElement('div');
  puff.className = 'puff';
  Object.assign(puff.style, { left: pr.left + pr.width / 2 + 'px', top: pr.top + pr.height / 2 + 'px' });
  document.body.appendChild(puff);
  setTimeout(() => puff.remove(), 500);
  sfx.land();
  if (S.flying === f) S.flying = null;
}
function cancelFlying() {
  const f = S.flying;
  if (!f || f.top) return;
  S.flying = null;
  S.thrown.delete(f.id);
  f.anim.onfinish = null;
  f.anim.reverse();
  f.anim.onfinish = () => { f.flyer.remove(); f.el.style.visibility = ''; shakeCard(f.id); };
}
function shakeCard(id) {
  const el = id && S.handEls.get(id);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

const nameOf = id => S.game?.players.find(p => p.id === id)?.name || '?';
const seatOf = id => S.game?.seats?.find(s => s.id === id) || S.game?.players.find(p => p.id === id);
const cardText = c => `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;
const rectOf = el => el?.getBoundingClientRect();
const centerRect = (r, w) => r && ({ left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - (w * 1.4) / 2, width: w, height: w * 1.4 });

S.handEls = new Map();
S.pileKey = null;

// рубашка для колоды — один раз
(function buildDeck() {
  const deck = $('#deck');
  for (let i = 0; i < 3; i++) {
    const c = cardEl(null, { back: true });
    c.style.transform = `translate(${-i * 2}px, ${-i * 2}px)`;
    deck.insertBefore(c, deck.firstChild);
  }
})();

function onGame(g) {
  const prev = S.game;
  const newRound = !prev || prev.round !== g.round;
  // положение карт до перерисовки — для анимаций
  const before = { hand: new Map(), opp: {} };
  for (const [id, el] of S.handEls) before.hand.set(id, rectOf(el));
  $$('#opponents .opp').forEach(el => (before.opp[el.dataset.id] = rectOf(el.querySelector('.ava-wrap'))));

  const dealing = (g.events || []).some(e => e.type === 'roundStart');
  S.game = g;
  show('game');
  if (newRound) resetTable();
  if (dealing) S.initialized = true;
  renderTable(g, dealing);
  animateEvents(g.events || [], before, !prev && !dealing);

  if (g.phase === 'playing') { closeModal('round'); closeModal('over'); }
  if (g.phase === 'roundOver') { trackRound(g); setTimeout(renderRound, 700); }
  if (g.phase === 'gameOver') { trackRound(g); trackGame(g); closeModal('round'); setTimeout(renderOver, 700); }
}

function resetTable() {
  if (S.flying) { S.flying.flyer.remove(); S.flying = null; }
  S.thrown.clear();
  for (const el of S.handEls.values()) el.remove();
  S.handEls.clear();
  $('#pile').innerHTML = '';
  S.pileKey = null;
}

function renderTable(g, deal) {
  $('#round-label').textContent = `Раунд ${g.round}`;
  const mine = myTurn();

  // соперники — по кругу, начиная со следующего после меня
  const ps = g.players;
  const meIdx = Math.max(0, ps.findIndex(p => p.id === S.me?.id));
  const opps = [...ps.slice(meIdx + 1), ...ps.slice(0, meIdx)];
  const box = $('#opponents');
  box.innerHTML = '';
  for (const p of opps) {
    const seat = seatOf(p.id);
    const el = document.createElement('div');
    el.className = 'opp' + (p.id === g.turn && g.phase === 'playing' ? ' turn' : '') + (p.out ? ' out' : '') + (p.cards === 1 && !p.out && g.phase === 'playing' ? ' last' : '');
    el.dataset.id = p.id;
    const wrap = document.createElement('div');
    wrap.className = 'ava-wrap';
    wrap.appendChild(avatar({ ...seat, name: p.name, bot: seat?.bot }));
    if (!p.out) wrap.insertAdjacentHTML('beforeend', `<span class="cnt">${p.cards}</span>`);
    if (seat && seat.online === false && !seat.bot) wrap.insertAdjacentHTML('beforeend', '<span class="off-badge">📵</span>');
    el.appendChild(wrap);
    const bumped = S.scores?.[p.id] !== undefined && S.scores[p.id] !== p.score;
    el.insertAdjacentHTML('beforeend', `<div class="nm">${esc(p.name)}</div><div class="sc${bumped ? ' pop' : ''}">${p.left ? 'вышел' : p.out ? 'выбыл' : p.score}</div>`
      + `<div class="mini">${p.out ? '' : '<i></i>'.repeat(Math.min(p.cards, 7))}</div>`);
    box.appendChild(el);
  }

  $('#deck-count').textContent = g.deckCount;

  // сброс: добавляем только новую верхнюю карту
  const key = `${g.top.id}:${g.discardCount}`;
  if (key !== S.pileKey) {
    S.pileKey = key;
    const el = cardEl(g.top, { cls: 'pile-card' });
    el.style.setProperty('--r', `${(Math.random() - 0.5) * 22}deg`);
    el.style.setProperty('--x', `${(Math.random() - 0.5) * 12}px`);
    $('#pile').appendChild(el);
    if (S.flying && S.flying.id === g.top.id) adoptFlying(el);
    while ($('#pile').children.length > 4) $('#pile').firstElementChild.remove();
  }

  // заказанная дамой масть
  const badge = $('#suit-badge');
  const ordered = g.top.rank === 'Q' && !g.cover;
  badge.classList.toggle('show', ordered);
  if (ordered && badge.dataset.suit !== g.suit) {
    badge.dataset.suit = g.suit;
    badge.textContent = SUIT_SYMBOL[g.suit];
    badge.className = 'suit-badge show ' + (isRed(g.suit) ? 'red' : 'black');
  }
  if (!ordered) badge.dataset.suit = '';

  const me = ps.find(p => p.id === S.me?.id);
  const info = $('#me-info');
  info.classList.toggle('turn', mine);
  info.innerHTML = '';
  info.appendChild(avatar(S.me));
  const myBump = me && S.scores?.[me.id] !== undefined && S.scores[me.id] !== me.score;
  info.insertAdjacentHTML('beforeend', `<span class="nm">${esc(S.me?.name)}</span><span class="sc${myBump ? ' pop' : ''}">${me ? me.score : 0}</span>`);
  S.scores = Object.fromEntries(ps.map(p => [p.id, p.score]));

  $('#btn-draw').disabled = !mine || (!g.cover && !g.pending && g.hasDrawn);
  $('#btn-draw').textContent = mine && g.pending ? `Взять +${g.pending.count}` : 'Взять';
  $('#btn-pass').disabled = !mine || !g.canPass;

  renderHand(g, deal);
  renderHint(g);
}

const SUIT_ORDER = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
const RANK_ORDER = { '6': 0, '7': 1, '8': 2, '9': 3, '10': 4, J: 5, Q: 6, K: 7, A: 8 };

function hintPlayable(c, g) {
  if (g.pending) return c.rank === g.pending.rank;
  if (c.rank === 'Q') return true;
  if (g.cover) return c.rank === '8' || c.suit === g.cover;
  return c.suit === g.suit || c.rank === g.top.rank;
}

function renderHint(g) {
  const el = $('#hint-line');
  if (!settings.hints || g.phase !== 'playing') { el.textContent = ''; return; }
  const mine = myTurn();
  el.classList.toggle('mine', mine);
  if (!mine) el.textContent = `Ходит ${nameOf(g.turn)}`;
  else if (g.cover) el.textContent = `Покройте восьмёрку: 8 или ${SUIT_SYMBOL[g.cover]}` + (g.hand.some(c => hintPlayable(c, g)) ? '' : ' — тяните из колоды');
  else if (g.hasDrawn) el.textContent = 'Положите взятую карту или «Пас»';
  else el.textContent = g.hand.some(c => hintPlayable(c, g)) ? 'Ваш ход' : 'Нечем ходить — возьмите карту';
}

function renderHand(g, deal = false) {
  const hand = [...g.hand].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
  const box = $('#hand');
  const ids = new Set(hand.map(c => c.id));
  for (const [id, el] of S.handEls) if (!ids.has(id)) { el.remove(); S.handEls.delete(id); }

  const n = hand.length;
  const W = box.clientWidth || 360;
  const cw = parseFloat(getComputedStyle(box).getPropertyValue('--card-w')) || 84;
  // Много карт — веер плотнее, с 12 карт — два ряда. Всё всегда влезает в экран
  const rows = n > 11 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const rowGap = cw * 0.62;
  box.classList.toggle('two-rows', rows === 2);
  const slot = i => {
    const row = rows === 2 && i >= perRow ? 1 : 0;
    const j = row ? i - perRow : i;
    const k = row ? n - perRow : Math.min(n, perRow);
    const spread = Math.min(24, k * 4);                       // общий угол веера
    const margin = cw * 1.4 * Math.sin((spread / 2) * Math.PI / 180) * 0.6 + 6;
    const step = k > 1 ? Math.min(cw * 0.62, (W - cw - margin * 2) / (k - 1)) : 0;
    const half = (k - 1) / 2, off = j - half, norm = half ? off / half : 0;
    const y = norm * norm * 12 - (rows === 2 && row === 0 ? rowGap : 0);
    return `translate(calc(-50% + ${off * step}px), ${y}px) rotate(${norm * spread / 2}deg)`;
  };
  const hb = box.getBoundingClientRect();
  const db = $('#deck').getBoundingClientRect();
  // откуда вылетают новые карты — из колоды
  const fromDeck = `translate(calc(-50% + ${db.left + db.width / 2 - (hb.left + hb.width / 2)}px), ${db.top + db.height / 2 - (hb.bottom - 14 - cw * 0.7)}px) rotate(-8deg) scale(${db.width / cw})`;
  let newIdx = 0;
  hand.forEach((c, i) => {
    const target = slot(i);
    let el = S.handEls.get(c.id);
    if (!el) {
      el = cardEl(c, { cls: 'in-hand' });
      el.addEventListener('click', () => playCard(c));
      el.addEventListener('pointerdown', () => el.classList.add('lift'));
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => el.addEventListener(e, () => el.classList.remove('lift')));
      S.handEls.set(c.id, el);
      box.appendChild(el);
      if (S.initialized && !settings.lite) {
        el.style.transition = 'none';
        el.style.transform = fromDeck;
        el.classList.add('flip');
        void el.offsetWidth;
        el.style.transition = '';
        el.style.transitionDelay = `${(deal ? newIdx * 90 : newIdx * 120) + (deal ? 250 : 0)}ms`;
        el.style.animationDelay = el.style.transitionDelay;
        newIdx++;
      }
    } else {
      el.style.transitionDelay = '0ms';
    }
    const hint = settings.hints && myTurn();
    const ok = hint && hintPlayable(c, g);
    el.classList.toggle('playable', ok);
    el.classList.toggle('dim', hint && !ok);
    el.style.zIndex = i + 1;
    el.style.transform = target;
  });
  S.initialized = true;
}

// ---------- анимации ----------
// Бросок карты на стол: дуга, вращение, у соперника — переворот в полёте, затем хлопок о стол
function throwCard(card, from, { delay = 0, flip = false } = {}) {
  const pile = $('#pile');
  const top = pile.lastElementChild;
  const to = rectOf(pile);
  if (!from || !to || !top) return;
  if (settings.lite) { setTimeout(() => sfx.land(), delay); return; }
  const dur = 560;
  top.style.visibility = 'hidden';
  const el = cardEl(flip ? null : card, { back: flip });
  el.classList.add('flyer', 'airborne');
  if (flip) el.classList.add('flipping');
  Object.assign(el.style, { width: from.width + 'px', left: from.left + 'px', top: from.top + 'px' });
  el.style.setProperty('--card-w', from.width + 'px');
  const endRot = parseFloat(top.style.getPropertyValue('--r')) || 0;
  const dirX = Math.sign((to.left - from.left) || 1);
  const spin = 360 * dirX;
  const dx = to.left - from.left + (parseFloat(top.style.getPropertyValue('--x')) || 0);
  const dy = to.top - from.top;
  const sc = to.width / from.width;
  const arc = Math.min(140, 50 + Math.abs(dy) * 0.35);
  const startRot = (Math.random() - 0.5) * 16;
  setTimeout(() => {
    document.body.appendChild(el);
    sfx.flick();
    el.animate([
      { transform: `translate(0,0) rotate(${startRot}deg) scale(1)` },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arc}px) rotate(${startRot + spin * 0.55}deg) scale(${(1 + sc) / 2 * 1.22})`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${endRot + spin}deg) scale(${sc})` },
    ], { duration: dur, easing: 'cubic-bezier(.12,.75,.25,1)', fill: 'forwards' });
    if (flip) { // переворот рубашкой вниз прямо в полёте
      const half = dur * 0.28;
      el.firstElementChild.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: half, easing: 'ease-in', fill: 'forwards' });
      setTimeout(() => {
        el.innerHTML = cardEl(card).innerHTML;
        el.firstElementChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: half, easing: 'ease-out' });
      }, half);
    }
    setTimeout(() => {
      el.remove();
      sfx.land();
      top.style.visibility = '';
      top.classList.remove('thud'); void top.offsetWidth; top.classList.add('thud');
      const pr = rectOf(pile);
      const puff = document.createElement('div');
      puff.className = 'puff';
      Object.assign(puff.style, { left: pr.left + pr.width / 2 + 'px', top: pr.top + pr.height / 2 + 'px' });
      document.body.appendChild(puff);
      setTimeout(() => puff.remove(), 500);
    }, dur);
  }, delay);
}

function fly(el, from, to, { delay = 0, rotate = 0, dur = 420 } = {}) {
  if (!from || !to || settings.lite) return;
  el.classList.add('flyer');
  Object.assign(el.style, { width: from.width + 'px', left: from.left + 'px', top: from.top + 'px', transitionDuration: dur + 'ms' });
  el.style.setProperty('--card-w', from.width + 'px');
  document.body.appendChild(el);
  setTimeout(() => {
    requestAnimationFrame(() => {
      el.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}) rotate(${rotate}deg)`;
    });
  }, delay);
  setTimeout(() => el.remove(), dur + delay + 40);
}

function animateEvents(events, before, firstLoad) {
  if (firstLoad) return;
  const g = S.game;
  let t = 0;
  for (const ev of events) {
    if (ev.type === 'roundStart') {
      // раздача соперникам: рубашки летят из колоды
      const db = rectOf($('#deck'));
      g.players.filter(p => p.id !== S.me?.id && !p.out).forEach((p, k) => {
        const to = centerRect(rectOf($(`#opponents .opp[data-id="${CSS.escape(p.id)}"] .ava-wrap`)), 26);
        for (let i = 0; i < Math.min(p.cards, 5); i++) fly(cardEl(null, { back: true }), db, to, { delay: 250 + i * 90 + k * 30, dur: 380 });
      });
      haptic('light');
      sfx.shuffle();
      for (let i = 0; i < 10; i++) sfx.deal(0.35 + i * 0.09);
    } else if (ev.type === 'play') {
      const isMe = ev.playerId === S.me?.id;
      if (isMe && ev.card.rank === '8' && S.prevPlay?.by === S.me?.id && S.prevPlay.rank === '8') unlock('eight_chain');
      S.prevPlay = { by: ev.playerId, rank: ev.card.rank, id: ev.card.id };
      const from = isMe ? before.hand.get(ev.card.id) : centerRect(before.opp[ev.playerId], 40);
      if (isMe && S.thrown.has(ev.card.id)) S.thrown.delete(ev.card.id); // уже летит
      else throwCard(ev.card, from, { delay: t, flip: !isMe });
      if (ev.card.rank === 'Q' && ev.suit) bubble(ev.playerId, SUIT_SYMBOL[ev.suit], t);
      setTimeout(() => haptic(isMe ? 'medium' : 'light'), t + 380);
      t += 260;
    } else if ((ev.type === 'draw' && ev.count) || ev.type === 'penalty') {
      if (ev.playerId !== S.me?.id) {
        const db = rectOf($('#deck'));
        const to = centerRect(rectOf($(`#opponents .opp[data-id="${CSS.escape(ev.playerId)}"] .ava-wrap`)), 26);
        for (let i = 0; i < (ev.count || 1); i++) fly(cardEl(null, { back: true }), db, to, { delay: t + i * 110, dur: 380 });
      } else if (ev.type === 'penalty') { haptic('warning'); setTimeout(() => shakeScreen(), t); }
      setTimeout(() => (ev.type === 'penalty' ? sfx.penalty() : sfx.draw()), t);
      if (ev.type === 'penalty') bubble(ev.playerId, `+${ev.count}`, t);
      if (ev.type === 'penalty' && ev.card?.id === 'K-spades' && S.prevPlay?.by === S.me?.id) unlock('king_penalty');
      t += 150;
    } else if (ev.type === 'pending') {
      bubble(ev.playerId, `+${ev.count}?`, t + 300);
      if (ev.playerId === S.me?.id) setTimeout(() => { haptic('warning'); sfx.penalty(); }, t + 350);
    } else if (ev.type === 'transfer') {
      bubble(ev.playerId, `Перевёл! +${ev.count}`, t + 300);
      setTimeout(sfx.skip, t + 350);
      if (ev.to === S.me?.id) setTimeout(() => { haptic('warning'); shakeScreen(); }, t + 350);
    } else if (ev.type === 'lastCard') {
      setTimeout(() => announceLast(ev.playerId), t + 350);
    } else if (ev.type === 'skip') {
      bubble(ev.playerId, '⏭', t);
      setTimeout(sfx.skip, t + 300);
    } else if (ev.type === 'pass') {
      bubble(ev.playerId, 'пас', t);
    } else if (ev.type === 'reshuffle') {
      $('#deck').classList.remove('shuffle-anim'); void $('#deck').offsetWidth; $('#deck').classList.add('shuffle-anim'); sfx.shuffle();
    }
  }
  if (myTurn() && S.wasTurn !== true) setTimeout(() => { haptic('heavy'); sfx.turn(); }, t + 200);
  S.wasTurn = myTurn();
}

function announceLast(playerId) {
  const me = playerId === S.me?.id;
  const b = $('#last-banner');
  b.innerHTML = me ? '☝️ У вас <b>последняя карта!</b>' : `☝️ У <b>${esc(nameOf(playerId))}</b> последняя карта!`;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  sfx.lastCard(); haptic('warning');
  clearTimeout(S.lastTimer);
  S.lastTimer = setTimeout(() => b.classList.remove('show'), 2600);
}

function shakeScreen() {
  const t = $('.table');
  t.classList.remove('jolt'); void t.offsetWidth; t.classList.add('jolt');
}

function bubble(playerId, text, delay = 0) {
  setTimeout(() => {
    const host = playerId === S.me?.id ? $('#me-info') : $(`#opponents .opp[data-id="${CSS.escape(playerId)}"]`);
    if (!host) return;
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    host.appendChild(b);
    setTimeout(() => b.remove(), 1700);
  }, delay);
}

// ---------- итоги ----------
function resultRow(r, { win = false, showHand = true, target = 108 } = {}) {
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
  if (r.note) row.insertAdjacentHTML('beforeend', `<span class="note ${r.note}">${r.note === 'out' ? 'вылет' : r.note === 'half' ? 'пополам!' : 'обнуление!'}</span>`);
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
  [...rr.results].sort((a, b) => a.delta - b.delta).forEach((r, i) => {
    const row = resultRow(r, { win: r.id === rr.winnerId, target: g.target });
    row.style.animationDelay = `${150 + i * 110}ms`;
    body.appendChild(row);
  });
  haptic(w ? 'success' : 'warning');
  w ? sfx.win() : sfx.stamp();
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
  if (!$('#modal-over').classList.contains('open')) { haptic(win ? 'success' : 'error'); win ? sfx.win() : sfx.lose(); openModal('over'); }
}

function renderScores() {
  const g = S.game;
  const body = $('#scores-body');
  body.innerHTML = '';
  if (!g) return;
  [...g.players].sort((a, b) => a.out - b.out || a.score - b.score)
    .forEach(p => body.appendChild(resultRow({ ...p, note: p.out ? 'out' : null }, { showHand: false, target: g.target })));
  body.insertAdjacentHTML('beforeend', `<p class="hint center">Больше ${g.target} — вылет · ровно ${g.target - 1} — пополам · ровно ${g.target} — ноль</p>`);
}

window.addEventListener('resize', () => { if (S.game) renderHand(S.game); rerenderTable(); });

// ---------- эмодзи-чат ----------
const CHAT = ['😂', '😎', '😡', '😭', '🤔', '😈', '👍', '👏', '🔥', '💩', '🙏', '🤝',
  'Удачи!', 'Ну ты даёшь!', 'Быстрее!', 'Ха-ха', 'Не повезло', 'Хорош!', 'Ещё партию?', 'GG'];
// ---------- чат: быстрые эмодзи + текст ----------
(function buildQuickEmo() {
  const box = $('#quick-emo');
  CHAT.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = i < 12 ? 'emo' : 'phrase';
    b.textContent = t;
    b.onclick = () => {
      const now = Date.now();
      if (now - (S.lastChat || 0) < 1200) return;
      S.lastChat = now;
      send({ type: 'chat', e: i });
      closeModal('chat');
      progress.stats.chats++; saveProgress(); checkGoals();
    };
    box.appendChild(b);
  });
})();
$$('[data-chat]').forEach(b => b.addEventListener('click', () => { haptic(); S.unread = 0; renderUnread(); openModal('chat'); scrollChat('#table-list'); }));
$$('.chat-form').forEach(f => f.addEventListener('submit', e => {
  e.preventDefault();
  const input = f.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  send({ type: 'say', text, where: f.dataset.where });
  input.value = '';
  sfx.pop();
}));
const fmtTime = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function chatItem(m) {
  const li = document.createElement('li');
  if (m.sys) { li.className = 'sys'; li.textContent = m.text; return li; }
  li.className = m.from === S.me?.id ? 'mine' : '';
  if (m.from !== S.me?.id) li.appendChild(avatar({ name: m.name, photo: m.photo }));
  li.insertAdjacentHTML('beforeend', `<div class="msg">${m.from === S.me?.id ? '' : `<b>${esc(m.name)}</b>`}<span>${esc(m.text)}</span><time>${fmtTime(m.t)}</time></div>`);
  return li;
}
function scrollChat(sel) { const l = $(sel); if (l) l.scrollTop = l.scrollHeight; }
function addChat(where, m, history = false) {
  const lists = where === 'global' ? ['#global-list'] : ['#room-list', '#table-list'];
  for (const sel of lists) {
    const ul = $(sel);
    ul.appendChild(chatItem(m));
    while (ul.children.length > 60) ul.firstElementChild.remove();
    scrollChat(sel);
  }
  if (history) return;
  if (where === 'global') {
    if (S.screen !== 'chat' && m.from !== S.me?.id) { S.gUnread = (S.gUnread || 0) + 1; renderUnread(); }
    return;
  }
  if (m.sys || m.from === S.me?.id) return;
  if (['game', 'table'].includes(S.screen) && !$('#modal-chat').classList.contains('open')) {
    S.unread = (S.unread || 0) + 1; renderUnread();
    onChat({ from: m.from, text: m.text.length > 40 ? m.text.slice(0, 38) + '…' : m.text });
  }
  sfx.pop();
}
function renderUnread() {
  $$('[data-chat] .badge').forEach(b => { b.textContent = S.unread || ''; b.classList.toggle('hidden', !S.unread); });
  const g = $('#global-badge'); g.textContent = S.gUnread || ''; g.classList.toggle('hidden', !S.gUnread);
}
function onChat(m) {
  const text = m.text ?? CHAT[m.e];
  if (!text || !['game', 'table'].includes(S.screen)) return;
  const host = S.screen === 'table' ? chatHost(m.from) : m.from === S.me?.id ? $('#me-info') : $(`#opponents .opp[data-id="${CSS.escape(m.from)}"]`);
  if (!host) return;
  const b = document.createElement('div');
  b.className = 'chat-bubble' + (m.e != null && m.e < 12 ? ' big' : '');
  b.textContent = text;
  host.appendChild(b);
  sfx.pop();
  setTimeout(() => b.remove(), 2600);
}

// ---------- учёт достижений по итогам ----------
function trackRound(g) {
  const rr = g.roundResult;
  const key = `${S.room?.code}:${g.round}:${rr?.winnerId}`;
  if (!rr || S.roundKey === key) return;
  S.roundKey = key;
  const meId = S.me?.id;
  if (rr.winnerId === meId) {
    progress.stats.roundsWon++;
    unlock('round_closer');
    if (rr.lastCard?.id === 'K-spades') unlock('king_finish');
    if (rr.lastCard?.rank === 'Q') unlock('queen_finish');
  }
  const mine = rr.results.find(r => r.id === meId);
  if (mine?.note === 'reset') unlock('reset_108');
  if (mine?.note === 'half') unlock('half_107');
  if (mine && mine.score < 0) unlock('negative');
  saveProgress(); checkGoals();
}
function trackGame(g) {
  const key = `${S.room?.code}:over:${g.round}:${g.winnerId}`;
  if (S.gameKey === key) return;
  S.gameKey = key;
  const st = progress.stats;
  const meId = S.me?.id;
  st.p_108 = 1;
  countGame(g.winnerId === meId);
  if (g.winnerId === meId) {
    if (g.players.length >= 4) unlock('party_win');
    const me = g.players.find(p => p.id === meId);
    if (me && me.score > 90) unlock('comeback');
  }
  saveProgress(); checkGoals();
}
function countGame(won) {
  const st = progress.stats;
  st.games++;
  unlock('first_game');
  if (S.room?.private && (S.room.seats || []).filter(x => !x.bot).length >= 2) unlock('friends');
  if (won) {
    st.wins++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
    unlock('first_win');
    if (st.streak >= 3) unlock('streak_3');
  } else st.streak = 0;
}
// Дурак, Бура, Покер, Блэкджек — table.js сообщает о конце партии/раздачи
function trackTable(g) {
  const meId = S.me?.id, st = progress.stats;
  if (g.game === 'blackjack') {
    const me = g.players.find(p => p.id === meId);
    if (g.phase !== 'roundOver' || !me?.result) return;
    const key = `${S.room?.code}:bj:${g.round}`;
    if (S.tableKey === key) return;
    S.tableKey = key;
    st.p_blackjack = 1;
    if (me.result === 'win' || me.result === 'blackjack') { st.bjWins = (st.bjWins || 0) + 1; unlock('bj_win'); }
    if (me.result === 'blackjack') unlock('bj_natural');
    if (me.result === 'bust') unlock('bj_bust');
    saveProgress(); checkGoals();
    return;
  }
  const was = S.tablePhase;
  S.tablePhase = g.phase;
  if (g.phase !== 'gameOver' || was === 'gameOver') return;
  st['p_' + g.game] = 1;
  if (g.game === 'durak') {
    const safe = g.durakId !== meId;
    countGame(safe && !!g.durakId);
    if (safe) {
      st.durakWins = (st.durakWins || 0) + 1; unlock('durak_safe');
      if (g.players.find(p => p.id === meId)?.place === 1) unlock('durak_first');
      if (g.players.length >= 4) unlock('durak_party');
    } else unlock('durak_fool');
  } else {
    const won = g.winnerId === meId;
    countGame(won);
    if (won && g.game === 'bura') {
      st.buraWins = (st.buraWins || 0) + 1; unlock('bura_win');
      if (g.players.every(p => p.id === meId || p.points < 10)) unlock('bura_dry');
    }
    if (won && g.game === 'poker') {
      st.pokerWins = (st.pokerWins || 0) + 1; unlock('poker_win');
      if (g.players.length >= 4) unlock('poker_party');
    }
  }
  saveProgress(); checkGoals();
}

// Кнопки бота «С друзьями» / «С ботами» открывают сразу нужный экран
{
  const go = new URLSearchParams(location.search).get('go');
  if (['friends', 'practice'].includes(go) && !startParam) openHub(S.gameId);
}
