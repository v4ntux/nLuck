from __future__ import annotations

import datetime as dt

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from sqlalchemy import desc, select

from nbet.db.models import User
from nbet.db.session import SessionLocal
from nbet.services.economy import (
    adjust_balance,
    can_claim_daily,
    get_or_create_user,
    set_daily_claim,
)
from nbet.settings import cfg
from nbet.ui.theme import header, money, panel

router = Router(name="commands")


@router.message(Command("balance"))
async def balance_cmd(message: Message) -> None:
    async with SessionLocal() as session:
        user = await get_or_create_user(
            session, tg_id=message.from_user.id, username=message.from_user.username
        )
    await message.answer(f"💰 {money(user.coins)}")


@router.message(Command("daily"))
async def daily_cmd(message: Message) -> None:
    tg_id = message.from_user.id
    now = dt.datetime.now(dt.timezone.utc)
    reward = int(cfg("daily", "reward", default=500))
    hours = int(cfg("daily", "cooldown_hours", default=24))
    async with SessionLocal() as session:
        await get_or_create_user(session, tg_id=tg_id, username=message.from_user.username)
        if not await can_claim_daily(session, tg_id, hours, now):
            await message.answer("📅 Уже получал сегодня ⏳")
            return
        user = await adjust_balance(session, tg_id=tg_id, delta=reward, tx_type="daily")
        await set_daily_claim(session, tg_id, now)
    await message.answer(f"📅 +{money(reward)}! Баланс: {money(user.coins)}")


@router.message(Command("top"))
async def top_cmd(message: Message) -> None:
    async with SessionLocal() as session:
        res = await session.execute(select(User).order_by(desc(User.coins)).limit(10))
        rows = list(res.scalars().all())
    lines = [header("Топ 💰"), ""]
    for i, u in enumerate(rows, 1):
        lines.append(f"{i}. {u.username or u.tg_id} — {money(u.coins)}")
    await message.answer(panel(lines))


@router.message(Command("gift"))
async def gift_cmd(message: Message) -> None:
    """/gift @user 100 — или ответом: /gift 100"""
    args = (message.text or "").split()
    target_tg_id: int | None = None
    target_name = ""

    reply = message.reply_to_message
    if reply and reply.from_user and len(args) == 2:
        if reply.from_user.is_bot:
            await message.answer("Ботам дарить нельзя 🤖")
            return
        target_tg_id = reply.from_user.id
        target_name = reply.from_user.full_name
        amount_raw = args[1]
    elif len(args) == 3 and args[1].startswith("@"):
        async with SessionLocal() as session:
            res = await session.execute(select(User).where(User.username == args[1][1:]))
            target_user = res.scalar_one_or_none()
        if not target_user:
            await message.answer("Игрок не найден")
            return
        target_tg_id = target_user.tg_id
        target_name = f"@{target_user.username}"
        amount_raw = args[2]
    else:
        await message.answer("Использование: /gift @user 100 (или ответом: /gift 100)")
        return

    try:
        amount = int(amount_raw)
    except ValueError:
        await message.answer("Сумма должна быть числом")
        return
    if amount <= 0:
        await message.answer("Сумма должна быть > 0")
        return
    if target_tg_id == message.from_user.id:
        await message.answer("Себе нельзя 😏")
        return

    async with SessionLocal() as session:
        await get_or_create_user(session, tg_id=target_tg_id, username=None)
        try:
            sender = await adjust_balance(
                session, tg_id=message.from_user.id, delta=-amount, tx_type="gift_out"
            )
        except ValueError:
            await message.answer("Недостаточно Coins")
            return
        await adjust_balance(session, tg_id=target_tg_id, delta=amount, tx_type="gift_in")
    await message.answer(f"🎁 {money(amount)} → {target_name} | Твой баланс: {money(sender.coins)}")


@router.message(Command("help"))
async def help_cmd(message: Message) -> None:
    await message.answer(
        panel(
            [
                header("Команды"),
                "/start — меню",
                "/balance — баланс",
                "/daily — ежедневные +500",
                "/top — топ богатых",
                "/gift @user 100 — подарить",
                "",
                "PvP (в группе):",
                "/duel @user 500 — дуэль 🎲",
                "/bj @user 500 — блэкджек 🃏",
                "/poker @user 500 — покер 🂡",
                "(без @user — открытый вызов)",
            ]
        )
    )
