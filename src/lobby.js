import { GameError } from './game/engine.js';
import { GAMES } from './games/index.js';
import * as db from './db.js';

const BOT_NAMES = ['Бот Вася', 'Бот Маша', 'Бот Петя', 'Бот Оля', 'Бот Гоша', 'Бот Катя'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const AFK_MS = 60_000;
// Чат только из готовых эмодзи и фраз — без модерации и спама
export const CHAT = ['😂', '😎', '😡', '😭', '🤔', '😈', '👍', '👏', '🔥', '💩', '🙏', '🤝',
  'Удачи!', 'Ну ты даёшь!', 'Быстрее!', 'Ха-ха', 'Не повезло', 'Хорош!', 'Ещё партию?', 'GG'];

const gameDef = id => { const g = GAMES[id]; if (!g) throw new LobbyError('Нет такой игры'); return g; };

export class Lobby {
  constructor() {
    this.users = new Map();  // userId -> { id, name, photo, ws, roomCode }
    this.rooms = new Map();  // code -> room
    this.queues = {};        // `${game}:${mode}` -> [{ id, since }]
    this.modeTimers = {};
    // банк монет для игр, где ставки внутри (блэкджек)
    this.bank = {
      balance: id => db.balance(id),
      add: (id, delta) => { db.addCoins(id, delta); this.sendProfile(id); },
    };
  }

  // ---------- соединения ----------

  connect(ws, profile) {
    let u = this.users.get(profile.id);
    if (u?.ws && u.ws !== ws) { try { u.ws.close(4000, 'replaced'); } catch {} }
    u = { ...(u || {}), ...profile, ws };
    this.users.set(u.id, u);
    db.ensureUser(u);
    this.send(u, { type: 'welcome', me: { id: u.id, name: u.name, photo: u.photo } });
    this.sendProfile(u.id);
    this.send(u, this.stats());
    this.statsChanged();
    const room = u.roomCode && this.rooms.get(u.roomCode);
    if (room) { this.sendRoom(room); if (room.game) { this.sendGame(room, u.id); this.schedule(room); } }
    else u.roomCode = null;
    return u;
  }

  disconnect(user, ws) {
    if (user.ws !== ws) return;
    user.ws = null;
    this.leaveQueue(user);
    this.statsChanged();
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (room) {
      if (!room.game || room.game.phase === 'gameOver') this.leaveRoom(user);
      else { this.sendRoom(room); this.schedule(room); }
    }
  }

  send(u, msg) {
    if (u?.ws && u.ws.readyState === 1) u.ws.send(JSON.stringify(msg));
  }
  sendProfile(id) { const u = this.users.get(id); if (u) this.send(u, { type: 'profile', profile: db.profile(id) }); }

  handle(user, msg) {
    try {
      switch (msg.type) {
        case 'queue': return this.joinQueue(user, String(msg.game || '108'), String(msg.mode));
        case 'queue_cancel': return this.leaveQueue(user, true);
        case 'queue_bots': return this.queueWithBots(user);
        case 'practice': return this.practice(user, String(msg.game || '108'), Number(msg.bots));
        case 'room_create': return this.createRoom(user, String(msg.game || '108'));
        case 'room_join': return this.joinRoom(user, String(msg.code || '').toUpperCase().trim());
        case 'room_leave': return this.leaveRoom(user);
        case 'room_add_bot': return this.addBot(user);
        case 'room_remove_bot': return this.removeBot(user, msg.id);
        case 'room_start': return this.startRoom(user);
        case 'rematch': return this.rematch(user);
        case 'act': return this.gameAction(user, msg.a || {});
        case 'play': case 'draw': case 'pass': return this.gameAction(user, msg); // «108»
        case 'chat': return this.chat(user, Number(msg.e));
        case 'bonus': {
          const r = db.claimBonus(user.id);
          this.send(user, { type: 'bonus', ...r });
          return this.sendProfile(user.id);
        }
        case 'ping': return this.send(user, { type: 'pong' });
      }
    } catch (e) {
      if (e instanceof GameError || e instanceof LobbyError) this.send(user, { type: 'error', message: e.message });
      else { console.error(e); this.send(user, { type: 'error', message: 'Ошибка сервера' }); }
    }
  }

  // ---------- матчмейкинг ----------

  joinQueue(user, gameId, mode) {
    const def = gameDef(gameId);
    if (!def.modes[mode]) throw new LobbyError('Неверный режим');
    if (db.balance(user.id) < def.stake) throw new LobbyError(`Нужно ${def.stake} монет для ставки — заберите бонус в профиле`);
    if (user.roomCode) this.leaveRoom(user);
    this.leaveQueue(user);
    const key = `${gameId}:${mode}`;
    (this.queues[key] ||= []).push({ id: user.id, since: Date.now() });
    user.queueKey = key;
    this.flushQueue(key);
  }

  leaveQueue(user, notify = false) {
    for (const key of Object.keys(this.queues)) {
      const q = this.queues[key];
      const i = q.findIndex(e => e.id === user.id);
      if (i >= 0) { q.splice(i, 1); this.flushQueue(key); }
    }
    user.queueKey = null;
    if (notify) this.send(user, { type: 'queue', mode: null });
  }

  flushQueue(key) {
    const [gameId, mode] = key.split(':');
    const m = GAMES[gameId].modes[mode], q = (this.queues[key] ||= []);
    while (q.length >= m.max) this.startGroup(gameId, mode, q.splice(0, m.max));
    if (m.waitMs) {
      // «компания»: набралось минимум — ждём ещё немного, вдруг подойдут остальные
      if (q.length >= m.min && !this.modeTimers[key]) {
        const startsAt = Date.now() + m.waitMs;
        this.modeTimers[key] = { startsAt, timer: setTimeout(() => {
          this.modeTimers[key] = null;
          if (q.length >= m.min) this.startGroup(gameId, mode, q.splice(0, m.max));
          this.flushQueue(key);
        }, m.waitMs) };
      } else if (q.length < m.min && this.modeTimers[key]) {
        clearTimeout(this.modeTimers[key].timer);
        this.modeTimers[key] = null;
      }
    }
    this.broadcastQueue(key);
    this.statsChanged();
  }

  startGroup(gameId, mode, entries, { bots = 0 } = {}) {
    const group = entries.map(e => this.users.get(e.id)).filter(Boolean);
    if (!group.length) return;
    group.forEach(u => (u.queueKey = null));
    const room = this.newRoom(group[0].id, false, gameId);
    room.mode = mode;
    for (const u of group) this.seat(room, u);
    for (let i = 0; i < bots; i++) this.seatBot(room);
    while (room.seats.length < 2) this.seatBot(room);
    this.start(room);
  }

  broadcastQueue(key) {
    const [gameId, mode] = key.split(':');
    const m = GAMES[gameId].modes[mode], q = this.queues[key] || [];
    const startsAt = this.modeTimers[key]?.startsAt ?? null;
    for (const e of q) this.send(this.users.get(e.id), { type: 'queue', game: gameId, mode, count: q.length, min: m.min, max: m.max, startsAt, now: Date.now() });
  }

  queueWithBots(user) {
    const key = user.queueKey;
    if (!key) throw new LobbyError('Вы не в поиске');
    const [gameId, mode] = key.split(':');
    const m = GAMES[gameId].modes[mode], q = this.queues[key];
    const entries = q.splice(0, m.max);
    if (this.modeTimers[key]) { clearTimeout(this.modeTimers[key].timer); this.modeTimers[key] = null; }
    this.startGroup(gameId, mode, entries, { bots: Math.max(0, m.min - entries.length) });
    this.flushQueue(key);
  }

  practice(user, gameId, bots) {
    const def = gameDef(gameId);
    bots = def.solo ? 0 : Math.min(Math.max(bots || 1, 1), def.max - 1);
    this.leaveQueue(user);
    if (user.roomCode) this.leaveRoom(user);
    const room = this.newRoom(user.id, true, gameId);
    room.practice = true;
    this.seat(room, user);
    for (let i = 0; i < bots; i++) this.seatBot(room);
    this.start(room);
  }

  stats() {
    const games = {};
    for (const [gid, def] of Object.entries(GAMES)) {
      games[gid] = { playing: 0, modes: {} };
      for (const mode of Object.keys(def.modes)) games[gid].modes[mode] = { searching: (this.queues[`${gid}:${mode}`] || []).length, playing: 0 };
    }
    for (const room of this.rooms.values()) {
      if (!room.game || room.game.phase === 'gameOver') continue;
      const humans = room.seats.filter(s => !s.bot).length;
      games[room.gameId].playing += humans;
      if (room.mode) games[room.gameId].modes[room.mode].playing += humans;
    }
    let online = 0;
    for (const u of this.users.values()) if (u.ws) online++;
    return { type: 'stats', games, online };
  }

  /** Счётчики «играют / ищут» — всем, не чаще раза в 0.5 с */
  statsChanged() {
    if (this.statsTimer) return;
    this.statsTimer = setTimeout(() => {
      this.statsTimer = null;
      const msg = this.stats();
      for (const u of this.users.values()) this.send(u, msg);
    }, 500);
  }

  // ---------- комнаты ----------

  newRoom(hostId, isPrivate, gameId) {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = { code, hostId, private: isPrivate, gameId, seats: [], game: null, timer: null };
    this.rooms.set(code, room);
    return room;
  }

  seat(room, user) {
    if (user.roomCode && user.roomCode !== room.code) this.leaveRoom(user);
    if (!room.seats.find(s => s.id === user.id)) room.seats.push({ id: user.id, name: user.name, photo: user.photo, bot: false });
    user.roomCode = room.code;
  }

  seatBot(room) {
    const used = new Set(room.seats.map(s => s.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Бот';
    room.seats.push({ id: 'bot-' + Math.random().toString(36).slice(2, 8), name, photo: null, bot: true });
  }

  createRoom(user, gameId) {
    gameDef(gameId);
    this.leaveQueue(user);
    const room = this.newRoom(user.id, true, gameId);
    this.seat(room, user);
    this.sendRoom(room);
  }

  joinRoom(user, code) {
    const room = this.rooms.get(code);
    if (!room) throw new LobbyError('Комната не найдена');
    const def = GAMES[room.gameId];
    if (room.seats.find(s => s.id === user.id)) { user.roomCode = code; this.sendRoom(room); if (room.game) this.sendGame(room, user.id); return; }
    if (room.seats.length >= def.max) throw new LobbyError('Стол заполнен');
    const live = room.game && room.game.phase !== 'gameOver';
    if (live && !def.joinAnytime) throw new LobbyError('Игра уже идёт');
    this.leaveQueue(user);
    this.seat(room, user);
    if (live) { room.game.addPlayer({ id: user.id, name: user.name }); this.broadcastGame(room); }
    this.sendRoom(room);
  }

  leaveRoom(user) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    this.statsChanged();
    user.roomCode = null;
    this.send(user, { type: 'room', room: null });
    if (!room) return;
    room.seats = room.seats.filter(s => s.id !== user.id);
    if (room.game && room.game.phase !== 'gameOver') {
      room.game.removePlayer(user.id);
      if (room.game.phase === 'gameOver') this.settle(room);
      this.broadcastGame(room);
      this.schedule(room);
    }
    const humans = room.seats.filter(s => !s.bot);
    if (humans.length === 0) return this.closeRoom(room);
    if (room.hostId === user.id) room.hostId = humans[0].id;
    this.sendRoom(room);
  }

  closeRoom(room) {
    clearTimeout(room.timer);
    this.rooms.delete(room.code);
  }

  addBot(user) {
    const room = this.ownRoom(user);
    const def = GAMES[room.gameId];
    if (def.solo) throw new LobbyError('В этой игре ботов нет — играете против дилера');
    if (room.game && room.game.phase !== 'gameOver') throw new LobbyError('Игра уже идёт');
    if (room.seats.length >= def.max) throw new LobbyError('Стол заполнен');
    this.seatBot(room);
    this.sendRoom(room);
  }

  removeBot(user, id) {
    const room = this.ownRoom(user);
    if (room.game && room.game.phase !== 'gameOver') throw new LobbyError('Игра уже идёт');
    room.seats = room.seats.filter(s => !(s.bot && s.id === id));
    this.sendRoom(room);
  }

  ownRoom(user) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (!room) throw new LobbyError('Вы не в комнате');
    if (room.hostId !== user.id) throw new LobbyError('Только создатель стола может это сделать');
    return room;
  }

  startRoom(user) {
    const room = this.ownRoom(user);
    const def = GAMES[room.gameId];
    if (room.seats.length < def.min) throw new LobbyError(`Нужно минимум ${def.min} игрока — позовите друга или добавьте бота`);
    this.start(room);
  }

  rematch(user) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (!room || room.game?.phase !== 'gameOver') return;
    if (!room.private) {
      const { gameId, mode } = room;
      this.leaveRoom(user);
      return this.joinQueue(user, gameId, mode || 'duel');
    }
    if (room.hostId !== user.id) throw new LobbyError('Новую партию запускает создатель стола');
    room.seats = room.seats.filter(s => s.bot || this.users.get(s.id)?.roomCode === room.code);
    if (room.seats.length < GAMES[room.gameId].min) throw new LobbyError('Не хватает игроков');
    this.start(room);
  }

  start(room) {
    const def = GAMES[room.gameId];
    const humans = room.seats.filter(s => !s.bot);
    // Ставка — только в матчмейкинге, где все живые. С ботами и с друзьями — на интерес
    room.stake = !room.private && !room.practice && humans.length === room.seats.length ? def.stake : 0;
    if (room.stake) for (const s of humans) { db.addCoins(s.id, -room.stake); this.sendProfile(s.id); }
    room.settled = false;
    room.payouts = null;
    room.game = def.create(room.seats.map(s => ({ id: s.id, name: s.name })), { bank: this.bank });
    this.sendRoom(room);
    this.broadcastGame(room);
    this.schedule(room);
  }

  /** Итог партии: выплаты из банка стола и статистика */
  settle(room) {
    if (room.settled || !room.game) return;
    room.settled = true;
    if (GAMES[room.gameId].solo) return;
    const { winners, losers } = room.game.result();
    const humans = room.seats.filter(s => !s.bot).map(s => s.id);
    const payouts = {};
    if (room.stake) {
      const pot = room.stake * room.game.players.filter(p => !String(p.id).startsWith('bot-')).length;
      const paid = winners.length ? winners : room.game.players.map(p => p.id); // ничья — возврат
      const share = Math.floor(pot / paid.length);
      for (const id of paid) { db.addCoins(id, share); payouts[id] = share - room.stake; }
      for (const id of losers) if (!(id in payouts)) payouts[id] = -room.stake;
    }
    for (const id of humans) { db.recordGame(id, room.gameId, winners.includes(id)); this.sendProfile(id); }
    room.payouts = payouts;
  }

  chat(user, e) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (!room || !(e >= 0 && e < CHAT.length)) return;
    const now = Date.now();
    if (now - (user.lastChat || 0) < 1200) return;
    user.lastChat = now;
    this.chatSend(room, user.id, e);
  }

  chatSend(room, from, e) {
    for (const s of room.seats) if (!s.bot) this.send(this.users.get(s.id), { type: 'chat', from, e });
  }

  /** Боты иногда реагируют эмодзи */
  botReact(room, botId, events) {
    if (Math.random() > 0.22) return;
    let pool = null;
    for (const ev of events) {
      if ((ev.type === 'penalty' || ev.type === 'took') && ev.playerId === botId) pool = [2, 3, 4]; // 😡 😭 🤔
      else if (ev.type === 'penalty') pool = [5, 1, 0];                                          // 😈 😎 😂
      else if ((ev.type === 'roundEnd' || ev.type === 'gameOver') && ev.winnerId === botId) pool = [1, 8, 0];
      else if (ev.type === 'lastCard' && ev.playerId === botId) pool = [5, 1];
    }
    if (pool) setTimeout(() => this.chatSend(room, botId, pool[Math.floor(Math.random() * pool.length)]), 600 + Math.random() * 900);
  }

  // ---------- ход игры ----------

  gameAction(user, msg) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (!room?.game) throw new LobbyError('Нет активной игры');
    room.game.act(user.id, msg);
    this.afterAction(room);
  }

  afterAction(room) {
    if (room.game.phase === 'gameOver') this.settle(room);
    this.broadcastGame(room);
    this.schedule(room);
  }

  /** Следующий автоматический шаг: ход бота, ход за отключившегося или следующий раунд */
  schedule(room) {
    clearTimeout(room.timer);
    const g = room.game;
    if (!g || g.phase === 'gameOver') return;
    const def = GAMES[room.gameId];
    if (g.phase === 'roundOver') {
      room.timer = setTimeout(() => { g.nextRound(); this.afterAction(room); }, def.roundPause);
      return;
    }
    const waiting = g.waiting();
    const isBot = id => room.seats.find(s => s.id === id)?.bot ?? true;
    const online = id => !!this.users.get(id)?.ws;
    let who = waiting.find(isBot), delay = 650 + Math.random() * 500;
    if (!who) { who = waiting.find(id => !online(id)); delay = AFK_MS; }
    if (!who) return; // живые игроки ходят сами — никаких авто-ходов
    const seq = g.eventSeq;
    room.timer = setTimeout(() => {
      if (room.game !== g || g.phase !== 'playing' || !g.waiting().includes(who)) return this.schedule(room);
      try { g.act(who, g.botMove(who)); } catch (e) { console.error('auto move', room.gameId, e.message); }
      for (const s of room.seats.filter(x => x.bot)) this.botReact(room, s.id, g.log.filter(e => e.seq > seq));
      this.afterAction(room);
    }, delay);
  }

  /** Закрывает столы, где давно нет ни одного живого игрока */
  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      const online = room.seats.some(s => !s.bot && this.users.get(s.id)?.ws);
      if (online) room.emptySince = null;
      else if (!room.emptySince) room.emptySince = now;
      else if (now - room.emptySince > 10 * 60 * 1000) {
        for (const s of room.seats) { const u = this.users.get(s.id); if (u?.roomCode === room.code) u.roomCode = null; }
        this.closeRoom(room);
      }
    }
    for (const [id, u] of this.users) if (!u.ws && !u.roomCode) this.users.delete(id);
  }

  // ---------- рассылка ----------

  roomInfo(room) {
    const def = GAMES[room.gameId];
    return {
      code: room.code, game: room.gameId, hostId: room.hostId, private: room.private, practice: !!room.practice,
      mode: room.mode || null, stake: room.stake || 0, min: def.min, max: def.max, solo: !!def.solo,
      inGame: !!room.game && room.game.phase !== 'gameOver',
      seats: room.seats.map(s => ({ ...s, online: s.bot || !!this.users.get(s.id)?.ws })),
    };
  }

  sendRoom(room) {
    const info = this.roomInfo(room);
    for (const s of room.seats) if (!s.bot) this.send(this.users.get(s.id), { type: 'room', room: info });
  }

  sendGame(room, userId, events = []) {
    const view = room.game.view(userId);
    view.game = room.gameId;
    view.events = events;
    view.seats = this.roomInfo(room).seats;
    view.stake = room.stake || 0;
    view.payouts = room.payouts;
    view.now = Date.now();
    this.send(this.users.get(userId), { type: 'game', game: view });
  }

  broadcastGame(room) {
    const g = room.game;
    if (room.mode) this.statsChanged();
    if (room.sentGame !== g) { room.sentGame = g; room.sentSeq = 0; }
    const events = g.log.filter(e => e.seq > room.sentSeq);
    room.sentSeq = g.eventSeq;
    for (const s of room.seats) if (!s.bot) this.sendGame(room, s.id, events);
  }
}

export class LobbyError extends Error {}
