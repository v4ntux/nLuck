import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { verifyInitData } from './auth.js';
import { startBot } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ALLOW_GUESTS = process.env.ALLOW_GUESTS === '1' || !BOT_TOKEN;

const app = express();
// Без долгого кэша: Telegram иначе показывает старую версию игры после обновлений
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/config', (_req, res) => res.json({
  botUsername: botInfo?.username || null,
  appShortName: process.env.APP_SHORT_NAME || null,
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const lobby = new Lobby();
setInterval(() => lobby.sweep(), 60_000).unref();

wss.on('connection', ws => {
  let user = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!user) {
      if (msg.type !== 'hello') return;
      const profile = resolveProfile(msg);
      if (!profile) { ws.send(JSON.stringify({ type: 'error', fatal: true, message: 'Откройте игру через Telegram-бота' })); return ws.close(); }
      user = lobby.connect(ws, profile);
      const startParam = profile.startParam || msg.startParam;
      if (startParam && /^[A-Z0-9]{5}$/i.test(startParam) && !user.roomCode) lobby.handle(user, { type: 'room_join', code: startParam });
      return;
    }
    lobby.handle(user, msg);
  });

  ws.on('close', () => user && lobby.disconnect(user, ws));
});

// keep-alive, чтобы отваливались мёртвые соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

function resolveProfile(msg) {
  const tg = verifyInitData(msg.initData, BOT_TOKEN);
  if (tg) return tg;
  if (!ALLOW_GUESTS) return null;
  const g = msg.guest || {};
  const id = String(g.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  if (!id) return null;
  const name = String(g.name || 'Гость').replace(/[<>]/g, '').trim().slice(0, 24) || 'Гость';
  return { id: 'guest' + id, name, photo: null, startParam: null };
}

let botInfo = null;
server.listen(PORT, async () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  if (BOT_TOKEN) {
    const url = process.env.WEBAPP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    try { botInfo = await startBot(BOT_TOKEN, url); }
    catch (e) { console.error('Не удалось запустить бота:', e.message); }
  } else {
    console.log('BOT_TOKEN не задан — бот не запущен, вход только как гость');
  }
});
