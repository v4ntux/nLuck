from __future__ import annotations

from aiogram import Bot, F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from nbet.games.cards import bj_value, fmt_hand, new_deck
from nbet.games.engine import roll_1d6
from nbet.handlers.pvp_core import (
    GAME_CARD_VIEWS,
    GAME_STARTERS,
    GAME_TIMEOUTS,
    GAME_TITLES,
    Lobby,
    balances,
    bump_turn,
    dm,
    edit_msg,
    header,
    lobbies,
    money,
    panel,
    schedule_timer,
    settle,
)

router = Router(name="pvp_games")


# ================= Дуэль (все бросают кубик, банк победителю) =================


async def duel_start(lobby: Lobby, bot: Bot) -> None:
    pot = lobby.bet * len(lobby.players)
    contenders = list(lobby.players)
    rolls: dict[int, int] = {}
    lines: list[str] = []
    round_n = 1
    while True:
        for tg in contenders:
            rolls[tg] = roll_1d6()
        best = max(rolls[tg] for tg in contenders)
        leaders = [tg for tg in contenders if rolls[tg] == best]
        prefix = f"Раунд {round_n}: " if round_n > 1 or len(lobby.players) > 2 else ""
        lines.append(prefix + " | ".join(f"{lobby.name(tg)} 🎲{rolls[tg]}" for tg in contenders))
        if len(leaders) == 1:
            winner = leaders[0]
            break
        contenders = leaders
        round_n += 1
    lines.append(f"🏆 {lobby.name(winner)} забирает {money(pot)}!")
    await settle(lobby, bot, {winner: pot}, lines)


GAME_STARTERS["duel"] = duel_start


# ================= Blackjack (мультиплеер, по очереди) =================


def _bj_kb(mid: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🃏 Мои карты", callback_data=f"pvp:cards:{mid}")],
            [
                InlineKeyboardButton(text="🎯 Ещё", callback_data=f"pvp:hit:{mid}"),
                InlineKeyboardButton(text="✋ Хватит", callback_data=f"pvp:stand:{mid}"),
            ],
        ]
    )


async def _bj_text(lobby: Lobby) -> str:
    st = lobby.state
    bal = await balances(lobby.players)
    lines = [
        header(GAME_TITLES["bj"]),
        f"Банк: {money(lobby.bet * len(lobby.players))}",
        "Цель: ближе всех к 21, не перебрав.",
    ]
    for tg in lobby.players:
        mark = "▶️ " if tg == st["turn"] else ("💥 " if tg in st.get("busted", set()) else "")
        done = " ✅" if tg in st["done"] and tg not in st.get("busted", set()) else ""
        lines.append(f"{mark}{lobby.name(tg)} (💰{bal.get(tg, 0):,}) — 🂠×{len(st['hands'][tg])}{done}")
    lines.append(f"Ход: {lobby.name(st['turn'])} (⏱ авто-стоп через минуту)")
    return panel(lines)


def _bj_card_view(lobby: Lobby, tg: int) -> str:
    hand = lobby.state["hands"][tg]
    return f"🃏 {fmt_hand(hand)} ({bj_value(hand)})"


async def bj_start(lobby: Lobby, bot: Bot) -> None:
    deck = new_deck()
    hands = {tg: [deck.pop(), deck.pop()] for tg in lobby.players}
    lobby.state = {
        "deck": deck,
        "hands": hands,
        "turn": lobby.players[0],
        "done": set(),
        "busted": set(),
        "turn_seq": 0,
    }
    for tg in lobby.players:
        await dm(bot, tg, f"🃏 Blackjack: {fmt_hand(hands[tg])} ({bj_value(hands[tg])})")
    await edit_msg(lobby, bot, await _bj_text(lobby), _bj_kb(lobby.id))
    schedule_timer(lobby, bot)


GAME_STARTERS["bj"] = bj_start
GAME_CARD_VIEWS["bj"] = _bj_card_view


async def _bj_next(lobby: Lobby, bot: Bot) -> None:
    st = lobby.state
    remaining = [tg for tg in lobby.players if tg not in st["done"]]
    if not remaining:
        await _bj_showdown(lobby, bot)
        return
    idx = lobby.players.index(st["turn"])
    order = lobby.players[idx + 1 :] + lobby.players[: idx + 1]
    st["turn"] = next(tg for tg in order if tg not in st["done"])
    bump_turn(lobby)
    await edit_msg(lobby, bot, await _bj_text(lobby), _bj_kb(lobby.id))
    schedule_timer(lobby, bot)


async def _bj_showdown(lobby: Lobby, bot: Bot) -> None:
    st = lobby.state
    values = {tg: bj_value(st["hands"][tg]) for tg in lobby.players}
    lines = []
    for tg in lobby.players:
        v = values[tg]
        lines.append(f"{lobby.name(tg)}: {fmt_hand(st['hands'][tg])} = {v}{' 💥' if v > 21 else ''}")
    alive = {tg: v for tg, v in values.items() if v <= 21}
    pot = lobby.bet * len(lobby.players)
    if not alive:
        payouts = {tg: lobby.bet for tg in lobby.players}
        lines.append("💥 Все перебрали — ставки возвращены")
        await settle(lobby, bot, payouts, lines, record=False)
        return
    best = max(alive.values())
    winners = [tg for tg, v in alive.items() if v == best]
    share, rem = divmod(pot, len(winners))
    payouts = {tg: share + (1 if i < rem else 0) for i, tg in enumerate(winners)}
    names = ", ".join(lobby.name(tg) for tg in winners)
    lines.append(f"🏆 {names}: {best} — банк {money(pot)}!")
    await settle(lobby, bot, payouts, lines)


async def _bj_act(callback: CallbackQuery, action: str) -> None:
    lobby = lobbies.get(int(callback.data.split(":")[2]))
    if not lobby or lobby.status != "active" or lobby.game != "bj":
        await callback.answer("Игра не активна", show_alert=True)
        return
    uid = callback.from_user.id
    async with lobby.lock:
        if lobby.status != "active":
            return
        st = lobby.state
        if uid not in lobby.players:
            await callback.answer("Ты не в игре", show_alert=True)
            return
        if st["turn"] != uid or uid in st["done"]:
            await callback.answer("Не твой ход", show_alert=True)
            return
        if action == "hit":
            hand = st["hands"][uid]
            hand.append(st["deck"].pop())
            value = bj_value(hand)
            await dm(callback.bot, uid, f"🃏 {fmt_hand(hand)} ({value})")
            if value > 21:
                st["done"].add(uid)
                st["busted"].add(uid)
                await callback.answer(f"💥 Перебор! {fmt_hand(hand)} = {value}", show_alert=True)
                await _bj_next(lobby, callback.bot)
            else:
                await callback.answer(f"{fmt_hand(hand)} ({value})", show_alert=True)
                bump_turn(lobby)
                await edit_msg(lobby, callback.bot, await _bj_text(lobby), _bj_kb(lobby.id))
                schedule_timer(lobby, callback.bot)
        else:  # stand
            st["done"].add(uid)
            await callback.answer("✋ Хватит")
            await _bj_next(lobby, callback.bot)


@router.callback_query(F.data.startswith("pvp:hit:"))
async def bj_hit(callback: CallbackQuery) -> None:
    await _bj_act(callback, "hit")


@router.callback_query(F.data.startswith("pvp:stand:"))
async def bj_stand(callback: CallbackQuery) -> None:
    await _bj_act(callback, "stand")


async def _bj_timeout(lobby: Lobby, bot: Bot) -> None:
    """АФК — авто-стоп текущего игрока."""
    async with lobby.lock:
        if lobby.status != "active":
            return
        st = lobby.state
        uid = st["turn"]
        if uid in st["done"]:
            return
        st["done"].add(uid)
        await _bj_next(lobby, bot)


GAME_TIMEOUTS["bj"] = _bj_timeout
