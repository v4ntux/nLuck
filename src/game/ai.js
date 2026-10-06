import { SUITS, cardPoints } from './rules.js';

/** Простой бот: возвращает действие { type: 'play'|'draw'|'pass', cardId?, suit? } */
export function chooseAction(game, playerId) {
  const me = game.player(playerId);
  let playable = me.hand.filter(c => game.canPlay(c));
  if (game.hasDrawn && game.drawnCardId) playable = playable.filter(c => c.id === game.drawnCardId);

  if (playable.length === 0) return game.hasDrawn ? { type: 'pass' } : { type: 'draw' };

  const nextP = game.players[game.nextIndex(game.turn)];
  const score = c => {
    let s = cardPoints(c);                               // избавляемся от дорогих карт
    if (c.rank === 'Q') s = me.hand.length <= 2 ? 200 : -30; // дама — на финал
    if (c.rank === 'K' && c.suit === 'spades' && me.hand.length === 1) s = 300;
    if ((c.rank === '6' || c.rank === '7') && nextP.hand.length <= 2) s += 25;
    if (c.rank === 'A') s += 5;
    return s + Math.random() * 3;
  };
  playable.sort((a, b) => score(b) - score(a));
  const card = playable[0];

  let suit;
  if (card.rank === 'Q') {
    const counts = Object.fromEntries(SUITS.map(s => [s, 0]));
    for (const c of me.hand) if (c.id !== card.id && c.rank !== 'Q') counts[c.suit]++;
    suit = SUITS.reduce((a, b) => (counts[b] > counts[a] ? b : a), card.suit);
  }
  return { type: 'play', cardId: card.id, suit };
}

export function applyAction(game, playerId, action) {
  if (action.type === 'play') return game.play(playerId, action.cardId, action.suit);
  if (action.type === 'draw') return game.draw(playerId);
  return game.pass(playerId);
}
