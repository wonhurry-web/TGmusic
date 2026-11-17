import { create } from 'zustand';
import type { KugouProfile, Quality, ThirdPartyAccount } from '../types';

const STORAGE_KEY = 'yqting:settings';

interface PersistedSettings {
  quality: Quality;
  accounts: ThirdPartyAccount[];
  kugouProfile: KugouProfile | null; // 当前个人 token 凭证（驱动在线曲库直连）
  frpSync: boolean;
  syncServerUrl: string;             // 公网 IP / 域名 + 端口（frp 映射）
  roomId: string;
  authToken: string;
  liveApi: boolean;                  // 在线曲库开关（关闭时回退内置曲库）
}

/** 默认公网同步地址占位：frp 隧道（仅透传 TLS，故用 wss），部署后改成自己的节点地址 */
const DEFAULT_SYNC_URL = 'wss://YOUR_FRP_HOST:57899';

function loadSettings(): PersistedSettings {
  const defaults: PersistedSettings = {
    quality: 'high',
    accounts: [],
    kugouProfile: null,
    frpSync: false,
    syncServerUrl: DEFAULT_SYNC_URL,
    roomId: 'music',
    authToken: '',
    liveApi: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    const merged = { ...defaults, ...parsed };
    // 迁移：旧占位符地址自动升级为当前公网隧道地址
    if (
      !merged.syncServerUrl ||
      merged.syncServerUrl.includes('YOUR_PUBLIC_IP') ||
      /^ws:\/\/192\.168\./.test(merged.syncServerUrl)
    ) {
      merged.syncServerUrl = DEFAULT_SYNC_URL;
    }
    return merged;
  } catch {
    return defaults;
  }
}

function persist(data: PersistedSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

interface SettingsState extends PersistedSettings {
  setQuality: (q: Quality) => void;
  setKugouProfile: (p: KugouProfile | null) => void;
  markKugouExpired: () => void;
  setFrpSync: (v: boolean) => void;
  setSyncServerUrl: (v: string) => void;
  setRoomId: (v: string) => void;
  setAuthToken: (v: string) => void;
  setLiveApi: (v: boolean) => void;
  applyRemoteTokens: (tokens: ThirdPartyAccount[]) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const save = () => {
    const s = get();
    persist({
      quality: s.quality,
      accounts: s.accounts,
      kugouProfile: s.kugouProfile,
      frpSync: s.frpSync,
      syncServerUrl: s.syncServerUrl,
      roomId: s.roomId,
      authToken: s.authToken,
      liveApi: s.liveApi,
    });
  };

  return {
    ...loadSettings(),
    setQuality: (quality) => {
      set({ quality });
      save();
    },
    setKugouProfile: (kugouProfile) => {
      // 同步维护 accounts 视图（供 token 共享协议使用）
      const accounts: ThirdPartyAccount[] = kugouProfile
        ? [{
            provider: 'kugou',
            label: '酷狗概念版',
            accountId: kugouProfile.userid,
            bound: !kugouProfile.expired,
            token: kugouProfile.token,
          }]
        : [];
      set({ kugouProfile, accounts });
      save();
    },
    markKugouExpired: () => {
      const p = get().kugouProfile;
      if (!p || p.expired) return;
      const expired: KugouProfile = { ...p, expired: true };
      set({
        kugouProfile: expired,
        accounts: [{ provider: 'kugou', label: '酷狗概念版', accountId: p.userid, bound: false, token: p.token }],
      });
      save();
    },
    setFrpSync: (frpSync) => {
      set({ frpSync });
      save();
    },
    setSyncServerUrl: (syncServerUrl) => {
      set({ syncServerUrl });
      save();
    },
    setRoomId: (roomId) => {
      set({ roomId });
      save();
    },
    setAuthToken: (authToken) => {
      set({ authToken });
      save();
    },
    setLiveApi: (liveApi) => {
      set({ liveApi });
      save();
    },
    // 从服务端拉取的 token：若含酷狗 token，更新本地个人凭证
    applyRemoteTokens: (tokens) => {
      const remote = tokens.find((t) => t.provider === 'kugou' && t.token);
      if (!remote?.token) {
        set({ accounts: tokens });
        save();
        return;
      }
      const prev = get().kugouProfile;
      const profile: KugouProfile = {
        token: remote.token,
        userid: remote.accountId || prev?.userid || '',
        mid: prev?.mid || '',
        dfid: prev?.dfid || '',
        nickname: prev?.nickname,
        vipType: prev?.vipType,
        source: prev?.source ?? 'manual',
        updatedAt: Date.now(),
        expired: false,
      };
      set({ accounts: tokens, kugouProfile: profile });
      save();
    },
  };
});
