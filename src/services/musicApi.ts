import type {
  LyricLine,
  MusicApi,
  MusicSource,
  Playlist,
  Quality,
  SearchResult,
  Track,
} from '../types';
import { mockDaily, mockLyrics, mockPlaylists, mockTracks } from '../data/mock';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/**
 * Mock 音乐 API 实现。
 * 框架阶段所有数据来自本地 Mock；后续接入真实平台时，
 * 新增实现 MusicApi 接口的适配器并在 getMusicApi 工厂中注册即可，UI 无需改动。
 */
class MockMusicApi implements MusicApi {
  readonly source: MusicSource = 'mock';

  async getPlaylists(limit = 20): Promise<Playlist[]> {
    await delay();
    return mockPlaylists.slice(0, limit);
  }

  async getDailyRecommend(): Promise<Track[]> {
    await delay();
    return mockDaily;
  }

  async search(keyword: string, type = 'song'): Promise<SearchResult> {
    await delay();
    const kw = keyword.trim().toLowerCase();
    if (!kw) return { songs: [], playlists: [], artists: [] };

    const songs = mockTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(kw) ||
        t.artist.toLowerCase().includes(kw) ||
        (t.album ?? '').toLowerCase().includes(kw)
    );
    const playlists = mockPlaylists.filter(
      (p) => p.name.toLowerCase().includes(kw) || (p.description ?? '').toLowerCase().includes(kw)
    );
    const artistNames = Array.from(new Set(songs.map((s) => s.artist)));
    const artists = artistNames.map((name, i) => ({
      id: `ar-${i}`,
      name,
      cover: mockTracks.find((t) => t.artist === name)?.cover ?? '',
    }));

    if (type === 'song') return { songs, playlists: [], artists: [] };
    if (type === 'playlist') return { songs: [], playlists, artists: [] };
    return { songs: [], playlists: [], artists };
  }

  async getPlayUrl(_track: Track | string, _quality: Quality): Promise<string> {
    await delay(60);
    // Mock 无真实音频；真实播放地址由 HttpMusicApi 通过服务端代理获取
    return '';
  }

  async getLyrics(track: Track | string): Promise<LyricLine[]> {
    await delay(80);
    const id = typeof track === 'string' ? track : track.id;
    return mockLyrics[id] ?? [{ time: 0, text: '这首歌暂无歌词' }];
  }
}

/** Mock 单例 */
export const mockApi = new MockMusicApi();

const registry = new Map<MusicSource, MusicApi>();
registry.set('mock', mockApi);

/**
 * 数据源工厂（在线曲库）：
 * 返回弹性适配器，内部实现「个人 token 直连优先 → 失败降级服务端代理 → 再降级 Mock」。
 * 直连适配器检测到登录态失效会调用 markKugouExpired()，之后自动走服务端代理，
 * 实现「在线曲库默认直接抓取，除非 token 过期才走服务端」。
 */
let resilientGetter: (() => MusicApi) | null = null;
export function registerResilientApi(getter: () => MusicApi) {
  resilientGetter = getter;
}

export function getMusicApi(_source?: MusicSource): MusicApi {
  return resilientGetter ? resilientGetter() : mockApi;
}

/** 注册自定义适配器（接入新平台时调用） */
export function registerMusicApi(api: MusicApi) {
  registry.set(api.source, api);
}
