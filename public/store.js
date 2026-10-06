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

export const ACHIEVEMENTS = [
  { id: 'first_game', icon: '🃏', name: 'Первая партия', desc: 'Сыграть партию до конца' },
  { id: 'first_win', icon: '🏆', name: 'Первая победа', desc: 'Выиграть партию', reward: 'Синяя рубашка' },
  { id: 'wins_10', icon: '👑', name: 'Король стола', desc: 'Выиграть 10 партий', reward: 'Зелёная рубашка', goal: s => [s.wins, 10] },
  { id: 'wins_50', icon: '💎', name: 'Легенда', desc: 'Выиграть 50 партий', goal: s => [s.wins, 50] },
  { id: 'round_closer', icon: '🚪', name: 'Ушёл красиво', desc: 'Первым сбросить все карты' },
  { id: 'rounds_25', icon: '🎯', name: 'Снайпер', desc: 'Закрыть 25 раундов', goal: s => [s.roundsWon, 25] },
  { id: 'king_finish', icon: '♠️', name: 'Королевский выход', desc: 'Закончить раунд королём♠ (−80)', reward: 'Чёрная рубашка' },
  { id: 'queen_finish', icon: '👸', name: 'Дамский угодник', desc: 'Закончить раунд дамой' },
  { id: 'reset_108', icon: '🎰', name: 'Ровно 108', desc: 'Набрать ровно 108 и обнулиться', reward: 'Золотая рубашка' },
  { id: 'half_107', icon: '✂️', name: 'Пополам', desc: 'Набрать ровно 107' },
  { id: 'negative', icon: '🧊', name: 'В минус', desc: 'Уйти со счётом ниже нуля' },
  { id: 'eight_chain', icon: '🎱', name: 'Восьмёрка на восьмёрку', desc: 'Покрыть 8 другой восьмёркой' },
  { id: 'king_penalty', icon: '😈', name: 'Получи четыре', desc: 'Заставить соперника взять 4 за K♠' },
  { id: 'party_win', icon: '🎉', name: 'Душа компании', desc: 'Победить в игре на 4–6 человек' },
  { id: 'comeback', icon: '🔥', name: 'Камбэк', desc: 'Победить, имея больше 90 очков' },
  { id: 'streak_3', icon: '⚡', name: 'Серия', desc: 'Выиграть 3 партии подряд' },
  { id: 'friends', icon: '🤝', name: 'С друзьями веселее', desc: 'Сыграть с другом за одним столом' },
  { id: 'chatty', icon: '💬', name: 'Болтун', desc: 'Отправить 20 эмодзи', goal: s => [s.chats, 20] },
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
