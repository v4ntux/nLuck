// Настройки (на устройстве) и достижения (в облаке Telegram, если доступно)
const tg = window.Telegram?.WebApp;
const cloud = tg?.initData && tg.CloudStorage && tg.isVersionAtLeast?.('6.9') ? tg.CloudStorage : null;

const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const DEFAULT_SETTINGS = { sound: true, vibro: true, hints: false, lite: false, back: 'red', big: false };
export const settings = { ...DEFAULT_SETTINGS, ...(lsGet('settings') || {}) };
export function saveSettings() { lsSet('settings', settings); }

export const BACKS = {
  red: { name: 'Красная', color: '#9a2a20', line: '#b8473a', need: null },
  blue: { name: 'Синяя', color: '#24427a', line: '#3e5f9a', need: 'first_win' },
  green: { name: 'Зелёная', color: '#2c5e34', line: '#477a4c', need: 'wins_10' },
  black: { name: 'Чёрная', color: '#26221d', line: '#4a4238', need: 'king_finish' },
  gold: { name: 'Золотая', color: '#a2771f', line: '#c79a3a', need: 'reset_108' },
};

export const ACH_GROUPS = [['club', '🎲 Клуб'], ['108', '🃏 108'], ['durak', '🤡 Дурак'], ['bura', '🌀 Бура'], ['poker', '♠️ Покер'], ['blackjack', '🂡 Блэкджек']];

export const ACHIEVEMENTS = [
  { id: 'first_game', game: 'club', icon: '🃏', name: 'Первая партия', desc: 'Сыграть партию до конца' },
  { id: 'first_win', game: 'club', icon: '🏆', name: 'Первая победа', desc: 'Выиграть партию', reward: 'Синяя рубашка' },
  { id: 'wins_10', game: 'club', icon: '👑', name: 'Король стола', desc: 'Выиграть 10 партий', reward: 'Зелёная рубашка', goal: s => [s.wins, 10] },
  { id: 'wins_50', game: 'club', icon: '💎', name: 'Легенда', desc: 'Выиграть 50 партий', goal: s => [s.wins, 50] },
  { id: 'streak_3', game: 'club', icon: '⚡', name: 'Серия', desc: 'Выиграть 3 партии подряд' },
  { id: 'all_games', game: 'club', icon: '🧭', name: 'Завсегдатай', desc: 'Сыграть во все игры клуба', goal: s => [['p_108', 'p_durak', 'p_bura', 'p_poker', 'p_blackjack'].filter(k => s[k]).length, 5] },
  { id: 'friends', game: 'club', icon: '🤝', name: 'С друзьями веселее', desc: 'Сыграть с другом за одним столом' },
  { id: 'chatty', game: 'club', icon: '💬', name: 'Болтун', desc: 'Отправить 20 сообщений в чат', goal: s => [s.chats, 20] },

  { id: 'round_closer', game: '108', icon: '🚪', name: 'Ушёл красиво', desc: 'Первым сбросить все карты' },
  { id: 'rounds_25', game: '108', icon: '🎯', name: 'Снайпер', desc: 'Закрыть 25 раундов', goal: s => [s.roundsWon, 25] },
  { id: 'king_finish', game: '108', icon: '♠️', name: 'Королевский выход', desc: 'Закончить раунд королём♠ (−80)', reward: 'Чёрная рубашка' },
  { id: 'queen_finish', game: '108', icon: '👸', name: 'Дамский угодник', desc: 'Закончить раунд дамой' },
  { id: 'reset_108', game: '108', icon: '🎰', name: 'Ровно 108', desc: 'Набрать ровно 108 и обнулиться', reward: 'Золотая рубашка' },
  { id: 'half_107', game: '108', icon: '✂️', name: 'Пополам', desc: 'Набрать ровно 107' },
  { id: 'negative', game: '108', icon: '🧊', name: 'В минус', desc: 'Уйти со счётом ниже нуля' },
  { id: 'eight_chain', game: '108', icon: '🎱', name: 'Восьмёрка на восьмёрку', desc: 'Покрыть 8 другой восьмёркой' },
  { id: 'king_penalty', game: '108', icon: '😈', name: 'Получи четыре', desc: 'Заставить соперника взять 4 за K♠' },
  { id: 'party_win', game: '108', icon: '🎉', name: 'Душа компании', desc: 'Победить в игре на 4–6 человек' },
  { id: 'comeback', game: '108', icon: '🔥', name: 'Камбэк', desc: 'Победить, имея больше 90 очков' },

  { id: 'durak_safe', game: 'durak', icon: '😌', name: 'Не дурак', desc: 'Не остаться дураком' },
  { id: 'durak_first', game: 'durak', icon: '🥇', name: 'Первым вышел', desc: 'Выйти из игры первым' },
  { id: 'durak_party', game: 'durak', icon: '🎪', name: 'Пронесло', desc: 'Не остаться дураком за столом на 4–6' },
  { id: 'durak_wins_10', game: 'durak', icon: '🧠', name: 'Профессор', desc: '10 раз не остаться дураком', goal: s => [s.durakWins || 0, 10] },
  { id: 'durak_fool', game: 'durak', icon: '🤡', name: 'Бывает', desc: 'Остаться дураком' },

  { id: 'bura_win', game: 'bura', icon: '🌀', name: 'Первая бура', desc: 'Выиграть партию в Буру' },
  { id: 'bura_dry', game: 'bura', icon: '🏜️', name: 'Всухую', desc: 'Победить, когда у соперника меньше 10 очков' },
  { id: 'bura_wins_10', game: 'bura', icon: '🌪️', name: 'Буревестник', desc: 'Выиграть 10 партий в Буру', goal: s => [s.buraWins || 0, 10] },

  { id: 'poker_win', game: 'poker', icon: '🦈', name: 'Последний за столом', desc: 'Забрать все фишки' },
  { id: 'poker_party', game: 'poker', icon: '🎩', name: 'Акула', desc: 'Победить за столом на 4–6' },
  { id: 'poker_wins_5', game: 'poker', icon: '💰', name: 'Хайроллер', desc: 'Выиграть 5 турниров', goal: s => [s.pokerWins || 0, 5] },

  { id: 'bj_win', game: 'blackjack', icon: '🪙', name: 'Обыграл дилера', desc: 'Выиграть раздачу' },
  { id: 'bj_natural', game: 'blackjack', icon: '🂡', name: 'Блэкджек!', desc: 'Собрать 21 двумя картами' },
  { id: 'bj_bust', game: 'blackjack', icon: '💥', name: 'Перебор', desc: 'Набрать больше 21' },
  { id: 'bj_wins_25', game: 'blackjack', icon: '🎲', name: 'Счётчик карт', desc: 'Выиграть 25 раздач', goal: s => [s.bjWins || 0, 25] },
];

export const progress = { unlocked: {}, stats: { games: 0, wins: 0, roundsWon: 0, streak: 0, bestStreak: 0, chats: 0 } };

export async function loadProgress() {
  const local = lsGet('progress');
  if (local) merge(local);
  if (cloud) {
    await new Promise(res => cloud.getItem('progress', (err, v) => {
      try { if (!err && v) merge(JSON.parse(v)); } catch {}
      res();
    }));
  }
  return progress;
}
function merge(p) {
  Object.assign(progress.unlocked, p.unlocked || {});
  for (const [k, v] of Object.entries(p.stats || {})) progress.stats[k] = Math.max(progress.stats[k] || 0, v);
  if (p.stats && 'streak' in p.stats) progress.stats.streak = p.stats.streak;
}
let saveTimer;
export function saveProgress() {
  lsSet('progress', progress);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { cloud?.setItem('progress', JSON.stringify(progress)); } catch {} }, 800);
}
