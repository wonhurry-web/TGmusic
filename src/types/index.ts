/** 音乐来源平台 */
export type MusicSource = 'netease' | 'qq' | 'kugou' | 'migu' | 'local' | 'mock';

/** 音质等级 */
export type Quality = 'standard' | 'high' | 'lossless' | 'hires';

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'colorful';

/** 栏目 */
export type TabKey = 'recommend' | 'search' | 'queue';

/** 歌曲 */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover: string; // CSS 渐变字符串或图片 URL
  duration: number; // 秒
  source: MusicSource;
  url?: string;
  // 酷狗播放直链所需（其余平台可忽略）
  hash?: string;
  '320hash'?: string;
  sqhash?: string;
  rankId?: number;
}

/** 歌单 */
export interface Playlist {
  id: string;
  name: string;
  cover: string;
  description?: string;
  trackCount: number;
  tracks: Track[];
  source: MusicSource;
}

/** 队列项 */
export interface QueueItem {
  id: string;
  track: Track;
  addedBy: string;
  pinned: boolean;
  addedAt: number;
}

/** 用户 */
export interface User {
  id: string;
  nickname: string;
  avatar: string; // CSS 渐变
}

/** 消息类型 */
export type MessageType = 'text' | 'emoji' | 'track';

/** 频道消息 */
export interface ChatMessage {
  id: string;
  channelId: string;
  sender: User;
  type: MessageType;
  content: string;
  track?: Track;
  timestamp: number;
  self?: boolean;
}

/** 第三方账号（token 平时保存在本地，可上传共享给好友） */
export interface ThirdPartyAccount {
  provider: MusicSource;
  label: string;
  accountId: string;
  bound: boolean;
  token?: string;
}

/** 酷狗概念版个人凭证（由手机号/扫码登录或手动填入获得） */
export interface KugouProfile {
  token: string;        // 登录态令牌（128 hex）
  userid: string;       // 账号 UID
  mid: string;          // 设备指纹
  dfid: string;         // 设备指纹（直链绑定）
  nickname?: string;    // 昵称
  vipType?: number;     // 会员类型
  source: 'sms' | 'qr' | 'manual';
  updatedAt: number;    // 获取时间
  expired?: boolean;    // 是否已过期（过期后走服务端代理）
}

/** 设置 */
export interface Settings {
  quality: Quality;
  accounts: ThirdPartyAccount[];
  frpSync: boolean;
}

/** 歌词行：time 为该行起始秒数 */
export interface LyricLine {
  time: number;
  text: string;
}

/** 搜索结果 */
export interface SearchResult {
  songs: Track[];
  playlists: Playlist[];
  artists: { id: string; name: string; cover: string }[];
}

/** 音乐 API 抽象接口（各平台适配器需实现） */
export interface MusicApi {
  getPlaylists(limit?: number): Promise<Playlist[]>;
  getDailyRecommend(): Promise<Track[]>;
  search(keyword: string, type?: 'song' | 'artist' | 'playlist'): Promise<SearchResult>;
  getPlayUrl(track: Track | string, quality: Quality): Promise<string>;
  getLyrics(track: Track | string): Promise<LyricLine[]>;
  readonly source: MusicSource;
}
