// Блэкджек: игроки против дилера, ставки из баланса монет. Дилер добирает до 17.
import { GameError, RANKS52, makeDeck, shuffle, EventLog } from './common.js';

export const BJ_BETS = [10, 25, 50, 100, 250, 500];

export function handValue(cards) {
  let v = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { v += 11; aces++; }
    else if (['K', 'Q', 'J'].includes(c.rank)) v += 10;
    else v += Number(c.rank);
  }
  while (v > 21 && aces) { v -= 10; aces--; }
  return { value: v, soft: aces > 0 };
}
const isBJ = cards => cards.length === 2 && handValue(cards).value === 21;

export class Blackjack extends EventLog {
  /** bank: { balance(id), add(id, delta, reason) } — монеты игроков */
  constructor(players, { rnd = Math.random, bank } = {}) {
    super();
    this.rnd = rnd;
    this.bank = bank;
    this.players = players.map(p => ({ id: p.id, name: p.name, hand: [], bet: 0, state: 'bet', result: null, payout: 0 }));
    this.dealer = [];
    this.shoe = [];
    this.phase = 'playing';
    this.round = 0;
    this.newRound();
  }

  draw() {
    if (this.shoe.length < 30) { this.shoe = shuffle(makeDeck(RANKS52, 4), this.rnd); this.emit({ type: 'reshuffle' }); }
    return this.shoe.pop();
  }
  player(id) { const p = this.players.find(x => x.id === id); if (!p) throw new GameError('Игрок не найден'); return p; }

  newRound() {
    this.round++;
    this.stage = 'bet';
    this.dealer = [];
    this.turn = -1;
    for (const p of this.players) Object.assign(p, { hand: [], bet: 0, state: 'bet', result: null, payout: 0 });
    this.phase = 'playing';
    this.emit({ type: 'roundStart', round: this.round });
  }
  nextRound() { if (this.phase === 'roundOver') this.newRound(); }

  act(pid, msg) {
    if (this.phase !== 'playing') throw new GameError('Раунд не идёт');
    const p = this.player(pid);
    if (this.stage === 'bet') {
      if (p.state !== 'bet') throw new GameError('Ставка уже сделана');
      if (msg.type === 'sitout') { p.state = 'sitout'; this.emit({ type: 'sitout', playerId: pid }); return this.maybeDeal(); }
      if (msg.type !== 'bet') throw new GameError('Сделайте ставку');
      const amount = Number(msg.amount);
      if (!BJ_BETS.includes(amount)) throw new GameError('Неверная ставка');
      if (this.bank.balance(pid) < amount) throw new GameError('Не хватает монет');
      this.bank.add(pid, -amount, 'blackjack');
      p.bet = amount; p.state = 'ready';
      this.emit({ type: 'bet', playerId: pid, amount });
      return this.maybeDeal();
    }
    if (this.stage !== 'turns' || this.players[this.turn]?.id !== pid) throw new GameError('Сейчас не ваш ход');
    if (msg.type === 'hit') {
      const c = this.draw(); p.hand.push(c);
      this.emit({ type: 'hit', playerId: pid, card: c });
      const v = handValue(p.hand).value;
      if (v > 21) { p.state = 'bust'; this.emit({ type: 'bust', playerId: pid }); return this.advance(); }
      if (v === 21) { p.state = 'stand'; return this.advance(); }
      return;
    }
    if (msg.type === 'stand') { p.state = 'stand'; this.emit({ type: 'stand', playerId: pid }); return this.advance(); }
    if (msg.type === 'double') {
      if (p.hand.length !== 2) throw new GameError('Удвоить можно только на двух картах');
      if (this.bank.balance(pid) < p.bet) throw new GameError('Не хватает монет');
      this.bank.add(pid, -p.bet, 'blackjack');
      p.bet *= 2;
      const c = this.draw(); p.hand.push(c);
      this.emit({ type: 'double', playerId: pid, card: c });
      p.state = handValue(p.hand).value > 21 ? 'bust' : 'stand';
      return this.advance();
    }
    throw new GameError('Неизвестное действие');
  }

  maybeDeal() {
    if (this.players.some(p => p.state === 'bet')) return;
    const playing = this.players.filter(p => p.state === 'ready');
    if (!playing.length) { this.phase = 'roundOver'; this.emit({ type: 'roundEnd' }); return; }
    for (let k = 0; k < 2; k++) { for (const p of playing) p.hand.push(this.draw()); this.dealer.push(this.draw()); }
    this.emit({ type: 'deal' });
    for (const p of playing) p.state = isBJ(p.hand) ? 'blackjack' : 'play';
    this.stage = 'turns';
    this.turn = -1;
    if (isBJ(this.dealer)) return this.dealerPlay();
    this.advance();
  }

  advance() {
    do { this.turn++; } while (this.turn < this.players.length && this.players[this.turn].state !== 'play');
    if (this.turn >= this.players.length) this.dealerPlay();
    else this.emit({ type: 'turn', playerId: this.players[this.turn].id });
  }

  dealerPlay() {
    this.stage = 'dealer';
    const live = this.players.some(p => p.state === 'stand');
    if (live) while (handValue(this.dealer).value < 17) this.dealer.push(this.draw());
    const d = handValue(this.dealer).value, dBJ = isBJ(this.dealer);
    for (const p of this.players) {
      if (!p.bet) continue;
      const v = handValue(p.hand).value;
      let mult = 0, res = 'lose';
      if (p.state === 'bust') res = 'bust';
      else if (p.state === 'blackjack') { if (dBJ) { mult = 1; res = 'push'; } else { mult = 2.5; res = 'blackjack'; } }
      else if (dBJ) res = 'lose';
      else if (d > 21 || v > d) { mult = 2; res = 'win'; }
      else if (v === d) { mult = 1; res = 'push'; }
      p.result = res;
      p.payout = Math.floor(p.bet * mult);
      if (p.payout) this.bank.add(p.id, p.payout, 'blackjack');
    }
    this.stage = 'done';
    this.phase = 'roundOver';
    this.emit({ type: 'roundEnd' });
  }

  waiting() {
    if (this.phase !== 'playing') return [];
    if (this.stage === 'bet') return this.players.filter(p => p.state === 'bet').map(p => p.id);
    if (this.stage === 'turns') return [this.players[this.turn].id];
    return [];
  }

  // За отключившегося — пропуск/стоп
  botMove() { return this.stage === 'bet' ? { type: 'sitout' } : { type: 'stand' }; }

  removePlayer(pid) {
    const i = this.players.findIndex(p => p.id === pid);
    if (i < 0) return;
    const wasTurn = this.stage === 'turns' && i === this.turn;
    this.players.splice(i, 1);
    if (!this.players.length) { this.phase = 'gameOver'; return; }
    if (this.stage === 'turns') { if (i < this.turn) this.turn--; if (wasTurn) { this.turn--; this.advance(); } }
    else if (this.stage === 'bet') this.maybeDeal();
  }
  addPlayer(p) { this.players.push({ id: p.id, name: p.name, hand: [], bet: 0, state: this.stage === 'bet' ? 'bet' : 'wait', result: null, payout: 0 }); }
  result() { return { winners: [], losers: [] }; }

  view(forId) {
    const hideHole = this.stage === 'turns' || this.stage === 'bet';
    return {
      phase: this.phase, stage: this.stage, round: this.round, bets: BJ_BETS,
      dealer: hideHole && this.dealer.length ? [this.dealer[0], null] : this.dealer,
      dealerValue: hideHole ? null : handValue(this.dealer).value,
      turn: this.stage === 'turns' ? this.players[this.turn]?.id : null,
      waiting: this.waiting(),
      players: this.players.map(p => ({ id: p.id, name: p.name, hand: p.hand, value: p.hand.length ? handValue(p.hand).value : 0, bet: p.bet, state: p.state, result: p.result, payout: p.payout })),
      balance: this.bank.balance(forId),
    };
  }
}
