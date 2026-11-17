# 更新日志（CHANGELOG）

本项目所有重要变更记录于此。格式遵循「保持更新、方便追溯」原则。

---

## [0.4.2] — 2026-11-17 — 在线频道真实化 + 服务端口迁移 + 项目文档整理

### Changed
- **在线频道去机器人、只显示真实用户**（需求 2）
  - 服务端：删除 Token 无关改动后新增聊天协议 `chat:send` / `chat:message`（`protocol.js` + `server.js onChatSend`）；消息由**服务端权威生成**，sender 取自 join 时登记的真实用户，客户端无法伪造身份；每房间历史环形保留 100 条（`MAX_CHAT_HISTORY`），单条 ≤500 字符、最小间隔 250ms（`CHAT_TOO_FAST`）；加入房间时随 `room:state` 下发历史。
  - 客户端：`store/chat.ts` 重写为「只信服务端广播」，不做本地乐观插入、无机器人回复；未连接时输入禁用并提示到设置开启。`ChatPanel` 空态引导真实加入；Header 未读徽标改为真实未读计数（假徽标消失）。
  - **设备身份**：新增 `src/services/identity.ts`——每台设备生成一次持久唯一 ID（`u-xxx`）+ 昵称（听友XXXX）+ 稳定渐变头像，多人不撞 ID。
  - **统一调控**：频道与一起听共用同一条 WS 连接，开关即设置中心「一起听同步」；`useSync` 接线 chat 事件与断开清空。
  - 清理 `data/mock.ts` 中的假成员/假消息/假队列，频道数据全部来自服务端。
- **服务端主端口 6666 → 8788**
  - 根因：Chromium/WebView 把 6665-6669 视为不安全端口（IRC 段），App 内 WS 直连 6666 报 `net::ERR_UNSAFE_PORT`（CDP `Network.loadingFailed` 实锤）。
  - `config.js`：`port` 默认 8788；新增 `legacyPort`（默认仍监听 6666，`LEGACY_PORT=0` 关闭）兼容既有 frp 隧道；`index.js` 双监听。
  - `network_security_config.xml`：自签 CA 信任锚上移到 `base-config`，覆盖「IP 直连」场景（此前仅 domain-config 导致 IP 访问不信任）。

### Fixed
- TLS 模式下手机直连 `wss://192.168.1.101:8788` 握手失败：base-config 信任锚修正后解决。
- 6666 端口 WebView 静默拦截问题：迁移主端口后端到端连通。

### Verified
- 服务端 13 项测试全过（同步 8：房间/广播/隔离/**聊天收发**；音乐代理 5）。
- 真机实测：手机以「听友9153」身份连接 `wss://192.168.1.101:8788` → 状态「已连接 · 1人在线」；电脑端测试客户端入房发消息，手机频道实时收到并显示真实昵称与内容；手机端回发消息成功（单机单账号验证收发链路）。
- 前端 `npm run build` 通过；Gradle BUILD SUCCESSFUL，APK 已装真机。

### Docs
- 新增 `docs/07-二次开发指南.md`：环境准备、客户端/服务端模块职责与数据流、6 类常见改造任务操作路径、9 条避坑清单、测试与回归清单。
- 重写根 `README.md`：架构图、**完整文件地图**（客户端 + 服务端逐文件职责）、快速开始（含内置 JDK/Gradle 工具链命令）。
- 重写 `server/README.md`：端口说明（8788 主 + 6666 兼容）、聊天协议章节、目录与测试数量更新。
- 清理调试临时脚本（`server/cdp*.mjs`、`chat-verify.mjs`）。

---

## [0.4.1] — 2026-11-17 — 首页精简 + 播放队列消耗式推进

### Changed
- **推荐页去掉顶部品牌头图**：移除「一起听 / 同一首歌，此刻共享」整块 banner（含 Logo、Sparkles 与 `.brand-banner` 样式），把首屏空间让给「每日推荐」。推荐页补 `padding-top` 保持顶部呼吸感。
- **播放队列改为消耗式推进**（需求 2）
  - 歌曲播完（真实音频 `ended` 与无音频的模拟 tick 两条路径）统一调用 `advance()`：**已播曲目自动出队**，队列不再无限堆积。
  - **置顶优先**：剩余队列存在置顶曲时，切下一首直接从置顶第一首开始播（KTV 插播语义）。
  - 无置顶时按原顺序播下一首，队尾环回队首；最后一首播完时队列清空（显示空态），播放条保留该曲、进度归零并停止，避免播放条空悬或 `currentTrack` 悬空崩溃。
  - 手动「下一首」与自动切歌共用同一策略；「上一首」修正为队首→队尾环回。
  - `playTrack` 在曲目不在队列时自动入队，保证播放顺序可确定、已播曲可被清除。

### Verified
- 推进策略 9 项纯函数用例全部通过（中/首/尾曲出队、置顶优先、仅剩一首停止、当前曲不在队列、空队列）。
- `npm run build` 通过（JS gzip 76.5KB / CSS gzip 6.84KB）。

---

## [0.4.0] — 2026-11-17 — 个人 Token 直连改造 + 品牌更名

### Changed（大刀阔斧）
- **软件更名**：「同频 SyncWave」→「一起听」；Logo 改为黑底银色音符 +「一起听」字样。
  - 同步更新 `index.html`、`capacitor.config.ts`、Android `strings.xml`（app_name）、launcher 图标、`public/logo.svg`。
  - 首页移除「同频 · SyncWave」品牌标语；聊天面板「同频房间」→「一起听房间」。
- **设置中心第三方挂载 → 酷狗概念版个人 Token**（需求 1）
  - 提供三种获取方式：扫码登录（二维码本地生成 + 轮询）、手机号验证码登录、手动填入凭证（JSON / key=value / 纯 token）。
  - 服务端新增登录代理 `/api/login/qr/key` `/api/login/qr/check` `/api/login/sms/send` `/api/login/sms/verify`（`server/src/kugouLogin.js`）。
  - 「上传共享」把个人 Token 同步给一起听房间好友；「同步 Token」从服务端拉取。
- **在线曲库改为个人 Token 直连优先**（需求 2 / 5）
  - 新增 `directKugouApi.ts`：前端直连酷狗概念版 Web 免签通道 + 播放直链签名通道，内置纯前端 MD5（`md5.ts`）。
  - 新增 `resilientApi.ts`：直连成功直接用当前个人 Token；检测到登录态失效（`markKugouExpired`）或网络失败才降级服务端代理，再降级内置曲库。
  - 服务端代理支持通过 `x-kg-token/userid/mid/dfid` 请求头使用 App 上传的个人凭证签名直链。
  - 首页 / 搜索 / 歌词 / 播放统一走弹性数据源，全部由个人 Token 驱动。
- **同步配置改用公网 IP**（需求 3）：默认地址占位 `ws://YOUR_PUBLIC_IP:57899`，设置项标注 frp 公网映射端口 57899。
- **移除离线模式**（需求 4）：删除 `offlineMode` 及设置中心开关。

### Added
- `src/services/qrcode.ts`：零依赖 QR Code 生成器（byte 模式，纠错 L，版本 1~10），用于扫码登录二维码本地渲染。

### Fixed
- 数据源工厂解耦为弹性适配器，避免直连与服务端代理顶层循环依赖。

---

## [0.3.0] — 2026-11-17 — 真实音乐 API 接入 + 多线程优化 + 真机部署

### Added
- **服务端酷狗 API 代理**（`server/src/kugou.js` + `musicRoutes.js`）
  - 免签通道：歌曲搜索（song）/ 歌单搜索（special）/ 榜单列表与歌曲 / 歌词检索与下载 / 封面
  - 播放直链通道：`trackercdn/v5/url`，gateway MD5 签名 + `key=md5(hash)`
  - 原始数据映射为 App 的 Track/Playlist/LyricLine 模型；LRC 解析（UTF-8/GBK 自动识别）
  - HTTP API：`/api/search` `/api/playlists` `/api/daily` `/api/tracks` `/api/lyrics` `/api/playurl` `/api/health`
  - 音乐代理复用同步服务端口（6666/frp 57899），App 只需配一个服务端地址
- **鉴权参数配置化**（`server/src/credentials.js`）
  - 酷狗设备身份（appid/clientver/plat/channel/userid/mid/dfid/token/uuid）与签名密钥集中管理
  - 优先级：环境变量 > `data/credentials.json` > 文档默认值；`/api/health` 返回脱敏视图
  - 应用鉴权 `APP_TOKEN` 对 HTTP API 与 WebSocket 双向生效（header `x-app-token`）
- **多线程优化**
  - 服务端 `worker_threads` 签名线程池（默认按 CPU 核数，上限 8）：批量 MD5 签名并行计算，主线程专注 I/O，worker 超时/异常自动降级主线程
  - 服务端 LRU + TTL 缓存（搜索/榜单/歌词/直链），直链缓存 55min（< 2h 时效）
  - App 端 `audioPlayer`：直链 URL 缓存 + 预取去重（并发 Promise 合并）+ 下一首预取
- **App 端真实播放**
  - `services/httpMusicApi.ts`：走服务端代理，任何失败自动降级 Mock，UI 永不空白
  - `services/audioPlayer.ts`：HTMLAudioElement 真实播放，进度由 `timeupdate` 驱动（真实时间），切歌/暂停/拖动/音质切换全打通
  - `settings` 新增 `liveApi` 在线曲库开关；设置中心新增数据源开关
  - Track 模型新增酷狗 hash 字段
- **Android 真机部署支持**
  - AndroidManifest 增加明文流量许可（`usesCleartextTraffic` + `network_security_config`，局域网服务端与 http CDN 直链所需）
  - 增加网络状态/唤醒锁/前台服务权限
  - 本地化构建工具链：独立 Gradle 8.11.1 + Temurin JDK 17（置于 `tools/`，不污染系统）

### Verified
- 服务端 `npm test`：10/10 通过（含签名算法、LRC 解析、LRU 缓存、多线程签名池一致性、5 项同步协议）
- 歌词接口真机实测：命中 krcs.kugou.com，返回《晴天》真实逐行歌词
- App `npm run build` 通过：JS gzip 68KB / CSS gzip 6KB
- `cap sync android` 成功，新 API 代码已打入 assets

### Note
- 沙箱网络对 `mobilecdn.kugou.com` 不通，搜索/榜单/直链在**本机**返回 `ok:false` 并自动降级 Mock；真机联网环境走真实数据
- 酷狗凭据来自接口文档实测值，换账号/设备改 `data/credentials.json` 即可

---

## [0.2.0] — 2026-11-17 — 一起听同步服务端

### Added
- `server/` 独立同步服务端（Node.js + ws，唯一依赖，极轻量）
  - HTTP 健康检查 + WebSocket 服务，监听 127.0.0.1:6666
  - 房间管理（Room/RoomManager）：成员、队列、当前歌曲、共享 token
  - 队列全量快照广播（添加/删除/切歌/置顶），服务端无复杂 diff，压力低
  - 当前歌曲轻量同步：**只发歌曲元数据，不同步播放进度**
  - token 上传/拉取 + JSON 防抖持久化（data/tokens.json）
  - 应用鉴权 token（APP_TOKEN）、心跳检测、房间隔离、成员上限
  - frpc.toml（music/tcp/6666→57899）+ 完整协议文档 README
  - 5 项自动化测试（node:test）全部通过
- App 端同步接入：
  - `services/syncService.ts` 单例 WebSocket 客户端（自动重连、事件订阅）
  - `hooks/useSync.ts` 桥接：开关连接、远端状态应用（抑制回环）、本地队列/歌曲变化自动同步
  - `player` store 新增 applyRemoteQueue / applyRemoteTrack（不打断本地进度）
  - `settings` store 新增服务器地址/房间号/鉴权 token/远端 token 应用
  - 设置中心：连接状态、在线成员、服务器配置面板、Token 上传/同步按钮

### Verified
- 服务端 `npm test`：5/5 通过（加入、队列广播不回环、歌曲轻量化、token 共享持久化、房间隔离）
- 服务端 `npm start`：健康检查 200，127.0.0.1:6666 监听
- 端到端演示：两客户端队列/歌曲/token 同步全部成功，歌曲确认无进度字段
- App `npm run build` 通过：JS gzip 65KB / CSS gzip 6KB

---

## [0.1.1] — 2026-11-16 — 歌词功能

### Added
- 歌词数据模型 `LyricLine` 与 `MusicApi.getLyrics()` 抽象层方法
- 12 首歌曲的 Mock 歌词库，按歌曲时长自动生成时间轴
- 歌词面板 `LyricsPanel`：点击底部播放条当前歌曲封面/歌名打开
  - 随封面渐变的毛玻璃背景 + 黑胶唱片旋转动画 + 唱臂
  - 逐行歌词随播放进度高亮放大并自动滚动居中
  - 点击歌词行跳转播放进度
  - 分享到频道、进度拖动、播放/暂停、上下曲
- 原播放条"点击分享"入口移入歌词面板内

### Verified
- `npm run build` 通过：JS gzip 63KB / CSS gzip 6KB
- 歌词面板截图验证：背景不透出、歌词清晰、唱片与高亮正常

---

## [0.1.0] — 2026-11-16 — Phase 1 主框架搭建 ✅

### Added
- Vite 6 + React 18 + TypeScript + Zustand + lucide-react 项目脚手架
- 单主页面框架：顶部栏（在线频道聊天气泡 + 已听时长 + 设置入口）
- 三栏切换（推荐 / 搜索 / 队列），支持点击与左右滑动
- 推荐栏：品牌头图 + 每日推荐（8 首）+ 推荐歌单（4 个），数据来自 MusicApi 抽象层（Mock）
- 搜索栏：热词搜索 + 结果列表（歌曲/歌手/歌单）
- 队列栏：KTV 式列表，支持添加播放、切歌、置顶、取消置顶、移除
- 底部播放条：进度拖动、播放/暂停、上下曲、时长显示、一键分享到频道
- 设置中心抽屉：音质切换（4 档）、第三方账号挂载（4 平台）、主题切换、FRP 同步开关、离线开关
- 在线频道群聊面板：文本/表情/歌曲卡片消息、模拟回复、未读角标
- 主题系统：浅色 / 深色 / 炫彩三套 CSS 变量主题，即时切换 + localStorage 持久化
- 黑底银色音符 Logo（SVG，组件 + public 静态资源）
- 播放进度与已听时长每秒累加并持久化
- Capacitor 7 Android 平台配置（包名 com.syncwave.app）
- 完整项目文档体系（README + 6 份专项文档）

### Verified
- `npm run build` 通过：JS gzip 59KB / CSS gzip 5KB（轻量）
- adb 设备 4098fa0e 已连接；`adb reverse tcp:5173 tcp:5173` 端口转发返回 HTTP 200，真机调试链路实测可用
- UI 在移动视口与桌面居中视口均完整显示，无溢出

### Next（Phase 2+）
- 炫彩主题光效与微交互打磨
- 接入真实音乐 API（多源聚合、日推、音质播放地址）
- 群聊接入 WebSocket + FRP 同步（一起听核心）
- 第三方账号 OAuth 挂载、离线缓存
- Android SDK 环境配置后打包 APK

---

*版本说明：主版本号.次版本号.修订号。Phase 阶段对应次版本号递增。*
