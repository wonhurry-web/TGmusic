import { useSettingsStore } from '../store/settings';

/**
 * API 地址配置。
 * 音乐代理与同步服务共用同一台电脑服务端（同一端口 6666/frp 57899）：
 * - 同步用 ws://host:port
 * - 音乐代理用 http://host:port
 */
export function getApiBaseUrl(): string {
  const ws = useSettingsStore.getState().syncServerUrl.trim();
  if (!ws) return '';
  if (ws.startsWith('ws://')) return `http://${ws.slice(5)}`;
  if (ws.startsWith('wss://')) return `https://${ws.slice(6)}`;
  if (ws.startsWith('http://') || ws.startsWith('https://')) return ws;
  return `http://${ws}`;
}

export function getAuthHeaders(): Record<string, string> {
  const token = useSettingsStore.getState().authToken.trim();
  return token ? { 'x-app-token': token } : {};
}

/** 携带当前个人酷狗凭证：服务端代理用它签名播放直链（token 过期降级场景） */
export function getKugouCredentialHeaders(): Record<string, string> {
  const p = useSettingsStore.getState().kugouProfile;
  if (!p?.token) return {};
  return {
    'x-kg-token': p.token,
    'x-kg-userid': p.userid,
    'x-kg-mid': p.mid,
    'x-kg-dfid': p.dfid,
  };
}

/** 是否启用在线曲库 */
export function isLiveApiEnabled(): boolean {
  return useSettingsStore.getState().liveApi;
}
