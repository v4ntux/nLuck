import { SUITS, RANKS, RULES, cardPoints, finishBonus } from './rules.js';

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
 * Серверная логика одной партии (несколько раундов до 101).
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
    if (this.log.length > 50) this.log.shift();
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

  canPlay(card) {
    if (this.rules.queenIsWild && card.rank === 'Q') return true;
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
    if (!this.canPlay(card)) throw new GameError('Эту карту нельзя положить');
    if (this.hasDrawn && this.drawnCardId && this.drawnCardId !== card.id)
      throw new GameError('После добора можно сыграть только взятую карту');

    p.hand.splice(idx, 1);
    this.discard.push(card);
    if (card.rank === 'Q' && this.rules.queenIsWild) {
      this.suit = SUITS.includes(chosenSuit) ? chosenSuit : card.suit;
    } else {
      this.suit = card.suit;
    }
    this.emit({ type: 'play', playerId, card, suit: this.suit });

    // Эффект на следующего игрока
    let next = this.nextIndex(this.turn);
    const drawN = this.rules.drawEffects[card.rank] || 0;
    if (drawN > 0) {
      const victim = this.players[next];
      for (let i = 0; i < drawN; i++) { const c = this.drawCard(); if (c) victim.hand.push(c); }
      this.emit({ type: 'penalty', playerId: victim.id, count: drawN, card });
    }

    if (p.hand.length === 0) return this.endRound(p, card);

    if (drawN > 0 || (card.rank === 'A' && this.rules.aceSkips)) {
      this.emit({ type: 'skip', playerId: this.players[next].id });
      next = this.nextIndex(next);
    }
    this.advance(next);
  }

  draw(playerId) {
    this.assertTurn(playerId);
    if (this.hasDrawn) throw new GameError('Вы уже взяли карту');
    const c = this.drawCard();
    this.hasDrawn = true;
    if (!c) { this.emit({ type: 'draw', playerId, count: 0 }); return this.advance(this.nextIndex(this.turn)); }
    this.current.hand.push(c);
    this.drawnCardId = c.id;
    this.emit({ type: 'draw', playerId, count: 1 });
    // Если взятой картой ходить нельзя — ход переходит сам
    if (!this.canPlay(c)) this.advance(this.nextIndex(this.turn));
    return c;
  }

  pass(playerId) {
    this.assertTurn(playerId);
    if (!this.hasDrawn) throw new GameError('Сначала возьмите карту');
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
      else delta = p.hand.reduce((s, c) => s + cardPoints(c), 0);
      p.score += delta;
      let note = null;
      if (p.score === this.rules.targetScore && this.rules.exactTargetResets) { p.score = 0; note = 'reset'; }
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
      drawnCardId: this.current?.id === forId ? this.drawnCardId : null,
      dealer: this.players[this.dealer]?.id,
      turnStartedAt: this.turnStartedAt,
      turnSeconds: this.rules.turnSeconds,
      target: this.rules.targetScore,
      players: this.players.map(p => ({
        id: p.id, name: p.name, score: p.score, out: p.out, left: !!p.left,
        cards: p.hand.length,
      })),
      hand: this.players.find(p => p.id === forId)?.hand ?? [],
      lastEvent: this.lastEvent,
      roundResult: this.roundResult,
      winnerId: this.winnerId ?? null,
    };
  }
}
