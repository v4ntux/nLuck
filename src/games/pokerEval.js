// Оценка покерной руки: лучшие 5 из 7. Возвращает массив для сравнения (больше — сильнее)
const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
export const HAND_NAMES = ['Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш'];

function straightHigh(vals) {
  const u = [...new Set(vals)].sort((a, b) => b - a);
  if (u.includes(14)) u.push(1);
  for (let i = 0; i + 4 < u.length; i++) if (u[i] - u[i + 4] === 4) return u[i];
  return 0;
}

export function evaluate(cards) {
  const vals = cards.map(c => RV[c.rank]);
  const bySuit = {};
  for (const c of cards) (bySuit[c.suit] ||= []).push(RV[c.rank]);
  const flushVals = Object.values(bySuit).find(v => v.length >= 5);
  if (flushVals) { const sf = straightHigh(flushVals); if (sf) return [8, sf]; }
  const cnt = {};
  for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;
  const groups = Object.entries(cnt).map(([v, n]) => [n, +v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = (ex, n) => vals.filter(v => !ex.includes(v)).sort((a, b) => b - a).filter((v, i, a) => a.indexOf(v) === i).slice(0, n);
  if (groups[0][0] === 4) return [7, groups[0][1], ...kick([groups[0][1]], 1)];
  if (groups[0][0] === 3 && groups[1] && groups[1][0] >= 2) return [6, groups[0][1], groups[1][1]];
  if (flushVals) return [5, ...flushVals.sort((a, b) => b - a).slice(0, 5)];
  const st = straightHigh(vals);
  if (st) return [4, st];
  if (groups[0][0] === 3) return [3, groups[0][1], ...kick([groups[0][1]], 2)];
  if (groups[0][0] === 2 && groups[1] && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], ...kick([groups[0][1], groups[1][1]], 1)];
  if (groups[0][0] === 2) return [1, groups[0][1], ...kick([groups[0][1]], 3)];
  return [0, ...kick([], 5)];
}

export function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
export const rankValue = r => RV[r];
