from __future__ import annotations

import random


def roll_1d6() -> int:
    return random.randint(1, 6)


def spin_slots(symbols: list[str]) -> list[str]:
    return [random.choice(symbols) for _ in range(3)]


def slots_payout(reels: list[str], payout_three: int, payout_two: int) -> int:
    if reels[0] == reels[1] == reels[2]:
        return payout_three
    if len({reels[0], reels[1], reels[2]}) == 2:
        return payout_two
    return 0


def flip_coin() -> str:
    return random.choice(["heads", "tails"])


def crash_point() -> float:
    r = random.random()
    if r < 0.04:
        return 1.0
    return min(10.0, round(1.0 + random.expovariate(1.2), 2))


def wheel_pick(segments: list[dict]) -> dict:
    return random.choice(segments)


def hilo_roll() -> int:
    return random.randint(1, 6)


def mines_positions(size: int, count: int) -> set[int]:
    return set(random.sample(range(size * size), count))
