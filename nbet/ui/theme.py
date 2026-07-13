from __future__ import annotations

from nbet.settings import cfg


def header(title: str) -> str:
    name = cfg("bot", "name", default="nLucky")
    return f"🟣 <b>{name}</b> — {title}"


def money(amount: int) -> str:
    sym = cfg("bot", "currency_symbol", default="💰")
    return f"{amount:,} {sym}"


def panel(lines: list[str]) -> str:
    return "\n".join(lines)
