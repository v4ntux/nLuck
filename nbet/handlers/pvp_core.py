from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select

from nbet.db.models import User
from nbet.db.session import SessionLocal
from nbet.services.economy import adjust_balance, get_or_create_user, record_game
from nbet.settings import cfg
from nbet.ui.theme import header, money, panel

router = Router(name="pvp_core")

LOBBY_TTL = 600.0
GAME_TITLES = {"duel": "⚔️ Дуэль", "bj": "🃏 Blackjack", "poker": "🂡 Texas Poker"}
CARD_GAMES = {"bj", "poker"}  # карты в личку — нужен открытый DM

lobbies: dict[int, "Lobby"] = {}
_seq = 0

# регистрируются игровыми модулями: game -> async fn(lobby, bot)
GAME_STARTERS: dict[str, Callable[["Lobby", Bot], Awaitable[None]]] = {}
GAME_TIMEOUTS: dict[str, Callable[["Lobby", Bot], Awaitable[None]]] = {}
GAME_CARD_VIEWS: dict[str, Callable[["Lobby", int], str]] = {}


@dataclass
class Lobby:
    id: int
    game: str
    chat_id: int
    bet: int
    creator: int
    players: list[int] = field(default_factory=list)
    names: dict[int, str] = field(default_factory=dict)
    target_tg: int | None = None
    target_username: str | None = None
    message_id: int | None = None
    status: str = "pending"  # pending | active | done
    created: float = field(default_factory=time.time)
    state: dict = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def name(self, tg_id: int) -> str:
        return self.names.get(tg_id, str(tg_id))

    @property
    def is_1v1(self) -> bool:
        return bool(self.target_tg or self.target_username)

    @property
    def max_players(self) -> int:
        if self.is_1v1:
            return 2
        return int(cfg("pvp", f"max_players_{self.game}", default=6))


def turn_seconds() -> int:
    return int(cfg("pvp", "turn_seconds", default=60))


def bump_turn(lobby: Lobby) -> None:
    lobby.state["turn_seq"] = lobby.state.get("turn_seq", 0) + 1


def schedule_timer(lobby: Lobby, bot: Bot) -> None:
    seq = lobby.state.get("turn_seq", 0)

    async def _timer() -> None:
        await asyncio.sleep(turn_seconds())
        if lobby.status == "active" and lobby.state.get("turn_seq") == seq:
            fn = GAME_TIMEOUTS.get(lobby.game)
            if fn:
                await fn(lobby, bot)

    asyncio.create_task(_timer())


async def balances(tg_ids: list[int]) -> dict[int, int]:
    if not tg_ids:
        return {}
    async with SessionLocal() as session:
        res = await session.execute(select(User.tg_id, User.coins).where(User.tg_id.in_(tg_ids)))
        return {row[0]: row[1] for row in res.all()}


async def edit_msg(lobby: Lobby, bot: Bot, text: str, kb: InlineKeyboardMarkup | None = None) -> None:
    if lobby.message_id is None:
        return
    try:
        await bot.edit_message_text(
            text, chat_id=lobby.chat_id, message_id=lobby.message_id, reply_markup=kb
        )
    except Exception:
        pass


async def dm(bot: Bot, tg_id: int, text: str) -> bool:
    try:
        await bot.send_message(tg_id, text)
        return True
    except Exception:
        return False


async def _refund_pending(lobby: Lobby) -> None:
    async with SessionLocal() as session:
        for tg in lobby.players:
            try:
                await adjust_balance(session, tg_id=tg, delta=lobby.bet, tx_type="pvp_refund")
            except Exception:
                pass


async def cleanup_expired(bot: Bot) -> None:
    now = time.time()
    for lobby in list(lobbies.values()):
        if lobby.status == "pending" and now - lobby.created > LOBBY_TTL:
            lobbies.pop(lobby.id, None)
            await _refund_pending(lobby)
            await edit_msg(lobby, bot, panel([header(GAME_TITLES[lobby.game]), "⌛ Лобби истекло, ставки возвращены"]))


async def settle(
    lobby: Lobby,
    bot: Bot,
    payouts: dict[int, int],
    lines: list[str],
    record: bool = True,
) -> None:
    """Выплаты + статистика + финальное сообщение. payouts: tg_id -> сумма выплаты."""
    lobby.status = "done"
    lobbies.pop(lobby.id, None)
    out = [header(GAME_TITLES[lobby.game])] + lines
    async with SessionLocal() as session:
        for tg in lobby.players:
            amount = payouts.get(tg, 0)
            if amount > 0:
                try:
                    await adjust_balance(session, tg_id=tg, delta=amount, tx_type="pvp_win")
                except Exception:
                    pass
        if record:
            for tg in lobby.players:
                res = await session.execute(select(User).where(User.tg_id == tg))
                user = res.scalar_one_or_none()
                if user:
                    payout = payouts.get(tg, 0)
                    _, achs = await record_game(
                        session, user, game=lobby.game, bet=lobby.bet,
                        payout=payout, won=payout > 0,
                    )
                    out += [f"🎉 {lobby.name(tg)}: {a}" for a in achs]
    bal = await balances(lobby.players)
    out.append("")
    for tg in lobby.players:
        out.append(f"💰 {lobby.name(tg)}: {bal.get(tg, 0):,}")
    await edit_msg(lobby, bot, panel(out))


# --- Лобби: текст и кнопки ---


async def lobby_view(lobby: Lobby, bot: Bot) -> tuple[str, InlineKeyboardMarkup]:
    bal = await balances(lobby.players)
    lines = [header(GAME_TITLES[lobby.game]), f"Ставка: {money(lobby.bet)}"]
    if lobby.target_username:
        lines.append(f"🎯 Вызов для @{lobby.target_username}")
    elif lobby.target_tg:
        lines.append("🎯 Личный вызов (по реплаю)")
    else:
        lines.append("🔓 Открытое лобби — присоединяйся!")
    lines.append(f"Игроки ({len(lobby.players)}/{lobby.max_players}):")
    for tg in lobby.players:
        crown = " 👑" if tg == lobby.creator else ""
        lines.append(f"• {lobby.name(tg)}{crown} — 💰 {bal.get(tg, 0):,}")
    if not lobby.is_1v1:
        min_p = int(cfg("pvp", "min_players", default=2))
        lines.append(f"▶️ Старт жмёт создатель (мин. {min_p})")

    join_label = "✅ Принять" if lobby.is_1v1 else "✅ Присоединиться"
    rows = [
        [
            InlineKeyboardButton(text=join_label, callback_data=f"pvp:join:{lobby.id}"),
            InlineKeyboardButton(text="🚪 Выйти", callback_data=f"pvp:leave:{lobby.id}"),
        ],
        [
            InlineKeyboardButton(text="▶️ Старт", callback_data=f"pvp:start:{lobby.id}"),
            InlineKeyboardButton(text="❌ Отмена", callback_data=f"pvp:cancel:{lobby.id}"),
        ],
    ]
    if lobby.game in CARD_GAMES:
        me = await bot.me()
        rows.append(
            [InlineKeyboardButton(text="📩 Открыть бота (для карт)", url=f"https://t.me/{me.username}")]
        )
    return panel(lines), InlineKeyboardMarkup(inline_keyboard=rows)


async def render_lobby(lobby: Lobby, bot: Bot) -> None:
    text, kb = await lobby_view(lobby, bot)
    await edit_msg(lobby, bot, text, kb)


# --- Создание ---


async def create_lobby(
    bot: Bot,
    chat_id: int,
    chat_type: str,
    game: str,
    bet: int,
    creator_tg: int,
    creator_name: str,
    creator_username: str | None,
    send: Callable[[str, InlineKeyboardMarkup], Awaitable[Message]],
    target_tg: int | None = None,
    target_username: str | None = None,
) -> str | None:
    """Создаёт лобби. Возвращает текст ошибки или None."""
    global _seq
    await cleanup_expired(bot)
    if chat_type == "private":
        return "⚔️ PvP работает в группах — добавь бота в группу!"
    min_bet = int(cfg("pvp", "min_bet", default=10))
    max_bet = int(cfg("pvp", "max_bet", default=100000))
    if not (min_bet <= bet <= max_bet):
        return f"Ставка {min_bet}..{max_bet}"

    if game in CARD_GAMES:
        if not await dm(bot, creator_tg, f"🎮 Лобби {GAME_TITLES[game]} создано — карты придут сюда."):
            me = await bot.me()
            return f"⚠️ Сначала открой бота t.me/{me.username} и нажми Start — туда придут карты."

    async with SessionLocal() as session:
        user = await get_or_create_user(session, tg_id=creator_tg, username=creator_username)
        if user.coins < bet:
            return f"Нужно {money(bet)}, у тебя {money(user.coins)}"
        await adjust_balance(session, tg_id=creator_tg, delta=-bet, tx_type="pvp_bet")

    _seq += 1
    lobby = Lobby(
        id=_seq, game=game, chat_id=chat_id, bet=bet, creator=creator_tg,
        players=[creator_tg], names={creator_tg: creator_name},
        target_tg=target_tg, target_username=target_username,
    )
    lobbies[lobby.id] = lobby
    text, kb = await lobby_view(lobby, bot)
    sent = await send(text, kb)
    lobby.message_id = sent.message_id
    return None


async def _create_from_command(message: Message, game: str) -> None:
    parts = (message.text or "").split()
    bet = int(cfg("pvp", "default_bet", default=100))
    target_tg: int | None = None
    target_username: str | None = None
    for p in parts[1:]:
        if p.startswith("@"):
            target_username = p[1:].lower()
        else:
            try:
                bet = int(p)
            except ValueError:
                pass
    reply = message.reply_to_message
    if reply and reply.from_user and not reply.from_user.is_bot and reply.from_user.id != message.from_user.id:
        target_tg = reply.from_user.id
        target_username = None
    if target_username and target_username == (message.from_user.username or "").lower():
        await message.answer("Сам с собой нельзя 😅")
        return

    err = await create_lobby(
        message.bot, message.chat.id, message.chat.type, game, bet,
        message.from_user.id, message.from_user.full_name, message.from_user.username,
        send=lambda text, kb: message.answer(text, reply_markup=kb),
        target_tg=target_tg, target_username=target_username,
    )
    if err:
        await message.answer(err)


@router.message(Command("duel"))
async def duel_cmd(message: Message) -> None:
    await _create_from_command(message, "duel")


@router.message(Command("bj", "blackjack"))
async def bj_cmd(message: Message) -> None:
    await _create_from_command(message, "bj")


@router.message(Command("poker"))
async def poker_cmd(message: Message) -> None:
    await _create_from_command(message, "poker")


@router.callback_query(F.data.startswith("pvp:new:"))
async def pvp_new(callback: CallbackQuery) -> None:
    game = callback.data.split(":")[2]
    if game not in GAME_TITLES or not callback.message:
        await callback.answer()
        return
    err = await create_lobby(
        callback.bot, callback.message.chat.id, callback.message.chat.type, game,
        int(cfg("pvp", "default_bet", default=100)),
        callback.from_user.id, callback.from_user.full_name, callback.from_user.username,
        send=lambda text, kb: callback.message.answer(text, reply_markup=kb),
    )
    if err:
        await callback.answer(err, show_alert=True)
    else:
        await callback.answer("Лобби создано!")


# --- Join / Leave / Start / Cancel ---


@router.callback_query(F.data.startswith("pvp:join:"))
async def pvp_join(callback: CallbackQuery) -> None:
    lobby = lobbies.get(int(callback.data.split(":")[2]))
    if not lobby or lobby.status != "pending":
        await callback.answer("Лобби недоступно", show_alert=True)
        return
    uid = callback.from_user.id
    async with lobby.lock:
        if lobby.status != "pending":
            await callback.answer("Игра уже началась", show_alert=True)
            return
        if uid in lobby.players:
            await callback.answer("Ты уже в лобби 😎")
            return
        if len(lobby.players) >= lobby.max_players:
            await callback.answer("Лобби заполнено", show_alert=True)
            return
        if lobby.target_tg and uid != lobby.target_tg:
            await callback.answer("Это личный вызов, не для тебя", show_alert=True)
            return
        if lobby.target_username and (callback.from_user.username or "").lower() != lobby.target_username:
            await callback.answer("Это личный вызов, не для тебя", show_alert=True)
            return

        # обязательный открытый DM для карточных игр
        if lobby.game in CARD_GAMES:
            if not await dm(callback.bot, uid, f"🎮 Ты в лобби {GAME_TITLES[lobby.game]}! Карты придут сюда."):
                me = await callback.bot.me()
                await callback.answer(
                    f"⚠️ Открой бота t.me/{me.username}, нажми Start и возвращайся — "
                    "иначе карты не придут!",
                    show_alert=True,
                )
                return

        async with SessionLocal() as session:
            user = await get_or_create_user(session, tg_id=uid, username=callback.from_user.username)
            if user.coins < lobby.bet:
                await callback.answer(f"Нужно {money(lobby.bet)}, у тебя {money(user.coins)}", show_alert=True)
                return
            await adjust_balance(session, tg_id=uid, delta=-lobby.bet, tx_type="pvp_bet")

        lobby.players.append(uid)
        lobby.names[uid] = callback.from_user.full_name
        await callback.answer("Ты в игре! 🎮")

        full = len(lobby.players) >= lobby.max_players
        auto_1v1 = lobby.is_1v1 and len(lobby.players) == 2
        if full or auto_1v1:
            lobby.status = "active"
        else:
            await render_lobby(lobby, callback.bot)
            return
    await GAME_STARTERS[lobby.game](lobby, callback.bot)


@router.callback_query(F.data.startswith("pvp:leave:"))
async def pvp_leave(callback: CallbackQuery) -> None:
    lobby = lobbies.get(int(callback.data.split(":")[2]))
    if not lobby or lobby.status != "pending":
        await callback.answer("Лобби недоступно", show_alert=True)
        return
    uid = callback.from_user.id
    async with lobby.lock:
        if uid not in lobby.players:
            await callback.answer("Ты не в лобби")
            return
        if uid == lobby.creator:
            await callback.answer("Создатель может только ❌ Отмена", show_alert=True)
            return
        lobby.players.remove(uid)
        async with SessionLocal() as session:
            await adjust_balance(session, tg_id=uid, delta=lobby.bet, tx_type="pvp_refund")
        await callback.answer("Вышел, ставка возвращена")
        await render_lobby(lobby, callback.bot)


@router.callback_query(F.data.startswith("pvp:start:"))
async def pvp_start(callback: CallbackQuery) -> None:
    lobby = lobbies.get(int(callback.data.split(":")[2]))
    if not lobby or lobby.status != "pending":
        await callback.answer("Лобби недоступно", show_alert=True)
        return
    uid = callback.from_user.id
    async with lobby.lock:
        if lobby.status != "pending":
            await callback.answer("Уже началось", show_alert=True)
            return
        if uid != lobby.creator:
            await callback.answer("Старт жмёт создатель 👑", show_alert=True)
            return
        min_p = int(cfg("pvp", "min_players", default=2))
        if len(lobby.players) < min_p:
            await callback.answer(f"Нужно минимум {min_p} игрока", show_alert=True)
            return
        lobby.status = "active"
    await callback.answer("Поехали! 🎮")
    await GAME_STARTERS[lobby.game](lobby, callback.bot)


@router.callback_query(F.data.startswith("pvp:cancel:"))
async def pvp_cancel(callback: CallbackQuery) -> None:
    lobby = lobbies.get(int(callback.data.split(":")[2]))
    if not lobby or lobby.status != "pending":
        await callback.answer("Лобби недоступно", show_alert=True)
        return
    uid = callback.from_user.id
    is_target = (lobby.target_tg and uid == lobby.target_tg) or (
        lobby.target_username and (callback.from_user.username or "").lower() == lobby.target_username
    )
    if uid != lobby.creator and not is_target:
        await callback.answer("Отменить может создатель (или вызванный)", show_alert=True)
        return
    async with lobby.lock:
        if lobby.status != "pending":
            await callback.answer("Уже началось", show_alert=True)
            return
        lobby.status = "done"
        lobbies.pop(lobby.id, None)
        await _refund_pending(lobby)
    await callback.answer()
    await edit_msg(lobby, callback.bot, panel([header(GAME_TITLES[lobby.game]), "❌ Лобби закрыто, ставки возвращены"]))


# --- Мои карты ---


@router.callback_query(F.data.startswith("pvp:cards:"))
async def pvp_cards(callback: CallbackQuery) -> None:
    lobby = lobbies.get(int(callback.data.split(":")[2]))
    if not lobby or lobby.status != "active":
        await callback.answer("Игра не активна", show_alert=True)
        return
    uid = callback.from_user.id
    if uid not in lobby.players:
        await callback.answer("Ты не в игре 👀", show_alert=True)
        return
    view = GAME_CARD_VIEWS.get(lobby.game)
    if not view:
        await callback.answer()
        return
    await callback.answer(view(lobby, uid), show_alert=True)
