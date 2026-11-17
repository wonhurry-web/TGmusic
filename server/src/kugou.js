import credentials from './credentials.js';
import { identityParams } from './sign.js';
import { LruCache } from './cache.js';

const UA = credentials.userAgent;
const BASE = {
  web: 'https://mobilecdn.kugou.com/api/v3',
  lyric: 'https://krcs.kugou.com',
  tracker: 'https://trackercdn.kugou.com/v5/url',
  cover: 'https://imge.kugou.com/stdmusic',
};

const HEADERS = {
  'User-Agent': UA,
  Accept: '*/*',
  Connection: 'keep-alive',
};

// 轻量缓存：搜索/榜单/歌词 TTL 短，直链缓存 1 小时（文档：直链 2~4h 有效）
const cache = new LruCache(500);

/** 带超时的 GET JSON，禁用环境代理（undici 默认不读 env 代理，等价于 requests.trust_env=False） */
async function getJson(url, { timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function coverUrl(template, size = 240) {
  if (!template) return '';
  return String(template).replace('{size}', String(size)).replace(/^https:/, 'http:');
}

/** 生成 CSS 渐变占位封面（无外链时使用） */
function fallbackCover(seed = '') {
  const palettes = [
    'linear-gradient(135deg,#667eea,#764ba2)', 'linear-gradient(135deg,#f093fb,#f5576c)',
    'linear-gradient(135deg,#4facfe,#00f2fe)', 'linear-gradient(135deg,#43e97b,#38f9d7)',
    'linear-gradient(135deg,#fa709a,#fee140)', 'linear-gradient(135deg,#30cfd0,#330867)',
  ];
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palettes[h % palettes.length];
}

/** 酷狗搜索项 → App Track */
function toTrack(item) {
  const hash = String(item.hash || item.sqhash || item['320hash'] || '');
  const cover = coverUrl(item.trans_param?.union_cover, 240) || fallbackCover(item.songname);
  const authors = item.authors;
  const artist = item.singername || item.author_name || (Array.isArray(authors) && authors[0]?.author_name) || '未知歌手';
  return {
    id: hash,
    title: String(item.songname || item.filename || '未知歌曲').replace(/\s*-\s*[^-]+$/, ''),
    artist: String(artist),
    album: String(item.album_name || ''),
    cover,
    duration: Number(item.duration) || 0,
    source: 'kugou',
    hash,
    '320hash': item['320hash'] || '',
    sqhash: item.sqhash || '',
  };
}

/** base64 解码歌词：在 UTF-8 / GBK 中选中文可读的一种（krcs 编码不稳定） */
function decodeLrcContent(content) {
  let buf;
  try {
    buf = Buffer.from(content || '', 'base64');
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
  // 计分：CJK 字符多、替换符 U+FFFD 少、乱码拉丁扩展少者为佳
  const score = (s) => {
    let cjk = 0, bad = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c >= 0x4e00 && c <= 0x9fff) cjk++;
      if (c === 0xfffd || (c >= 0x00c0 && c <= 0x00ff)) bad++;
    }
    return cjk - bad * 3;
  };
  return score(gbk) > score(utf8) ? gbk : utf8;
}

/** 解析 LRC 文本 → [{time,text}] */
export function parseLrc(text) {
  const lines = String(text || '').split(/\r?\n/);
  const result = [];
  const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    tagRe.lastIndex = 0;
    const tags = [...line.matchAll(tagRe)];
    if (!tags.length) continue;
    const content = line.replace(tagRe, '').trim();
    if (!content) continue;
    for (const m of tags) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      result.push({ time: Math.round((min * 60 + sec + frac) * 10) / 10, text: content });
    }
  }
  result.sort((a, b) => a.time - b.time);
  // 去重（同一时间同一文本）
  return result.filter((l, i) => i === 0 || l.time !== result[i - 1].time || l.text !== result[i - 1].text);
}

/**
 * 酷狗 API 客户端。
 * 免签通道（搜索/榜单/歌词）直接请求；播放直链通道由外部注入的 signer 提供签名。
 */
export class KugouClient {
  constructor(signer, cred = credentials) {
    this.signer = signer; // { sign(params, secret, body), md5(text) }
    this.cred = cred; // 每次请求可注入 App 上传的个人凭证（token 过期降级时用）
  }

  async search(keyword, { page = 1, pagesize = 20, type = 'song' } = {}) {
    const key = `search:${type}:${keyword}:${page}:${pagesize}`;
    const cached = cache.get(key);
    if (cached) return cached;

    if (type === 'playlist') {
      const url = `${BASE.web}/search/special?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pagesize}&version=8000`;
      const j = await getJson(url);
      const list = j.data?.info || [];
      const out = list.map((pl) => ({
        id: String(pl.specialid),
        name: String(pl.specialname || '未命名歌单'),
        cover: coverUrl(pl.imgurl, 240) || fallbackCover(pl.specialname),
        description: String(pl.intro || ''),
        trackCount: Number(pl.songcount) || 0,
        source: 'kugou',
        tracks: [],
      }));
      cache.set(key, out, 5 * 60_000);
      return out;
    }

    const url = `${BASE.web}/search/song?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pagesize}&showtype=1&version=8000`;
    const j = await getJson(url);
    const songs = (j.data?.info || []).map(toTrack);
    cache.set(key, songs, 5 * 60_000);
    return songs;
  }

  async playlists(limit = 12) {
    const key = `ranklist:${limit}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const j = await getJson(`${BASE.web}/rank/list?version=8000&plat=0`);
    const list = j.data?.list || [];
    const out = list.slice(0, limit).map((rank) => ({
      id: `rank-${rank.rankid}`,
      rankId: Number(rank.rankid),
      name: String(rank.rankname || '榜单'),
      cover: coverUrl(rank.imgurl, 240) || fallbackCover(rank.rankname),
      description: String(rank.intro || '酷狗榜单'),
      trackCount: Number(rank.songcount) || 0,
      source: 'kugou',
      tracks: [],
    }));
    cache.set(key, out, 30 * 60_000);
    return out;
  }

  async playlistTracks(rankId, { page = 1, pagesize = 30 } = {}) {
    const key = `ranksong:${rankId}:${page}:${pagesize}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const url = `${BASE.web}/rank/song?rankid=${rankId}&page=${page}&pagesize=${pagesize}&version=8000`;
    const j = await getJson(url);
    const songs = (j.data?.info || []).map(toTrack);
    cache.set(key, songs, 15 * 60_000);
    return songs;
  }

  async daily(page = 1) {
    return this.playlistTracks(8888, { page, pagesize: 30 });
  }

  async lyrics(track) {
    const hash = track.hash || track.id;
    const durationMs = Math.round((track.duration || 0) * 1000);
    const key = `lyric:${hash}:${durationMs}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const u = new URL(`${BASE.lyric}/search`);
    u.searchParams.set('ver', '1');
    u.searchParams.set('man', 'no');
    u.searchParams.set('client', 'pc');
    u.searchParams.set('hash', hash);
    if (durationMs) u.searchParams.set('duration', String(durationMs));
    const j = await getJson(u.toString());
    const cand = j.candidates?.[0];
    if (!cand) {
      const empty = [{ time: 0, text: '暂无歌词' }];
      cache.set(key, empty, 10 * 60_000);
      return empty;
    }
    const d = new URL(`${BASE.lyric}/download`);
    d.searchParams.set('ver', '1');
    d.searchParams.set('client', 'pc');
    d.searchParams.set('id', cand.id);
    d.searchParams.set('accesskey', cand.accesskey);
    d.searchParams.set('fmt', 'lrc');
    d.searchParams.set('charset', 'utf8');
    const dj = await getJson(d.toString());
    const text = decodeLrcContent(dj.content || '');
    const lines = parseLrc(text);
    const result = lines.length ? lines : [{ time: 0, text: '暂无歌词' }];
    cache.set(key, result, 60 * 60_000);
    return result;
  }

  /** 播放直链：按接口文档通道 B 构造签名 GET */
  async playUrl(track, quality = 'high') {
    const hash = track.hash || track.id;
    if (!hash) return '';
    const qMap = { standard: '128', high: '320', lossless: 'flac', hires: 'high' };
    const q = qMap[quality] || '320';
    const cred = this.cred || credentials;
    // 缓存 key 绑定 token，避免不同账号串用直链
    const key = `playurl:${cred.token}:${hash}:${q}`;
    const cached = cache.get(key);
    if (cached) return cached;

    // key = md5(hash)（不加盐），由线程池计算
    const hashMd5 = await this.signer.md5(hash);
    const p = {
      ...identityParams(cred),
      hash,
      quality: q,
      pid: '2',
      pidversion: '2',
      cmd: '25',
      behavior: 'play',
      key: hashMd5,
    };
    const signature = await this.signer.sign(p, cred.secret, '');
    const u = new URL(BASE.tracker);
    for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
    u.searchParams.set('signature', signature);

    const j = await getJson(u.toString(), { timeout: 15000 });
    const url = Array.isArray(j.url) && j.url.length ? j.url[0] : '';
    if (url) cache.set(key, url, 60 * 60_000); // 直链缓存 1h（< 2h 时效）
    return url;
  }
}

export { fallbackCover, coverUrl };
