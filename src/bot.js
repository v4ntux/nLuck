import { Bot, InlineKeyboard } from 'grammy';

export async function startBot(token, webAppUrl) {
  if (!webAppUrl) throw new Error('WEBAPP_URL не задан');
  const bot = new Bot(token);

  const keyboard = (code) => new InlineKeyboard().webApp(
    code ? '🃏 Войти за стол' : '🃏 Играть в 108',
    code ? `${webAppUrl}?room=${encodeURIComponent(code)}` : webAppUrl,
  );

  bot.command('start', async ctx => {
    const payload = (ctx.match || '').trim();
    const code = /^[A-Z0-9]{5}$/i.test(payload) ? payload.toUpperCase() : null;
    const text = code
      ? `Тебя позвали за стол <b>${code}</b>! Жми кнопку, чтобы сесть играть.`
      : '<b>108</b> — карточная игра на 36 карт.\n\n' +
        '• 6 — следующий берёт 1 карту\n' +
        '• 7 — следующий берёт 2 карты\n' +
        '• Дама — на любую карту, заказывает масть\n' +
        '• K♠ ±80, Q♠ ±40, остальные дамы ±20\n\n' +
        'Очки копятся по раундам. Больше 108 — вылет, ровно 107 — половина, ровно 108 — ноль. Жми кнопку!';
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard(code) });
  });

  bot.command('rules', ctx => ctx.reply(
    'Правила — внутри игры, кнопка «Правила» на главном экране.',
    { reply_markup: keyboard() },
  ));

  bot.catch(err => console.error('bot error', err.error));

  await bot.api.setMyCommands([
    { command: 'start', description: 'Играть в 108' },
    { command: 'rules', description: 'Правила' },
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Играть', web_app: { url: webAppUrl } } });

  const me = await bot.api.getMe();
  // При перезапуске старый и новый сервер на миг тянут обновления одновременно (409) — не падаем, а пробуем снова
  const run = () => bot.start({ drop_pending_updates: true }).catch(e => {
    console.error('Опрос Telegram прерван:', e.description || e.message, '— повтор через 5 с');
    setTimeout(run, 5000);
  });
  run();
  console.log(`Бот @${me.username} запущен`);
  return me;
}
