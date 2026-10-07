// Профили и баланс монет — SQLite (встроенный в Node). На Railway файл лежит на диске-томе /data
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(path.join(DIR, 'club.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, photo TEXT,
  coins INTEGER NOT NULL DEFAULT 1000, xp INTEGER NOT NULL DEFAULT 0,
  stats TEXT NOT NULL DEFAULT '{}', last_bonus INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
)`);

export const START_COINS = 1000;
export const DAILY_BONUS = 300;
export const BONUS_EVERY = 20 * 3600 * 1000;

const q = {
  get: db.prepare('SELECT * FROM users WHERE id = ?'),
  ins: db.prepare('INSERT INTO users (id, name, photo, coins, created) VALUES (?, ?, ?, ?, ?)'),
  upd: db.prepare('UPDATE users SET name = ?, photo = ? WHERE id = ?'),
  coins: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
  xp: db.prepare('UPDATE users SET xp = xp + ?, stats = ? WHERE id = ?'),
  bonus: db.prepare('UPDATE users SET coins = coins + ?, last_bonus = ? WHERE id = ?'),
};

const isBot = id => String(id).startsWith('bot-');

export function ensureUser({ id, name, photo }) {
  if (isBot(id)) return null;
  const u = q.get.get(id);
  if (!u) q.ins.run(id, name, photo || null, START_COINS, Date.now());
  else if (u.name !== name || u.photo !== (photo || null)) q.upd.run(name, photo || null, id);
  return profile(id);
}

export function balance(id) { return isBot(id) ? 0 : q.get.get(id)?.coins ?? 0; }
export function addCoins(id, delta) { if (!isBot(id) && delta) q.coins.run(Math.round(delta), id); }

export const levelOf = xp => Math.floor(Math.sqrt(xp / 40)) + 1;
export const xpFor = lvl => (lvl - 1) ** 2 * 40;

/** Итог партии для статистики: played/won по игре + опыт */
export function recordGame(id, gameId, won) {
  if (isBot(id)) return;
  const u = q.get.get(id);
  if (!u) return;
  const stats = JSON.parse(u.stats || '{}');
  const s = (stats[gameId] ||= { played: 0, won: 0 });
  s.played++; if (won) s.won++;
  q.xp.run(won ? 30 : 10, JSON.stringify(stats), id);
}

export function claimBonus(id) {
  const u = q.get.get(id);
  if (!u) return { ok: false };
  const now = Date.now();
  if (now - u.last_bonus < BONUS_EVERY) return { ok: false, next: u.last_bonus + BONUS_EVERY };
  q.bonus.run(DAILY_BONUS, now, id);
  return { ok: true, amount: DAILY_BONUS };
}

export function profile(id) {
  const u = q.get.get(id);
  if (!u) return null;
  const level = levelOf(u.xp);
  return {
    id: u.id, name: u.name, photo: u.photo, coins: u.coins, xp: u.xp, level,
    levelFrom: xpFor(level), levelTo: xpFor(level + 1),
    stats: JSON.parse(u.stats || '{}'), bonusAt: u.last_bonus + BONUS_EVERY, created: u.created,
  };
}
