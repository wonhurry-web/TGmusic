import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';

let httpServer;
let instance;
let port;

function connect(roomId, user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const inbox = [];
    const waiters = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', roomId, user }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      // 先满足等待特定 type 的 waiter
      const idx = waiters.findIndex((w) => w.type === msg.type);
      if (idx >= 0) {
        const [w] = waiters.splice(idx, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        inbox.push(msg);
      }
    });
    ws.on('error', reject);
    ws._inbox = inbox;
    ws.waitFor = (type, ms = 2000) =>
      new Promise((resolve, reject) => {
        const idx = inbox.findIndex((m) => m.type === type);
        if (idx >= 0) return resolve(inbox.splice(idx, 1)[0]);
        const waiter = { type, resolve };
        waiter.timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), ms);
        waiters.push(waiter);
      });
    ws.sendMsg = (obj) => ws.send(JSON.stringify(obj));
    resolve(ws);
  });
}

before(async () => {
  httpServer = http.createServer((_req, res) => res.writeHead(200).end());
  instance = await createServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = httpServer.address().port;
});

after(async () => {
  for (const ws of instance.wss.clients) ws.terminate();
  await instance.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

test('join 后收到 welcome 与 room:state', async () => {
  const ws = await connect('t-room1', { id: 'u1', nickname: '甲' });
  const welcome = await ws.waitFor('welcome');
  assert.equal(welcome.clientId, 'u1');
  const state = await ws.waitFor('room:state');
  assert.equal(state.room.roomId, 't-room1');
  assert.deepEqual(state.room.queue, []);
  ws.close();
});

test('队列变更广播给房间其他人，发送者不收到自己的广播', async () => {
  const a = await connect('t-room2', { id: 'a', nickname: 'A' });
  const b = await connect('t-room2', { id: 'b', nickname: 'B' });
  await a.waitFor('room:state');
  await b.waitFor('room:state');

  const queue = [
    { id: 'q1', track: { id: 't1', title: '歌1', artist: '歌手', cover: '', duration: 200, source: 'mock' }, addedBy: 'A', pinned: true, addedAt: 1 },
  ];
  a.sendMsg({ type: 'queue:sync', queue });

  const update = await b.waitFor('queue:update');
  assert.equal(update.queue.length, 1);
  assert.equal(update.queue[0].track.title, '歌1');
  assert.equal(update.by.id, 'a');

  // 发送者不应收到自己的 queue:update
  await new Promise((r) => setTimeout(r, 150));
  const selfGot = a._inbox.some((m) => m.type === 'queue:update');
  assert.equal(selfGot, false, '发送者不应收到自己的广播');

  a.close();
  b.close();
});

test('当前歌曲同步只含轻量字段，无播放进度', async () => {
  const a = await connect('t-room3', { id: 'a', nickname: 'A' });
  const b = await connect('t-room3', { id: 'b', nickname: 'B' });
  await a.waitFor('room:state');
  await b.waitFor('room:state');

  a.sendMsg({
    type: 'track:sync',
    track: { id: 't9', title: '歌9', artist: 'X', cover: 'g', duration: 180, source: 'qq', progress: 0.77, lyrics: ['x'] },
  });

  const update = await b.waitFor('track:update');
  assert.equal(update.track.id, 't9');
  assert.equal(update.track.progress, undefined, '不应包含播放进度');
  assert.equal(update.track.lyrics, undefined, '不应包含歌词');

  a.close();
  b.close();
});

test('token 上传后其他成员可拉取，且写入存储', async () => {
  const a = await connect('t-room4', { id: 'a', nickname: 'A' });
  const b = await connect('t-room4', { id: 'b', nickname: 'B' });
  await a.waitFor('room:state');
  await b.waitFor('room:state');

  const tokens = [{ provider: 'netease', label: '网易云音乐', accountId: '123', token: 'SECRET', bound: true }];
  a.sendMsg({ type: 'token:upload', tokens });

  // 上传者收到 token:data 回执
  const ack = await a.waitFor('token:data');
  assert.equal(ack.tokens[0].token, 'SECRET');

  // 其他成员收到广播
  const update = await b.waitFor('token:update');
  assert.equal(update.tokens[0].provider, 'netease');

  // B 主动拉取
  b.sendMsg({ type: 'token:fetch' });
  const data = await b.waitFor('token:data');
  assert.equal(data.tokens[0].token, 'SECRET');

  // 存储层已保存
  assert.equal(instance.store.get('t-room4')[0].token, 'SECRET');

  a.close();
  b.close();
});

test('不同房间互相隔离', async () => {
  const a = await connect('iso-1', { id: 'a', nickname: 'A' });
  const b = await connect('iso-2', { id: 'b', nickname: 'B' });
  await a.waitFor('room:state');
  await b.waitFor('room:state');

  a.sendMsg({ type: 'queue:sync', queue: [{ id: 'q1', track: { id: 't1' }, addedBy: 'A', pinned: false, addedAt: 1 }] });

  await new Promise((r) => setTimeout(r, 150));
  const leaked = b._inbox.some((m) => m.type === 'queue:update');
  assert.equal(leaked, false, '不同房间不应收到彼此的广播');

  a.close();
  b.close();
});

test('在线频道：消息广播给房间所有人，发送者身份由服务端决定', async () => {
  const a = await connect('chat-1', { id: 'a', nickname: '甲' });
  const b = await connect('chat-1', { id: 'b', nickname: '乙' });
  await a.waitFor('room:state');
  await b.waitFor('room:state');

  // 客户端试图伪造 sender，服务端应忽略并以会话身份为准
  a.sendMsg({
    type: 'chat:send',
    kind: 'text',
    content: '大家好',
    sender: { id: 'a', nickname: '假冒昵称' },
  });

  const ma = await a.waitFor('chat:message');
  const mb = await b.waitFor('chat:message');

  assert.equal(ma.message.content, '大家好');
  assert.equal(ma.message.sender.id, 'a');
  assert.equal(ma.message.sender.nickname, '甲', '昵称必须来自服务端会话，不可被客户端伪造');
  assert.equal(mb.message.id, ma.message.id, '两端应收到同一条消息');
  assert.equal(mb.message.channelId, 'chat-1');
  assert.ok(ma.message.timestamp > 0);

  a.close();
  b.close();
});

test('在线频道：新成员加入可获得真实历史消息', async () => {
  const a = await connect('chat-2', { id: 'a', nickname: '甲' });
  await a.waitFor('room:state');
  a.sendMsg({ type: 'chat:send', kind: 'text', content: '第一句' });
  await a.waitFor('chat:message');

  const b = await connect('chat-2', { id: 'b', nickname: '乙' });
  const state = await b.waitFor('room:state');
  assert.equal(state.room.messages.length, 1);
  assert.equal(state.room.messages[0].content, '第一句');
  assert.equal(state.room.messages[0].sender.nickname, '甲');

  a.close();
  b.close();
});

test('在线频道：非法类型/空内容/过快发送被拒绝', async () => {
  const a = await connect('chat-3', { id: 'a', nickname: '甲' });
  await a.waitFor('room:state');

  a.sendMsg({ type: 'chat:send', kind: 'robot', content: 'hi' });
  assert.equal((await a.waitFor('error')).code, 'BAD_CHAT');

  a.sendMsg({ type: 'chat:send', kind: 'text', content: '   ' });
  assert.equal((await a.waitFor('error')).code, 'BAD_CHAT');

  a.sendMsg({ type: 'chat:send', kind: 'text', content: '正常一句' });
  const ok = await a.waitFor('chat:message');
  assert.equal(ok.message.content, '正常一句');

  // 与上一条间隔不足 chatInterval，应被节流
  a.sendMsg({ type: 'chat:send', kind: 'text', content: '刷屏' });
  assert.equal((await a.waitFor('error')).code, 'CHAT_TOO_FAST');

  a.close();
});
