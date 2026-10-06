import { SUITS, RANKS, RULES, handPoints, finishBonus } from './rules.js';

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: `${rank}-${suit}`, rank, suit });
  return deck;
}

export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class GameError extends Error {}

/**
 * Серверная логика одной партии (несколько раундов до 108).
 * players: [{ id, name }]
 */
export class Game {
  constructor(players, { rules = RULES, rnd = Math.random } = {}) {
    if (players.length < 2) throw new GameError('Нужно минимум 2 игрока');
    this.rules = rules;
    this.rnd = rnd;
    this.players = players.map(p => ({ id: p.id, name: p.name, score: 0, out: false, hand: [] }));
    this.round = 0;
    this.dealer = Math.floor(rnd() * players.length);
    this.phase = 'idle'; // playing | roundOver | gameOver
    this.log = [];
    this.lastEvent = null;
    this.eventSeq = 0;
    this.startRound();
  }

  get active() { return this.players.filter(p => !p.out); }
  get current() { return this.players[this.turn]; }
  get top() { return this.discard[this.discard.length - 1]; }

  player(id) {
    const p = this.players.find(x => x.id === id);
    if (!p) throw new GameError('Игрок не найден');
    return p;
  }

  nextIndex(from) {
    let i = from;
    do { i = (i + 1) % this.players.length; } while (this.players[i].out);
    return i;
  }

  emit(ev) {
    this.lastEvent = { ...ev, seq: ++this.eventSeq };
    this.log.push(this.lastEvent);
    if (this.log.length > 100) this.log.shift();
  }

  startRound() {
    this.round++;
    this.deck = shuffle(makeDeck(), this.rnd);
    this.discard = [];
    for (const p of this.players) p.hand = [];
    this.dealer = this.nextIndex(this.dealer);
    for (let n = 0; n < this.rules.handSize; n++)
      for (const p of this.active) p.hand.push(this.deck.pop());
    this.discard.push(this.deck.pop());
    this.suit = this.top.suit;
    this.turn = this.nextIndex(this.dealer);
    this.hasDrawn = false;
    this.drawnCardId = null;
    this.cover = null;
    this.pending = null;
    this.finishers = [];
    this.turnStartedAt = Date.now();
    this.roundResult = null;
    this.phase = 'playing';
    this.emit({ type: 'roundStart', round: this.round });
  }

  drawCard() {
    if (this.deck.length === 0) {
      if (this.discard.length <= 1) return null;
      const top = this.discard.pop();
      this.deck = shuffle(this.discard, this.rnd);
      this.discard = [top];
      this.emit({ type: 'reshuffle' });
    }
    return this.deck.pop();
  }

  canDraw() { return this.deck.length > 0 || this.discard.length > 1; }

  canPlay(card) {
    // На 6/7 можно ответить только такой же картой — перевести штраф дальше
    if (this.pending) return card.rank === this.pending.rank;
    // Дама — в любой момент (кроме штрафа за 6/7/K♠, когда надо брать карты)
    if (this.rules.queenIsWild && card.rank === 'Q') return true;
    // После восьмёрки её надо покрыть: восьмёркой или картой той же масти
    if (this.cover) return card.rank === '8' || card.suit === this.cover;
    return card.suit === this.suit || card.rank === this.top.rank;
  }

  assertTurn(playerId) {
    if (this.phase !== 'playing') throw new GameError('Раунд не идёт');
    if (this.current.id !== playerId) throw new GameError('Сейчас не ваш ход');
  }

  play(playerId, cardId, chosenSuit) {
    this.assertTurn(playerId);
    const p = this.current;
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0) throw new GameError('Такой карты нет');
    const card = p.hand[idx];
    if (!this.canPlay(card)) throw new GameError('Так нельзя');

    p.hand.splice(idx, 1);
    this.discard.push(card);
    if (card.rank === 'Q' && this.rules.queenIsWild) {
      this.suit = SUITS.includes(chosenSuit) ? chosenSuit : card.suit;
    } else {
      this.suit = card.suit;
    }
    this.emit({ type: 'play', playerId, card, suit: this.suit });
    if (p.hand.length === 1) this.emit({ type: 'lastCard', playerId });
    if (p.hand.length === 0) this.finishers.push({ player: p, card });

    const drawN = this.rules.drawEffects[card.id] ?? this.rules.drawEffects[card.rank] ?? 0;
    const transferable = this.rules.transferRanks.includes(card.rank);

    // Перевод: ответил такой же 6/7 — штраф растёт и уходит следующему
    if (this.pending) {
      this.pending.count += drawN;
      this.pending.card = card;
      const next = this.nextIndex(this.turn);
      this.emit({ type: 'transfer', playerId, to: this.players[next].id, count: this.pending.count });
      this.advance(next);
      return;
    }

    // Восьмёрка: тот же игрок обязан покрыть
    if (card.rank === '8' && this.rules.eightMustCover) {
      this.cover = card.suit;
      this.hasDrawn = false;
      this.drawnCardId = null;
      return;
    }
    this.cover = null;

    // 6/7 — штраф «висит»: следующий может перевести его такой же картой или взять
    let next = this.nextIndex(this.turn);
    if (drawN > 0 && transferable) {
      this.pending = { rank: card.rank, count: drawN, card };
      this.emit({ type: 'pending', playerId: this.players[next].id, count: drawN, rank: card.rank });
      this.advance(next);
      return;
    }

    // Остальные штрафы (K♠) — сразу
    if (drawN > 0) {
      const victim = this.players[next];
      for (let i = 0; i < drawN; i++) { const c = this.drawCard(); if (c) victim.hand.push(c); }
      this.emit({ type: 'penalty', playerId: victim.id, count: drawN, card });
    }

    if (p.hand.length === 0) return this.endRound(p, card);

    const aceSkip = card.rank === 'A' && this.rules.skipAces.includes(card.suit);
    if (drawN > 0 || aceSkip) {
      this.emit({ type: 'skip', playerId: this.players[next].id });
      next = this.nextIndex(next); // при игре 1 на 1 ход возвращается к себе
    }
    this.advance(next);
  }

  draw(playerId) {
    this.assertTurn(playerId);
    if (this.pending) return this.takePenalty();
    if (this.cover) {
      // Покрыть восьмёрку нечем — тянем по одной, пока не найдём
      const c = this.drawCard();
      if (!c) throw new GameError('Колода пуста — пас');
      this.current.hand.push(c);
      this.emit({ type: 'draw', playerId, count: 1 });
      return c;
    }
    if (this.hasDrawn) throw new GameError('Вы уже взяли карту');
    const c = this.drawCard();
    this.hasDrawn = true;
    if (!c) { this.emit({ type: 'draw', playerId, count: 0 }); return null; }
    this.current.hand.push(c);
    this.drawnCardId = c.id;
    this.emit({ type: 'draw', playerId, count: 1 });
    return c;
  }

  /** Перевести нечем (или не хочет) — берёт все накопленные карты и пропускает ход */
  takePenalty() {
    const victim = this.current, { count, card } = this.pending;
    for (let i = 0; i < count; i++) { const c = this.drawCard(); if (c) victim.hand.push(c); }
    this.pending = null;
    this.emit({ type: 'penalty', playerId: victim.id, count, card });
    // Кто-то вышел, пока штраф висел, и ему его не вернули — раунд за ним
    const winner = this.finishers.find(f => f.player.hand.length === 0);
    if (winner) return this.endRound(winner.player, winner.card);
    this.finishers = [];
    this.emit({ type: 'skip', playerId: victim.id });
    this.advance(this.nextIndex(this.turn));
  }

  canPass() {
    if (this.pending) return false;
    if (this.cover) return !this.canDraw() && !this.current.hand.some(c => this.canPlay(c));
    return this.hasDrawn;
  }

  pass(playerId) {
    this.assertTurn(playerId);
    if (!this.canPass()) throw new GameError(this.cover ? 'Надо покрыть восьмёрку' : 'Сначала возьмите карту');
    this.cover = null;
    this.emit({ type: 'pass', playerId });
    this.advance(this.nextIndex(this.turn));
  }

  advance(next) {
    this.turn = next;
    this.hasDrawn = false;
    this.drawnCardId = null;
    this.turnStartedAt = Date.now();
  }

  endRound(winner, lastCard) {
    const results = [];
    for (const p of this.active) {
      let delta;
      if (p === winner) delta = -finishBonus(lastCard);
      else delta = handPoints(p.hand);
      p.score += delta;
      let note = null;
      if (p.score === this.rules.targetScore) { p.score = 0; note = 'reset'; }
      else if (p.score === this.rules.halfScore) { p.score = Math.floor(p.score / 2); note = 'half'; }
      else if (p.score > this.rules.targetScore) { p.out = true; note = 'out'; }
      results.push({ id: p.id, name: p.name, delta, score: p.score, hand: p.hand.slice(), note });
    }
    this.roundResult = { winnerId: winner.id, lastCard, results };
    this.emit({ type: 'roundEnd', winnerId: winner.id });

    const left = this.active;
    if (left.length <= 1) {
      this.phase = 'gameOver';
      // Победитель — последний оставшийся, иначе тот, у кого меньше очков
      const champ = left[0] || [...this.players].sort((a, b) => a.score - b.score)[0];
      this.winnerId = champ.id;
      this.emit({ type: 'gameOver', winnerId: champ.id });
    } else {
      this.phase = 'roundOver';
    }
  }

  nextRound() {
    if (this.phase !== 'roundOver') return;
    this.startRound();
  }

  removePlayer(playerId) {
    const p = this.players.find(x => x.id === playerId);
    if (!p || p.out) return;
    const wasTurn = this.phase === 'playing' && this.current === p;
    p.out = true;
    p.left = true;
    if (this.active.length <= 1) {
      this.phase = 'gameOver';
      this.winnerId = this.active[0]?.id;
      this.emit({ type: 'gameOver', winnerId: this.winnerId });
    } else if (wasTurn) {
      this.advance(this.nextIndex(this.turn));
    }
  }

  /** Состояние, которое видит конкретный игрок */
  view(forId) {
    return {
      round: this.round,
      phase: this.phase,
      top: this.top,
      discardCount: this.discard.length,
      deckCount: this.deck.length,
      suit: this.suit,
      turn: this.current?.id,
      hasDrawn: this.current?.id === forId ? this.hasDrawn : false,
      cover: this.cover,
      pending: this.pending ? { rank: this.pending.rank, count: this.pending.count } : null,
      canPass: this.phase === 'playing' && this.current?.id === forId ? this.canPass() : false,
      drawnCardId: this.current?.id === forId ? this.drawnCardId : null,
      dealer: this.players[this.dealer]?.id,
      turnStartedAt: this.turnStartedAt,
      target: this.rules.targetScore,
      players: this.players.map(p => ({
        id: p.id, name: p.name, score: p.score, out: p.out, left: !!p.left,
        cards: p.hand.length,
      })),
      hand: this.players.find(p => p.id === forId)?.hand ?? [],
      lastEvent: this.lastEvent,
      seq: this.eventSeq,
      roundResult: this.roundResult,
      winnerId: this.winnerId ?? null,
    };
  }
}
