import { Bot, InlineKeyboard } from 'grammy';

const RULES_TEXT =
  '<b>📖 Правила «108»</b>\n\n' +
  'Колода 36 карт (6–туз), каждому по 5. Ходи картой <b>той же масти</b> или <b>того же достоинства</b>. ' +
  'Нечем — бери карту из колоды: подошла — клади, нет — «Пас».\n\n' +
  '<b>Особые карты</b>\n' +
  '6️⃣ — следующий берёт 1 карту и пропускает ход\n' +
  '7️⃣ — следующий берёт 2 карты и пропускает ход\n' +
  '8️⃣ — сразу покрой: восьмёркой или той же мастью. Нечем — тяни, пока не покроешь\n' +
  '🅰️ Туз — следующий пропускает ход (вдвоём — ходишь ещё раз)\n' +
  '👑 K♠ — следующий берёт <b>4 карты</b> и пропускает ход\n' +
  '👸 Дама — на любую карту, заказывает масть\n' +
  '9 и 10 — обычные карты\n\n' +
  '<b>Очки</b> (за карты на руке, когда кто-то вышел)\n' +
  '6–10 — номинал, валет 2, король 4, туз 11\n' +
  'Дама +20 · Q♠ +40 · K♠ +80\n' +
  'Вышел дамой — −20, Q♠ — −40, K♠ — −80\n\n' +
  '<b>Счёт</b> копится по раундам и может уйти в минус.\n' +
  'Больше 108 — вылет 💀 · ровно 107 — пополам ✂️ · ровно 108 — ноль 🎰\n' +
  'Побеждает последний оставшийся.';

export async function startBot(token, webAppUrl) {
  if (!webAppUrl) throw new Error('WEBAPP_URL не задан');
  const bot = new Bot(token);
  const url = (params = '') => `${webAppUrl}${params ? '?' + params : ''}`;

  const mainKb = () => new InlineKeyboard()
    .webApp('🃏 Играть в 108', url()).row()
    .webApp('👥 С друзьями', url('go=friends'))
    .webApp('🤖 С ботами', url('go=practice')).row()
    .text('📖 Правила', 'rules');

  bot.command('start', async ctx => {
    const payload = (ctx.match || '').trim();
    const code = /^[A-Z0-9]{5}$/i.test(payload) ? payload.toUpperCase() : null;
    if (code) {
      return ctx.reply(`🃏 Тебя позвали за стол <b>${code}</b>!\nЖми кнопку и садись играть.`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp('🪑 Сесть за стол', url(`room=${code}`)),
      });
    }
    const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : '';
    await ctx.reply(
      `Привет${name}! 👋\n\n<b>108</b> — карточная игра на 36 карт для 2–6 игроков.\n\n` +
      '⚔️ Матчмейкинг: дуэль, трое или компания 4–6\n' +
      '👥 Свой стол с друзьями по коду\n' +
      '🤖 Тренировка с ботами\n' +
      '🏅 Достижения и новые рубашки карт\n' +
      '😀 Эмодзи-чат за столом\n\n' +
      'Набрал больше 108 — вылетел. Последний оставшийся забирает победу 🏆',
      { parse_mode: 'HTML', reply_markup: mainKb() },
    );
  });

  const sendRules = ctx => ctx.reply(RULES_TEXT, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('🃏 Играть', url()) });
  bot.command('rules', sendRules);
  bot.callbackQuery('rules', async ctx => { await ctx.answerCallbackQuery(); await sendRules(ctx); });

  bot.command('play', ctx => ctx.reply('Поехали! 🃏', { reply_markup: new InlineKeyboard().webApp('🃏 Играть в 108', url()) }));
  bot.command('friends', ctx => ctx.reply(
    'Создай стол и отправь код друзьям — до 6 человек за одним столом 👥',
    { reply_markup: new InlineKeyboard().webApp('👥 Создать стол', url('go=friends')) },
  ));

  bot.on('message', ctx => ctx.reply('Жми кнопку, чтобы играть 👇', { reply_markup: mainKb() }));
  bot.catch(err => console.error('bot error', err.error));

  // Профиль бота: команды, описание, кнопка меню (ошибки тут не критичны)
  const safe = p => p.catch(e => console.error('setup:', e.description || e.message));
  await Promise.all([
    safe(bot.api.setMyCommands([
      { command: 'play', description: '🃏 Играть' },
      { command: 'friends', description: '👥 Игра с друзьями' },
      { command: 'rules', description: '📖 Правила' },
      { command: 'start', description: '🏠 Главное меню' },
    ])),
    safe(bot.api.setMyShortDescription('🃏 Карточная игра 108 — играй с друзьями и соперниками прямо в Telegram')),
    safe(bot.api.setMyDescription(
      '🃏 108 — карточная игра на 36 карт для 2–6 игроков.\n\n' +
      '⚔️ Матчмейкинг: дуэль, трое, компания\n👥 Столы с друзьями\n🤖 Боты для тренировки\n🏅 Достижения и рубашки\n\n' +
      'Больше 108 очков — вылет. Жми «Старт»!',
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
