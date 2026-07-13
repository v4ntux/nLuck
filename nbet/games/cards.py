from __future__ import annotations

import random
from collections import Counter

SUITS = ["♠", "♥", "♦", "♣"]
RANK_NAMES = {11: "J", 12: "Q", 13: "K", 14: "A"}

Card = tuple[int, str]  # (2..14, suit)


def new_deck() -> list[Card]:
    deck = [(r, s) for r in range(2, 15) for s in SUITS]
    random.shuffle(deck)
    return deck


def fmt_card(card: Card) -> str:
    r, s = card
    return f"{RANK_NAMES.get(r, str(r))}{s}"


def fmt_hand(cards: list[Card]) -> str:
    return " ".join(fmt_card(c) for c in cards)


def bj_value(cards: list[Card]) -> int:
    """Blackjack: J/Q/K=10, A=11 или 1."""
    total = 0
    aces = 0
    for r, _ in cards:
        if r == 14:
            aces += 1
            total += 11
        elif r >= 11:
            total += 10
        else:
            total += r
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


# --- Poker (5 карт) ---

POKER_NAMES = {
    8: "Стрит-флеш",
    7: "Каре",
    6: "Фулл-хаус",
    5: "Флеш",
    4: "Стрит",
    3: "Тройка",
    2: "Две пары",
    1: "Пара",
    0: "Старшая карта",
}


def poker_rank(cards: list[Card]) -> tuple:
    """Сравниваемый ранг руки: чем больше tuple, тем сильнее."""
    ranks = sorted((c[0] for c in cards), reverse=True)
    counts = Counter(ranks)
    # группы: сначала по количеству, потом по рангу
    groups = sorted(counts.items(), key=lambda x: (-x[1], -x[0]))
    group_ranks = tuple(r for r, _ in groups)
    shapes = sorted(counts.values(), reverse=True)

    is_flush = len({c[1] for c in cards}) == 1
    uniq = sorted(set(ranks), reverse=True)
    is_straight = len(uniq) == 5 and uniq[0] - uniq[4] == 4
    straight_high = uniq[0] if is_straight else 0
    if set(ranks) == {14, 5, 4, 3, 2}:  # колесо A-2-3-4-5
        is_straight = True
        straight_high = 5

    if is_straight and is_flush:
        return (8, straight_high)
    if shapes == [4, 1]:
        return (7, *group_ranks)
    if shapes == [3, 2]:
        return (6, *group_ranks)
    if is_flush:
        return (5, *ranks)
    if is_straight:
        return (4, straight_high)
    if shapes == [3, 1, 1]:
        return (3, *group_ranks)
    if shapes == [2, 2, 1]:
        return (2, *group_ranks)
    if shapes == [2, 1, 1, 1]:
        return (1, *group_ranks)
    return (0, *ranks)


def poker_name(rank: tuple) -> str:
    return POKER_NAMES[rank[0]]


def best_rank(cards: list[Card]) -> tuple:
    """Лучшая 5-карточная рука из 5-7 карт (Texas Hold'em)."""
    from itertools import combinations

    if len(cards) <= 5:
        return poker_rank(cards)
    return max(poker_rank(list(combo)) for combo in combinations(cards, 5))
