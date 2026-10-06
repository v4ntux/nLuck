import { Game, GameError } from './game/engine.js';
import { chooseAction, applyAction } from './game/ai.js';

const BOT_NAMES = ['Бот Вася', 'Бот Маша', 'Бот Петя', 'Бот Оля', 'Бот Гоша', 'Бот Катя'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROUND_PAUSE_MS = 7000;
const MAX_PLAYERS = 6;

export class Lobby {
  constructor() {
    this.users = new Map();  // userId -> { id, name, photo, ws, roomCode }
    this.rooms = new Map();  // code -> room
    this.queues = { 2: [], 3: [], 4: [] };
  }

  // ---------- соединения ----------

  connect(ws, profile) {
    let u = this.users.get(profile.id);
    if (u?.ws && u.ws !== ws) { try { u.ws.close(4000, 'replaced'); } catch {} }
    u = { ...(u || {}), ...profile, ws };
    this.users.set(u.id, u);
    this.send(u, { type: 'welcome', me: { id: u.id, name: u.name, photo: u.photo } });
    const room = u.roomCode && this.rooms.get(u.roomCode);
    if (room) { this.sendRoom(room); if (room.game) { this.sendGame(room, u.id); this.schedule(room); } }
    else u.roomCode = null;
    return u;
  }

  disconnect(user, ws) {
    if (user.ws !== ws) return;
    user.ws = null;
    this.leaveQueue(user);
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
        case 'queue': return this.joinQueue(user, Number(msg.size));
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
        case 'ping': return this.send(user, { type: 'pong' });
      }
    } catch (e) {
      if (e instanceof GameError || e instanceof LobbyError) this.send(user, { type: 'error', message: e.message });
      else { console.error(e); this.send(user, { type: 'error', message: 'Ошибка сервера' }); }
    }
  }

  // ---------- матчмейкинг ----------

  joinQueue(user, size) {
    if (!this.queues[size]) throw new LobbyError('Неверный размер стола');
    if (user.roomCode) this.leaveRoom(user);
    this.leaveQueue(user);
    this.queues[size].push({ id: user.id, since: Date.now() });
    user.queueSize = size;
    this.flushQueue(size);
  }

  leaveQueue(user, notify = false) {
    for (const size of Object.keys(this.queues)) {
      const q = this.queues[size];
      const i = q.findIndex(e => e.id === user.id);
      if (i >= 0) { q.splice(i, 1); this.broadcastQueue(Number(size)); }
    }
    user.queueSize = null;
    if (notify) this.send(user, { type: 'queue', size: null });
  }

  flushQueue(size) {
    const q = this.queues[size];
    while (q.length >= size) {
      const group = q.splice(0, size).map(e => this.users.get(e.id)).filter(Boolean);
      group.forEach(u => (u.queueSize = null));
      const room = this.newRoom(group[0].id, false);
      for (const u of group) this.seat(room, u);
      this.start(room);
    }
    this.broadcastQueue(size);
  }

  broadcastQueue(size) {
    const q = this.queues[size];
    for (const e of q) this.send(this.users.get(e.id), { type: 'queue', size, count: q.length, since: e.since });
  }

  queueWithBots(user) {
    const size = user.queueSize;
    if (!size) throw new LobbyError('Вы не в поиске');
    // Забираем всех ждущих этого размера + добиваем ботами
    const q = this.queues[size];
    const waiting = q.splice(0).map(e => this.users.get(e.id)).filter(Boolean);
    waiting.forEach(u => (u.queueSize = null));
    const room = this.newRoom(user.id, false);
    for (const u of waiting) this.seat(room, u);
    while (room.seats.length < size) this.seatBot(room);
    this.broadcastQueue(size);
    this.start(room);
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
      const size = room.game.players.length;
      this.leaveRoom(user);
      return this.joinQueue(user, Math.min(Math.max(size, 2), 4));
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
      try { applyAction(g, cur.id, chooseAction(g, cur.id)); } catch (e) { console.error('auto move', e); g.advance(g.nextIndex(g.turn)); }
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
    if (room.sentGame !== g) { room.sentGame = g; room.sentSeq = 0; }
    const events = g.log.filter(e => e.seq > room.sentSeq);
    room.sentSeq = g.eventSeq;
    for (const s of room.seats) if (!s.bot) this.sendGame(room, s.id, events);
  }
}

export class LobbyError extends Error {}
