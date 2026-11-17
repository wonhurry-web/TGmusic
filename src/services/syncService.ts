import type { ChatMessage, MessageType, QueueItem, Track, ThirdPartyAccount } from '../types';

/**
 * 一起听同步客户端（WebSocket）。
 * 连接电脑端同步服务端，房间内广播队列与当前歌曲（不同步播放进度），共享 token。
 *
 * 设计：
 * - 单例，事件订阅式（on/off）。
 * - 断线自动重连（指数退避，上限 15s）。
 * - 应用远端状态时不回环发送（由调用方决定是否回写）。
 */

export interface SyncConfig {
  serverUrl: string;   // ws://host:57899
  roomId: string;
  userId: string;
  nickname: string;
  avatar?: string;
  authToken?: string;  // 应用鉴权 token（可选）
}

export type SyncStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface RoomMember {
  id: string;
  nickname: string;
  avatar?: string;
}

type EventMap = {
  status: SyncStatus;
  queue: QueueItem[];
  track: Track;
  tokens: ThirdPartyAccount[];
  members: RoomMember[];
  /** 在线频道收到一条真实成员消息 */
  chat: ChatMessage;
  /** 加入房间时下发的历史消息（真实成员发言） */
  chatHistory: ChatMessage[];
  error: { code: string; message: string };
};

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

const MSG = {
  JOIN: 'join', QUEUE_SYNC: 'queue:sync', TRACK_SYNC: 'track:sync',
  TOKEN_UPLOAD: 'token:upload', TOKEN_FETCH: 'token:fetch', PING: 'ping',
  WELCOME: 'welcome', ROOM_STATE: 'room:state', QUEUE_UPDATE: 'queue:update',
  TRACK_UPDATE: 'track:update', TOKEN_UPDATE: 'token:update', TOKEN_DATA: 'token:data',
  CHAT_SEND: 'chat:send', CHAT_MESSAGE: 'chat:message',
  MEMBERS: 'members', PONG: 'pong', ERROR: 'error',
} as const;

class SyncClient {
  private ws: WebSocket | null = null;
  private config: SyncConfig | null = null;
  private handlers: { [K in keyof EventMap]?: Set<Handler<K>> } = {};
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private manualClose = false;
  private _status: SyncStatus = 'idle';

  get status() {
    return this._status;
  }

  get connected() {
    return this._status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /** 订阅事件，返回取消订阅函数 */
  on<K extends keyof EventMap>(event: K, handler: Handler<K>): () => void {
    (this.handlers[event] ??= new Set() as never).add(handler as never);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<K>) {
    this.handlers[event]?.delete(handler as never);
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
    this.handlers[event]?.forEach((h) => (h as Handler<K>)(payload));
  }

  private setStatus(s: SyncStatus) {
    this._status = s;
    this.emit('status', s);
  }

  connect(config: SyncConfig) {
    this.config = config;
    this.manualClose = false;
    this.reconnectDelay = 1000;
    this.open();
  }

  private open() {
    if (!this.config) return;
    this.setStatus(this.reconnectDelay > 1000 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.config.serverUrl);
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.setStatus('connected');
      const { roomId, userId, nickname, avatar, authToken } = this.config!;
      this.rawSend({
        type: MSG.JOIN,
        roomId,
        user: { id: userId, nickname, avatar },
        ...(authToken ? { token: authToken } : {}),
      });
    };

    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onerror = () => this.emit('error', { code: 'WS_ERROR', message: '连接错误' });
    ws.onclose = () => {
      if (this.manualClose) return;
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    };
  }

  private onMessage(data: unknown) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    switch (msg.type) {
      case MSG.QUEUE_UPDATE:
        this.emit('queue', (msg.queue as QueueItem[]) ?? []);
        break;
      case MSG.TRACK_UPDATE:
        if (msg.track) this.emit('track', msg.track as Track);
        break;
      case MSG.TOKEN_UPDATE:
      case MSG.TOKEN_DATA:
        this.emit('tokens', (msg.tokens as ThirdPartyAccount[]) ?? []);
        break;
      case MSG.MEMBERS:
        this.emit('members', (msg.members as RoomMember[]) ?? []);
        break;
      case MSG.CHAT_MESSAGE:
        if (msg.message) this.emit('chat', msg.message as ChatMessage);
        break;
      case MSG.ROOM_STATE: {
        const room = msg.room as Record<string, unknown> | undefined;
        if (!room) break;
        if (Array.isArray(room.queue)) this.emit('queue', room.queue as QueueItem[]);
        if (room.currentTrack) this.emit('track', room.currentTrack as Track);
        if (Array.isArray(room.tokens)) this.emit('tokens', room.tokens as ThirdPartyAccount[]);
        if (Array.isArray(room.members)) this.emit('members', room.members as RoomMember[]);
        if (Array.isArray(room.messages)) this.emit('chatHistory', room.messages as ChatMessage[]);
        break;
      }
      case MSG.ERROR:
        this.emit('error', {
          code: String(msg.code ?? 'UNKNOWN'),
          message: String(msg.message ?? '未知错误'),
        });
        break;
      // welcome / pong 无需处理
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
  }

  private rawSend(obj: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('idle');
  }

  /** 同步整个队列快照（本地增删/切歌/置顶后调用） */
  syncQueue(queue: QueueItem[]) {
    this.rawSend({ type: MSG.QUEUE_SYNC, queue });
  }

  /** 同步当前歌曲（只发元数据，不含进度） */
  syncTrack(track: Track) {
    const lite = {
      id: track.id, title: track.title, artist: track.artist,
      cover: track.cover, duration: track.duration, source: track.source,
    };
    this.rawSend({ type: MSG.TRACK_SYNC, track: lite });
  }

  /** 上传本地 token 共享给好友 */
  uploadTokens(tokens: ThirdPartyAccount[]) {
    this.rawSend({ type: MSG.TOKEN_UPLOAD, tokens });
  }

  /** 拉取服务端最新 token */
  fetchTokens() {
    this.rawSend({ type: MSG.TOKEN_FETCH });
  }

  /**
   * 在线频道发言。内容由服务端生成权威消息（id/时间戳/发送者身份），
   * 本地不做乐观插入，统一由 chat:message 广播回流渲染，避免重复或伪造。
   */
  sendChat(kind: MessageType, content: string, track?: Track) {
    const lite = track
      ? {
          id: track.id, title: track.title, artist: track.artist,
          cover: track.cover, duration: track.duration, source: track.source,
        }
      : undefined;
    this.rawSend({
      type: MSG.CHAT_SEND,
      kind,
      content,
      ...(lite ? { track: lite } : {}),
    });
  }
}

export const syncService = new SyncClient();
export default syncService;
