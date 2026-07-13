from __future__ import annotations

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message

from nbet.services.ownership import register_panel
from nbet.ui.keyboards import main_menu_kb
from nbet.ui.theme import header, panel

router = Router(name="start")


@router.message(CommandStart())
async def start_cmd(message: Message) -> None:
    text = panel([header("Меню"), "", "🎮 Игры — PvP и Gamble", "👤 Профиль — статистика и достижения"])
    sent = await message.answer(text, reply_markup=main_menu_kb())
    register_panel(sent.chat.id, sent.message_id, message.from_user.id)
