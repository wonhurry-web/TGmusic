import type {
  LyricLine, MusicApi, MusicSource, Playlist, Quality, SearchResult, Track,
} from '../types';
import { getApiBaseUrl, getAuthHeaders, getKugouCredentialHeaders, isLiveApiEnabled } from './apiConfig';
import { mockApi } from './musicApi';
import { coverGradients } from '../data/mock';

/**
 * 真实 API 适配器：所有请求走电脑服务端代理（隐藏签名密钥与设备凭据）。
 * 任何失败（网络/上游/鉴权）自动降级到 Mock，保证 UI 始终可用。
 *
 * 端点：
 *  GET /api/search?keyword&type&page&pagesize
 *  GET /api/playlists?limit
 *  GET /api/daily?page
 *  GET /api/tracks?rankId&page&pagesize
 *  GET /api/lyrics?track=<json>
 *  GET /api/playurl?track=<json>&quality
 */
class HttpMusicApi implements MusicApi {
  readonly source: MusicSource = 'kugou';

  private async request<T>(path: string, timeoutMs = 15000): Promise<T | null> {
    if (!isLiveApiEnabled()) return null;
    const base = getApiBaseUrl();
    if (!base) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { ...getAuthHeaders(), ...getKugouCredentialHeaders() },
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.ok) return null;
      return data as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private fallbackGradient(seed: string): string {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return coverGradients[h % coverGradients.length];
  }

  private normalizeTrack(raw: Record<string, unknown>): Track {
    return {
      id: String(raw.id ?? raw.hash ?? ''),
      title: String(raw.title ?? '未知歌曲'),
      artist: String(raw.artist ?? '未知歌手'),
      album: raw.album ? String(raw.album) : undefined,
      cover: String(raw.cover || this.fallbackGradient(String(raw.title ?? ''))),
      duration: Number(raw.duration) || 0,
      source: (raw.source as MusicSource) || 'kugou',
      hash: raw.hash ? String(raw.hash) : undefined,
      '320hash': raw['320hash'] ? String(raw['320hash']) : undefined,
      sqhash: raw.sqhash ? String(raw.sqhash) : undefined,
      rankId: raw.rankId ? Number(raw.rankId) : undefined,
    };
  }

  async getPlaylists(limit = 20): Promise<Playlist[]> {
    const data = await this.request<{ playlists: Record<string, unknown>[] }>(
      `/api/playlists?limit=${limit}`
    );
    if (!data?.playlists?.length) return mockApi.getPlaylists(limit);
    return data.playlists.map((raw) => ({
      id: String(raw.id),
      name: String(raw.name ?? '歌单'),
      cover: String(raw.cover || this.fallbackGradient(String(raw.name))),
      description: raw.description ? String(raw.description) : undefined,
      trackCount: Number(raw.trackCount) || 0,
      source: 'kugou',
      tracks: [],
      rankId: raw.rankId ? Number(raw.rankId) : undefined,
    })) as Playlist[];
  }

  async getDailyRecommend(): Promise<Track[]> {
    const data = await this.request<{ tracks: Record<string, unknown>[] }>('/api/daily?page=1');
    if (!data?.tracks?.length) return mockApi.getDailyRecommend();
    return data.tracks.slice(0, 30).map((t) => this.normalizeTrack(t));
  }

  /** 获取榜单/歌单歌曲（供歌单点击展开用） */
  async getTracks(rankId: number, page = 1, pagesize = 30): Promise<Track[]> {
    const data = await this.request<{ tracks: Record<string, unknown>[] }>(
      `/api/tracks?rankId=${rankId}&page=${page}&pagesize=${pagesize}`
    );
    if (!data?.tracks?.length) return [];
    return data.tracks.map((t) => this.normalizeTrack(t));
  }

  async search(keyword: string, type = 'song'): Promise<SearchResult> {
    const q = keyword.trim();
    if (!q) return { songs: [], playlists: [], artists: [] };
    if (type === 'song') {
      const data = await this.request<{ songs: Record<string, unknown>[] }>(
        `/api/search?keyword=${encodeURIComponent(q)}&type=song&pagesize=30`
      );
      if (!data?.songs?.length) return mockApi.search(q, type);
      return { songs: data.songs.map((t) => this.normalizeTrack(t)), playlists: [], artists: [] };
    }
    if (type === 'playlist') {
      const data = await this.request<{ playlists: Record<string, unknown>[] }>(
        `/api/search?keyword=${encodeURIComponent(q)}&type=playlist&pagesize=20`
      );
      if (!data?.playlists?.length) return mockApi.search(q, type);
      return {
        songs: [],
        playlists: data.playlists.map((raw) => ({
          id: String(raw.id),
          name: String(raw.name ?? '歌单'),
          cover: String(raw.cover || this.fallbackGradient(String(raw.name))),
          description: raw.description ? String(raw.description) : undefined,
          trackCount: Number(raw.trackCount) || 0,
          source: 'kugou' as MusicSource,
          tracks: [],
        })),
        artists: [],
      };
    }
    return mockApi.search(q, type);
  }

  async getPlayUrl(track: Track | string, quality: Quality): Promise<string> {
    const t = typeof track === 'string' ? { id: track } as Track : track;
    const data = await this.request<{ url: string }>(
      `/api/playurl?track=${encodeURIComponent(JSON.stringify(t))}&quality=${quality}`,
      20000
    );
    if (data?.url) return data.url;
    return mockApi.getPlayUrl(typeof track === 'string' ? track : track.id, quality);
  }

  async getLyrics(track: Track | string): Promise<LyricLine[]> {
    const t = typeof track === 'string' ? { id: track } as Track : track;
    const data = await this.request<{ lyrics: LyricLine[] }>(
      `/api/lyrics?track=${encodeURIComponent(JSON.stringify(t))}`
    );
    if (data?.lyrics?.length) return data.lyrics;
    return mockApi.getLyrics(typeof track === 'string' ? track : track.id);
  }
}

export const httpMusicApi = new HttpMusicApi();
export default httpMusicApi;
