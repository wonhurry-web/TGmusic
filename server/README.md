# 一起听 · 同步服务端

多人「一起听」的轻量同步服务：房间内广播**播放队列**与**当前歌曲**，提供**在线频道群聊**（服务端权威生成，仅真实成员，无机器人），并支持**第三方账号 token 共享**与**酷狗音乐 API 代理**。

---

## 1. 设计目标（轻量优先）

| 目标 | 实现 |
| --- | --- |
| 队列同步 | 某人添加/删除/切歌/置顶 → 全量队列快照广播给房间所有人 |
| 当前歌曲同步 | 只同步「同一首歌」（TrackLite），**不同步播放进度时间**，大幅降低压力 |
| 在线频道 | `chat:send` → 服务端校验 + 权威生成消息 → `chat:message` 广播；仅真实房间成员，无任何机器人；历史消息环形保留 100 条 |
| Token 共享 | 上传者把本地 token 推到服务端，其他人点「同步」拉取最新 token |
| 音乐代理 | `/api/*` 酷狗搜索/榜单/歌词/直链/登录，签名在服务端完成，凭据不下发 |
| 极低压力 | 内存状态 + 全量快照 + 30s 心跳；无数据库 |

### 为什么不同步播放进度

需求明确：只要「同时播放同一首歌」，不需要对齐秒级时间。因此：

- 客户端改变当前歌曲时发一条 `track:sync`（约几百字节）。
- 服务端只广播歌曲元数据，各端自行从头播放，天然同步。
- 不做任何定时器式的进度上报，服务器压力恒定。

---

## 2. 技术栈与目录

- Node.js 18+（实测 v22）、`ws` 8.x（**唯一运行时依赖**）
- ESM 模块

```
server/
├── src/
│   ├── index.js        # 入口：HTTPS/HTTP 监听（主端口 8788 + 兼容 6666）、优雅退出
│   ├── server.js       # WebSocket 核心：join 鉴权 / 消息路由 / 广播 / 心跳 / 聊天权威生成
│   ├── room.js         # 房间状态：队列 / 当前歌曲 / members / 聊天历史（环形截断）
│   ├── protocol.js     # 消息常量 MSG / CHAT_KINDS + toTrackLite / toQueueLite + send / broadcast
│   ├── musicRoutes.js  # /api/* 音乐代理路由
│   ├── kugou.js        # 酷狗概念版 API 封装
│   ├── kugouLogin.js   # 扫码 / 验证码登录代理
│   ├── sign.js / sign.worker.js / signPool.js   # MD5 签名 + worker_threads 线程池
│   ├── cache.js        # LRU + TTL 缓存
│   ├── credentials.js  # 酷狗凭据管理
│   ├── store.js        # token JSON 持久化（防抖落盘）
│   └── config.js       # 全部配置项
├── certs/              # 自签证书 cert.pem / key.pem
├── frpc.toml           # frp 配置
├── data/               # 运行时生成：tokens.json / credentials.json
├── test/
│   ├── sync.test.js    # 同步协议 8 项（房间/广播/房间隔离/聊天收发）
│   └── kugou.test.js   # 音乐代理 5 项
└── README.md
```

---

## 3. 本地运行

```bash
cd server
npm install
npm start
```

输出：

```
 ╔══════════════════════════════════════════╗
 ║   一起听 · 同步服务端 已启动             ║
 ╚══════════════════════════════════════════╝
 监听地址   : wss://0.0.0.0:8788   （TLS 模式）
 健康检查   : https://0.0.0.0:8788/health
```

健康检查：

```bash
curl -k https://127.0.0.1:8788/health
# {"ok":true,"service":"syncwave-server",...}
```

### ⚠️ 端口说明（重要）

- **主端口 8788**：Chromium/WebView 把 6665-6669 视为不安全端口（IRC 段），App 内 WebSocket 连 `6666` 会直接 `net::ERR_UNSAFE_PORT` 失败。App 端一律填 **8788**。
- **兼容端口 6666**：既有 frp 隧道面板本地端口为 6666，服务端默认双监听以免改动隧道；`LEGACY_PORT=0` 可关闭。

### 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8788` | 主监听端口 |
| `LEGACY_PORT` | `6666` | 兼容端口，`0` 关闭 |
| `APP_TOKEN` | 空 | 应用鉴权 token，设置后客户端 join 必须携带 |
| `TOKEN_STORE` | `data/tokens.json` | token 存储路径 |
| `MAX_CHAT_HISTORY` | `100` | 每房间聊天历史保留条数 |
| `TLS_ENABLED` | `0` | 设为 `1` 启用 HTTPS/WSS（公网 frp 必需） |
| `TLS_CERT` / `TLS_KEY` | `certs/cert.pem` / `certs/key.pem` | TLS 证书与私钥 |
| `SIGN_WORKERS` | `0`（按 CPU 核数，上限 8） | 签名线程池大小 |

### 公网 frp 部署（SakuraFrp，实测）

SakuraFrp 节点会拦截明文 HTTP（返回 501 合规页面），**仅透传 TLS**。因此公网同步必须用 WSS：

```bash
# 1) 启动 TLS 模式服务端
TLS_ENABLED=1 npm start

# 2) 启动 frpc 隧道（访问密钥:隧道ID，密钥在 SakuraFrp 面板查看，勿提交仓库）
frpc -f <访问密钥>:<隧道ID> -n

# 公网入口
wss://api.u314327.nyat.app:57899
```

App 设置中心「公网地址」填 `wss://api.u314327.nyat.app:57899`。证书为自签 CA（SAN 含域名+节点IP+局域网IP），已内嵌到 App 的 `network_security_config.xml`（`base-config` 信任锚，覆盖 IP 直连场景），WebView 可正常校验。局域网调试填 `wss://192.168.1.101:8788`（TLS 模式下同样可用，证书 SAN 已含局域网 IP）。

---

## 4. frp 内网穿透（把本机服务暴露到公网 57899）

已按给定参数生成 `frpc.toml`：

```toml
[[proxies]]
name = "music"
type = "tcp"
localIP = "127.0.0.1"
localPort = 6666
remotePort = 57899
```

### 方式 A：标准 frp（frpc.toml）

```bash
frpc -c frpc.toml
# 需按服务商填写 serverAddr / serverPort / auth.token
```

### 方式 B：SakuraFrp 风格（使用给定的访问密钥）

SakuraFrp 的访问密钥格式为 `-f <访问密钥>:<隧道ID>`：

```bash
# 1) 在 SakuraFrp 面板创建隧道：TCP 类型，本地端口 6666，远程端口 57899
# 2) 用访问密钥启动
frpc -f <访问密钥>:<隧道ID>
```

> 隧道建好后，公网地址为 `wss://<frp节点>:57899`（TLS 模式），App 端填这个地址即可连到本机服务端。
>
> 端口建议：隧道 `localPort` 指向 6666 仍可用（服务端默认兼容监听）；**新建隧道建议直接指 `localPort = 8788`**（主端口，App 直连场景必需），并同步修改 `frpc.toml`。

---

## 5. 通信协议（JSON / WebSocket）

所有消息形如 `{ "type": "...", ... }`。

### 5.1 连接与鉴权

客户端连接后首先发送 `join`：

```json
{ "type": "join", "roomId": "music", "user": { "id": "u-me", "nickname": "我", "avatar": "" }, "token": "可选应用鉴权token" }
```

服务端回执：

```json
{ "type": "welcome", "clientId": "u-me", "roomId": "music" }
{ "type": "room:state", "room": { "roomId": "music", "queue": [], "currentTrack": null, "tokens": [], "members": [], "revision": 0 } }
```

成员变化：

```json
{ "type": "members", "members": [ { "id": "u-me", "nickname": "我" } ] }
```

### 5.2 队列同步（添加/删除/切歌/置顶）

客户端本地操作后，发送**全量队列快照**：

```json
{ "type": "queue:sync", "queue": [ { "id": "q1", "track": {...}, "addedBy": "我", "pinned": true, "addedAt": 123 } ] }
```

服务端广播给房间其他人（不含发送者）：

```json
{ "type": "queue:update", "queue": [...], "by": { "id": "u-1", "nickname": "星河" } }
```

### 5.3 当前歌曲同步（只同步「同一首歌」，无进度）

```json
{ "type": "track:sync", "track": { "id": "t1", "title": "夜空中最亮的星", "artist": "逃跑计划", "cover": "...", "duration": 252, "source": "netease" } }
```

广播：

```json
{ "type": "track:update", "track": {...}, "by": {...} }
```

> 收到 `track:update` 后，客户端切到这首歌并从头播放即可，无需对齐时间。

### 5.4 在线频道聊天（服务端权威，仅真实成员）

**发送**（客户端 → 服务端）：

```json
{ "type": "chat:send", "kind": "text", "content": "大家好" }
{ "type": "chat:send", "kind": "emoji", "content": "🎶" }
{ "type": "chat:send", "kind": "track", "content": "分享了一首歌", "track": { "id": "t1", "title": "..." } }
```

**广播**（服务端 → 房间所有人，含发送者）：

```json
{ "type": "chat:message", "message": { "id": "m-xxxx", "channelId": "music", "sender": { "id": "...", "nickname": "听友1234", "avatar": "..." }, "type": "text", "content": "大家好", "timestamp": 1700000000000 } }
```

设计要点：

- 消息由**服务端权威生成**：`sender` 取自该连接 join 时登记的真实用户，客户端无法伪造他人身份，也不存在机器人消息。
- 客户端**不做本地乐观插入**，以服务端广播为准（含自己发的），天然去重。
- 限制：单条 ≤500 字符；同一连接最小间隔 250ms（超限回 `error: CHAT_TOO_FAST`）；每房间历史环形保留 100 条，加入房间时随 `room:state` 下发。
- 聊天与队列/歌曲同步**共用同一条 WS 连接**：未连接（同步开关关闭）时客户端输入禁用。

### 5.5 Token 共享

**上传**（把本地 token 共享给好友）：

```json
{ "type": "token:upload", "tokens": [ { "provider": "netease", "label": "网易云音乐", "accountId": "xxx", "token": "...", "bound": true } ] }
```

服务端回执 `token:data` 给上传者，并广播 `token:update` 给其他人，同时写入 `data/tokens.json`。

**同步**（拉取服务端最新 token）：

```json
{ "type": "token:fetch" }
```
```json
{ "type": "token:data", "tokens": [ ... ] }
```

### 5.6 心跳与错误

- 服务端每 30s 发 WebSocket ping，客户端协议栈自动回 pong；连续两次无响应断开。
- 也可主动 `{ "type": "ping", "t": 123 }` → 收到 `{ "type": "pong", "t": 123 }`。
- 错误：`{ "type": "error", "code": "BAD_ROOM", "message": "..." }`；聊天相关错误码：`CHAT_TOO_FAST` / `BAD_CHAT`。

### 消息类型速查

| 方向 | type |
| --- | --- |
| C→S | `join` `queue:sync` `track:sync` `chat:send` `token:upload` `token:fetch` `ping` |
| S→C | `welcome` `room:state` `queue:update` `track:update` `chat:message` `token:update` `token:data` `members` `pong` `error` |

---

## 6. 运行测试

```bash
cd server
npm test
```

共 13 项：`sync.test.js` 8 项（房间加入、队列/歌曲广播、房间隔离、聊天收发与广播）+ `kugou.test.js` 5 项（音乐代理）。

---

## 7. App 端接入

App 端对应实现 `src/services/syncService.ts` + `src/hooks/useSync.ts` + `src/store/chat.ts`：

- 设置中心开启「一起听同步」后连接服务器地址（局域网 `wss://192.168.1.101:8788`，公网 `wss://<节点>:57899`）。
- join 使用**设备唯一身份**（`src/services/identity.ts`：持久化 uid + 昵称「听友XXXX」），保证多人不撞 ID。
- 队列/歌曲变更时自动 `queue:sync` / `track:sync`；收到广播后更新本地 Zustand store（**只更新歌曲，不覆盖本地进度**）。
- 在线频道：`ChatPanel.tsx` 展示 `chat:message`；歌词页「分享到频道」发 `chat:send kind=track`；未连接时输入禁用并提示到设置开启。
- 设置中心「上传 Token」「同步 Token」按钮对应 `token:upload` / `token:fetch`。

---

## 8. 安全建议

- 公网部署务必设置 `APP_TOKEN`，并确保 App 端 join 携带。
- token 以明文存于 `data/tokens.json`，该文件应加入 `.gitignore`，服务器目录设置合适权限。
- frp 隧道本身也有鉴权（访问密钥/frp token），双重保护。

---

## 9. 酷狗音乐代理 API（v0.3.0+）

服务端同时充当音乐 API 代理：所有真实请求（含签名）由服务端发出，App 只拿结果，
**签名密钥与设备凭据不下发到客户端**。接口来自 `接口文档/API.md`（酷狗概念版实测接口）。

### 9.1 HTTP 端点

| 方法 | 路径 | 参数 | 说明 |
|---|---|---|---|
| GET | `/api/health` | — | 数据源/鉴权状态（凭据脱敏） |
| GET | `/api/search` | `keyword` `type=song\|playlist` `page` `pagesize` | 歌曲/歌单搜索 |
| GET | `/api/playlists` | `limit` | 推荐歌单（榜单列表） |
| GET | `/api/daily` | `page` | 每日推荐（TOP500 榜单） |
| GET | `/api/tracks` | `rankId` `page` `pagesize` | 榜单/歌单歌曲 |
| GET | `/api/lyrics` | `track=<json>` | 歌词（hash + duration 精确匹配） |
| GET | `/api/playurl` | `track=<json>` `quality` | 音频直链（standard/high/lossless/hires） |
| POST | `/api/credentials/template` | — | 生成凭据模板文件 |

所有端点在失败时返回 `{ ok:false, error }`，App 据此降级到内置 Mock 曲库。

### 9.2 鉴权参数配置（酷狗）

敏感参数集中在 `src/credentials.js`，优先级 **环境变量 > `data/credentials.json` > 文档默认值**。
换账号或设备时，二选一：

**方式 A：编辑文件**（推荐）
```bash
curl -X POST http://127.0.0.1:8788/api/credentials/template   # 生成 data/credentials.json
# 编辑其中的 userid / mid / dfid / token / secret
```

**方式 B：环境变量**
```bash
KG_USERID=xxx KG_TOKEN=xxx KG_MID=xxx KG_DFID=xxx npm start
```

支持的参数：`appid` `clientver` `plat` `channel` `userid` `mid` `dfid` `token` `uuid` `secret` `userAgent`。
`/api/health` 返回脱敏视图（便于确认已生效，不泄露明文）。

应用鉴权 `APP_TOKEN` 设置后，HTTP 请求需在 header 带 `x-app-token`（与 WS join 的 token 一致）。

### 9.3 多线程与缓存

- **签名线程池**：`worker_threads` 起 N 个 worker（默认按 CPU 核数，上限 8，可用 `SIGN_WORKERS` 覆盖）并行做 MD5 签名；超时/异常自动降级主线程，保证可用。
- **缓存**：LRU + TTL，搜索 5min / 榜单 15~30min / 歌词 1h / 直链 55min（直链约 2~4h 时效，留足余量）。
- **并发**：App 端预取下一首 + URL 缓存 + Promise 去重，减少切歌等待与重复签名。

### 9.4 真机测试连接

App 设置中心「服务器配置」填电脑局域网地址（与同步共用同一端口）：
```
服务器地址：wss://192.168.1.101:8788
房间号：music
```
音乐代理地址由 App 自动从 `ws://` 推导为 `http://`（见 `src/services/apiConfig.ts`）。
若经 frp 公网：`ws://<节点>:57899` → 音乐代理 `http://<节点>:57899`。

