from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "economy.toml"


@dataclass(frozen=True)
class EnvConfig:
    bot_token: str
    postgres_dsn: str
    sqlite_path: str
    use_sqlite: bool
    owner_tg_id: int | None


@lru_cache(maxsize=1)
def get_env() -> EnvConfig:
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    postgres_dsn = os.getenv("POSTGRES_DSN", "").strip()
    sqlite_path = os.getenv("SQLITE_PATH", str(ROOT / "nbet.sqlite3")).strip()
    use_sqlite = os.getenv("USE_SQLITE", "1" if not postgres_dsn else "0").strip() in {"1", "true", "yes"}
    owner_raw = os.getenv("OWNER_TG_ID", "").strip()
    owner_tg_id = int(owner_raw) if owner_raw.isdigit() else None

    if not bot_token:
        raise RuntimeError("BOT_TOKEN is not set")
    if not use_sqlite and not postgres_dsn:
        raise RuntimeError("POSTGRES_DSN is not set (or set USE_SQLITE=1)")

    return EnvConfig(
        bot_token=bot_token,
        postgres_dsn=postgres_dsn,
        sqlite_path=sqlite_path,
        use_sqlite=use_sqlite,
        owner_tg_id=owner_tg_id,
    )


@lru_cache(maxsize=1)
def get_economy_config() -> dict:
    with CONFIG_PATH.open("rb") as f:
        return tomllib.load(f)


def reload_economy_config() -> dict:
    get_economy_config.cache_clear()
    return get_economy_config()


def cfg(*keys: str, default=None):
    node = get_economy_config()
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node
