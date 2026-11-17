import { create } from 'zustand';
import type { Track, QueueItem } from '../types';
import { mockQueue, mockTracks } from '../data/mock';

const LISTEN_KEY = 'syncwave:listenedSeconds';

function loadListened(): number {
  try {
    const v = localStorage.getItem(LISTEN_KEY);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

interface PlayerState {
  currentTrack: Track;
  isPlaying: boolean;
  progress: number; // 0-1
  queue: QueueItem[];
  listenedSeconds: number;
  // actions
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
  playTrack: (track: Track) => void;
  next: () => void;
  prev: () => void;
  setProgress: (v: number) => void;
  tick: () => void; // 模拟播放进度与时长累加（无真实音频时）
  addListened: (sec: number) => void; // 真实音频播放时仅累加时长
  addToQueue: (track: Track, addedBy?: string) => void;
  removeFromQueue: (id: string) => void;
  togglePin: (id: string) => void;
  moveToTop: (id: string) => void;
  // 远端同步应用（仅更新歌曲/队列，不重置本地播放进度）
  applyRemoteQueue: (queue: QueueItem[]) => void;
  applyRemoteTrack: (track: Track) => void;
}

function sortedQueue(queue: QueueItem[]): QueueItem[] {
  // 置顶项在前，其余按加入时间
  return [...queue].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.addedAt - b.addedAt;
  });
}

type AdvancePatch = {
  queue: QueueItem[];
  currentTrack: Track;
  progress: number;
  isPlaying?: boolean;
};

/**
 * 播放推进策略（手动「下一首」与播完自动切歌共用同一套规则）：
 * 1) 已播完的当前曲从队列移除 —— 播完即消耗，队列不会无限堆积；
 * 2) 剩余队列存在置顶曲时，优先从置顶第一首开始播（KTV 插播语义）；
 * 3) 否则播放原顺序的下一首，到队尾后环回队首；
 * 4) 最后一首播完时队列清空（显示空态），播放条保留该曲、进度归零并停止，
 *    避免 currentTrack 悬空导致播放条异常。
 */
function advance(queue: QueueItem[], current: Track): AdvancePatch {
  const idx = queue.findIndex((q) => q.track.id === current.id);
  // 当前曲不在队列中（直接从推荐页/搜索页点播）时，没有可移除的条目
  const rest = idx >= 0 ? queue.filter((_, i) => i !== idx) : queue;

  if (rest.length === 0) {
    return { queue: rest, currentTrack: current, progress: 0, isPlaying: false };
  }

  const pinned = rest.find((q) => q.pinned);
  const target = pinned ?? rest[(idx > 0 ? idx : 0) % rest.length];
  return { queue: rest, currentTrack: target.track, progress: 0 };
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: mockTracks[0],
  isPlaying: false,
  progress: 0.08,
  queue: sortedQueue(mockQueue),
  listenedSeconds: loadListened(),

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setPlaying: (v) => set({ isPlaying: v }),

  /**
   * 播放指定曲目。若该曲不在队列中则同时入队，
   * 这样「播完自动下一首 + 清除已播曲」始终有确定的播放顺序。
   */
  playTrack: (track) =>
    set((s) => {
      const exists = s.queue.some((q) => q.track.id === track.id);
      if (exists) return { currentTrack: track, progress: 0, isPlaying: true };
      const item: QueueItem = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        track,
        addedBy: '我',
        pinned: false,
        addedAt: Date.now(),
      };
      return {
        currentTrack: track,
        progress: 0,
        isPlaying: true,
        queue: sortedQueue([...s.queue, item]),
      };
    }),

  next: () => {
    const s = get();
    if (s.queue.length === 0) return;
    // 已播曲出队 + 置顶优先，与播完自动切换共用同一策略
    set(advance(s.queue, s.currentTrack));
  },

  prev: () => {
    const { queue, currentTrack } = get();
    if (queue.length === 0) return;
    const idx = queue.findIndex((q) => q.track.id === currentTrack.id);
    const prevItem = idx <= 0 ? queue[queue.length - 1] : queue[idx - 1];
    set({ currentTrack: prevItem.track, progress: 0 });
  },

  setProgress: (v) => set({ progress: Math.max(0, Math.min(1, v)) }),

  tick: () => {
    const s = get();
    if (!s.isPlaying) return;
    const duration = s.currentTrack.duration || 200;
    const listenedSeconds = s.listenedSeconds + 1;
    try {
      localStorage.setItem(LISTEN_KEY, String(listenedSeconds));
    } catch {
      /* ignore */
    }

    const progress = s.progress + 1 / duration;
    if (progress < 1) {
      set({ progress, listenedSeconds });
      return;
    }
    // 当前曲播完：已播曲出队，跳到下一首（有置顶则从置顶开始）
    set({ ...advance(s.queue, s.currentTrack), listenedSeconds });
  },

  addListened: (sec) => {
    const listenedSeconds = get().listenedSeconds + sec;
    try {
      localStorage.setItem(LISTEN_KEY, String(listenedSeconds));
    } catch {
      /* ignore */
    }
    set({ listenedSeconds });
  },

  addToQueue: (track, addedBy = '我') =>
    set((s) => {
      if (s.queue.some((q) => q.track.id === track.id)) return s;
      const item: QueueItem = {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        track,
        addedBy,
        pinned: false,
        addedAt: Date.now(),
      };
      return { queue: sortedQueue([...s.queue, item]) };
    }),

  removeFromQueue: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),

  togglePin: (id) =>
    set((s) => ({
      queue: sortedQueue(s.queue.map((q) => (q.id === id ? { ...q, pinned: !q.pinned } : q))),
    })),

  moveToTop: (id) =>
    set((s) => {
      const target = s.queue.find((q) => q.id === id);
      if (!target) return s;
      const rest = s.queue.filter((q) => q.id !== id);
      return { queue: [{ ...target, pinned: true }, ...rest] };
    }),

  // 远端队列：直接替换；保持当前歌曲/进度不变（进度各端自行播放）
  applyRemoteQueue: (queue) => set({ queue: sortedQueue(queue) }),

  // 远端当前歌曲：切换歌曲，但进度从 0 开始（不同步时间点）
  applyRemoteTrack: (track) => {
    const s = get();
    if (s.currentTrack.id === track.id) return; // 已是同一首，不动，避免打断本地进度
    set({ currentTrack: track, progress: 0 });
  },
}));
