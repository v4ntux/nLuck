// Столы для Дурака, Буры, Покера и Блэкджека. Общий каркас + отрисовщик на каждую игру.
import { cardEl, SUIT_SYMBOL, isRed } from './cards.js';

let C;            // контекст из app.js: send, me(), sfx, haptic, toast, avatar, esc, seatOf
let T = null;     // текущее состояние стола
const seenTable = new Set();
const seenHand = new Set();
const sel = new Set(); // выбранные карты (Бура)
let raiseOpen = false;

const $ = s => document.querySelector(s);
const meId = () => C.me()?.id;
const act = a => { C.haptic('medium'); C.send({ type: 'act', a }); };
const fmt = n => Number(n || 0).toLocaleString('ru-RU');

export function initTable(ctx) {
  C = ctx;
  $('#t-menu').addEventListener('click', () => C.openModal('menu'));
}

export function resetTableUI() { T = null; seenTable.clear(); seenHand.clear(); sel.clear(); raiseOpen = false; for (const el of handEls.values()) el.remove(); handEls.clear(); }

const SUIT_ORDER = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const sortHand = (cards, trump) => [...cards].sort((a, b) =>
  ((a.suit === trump) - (b.suit === trump)) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));

// ---------- общие куски ----------
function card(c, cls = '') {
  const el = cardEl(c, { back: !c, cls });
  if (c && !seenTable.has(c.id)) { el.dataset.fresh = '1'; seenTable.add(c.id); }
  return el;
}

function opps(players, info) {
  const box = $('#t-opps');
  box.innerHTML = '';
  const ps = players;
  const i = Math.max(0, ps.findIndex(p => p.id === meId()));
  const order = [...ps.slice(i + 1), ...ps.slice(0, i)].filter(p => p.id !== meId());
  for (const p of order) {
    const d = info(p);
    const seat = C.seatOf(p.id);
    const el = document.createElement('div');
    el.className = 'opp' + (d.turn ? ' turn' : '') + (d.dim ? ' out' : '');
    el.dataset.id = p.id;
    const wrap = document.createElement('div');
    wrap.className = 'ava-wrap';
    wrap.appendChild(C.avatar({ ...seat, name: p.name, bot: seat?.bot }));
    if (d.badge) wrap.insertAdjacentHTML('beforeend', `<span class="cnt">${d.badge}</span>`);
    if (d.role) wrap.insertAdjacentHTML('beforeend', `<span class="role">${d.role}</span>`);
    el.appendChild(wrap);
    el.insertAdjacentHTML('beforeend', `<div class="nm">${C.esc(p.name)}</div><div class="sc">${d.sub ?? ''}</div>`);
    if (d.cards) {
      const mini = document.createElement('div');
      mini.className = 'mini';
      mini.innerHTML = '<i></i>'.repeat(Math.min(d.cards, 7));
      el.appendChild(mini);
    }
    if (d.show?.length) {
      const sh = document.createElement('div');
      sh.className = 'opp-show';
      d.show.forEach(c => sh.appendChild(cardEl(c, { back: !c })));
      el.appendChild(sh);
    }
    box.appendChild(el);
  }
}

function meRow(extra = '') {
  const box = $('#t-me');
  box.innerHTML = '';
  box.appendChild(C.avatar(C.me()));
  box.insertAdjacentHTML('beforeend', `<span class="nm">${C.esc(C.me()?.name)}</span>${extra}`);
}

function actions(btns) {
  const box = $('#t-actions');
  box.innerHTML = '';
  box.style.gridTemplateColumns = `repeat(${Math.max(1, btns.length)}, 1fr)`;
  for (const b of btns) {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    el.innerHTML = b.label;
    el.disabled = !!b.disabled;
    el.onclick = b.onClick;
    box.appendChild(el);
  }
}

const handEls = new Map();
function hand(cards, { onTap, selectable = false, playable = () => true, big = false } = {}) {
  const box = $('#t-hand');
  box.classList.toggle('big', big);
  const ids = new Set(cards.map(c => c.id));
  for (const [id, el] of handEls) if (!ids.has(id) || el.parentNode !== box) { el.remove(); handEls.delete(id); }
  const n = cards.length;
  const W = box.clientWidth || 360;
  const cw = big ? 96 : 80;
  const step = n > 1 ? Math.min(cw * 0.66, (W - cw * 1.3 - 12) / (n - 1)) : 0;
  const spread = n > 7 ? 10 : Math.min(22, n * 4);
  const deck = $('#t-center .t-deck')?.getBoundingClientRect();
  const hb = box.getBoundingClientRect();
  let fresh = 0;
  cards.forEach((c, i) => {
    const half = (n - 1) / 2, off = i - half, norm = half ? off / half : 0;
    let el = handEls.get(c.id);
    if (!el) {
      el = cardEl(c, { cls: 'in-hand' });
      el.style.setProperty('--card-w', cw + 'px');
      el.onclick = () => {
        const cur = el._card;
        if (el._selectable) { sel.has(cur.id) ? sel.delete(cur.id) : sel.add(cur.id); C.sfx.click(); render(); return; }
        el._onTap?.(cur, el);
      };
      handEls.set(c.id, el);
      box.appendChild(el);
      // новая карта прилетает из колоды (или сверху, если колоды нет)
      if (!C.lite()) {
        const fx = deck ? deck.left + deck.width / 2 - (hb.left + hb.width / 2) : 0;
        const fy = deck ? deck.top - hb.top : -220;
        el.animate([{ translate: `${fx}px ${fy}px`, scale: '.7', opacity: 0 }, { translate: '0 0', scale: '1', opacity: 1 }],
          { duration: 480, delay: fresh++ * 70, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      }
    }
    el._card = c; el._onTap = onTap; el._selectable = selectable;
    el.style.setProperty('--card-w', cw + 'px');
    el.classList.toggle('picked', sel.has(c.id));
    el.classList.toggle('dim', !playable(c));
    el.style.transform = `translate(calc(-50% + ${off * step}px), ${norm * norm * 10 - (sel.has(c.id) ? 22 : 0)}px) rotate(${norm * spread / 2}deg)`;
    el.style.zIndex = i + 1;
    if (el !== box.children[i]) box.insertBefore(el, box.children[i] || null);
  });
}

function status(html) { $('#t-status').innerHTML = html || ''; }
const nameOf = (players, id) => (id === meId() ? 'Вы' : players.find(p => p.id === id)?.name || '?');

// ---------- точка входа ----------
const TITLES = { durak: 'Дурак', bura: 'Бура', poker: 'Покер', blackjack: 'Блэкджек' };

export function onTableGame(g) {
  const prev = T;
  T = g;
  if (!prev || prev.game !== g.game) { seenTable.clear(); seenHand.clear(); sel.clear(); for (const el of handEls.values()) el.remove(); handEls.clear(); }
  // кто какую карту положил — чтобы она прилетела от него
  T._from = new Map();
  for (const ev of g.events || []) {
    const cs = ev.card ? [ev.card] : ev.cards || [];
    for (const c of cs) T._from.set(c.id, ev.playerId);
  }
  $('#t-title').textContent = TITLES[g.game] || '';
  $('#screen-table').dataset.game = g.game;
  playSounds(g.events || []);
  render();
  if (g.phase === 'gameOver') setTimeout(renderOver, 900);
}

export function rerender() { if (T) render(); }

function render() {
  if (!T) return;
  const before = new Map();
  for (const el of document.querySelectorAll('#t-hand .card[data-id]')) before.set(el.dataset.id, el.getBoundingClientRect());
  const opp = new Map();
  for (const el of document.querySelectorAll('#t-opps .opp')) opp.set(el.dataset.id, el.querySelector('.ava-wrap').getBoundingClientRect());
  ({ durak: renderDurak, bura: renderBura, poker: renderPoker, blackjack: renderBlackjack })[T.game]?.(T);
  try { C.track?.(T); } catch (e) { console.warn(e); }
  if (C.lite()) return;
  // новые карты на столе прилетают из руки или от соперника (FLIP, только transform)
  let k = 0;
  for (const el of document.querySelectorAll('#t-center .card[data-fresh]')) {
    delete el.dataset.fresh;
    const to = el.getBoundingClientRect();
    const who = T._from?.get(el.dataset.id);
    const from = before.get(el.dataset.id) || (who && opp.get(who)) || null;
    const delay = k++ * 60;
    if (from) {
      const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const sc = Math.max(0.35, Math.min(1.6, from.width / to.width));
      el.animate([{ translate: `${dx}px ${dy}px`, scale: String(sc), rotate: '-14deg' }, { translate: '0 0', scale: '1', rotate: '0deg' }],
        { duration: 460, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
    } else {
      el.animate([{ opacity: 0, translate: '0 -30px', scale: '1.15' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 380, delay, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
    }
  }
}

function playSounds(events) {
  let t = 0;
  for (const ev of events) {
    const at = t;
    const mine = ev.playerId === meId();
    switch (ev.type) {
      case 'attack': case 'defend': case 'lead': case 'answer': case 'hit': case 'double':
        setTimeout(() => { C.sfx.flick(); setTimeout(C.sfx.land, 180); }, at); t += 160; break;
      case 'took': setTimeout(() => { C.sfx.draw(); if (!mine) bubble(ev.playerId, 'Взял'); }, at); break;
      case 'taking': setTimeout(() => bubble(ev.playerId, 'Беру'), at); break;
      case 'bito': setTimeout(() => C.sfx.shuffle(), at); break;
      case 'pass': setTimeout(() => bubble(ev.playerId, ev.label || 'Пас'), at); break;
      case 'draw': setTimeout(() => C.sfx.deal(), at); break;
      case 'deal': case 'roundStart': setTimeout(() => C.sfx.shuffle(), at); break;
      case 'trick': setTimeout(() => { C.sfx.draw(); bubble(ev.playerId, `+${ev.points}`); }, at + 300); break;
      case 'action': setTimeout(() => { if (!mine) bubble(ev.playerId, ev.label); C.sfx[ev.action === 'fold' ? 'click' : 'deal'](); }, at); break;
      case 'board': setTimeout(C.sfx.flick, at); break;
      case 'bet': setTimeout(C.sfx.pop, at); break;
      case 'bust': setTimeout(() => { C.sfx.penalty(); bubble(ev.playerId, 'Перебор!'); }, at); break;
      case 'out': setTimeout(() => bubble(ev.playerId, `🏁 ${ev.place}`), at); break;
    }
  }
  if (T && (T.waiting || []).includes(meId()) && !T._wasMine) setTimeout(() => { C.sfx.turn(); C.haptic('heavy'); }, t + 200);
  if (T) T._wasMine = (T.waiting || []).includes(meId());
}

export function bubble(playerId, text) {
  const host = playerId === meId() ? $('#t-me') : $(`#t-opps .opp[data-id="${CSS.escape(playerId)}"]`);
  if (!host || !text) return;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  host.appendChild(b);
  setTimeout(() => b.remove(), 1700);
}
export const chatHost = id => (id === meId() ? $('#t-me') : $(`#t-opps .opp[data-id="${CSS.escape(id)}"]`));

// ---------- Дурак ----------
function renderDurak(g) {
  const me = meId();
  const iDef = g.defender === me, iAtt = g.attacker === me;
  opps(g.players, p => ({
    turn: g.waiting.includes(p.id), dim: p.out, cards: p.out ? 0 : p.cards, badge: p.out ? null : p.cards,
    role: p.id === g.attacker ? '⚔️' : p.id === g.defender ? '🛡' : null,
    sub: p.out ? (p.place ? `🏁 ${p.place} место` : 'вышел') : g.durakId === p.id ? '🤡 Дурак' : '',
  }));
  const c = $('#t-center');
  c.innerHTML = '';
  const deck = document.createElement('div');
  deck.className = 't-deck';
  if (g.trumpCard) { const tc = cardEl(g.trumpCard, { cls: 'trump-card' }); deck.appendChild(tc); }
  if (g.deckCount > 1) deck.appendChild(cardEl(null, { back: true, cls: 'deck-top' }));
  deck.insertAdjacentHTML('beforeend', `<span class="t-count">${g.deckCount || ''}</span><span class="t-trump ${isRed(g.trump) ? 'red' : ''}">${SUIT_SYMBOL[g.trump]}</span>`);
  c.appendChild(deck);
  const tbl = document.createElement('div');
  tbl.className = 'durak-table';
  g.table.forEach((t, k) => {
    const pair = document.createElement('div');
    pair.className = 'pair';
    pair.appendChild(card(t.a));
    if (t.d) pair.appendChild(card(t.d, 'cover'));
    pair.style.animationDelay = `${k * 30}ms`;
    tbl.appendChild(pair);
  });
  if (!g.table.length) tbl.innerHTML = `<div class="t-hint">${g.phase === 'gameOver' ? '' : iAtt ? 'Ваш ход — положите карту' : `Ходит ${C.esc(nameOf(g.players, g.attacker))}`}</div>`;
  c.appendChild(tbl);
  const meP = g.players.find(p => p.id === me);
  status(g.phase !== 'playing' ? '' : !g.table.length ? (iAtt ? '⚔️ Ваш ход' : '') : iDef ? (g.taking ? 'Вы берёте — ждём подкидных' : '🛡 Отбивайтесь') : 'Можно подкидывать');
  meRow(`<span class="sc">${meP?.out ? `🏁 ${meP.place || ''}` : iAtt ? '⚔️' : iDef ? '🛡' : ''}</span>`);
  const btns = [];
  if (iDef && g.table.length && !g.taking && g.table.some(t => !t.d)) btns.push({ label: 'Беру', cls: 'btn-primary', onClick: () => act({ type: 'take' }) });
  if (g.canPass) btns.push({ label: g.taking ? 'Хватит' : 'Бито', cls: 'btn-primary', onClick: () => act({ type: 'pass' }) });
  if (!btns.length) btns.push({ label: g.waiting.includes(me) ? (g.table.length ? 'Бейте или подкидывайте' : 'Ваш ход — выберите карту') : `Ходит ${C.esc(nameOf(g.players, g.waiting[0]))}`, disabled: true });
  actions(btns);
  const RV = r => ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].indexOf(r);
  const beats = (a, d) => d.suit === a.suit ? RV(d.rank) > RV(a.rank) : d.suit === g.trump && a.suit !== g.trump;
  const ranks = new Set(g.table.flatMap(t => [t.a.rank, t.d?.rank]).filter(Boolean));
  const defending = iDef && !g.taking && g.table.some(t => !t.d);
  const canPlay = c2 => g.phase !== 'playing' || !g.waiting.includes(me) ? true
    : defending ? g.table.some(t => !t.d && beats(t.a, c2))
    : iDef ? false : !g.table.length ? iAtt : ranks.has(c2.rank);
  hand(sortHand(g.hand, g.trump), {
    playable: c2 => !C.hints() || canPlay(c2),
    onTap: c2 => {
      if (!canPlay(c2)) { C.sfx?.error?.(); return; }
      if (iDef && !g.taking && g.table.some(t => !t.d)) act({ type: 'defend', cardId: c2.id });
      else act({ type: 'attack', cardId: c2.id });
    },
  });
}

// ---------- Бура ----------
function renderBura(g) {
  const me = meId();
  const mine = g.turn === me;
  opps(g.players, p => ({ turn: g.turn === p.id, cards: p.cards, badge: p.cards, sub: `${p.points} очк.`, role: g.winnerId === p.id ? '🏆' : null }));
  const c = $('#t-center');
  c.innerHTML = '';
  const deck = document.createElement('div');
  deck.className = 't-deck';
  if (g.trumpCard) deck.appendChild(cardEl(g.trumpCard, { cls: 'trump-card' }));
  if (g.deckCount > 1) deck.appendChild(cardEl(null, { back: true, cls: 'deck-top' }));
  deck.insertAdjacentHTML('beforeend', `<span class="t-count">${g.deckCount || ''}</span><span class="t-trump ${isRed(g.trump) ? 'red' : ''}">${SUIT_SYMBOL[g.trump]}</span>`);
  c.appendChild(deck);
  const tr = document.createElement('div');
  tr.className = 'bura-trick';
  const show = g.trick.length ? g.trick : [];
  for (const t of show) {
    const row = document.createElement('div');
    row.className = 'trick-row' + (t.beat ? ' beat' : '') + (show.length > 1 && !t.beat && t !== show[0] ? ' weak' : '');
    row.insertAdjacentHTML('beforeend', `<span class="who">${C.esc(nameOf(g.players, t.playerId))}</span>`);
    t.cards.forEach(x => row.appendChild(card(x)));
    tr.appendChild(row);
  }
  if (!show.length) tr.innerHTML = `<div class="t-hint">${g.phase === 'gameOver' ? '' : mine ? 'Ваш ход: 1–3 карты одной масти' : `Ходит ${C.esc(nameOf(g.players, g.turn))}`}</div>`;
  c.appendChild(tr);
  status(g.phase === 'playing' && mine && g.need ? `Положите ${g.need} карт${g.need === 1 ? 'у' : 'ы'} — побейте или сбросьте` : '');
  meRow(`<span class="sc">${g.myPoints} очк.</span>`);
  const n = sel.size;
  const pickedSuits = new Set(g.hand.filter(x => sel.has(x.id)).map(x => x.suit));
  const ok = mine && (g.need ? n === g.need : n >= 1 && n <= 3 && pickedSuits.size === 1);
  actions([{
    label: mine ? (n ? `Ходить (${n})` : g.need ? `Выберите ${g.need}` : 'Выберите карты') : 'Ждём…', cls: ok ? 'btn-primary' : '', disabled: !ok,
    onClick: () => { const ids = [...sel]; sel.clear(); act({ type: 'play', cardIds: ids }); },
  }]);
  for (const id of [...sel]) if (!g.hand.some(x => x.id === id)) sel.delete(id);
  hand(sortHand(g.hand, g.trump), { selectable: mine });
}

// ---------- Покер ----------
const STAGES = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер', showdown: 'Вскрытие' };
function renderPoker(g) {
  const me = meId();
  const meP = g.players.find(p => p.id === me) || {};
  const mine = g.turn === me && g.phase === 'playing';
  opps(g.players, p => ({
    turn: g.turn === p.id, dim: p.folded || p.out,
    role: p.id === g.button ? 'D' : null,
    sub: p.out ? 'выбыл' : `${fmt(p.chips)} ф.${p.bet ? ` · ${p.bet}` : ''}`,
    badge: p.lastAction && !p.out ? null : null,
    show: p.out ? [] : p.hole,
  }));
  for (const p of g.players) if (p.lastAction && p.id !== me) {
    const host = $(`#t-opps .opp[data-id="${CSS.escape(p.id)}"] .nm`);
    if (host) host.insertAdjacentHTML('afterend', `<div class="act-tag${p.won ? ' won' : ''}">${p.won ? `+${p.won}` : C.esc(p.lastAction)}</div>`);
  }
  const c = $('#t-center');
  c.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'board';
  for (let k = 0; k < 5; k++) {
    const x = g.community[k];
    if (x) board.appendChild(card(x));
    else board.insertAdjacentHTML('beforeend', '<div class="slot"></div>');
  }
  c.appendChild(board);
  c.insertAdjacentHTML('beforeend', `<div class="pot">Банк <b>${fmt(g.pot)}</b> · ${STAGES[g.stage] || ''} · блайнды ${g.sb}/${g.bb}</div>`);
  if (g.results && g.phase !== 'playing') {
    const r = g.results.map(x => `${x.winners.map(id => C.esc(nameOf(g.players, id))).join(', ')} +${fmt(x.amount)}${x.hand ? ` — ${x.hand}` : ''}`).join('<br>');
    c.insertAdjacentHTML('beforeend', `<div class="result-banner">${r}</div>`);
  }
  status(meP.handName ? `У вас: <b>${meP.handName}</b>` : meP.folded && g.phase === 'playing' ? 'Вы сбросили' : '');
  meRow(`<span class="sc">${fmt(meP.chips)} фишек</span>${meP.bet ? `<span class="bet-chip">${meP.bet}</span>` : ''}${g.button === me ? '<span class="dealer-btn">D</span>' : ''}`);
  if (mine) {
    const call = g.toCall;
    const btns = [
      { label: 'Пас', onClick: () => act({ type: 'fold' }) },
      call ? { label: `Колл ${fmt(Math.min(call, meP.chips))}`, cls: 'btn-primary', onClick: () => act({ type: 'call' }) } : { label: 'Чек', cls: 'btn-primary', onClick: () => act({ type: 'check' }) },
      { label: raiseOpen ? 'Скрыть' : 'Рейз ▴', onClick: () => { raiseOpen = !raiseOpen; render(); } },
    ];
    actions(btns);
    if (raiseOpen) {
      const presets = [
        ['Мин', g.minRaiseTo], ['½ банка', g.currentBet + Math.round(g.pot / 2)], ['Банк', g.currentBet + g.pot], ['Ва-банк', g.maxTo],
      ].map(([l, v]) => [l, Math.min(Math.max(v, g.minRaiseTo), g.maxTo)]);
      const row = document.createElement('div');
      row.className = 'raise-row';
      for (const [l, v] of presets) {
        const b = document.createElement('button');
        b.className = 'btn chip-btn';
        b.innerHTML = `${l}<small>${fmt(v)}</small>`;
        b.disabled = g.maxTo <= g.currentBet;
        b.onclick = () => { raiseOpen = false; act(v >= g.maxTo ? { type: 'allin' } : { type: 'raise', to: v }); };
        row.appendChild(b);
      }
      $('#t-actions').prepend(row);
      $('#t-actions').style.gridTemplateColumns = 'repeat(3, 1fr)';
    }
  } else {
    raiseOpen = false;
    actions([{ label: g.phase !== 'playing' ? 'Следующая раздача…' : meP.folded ? 'Вы сбросили' : `Ходит ${C.esc(nameOf(g.players, g.turn))}`, disabled: true }]);
  }
  hand(meP.hole?.filter(Boolean) || [], { big: true });
}

// ---------- Блэкджек ----------
const BJ_RES = { win: 'Выигрыш', blackjack: 'Блэкджек!', push: 'Ничья', lose: 'Проигрыш', bust: 'Перебор' };
function renderBlackjack(g) {
  const me = meId();
  const meP = g.players.find(p => p.id === me) || {};
  opps(g.players, p => ({
    turn: g.turn === p.id, dim: p.state === 'sitout',
    sub: p.bet ? `ставка ${p.bet}${p.value ? ` · ${p.value}` : ''}` : p.state === 'bet' ? 'ставит…' : '',
    show: p.hand, role: p.result ? (p.payout > 0 ? '✅' : '❌') : null,
  }));
  const c = $('#t-center');
  c.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'dealer';
  d.insertAdjacentHTML('beforeend', `<div class="who">Дилер ${g.dealerValue != null ? `· <b>${g.dealerValue}</b>` : ''}</div>`);
  const dc = document.createElement('div');
  dc.className = 'cards';
  if (!g.dealer.length) dc.innerHTML = '<div class="slot"></div><div class="slot"></div>';
  g.dealer.forEach(x => dc.appendChild(card(x)));
  d.appendChild(dc);
  c.appendChild(d);
  if (meP.result) c.insertAdjacentHTML('beforeend', `<div class="result-banner ${meP.payout > meP.bet ? 'win' : meP.payout === meP.bet ? '' : 'lose'}">${BJ_RES[meP.result]}${meP.payout ? ` · +${fmt(meP.payout)} 🪙` : ''}</div>`);
  status(meP.value ? `У вас <b>${meP.value}</b>${meP.bet ? ` · ставка ${meP.bet}` : ''}` : g.stage === 'bet' && meP.state === 'bet' ? 'Сделайте ставку' : '');
  meRow(`<span class="sc">${fmt(g.balance)} 🪙</span>`);
  if (g.stage === 'bet' && meP.state === 'bet') {
    const box = $('#t-actions');
    box.innerHTML = '';
    box.style.gridTemplateColumns = 'repeat(3, 1fr)';
    for (const b of g.bets) {
      const el = document.createElement('button');
      el.className = 'btn chip-btn bet-' + b;
      el.innerHTML = `<b>${b}</b><small>🪙</small>`;
      el.disabled = g.balance < b;
      el.onclick = () => act({ type: 'bet', amount: b });
      box.appendChild(el);
    }
    const skip = document.createElement('button');
    skip.className = 'btn btn-ghost wide';
    skip.textContent = g.balance < g.bets[0] ? 'Монет не хватает — бонус в профиле' : 'Пропустить раздачу';
    skip.onclick = () => act({ type: 'sitout' });
    box.appendChild(skip);
  } else if (g.turn === me) {
    actions([
      { label: 'Ещё', cls: 'btn-primary', onClick: () => act({ type: 'hit' }) },
      { label: 'Хватит', onClick: () => act({ type: 'stand' }) },
      { label: 'Удвоить', disabled: meP.hand.length !== 2 || g.balance < meP.bet, onClick: () => act({ type: 'double' }) },
    ]);
  } else {
    actions([{ label: g.phase === 'roundOver' ? 'Новая раздача…' : g.stage === 'bet' ? 'Ждём ставки…' : 'Ход дилера / других', disabled: true }]);
  }
  hand(meP.hand || [], { big: true });
}

// ---------- итог партии ----------
function renderOver() {
  const g = T;
  if (!g || g.phase !== 'gameOver' || g.game === 'blackjack') return;
  const me = meId();
  const winners = g.game === 'durak' ? g.players.filter(p => p.id !== g.durakId).map(p => p.id) : g.winnerId ? [g.winnerId] : [];
  const iWon = winners.includes(me);
  $('#over-title').textContent = g.game === 'durak' ? (g.durakId === me ? 'Вы — дурак 🤡' : g.durakId ? 'Вы не дурак!' : 'Ничья') : iWon ? 'Победа!' : g.winnerId ? `Победил ${nameOf(g.players, g.winnerId)}` : 'Ничья';
  $('.trophy').textContent = iWon ? '🏆' : '🃏';
  const body = $('#over-body');
  body.innerHTML = '';
  for (const p of g.players) {
    const row = document.createElement('div');
    row.className = 'res-row' + (winners.includes(p.id) ? ' win' : '');
    row.appendChild(C.avatar({ ...C.seatOf(p.id), name: p.name }));
    const extra = g.game === 'bura' ? `${p.points} очк.` : g.game === 'poker' ? `${fmt(p.chips)} фишек` : g.game === 'durak' ? (p.id === g.durakId ? 'дурак' : p.place ? `${p.place} место` : '') : '';
    const pay = g.payouts?.[p.id];
    row.insertAdjacentHTML('beforeend', `<span class="nm">${C.esc(p.name)}${p.id === me ? ' (вы)' : ''}</span><span class="d">${extra}</span>${pay ? `<span class="tot ${pay > 0 ? 'plus' : ''}">${pay > 0 ? '+' : ''}${pay} 🪙</span>` : ''}`);
    body.appendChild(row);
  }
  C.afterOver(iWon);
}
