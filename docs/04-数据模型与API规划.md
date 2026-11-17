# 数据模型与 API 规划

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 更新日期 | 2026-11-16 |

---

## 1. 设计目标

- 定义统一数据模型，UI 与数据源解耦。
- API 通过抽象层接入，当前 Mock，后续替换为真实音乐 API。
- 预留一起听同步、第三方账号、离线缓存的数据结构。

---

## 2. 核心数据模型（TypeScript）

```ts
// 歌曲
interface Track {
  id: string;
  title: string;        // 歌名
  artist: string;       // 歌手
  album?: string;       // 专辑
  cover: string;        // 封面 URL
  duration: number;     // 时长（秒）
  source: MusicSource;  // 来源平台
  url?: string;         // 播放地址（按音质）
}

// 歌单
interface Playlist {
  id: string;
  name: string;
  cover: string;
  description?: string;
  trackCount: number;
  tracks: Track[];
  source: MusicSource;
}

// 音乐来源
type MusicSource = 'netease' | 'qq' | 'kugou' | 'migu' | 'local' | 'mock';

// 音质
type Quality = 'standard' | 'high' | 'lossless' | 'hires';

// 队列项
interface QueueItem {
  id: string;
  track: Track;
  addedBy: string;      // 添加者
  pinned: boolean;      // 是否置顶
  addedAt: number;      // 时间戳
}

// 频道消息
interface ChatMessage {
  id: string;
  channelId: string;
  sender: User;
  type: 'text' | 'emoji' | 'track';
  content: string;
  track?: Track;        // 歌曲卡片消息
  timestamp: number;
}

// 用户
interface User {
  id: string;
  nickname: string;
  avatar: string;
  accounts?: ThirdPartyAccount[];
}

// 第三方账号
interface ThirdPartyAccount {
  provider: MusicSource;
  accountId: string;
  bound: boolean;
}

// 设置
interface Settings {
  quality: Quality;
  theme: 'light' | 'dark' | 'colorful';
  accounts: ThirdPartyAccount[];
  frpSync: boolean;
  offlineMode: boolean;
}
```

---

## 3. API 抽象层

### 3.1 音乐 API 接口

```ts
/** 歌词行：time 为该行起始秒数 */
interface LyricLine {
  time: number;
  text: string;
}

interface MusicApi {
  /** 获取推荐歌单 */
  getPlaylists(limit?: number): Promise<Playlist[]>;
  /** 获取每日推荐 */
  getDailyRecommend(): Promise<Track[]>;
  /** 搜索 */
  search(keyword: string, type?: 'song' | 'artist' | 'playlist'): Promise<SearchResult>;
  /** 获取播放地址（按音质） */
  getPlayUrl(trackId: string, quality: Quality): Promise<string>;
  /** 获取歌词（带时间戳，逐行） */
  getLyrics(trackId: string): Promise<LyricLine[]>;
}
```

- 当前实现：`MockMusicApi`（返回本地 Mock 数据）。
- 后续实现：`NeteaseMusicApi`、`QQMusicApi` 等适配器。
- 通过工厂统一获取：`getMusicApi(source)`。

### 3.2 聊天服务接口

```ts
interface ChatService {
  getMessages(channelId: string): Promise<ChatMessage[]>;
  sendMessage(msg: ChatMessage): Promise<void>;
  onMessage(callback: (msg: ChatMessage) => void): () => void;
}
```

- 当前实现：`MockChatService`（本地消息列表，模拟回复）。
- 后续实现：基于 WebSocket / FRP 的实时服务。

### 3.3 同步服务接口（预留）

```ts
interface SyncService {
  connect(config: FrpConfig): Promise<void>;
  disconnect(): void;
  syncState(state: SyncState): Promise<void>;
  onStateUpdate(cb: (state: SyncState) => void): () => void;
}
```

---

## 4. 接入点清单

| 功能 | 当前 | 接入点 | 后续动作 |
| --- | --- | --- | --- |
| 推荐歌单 | Mock | `services/musicApi.ts` | 实现 `NeteaseMusicApi` 等适配器 |
| 每日推荐 | Mock | 同上 | 同上 |
| 搜索 | Mock | 同上 | 同上 |
| 播放地址 | Mock | `getPlayUrl()` | 接入音质源 |
| 歌词 | Mock（按歌曲时长生成时间戳） | `getLyrics()` | 接入真实 LRC 歌词解析 |
| 群聊 | Mock | `services/chatService.ts` | 接入 WebSocket |
| 一起听同步 | 预留 | `services/syncService.ts` | 接入 FRP |
| 第三方账号 | UI 入口 | `useSettingsStore` | 接入 OAuth / API |
| 离线缓存 | 预留 | `services/cache.ts`（待建） | 接入本地文件缓存 |

---

## 5. 音乐 API 适配策略

- **适配器模式**：每个平台实现 `MusicApi` 接口，统一输出内部数据模型。
- **聚合层**：推荐页并行请求多平台，合并去重后展示。
- **降级**：某平台失败时跳过，不影响其他来源。
- **音质映射**：内部 `Quality` 映射到各平台的音质参数。
- **合规**：接入时遵循各平台服务条款，当前阶段仅用 Mock 数据。

---

## 6. 持久化方案

| 数据 | 存储方式 |
| --- | --- |
| 主题偏好 | localStorage |
| 音质设置 | localStorage |
| 开关状态（FRP/离线） | localStorage |
| 已听时长 | localStorage（累计 + 按日） |
| 队列 | localStorage（可选持久化） |
| 第三方账号 token | Capacitor Preferences（后续） |

---

## 7. Mock 数据说明

- 位置：`src/data/mock.ts`
- 内容：示例歌单、歌曲、日推、聊天消息、用户。
- 封面使用占位图（gradient / data URI），避免外链依赖。
- 框架阶段所有服务返回 Mock，保证界面可完整交互。
