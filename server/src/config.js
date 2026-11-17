import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * 服务端配置。
 * 敏感项（应用鉴权 token）可通过环境变量覆盖，避免硬编码。
 */
export const config = {
  // 监听地址：默认 0.0.0.0，便于同一局域网的手机直接访问（真机调试）；
  // frp 场景 frpc 也可连 127.0.0.1，二者兼容。仅本机可用时用 HOST=127.0.0.1 覆盖。
  host: process.env.HOST || '0.0.0.0',

  // 主监听端口。注意：Chromium/WebView 把 6665-6669 视为不安全端口
  // （net::ERR_UNSAFE_PORT，IRC 段），App 端 WebSocket 会被直接拦截，
  // 所以主端口用 8788。
  port: Number(process.env.PORT || 8788),

  // 兼容端口：既有 frp 隧道面板里本地端口配的是 6666，
  // 默认同时监听 6666 以便公网隧道免改动。设 LEGACY_PORT=0 可关闭。
  legacyPort: process.env.LEGACY_PORT === '0' ? 0 : Number(process.env.LEGACY_PORT || 6666),

  // 应用鉴权 token：客户端 join 时需携带，留空则不校验。
  // 与 frp 隧道鉴权独立；这里用环境变量 APP_TOKEN 注入。
  authToken: process.env.APP_TOKEN || '',

  // 心跳间隔（毫秒）。较长间隔以减轻服务器压力。
  heartbeatInterval: 30_000,

  // 单房间最大成员数（0 表示不限）
  maxMembersPerRoom: 50,

  // 房间最大队列长度
  maxQueueLength: 500,

  // 在线频道：每房间保留的历史聊天条数（仅真实成员发言，服务端权威生成）
  maxChatHistory: Number(process.env.MAX_CHAT_HISTORY || 100),

  // 在线频道：单条消息最大字符数 / 同一连接最小发送间隔（毫秒，防刷屏）
  maxChatLength: 500,
  chatInterval: 250,

  // token 持久化文件
  tokenStorePath: process.env.TOKEN_STORE || path.join(ROOT, 'data', 'tokens.json'),

  // TLS/WSS：公网 frp 节点（SakuraFrp）会拦截明文 HTTP（501），仅透传 TLS。
  // 公网部署时设 TLS_ENABLED=1，并提供 certs/cert.pem + certs/key.pem，
  // App 端用 wss:// 连接（局域网明文 ws:// 仍可用，需关闭 TLS）。
  tlsEnabled: process.env.TLS_ENABLED === '1',
  tlsCert: process.env.TLS_CERT || path.join(ROOT, 'certs', 'cert.pem'),
  tlsKey: process.env.TLS_KEY || path.join(ROOT, 'certs', 'key.pem'),

  // 签名线程池大小（多线程优化：0 表示按 CPU 核数，上限 8）
  signWorkers: Number(process.env.SIGN_WORKERS || 0),

  // 允许的房间 ID 正则
  roomIdPattern: /^[A-Za-z0-9_-]{1,64}$/,
};

export default config;
