// Общие помощники для всех карточных игр
export { GameError } from "../game/engine.js";

export const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
export const RANKS36 = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANKS52 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function makeDeck(ranks = RANKS36, copies = 1) {
  const deck = [];
  for (let k = 0; k < copies; k++)
    for (const suit of SUITS) for (const rank of ranks) deck.push({ id: copies > 1 ? `${rank}-${suit}-${k}` : `${rank}-${suit}`, rank, suit });
  return deck;
}

export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Журнал событий для анимаций на клиенте */
export class EventLog {
  constructor() { this.log = []; this.eventSeq = 0; }
  emit(ev) {
    const e = { ...ev, seq: ++this.eventSeq };
    this.log.push(e);
    if (this.log.length > 100) this.log.shift();
    return e;
  }
}
