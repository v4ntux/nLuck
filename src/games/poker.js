// Техасский холдем (турнир «до последнего»): у всех по 1000 фишек, блайнды растут каждые 6 раздач
import { GameError, RANKS52, makeDeck, shuffle, EventLog } from './common.js';
import { evaluate, compare, HAND_NAMES, rankValue } from './pokerEval.js';

const START_CHIPS = 1000;

export class Poker extends EventLog {
  constructor(players, { rnd = Math.random } = {}) {
    super();
    if (players.length < 2) throw new GameError('Нужно минимум 2 игрока');
    this.rnd = rnd;
    this.players = players.map(p => ({ id: p.id, name: p.name, chips: START_CHIPS, hole: [], out: false }));
    this.button = Math.floor(rnd() * players.length);
    this.sb = 10; this.bb = 20;
    this.hand = 0;
    this.phase = 'playing';
    this.startHand();
  }

  idx(id) { const i = this.players.findIndex(p => p.id === id); if (i < 0) throw new GameError('Игрок не найден'); return i; }
  next(i, pred = p => !p.out) { let j = i; for (let k = 0; k < this.players.length; k++) { j = (j + 1) % this.players.length; if (pred(this.players[j])) return j; } return -1; }
  canAct = p => !p.out && !p.folded && !p.allIn;
  get inHand() { return this.players.filter(p => !p.out && !p.folded); }

  startHand() {
    for (const p of this.players) if (!p.out && p.chips <= 0) { p.out = true; this.emit({ type: 'bust', playerId: p.id }); }
    const alive = this.players.filter(p => !p.out);
    if (alive.length <= 1) { this.phase = 'gameOver'; this.winnerId = alive[0]?.id ?? null; this.emit({ type: 'gameOver', winnerId: this.winnerId }); return; }
    this.hand++;
    if (this.hand > 1 && (this.hand - 1) % 6 === 0) { this.sb = Math.round(this.sb * 1.5 / 5) * 5; this.bb = this.sb * 2; this.emit({ type: 'blinds', sb: this.sb, bb: this.bb }); }
    this.deck = shuffle(makeDeck(RANKS52), this.rnd);
    this.community = [];
    this.results = null;
    for (const p of this.players) Object.assign(p, { hole: [], folded: p.out, allIn: false, bet: 0, total: 0, acted: false, lastAction: null, show: false, won: 0, handName: null });
    for (let k = 0; k < 2; k++) for (const p of alive) p.hole.push(this.deck.pop());
    this.button = this.next(this.button);
    const sbI = alive.length === 2 ? this.button : this.next(this.button);
    const bbI = this.next(sbI);
    this.post(sbI, this.sb); this.players[sbI].lastAction = `SB ${this.sb}`;
    this.post(bbI, this.bb); this.players[bbI].lastAction = `BB ${this.bb}`;
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this.stage = 'preflop';
    this.phase = 'playing';
    this.emit({ type: 'deal', hand: this.hand });
    this.turn = this.next(bbI, this.canAct);
    if (this.turn < 0 || this.roundDone()) this.nextStage();
  }
  nextRound() { if (this.phase === 'roundOver') this.startHand(); }

  post(i, amt) {
    const p = this.players[i];
    const x = Math.min(amt, p.chips);
    p.chips -= x; p.bet += x; p.total += x;
    if (p.chips === 0) p.allIn = true;
    return x;
  }

  roundDone() {
    const acting = this.players.filter(this.canAct);
    if (acting.length === 0) return true;
    if (acting.length === 1 && acting[0].bet >= this.currentBet && this.inHand.length > 1 && acting[0].acted) return true;
    if (acting.length === 1 && this.inHand.every(p => p === acting[0] || p.allIn) && acting[0].bet >= this.currentBet) return true;
    return acting.every(p => p.acted && p.bet === this.currentBet);
  }

  act(pid, msg) {
    if (this.phase !== 'playing') throw new GameError('Раздача не идёт');
    const i = this.idx(pid), p = this.players[i];
    if (i !== this.turn) throw new GameError('Сейчас не ваш ход');
    const toCall = this.currentBet - p.bet;
    switch (msg.type) {
      case 'fold': p.folded = true; p.lastAction = 'Пас'; break;
      case 'check': if (toCall > 0) throw new GameError('Нужно уравнять'); p.lastAction = 'Чек'; break;
      case 'call': { const x = this.post(i, toCall); p.lastAction = p.allIn ? `Ва-банк ${p.bet}` : `Колл ${x}`; break; }
      case 'raise': case 'allin': {
        const to = msg.type === 'allin' ? p.bet + p.chips : Math.floor(Number(msg.to));
        if (!(to > this.currentBet)) throw new GameError('Ставка должна быть больше');
        if (to > p.bet + p.chips) throw new GameError('Не хватает фишек');
        if (to < this.currentBet + this.minRaise && to < p.bet + p.chips) throw new GameError(`Минимальный рейз — до ${this.currentBet + this.minRaise}`);
        this.post(i, to - p.bet);
        if (to - this.currentBet >= this.minRaise) { this.minRaise = to - this.currentBet; for (const o of this.players) if (o !== p) o.acted = false; }
        this.currentBet = to;
        p.lastAction = p.allIn ? `Ва-банк ${p.bet}` : `Рейз ${to}`;
        break;
      }
      default: throw new GameError('Неизвестное действие');
    }
    p.acted = true;
    this.emit({ type: 'action', playerId: pid, action: msg.type, label: p.lastAction });
    if (this.inHand.length === 1) return this.finish();
    if (this.roundDone()) return this.nextStage();
    this.turn = this.next(i, this.canAct);
  }

  nextStage() {
    for (const p of this.players) { p.bet = 0; p.acted = false; }
    this.currentBet = 0; this.minRaise = this.bb;
    const order = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' };
    this.stage = order[this.stage];
    if (this.stage === 'flop') this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else if (this.stage === 'turn' || this.stage === 'river') this.community.push(this.deck.pop());
    if (this.stage === 'showdown') return this.finish();
    this.emit({ type: 'board', stage: this.stage, cards: this.community });
    const acting = this.players.filter(this.canAct);
    if (acting.length <= 1) return this.nextStage(); // все в олл-ине — докручиваем борд
    this.turn = this.next(this.button, this.canAct);
  }

  finish() {
    const contenders = this.inHand;
    const totals = this.players.map(p => p.total);
    const results = [];
    if (contenders.length === 1) {
      const w = contenders[0];
      const pot = totals.reduce((a, b) => a + b, 0);
      w.chips += pot; w.won = pot;
      results.push({ winners: [w.id], amount: pot, hand: null });
    } else {
      while (this.community.length < 5) this.community.push(this.deck.pop());
      for (const p of contenders) { p.score = evaluate([...p.hole, ...this.community]); p.handName = HAND_NAMES[p.score[0]]; p.show = true; }
      const levels = [...new Set(contenders.map(p => p.total))].sort((a, b) => a - b);
      let prev = 0;
      for (const lvl of levels) {
        const amount = this.players.reduce((s, p) => s + Math.max(0, Math.min(p.total, lvl) - prev), 0);
        const eligible = contenders.filter(p => p.total >= lvl);
        let best = [];
        for (const p of eligible) {
          const c = best.length ? compare(p.score, best[0].score) : 1;
          if (c > 0) best = [p]; else if (c === 0) best.push(p);
        }
        const share = Math.floor(amount / best.length);
        best.forEach((p, k) => { const x = share + (k === 0 ? amount - share * best.length : 0); p.chips += x; p.won += x; });
        if (amount) results.push({ winners: best.map(p => p.id), amount, hand: best[0].handName });
        prev = lvl;
      }
    }
    this.results = results;
    this.stage = 'showdown';
    this.phase = 'roundOver';
    this.emit({ type: 'handEnd', results });
    if (this.players.filter(p => !p.out && p.chips > 0).length <= 1) {
      for (const p of this.players) if (!p.out && p.chips <= 0) p.out = true;
      this.phase = 'gameOver';
      this.winnerId = this.players.find(p => !p.out)?.id ?? null;
      this.emit({ type: 'gameOver', winnerId: this.winnerId });
    }
  }

  waiting() { return this.phase === 'playing' && this.turn >= 0 ? [this.players[this.turn].id] : []; }

  botMove(pid) {
    const p = this.players[this.idx(pid)];
    const toCall = this.currentBet - p.bet;
    const pot = this.players.reduce((s, x) => s + x.total, 0);
    let s;
    if (this.community.length === 0) {
      const [a, b] = p.hole.map(c => rankValue(c.rank)).sort((x, y) => y - x);
      s = (a + b) / 28 * 0.6 + (a === b ? 0.35 + a / 60 : 0) + (p.hole[0].suit === p.hole[1].suit ? 0.05 : 0) + (a - b === 1 ? 0.04 : 0);
    } else {
      const cat = evaluate([...p.hole, ...this.community])[0];
      s = [0.2, 0.5, 0.68, 0.8, 0.86, 0.9, 0.95, 0.98, 1][cat];
    }
    s += (this.rnd() - 0.5) * 0.25;
    const cheap = toCall <= Math.max(this.bb, p.chips * 0.04);
    if (s > 0.78 && p.chips > toCall) {
      const to = Math.min(p.bet + p.chips, this.currentBet + Math.max(this.minRaise, Math.floor(pot / 2 / 5) * 5));
      return to >= this.currentBet + this.minRaise || to === p.bet + p.chips ? { type: 'raise', to } : { type: 'call' };
    }
    if (toCall === 0) return { type: 'check' };
    if (s > 0.42 || cheap) return { type: 'call' };
    return { type: 'fold' };
  }

  removePlayer(pid) {
    const i = this.players.findIndex(p => p.id === pid);
    if (i < 0) return;
    const p = this.players[i];
    p.left = true;
    if (this.phase === 'playing' && !p.folded) { p.folded = true; p.lastAction = 'Ушёл'; }
    p.chips = 0;
    if (this.phase !== 'playing') return;
    if (this.inHand.length === 1) return this.finish();
    if (i === this.turn) { if (this.roundDone()) this.nextStage(); else this.turn = this.next(i, this.canAct); }
  }

  result() { return { winners: this.winnerId ? [this.winnerId] : [], losers: this.players.filter(p => p.id !== this.winnerId).map(p => p.id) }; }

  view(forId) {
    const me = this.players.find(p => p.id === forId);
    return {
      phase: this.phase, stage: this.stage, hand: this.hand, sb: this.sb, bb: this.bb,
      community: this.community,
      pot: this.players.reduce((s, p) => s + p.total, 0),
      currentBet: this.currentBet,
      toCall: me ? Math.max(0, this.currentBet - me.bet) : 0,
      minRaiseTo: this.currentBet + this.minRaise,
      maxTo: me ? me.bet + me.chips : 0,
      turn: this.phase === 'playing' ? this.players[this.turn]?.id : null,
      button: this.players[this.button]?.id,
      waiting: this.waiting(),
      players: this.players.map(p => ({
        id: p.id, name: p.name, chips: p.chips, bet: p.bet, total: p.total, folded: p.folded, allIn: p.allIn, out: p.out, left: !!p.left,
        lastAction: p.lastAction, won: p.won, handName: p.show ? p.handName : null,
        hole: p.id === forId || p.show ? p.hole : p.hole.length ? [null, null] : [],
      })),
      results: this.results,
      winnerId: this.winnerId ?? null,
    };
  }
}
