import { config } from './config.js';
import { toQueueLite, toTrackLite } from './protocol.js';

/**
 * 房间：一组一起听的用户共享同一份队列、当前歌曲与 token。
 * 状态全部在内存中，重启即重置（token 除外，由 store 持久化）。
 */
export class Room {
  constructor(id) {
    this.id = id;
    this.clients = new Set();
    this.queue = [];
    this.currentTrack = null;
    this.tokens = [];       // 房间共享的第三方账号 token
    this.messages = [];     // 在线频道历史消息（仅真实成员发言，服务端生成）
    this.members = new Map(); // clientId -> user
    this.revision = 0;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  addClient(ws, clientId, user) {
    this.clients.add(ws);
    this.members.set(clientId, user);
    this.updatedAt = Date.now();
  }

  removeClient(ws, clientId) {
    this.clients.delete(ws);
    this.members.delete(clientId);
    this.updatedAt = Date.now();
  }

  get memberList() {
    return Array.from(this.members.values());
  }

  setQueue(queue) {
    this.queue = queue.slice(0, config.maxQueueLength);
    this.touch();
  }

  setTrack(track) {
    this.currentTrack = track;
    this.touch();
  }

  setTokens(tokens) {
    this.tokens = tokens;
    this.touch();
  }

  /** 追加一条聊天消息，仅保留最近 maxChatHistory 条 */
  addMessage(message) {
    this.messages.push(message);
    const limit = config.maxChatHistory;
    if (limit > 0 && this.messages.length > limit) {
      this.messages = this.messages.slice(-limit);
    }
    this.touch();
    return message;
  }

  touch() {
    this.revision += 1;
    this.updatedAt = Date.now();
  }

  /** 加入房间时下发的完整快照 */
  snapshot() {
    return {
      roomId: this.id,
      queue: this.queue.map(toQueueLite),
      currentTrack: toTrackLite(this.currentTrack),
      tokens: this.tokens,
      members: this.memberList,
      messages: this.messages,
      revision: this.revision,
    };
  }
}

/** 房间管理器：按 roomId 索引，空房间自动回收 */
export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  get(id) {
    return this.rooms.get(id) ?? null;
  }

  getOrCreate(id) {
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  removeIfEmpty(id) {
    const room = this.rooms.get(id);
    if (room && room.clients.size === 0) {
      this.rooms.delete(id);
      return true;
    }
    return false;
  }

  stats() {
    return {
      rooms: this.rooms.size,
      clients: Array.from(this.rooms.values()).reduce((n, r) => n + r.clients.size, 0),
    };
  }
}
