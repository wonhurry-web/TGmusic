import crypto from 'node:crypto';

/**
 * 酷狗 gateway 签名算法（接口文档第 3 节）。
 * sign = md5(secret + sortedParamsConcat + body + secret)
 * - 剔除 signature 自身
 * - 按 key 字典序排序
 * - 拼成 k1=v1k2=v2...（原始值，无分隔符、无 URL 编码）
 * - GET body 传空串；POST body 传实际发送的字节原文
 */
export function sign(params, secret, body = '') {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort();
  let raw = '';
  for (const k of keys) raw += `${k}=${params[k]}`;
  return crypto.createHash('md5').update(secret + raw + body + secret, 'utf8').digest('hex');
}

/** hash 的 md5（播放通道 key 参数，不加盐） */
export function md5(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex');
}

/** 带 clienttime 的通用身份参数 */
export function identityParams(creds) {
  return {
    appid: creds.appid,
    clientver: creds.clientver,
    plat: creds.plat,
    channel: creds.channel,
    userid: creds.userid,
    mid: creds.mid,
    dfid: creds.dfid,
    token: creds.token,
    uuid: creds.uuid || '-',
    clienttime: String(Math.floor(Date.now() / 1000)),
  };
}
