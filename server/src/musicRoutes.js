import { config } from './config.js';
import { credentials, safeCredentials, ensureTemplate } from './credentials.js';
import { KugouClient } from './kugou.js';
import { qrKey, qrCheck, sendSms, loginSms } from './kugouLogin.js';

/**
 * 音乐代理 HTTP 路由（供 App 的 HttpMusicApi 调用）。
 * 所有真实请求由服务端发出：隐藏签名密钥与设备凭据，App 只拿结果。
 *
 * 鉴权：设置 APP_TOKEN 后，App 需在 header 带 x-app-token（与 WS 鉴权一致）。
 */

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-app-token, x-kg-token, x-kg-userid, x-kg-mid, x-kg-dfid',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function authorized(req) {
  if (!config.authToken) return true;
  return (req.headers['x-app-token'] || '') === config.authToken;
}

function parseQuery(req) {
  const q = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(q);
}

export function createMusicRoutes({ signer }) {
  const kg = new KugouClient(signer);

  /** 若请求头带个人凭证，则用其构造 KugouClient（token 过期降级场景） */
  function clientFor(req) {
    const token = req.headers['x-kg-token'];
    if (!token) return kg;
    return new KugouClient(signer, {
      ...credentials,
      token: String(token),
      userid: String(req.headers['x-kg-userid'] || credentials.userid),
      mid: String(req.headers['x-kg-mid'] || credentials.mid),
      dfid: String(req.headers['x-kg-dfid'] || credentials.dfid),
    });
  }

  async function handle(req, res, pathname) {
    // CORS 预检
    if (req.method === 'OPTIONS') return json(res, 204, {});

    if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

    try {
      // 数据源探测 / 鉴权状态（不含敏感值）
      if (pathname === '/api/health') {
        return json(res, 200, {
          ok: true,
          service: 'yqting-music-proxy',
          quality: ['standard', 'high', 'lossless', 'hires'],
          credentials: safeCredentials(),
        });
      }

      // ===== 个人 token 获取（手机号验证码 / 扫码）=====
      if (pathname === '/api/login/qr/key') {
        return json(res, 200, { ok: true, ...(await qrKey()) });
      }
      if (pathname === '/api/login/qr/check') {
        const q0 = parseQuery(req);
        return json(res, 200, { ok: true, ...(await qrCheck(q0.get('key'))) });
      }
      if (pathname === '/api/login/sms/send') {
        const q0 = parseQuery(req);
        return json(res, 200, { ok: true, ...(await sendSms(q0.get('mobile'))) });
      }
      if (pathname === '/api/login/sms/verify') {
        const q0 = parseQuery(req);
        return json(res, 200, { ok: true, ...(await loginSms(q0.get('mobile'), q0.get('code'))) });
      }

      // 初始化凭据模板（供用户编辑）
      if (pathname === '/api/credentials/template' && req.method === 'POST') {
        return json(res, 200, { ok: ensureTemplate() });
      }

      const q = parseQuery(req);

      // 搜索：type=song|playlist
      if (pathname === '/api/search') {
        const keyword = (q.get('keyword') || '').trim();
        const type = q.get('type') || 'song';
        const page = Math.max(1, Number(q.get('page')) || 1);
        const pagesize = Math.min(100, Math.max(1, Number(q.get('pagesize')) || 20));
        if (!keyword) return json(res, 200, { ok: true, songs: [], playlists: [] });
        if (type === 'playlist') {
          const playlists = await kg.search(keyword, { page, pagesize, type: 'playlist' });
          return json(res, 200, { ok: true, playlists });
        }
        const songs = await kg.search(keyword, { page, pagesize, type: 'song' });
        return json(res, 200, { ok: true, songs });
      }

      // 推荐歌单（榜单列表）
      if (pathname === '/api/playlists') {
        const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 12));
        const playlists = await kg.playlists(limit);
        return json(res, 200, { ok: true, playlists });
      }

      // 每日推荐（TOP500 榜单，支持批量并发预取直链）
      if (pathname === '/api/daily') {
        const page = Math.max(1, Number(q.get('page')) || 1);
        const tracks = await kg.daily(page);
        return json(res, 200, { ok: true, tracks });
      }

      // 歌单/榜单歌曲
      if (pathname === '/api/tracks') {
        const rankId = Number(q.get('rankId')) || 8888;
        const page = Math.max(1, Number(q.get('page')) || 1);
        const pagesize = Math.min(100, Math.max(1, Number(q.get('pagesize')) || 30));
        const tracks = await kg.playlistTracks(rankId, { page, pagesize });
        return json(res, 200, { ok: true, tracks });
      }

      // 歌词：以 track 字段 JSON 传入（含 hash/duration）
      if (pathname === '/api/lyrics') {
        let track = {};
        try {
          track = JSON.parse(q.get('track') || '{}');
        } catch {
          /* ignore */
        }
        const lyrics = await kg.lyrics(track);
        return json(res, 200, { ok: true, lyrics });
      }

      // 播放直链
      if (pathname === '/api/playurl') {
        let track = {};
        try {
          track = JSON.parse(q.get('track') || '{}');
        } catch {
          /* ignore */
        }
        const quality = q.get('quality') || 'high';
        const url = await clientFor(req).playUrl(track, quality);
        return json(res, 200, { ok: true, url, quality });
      }

      return json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      // 上游失败：返回 ok:false，让 App 降级到 Mock
      return json(res, 200, { ok: false, error: err.message || 'upstream error' });
    }
  }

  return { handle, kg };
}
