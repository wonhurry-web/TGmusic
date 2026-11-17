import { useEffect, useRef, useState } from 'react';
import type { RoomMember, SyncStatus } from '../services/syncService';
import syncService from '../services/syncService';
import { useSettingsStore } from '../store/settings';
import { usePlayerStore } from '../store/player';
import { useChatStore } from '../store/chat';
import { getDeviceAvatar, getDeviceNickname, getDeviceUserId } from '../services/identity';

/**
 * 同步桥接（队列/当前歌曲/在线频道统一由设置中的「一起听同步」开关调控）：
 * - 开关打开时连接服务端；关闭时断开，并清空频道内容（不保留假数据）。
 * - 收到远端队列/歌曲 → 应用到本地（抑制回环，不回发）。
 * - 收到频道消息 → 写入 chat store；仅真实成员发言才会出现。
 * - 本地队列/歌曲变化 → 发送同步（只发队列快照与当前歌曲，不含进度）。
 * - token 由设置面板手动上传/拉取。
 */
export function useSync() {
  const frpSync = useSettingsStore((s) => s.frpSync);
  const syncServerUrl = useSettingsStore((s) => s.syncServerUrl);
  const roomId = useSettingsStore((s) => s.roomId);
  const authToken = useSettingsStore((s) => s.authToken);
  const applyRemoteTokens = useSettingsStore((s) => s.applyRemoteTokens);

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [members, setMembers] = useState<RoomMember[]>([]);

  // 应用远端状态时置位，避免 store 订阅把远端变更又发回去
  const applyingRemote = useRef(false);

  // 事件订阅（只注册一次）
  useEffect(() => {
    const offStatus = syncService.on('status', setStatus);
    const offQueue = syncService.on('queue', (queue) => {
      applyingRemote.current = true;
      usePlayerStore.getState().applyRemoteQueue(queue);
      applyingRemote.current = false;
    });
    const offTrack = syncService.on('track', (track) => {
      applyingRemote.current = true;
      usePlayerStore.getState().applyRemoteTrack(track);
      applyingRemote.current = false;
    });
    const offTokens = syncService.on('tokens', (tokens) => applyRemoteTokens(tokens));
    const offMembers = syncService.on('members', setMembers);
    const offChat = syncService.on('chat', (msg) => useChatStore.getState().receive(msg));
    const offHistory = syncService.on('chatHistory', (list) =>
      useChatStore.getState().replaceHistory(list)
    );
    return () => {
      offStatus();
      offQueue();
      offTrack();
      offTokens();
      offMembers();
      offChat();
      offHistory();
    };
  }, [applyRemoteTokens]);

  // 连接/断开
  useEffect(() => {
    if (!frpSync) {
      syncService.disconnect();
      setMembers([]);
      // 断开即清空频道，避免残留已失效的会话内容
      useChatStore.getState().reset();
      return;
    }
    syncService.connect({
      serverUrl: syncServerUrl.trim(),
      roomId: roomId.trim() || 'music',
      userId: getDeviceUserId(),
      nickname: getDeviceNickname(),
      avatar: getDeviceAvatar(),
      authToken: authToken.trim() || undefined,
    });
    return () => syncService.disconnect();
  }, [frpSync, syncServerUrl, roomId, authToken]);

  // 本地队列/歌曲变化 → 发送同步（进度变化每秒发生，需忽略）
  useEffect(() => {
    let prevQueue = usePlayerStore.getState().queue;
    let prevTrackId = usePlayerStore.getState().currentTrack.id;

    const unsubscribe = usePlayerStore.subscribe((s) => {
      if (applyingRemote.current || !syncService.connected) {
        // 同步基线，避免之后误判为本地变更
        prevQueue = s.queue;
        prevTrackId = s.currentTrack.id;
        return;
      }
      if (s.queue !== prevQueue) {
        syncService.syncQueue(s.queue);
        prevQueue = s.queue;
      }
      if (s.currentTrack.id !== prevTrackId) {
        syncService.syncTrack(s.currentTrack);
        prevTrackId = s.currentTrack.id;
      }
    });
    return unsubscribe;
  }, []);

  return { status, members };
}
