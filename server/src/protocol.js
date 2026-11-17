/**
 * 同步协议常量与工具。
 * 传输格式：JSON 文本，所有消息形如 { type, ...payload }。
 *
 * 设计原则（减轻服务器压力）：
 * - 只同步「队列」与「当前歌曲」，不同步播放进度时间。
 * - 队列操作采用「全量快照」广播：客户端本地完成增删置顶后，把整个队列发给服务端，
 *   服务端校验后原样广播给房间其他人。服务端无复杂 diff 逻辑，压力极低。
 * - 当前歌曲用 light 对象（id/title/artist/cover/duration/source），不含歌词与进度。
 */

export const MSG = {
  // 客户端 → 服务端
  JOIN: 'join',                    // { roomId, user, token? }
  QUEUE_SYNC: 'queue:sync',        // { queue: QueueItem[] }
  TRACK_SYNC: 'track:sync',        // { track: TrackLite }
  TOKEN_UPLOAD: 'token:upload',    // { tokens: ThirdPartyAccount[] }
  TOKEN_FETCH: 'token:fetch',      // {} 请求服务端最新 token
  CHAT_SEND: 'chat:send',          // { kind: 'text'|'emoji'|'track', content, track? }
  PING: 'ping',

  // 服务端 → 客户端
  WELCOME: 'welcome',              // { clientId, roomId }
  ROOM_STATE: 'room:state',        // { room: { queue, currentTrack, tokens, members, messages } }
  QUEUE_UPDATE: 'queue:update',    // { queue, by }
  TRACK_UPDATE: 'track:update',    // { track, by }
  TOKEN_UPDATE: 'token:update',    // { tokens, by }
  TOKEN_DATA: 'token:data',        // { tokens }
  CHAT_MESSAGE: 'chat:message',    // { message }
  MEMBERS: 'members',              // { members }
  PONG: 'pong',
  ERROR: 'error',                  // { code, message }
};

/** 在线频道：允许的消息类型 */
export const CHAT_KINDS = new Set(['text', 'emoji', 'track']);

/** 精简歌曲对象（同步用，去掉歌词/进度等无关字段） */
export function toTrackLite(track) {
  if (!track || typeof track !== 'object') return null;
  return {
    id: String(track.id ?? ''),
    title: String(track.title ?? ''),
    artist: String(track.artist ?? ''),
    cover: String(track.cover ?? ''),
    duration: Number(track.duration) || 0,
    source: String(track.source ?? 'mock'),
  };
}

/** 精简队列项 */
export function toQueueLite(item) {
  return {
    id: String(item?.id ?? ''),
    track: toTrackLite(item?.track),
    addedBy: String(item?.addedBy ?? ''),
    pinned: Boolean(item?.pinned),
    addedAt: Number(item?.addedAt) || 0,
  };
}

/** 发送 JSON 消息（安全封装） */
export function send(ws, payload) {
  if (ws.readyState !== 1 /* OPEN */) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* 忽略发送异常，连接清理由上层负责 */
  }
}

/** 广播给房间内除 exclude 外的所有客户端 */
export function broadcast(clients, payload, exclude) {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws === exclude || ws.readyState !== 1) continue;
    try {
      ws.send(data);
    } catch {
      /* ignore */
    }
  }
}

export function error(code, message) {
  return { type: MSG.ERROR, code, message };
}
