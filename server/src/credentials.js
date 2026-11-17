import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CRED_FILE = process.env.KUGOU_CRED_FILE || path.join(ROOT, 'data', 'credentials.json');

/**
 * 酷狗概念版鉴权参数（来自接口文档实测值）。
 *
 * 设计：
 * - 敏感参数（token/mid/dfid/secret）不硬编码在业务代码里，集中到此模块。
 * - 优先级：环境变量 > data/credentials.json > 文档默认值。
 * - 换账号/换设备只需改环境变量或 credentials.json，业务代码零改动。
 */
const DEFAULTS = {
  appid: '3116',
  clientver: '11621',
  plat: '1070',
  channel: '14',
  userid: '1125949070',
  mid: '328258476213896267330734203660213193848',
  dfid: '0Qe6pO2SzNUo0rHEax0EtGNY',
  token: '2180ef54d13a21ff0f0ff0c21d421dcc0e969132117e6b55a4089845984f8397',
  uuid: '-',
  secret: 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA',
  userAgent: 'Android13-1070-11621-14-0-User-wifi',
};

const ENV_MAP = {
  appid: 'KG_APPID', clientver: 'KG_CLIENTVER', plat: 'KG_PLAT', channel: 'KG_CHANNEL',
  userid: 'KG_USERID', mid: 'KG_MID', dfid: 'KG_DFID', token: 'KG_TOKEN',
  uuid: 'KG_UUID', secret: 'KG_SECRET', userAgent: 'KG_UA',
};

function loadFile() {
  try {
    if (!fs.existsSync(CRED_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function build() {
  const file = loadFile();
  const creds = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const envVal = process.env[ENV_MAP[key]];
    if (envVal) creds[key] = envVal;
    else if (file[key]) creds[key] = String(file[key]);
  }
  return creds;
}

export const credentials = build();

/** 供管理接口返回的脱敏视图 */
export function safeCredentials() {
  const mask = (s) => (s && s.length > 8 ? `${s.slice(0, 4)}****${s.slice(-4)}` : s ? '****' : '');
  return {
    appid: credentials.appid,
    clientver: credentials.clientver,
    plat: credentials.plat,
    userid: credentials.userid,
    mid: mask(credentials.mid),
    dfid: mask(credentials.dfid),
    token: mask(credentials.token),
    secret: mask(credentials.secret),
    source: fs.existsSync(CRED_FILE) ? 'file+env+defaults' : 'env+defaults',
  };
}

/** 生成一份 credentials.json 模板（不含真实值，供用户填写） */
export function ensureTemplate() {
  try {
    fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
    if (!fs.existsSync(CRED_FILE)) {
      fs.writeFileSync(CRED_FILE, JSON.stringify({
        _comment: '酷狗概念版鉴权参数；留空则用内置默认值。换账号/设备时填写对应值。',
        ...DEFAULTS,
      }, null, 2), 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

export default credentials;
