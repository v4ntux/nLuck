// Реестр игр клуба
import { Game as Game108 } from '../game/engine.js';
import { Durak } from './durak.js';
import { Bura } from './bura.js';
import { Poker } from './poker.js';
import { Blackjack } from './blackjack.js';

export const GAMES = {
  '108': {
    id: '108', name: '108', create: (players, opts) => new Game108(players, opts),
    min: 2, max: 6, stake: 50, roundPause: 7000,
    modes: { duel: { min: 2, max: 2 }, trio: { min: 3, max: 3 }, party: { min: 4, max: 6, waitMs: 15000 } },
  },
  durak: {
    id: 'durak', name: 'Дурак', create: (players, opts) => new Durak(players, opts),
    min: 2, max: 6, stake: 50, roundPause: 0,
    modes: { duel: { min: 2, max: 2 }, trio: { min: 3, max: 3 }, party: { min: 4, max: 6, waitMs: 15000 } },
  },
  bura: {
    id: 'bura', name: 'Бура', create: (players, opts) => new Bura(players, opts),
    min: 2, max: 4, stake: 50, roundPause: 0,
    modes: { duel: { min: 2, max: 2 }, trio: { min: 3, max: 3 }, party: { min: 4, max: 4 } },
  },
  poker: {
    id: 'poker', name: 'Покер', create: (players, opts) => new Poker(players, opts),
    min: 2, max: 6, stake: 200, roundPause: 4500,
    modes: { duel: { min: 2, max: 2 }, party: { min: 3, max: 6, waitMs: 15000 } },
  },
  blackjack: {
    id: 'blackjack', name: 'Блэкджек', create: (players, opts) => new Blackjack(players, opts),
    min: 1, max: 5, stake: 0, roundPause: 3500, solo: true, joinAnytime: true,
    modes: {},
  },
};
