# nLucky — TODO

## ✅ Готово (rework)

- Структура с нуля: только Игры (PvP + Gamble) и Профиль
- PvP с matchmaking: Дуэль, Blackjack, Poker (открытые/адресные вызовы, эскроу ставок)
- Карты: кнопка «Мои карты» (alert только тебе) + дубль в личку
- Авторегистрация любого игрока по кнопке (без /start)
- Gamble: Dice, Slots, Coin, Mines, Crash, Wheel, HiLo
- Профиль с 9 достижениями
- Ownership-guard в группах, антиспам, бан
- Команды: /balance /daily /top /gift /help | админ: /give /take /ban /unban
- Без Redis — всё in-memory + SQLite/Postgres

## 🔜 Идеи

- [ ] Выбор ставки кнопками (50/100/500) в Gamble
- [ ] Покер с обменом карт (draw) / общими картами
- [ ] Blackjack: Double, Split
- [ ] Мультиплеер >2 игроков (Jackpot, Race)
- [ ] Alembic-миграции
- [ ] Юнит-тесты payout'ов

## Запуск

```bash
python -m nbet.bot
```
