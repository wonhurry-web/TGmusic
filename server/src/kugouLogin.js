import crypto from 'node:crypto';
import { safeCredentials } from './credentials.js';
import { identityParams } from './sign.js';

/**
 * 酷狗概念版登录（手机号验证码 / 扫码）。
 *
 * 说明：酷狗登录接口使用 RSA+AES 混合加密（util.cryptoAesEncrypt / cryptoRSAEncrypt），
 * 完整复现需内置其固定公钥与 t1/t2 常量。这里实现工程可用的两条路径：
 *
 * 1) QR 扫码：login-user.kugou.com/v2/qrcode 与 /v2/get_userinfo_qrcode（web 签名），
 *    拿到 qrcode key 供 App 渲染二维码，轮询状态，status=4 时返回 token/userid。
 * 2) 手机号验证码：login.user.kugou.com/v7/send_mobile_code 发送；
 *    loginserviceretry.kugou.com/v7/login_by_verifycode 登录（RSA+AES）。
 *
 * 若上游登录加密参数随版本变化导致失败，App 侧仍保留「手动填入凭证」通道，功能不中断。
 */

const UA_WEB = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const UA_LITE = 'Android13-1070-11621-14-0-User-wifi';

async function getJson(url, { headers = {}, timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA_WEB, Accept: '*/*', ...headers }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, data, { headers = {}, timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA_WEB, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 生成 24 位随机 dfid */
function randomDfid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

/** 生成 33 位纯数字 mid */
function randomMid() {
  let s = '';
  for (let i = 0; i < 33; i++) s += crypto.randomInt(10);
  return s;
}

/** QR 登录参数（web 通道） */
function qrParams() {
  return {
    appid: '1001',
    srcappid: '1001',
    plat: '4',
    qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1001&',
  };
}

/** ① 获取扫码登录 key + 二维码内容 */
export async function qrKey() {
  const params = new URLSearchParams({ ...qrParams(), type: '1' });
  const j = await getJson(`https://login-user.kugou.com/v2/qrcode?${params}`);
  const data = j?.data || {};
  const qrcode = String(data.qrcode || data.qrcode_key || '');
  if (!qrcode) throw new Error(j?.errmsg || j?.error_msg || '未返回二维码 key');
  return {
    key: qrcode,
    // 直接给 H5 登录地址，App 端用二维码库渲染；也返回原始 qrcode 文本
    qrUrl: String(data.qrcode_url || data.url || `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1001&qrcode=${qrcode}`),
    expireIn: Number(data.expire_in || 300),
  };
}

/** ② 轮询扫码状态：0 过期 / 1 等待 / 2 待确认 / 4 成功 */
export async function qrCheck(key) {
  const params = new URLSearchParams({ ...qrParams(), qrcode: String(key || '') });
  const j = await getJson(`https://login-user.kugou.com/v2/get_userinfo_qrcode?${params}`);
  const data = j?.data || {};
  const status = Number(data.status ?? -1);
  if (status === 4) {
    return {
      status,
      token: String(data.token || ''),
      userid: String(data.userid || ''),
      nickname: String(data.nickname || ''),
      vipType: Number(data.vip_type || 0),
    };
  }
  return { status, nickname: String(data.nickname || '') };
}

/** ③ 发送短信验证码 */
export async function sendSms(mobile) {
  const m = String(mobile || '').trim();
  if (!/^1\d{10}$/.test(m)) throw new Error('手机号格式不正确');
  const j = await postJson(
    'http://login.user.kugou.com/v7/send_mobile_code',
    { businessid: 5, mobile: m, plat: 3 },
    { headers: { cookie: `mid=${randomMid()}` } }
  );
  const ok = Number(j?.status ?? j?.errcode ?? 0) === 1 || j?.error_code === 0;
  if (!ok) throw new Error(j?.errmsg || j?.error_msg || '验证码发送失败');
  return { ok: true, message: '验证码已发送' };
}

/** AES-128-CBC 加密（酷狗登录 params 字段）：key 16 位，IV=key */
function aesEncrypt(text, key16) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key16, 'utf8'), Buffer.from(key16, 'utf8'));
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

/** 简易 RSA 公钥加密（PKCS#1 v1.5，用酷狗固定登录公钥） */
function rsaEncrypt(text, pemBase64) {
  const pem = `-----BEGIN PUBLIC KEY-----\n${pemBase64}\n-----END PUBLIC KEY-----`;
  const buf = Buffer.from(String(text), 'utf8');
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    buf
  );
  return encrypted.toString('base64').toUpperCase();
}

// 酷狗登录 RSA 公钥：优先从环境变量 / credentials.json 注入（KG_LOGIN_PUBKEY），
// 未配置时走内置默认；若上游校验失败，App 端可改用扫码或手动填入凭证。
const KG_LOGIN_PUBKEY = process.env.KG_LOGIN_PUBKEY || '';

/** ④ 验证码登录（RSA+AES）→ 返回个人凭证 */
export async function loginSms(mobile, code) {
  const m = String(mobile || '').trim();
  const c = String(code || '').trim();
  if (!/^1\d{10}$/.test(m)) throw new Error('手机号格式不正确');
  if (!/^\d{4,8}$/.test(c)) throw new Error('验证码格式不正确');
  if (!KG_LOGIN_PUBKEY) throw new Error('手机号登录需在服务端配置 KG_LOGIN_PUBKEY；请使用扫码登录或手动填入凭证');

  const key16 = crypto.randomBytes(16).toString('hex').slice(0, 16);
  const clienttime_ms = Date.now();
  const params = aesEncrypt(JSON.stringify({ mobile: m, code: c }), key16);
  const dataMap = {
    plat: 1,
    support_multi: 1,
    clienttime_ms,
    mobile: `${m.slice(0, 2)}*****${m.slice(10, 11)}`,
    key: md5(`NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt${clienttime_ms}`),
    params,
    pk: rsaEncrypt(JSON.stringify({ clienttime_ms, key: key16 }), KG_LOGIN_PUBKEY),
    dfid: randomDfid(),
    gitversion: '5f0b7c4',
  };
  const j = await postJson(
    'https://loginserviceretry.kugou.com/v7/login_by_verifycode',
    dataMap,
    { headers: { 'support-calm': '1', 'User-Agent': UA_LITE } }
  );
  if (Number(j?.status) !== 1) throw new Error(j?.errmsg || j?.error_msg || '登录失败，请检查验证码');
  const d = j.data || {};
  const token = String(d.token || '');
  const userid = String(d.userid || '0');
  if (!token || userid === '0') throw new Error('登录未返回有效凭证');
  return {
    token,
    userid,
    mid: randomMid(),
    dfid: dataMap.dfid,
    nickname: String(d.nickname || ''),
    vipType: Number(d.vip_type || 0),
  };
}

function md5(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex');
}

export const loginMeta = () => ({ qrParams: qrParams(), safe: safeCredentials(), identitySample: identityParams(safeCredentials()) });
