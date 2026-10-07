// Бура: 36 карт, 2–4 игрока, по 3 карты, козырь — открытая карта под колодой.
// Ходят 1–3 картами одной масти. Ответ — столько же карт: побил все — забрал взятку.
// Очки во взятках: Т=11, 10=10, К=4, Д=3, В=2. Кто первым набрал 31 — выиграл. Три козыря на руке — «Бура», сразу победа.
import { GameError, RANKS36, makeDeck, shuffle, EventLog } from './common.js';

const V = r => RANKS36.indexOf(r);
export const BURA_POINTS = { A: 11, '10': 10, K: 4, Q: 3, J: 2 };
const pts = cards => cards.reduce((s, c) => s + (BURA_POINTS[c.rank] || 0), 0);
// старшинство в Буре: 10 выше короля
const ORDER = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const O = r => ORDER.indexOf(r);

export class Bura extends EventLog {
  constructor(players, { rnd = Math.random } = {}) {
    super();
    if (players.length < 2 || players.length > 4) throw new GameError('Бура — на 2–4 игроков');
    this.rnd = rnd;
    this.players = players.map(p => ({ id: p.id, name: p.name, hand: [], points: 0, tricks: 0 }));
    this.deck = shuffle(makeDeck(), rnd);
    this.trumpCard = this.deck[0];
    this.trump = this.trumpCard.suit;
    for (let k = 0; k < 3; k++) for (const p of this.players) p.hand.push(this.deck.pop());
    this.leader = Math.floor(rnd() * this.players.length);
    this.phase = 'playing';
    this.newTrick();
    this.emit({ type: 'deal' });
    this.checkBura();
  }

  idx(id) { const i = this.players.findIndex(p => p.id === id); if (i < 0) throw new GameError('Игрок не найден'); return i; }
  beats(a, d) { if (d.suit === a.suit) return O(d.rank) > O(a.rank); return d.suit === this.trump && a.suit !== this.trump; }

  newTrick() {
    this.trick = [];          // [{ playerId, cards, beat }]
    this.best = null;         // индекс в trick, чья комбинация сейчас старшая
    this.turn = this.leader;
  }

  checkBura() {
    for (const p of this.players) if (p.hand.length === 3 && p.hand.every(c => c.suit === this.trump)) {
      this.end(p.id, 'bura');
      return true;
    }
    return false;
  }

  // покрывает ли набор cover все карты набора base (в любом сочетании)
  covers(base, cover) {
    const used = new Set();
    const sortedBase = [...base].sort((a, b) => O(b.rank) - O(a.rank));
    for (const b of sortedBase) {
      const opts = cover.map((c, k) => k).filter(k => !used.has(k) && this.beats(b, cover[k]));
      if (!opts.length) return false;
      opts.sort((x, y) => (cover[x].suit === this.trump) - (cover[y].suit === this.trump) || O(cover[x].rank) - O(cover[y].rank));
      used.add(opts[0]);
    }
    return true;
  }

  act(pid, msg) {
    if (this.phase !== 'playing') throw new GameError('Игра окончена');
    const i = this.idx(pid), p = this.players[i];
    if (i !== this.turn) throw new GameError('Сейчас не ваш ход');
    if (msg.type !== 'play' || !Array.isArray(msg.cardIds)) throw new GameError('Выберите карты');
    const ids = [...new Set(msg.cardIds)];
    const cards = ids.map(id => p.hand.find(c => c.id === id));
    if (cards.some(c => !c)) throw new GameError('Таких карт нет');
    if (this.trick.length === 0) {
      if (cards.length < 1 || cards.length > 3) throw new GameError('Ходят 1–3 картами');
      if (new Set(cards.map(c => c.suit)).size !== 1) throw new GameError('Ходят картами одной масти');
    } else if (cards.length !== this.trick[0].cards.length) throw new GameError(`Нужно положить ${this.trick[0].cards.length} карт(ы)`);
    p.hand = p.hand.filter(c => !ids.includes(c.id));
    let beat = false;
    if (this.trick.length === 0) { this.best = 0; }
    else if (this.covers(this.trick[this.best].cards, cards)) { beat = true; this.best = this.trick.length; }
    this.trick.push({ playerId: pid, cards, beat });
    this.emit({ type: this.trick.length === 1 ? 'lead' : 'answer', playerId: pid, cards, beat });
    if (this.trick.length < this.players.length) { this.turn = (i + 1) % this.players.length; return; }
    this.resolve();
  }

  resolve() {
    const winner = this.players.findIndex(p => p.id === this.trick[this.best].playerId);
    const all = this.trick.flatMap(t => t.cards);
    const w = this.players[winner];
    w.points += pts(all); w.tricks++;
    this.emit({ type: 'trick', playerId: w.id, points: pts(all), total: w.points });
    this.lastTrick = this.trick;
    if (w.points >= 31) return this.end(w.id, 'points');
    // добор по 1 карте по кругу от взявшего, пока у всех не по 3
    for (let r = 0; r < 3; r++) for (let k = 0; k < this.players.length; k++) {
      const p = this.players[(winner + k) % this.players.length];
      if (p.hand.length < 3 && this.deck.length) p.hand.push(this.deck.pop());
    }
    if (this.players.every(p => p.hand.length === 0)) {
      const top = [...this.players].sort((a, b) => b.points - a.points);
      return this.end(top[0].points === top[1].points ? null : top[0].id, 'end');
    }
    this.leader = winner;
    this.newTrick();
    if (this.players[this.leader].hand.length === 0) this.leader = this.players.findIndex(p => p.hand.length);
    this.turn = this.leader;
    this.checkBura();
  }

  end(winnerId, reason) {
    this.phase = 'gameOver';
    this.winnerId = winnerId;
    this.reason = reason;
    this.emit({ type: 'gameOver', winnerId, reason });
  }

  waiting() { return this.phase === 'playing' ? [this.players[this.turn].id] : []; }

  botMove(pid) {
    const p = this.players[this.idx(pid)];
    const cost = c => O(c.rank) + (c.suit === this.trump ? 12 : 0);
    if (this.trick.length === 0) {
      // ходим самой «жирной» мастью без козырей, если можно — несколькими картами
      const bySuit = {};
      for (const c of p.hand) (bySuit[c.suit] ||= []).push(c);
      const groups = Object.values(bySuit).sort((a, b) => b.length - a.length || pts(b) - pts(a));
      const g = groups.find(x => x[0].suit !== this.trump) || groups[0];
      return { type: 'play', cardIds: g.map(c => c.id) };
    }
    const need = this.trick[0].cards.length;
    const base = this.trick[this.best].cards;
    // перебор комбинаций нужного размера: побить подешевле, иначе сбросить мелочь
    const combos = [];
    const rec = (start, acc) => { if (acc.length === need) { combos.push(acc); return; } for (let k = start; k < p.hand.length; k++) rec(k + 1, [...acc, p.hand[k]]); };
    rec(0, []);
    const sum = cs => cs.reduce((s, c) => s + cost(c), 0);
    const beating = combos.filter(cs => this.covers(base, cs)).sort((a, b) => sum(a) - sum(b));
    const trickPts = pts(this.trick.flatMap(t => t.cards));
    if (beating.length && (trickPts >= 10 || sum(beating[0]) < 14 || this.rnd() < 0.5)) return { type: 'play', cardIds: beating[0].map(c => c.id) };
    const cheap = combos.sort((a, b) => pts(a) - pts(b) || sum(a) - sum(b))[0];
    return { type: 'play', cardIds: cheap.map(c => c.id) };
  }

  removePlayer(pid) {
    if (this.phase !== 'playing') return;
    const rest = this.players.filter(p => p.id !== pid).sort((a, b) => b.points - a.points);
    this.players.find(p => p.id === pid).left = true;
    this.end(rest[0].id, 'left');
  }

  result() { return { winners: this.winnerId ? [this.winnerId] : [], losers: this.players.filter(p => p.id !== this.winnerId).map(p => p.id) }; }

  view(forId) {
    const me = this.players.find(p => p.id === forId);
    return {
      phase: this.phase, trump: this.trump, trumpCard: this.deck.length ? this.trumpCard : null, deckCount: this.deck.length,
      trick: this.trick.map(t => ({ playerId: t.playerId, cards: t.cards, beat: t.beat })),
      lastTrick: this.lastTrick ?? null,
      need: this.trick.length ? this.trick[0].cards.length : 0,
      turn: this.phase === 'playing' ? this.players[this.turn].id : null,
      waiting: this.waiting(),
      players: this.players.map(p => ({ id: p.id, name: p.name, cards: p.hand.length, points: p.points, tricks: p.tricks, left: !!p.left })),
      hand: me ? me.hand : [], myPoints: me?.points ?? 0,
      winnerId: this.winnerId ?? null, reason: this.reason ?? null,
    };
  }
}
