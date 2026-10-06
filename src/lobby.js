import { Game, GameError } from './game/engine.js';
import { chooseAction, applyAction } from './game/ai.js';

const BOT_NAMES = ['Бот Вася', 'Бот Маша', 'Бот Петя', 'Бот Оля', 'Бот Гоша', 'Бот Катя'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROUND_PAUSE_MS = 7000;
const MAX_PLAYERS = 6;
// Чат только из готовых эмодзи и фраз — без модерации и спама
export const CHAT = ['😂', '😎', '😡', '😭', '🤔', '😈', '👍', '👏', '🔥', '💩', '🙏', '🤝',
  'Удачи!', 'Ну ты даёшь!', 'Быстрее!', 'Ха-ха', 'Не повезло', 'Хорош!', 'Ещё партию?', 'GG'];
export const MODES = {
  duel: { min: 2, max: 2 },
  trio: { min: 3, max: 3 },
  party: { min: 4, max: 6, waitMs: 15000 },
};

export class Lobby {
  constructor() {
    this.users = new Map();  // userId -> { id, name, photo, ws, roomCode }
    this.rooms = new Map();  // code -> room
    this.queues = { duel: [], trio: [], party: [] };
    this.modeTimers = {};
  }

  // ---------- соединения ----------

  connect(ws, profile) {
    let u = this.users.get(profile.id);
    if (u?.ws && u.ws !== ws) { try { u.ws.close(4000, 'replaced'); } catch {} }
    u = { ...(u || {}), ...profile, ws };
    this.users.set(u.id, u);
    this.send(u, { type: 'welcome', me: { id: u.id, name: u.name, photo: u.photo } });
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

  handle(user, msg) {
    try {
      switch (msg.type) {
        case 'queue': return this.joinQueue(user, String(msg.mode));
        case 'queue_cancel': return this.leaveQueue(user, true);
        case 'queue_bots': return this.queueWithBots(user);
        case 'practice': return this.practice(user, Number(msg.bots));
        case 'room_create': return this.createRoom(user);
        case 'room_join': return this.joinRoom(user, String(msg.code || '').toUpperCase().trim());
        case 'room_leave': return this.leaveRoom(user);
        case 'room_add_bot': return this.addBot(user);
        case 'room_remove_bot': return this.removeBot(user, msg.id);
        case 'room_start': return this.startRoom(user);
        case 'rematch': return this.rematch(user);
        case 'play': case 'draw': case 'pass': return this.gameAction(user, msg);
        case 'chat': return this.chat(user, Number(msg.e));
        case 'ping': return this.send(user, { type: 'pong' });
      }
    } catch (e) {
      if (e instanceof GameError || e instanceof LobbyError) this.send(user, { type: 'error', message: e.message });
      else { console.error(e); this.send(user, { type: 'error', message: 'Ошибка сервера' }); }
    }
  }

  // ---------- матчмейкинг ----------

  joinQueue(user, mode) {
    if (!MODES[mode]) throw new LobbyError('Неверный режим');
    if (user.roomCode) this.leaveRoom(user);
    this.leaveQueue(user);
    this.queues[mode].push({ id: user.id, since: Date.now() });
    user.queueMode = mode;
    this.flushQueue(mode);
  }

  leaveQueue(user, notify = false) {
    for (const mode of Object.keys(this.queues)) {
      const q = this.queues[mode];
      const i = q.findIndex(e => e.id === user.id);
      if (i >= 0) { q.splice(i, 1); this.flushQueue(mode); }
    }
    user.queueMode = null;
    if (notify) this.send(user, { type: 'queue', mode: null });
  }

  flushQueue(mode) {
    const m = MODES[mode], q = this.queues[mode];
    while (q.length >= m.max) this.startGroup(mode, q.splice(0, m.max));
    if (m.waitMs) {
      // 4–6 игроков: набралось минимум — ждём ещё немного, вдруг подойдут остальные
      if (q.length >= m.min && !this.modeTimers[mode]) {
        const startsAt = Date.now() + m.waitMs;
        this.modeTimers[mode] = { startsAt, timer: setTimeout(() => {
          this.modeTimers[mode] = null;
          if (q.length >= m.min) this.startGroup(mode, q.splice(0, m.max));
          this.flushQueue(mode);
        }, m.waitMs) };
      } else if (q.length < m.min && this.modeTimers[mode]) {
        clearTimeout(this.modeTimers[mode].timer);
        this.modeTimers[mode] = null;
      }
    }
    this.broadcastQueue(mode);
    this.statsChanged();
  }

  startGroup(mode, entries) {
    const group = entries.map(e => this.users.get(e.id)).filter(Boolean);
    if (!group.length) return;
    group.forEach(u => (u.queueMode = null));
    const room = this.newRoom(group[0].id, false);
    room.mode = mode;
    for (const u of group) this.seat(room, u);
    while (room.seats.length < 2) this.seatBot(room);
    this.start(room);
  }

  broadcastQueue(mode) {
    const m = MODES[mode], q = this.queues[mode];
    const startsAt = this.modeTimers[mode]?.startsAt ?? null;
    for (const e of q) this.send(this.users.get(e.id), { type: 'queue', mode, count: q.length, min: m.min, max: m.max, startsAt, now: Date.now() });
  }

  queueWithBots(user) {
    const mode = user.queueMode;
    if (!mode) throw new LobbyError('Вы не в поиске');
    // Забираем всех ждущих этого режима + добиваем ботами до минимума
    const m = MODES[mode], q = this.queues[mode];
    const entries = q.splice(0, m.max);
    if (this.modeTimers[mode]) { clearTimeout(this.modeTimers[mode].timer); this.modeTimers[mode] = null; }
    const group = entries.map(e => this.users.get(e.id)).filter(Boolean);
    group.forEach(u => (u.queueMode = null));
    const room = this.newRoom(user.id, false);
    room.mode = mode;
    for (const u of group) this.seat(room, u);
    while (room.seats.length < m.min) this.seatBot(room);
    this.start(room);
    this.flushQueue(mode);
  }

  stats() {
    const modes = {};
    for (const mode of Object.keys(MODES)) modes[mode] = { searching: this.queues[mode].length, playing: 0 };
    for (const room of this.rooms.values()) {
      if (!room.mode || !room.game || room.game.phase === 'gameOver') continue;
      modes[room.mode].playing += room.seats.filter(s => !s.bot).length;
    }
    let online = 0;
    for (const u of this.users.values()) if (u.ws) online++;
    return { type: 'stats', modes, online };
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

  practice(user, bots) {
    bots = Math.min(Math.max(bots || 1, 1), 5);
    this.leaveQueue(user);
    if (user.roomCode) this.leaveRoom(user);
    const room = this.newRoom(user.id, true);
    this.seat(room, user);
    for (let i = 0; i < bots; i++) this.seatBot(room);
    this.start(room);
  }

  // ---------- комнаты ----------

  newRoom(hostId, isPrivate) {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = { code, hostId, private: isPrivate, seats: [], game: null, timer: null };
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

  createRoom(user) {
    this.leaveQueue(user);
    const room = this.newRoom(user.id, true);
    this.seat(room, user);
    this.sendRoom(room);
  }

  joinRoom(user, code) {
    const room = this.rooms.get(code);
    if (!room) throw new LobbyError('Комната не найдена');
    if (room.seats.find(s => s.id === user.id)) { user.roomCode = code; this.sendRoom(room); if (room.game) this.sendGame(room, user.id); return; }
    if (room.game && room.game.phase !== 'gameOver') throw new LobbyError('Игра уже идёт');
    if (room.seats.length >= MAX_PLAYERS) throw new LobbyError('Стол заполнен');
    this.leaveQueue(user);
    this.seat(room, user);
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
    if (room.game && room.game.phase !== 'gameOver') throw new LobbyError('Игра уже идёт');
    if (room.seats.length >= MAX_PLAYERS) throw new LobbyError('Стол заполнен');
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
    if (room.seats.length < 2) throw new LobbyError('Нужно минимум 2 игрока — позовите друга или добавьте бота');
    this.start(room);
  }

  rematch(user) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (!room || room.game?.phase !== 'gameOver') return;
    if (!room.private) {
      // В публичной игре «ещё раз» = снова в поиск
      const mode = room.mode || 'duel';
      this.leaveRoom(user);
      return this.joinQueue(user, mode);
    }
    if (room.hostId !== user.id) throw new LobbyError('Новую партию запускает создатель стола');
    room.seats = room.seats.filter(s => s.bot || this.users.get(s.id)?.roomCode === room.code);
    if (room.seats.length < 2) throw new LobbyError('Нужно минимум 2 игрока');
    this.start(room);
  }

  start(room) {
    room.game = new Game(room.seats.map(s => ({ id: s.id, name: s.name })));
    this.sendRoom(room);
    this.broadcastGame(room);
    this.schedule(room);
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
      if (ev.type === 'penalty' && ev.playerId === botId) pool = [2, 3, 4];        // 😡 😭 🤔
      else if (ev.type === 'penalty') pool = [5, 1, 0];                            // 😈 😎 😂
      else if (ev.type === 'roundEnd' && ev.winnerId === botId) pool = [1, 8, 0];  // 😎 🔥 😂
      else if (ev.type === 'lastCard' && ev.playerId === botId) pool = [5, 1];
    }
    if (pool) setTimeout(() => this.chatSend(room, botId, pool[Math.floor(Math.random() * pool.length)]), 600 + Math.random() * 900);
  }

  // ---------- ход игры ----------

  gameAction(user, msg) {
    const room = user.roomCode && this.rooms.get(user.roomCode);
    if (!room?.game) throw new LobbyError('Нет активной игры');
    if (msg.type === 'play') room.game.play(user.id, msg.cardId, msg.suit);
    else if (msg.type === 'draw') room.game.draw(user.id);
    else room.game.pass(user.id);
    this.broadcastGame(room);
    this.schedule(room);
  }

  /** Планирует следующий автоматический шаг: ход бота, авто-ход по таймеру или следующий раунд */
  schedule(room) {
    clearTimeout(room.timer);
    const g = room.game;
    if (!g || g.phase === 'gameOver') return;
    if (g.phase === 'roundOver') {
      room.timer = setTimeout(() => { g.nextRound(); this.broadcastGame(room); this.schedule(room); }, ROUND_PAUSE_MS);
      return;
    }
    const cur = g.current;
    const seat = room.seats.find(s => s.id === cur.id);
    const online = seat && !seat.bot && this.users.get(seat.id)?.ws;
    let delay;
    if (!seat || seat.bot) delay = 650 + Math.random() * 450;
    else if (!online) delay = g.rules.afkSeconds * 1000; // за отключившегося — только через минуту
    else return; // живой игрок ходит сам, никаких авто-ходов
    room.timer = setTimeout(() => {
      if (room.game !== g || g.phase !== 'playing' || g.current !== cur) return;
      const seq = g.eventSeq;
      try { applyAction(g, cur.id, chooseAction(g, cur.id)); } catch (e) { console.error('auto move', e); g.advance(g.nextIndex(g.turn)); }
      if (seat?.bot) for (const s of room.seats.filter(x => x.bot)) this.botReact(room, s.id, g.log.filter(e => e.seq > seq));
      this.broadcastGame(room);
      this.schedule(room);
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
    return {
      code: room.code,
      hostId: room.hostId,
      private: room.private,
      mode: room.mode || null,
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
    view.events = events;
    view.seats = this.roomInfo(room).seats;
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
