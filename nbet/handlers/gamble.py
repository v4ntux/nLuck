from __future__ import annotations

import asyncio

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton

from nbet.db.session import SessionLocal
from nbet.games.engine import (
    crash_point,
    flip_coin,
    hilo_roll,
    mines_positions,
    roll_1d6,
    slots_payout,
    spin_slots,
    wheel_pick,
)
from nbet.services.economy import adjust_balance, get_or_create_user, record_game
from nbet.settings import cfg
from nbet.ui.keyboards import (
    coinflip_kb,
    crash_kb,
    dice_kb,
    gamble_hub_kb,
    hilo_kb,
    mines_kb,
    slots_kb,
    wheel_kb,
)
from nbet.ui.theme import header, money, panel

router = Router(name="gamble")


class MinesState(StatesGroup):
    playing = State()


class CrashState(StatesGroup):
    playing = State()


def _bet(game: str) -> int:
    return int(cfg("games", game, "bet", default=100))


async def _edit(callback: CallbackQuery, text: str, kb) -> None:
    if callback.message:
        try:
            await callback.message.edit_text(text, reply_markup=kb)
        except Exception:
            pass


async def _take_bet(callback: CallbackQuery, bet: int, tx_type: str) -> bool:
    """Списывает ставку. False + alert, если не хватает Coins."""
    async with SessionLocal() as session:
        await get_or_create_user(
            session, tg_id=callback.from_user.id, username=callback.from_user.username
        )
        try:
            await adjust_balance(session, tg_id=callback.from_user.id, delta=-bet, tx_type=tx_type)
        except ValueError:
            await callback.answer(f"Нужно {bet} Coins 💰", show_alert=True)
            return False
    return True


async def _finish(
    callback: CallbackQuery,
    *,
    game: str,
    bet: int,
    payout: int,
    won: bool,
    details: str,
    result_line: str,
) -> None:
    """Начисляет выигрыш, пишет статистику, показывает результат."""
    async with SessionLocal() as session:
        if payout > 0:
            await adjust_balance(session, tg_id=callback.from_user.id, delta=payout, tx_type=f"{game}_win")
        user = await get_or_create_user(
            session, tg_id=callback.from_user.id, username=callback.from_user.username
        )
        user, achs = await record_game(
            session, user, game=game, bet=bet, payout=payout, won=won, details=details
        )
    lines = [header(game.capitalize()), result_line]
    if won:
        lines.append(f"🏆 +{money(payout - bet)}")
    else:
        lines.append(f"💔 -{money(bet)}")
    lines.append(f"💰 {money(user.coins)}")
    lines += [f"🎉 {a}" for a in achs]
    await _edit(callback, panel(lines), gamble_hub_kb())


# --- Входы в игры ---


@router.callback_query(F.data == "g:dice")
async def entry_dice(callback: CallbackQuery) -> None:
    await callback.answer()
    await _edit(
        callback,
        panel([header("Dice"), f"Ставка: {money(_bet('dice'))}", "Угадай число 👇"]),
        dice_kb(),
    )


@router.callback_query(F.data == "g:slots")
async def entry_slots(callback: CallbackQuery) -> None:
    await callback.answer()
    await _edit(callback, panel([header("Slots"), f"Ставка: {money(_bet('slots'))}"]), slots_kb())


@router.callback_query(F.data == "g:coinflip")
async def entry_coinflip(callback: CallbackQuery) -> None:
    await callback.answer()
    await _edit(
        callback, panel([header("Coin"), f"Ставка: {money(_bet('coinflip'))}"]), coinflip_kb()
    )


@router.callback_query(F.data == "g:hilo")
async def entry_hilo(callback: CallbackQuery) -> None:
    await callback.answer()
    thr = int(cfg("games", "hilo", "threshold", default=3))
    await _edit(
        callback,
        panel([header("HiLo"), f"Ставка: {money(_bet('hilo'))}", f"Кубик больше {thr}?"]),
        hilo_kb(),
    )


@router.callback_query(F.data == "g:wheel")
async def entry_wheel(callback: CallbackQuery) -> None:
    await callback.answer()
    await _edit(callback, panel([header("Wheel"), f"Ставка: {money(_bet('wheel'))}"]), wheel_kb())


# --- Игра ---


@router.callback_query(F.data.startswith("gd:"))
async def play_dice(callback: CallbackQuery) -> None:
    await callback.answer()
    chosen = int(callback.data.split(":", 1)[1])
    bet = _bet("dice")
    mult = int(cfg("games", "dice", "win_multiplier", default=5))
    if not await _take_bet(callback, bet, "dice_bet"):
        return
    actual = roll_1d6()
    won = actual == chosen
    await _finish(
        callback,
        game="dice",
        bet=bet,
        payout=bet * mult if won else 0,
        won=won,
        details=f"{chosen}/{actual}",
        result_line=f"Ты: {chosen} | 🎲 {actual}",
    )


@router.callback_query(F.data == "gs:spin")
async def play_slots(callback: CallbackQuery) -> None:
    await callback.answer()
    bet = _bet("slots")
    symbols = list(cfg("games", "slots", "symbols", default=["🍒", "🍋", "🍊"]))
    p3 = int(cfg("games", "slots", "payout_three", default=10))
    p2 = int(cfg("games", "slots", "payout_two", default=2))
    if not await _take_bet(callback, bet, "slots_bet"):
        return
    reels = spin_slots(symbols)
    await _edit(callback, panel([header("Slots"), "🎰 ..."]), slots_kb())
    await asyncio.sleep(0.4)
    mult = slots_payout(reels, p3, p2)
    won = mult > 0
    await _finish(
        callback,
        game="slots",
        bet=bet,
        payout=bet * mult,
        won=won,
        details="".join(reels),
        result_line=f"{reels[0]} {reels[1]} {reels[2]}",
    )


@router.callback_query(F.data.startswith("gc:"))
async def play_coinflip(callback: CallbackQuery) -> None:
    await callback.answer()
    pick = callback.data.split(":", 1)[1]
    bet = _bet("coinflip")
    mult = int(cfg("games", "coinflip", "win_multiplier", default=2))
    if not await _take_bet(callback, bet, "coinflip_bet"):
        return
    result = flip_coin()
    won = result == pick
    emoji = "🦅 Орёл" if result == "heads" else "🪙 Решка"
    await _finish(
        callback,
        game="coinflip",
        bet=bet,
        payout=bet * mult if won else 0,
        won=won,
        details=result,
        result_line=emoji,
    )


@router.callback_query(F.data.startswith("gh:"))
async def play_hilo(callback: CallbackQuery) -> None:
    await callback.answer()
    side = callback.data.split(":", 1)[1]
    bet = _bet("hilo")
    thr = int(cfg("games", "hilo", "threshold", default=3))
    mult = int(cfg("games", "hilo", "win_multiplier", default=2))
    if not await _take_bet(callback, bet, "hilo_bet"):
        return
    roll = hilo_roll()
    won = (side == "high" and roll > thr) or (side == "low" and roll <= thr)
    await _finish(
        callback,
        game="hilo",
        bet=bet,
        payout=bet * mult if won else 0,
        won=won,
        details=str(roll),
        result_line=f"🎲 {roll}",
    )


@router.callback_query(F.data == "gw:spin")
async def play_wheel(callback: CallbackQuery) -> None:
    await callback.answer()
    bet = _bet("wheel")
    segments = list(cfg("games", "wheel", "segments", default=[{"label": "x2", "multiplier": 2}]))
    if not await _take_bet(callback, bet, "wheel_bet"):
        return
    seg = wheel_pick(segments)
    mult = float(seg.get("multiplier", 0))
    payout = int(bet * mult)
    await _finish(
        callback,
        game="wheel",
        bet=bet,
        payout=payout,
        won=payout > bet,
        details=str(seg.get("label")),
        result_line=f"🎡 {seg.get('label')}",
    )


# --- Mines (FSM) ---


def _mines_grid(size: int, revealed: set[int], cashout: bool):
    cells = [
        InlineKeyboardButton(
            text="✅" if i in revealed else "⬜", callback_data=f"gm:{i}"
        )
        for i in range(size * size)
    ]
    return mines_kb(cells, cashout=cashout)


@router.callback_query(F.data == "g:mines")
async def entry_mines(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    bet = _bet("mines")
    size = int(cfg("games", "mines", "grid_size", default=5))
    count = int(cfg("games", "mines", "mine_count", default=5))
    if not await _take_bet(callback, bet, "mines_bet"):
        return
    await state.set_state(MinesState.playing)
    await state.update_data(
        bet=bet, mines=list(mines_positions(size, count)), revealed=[], mult=1.0, size=size
    )
    await _edit(
        callback,
        panel([header("Mines"), f"Ставка: {money(bet)}", "Открывай клетки, 💣 не попади!"]),
        _mines_grid(size, set(), cashout=False),
    )


@router.callback_query(F.data == "gm:cash", MinesState.playing)
async def mines_cashout(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    data = await state.get_data()
    await state.clear()
    bet = int(data.get("bet", 0))
    mult = float(data.get("mult", 1.0))
    payout = int(bet * mult)
    await _finish(
        callback,
        game="mines",
        bet=bet,
        payout=payout,
        won=payout > bet,
        details=f"x{mult:.2f}",
        result_line=f"💸 Cash Out x{mult:.2f}",
    )


@router.callback_query(F.data.startswith("gm:"), MinesState.playing)
async def mines_cell(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    idx = int(callback.data.split(":", 1)[1])
    data = await state.get_data()
    mines = set(data.get("mines", []))
    revealed = set(data.get("revealed", []))
    bet = int(data.get("bet", 0))
    mult = float(data.get("mult", 1.0))
    size = int(data.get("size", 5))
    if idx in revealed:
        return
    if idx in mines:
        await state.clear()
        await _finish(
            callback,
            game="mines",
            bet=bet,
            payout=0,
            won=False,
            details="boom",
            result_line="💥 BOOM!",
        )
        return
    revealed.add(idx)
    mult += float(cfg("games", "mines", "multiplier_per_safe", default=0.25))
    await state.update_data(revealed=list(revealed), mult=mult)
    await _edit(
        callback,
        panel([header("Mines"), f"x{mult:.2f}", "Дальше или Cash Out 💸"]),
        _mines_grid(size, revealed, cashout=True),
    )


# --- Crash (FSM) ---


@router.callback_query(F.data == "g:crash")
async def entry_crash(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    bet = _bet("crash")
    if not await _take_bet(callback, bet, "crash_bet"):
        return
    await state.set_state(CrashState.playing)
    await state.update_data(bet=bet, crash_at=crash_point(), current=1.0)
    await _edit(
        callback,
        panel([header("Crash"), f"Ставка: {money(bet)}", "x1.00 🚀", "Жми Cash Out до 💥"]),
        crash_kb(),
    )
    asyncio.create_task(_crash_tick(callback, state))


async def _crash_tick(callback: CallbackQuery, state: FSMContext) -> None:
    tick = float(cfg("games", "crash", "tick_seconds", default=0.4))
    while True:
        await asyncio.sleep(tick)
        data = await state.get_data()
        if not data or "crash_at" not in data:
            return
        current = round(float(data.get("current", 1.0)) + 0.12, 2)
        crash_at = float(data.get("crash_at", 2.0))
        bet = int(data.get("bet", 0))
        if current >= crash_at:
            await state.clear()
            await _finish(
                callback,
                game="crash",
                bet=bet,
                payout=0,
                won=False,
                details=f"crash@{crash_at}",
                result_line=f"💥 CRASH @ x{crash_at:.2f}",
            )
            return
        await state.update_data(current=current)
        await _edit(callback, panel([header("Crash"), f"x{current:.2f} 🚀", "Cash Out!"]), crash_kb())


@router.callback_query(F.data == "gx:cash", CrashState.playing)
async def crash_cashout(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    data = await state.get_data()
    await state.clear()
    if not data:
        return
    bet = int(data.get("bet", 0))
    current = float(data.get("current", 1.0))
    payout = int(bet * current)
    await _finish(
        callback,
        game="crash",
        bet=bet,
        payout=payout,
        won=payout > bet,
        details=f"x{current:.2f}",
        result_line=f"💸 Cash Out x{current:.2f}",
    )
