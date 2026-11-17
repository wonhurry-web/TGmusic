import type {
  LyricLine, MusicApi, MusicSource, Playlist, Quality, SearchResult, Track,
} from '../types';
import { mockApi } from './musicApi';
import { directKugouApi } from './directKugouApi';
import httpMusicApi from './httpMusicApi';
import { useSettingsStore } from '../store/settings';

/**
 * 弹性数据源：实现「个人 token 直连优先，失败降级服务端，再降级 Mock」。
 *
 * - 有 token 且未过期：先 directKugouApi（前端直连，不经服务端）；
 * - 直连抛错（登录态失效 / 网络 / CORS）：服务端代理（携带个人凭证头）；
 * - 服务端也失败：内置曲库 Mock，保证 UI 永不空白。
 *
 * 这样满足需求：在线曲库默认直接抓取；仅当 token 过期/直连不可用时才回退服务端。
 */

function hasValidToken(): boolean {
  const p = useSettingsStore.getState().kugouProfile;
  return Boolean(p && !p.expired && p.token);
}

function onlineEnabled(): boolean {
  return useSettingsStore.getState().liveApi;
}

class ResilientApi implements MusicApi {
  readonly source: MusicSource = 'kugou';

  /** 依次尝试：直连 → 服务端 → Mock */
  private async run<T>(
    direct: () => Promise<T>,
    proxy: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    if (onlineEnabled() && hasValidToken()) {
      try {
        return await direct();
      } catch {
        /* 直连失败（含 token 过期标记）：降级服务端 */
      }
    }
    if (onlineEnabled()) {
      try {
        return await proxy();
      } catch {
        /* 服务端失败：降级 Mock */
      }
    }
    return fallback();
  }

  getPlaylists(limit = 20): Promise<Playlist[]> {
    return this.run(
      () => directKugouApi.getPlaylists(limit),
      () => httpMusicApi.getPlaylists(limit),
      () => mockApi.getPlaylists(limit)
    );
  }

  getDailyRecommend(): Promise<Track[]> {
    return this.run(
      () => directKugouApi.getDailyRecommend(),
      () => httpMusicApi.getDailyRecommend(),
      () => mockApi.getDailyRecommend()
    );
  }

  getTracks(rankId: number, page = 1, pagesize = 30): Promise<Track[]> {
    return this.run(
      () => directKugouApi.getTracks(rankId, page, pagesize),
      () => httpMusicApi.getTracks(rankId, page, pagesize),
      async () => []
    );
  }

  search(keyword: string, type: 'song' | 'artist' | 'playlist' = 'song'): Promise<SearchResult> {
    return this.run(
      () => directKugouApi.search(keyword, type),
      () => httpMusicApi.search(keyword, type),
      () => mockApi.search(keyword, type)
    );
  }

  getPlayUrl(track: Track | string, quality: Quality): Promise<string> {
    return this.run(
      () => directKugouApi.getPlayUrl(track, quality),
      () => httpMusicApi.getPlayUrl(track, quality),
      () => mockApi.getPlayUrl(track, quality)
    );
  }

  getLyrics(track: Track | string): Promise<LyricLine[]> {
    return this.run(
      () => directKugouApi.getLyrics(track),
      () => httpMusicApi.getLyrics(track),
      () => mockApi.getLyrics(track)
    );
  }
}

export const resilientApi = new ResilientApi();
export default resilientApi;
