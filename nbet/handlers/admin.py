from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from sqlalchemy import select

from nbet.db.models import User
from nbet.db.session import SessionLocal
from nbet.filters.admin import IsAdmin
from nbet.services.economy import adjust_balance, get_or_create_user
from nbet.ui.theme import header, money, panel

router = Router(name="admin")
router.message.filter(IsAdmin())


async def _resolve_target(message: Message, args: list[str]) -> tuple[int | None, str, str | None]:
    """(tg_id, name, amount_raw) — цель по реплаю или @username."""
    reply = message.reply_to_message
    if reply and reply.from_user and not reply.from_user.is_bot:
        async with SessionLocal() as session:
            await get_or_create_user(
                session, tg_id=reply.from_user.id, username=reply.from_user.username
            )
        return reply.from_user.id, reply.from_user.full_name, (args[1] if len(args) > 1 else None)
    if len(args) >= 2 and args[1].startswith("@"):
        async with SessionLocal() as session:
            res = await session.execute(select(User).where(User.username == args[1][1:]))
            user = res.scalar_one_or_none()
        if not user:
            return None, "", None
        return user.tg_id, f"@{user.username}", (args[2] if len(args) > 2 else None)
    return None, "", None


def _parse_amount(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        amount = int(raw)
    except ValueError:
        return None
    return amount if amount > 0 else None


@router.message(Command("give"))
async def give_cmd(message: Message) -> None:
    args = (message.text or "").split()
    tg_id, name, amount_raw = await _resolve_target(message, args)
    amount = _parse_amount(amount_raw)
    if not tg_id or not amount:
        await message.answer("Использование: /give @user 1000 (или ответом: /give 1000)")
        return
    async with SessionLocal() as session:
        user = await adjust_balance(session, tg_id=tg_id, delta=amount, tx_type="admin_give")
    await message.answer(f"✅ +{money(amount)} → {name} | Баланс: {money(user.coins)}")


@router.message(Command("take"))
async def take_cmd(message: Message) -> None:
    args = (message.text or "").split()
    tg_id, name, amount_raw = await _resolve_target(message, args)
    amount = _parse_amount(amount_raw)
    if not tg_id or not amount:
        await message.answer("Использование: /take @user 1000 (или ответом: /take 1000)")
        return
    async with SessionLocal() as session:
        res = await session.execute(select(User).where(User.tg_id == tg_id))
        user = res.scalar_one_or_none()
        if not user:
            await message.answer("Игрок не найден")
            return
        amount = min(amount, user.coins)
        if amount > 0:
            user = await adjust_balance(session, tg_id=tg_id, delta=-amount, tx_type="admin_take")
    await message.answer(f"✅ -{money(amount)} у {name} | Баланс: {money(user.coins)}")


async def _set_ban(message: Message, banned: bool) -> None:
    args = (message.text or "").split()
    tg_id, name, _ = await _resolve_target(message, args)
    if not tg_id:
        await message.answer("Использование: /ban @user (или ответом)")
        return
    async with SessionLocal() as session:
        res = await session.execute(select(User).where(User.tg_id == tg_id))
        user = res.scalar_one_or_none()
        if not user:
            await message.answer("Игрок не найден")
            return
        if user.role == "owner":
            await message.answer("Владельца нельзя 😅")
            return
        user.is_banned = banned
        await session.commit()
    await message.answer(f"{'⛔ Забанен' if banned else '✅ Разбанен'}: {name}")


@router.message(Command("ban"))
async def ban_cmd(message: Message) -> None:
    await _set_ban(message, True)


@router.message(Command("unban"))
async def unban_cmd(message: Message) -> None:
    await _set_ban(message, False)


@router.message(Command("admin"))
async def admin_cmd(message: Message) -> None:
    await message.answer(
        panel(
            [
                header("Админ"),
                "/give @user 1000 — выдать Coins",
                "/take @user 1000 — забрать Coins",
                "/ban @user — бан",
                "/unban @user — разбан",
                "(все работают и ответом на сообщение)",
            ]
        )
    )
