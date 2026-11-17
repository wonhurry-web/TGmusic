import type {
  KugouProfile, LyricLine, MusicApi, MusicSource, Playlist, Quality, SearchResult, Track,
} from '../types';
import { coverGradients } from '../data/mock';
import { kugouSign, md5Hex } from './md5';
import { useSettingsStore } from '../store/settings';

/**
 * 酷狗概念版「直连」适配器。
 *
 * 需求：在线曲库直接通过当前个人 token 抓取，不走服务端；除非 token 过期才降级服务端。
 *
 * - 内容接口（搜索/榜单/歌词/封面）走 Web 免签通道 A，纯 GET；
 * - 播放直链走通道 B，前端内置签名算法（md5）用个人凭证签名；
 * - 任何「登录态失效」信号（errcode 30020 / status 异常）→ 标记 token 过期，
 *   由上层工厂切换到服务端代理；网络/CORS 失败也返回 null 触发降级。
 *
 * 注意：浏览器 / WebView 直连酷狗 CDN 可能受 CORS 限制；App 内已开启明文流量。
 * 若上游拒绝跨域，工厂会回退到服务端代理，保证 UI 始终可用。
 */

const WEB = 'https://mobilecdn.kugou.com/api/v3';
const LYRIC = 'https://krcs.kugou.com';
const TRACKER = 'https://trackercdn.kugou.com/v5/url';
const UA = 'Android13-1070-11621-14-0-User-wifi';
const SECRET = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'; // 概念版 gateway 密钥（接口文档公开值）

const QUALITY_MAP: Record<Quality, string> = {
  standard: '128', high: '320', lossless: 'flac', hires: 'high',
};

/** 登录态失效的业务错误码 */
const AUTH_ERROR_CODES = new Set([30020, 30021, 30022, 20010, 20002]);

async function getJson(url: string, timeout = 12000): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: ctl.signal,
      // 直连携带凭据由 URL 参数完成；此处不依赖 cookie
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 检测响应是否为登录态失效，是则标记 token 过期 */
function checkAuth(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  const code = Number(data.errcode ?? data.error_code ?? data.status ?? 0);
  const msg = String(data.errmsg ?? data.error_msg ?? '');
  if (AUTH_ERROR_CODES.has(code) || /登录|login|token|过期|expire/i.test(msg)) {
    useSettingsStore.getState().markKugouExpired();
    return true;
  }
  return false;
}

function profile(): KugouProfile | null {
  const p = useSettingsStore.getState().kugouProfile;
  return p && !p.expired && p.token ? p : null;
}

function coverUrl(template: unknown, size = 240): string {
  if (!template) return '';
  return String(template).replace('{size}', String(size));
}

function fallbackCover(seed: string): string {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return coverGradients[h % coverGradients.length];
}

function toTrack(item: Record<string, unknown>): Track {
  const hash = String(item.hash || item.sqhash || item['320hash'] || '');
  const authors = item.authors as Array<{ author_name?: string }> | undefined;
  const artist = String(
    item.singername || item.author_name || (Array.isArray(authors) && authors[0]?.author_name) || '未知歌手'
  );
  const cover = coverUrl((item.trans_param as Record<string, unknown> | undefined)?.union_cover)
    || fallbackCover(String(item.songname ?? ''));
  return {
    id: hash,
    title: String(item.songname || item.filename || '未知歌曲').replace(/\s*-\s*[^-]+$/, ''),
    artist,
    album: item.album_name ? String(item.album_name) : undefined,
    cover,
    duration: Number(item.duration) || 0,
    source: 'kugou',
    hash,
    '320hash': item['320hash'] ? String(item['320hash']) : undefined,
    sqhash: item.sqhash ? String(item.sqhash) : undefined,
  };
}

/** 用个人凭证构造身份参数（接口文档 2.1） */
function identityParams(p: KugouProfile): Record<string, string> {
  return {
    appid: '3116',
    clientver: '11621',
    plat: '1070',
    channel: '14',
    userid: p.userid || '0',
    mid: p.mid || '',
    dfid: p.dfid || '',
    token: p.token,
    uuid: '-',
    clienttime: String(Math.floor(Date.now() / 1000)),
  };
}

/** base64 歌词在 UTF-8 / GBK 中选中文可读的一种 */
function decodeLrc(content: string): string {
  let buf: Uint8Array;
  try {
    const bin = atob(content || '');
    buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  } catch {
    return '';
  }
  const utf8 = new TextDecoder('utf-8').decode(buf);
  let gbk = '';
  try {
    gbk = new TextDecoder('gbk').decode(buf);
  } catch {
    return utf8;
  }
  const score = (s: string) => {
    let cjk = 0, bad = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      if (c >= 0x4e00 && c <= 0x9fff) cjk++;
      if (c === 0xfffd || (c >= 0x00c0 && c <= 0x00ff)) bad++;
    }
    return cjk - bad * 3;
  };
  return score(gbk) > score(utf8) ? gbk : utf8;
}

function parseLrc(text: string): LyricLine[] {
  const result: LyricLine[] = [];
  const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of String(text || '').split(/\r?\n/)) {
    tagRe.lastIndex = 0;
    const tags = [...line.matchAll(tagRe)];
    if (!tags.length) continue;
    const content = line.replace(tagRe, '').trim();
    if (!content) continue;
    for (const m of tags) {
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      result.push({
        time: Math.round((Number(m[1]) * 60 + Number(m[2]) + frac) * 10) / 10,
        text: content,
      });
    }
  }
  result.sort((a, b) => a.time - b.time);
  return result.filter((l, i) => i === 0 || l.time !== result[i - 1].time || l.text !== result[i - 1].text);
}

class DirectKugouApi implements MusicApi {
  readonly source: MusicSource = 'kugou';

  /** 无有效凭证：交给工厂走服务端 */
  private ready(): KugouProfile | null {
    return profile();
  }

  async getPlaylists(limit = 20): Promise<Playlist[]> {
    if (!this.ready()) throw new Error('NO_TOKEN');
    const j = await getJson(`${WEB}/rank/list?version=8000&plat=0`);
    if (checkAuth(j) || !j) throw new Error('UPSTREAM');
    const list = (j.data as Record<string, unknown> | undefined)?.list;
    if (!Array.isArray(list)) throw new Error('EMPTY');
    return list.slice(0, limit).map((rank) => {
      const r = rank as Record<string, unknown>;
      return {
        id: `rank-${r.rankid}`,
        rankId: Number(r.rankid),
        name: String(r.rankname || '榜单'),
        cover: coverUrl(r.imgurl) || fallbackCover(String(r.rankname)),
        description: String(r.intro || '酷狗榜单'),
        trackCount: Number(r.songcount) || 0,
        source: 'kugou' as MusicSource,
        tracks: [],
      } as Playlist;
    });
  }

  async getDailyRecommend(): Promise<Track[]> {
    if (!this.ready()) throw new Error('NO_TOKEN');
    const j = await getJson(`${WEB}/rank/song?rankid=8888&page=1&pagesize=30&version=8000`);
    if (checkAuth(j) || !j) throw new Error('UPSTREAM');
    const info = (j.data as Record<string, unknown> | undefined)?.info;
    if (!Array.isArray(info)) throw new Error('EMPTY');
    return (info as Record<string, unknown>[]).map(toTrack);
  }

  async getTracks(rankId: number, page = 1, pagesize = 30): Promise<Track[]> {
    if (!this.ready()) throw new Error('NO_TOKEN');
    const j = await getJson(`${WEB}/rank/song?rankid=${rankId}&page=${page}&pagesize=${pagesize}&version=8000`);
    if (checkAuth(j) || !j) throw new Error('UPSTREAM');
    const info = (j.data as Record<string, unknown> | undefined)?.info;
    if (!Array.isArray(info)) return [];
    return (info as Record<string, unknown>[]).map(toTrack);
  }

  async search(keyword: string, type = 'song'): Promise<SearchResult> {
    if (!this.ready()) throw new Error('NO_TOKEN');
    const q = keyword.trim();
    if (!q) return { songs: [], playlists: [], artists: [] };
    if (type === 'playlist') {
      const j = await getJson(`${WEB}/search/special?keyword=${encodeURIComponent(q)}&page=1&pagesize=20&version=8000`);
      if (checkAuth(j) || !j) throw new Error('UPSTREAM');
      const info = (j.data as Record<string, unknown> | undefined)?.info;
      const playlists = Array.isArray(info)
        ? (info as Record<string, unknown>[]).map((pl) => ({
            id: String(pl.specialid),
            name: String(pl.specialname || '歌单'),
            cover: coverUrl(pl.imgurl) || fallbackCover(String(pl.specialname)),
            description: String(pl.intro || ''),
            trackCount: Number(pl.songcount) || 0,
            source: 'kugou' as MusicSource,
            tracks: [],
          }))
        : [];
      return { songs: [], playlists, artists: [] };
    }
    const j = await getJson(
      `${WEB}/search/song?keyword=${encodeURIComponent(q)}&page=1&pagesize=30&showtype=1&version=8000`
    );
    if (checkAuth(j) || !j) throw new Error('UPSTREAM');
    const info = (j.data as Record<string, unknown> | undefined)?.info;
    if (!Array.isArray(info)) throw new Error('EMPTY');
    return { songs: (info as Record<string, unknown>[]).map(toTrack), playlists: [], artists: [] };
  }

  async getPlayUrl(track: Track | string, quality: Quality): Promise<string> {
    const p = this.ready();
    if (!p) throw new Error('NO_TOKEN');
    const t = typeof track === 'string' ? { id: track } as Track : track;
    const hash = t.hash || t.id;
    if (!hash) throw new Error('NO_HASH');

    const params: Record<string, string> = {
      ...identityParams(p),
      hash,
      quality: QUALITY_MAP[quality] || '320',
      pid: '2',
      pidversion: '2',
      cmd: '25',
      behavior: 'play',
      key: md5Hex(hash),
    };
    params.signature = kugouSign(params, SECRET, '');
    const u = new URL(TRACKER);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const j = await getJson(u.toString(), 15000);
    if (checkAuth(j) || !j) throw new Error('UPSTREAM');
    const url = j.url;
    if (Array.isArray(url) && url.length) return String(url[0]);
    throw new Error('NO_URL');
  }

  async getLyrics(track: Track | string): Promise<LyricLine[]> {
    if (!this.ready()) throw new Error('NO_TOKEN');
    const t = typeof track === 'string' ? { id: track } as Track : track;
    const hash = t.hash || t.id;
    const durationMs = Math.round((t.duration || 0) * 1000);
    const s = new URL(`${LYRIC}/search`);
    s.searchParams.set('ver', '1');
    s.searchParams.set('man', 'no');
    s.searchParams.set('client', 'pc');
    s.searchParams.set('hash', hash);
    if (durationMs) s.searchParams.set('duration', String(durationMs));
    const sj = await getJson(s.toString());
    if (!sj) throw new Error('UPSTREAM');
    const cand = (sj.candidates as Array<Record<string, unknown>> | undefined)?.[0];
    if (!cand) throw new Error('NO_LYRIC');
    const d = new URL(`${LYRIC}/download`);
    d.searchParams.set('ver', '1');
    d.searchParams.set('client', 'pc');
    d.searchParams.set('id', String(cand.id));
    d.searchParams.set('accesskey', String(cand.accesskey));
    d.searchParams.set('fmt', 'lrc');
    d.searchParams.set('charset', 'utf8');
    const dj = await getJson(d.toString());
    if (!dj) throw new Error('UPSTREAM');
    const lines = parseLrc(decodeLrc(String(dj.content || '')));
    if (!lines.length) throw new Error('EMPTY');
    return lines;
  }
}

export const directKugouApi = new DirectKugouApi();
export default directKugouApi;
