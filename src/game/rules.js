// Все правила игры в одном месте — меняй здесь.

export const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
export const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RULES = {
  handSize: 5,          // сколько карт раздаётся каждому
  targetScore: 108,     // больше 108 — вылет, ровно 108 — счёт обнуляется
  halfScore: 107,       // ровно 107 — счёт делится пополам (округление вниз)
  afkSeconds: 60,       // если игрок отключился — через сколько за него сходит бот

  // Эффекты карт: следующий игрок берёт N карт и пропускает ход (ключ — достоинство или конкретная карта)
  drawEffects: { '6': 1, '7': 2, 'K-spades': 4 },
  // 6 и 7 можно «перевести»: следующий кладёт такую же — и штраф (уже двойной) уходит дальше
  transferRanks: ['6', '7'],
  // Туз — следующий просто пропускает ход, ничего не берёт. Вдвоём ход снова твой (как после 8)
  skipAces: ['spades', 'clubs', 'diamonds', 'hearts'],
  eightMustCover: true, // после 8 тот же игрок кладёт 8 или карту той же масти (нечем — тянет)
  queenIsWild: true,    // дама кладётся на любую карту и заказывает масть
};

// Очки за карту, оставшуюся на руке в конце раунда
export function cardPoints(card) {
  if (card.rank === 'K' && card.suit === 'spades') return 80;
  if (card.rank === 'Q') return card.suit === 'spades' ? 40 : 20;
  switch (card.rank) {
    case 'J': return 2;
    case 'K': return 4;
    case 'A': return 11;
    default: return Number(card.rank); // 6,7,8,9,10 — номинал (9 = 9, не 0)
  }
}

// Бонус (вычитается из счёта), если игрок закончил раунд этой картой
export function finishBonus(card) {
  if (card.rank === 'K' && card.suit === 'spades') return 80;
  if (card.rank === 'Q') return card.suit === 'spades' ? 40 : 20;
  return 0;
}
