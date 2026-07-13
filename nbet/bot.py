from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from nbet.db.session import ensure_schema
from nbet.handlers.admin import router as admin_router
from nbet.handlers.commands import router as commands_router
from nbet.handlers.gamble import router as gamble_router
from nbet.handlers.menu import router as menu_router
from nbet.handlers.pvp import router as pvp_router
from nbet.handlers.start import router as start_router
from nbet.middlewares import BanMiddleware, CallbackSpamMiddleware, GroupOwnershipMiddleware
from nbet.settings import get_env

logger = logging.getLogger(__name__)

BOT_COMMANDS = [
    BotCommand(command="start", description="🟣 Меню"),
    BotCommand(command="balance", description="💰 Баланс"),
    BotCommand(command="daily", description="📅 Ежедневные Coins"),
    BotCommand(command="duel", description="⚔️ Дуэль (PvP)"),
    BotCommand(command="bj", description="🃏 Blackjack (PvP)"),
    BotCommand(command="poker", description="🂡 Poker (PvP)"),
    BotCommand(command="top", description="🏆 Топ богатых"),
    BotCommand(command="gift", description="🎁 Подарить Coins"),
    BotCommand(command="help", description="ℹ️ Команды"),
]


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    env = get_env()
    bot = Bot(token=env.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=MemoryStorage())

    dp.message.middleware(BanMiddleware())
    dp.callback_query.middleware(BanMiddleware())
    dp.callback_query.middleware(CallbackSpamMiddleware())
    dp.callback_query.middleware(GroupOwnershipMiddleware())

    await ensure_schema()

    dp.include_router(start_router)
    dp.include_router(menu_router)
    dp.include_router(gamble_router)
    dp.include_router(pvp_router)
    dp.include_router(admin_router)
    dp.include_router(commands_router)

    await bot.set_my_commands(BOT_COMMANDS)
    await dp.start_polling(bot)


def run() -> None:
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        raise


if __name__ == "__main__":
    run()
