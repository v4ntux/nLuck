import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { chooseAction, applyAction } from '../src/game/ai.js';
import { cardPoints, finishBonus } from '../src/game/rules.js';

const c = (rank, suit) => ({ id: `${rank}-${suit}`, rank, suit });

function setup() {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  g.turn = 0;
  g.discard = [c('8', 'hearts')];
  g.suit = 'hearts';
  return g;
}

test('очки карт', () => {
  assert.equal(cardPoints(c('9', 'clubs')), 9);
  assert.equal(cardPoints(c('10', 'clubs')), 10);
  assert.equal(cardPoints(c('K', 'spades')), 80);
  assert.equal(cardPoints(c('Q', 'spades')), 40);
  assert.equal(cardPoints(c('Q', 'hearts')), 20);
  assert.equal(finishBonus(c('K', 'spades')), 80);
  assert.equal(finishBonus(c('10', 'spades')), 0);
});

test('6 — следующий берёт 1 и пропускает', () => {
  const g = setup();
  g.players[0].hand = [c('6', 'hearts'), c('9', 'clubs')];
  const before = g.players[1].hand.length;
  g.play('a', '6-hearts');
  assert.equal(g.players[1].hand.length, before + 1);
  assert.equal(g.current.id, 'c');
});

test('7 — следующий берёт 2 и пропускает', () => {
  const g = setup();
  g.players[0].hand = [c('7', 'hearts'), c('9', 'clubs')];
  const before = g.players[1].hand.length;
  g.play('a', '7-hearts');
  assert.equal(g.players[1].hand.length, before + 2);
  assert.equal(g.current.id, 'c');
});

test('нельзя положить неподходящую карту', () => {
  const g = setup();
  g.players[0].hand = [c('9', 'clubs'), c('10', 'spades')];
  assert.throws(() => g.play('a', '9-clubs'));
});

test('дама заказывает масть', () => {
  const g = setup();
  g.players[0].hand = [c('Q', 'clubs'), c('9', 'clubs')];
  g.play('a', 'Q-clubs', 'diamonds');
  assert.equal(g.suit, 'diamonds');
});

test('конец раунда: K♠ последней картой даёт −80, остальным плюс', () => {
  const g = setup();
  g.discard = [c('8', 'spades')]; g.suit = 'spades';
  g.players[0].hand = [c('K', 'spades')];
  g.players[1].hand = [c('Q', 'hearts'), c('9', 'clubs')];
  g.players[2].hand = [c('10', 'diamonds')];
  g.deck = [c('6', 'clubs'), c('6', 'diamonds'), c('7', 'clubs'), c('8', 'clubs')];
  g.play('a', 'K-spades');
  assert.equal(g.players[0].score, -80);
  assert.equal(g.players[1].score, 29 + 27); // ещё и взял 4 карты за K♠
  assert.equal(g.players[2].score, 10);
  assert.equal(g.phase, 'roundOver');
});

test('ровно 108 обнуляет, больше — вылет', () => {
  const g = setup();
  g.players[1].score = 99; g.players[2].score = 102;
  g.players[0].hand = [c('9', 'hearts')];
  g.players[1].hand = [c('9', 'clubs')];
  g.players[2].hand = [c('8', 'clubs')];
  g.play('a', '9-hearts');
  assert.equal(g.players[1].score, 0);
  assert.equal(g.players[2].out, true);
});

test('после добора можно сыграть только взятую карту или пасовать', () => {
  const g = setup();
  g.players[0].hand = [c('9', 'clubs')];
  g.deck.push(c('10', 'hearts'));
  g.draw('a');
  assert.equal(g.current.id, 'a');
  assert.throws(() => g.play('a', '9-clubs'));
  g.pass('a');
  assert.equal(g.current.id, 'b');
});

test('боты доигрывают партию до конца', () => {
  for (let n = 0; n < 30; n++) {
    const g = new Game([1, 2, 3, 4].map(i => ({ id: 'p' + i, name: 'P' + i })));
    let steps = 0;
    while (g.phase !== 'gameOver' && steps++ < 100000) {
      if (g.phase === 'roundOver') { g.nextRound(); continue; }
      const id = g.current.id;
      applyAction(g, id, chooseAction(g, id));
    }
    assert.equal(g.phase, 'gameOver');
    const total = g.players.reduce((s, p) => s + p.hand.length, 0) + g.deck.length + g.discard.length;
    assert.equal(total, 36);
  }
});

test('ровно 107 — пополам, минус допустим', () => {
  const g = setup();
  g.players[0].score = 10; g.players[1].score = 98;
  g.players[0].hand = [c('Q', 'hearts')];
  g.players[1].hand = [c('9', 'clubs')];
  g.players[2].hand = [c('8', 'clubs')];
  g.play('a', 'Q-hearts');
  assert.equal(g.players[0].score, -10);
  assert.equal(g.players[1].score, 53);
});

test('8 надо покрыть восьмёркой или той же мастью', () => {
  const g = setup();
  g.discard = [c('9', 'spades')]; g.suit = 'spades';
  g.players[0].hand = [c('8', 'spades'), c('10', 'hearts'), c('8', 'clubs'), c('J', 'clubs')];
  g.play('a', '8-spades');
  assert.equal(g.current.id, 'a');
  assert.throws(() => g.play('a', '10-hearts'));
  assert.throws(() => g.pass('a'));
  g.play('a', '8-clubs');
  assert.equal(g.current.id, 'a');
  g.play('a', 'J-clubs');
  assert.equal(g.current.id, 'b');
});

test('8 нечем покрыть — тянем пока не найдём', () => {
  const g = setup();
  g.discard = [c('9', 'spades')]; g.suit = 'spades';
  g.players[0].hand = [c('8', 'spades'), c('10', 'hearts')];
  g.deck = [c('K', 'spades'), c('6', 'hearts'), c('J', 'diamonds')];
  g.play('a', '8-spades');
  g.draw('a'); g.draw('a');
  assert.throws(() => g.play('a', '6-hearts'));
  g.draw('a');
  g.play('a', 'K-spades');
  assert.equal(g.current.id, 'c'); // K♠: b берёт 4 и пропускает
});

test('туз ♠ пропускает следующего, 1 на 1 — ход возвращается', () => {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  g.turn = 0; g.discard = [c('9', 'spades')]; g.suit = 'spades';
  g.players[0].hand = [c('A', 'spades'), c('10', 'spades')];
  g.play('a', 'A-spades');
  assert.equal(g.current.id, 'a');
  g.play('a', '10-spades');
  assert.equal(g.phase, 'roundOver');
});

test('после добора ход не уходит сам', () => {
  const g = setup();
  g.discard = [c('9', 'hearts')]; g.suit = 'hearts';
  g.players[0].hand = [c('10', 'hearts'), c('6', 'clubs')];
  g.play('a', '10-hearts');
  assert.equal(g.current.id, 'b');
  g.players[1].hand = [c('7', 'clubs')];
  g.deck.push(c('J', 'clubs'));
  g.draw('b');
  assert.equal(g.current.id, 'b');
  g.pass('b');
  assert.equal(g.current.id, 'c');
});

test('K♠ — следующий берёт 4 и пропускает', () => {
  const g = setup();
  g.discard = [c('9', 'spades')]; g.suit = 'spades';
  g.players[0].hand = [c('K', 'spades'), c('9', 'hearts')];
  const before = g.players[1].hand.length;
  g.play('a', 'K-spades');
  assert.equal(g.players[1].hand.length, before + 4);
  assert.equal(g.current.id, 'c');
});

test('любой туз — пропуск без добора, вдвоём ход снова мой', () => {
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  g.turn = 0; g.discard = [c('9', 'hearts')]; g.suit = 'hearts';
  g.players[0].hand = [c('A', 'hearts'), c('10', 'hearts')];
  const before = g.players[1].hand.length;
  g.play('a', 'A-hearts');
  assert.equal(g.players[1].hand.length, before);
  assert.equal(g.current.id, 'a');
});
