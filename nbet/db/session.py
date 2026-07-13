from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from nbet.db.models import Base
from nbet.settings import get_env


def _build_dsn() -> str:
    env = get_env()
    if env.use_sqlite:
        return f"sqlite+aiosqlite:///{env.sqlite_path}"
    return env.postgres_dsn


engine: AsyncEngine = create_async_engine(_build_dsn(), echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def ensure_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
