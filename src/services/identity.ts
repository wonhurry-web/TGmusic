/**
 * 本机用户身份（在线频道 / 一起听房间用）。
 *
 * 为什么要独立生成：房间内所有客户端若共用同一个固定 ID，会互相误判为「自己」，
 * 也无法区分真实用户。这里为每台设备生成一次唯一 ID 并持久化，昵称同理。
 */

const KEY_UID = 'yqting:uid';
const KEY_NICKNAME = 'yqting:nickname';

/** 头像渐变池（与主题一致的柔和渐变，按 ID 稳定取色） */
const AVATARS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
];

function randomTag(len = 4): string {
  const chars = '0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式等场景下忽略，本次会话内仍可用内存值 */
  }
}

let cachedUid = '';
let cachedNickname = '';

/** 本机唯一用户 ID（形如 u-8f3a2b1c） */
export function getDeviceUserId(): string {
  if (cachedUid) return cachedUid;
  let uid = read(KEY_UID);
  if (!uid) {
    uid = `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    write(KEY_UID, uid);
  }
  cachedUid = uid;
  return uid;
}

/** 本机昵称（默认「听友1234」，首次生成后持久化） */
export function getDeviceNickname(): string {
  if (cachedNickname) return cachedNickname;
  let nickname = read(KEY_NICKNAME);
  if (!nickname) {
    nickname = `听友${randomTag()}`;
    write(KEY_NICKNAME, nickname);
  }
  cachedNickname = nickname;
  return nickname;
}

/** 设置本机昵称（供后续「修改昵称」入口使用） */
export function setDeviceNickname(nickname: string): void {
  const v = nickname.trim().slice(0, 16);
  if (!v) return;
  cachedNickname = v;
  write(KEY_NICKNAME, v);
}

/** 本机头像（按用户 ID 稳定取渐变） */
export function getDeviceAvatar(): string {
  const uid = getDeviceUserId();
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}
