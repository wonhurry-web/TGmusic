import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { MSG, CHAT_KINDS, send, broadcast, error, toQueueLite, toTrackLite } from './protocol.js';
import { RoomManager } from './room.js';
import { TokenStore } from './store.js';

/** 为每个 ws 连接维护的上下文 */
function newContext() {
  return { clientId: '', roomId: '', user: null, joined: false, alive: true, lastChatAt: 0 };
}

/**
 * @param {import('node:http').Server | import('node:http').Server[]} httpServers
 *   可传入多个 server（主端口 + 兼容端口），它们共享同一批房间与 WSS 处理逻辑，
 *   因此从任一端口加入的客户端都在同一个房间里互相可见。
 */
export async function createServer(httpServers) {
  const servers = Array.isArray(httpServers) ? httpServers : [httpServers];
  const rooms = new RoomManager();
  const store = new TokenStore();
  await store.init();

  const wssList = [];

  /** 在一个 server 上挂载 WebSocket 服务（共享 handle / rooms） */
  function attach(server) {
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
      const ctx = newContext();
      ws._syncCtx = ctx; // 关联上下文，供心跳检测使用

      // 心跳：服务端 ping，客户端 pong 回应；连续未响应则断开
      ws.on('pong', () => {
        ctx.alive = true;
      });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          send(ws, error('BAD_JSON', '消息不是合法 JSON'));
          return;
        }
        if (!msg || typeof msg.type !== 'string') {
          send(ws, error('BAD_MESSAGE', '缺少 type 字段'));
          return;
        }
        handle(ws, ctx, msg);
      });

      ws.on('close', () => handleDisconnect(ws, ctx));
      ws.on('error', () => handleDisconnect(ws, ctx));
    });
    wssList.push(wss);
    return wss;
  }

  for (const server of servers) attach(server);

  // 定时心跳检测（覆盖所有端口的连接）
  const heartbeat = setInterval(() => {
    for (const wss of wssList) {
      for (const ws of wss.clients) {
        const c = ws._syncCtx;
        if (!c) continue;
        if (c.alive === false) {
          ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }
  }, config.heartbeatInterval);

  for (const wss of wssList) wss.on('close', () => clearInterval(heartbeat));

  // ---- 消息处理 ----
  function handle(ws, ctx, msg) {
    switch (msg.type) {
      case MSG.JOIN:
        return onJoin(ws, ctx, msg);
      case MSG.PING:
        send(ws, { type: MSG.PONG, t: msg.t });
        return;
      default:
        if (!ctx.joined) {
          send(ws, error('NOT_JOINED', '请先发送 join 加入房间'));
          return;
        }
        switch (msg.type) {
          case MSG.QUEUE_SYNC:
            return onQueueSync(ws, ctx, msg);
          case MSG.TRACK_SYNC:
            return onTrackSync(ws, ctx, msg);
          case MSG.TOKEN_UPLOAD:
            return onTokenUpload(ws, ctx, msg);
          case MSG.TOKEN_FETCH:
            return onTokenFetch(ws, ctx);
          case MSG.CHAT_SEND:
            return onChatSend(ws, ctx, msg);
          default:
            send(ws, error('UNKNOWN_TYPE', `未知消息类型: ${msg.type}`));
        }
    }
  }

  function onJoin(ws, ctx, msg) {
    const roomId = String(msg.roomId ?? '').trim();
    if (!config.roomIdPattern.test(roomId)) {
      send(ws, error('BAD_ROOM', '房间 ID 不合法'));
      return;
    }
    // 应用鉴权
    if (config.authToken && String(msg.token ?? '') !== config.authToken) {
      send(ws, error('UNAUTH', '鉴权失败'));
      ws.close();
      return;
    }

    const room = rooms.getOrCreate(roomId);
    if (config.maxMembersPerRoom > 0 && room.clients.size >= config.maxMembersPerRoom) {
      send(ws, error('ROOM_FULL', '房间已满'));
      return;
    }

    // 断线重连：清理旧连接
    ctx.clientId = String(msg.user?.id ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    ctx.roomId = roomId;
    ctx.user = {
      id: ctx.clientId,
      nickname: String(msg.user?.nickname ?? '匿名'),
      avatar: String(msg.user?.avatar ?? ''),
    };
    ctx.joined = true;
    ws._syncCtx = ctx;

    // 若服务端尚无 token，尝试从持久化恢复
    if (room.tokens.length === 0) {
      const saved = store.get(roomId);
      if (saved.length) room.setTokens(saved);
    }

    room.addClient(ws, ctx.clientId, ctx.user);

    send(ws, { type: MSG.WELCOME, clientId: ctx.clientId, roomId });
    send(ws, { type: MSG.ROOM_STATE, room: room.snapshot() });
    broadcast(room.clients, { type: MSG.MEMBERS, members: room.memberList });
    console.log(`[join] ${ctx.user.nickname}(${ctx.clientId}) → 房间 ${roomId}，当前 ${room.clients.size} 人`);
  }

  function onQueueSync(ws, ctx, msg) {
    const room = rooms.get(ctx.roomId);
    if (!room) return;
    if (!Array.isArray(msg.queue)) {
      send(ws, error('BAD_QUEUE', 'queue 必须是数组'));
      return;
    }
    const queue = msg.queue.slice(0, config.maxQueueLength).map(toQueueLite).filter((q) => q.id);
    room.setQueue(queue);
    broadcast(room.clients, { type: MSG.QUEUE_UPDATE, queue, by: ctx.user }, ws);
  }

  function onTrackSync(ws, ctx, msg) {
    const room = rooms.get(ctx.roomId);
    if (!room) return;
    const track = toTrackLite(msg.track);
    if (!track || !track.id) {
      send(ws, error('BAD_TRACK', 'track 无效'));
      return;
    }
    room.setTrack(track);
    // 只广播当前歌曲，不含播放进度时间点
    broadcast(room.clients, { type: MSG.TRACK_UPDATE, track, by: ctx.user }, ws);
  }

  function onTokenUpload(ws, ctx, msg) {
    const room = rooms.get(ctx.roomId);
    if (!room) return;
    if (!Array.isArray(msg.tokens)) {
      send(ws, error('BAD_TOKENS', 'tokens 必须是数组'));
      return;
    }
    // 校验并精简 token 项
    const tokens = msg.tokens
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        provider: String(t.provider ?? ''),
        label: String(t.label ?? ''),
        accountId: String(t.accountId ?? ''),
        token: String(t.token ?? ''),
        bound: Boolean(t.bound),
      }))
      .slice(0, 50);

    room.setTokens(tokens);
    store.set(ctx.roomId, tokens, ctx.user.nickname);
    // 上传者也回执一份，确保本地与服务端一致
    send(ws, { type: MSG.TOKEN_DATA, tokens });
    broadcast(room.clients, { type: MSG.TOKEN_UPDATE, tokens, by: ctx.user }, ws);
    console.log(`[token] ${ctx.user.nickname} 上传 ${tokens.length} 条 token 到房间 ${ctx.roomId}`);
  }

  function onTokenFetch(ws, ctx) {
    const tokens = store.get(ctx.roomId);
    send(ws, { type: MSG.TOKEN_DATA, tokens });
  }

  /**
   * 在线频道发言。
   * 服务端是唯一权威：消息 id、时间戳、发送者身份全部在服务端生成，
   * 客户端无法伪造他人身份或插入机器人消息。
   */
  function onChatSend(ws, ctx, msg) {
    const room = rooms.get(ctx.roomId);
    if (!room) return;

    // 简易防刷屏：同一连接最小发送间隔
    const now = Date.now();
    if (ctx.lastChatAt && now - ctx.lastChatAt < config.chatInterval) {
      send(ws, error('CHAT_TOO_FAST', '发送太快，请稍后再试'));
      return;
    }

    const kind = String(msg.kind ?? 'text');
    if (!CHAT_KINDS.has(kind)) {
      send(ws, error('BAD_CHAT', '不支持的消息类型'));
      return;
    }

    const content = String(msg.content ?? '').slice(0, config.maxChatLength).trim();
    let track = null;
    if (kind === 'track') {
      track = toTrackLite(msg.track);
      if (!track || !track.id) {
        send(ws, error('BAD_CHAT', '分享的歌曲无效'));
        return;
      }
    } else if (!content) {
      send(ws, error('BAD_CHAT', '消息内容不能为空'));
      return;
    }

    ctx.lastChatAt = now;
    const message = room.addMessage({
      id: `m-${now}-${Math.random().toString(36).slice(2, 8)}`,
      channelId: room.id,
      // 身份取自服务端会话，忽略客户端自称的 sender
      sender: { ...ctx.user },
      type: kind,
      content: kind === 'track' ? content || '分享了一首歌' : content,
      ...(track ? { track } : {}),
      timestamp: now,
    });

    // 广播给房间内所有人（含发送者），保证各端消息顺序一致
    broadcast(room.clients, { type: MSG.CHAT_MESSAGE, message });
  }

  function handleDisconnect(ws, ctx) {
    if (!ctx.roomId) return;
    const room = rooms.get(ctx.roomId);
    if (room) {
      room.removeClient(ws, ctx.clientId);
      broadcast(room.clients, { type: MSG.MEMBERS, members: room.memberList });
      rooms.removeIfEmpty(ctx.roomId);
    }
    console.log(`[leave] ${ctx.user?.nickname ?? ctx.clientId} 离开房间 ${ctx.roomId}`);
  }

  return {
    wss: wssList[0], // 兼容既有调用（测试中读取 clients）
    wssList,
    rooms,
    store,
    close: async () => {
      clearInterval(heartbeat);
      await store.close();
      await Promise.all(
        wssList.map((w) => new Promise((resolve) => w.close(resolve)))
      );
    },
  };
}
