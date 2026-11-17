# 一起听（原「同频 SyncWave」）

> 轻量、高性能的「一起听」音乐 App。单主页面交互，支持多人同步听歌、**真实用户在线频道群聊**（无机器人）、三栏音乐发现、KTV 式消耗队列。

---

## 一、项目速览

| 项目 | 内容 |
| --- | --- |
| 产品名称 | 一起听（包名 `com.syncwave.app`） |
| 产品定位 | 轻量高性能的「一起听」音乐社交 App |
| Slogan | 同一首歌，同一个频率 |
| 目标平台 | Android 优先（Capacitor 7 打包）/ Web 调试 |
| 前端技术栈 | Vite 6 + React 18 + TypeScript + Zustand + lucide-react |
| 同步服务端 | Node.js + ws（`server/`，唯一运行时依赖 `ws`） |
| 音乐数据源 | 酷狗概念版（个人 Token 直连优先 → 服务端代理 → 内置 Mock 三级降级） |
| 多线程 | 服务端 worker_threads 签名池（≤8）+ App 端并发预取/缓存 |
| 当前版本 | v0.4.2（见 `docs/CHANGELOG.md`） |

---

## 二、整体架构

```
┌─────────────────────────── Android App（Capacitor WebView）────────────────────────────┐
│  UI 层  Header / TabBar / RecommendTab / SearchTab / QueueTab / PlayerBar / ChatPanel  │
│         LyricsPanel / SettingsPanel                                                    │
│  状态层 Zustand：player（队列/播放）· chat（频道消息）· settings（配置/Token）· theme   │
│  服务层 syncService（WS 同步+聊天）· resilientApi（三级降级数据源）· identity（设备身份）│
│         audioPlayer · directKugouApi · httpMusicApi · authApi · qrcode · md5           │
└───────────────┬──────────────────────────────────────┬─────────────────────────────────┘
                │ wss:// 同步+聊天（同一连接）          │ http(s):// 音乐代理 REST
┌───────────────▼──────────────────────────────────────▼─────────────────────────────────┐
│  Node.js 服务端 server/（主端口 8788，兼容端口 6666，TLS 可选）                          │
│  WS：房间广播队列/歌曲 + 在线频道聊天（服务端权威，仅真实成员）+ Token 共享               │
│  HTTP：/api/* 酷狗搜索/榜单/歌词/直链/登录代理（签名在服务端，凭据不下发）               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**关键设计约定**

- **在线频道零机器人**：聊天消息只由服务端从真实连接成员的发言权威生成并广播，客户端不做本地乐观插入、不生成假消息；未连接时输入禁用。每台设备由 `identity.ts` 生成唯一持久 ID + 昵称（听友XXXX）。
- **同步不同步进度**：只同步「队列快照 + 当前歌曲」，各端收到 `track:update` 后从头播放，天然对齐，服务端压力恒定。
- **频道由设置统一调控**：在线频道与一起听共用同一条 WS 连接，开关就是设置里的「一起听同步」。
- **队列消耗式推进**：播完自动出队；有置顶曲时切歌直接从置顶第一首播；仅剩一首播完则清空队列并停止。

---

## 三、完整文件地图（二次开发从这里找文件）

### 客户端（根目录）

```
├── index.html                  # HTML 入口（标题/图标/meta）
├── vite.config.ts              # Vite 配置
├── tsconfig.json / tsconfig.node.json
├── capacitor.config.ts         # Capacitor 配置（appId com.syncwave.app）
├── package.json                # 前端依赖与脚本
├── android/                    # Capacitor Android 原生工程（Gradle 打包）
│   └── app/src/main/
│       ├── AndroidManifest.xml
│       ├── res/xml/network_security_config.xml   # 自签证书信任 + 明文策略
│       └── res/raw/sync_cert.pem                 # 内嵌同步服务端自签 CA
├── public/                     # 静态资源（logo.svg 等）
├── src/
│   ├── main.tsx / App.tsx      # 入口与主页面组装（三栏 + 弹层 + useSync 桥接）
│   ├── App.css / index.css     # 全局样式（含主题变量引用）
│   ├── styles/themes.css       # 主题变量（黑白 + 炫彩）
│   ├── types/index.ts          # 全部 TS 类型定义（Track/QueueItem/ChatMessage/User…）
│   ├── data/mock.ts            # 内置 Mock 曲库（三级降级兜底）
│   ├── components/
│   │   ├── Header.tsx          # 顶栏：频道入口（真实未读徽标）/ 已听时长 / 设置
│   │   ├── TabBar.tsx          # 推荐/搜索/队列 三栏切换
│   │   ├── tabs/RecommendTab.tsx  # 每日推荐 + 歌单
│   │   ├── tabs/SearchTab.tsx     # 搜索
│   │   ├── tabs/QueueTab.tsx      # 播放队列（播放/置顶/清除/消耗式空态）
│   │   ├── PlayerBar.tsx       # 底部播放条（进度/控制）
│   │   ├── LyricsPanel.tsx     # 歌词页（旋转唱片/逐行高亮/点击跳转/分享到频道）
│   │   ├── ChatPanel.tsx       # 在线频道（仅真实成员，未连接禁言）
│   │   ├── SettingsPanel.tsx   # 设置中心（音质/主题/酷狗Token/一起听同步/公网地址）
│   │   └── Logo.tsx
│   ├── store/
│   │   ├── player.ts           # 队列/播放核心：advance() 消耗式推进纯函数 + 远端应用
│   │   ├── chat.ts             # 频道消息：服务端广播为准、去重、未读、断开清空
│   │   ├── settings.ts         # 设置持久化（localStorage）+ Token 远端应用
│   │   └── theme.ts            # 主题切换
│   ├── services/
│   │   ├── syncService.ts      # WS 客户端：连接/join/重连/心跳 + 事件分发（同步+聊天）
│   │   ├── identity.ts         # 设备唯一 ID/昵称/头像（频道真实身份）
│   │   ├── resilientApi.ts     # 三级降级编排：直连 → 服务端代理 → Mock
│   │   ├── directKugouApi.ts   # 酷狗概念版前端直连（免签通道 + 直链签名）
│   │   ├── httpMusicApi.ts     # 服务端代理 REST 客户端
│   │   ├── musicApi.ts         # 数据源抽象接口
│   │   ├── apiConfig.ts        # 由同步地址推导音乐代理地址（wss→https）
│   │   ├── authApi.ts / qrcode.ts / md5.ts   # 扫码/验证码登录与前端签名
│   │   └── audioPlayer.ts      # 音频引擎（真实 audio + 模拟 tick 双路径）
│   └── hooks/useSync.ts        # 同步桥接：开关连接、远端→store、本地→广播、成员/消息
└── docs/  接口文档/  screenshots/
```

### 服务端（server/）

```
server/
├── package.json                # 唯一运行时依赖 ws；脚本 start/dev/test
├── src/
│   ├── index.js                # 入口：HTTP(S) 监听 8788 + 兼容 6666，优雅退出
│   ├── server.js               # WS 核心：连接/join 鉴权/消息路由/广播/心跳/聊天权威生成
│   ├── room.js                 # 房间状态：队列/当前歌曲/members/聊天历史(环形截断)
│   ├── protocol.js             # 消息常量 MSG + toTrackLite/toQueueLite + send/broadcast
│   ├── musicRoutes.js          # /api/* 音乐代理路由（搜索/榜单/歌词/直链/登录）
│   ├── kugou.js                # 酷狗概念版 API 封装
│   ├── kugouLogin.js           # 扫码/验证码登录代理
│   ├── sign.js / sign.worker.js / signPool.js  # MD5 签名 + worker_threads 线程池
│   ├── cache.js                # LRU+TTL 缓存（搜索5min/榜单15~30min/歌词1h/直链55min）
│   ├── credentials.js          # 酷狗凭据管理（环境变量 > data/credentials.json > 默认）
│   ├── store.js                # Token JSON 持久化（防抖落盘）
│   └── config.js               # 全部配置项（端口/TLS/聊天限制/线程池…）
├── certs/                      # 自签证书 cert.pem / key.pem
├── frpc.toml                   # frp 内网穿透配置（本地 8788/6666 → 公网 57899）
├── data/                       # 运行时生成：tokens.json / credentials.json
├── test/
│   ├── sync.test.js            # 同步协议 8 项（房间/广播/隔离/聊天）
│   └── kugou.test.js           # 音乐代理 5 项
└── README.md                   # 服务端专属文档（部署/协议/frp）
```

---

## 四、文档索引

| 文档 | 说明 |
| --- | --- |
| **[二次开发指南](docs/07-二次开发指南.md)** | 模块职责、数据流、常见改造任务的操作路径与避坑清单 |
| [产品需求文档 PRD](docs/01-PRD-产品需求文档.md) | 产品背景、用户画像、功能需求 |
| [技术架构设计](docs/02-技术架构设计.md) | 技术选型、分层架构、状态管理 |
| [UI/UX 设计规范](docs/03-UIUX设计规范.md) | 视觉规范、配色、组件、主题系统 |
| [数据模型与 API 规划](docs/04-数据模型与API规划.md) | 数据结构、API 抽象层、音乐源适配 |
| [开发路线图](docs/05-开发路线图与迭代计划.md) | 阶段划分、里程碑 |
| [部署与调试指南](docs/06-部署与调试指南.md) | 本地运行、构建、ADB 真机部署、Capacitor 打包 |
| [同步服务端](server/README.md) | 服务端部署、frp 配置、通信协议、测试 |
| [酷狗接口文档](接口文档/API.md) | 音乐数据源实测接口与签名细节 |
| [更新日志](docs/CHANGELOG.md) | 版本变更记录 |

---

## 五、快速开始

### 1. 前端

```bash
npm install
npm run dev        # 本地开发（--host，手机可经 adb reverse 访问）
npm run build      # tsc 类型检查 + 产物构建
```

### 2. 服务端

```bash
cd server
npm install
npm start          # 明文模式，主端口 8788（兼容 6666）
npm test           # 13 项测试（同步 8 + 音乐代理 5）
```

> ⚠️ **不要用 6666 作为 App 直连端口**：Chromium/WebView 把 6665-6669 视为不安全端口（`net::ERR_UNSAFE_PORT`），WebSocket 会被静默拦截。8788 是主端口，6666 仅作 frp 隧道兼容。

### 3. Android 打包

```bash
npm run build && npm run cap:sync
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

本项目自带工具链（免装 Android Studio）：
`tools/jdk21/`、`tools/gradle-8.11.1/`。打包命令示例：

```bash
cd android
export JAVA_HOME="D:/ai项目在这/音乐app/tools/jdk21/jdk-21.0.13+9"
"D:/ai项目在这/音乐app/tools/gradle-8.11.1/bin/gradle" assembleDebug --no-daemon
```

### 4. 真机联通在线频道/一起听

1. 服务端启动（局域网明文 `npm start`，或公网 `TLS_ENABLED=1 npm start` + frpc）。
2. App 设置中心 → 展开公网服务器配置 → 填 `wss://192.168.1.101:8788`（或 frp 公网地址）。
3. 打开「一起听同步」开关 → 状态变「已连接 · X人在线」。
4. 在线频道自动可用：左上角气泡进入，仅显示真实房间成员与发言。

---

## 六、开发原则

1. **精简美观**：单主页面，信息密度克制，动效服务于体验。
2. **性能优先**：轻量依赖（服务端仅 `ws`）、按需加载、多级缓存。
3. **真实数据**：在线频道无机器人、无假消息；数据源三级降级最终兜底 Mock。
4. **文档同步**：每次功能变更同步更新文档与 CHANGELOG。
