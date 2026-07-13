from __future__ import annotations

from aiogram.filters import BaseFilter
from aiogram.types import CallbackQuery, Message, TelegramObject

from nbet.db.session import SessionLocal
from nbet.services.economy import get_or_create_user
from nbet.settings import get_env


class IsAdmin(BaseFilter):
    async def __call__(self, obj: TelegramObject, *args, **kwargs) -> bool:
        tg_user = obj.from_user if isinstance(obj, (Message, CallbackQuery)) else getattr(obj, "from_user", None)
        if not tg_user:
            return False
        async with SessionLocal() as session:
            user = await get_or_create_user(
                session,
                tg_id=tg_user.id,
                username=tg_user.username,
                owner_tg_id=get_env().owner_tg_id,
            )
            return user.role in {"admin", "owner", "moderator"}
