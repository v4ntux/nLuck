// Дурак подкидной: 36 карт, 2–6 игроков, по 6 карт, козырь — нижняя карта колоды
import { GameError, RANKS36, makeDeck, shuffle, EventLog } from './common.js';

const V = r => RANKS36.indexOf(r);

export class Durak extends EventLog {
  constructor(players, { rnd = Math.random } = {}) {
    super();
    if (players.length < 2) throw new GameError('Нужно минимум 2 игрока');
    this.rnd = rnd;
    this.players = players.map(p => ({ id: p.id, name: p.name, hand: [], out: false, place: null }));
    this.deck = shuffle(makeDeck(), rnd);
    this.trumpCard = this.deck[0];           // лежит под колодой, берётся последней
    this.trump = this.trumpCard.suit;
    this.table = [];
    this.discardCount = 0;
    this.passed = new Set();
    this.taking = false;
    this.places = 0;
    this.phase = 'playing';
    for (let i = 0; i < 6; i++) for (const p of this.players) p.hand.push(this.deck.pop());
    // первым ходит тот, у кого младший козырь
    let best = -1, bestV = 99;
    this.players.forEach((p, i) => p.hand.forEach(c => { if (c.suit === this.trump && V(c.rank) < bestV) { bestV = V(c.rank); best = i; } }));
    this.attacker = best >= 0 ? best : Math.floor(rnd() * this.players.length);
    this.defender = this.nextActive(this.attacker);
    this.boutLimit = Math.min(6, this.players[this.defender].hand.length);
    this.emit({ type: 'deal' });
  }

  get active() { return this.players.filter(p => !p.out); }
  idx(id) { const i = this.players.findIndex(p => p.id === id); if (i < 0) throw new GameError('Игрок не найден'); return i; }
  nextActive(i) { let j = i; do { j = (j + 1) % this.players.length; } while (this.players[j].out && j !== i); return j; }

  beats(a, d) {
    if (d.suit === a.suit) return V(d.rank) > V(a.rank);
    return d.suit === this.trump && a.suit !== this.trump;
  }
  tableRanks() { const s = new Set(); for (const t of this.table) { s.add(t.a.rank); if (t.d) s.add(t.d.rank); } return s; }
  allBeaten() { return this.table.length > 0 && this.table.every(t => t.d); }
  throwers() {
    // подкидывать могут все, кроме отбивающегося (у кого есть карты)
    return this.players.map((p, i) => i).filter(i => i !== this.defender && !this.players[i].out && this.players[i].hand.length > 0);
  }

  canThrow(i, card) {
    if (i === this.defender || this.players[i].out) return false;
    if (this.table.length === 0) return i === this.attacker;
    if (this.table.length >= this.boutLimit) return false;
    const unbeaten = this.table.filter(t => !t.d).length;
    if (!this.taking && unbeaten >= this.players[this.defender].hand.length) return false;
    return this.tableRanks().has(card.rank);
  }

  act(pid, msg) {
    if (this.phase !== 'playing') throw new GameError('Игра окончена');
    const i = this.idx(pid), p = this.players[i];
    const take = id => { const k = p.hand.findIndex(c => c.id === id); if (k < 0) throw new GameError('Такой карты нет'); return p.hand.splice(k, 1)[0]; };
    switch (msg.type) {
      case 'attack': {
        const card = p.hand.find(c => c.id === msg.cardId);
        if (!card || !this.canThrow(i, card)) throw new GameError('Эту карту подкинуть нельзя');
        take(card.id);
        this.table.push({ a: card, d: null });
        this.passed.clear();
        this.emit({ type: 'attack', playerId: pid, card });
        return this.maybeResolve();
      }
      case 'defend': {
        if (i !== this.defender || this.taking) throw new GameError('Сейчас не вы отбиваетесь');
        const card = p.hand.find(c => c.id === msg.cardId);
        if (!card) throw new GameError('Такой карты нет');
        const slots = this.table.map((t, k) => k).filter(k => !this.table[k].d);
        const slot = Number.isInteger(msg.slot) && slots.includes(msg.slot) ? msg.slot : slots.find(k => this.beats(this.table[k].a, card));
        if (slot === undefined || !this.beats(this.table[slot].a, card)) throw new GameError('Этой картой не побить');
        take(card.id);
        this.table[slot].d = card;
        this.emit({ type: 'defend', playerId: pid, card, slot });
        if (this.allBeaten()) this.passed.clear();
        return this.maybeResolve();
      }
      case 'take': {
        if (i !== this.defender || this.taking || this.table.length === 0 || this.allBeaten()) throw new GameError('Сейчас брать нельзя');
        this.taking = true;
        this.passed.clear();
        this.emit({ type: 'taking', playerId: pid });
        return this.maybeResolve();
      }
      case 'pass': {
        if (i === this.defender || this.table.length === 0) throw new GameError('Сейчас нельзя');
        if (!this.taking && !this.allBeaten()) throw new GameError('Дождитесь, пока отобьются');
        this.passed.add(i);
        this.emit({ type: 'pass', playerId: pid, label: this.taking ? 'Хватит' : 'Бито' });
        return this.maybeResolve();
      }
      default: throw new GameError('Неизвестное действие');
    }
  }

  maybeResolve() {
    const canStillThrow = this.throwers().filter(k => !this.passed.has(k));
    const defenderEmpty = this.players[this.defender].hand.length === 0;
    if (!(this.taking || this.allBeaten())) return;
    if (canStillThrow.length && !(defenderEmpty && !this.taking) && this.table.length < this.boutLimit) return;
    this.resolve();
  }

  resolve() {
    const cards = this.table.flatMap(t => (t.d ? [t.a, t.d] : [t.a]));
    const def = this.players[this.defender];
    let nextAttacker;
    if (this.taking) {
      def.hand.push(...cards);
      this.emit({ type: 'took', playerId: def.id, count: cards.length });
      nextAttacker = this.nextActive(this.defender);
    } else {
      this.discardCount += cards.length;
      this.emit({ type: 'bito' });
      nextAttacker = this.defender;
    }
    this.table = [];
    this.taking = false;
    this.passed.clear();
    // добор: сначала атакующий, потом остальные, отбивавшийся — последним
    const order = [];
    let k = this.attacker;
    do { if (k !== this.defender) order.push(k); k = (k + 1) % this.players.length; } while (k !== this.attacker);
    order.push(this.defender);
    for (const j of order) {
      const p = this.players[j];
      if (p.out) continue;
      let n = 0;
      while (p.hand.length < 6 && this.deck.length) { p.hand.push(this.deck.pop()); n++; }
      if (n) this.emit({ type: 'draw', playerId: p.id, count: n });
    }
    // кто без карт при пустой колоде — вышел
    if (this.deck.length === 0) for (const p of this.players) if (!p.out && p.hand.length === 0) {
      p.out = true; p.place = ++this.places;
      this.emit({ type: 'out', playerId: p.id, place: p.place });
    }
    const left = this.active;
    if (left.length <= 1) {
      this.phase = 'gameOver';
      this.durakId = left[0]?.id ?? null;
      this.emit({ type: 'gameOver', durakId: this.durakId });
      return;
    }
    this.attacker = this.players[nextAttacker].out ? this.nextActive(nextAttacker) : nextAttacker;
    this.defender = this.nextActive(this.attacker);
    this.boutLimit = Math.min(6, this.players[this.defender].hand.length);
  }

  waiting() {
    if (this.phase !== 'playing') return [];
    const ids = k => this.players[k].id;
    if (this.table.length === 0) return [ids(this.attacker)];
    if (!this.taking && !this.allBeaten()) return [ids(this.defender)];
    return this.throwers().filter(k => !this.passed.has(k)).map(ids);
  }

  botMove(pid) {
    const i = this.idx(pid), p = this.players[i];
    const cost = c => V(c.rank) + (c.suit === this.trump ? 20 : 0);
    const sorted = [...p.hand].sort((a, b) => cost(a) - cost(b));
    if (i === this.defender && !this.taking && !this.allBeaten()) {
      const slot = this.table.findIndex(t => !t.d);
      const c = sorted.find(c => this.beats(this.table[slot].a, c));
      // не тратить старшие козыри на мелочь в начале игры
      if (c && (cost(c) < 24 || this.deck.length < 6 || this.rnd() < 0.5)) return { type: 'defend', cardId: c.id, slot };
      return { type: 'take' };
    }
    const c = sorted.find(c => this.canThrow(i, c));
    if (c && (this.table.length === 0 || cost(c) < 14 || this.deck.length === 0)) return { type: 'attack', cardId: c.id };
    return { type: 'pass' };
  }

  removePlayer(pid) {
    const p = this.players.find(x => x.id === pid);
    if (!p || p.out) return;
    // вышедший из-за стола проигрывает: остальные доигрывают без него
    p.out = true; p.left = true;
    this.discardCount += p.hand.length; p.hand = [];
    if (this.active.length <= 1) { this.phase = 'gameOver'; this.durakId = pid; this.emit({ type: 'gameOver', durakId: pid }); return; }
    this.table.forEach(t => { this.discardCount += t.d ? 2 : 1; });
    this.table = []; this.taking = false; this.passed.clear();
    const i = this.idx(pid);
    if (i === this.attacker || i === this.defender) {
      this.attacker = this.nextActive(i);
      this.defender = this.nextActive(this.attacker);
    }
    this.boutLimit = Math.min(6, this.players[this.defender].hand.length);
  }

  result() {
    const losers = this.durakId ? [this.durakId] : [];
    return { winners: this.players.filter(p => !losers.includes(p.id) && !p.left).map(p => p.id), losers };
  }

  view(forId) {
    const me = this.players.findIndex(p => p.id === forId);
    return {
      phase: this.phase,
      trump: this.trump, trumpCard: this.deck.length ? this.trumpCard : null,
      deckCount: this.deck.length, discardCount: this.discardCount,
      table: this.table, taking: this.taking, boutLimit: this.boutLimit,
      attacker: this.players[this.attacker].id, defender: this.players[this.defender].id,
      waiting: this.waiting(),
      players: this.players.map(p => ({ id: p.id, name: p.name, cards: p.hand.length, out: p.out, place: p.place, left: !!p.left })),
      hand: me >= 0 ? this.players[me].hand : [],
      canPass: me >= 0 && me !== this.defender && this.table.length > 0 && (this.taking || this.allBeaten()) && !this.passed.has(me),
      durakId: this.durakId ?? null,
    };
  }
}
