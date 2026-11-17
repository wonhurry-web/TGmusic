import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import { config } from './config.js';
import { createServer } from './server.js';
import { SignPool } from './signPool.js';
import { createMusicRoutes } from './musicRoutes.js';
import { safeCredentials, ensureTemplate } from './credentials.js';

// 签名线程池：按 CPU 核数（上限 8）
const workerCount = config.signWorkers > 0 ? config.signWorkers : Math.min(8, Math.max(2, os.cpus().length));
const signer = new SignPool(workerCount);
signer.start();
ensureTemplate();

const music = createMusicRoutes({ signer });

/** 请求处理器：健康检查 + 音乐代理 API；WS 挂载在同一端口 */
const requestHandler = async (req, res) => {
  const url = (req.url || '').split('?')[0];

  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true, service: 'yqting-server', version: '0.4.0', time: Date.now(),
      signWorkers: signer.workers.filter(Boolean).length,
    }));
    return;
  }

  // 音乐代理 API 统一交给路由处理
  if (url.startsWith('/api/')) {
    return music.handle(req, res, url);
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
};

/** TLS 模式：公网 frp 节点只透传 TLS，需用 HTTPS/WSS；否则用明文 HTTP/WS（局域网） */
const proto = config.tlsEnabled ? 'wss' : 'ws';
const httpProto = config.tlsEnabled ? 'https' : 'http';

function makeServer() {
  if (config.tlsEnabled) {
    const cert = fs.readFileSync(config.tlsCert);
    const key = fs.readFileSync(config.tlsKey);
    return https.createServer({ cert, key }, requestHandler);
  }
  return http.createServer(requestHandler);
}

const mainServer = makeServer();
// 兼容端口：既有 frp 隧道面板里本地端口配的是 6666，继续监听以保持公网可用。
// 注意 6666 在 Chromium 的不安全端口名单内，App 必须用主端口 8788。
const legacyServer =
  config.legacyPort && config.legacyPort !== config.port ? makeServer() : null;

const instance = await createServer(legacyServer ? [mainServer, legacyServer] : mainServer);

mainServer.listen(config.port, config.host, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   一起听 · 同步服务端 已启动            ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  传输模式   : ${config.tlsEnabled ? 'TLS/WSS（公网 frp 可用）' : '明文 WS（局域网）'}`);
  console.log(`  主监听     : ${proto}://${config.host}:${config.port}   ← App/WebView 用这个`);
  if (legacyServer) {
    console.log(`  兼容监听   : ${proto}://${config.host}:${config.legacyPort}   ← 供既有 frp 隧道（6666 会被 Chromium 拦截）`);
  }
  console.log(`  健康检查   : ${httpProto}://${config.host}:${config.port}/health`);
  console.log(`  音乐代理   : ${httpProto}://${config.host}:${config.port}/api/health`);
  console.log(`  签名线程池 : ${signer.workers.filter(Boolean).length} 个 worker`);
  console.log(`  应用鉴权   : ${config.authToken ? '已启用' : '未启用（内网/frp 隧道保护）'}`);
  console.log(`  酷狗凭据   : userid=${safeCredentials().userid} token=${safeCredentials().token}`);
  console.log(`  心跳间隔   : ${config.heartbeatInterval / 1000}s`);
  console.log(`  Token 存储 : ${config.tokenStorePath}`);
  console.log('');
});

if (legacyServer) {
  legacyServer.on('error', (e) => {
    console.warn(`  [warn] 兼容端口 ${config.legacyPort} 监听失败：${e.message}（可用 LEGACY_PORT=0 关闭）`);
  });
  legacyServer.listen(config.legacyPort, config.host);
}

// 优雅退出
async function shutdown(signal) {
  console.log(`\n[shutdown] 收到 ${signal}，正在保存数据并关闭…`);
  signer.close();
  await instance.close().catch(() => {});
  const closers = [mainServer, legacyServer].filter(Boolean).map(
    (s) => new Promise((resolve) => s.close(resolve))
  );
  await Promise.all(closers).catch(() => {});
  console.log('[shutdown] 已关闭');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
