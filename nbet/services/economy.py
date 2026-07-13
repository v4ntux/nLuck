from __future__ import annotations

import datetime as dt
import random

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from nbet.db.models import GameHistory, Transaction, User
from nbet.services.achievements import check_and_unlock
from nbet.settings import cfg


async def get_or_create_user(
    session: AsyncSession,
    tg_id: int,
    username: str | None,
    *,
    owner_tg_id: int | None = None,
) -> User:
    res = await session.execute(select(User).where(User.tg_id == tg_id))
    user = res.scalar_one_or_none()
    if user:
        if username and user.username != username:
            user.username = username
            await session.commit()
        return user

    starter = int(cfg("starter", "balance", default=1000))
    role = "owner" if owner_tg_id and tg_id == owner_tg_id else "user"
    user = User(tg_id=tg_id, username=username, coins=starter, role=role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def adjust_balance(
    session: AsyncSession,
    *,
    tg_id: int,
    delta: int,
    tx_type: str,
    meta: str | None = None,
) -> User:
    res = await session.execute(select(User).where(User.tg_id == tg_id))
    user = res.scalar_one()
    new_balance = user.coins + delta
    if new_balance < 0:
        raise ValueError("Недостаточно Coins")

    before = user.coins
    user.coins = new_balance
    session.add(
        Transaction(
            user_id=user.id,
            type=tx_type,
            amount=delta,
            balance_before=before,
            balance_after=new_balance,
            meta=meta,
        )
    )
    await session.commit()
    await session.refresh(user)
    return user


async def record_game(
    session: AsyncSession,
    user: User,
    *,
    game: str,
    bet: int,
    payout: int,
    won: bool,
    details: str | None = None,
) -> tuple[User, list[str]]:
    """Обновляет статистику, XP, достижения. Возвращает (user, новые достижения)."""
    net = payout - bet if won else -bet
    user.games_played += 1
    if won:
        user.wins += 1
        user.streak += 1
        if net > user.biggest_win:
            user.biggest_win = net
    else:
        user.loses += 1
        user.streak = 0

    xp_gain = max(1, bet // 10)
    user.xp += xp_gain
    xp_per_level = int(cfg("levels", "xp_per_level", default=500))
    while user.xp >= xp_per_level:
        user.xp -= xp_per_level
        user.level += 1

    session.add(
        GameHistory(
            user_id=user.id,
            game=game,
            bet=bet,
            payout=payout,
            result="win" if won else "lose",
            details=details,
        )
    )
    new_achs = await check_and_unlock(session, user)
    await session.commit()
    await session.refresh(user)
    return user, new_achs


def title_for_level(level: int) -> str:
    titles = cfg("titles", "thresholds", default=[]) or []
    current = "Rookie"
    for item in titles:
        if level >= int(item.get("level", 0)):
            current = str(item.get("title", current))
    return current


async def can_claim_daily(session: AsyncSession, tg_id: int, hours: int, now: dt.datetime) -> bool:
    res = await session.execute(select(User.daily_at).where(User.tg_id == tg_id))
    last = res.scalar_one_or_none()
    if last is None:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=dt.timezone.utc)
    return now - last >= dt.timedelta(hours=hours)


async def set_daily_claim(session: AsyncSession, tg_id: int, when: dt.datetime) -> None:
    await session.execute(update(User).where(User.tg_id == tg_id).values(daily_at=when))
    await session.commit()


def random_range(min_v: int, max_v: int) -> int:
    return random.randint(min_v, max_v)
