import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Durak } from '../src/games/durak.js';
import { Bura } from '../src/games/bura.js';
import { Poker } from '../src/games/poker.js';
import { Blackjack, handValue } from '../src/games/blackjack.js';
import { evaluate, compare } from '../src/games/pokerEval.js';

const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const c = (rank, suit) => ({ id: `${rank}-${suit}`, rank, suit });

test('дурак: боты доигрывают, карты не теряются', () => {
  for (const n of [2, 3, 6]) for (let k = 0; k < 50; k++) {
    const g = new Durak(players(n));
    let s = 0;
    while (g.phase === 'playing' && s++ < 5000) { const id = g.waiting()[0]; g.act(id, g.botMove(id)); }
    assert.equal(g.phase, 'gameOver');
    assert.equal(g.players.reduce((a, p) => a + p.hand.length, 0) + g.deck.length + g.discardCount, 36);
  }
});

test('дурак: бить можно только старшей той же масти или козырем', () => {
  const g = new Durak(players(2));
  g.trump = 'hearts';
  assert.ok(g.beats(c('9', 'spades'), c('J', 'spades')));
  assert.ok(!g.beats(c('9', 'spades'), c('7', 'spades')));
  assert.ok(g.beats(c('A', 'spades'), c('6', 'hearts')));
  assert.ok(!g.beats(c('6', 'hearts'), c('A', 'spades')));
});

test('бура: боты доигрывают до 31 или конца колоды', () => {
  for (const n of [2, 3, 4]) for (let k = 0; k < 50; k++) {
    const g = new Bura(players(n));
    let s = 0;
    while (g.phase === 'playing' && s++ < 2000) { const id = g.waiting()[0]; g.act(id, g.botMove(id)); }
    assert.equal(g.phase, 'gameOver');
  }
});

test('покер: турнир ботов, фишки сохраняются', () => {
  for (const n of [2, 4, 6]) for (let k = 0; k < 30; k++) {
    const g = new Poker(players(n));
    let s = 0;
    while (g.phase !== 'gameOver' && s++ < 20000) {
      if (g.phase === 'roundOver') { g.nextRound(); continue; }
      const id = g.waiting()[0]; g.act(id, g.botMove(id));
    }
    assert.equal(g.phase, 'gameOver');
    assert.equal(g.players.reduce((a, p) => a + p.chips, 0), n * 1000);
  }
});

test('покер: комбинации сравниваются правильно', () => {
  const h = s => s.split(' ').map(x => c(x.slice(0, -1), { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[x.slice(-1)]));
  assert.ok(compare(evaluate(h('Ah Kh Qh Jh 10h 2c 3d')), evaluate(h('9s 9h 9d 9c Ks 2c 3d'))) > 0);
  assert.ok(compare(evaluate(h('2h 2d 3c 3s 9d Kc Qh')), evaluate(h('Ah Ad 4c 5s 9d Kc Qh'))) > 0);
});

test('блэкджек: подсчёт и выплаты', () => {
  assert.equal(handValue([c('A', 'spades'), c('K', 'hearts')]).value, 21);
  assert.equal(handValue([c('A', 'spades'), c('A', 'hearts'), c('9', 'clubs')]).value, 21);
  const bal = { p0: 1000 };
  const bank = { balance: id => bal[id], add: (id, d) => (bal[id] += d) };
  const g = new Blackjack(players(1), { bank });
  g.act('p0', { type: 'bet', amount: 100 });
  let s = 0;
  while (g.phase === 'playing' && s++ < 20) g.act('p0', { type: 'stand' });
  assert.equal(g.phase, 'roundOver');
  const p = g.players[0];
  assert.equal(bal.p0, 1000 - 100 + p.payout);
});
