import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
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
// Версия сборки в адресах файлов: каждая выкладка — новые URL, Telegram не покажет старьё из кэша
const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 10);
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replaceAll('__V__', VERSION);
app.get(['/', '/index.html'], (_req, res) => res.set('Cache-Control', 'no-store').type('html')
  .send(indexHtml.replace('__CLUB__', JSON.stringify({ bot: botInfo?.username || null, app: process.env.APP_SHORT_NAME || null }))));
app.use('/v/:ver', express.static(PUBLIC, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(PUBLIC, { index: false, setHeaders: r => r.setHeader('Cache-Control', 'no-cache') }));
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
      // приглашение: ?room=CODE, startapp=CODE, r_CODE, room_CODE
      const m = /^(?:r_?|room_?)?([A-Z0-9]{5})$/i.exec(String(profile.startParam || msg.startParam || ''));
      if (m) lobby.handle(user, { type: 'room_join', code: m[1].toUpperCase() });
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
