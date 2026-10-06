import { Bot, InlineKeyboard } from 'grammy';

export async function startBot(token, webAppUrl) {
  if (!webAppUrl) throw new Error('WEBAPP_URL не задан');
  const bot = new Bot(token);
  const url = (params = '') => `${webAppUrl}${params ? '?' + params : ''}`;

  // Всё — внутри приложения. Бот только открывает игру (и стол по приглашению)
  const playKb = (code) => new InlineKeyboard().webApp(code ? '🪑 Сесть за стол' : '🃏 Играть в 108', url(code ? `room=${code}` : ''));

  bot.on('message', async ctx => {
    const m = /^\/start\s+([A-Z0-9]{5})$/i.exec(ctx.message.text || '');
    const code = m ? m[1].toUpperCase() : null;
    const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : '';
    await ctx.reply(code
      ? `🃏 Тебя позвали за стол <b>${code}</b>! Жми кнопку и садись.`
      : `Привет${name}! 👋 Жми кнопку — игра откроется прямо здесь.`,
      { parse_mode: 'HTML', reply_markup: playKb(code) });
  });
  bot.catch(err => console.error('bot error', err.error));

  // Профиль бота: команды, описание, кнопка меню (ошибки тут не критичны)
  const safe = p => p.catch(e => console.error('setup:', e.description || e.message));
  await Promise.all([
    safe(bot.api.deleteMyCommands()),
    safe(bot.api.setMyShortDescription('🃏 Карточная игра 108 — играй с друзьями и соперниками прямо в Telegram')),
    safe(bot.api.setMyDescription(
      '🃏 108 — карточная игра на 36 карт для 2–6 игроков. Матчмейкинг, столы с друзьями, боты и достижения — всё внутри игры. Жми «Старт»!',
    )),
    safe(bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: '🃏 Играть', web_app: { url: webAppUrl } } })),
  ]);

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
