from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from nbet.db.models import Achievement, User

# key -> (title, check(user) -> bool)
ACHIEVEMENTS: dict[str, tuple[str, object]] = {
    "first_win": ("🏅 Первая победа", lambda u: u.wins >= 1),
    "wins_10": ("🎖 10 побед", lambda u: u.wins >= 10),
    "wins_100": ("🏆 100 побед", lambda u: u.wins >= 100),
    "games_100": ("🎮 100 игр", lambda u: u.games_played >= 100),
    "streak_5": ("🔥 Стрик 5", lambda u: u.streak >= 5),
    "streak_10": ("⚡ Стрик 10", lambda u: u.streak >= 10),
    "bigwin_1k": ("💎 Куш +1000", lambda u: u.biggest_win >= 1000),
    "rich_10k": ("🤑 10 000 Coins", lambda u: u.coins >= 10000),
    "lvl_10": ("⭐ Уровень 10", lambda u: u.level >= 10),
}


async def get_unlocked(session: AsyncSession, user_id: int) -> set[str]:
    res = await session.execute(select(Achievement.key).where(Achievement.user_id == user_id))
    return {row[0] for row in res.all()}


async def check_and_unlock(session: AsyncSession, user: User) -> list[str]:
    """Возвращает названия новых достижений. Без commit — коммитит вызывающий."""
    unlocked = await get_unlocked(session, user.id)
    new_titles: list[str] = []
    for key, (title, check) in ACHIEVEMENTS.items():
        if key not in unlocked and check(user):
            session.add(Achievement(user_id=user.id, key=key))
            new_titles.append(title)
    return new_titles
