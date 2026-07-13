from __future__ import annotations

from aiogram import F, Router
from aiogram.types import CallbackQuery

from nbet.db.session import SessionLocal
from nbet.services.achievements import ACHIEVEMENTS, get_unlocked
from nbet.services.economy import get_or_create_user, title_for_level
from nbet.settings import cfg
from nbet.ui.keyboards import gamble_hub_kb, games_menu_kb, main_menu_kb, pvp_menu_kb
from nbet.ui.theme import header, money, panel

router = Router(name="menu")


async def _edit(callback: CallbackQuery, text: str, kb) -> None:
    if callback.message:
        try:
            await callback.message.edit_text(text, reply_markup=kb)
        except Exception:
            pass


@router.callback_query(F.data == "menu:main")
async def menu_main(callback: CallbackQuery) -> None:
    await callback.answer()
    await _edit(callback, panel([header("Меню"), "", "Выбери раздел 👇"]), main_menu_kb())


@router.callback_query(F.data == "menu:games")
async def menu_games(callback: CallbackQuery) -> None:
    await callback.answer()
    text = panel([header("Игры"), "", "⚔️ PvP — против игроков", "🎰 Gamble — соло на Coins"])
    await _edit(callback, text, games_menu_kb())


@router.callback_query(F.data == "menu:pvp")
async def menu_pvp(callback: CallbackQuery) -> None:
    await callback.answer()
    bet = int(cfg("pvp", "default_bet", default=100))
    text = panel(
        [
            header("PvP"),
            "",
            f"Кнопка — открытый вызов на {money(bet)}.",
            "Или командой со своей ставкой:",
            "/duel @user 500 — дуэль 🎲",
            "/bj @user 500 — блэкджек 🃏",
            "/poker @user 500 — покер 🂡",
            "(без @user — вызов для всех)",
        ]
    )
    await _edit(callback, text, pvp_menu_kb())


@router.callback_query(F.data == "menu:gamble")
async def menu_gamble(callback: CallbackQuery) -> None:
    await callback.answer()
    await _edit(callback, panel([header("Gamble"), "", "Выбери игру 👇"]), gamble_hub_kb())


@router.callback_query(F.data == "menu:profile")
async def menu_profile(callback: CallbackQuery) -> None:
    await callback.answer()
    async with SessionLocal() as session:
        user = await get_or_create_user(
            session, tg_id=callback.from_user.id, username=callback.from_user.username
        )
        unlocked = await get_unlocked(session, user.id)
    total = user.wins + user.loses
    winrate = (user.wins / total * 100) if total else 0.0
    lines = [
        header("Профиль"),
        f"👤 {callback.from_user.full_name}",
        f"💰 {money(user.coins)}",
        f"🏆 {user.wins} | ❌ {user.loses} | 📈 {winrate:.0f}%",
        f"⭐ Lv{user.level} {title_for_level(user.level)} | 🔥 {user.streak}",
        "",
        f"🏅 Достижения {len(unlocked)}/{len(ACHIEVEMENTS)}:",
    ]
    for key, (title, _) in ACHIEVEMENTS.items():
        lines.append(f"{'✅' if key in unlocked else '▫️'} {title}")
    await _edit(callback, panel(lines), main_menu_kb())
