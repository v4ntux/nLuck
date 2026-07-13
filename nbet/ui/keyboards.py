from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def back_btn(data: str = "menu:main") -> InlineKeyboardButton:
    return InlineKeyboardButton(text="⬅️ Назад", callback_data=data)


def main_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🎮 Игры", callback_data="menu:games"),
                InlineKeyboardButton(text="👤 Профиль", callback_data="menu:profile"),
            ],
        ]
    )


def games_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="⚔️ PvP", callback_data="menu:pvp"),
                InlineKeyboardButton(text="🎰 Gamble", callback_data="menu:gamble"),
            ],
            [back_btn()],
        ]
    )


def pvp_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="⚔️ Дуэль", callback_data="pvp:new:duel"),
                InlineKeyboardButton(text="🃏 Blackjack", callback_data="pvp:new:bj"),
            ],
            [InlineKeyboardButton(text="🂡 Poker", callback_data="pvp:new:poker")],
            [back_btn("menu:games")],
        ]
    )


def gamble_hub_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🎲 Dice", callback_data="g:dice"),
                InlineKeyboardButton(text="🎰 Slots", callback_data="g:slots"),
            ],
            [
                InlineKeyboardButton(text="🪙 Coin", callback_data="g:coinflip"),
                InlineKeyboardButton(text="💣 Mines", callback_data="g:mines"),
            ],
            [
                InlineKeyboardButton(text="🚀 Crash", callback_data="g:crash"),
                InlineKeyboardButton(text="🎡 Wheel", callback_data="g:wheel"),
            ],
            [InlineKeyboardButton(text="🎯 HiLo", callback_data="g:hilo")],
            [back_btn("menu:games")],
        ]
    )


def dice_kb() -> InlineKeyboardMarkup:
    row = [InlineKeyboardButton(text=str(n), callback_data=f"gd:{n}") for n in range(1, 7)]
    return InlineKeyboardMarkup(inline_keyboard=[row[:3], row[3:], [back_btn("menu:gamble")]])


def slots_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🎰 Spin", callback_data="gs:spin")],
            [back_btn("menu:gamble")],
        ]
    )


def coinflip_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🦅 Орёл", callback_data="gc:heads"),
                InlineKeyboardButton(text="🪙 Решка", callback_data="gc:tails"),
            ],
            [back_btn("menu:gamble")],
        ]
    )


def hilo_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="⬆️ Больше", callback_data="gh:high"),
                InlineKeyboardButton(text="⬇️ Меньше", callback_data="gh:low"),
            ],
            [back_btn("menu:gamble")],
        ]
    )


def wheel_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🎡 Крутить", callback_data="gw:spin")],
            [back_btn("menu:gamble")],
        ]
    )


def crash_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="💸 Cash Out", callback_data="gx:cash")],
            [back_btn("menu:gamble")],
        ]
    )


def mines_kb(cells: list[InlineKeyboardButton], cashout: bool = False) -> InlineKeyboardMarkup:
    rows = [cells[i : i + 5] for i in range(0, len(cells), 5)]
    if cashout:
        rows.append([InlineKeyboardButton(text="💸 Cash Out", callback_data="gm:cash")])
    rows.append([back_btn("menu:gamble")])
    return InlineKeyboardMarkup(inline_keyboard=rows)
