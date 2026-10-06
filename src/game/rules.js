// Все правила игры в одном месте — меняй здесь.

export const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
export const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RULES = {
  handSize: 5,          // сколько карт раздаётся каждому
  targetScore: 101,     // перебор этого числа — вылет
  exactTargetResets: true, // ровно 101 очко → счёт обнуляется
  turnSeconds: 30,      // время на ход (онлайн)

  // Эффекты карт: следующий игрок берёт N карт и пропускает ход
  drawEffects: { '6': 1, '7': 2 },
  aceSkips: true,       // туз — следующий пропускает ход
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
