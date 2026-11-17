import type { KugouProfile } from '../types';
import { getApiBaseUrl, getAuthHeaders } from './apiConfig';

/**
 * 酷狗概念版个人凭证获取客户端（手机号验证码 / 扫码登录）。
 * 走电脑服务端代理（服务端持有签名密钥与加密公钥）。
 * 这些接口不缓存、不降级；失败由 UI 提示用户改用手动填入。
 */

async function call(path: string, timeout = 15000): Promise<Record<string, unknown> | null> {
  const base = getApiBaseUrl();
  if (!base) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${base}${path}`, {
      headers: getAuthHeaders(),
      signal: ctl.signal,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error || data?.errmsg || '请求失败'));
    return data;
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface QrSession {
  key: string;
  qrUrl: string;
  expireIn: number;
}

/** ① 获取扫码登录二维码 */
export async function requestQrLogin(): Promise<QrSession> {
  const data = await call('/api/login/qr/key');
  if (!data) throw new Error('未配置服务端地址');
  return {
    key: String(data.key || ''),
    qrUrl: String(data.qrUrl || ''),
    expireIn: Number(data.expireIn) || 300,
  };
}

/** ② 轮询扫码状态：0 过期 / 1 等待 / 2 待确认 / 4 成功 */
export async function checkQrLogin(key: string): Promise<{ status: number; profile?: KugouProfile }> {
  const data = await call(`/api/login/qr/check?key=${encodeURIComponent(key)}`);
  if (!data) throw new Error('未配置服务端地址');
  const status = Number(data.status ?? -1);
  if (status === 4 && data.token) {
    return {
      status,
      profile: {
        token: String(data.token),
        userid: String(data.userid || ''),
        mid: String(data.mid || ''),
        dfid: String(data.dfid || ''),
        nickname: String(data.nickname || ''),
        vipType: Number(data.vipType || 0),
        source: 'qr',
        updatedAt: Date.now(),
        expired: false,
      },
    };
  }
  return { status };
}

/** 手机号发送验证码 */
export async function sendSmsCode(mobile: string): Promise<void> {
  await call(`/api/login/sms/send?mobile=${encodeURIComponent(mobile)}`);
}

/** 手机号验证码登录 */
export async function loginBySms(mobile: string, code: string): Promise<KugouProfile> {
  const data = await call(
    `/api/login/sms/verify?mobile=${encodeURIComponent(mobile)}&code=${encodeURIComponent(code)}`,
    20000
  );
  if (!data) throw new Error('未配置服务端地址');
  return {
    token: String(data.token || ''),
    userid: String(data.userid || ''),
    mid: String(data.mid || ''),
    dfid: String(data.dfid || ''),
    nickname: String(data.nickname || ''),
    vipType: Number(data.vipType || 0),
    source: 'sms',
    updatedAt: Date.now(),
    expired: false,
  };
}

/** 手动填入凭证：解析用户粘贴的 JSON / key=value / 纯 token */
export function parseManualCredential(text: string): KugouProfile {
  const raw = text.trim();
  if (!raw) throw new Error('请输入凭证');
  let token = '', userid = '', mid = '', dfid = '', nickname = '';
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    token = String(obj.token ?? obj.kgToken ?? '');
    userid = String(obj.userid ?? obj.uid ?? '');
    mid = String(obj.mid ?? '');
    dfid = String(obj.dfid ?? '');
    nickname = String(obj.nickname ?? '');
  } catch {
    // key=value 形式：token=xxx&userid=yyy&mid=zzz&dfid=www
    if (raw.includes('=')) {
      const params = new URLSearchParams(raw.replace(/^\?/, ''));
      token = params.get('token') || '';
      userid = params.get('userid') || params.get('uid') || '';
      mid = params.get('mid') || '';
      dfid = params.get('dfid') || '';
      nickname = params.get('nickname') || '';
    } else {
      // 纯 token（128 hex），user/mid/dfid 用文档默认值兜底
      token = raw;
    }
  }
  if (!token) throw new Error('未识别到 token 字段');
  return {
    token,
    userid: userid || '1125949070',
    mid: mid || '328258476213896267330734203660213193848',
    dfid: dfid || '0Qe6pO2SzNUo0rHEax0EtGNY',
    nickname: nickname || '酷狗用户',
    source: 'manual',
    updatedAt: Date.now(),
    expired: false,
  };
}
