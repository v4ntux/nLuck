from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

from nbet.db.session import SessionLocal
from nbet.services.economy import get_or_create_user
from nbet.services.ownership import EXEMPT_PREFIXES, claim_or_check
from nbet.settings import cfg, get_env

_GROUP_TYPES = {"group", "supergroup"}


class BanMiddleware(BaseMiddleware):
    """Авторегистрация каждого юзера (по сообщению И по кнопке) + бан-фильтр."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = event.from_user if isinstance(event, (Message, CallbackQuery)) else None
        if not user or user.is_bot:
            return await handler(event, data)

        async with SessionLocal() as session:
            db_user = await get_or_create_user(
                session,
                tg_id=user.id,
                username=user.username,
                owner_tg_id=get_env().owner_tg_id,
            )
            if db_user.is_banned:
                if isinstance(event, Message):
                    await event.answer("⛔ Аккаунт заблокирован.")
                elif isinstance(event, CallbackQuery):
                    await event.answer("⛔ Аккаунт заблокирован.", show_alert=True)
                return None
            data["db_user"] = db_user
        return await handler(event, data)


class GroupOwnershipMiddleware(BaseMiddleware):
    """В группах чужие панели жать нельзя (pvp: — можно всем)."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if (
            isinstance(event, CallbackQuery)
            and event.message
            and event.message.chat.type in _GROUP_TYPES
            and event.data
            and not event.data.startswith(EXEMPT_PREFIXES)
        ):
            if not claim_or_check(event.message.chat.id, event.message.message_id, event.from_user.id):
                await event.answer("🚫 Не твоя панель! Отправь /start", show_alert=True)
                return None
        return await handler(event, data)


class CallbackSpamMiddleware(BaseMiddleware):
    """Антиспам по кнопкам (in-memory)."""

    def __init__(self) -> None:
        self._last: dict[int, float] = {}

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if isinstance(event, CallbackQuery) and event.from_user:
            ms = int(cfg("anti_spam", "callback_cooldown_ms", default=300))
            now = time.monotonic()
            last = self._last.get(event.from_user.id, 0.0)
            if (now - last) * 1000 < ms:
                await event.answer("⏳")
                return None
            if len(self._last) > 10000:
                self._last.clear()
            self._last[event.from_user.id] = now
        return await handler(event, data)
