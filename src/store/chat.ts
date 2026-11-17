import { create } from 'zustand';
import type { ChatMessage, Track } from '../types';
import syncService from '../services/syncService';
import { getDeviceUserId } from '../services/identity';

/**
 * 在线频道状态。
 *
 * 数据全部来自服务端：只有真实连接进同一房间的成员发言才会出现在这里，
 * 本地不做任何假消息、不生成机器人回复。未连接时输入被禁用。
 * 频道是否可用由设置中的「一起听同步」开关统一调控（同一 WS 连接）。
 */
interface ChatState {
  messages: ChatMessage[];
  unread: number;
  panelOpen: boolean;
  /** 最近一次发送失败原因（未连接/过快等），供 UI 提示 */
  sendError: string;
  openPanel: () => void;
  closePanel: () => void;
  sendText: (text: string) => boolean;
  shareTrack: (track: Track) => boolean;
  markRead: () => void;
  /** 服务端广播回流的一条消息（含自己发的） */
  receive: (msg: ChatMessage) => void;
  /** 加入房间时下发的历史消息 */
  replaceHistory: (list: ChatMessage[]) => void;
  /** 断开连接时清空，避免展示已失效的频道内容 */
  reset: () => void;
}

/** 判定是否本机发送（服务端下发的 sender.id 为会话 ID，即本机用户 ID） */
function markSelf(msg: ChatMessage): ChatMessage {
  return { ...msg, self: msg.sender?.id === getDeviceUserId() };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  unread: 0,
  panelOpen: false,
  sendError: '',

  openPanel: () => set({ panelOpen: true, unread: 0, sendError: '' }),
  closePanel: () => set({ panelOpen: false }),

  sendText: (text) => {
    const content = text.trim();
    if (!content) return false;
    if (!syncService.connected) {
      set({ sendError: '未接入在线频道，请到设置中开启「一起听同步」' });
      return false;
    }
    // 不做本地乐观插入：以服务端广播为准，避免重复与身份不一致
    syncService.sendChat('text', content);
    set({ sendError: '' });
    return true;
  },

  shareTrack: (track) => {
    if (!syncService.connected) {
      set({ sendError: '未接入在线频道，请到设置中开启「一起听同步」' });
      return false;
    }
    syncService.sendChat('track', '分享了一首歌', track);
    set({ panelOpen: true, unread: 0, sendError: '' });
    return true;
  },

  markRead: () => set({ unread: 0 }),

  receive: (msg) =>
    set((s) => {
      if (!msg?.id || s.messages.some((m) => m.id === msg.id)) return s; // 重连重叠时去重
      const stamped = markSelf(msg);
      return {
        messages: [...s.messages, stamped],
        unread: s.panelOpen || stamped.self ? s.unread : s.unread + 1,
      };
    }),

  replaceHistory: (list) =>
    set((s) => ({ messages: list.map(markSelf), unread: s.panelOpen ? 0 : get().unread })),

  reset: () => set({ messages: [], unread: 0, sendError: '' }),
}));
