import type { Quality, Track } from '../types';
import { resilientApi } from './resilientApi';
import { usePlayerStore } from '../store/player';

/**
 * 音频播放引擎（单例）。
 * - 用单个 HTMLAudioElement 真实播放，避免多实例资源浪费。
 * - 切歌时先拿播放直链再播放（服务端代理签名，前端零密钥）。
 * - 与 player store 双向同步：store 的播放/进度变化驱动 audio；audio 的真实进度回写 store。
 * - 预取下一首直链（并发），减少切歌等待。
 * - URL 缓存（TTL）避免重复请求签名。
 */
class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private currentTrackId = '';
  private urlCache = new Map<string, { url: string; expire: number }>();
  private prefetch = new Map<string, Promise<string>>();
  private quality: Quality = 'high';
  private listenersBound = false;
  private progressTimer: number | null = null;

  /** 是否正在真实播放（有直链且在播），用于决定是否跳过模拟进度推进 */
  get isRealPlaying(): boolean {
    return Boolean(this.audio && this.audio.src && !this.audio.paused && !this.audio.ended);
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.crossOrigin = 'anonymous';
      if (!this.listenersBound) {
        this.bindStoreSync();
        this.listenersBound = true;
      }
    }
    return this.audio;
  }

  /** 解析播放地址（带缓存 + 并发去重） */
  private async resolveUrl(track: Track): Promise<string> {
    if (!track) return '';
    const q = this.quality;
    const key = `${track.id}::${q}`;
    const cached = this.urlCache.get(key);
    if (cached && Date.now() < cached.expire) return cached.url;

    let task = this.prefetch.get(key);
    if (!task) {
      task = resilientApi.getPlayUrl(track, q).then((url) => {
        if (url) this.urlCache.set(key, { url, expire: Date.now() + 55 * 60_000 }); // 直链约 2h 有效，缓存 55min
        this.prefetch.delete(key);
        return url;
      });
      this.prefetch.set(key, task);
    }
    return task;
  }

  /** 预取下一首（空闲时并发准备直链） */
  prefetchNext(nextTrack?: Track) {
    if (!nextTrack) return;
    void this.resolveUrl(nextTrack).catch(() => {});
  }

  /** 加载并播放指定曲目 */
  async load(track: Track, autoPlay = true) {
    const audio = this.ensureAudio();
    this.currentTrackId = track.id;
    const url = await this.resolveUrl(track);
    if (this.currentTrackId !== track.id) return; // 期间已切歌，放弃
    if (!url) {
      // 无可用直链：通知 UI 降级（进度仍由 tick 模拟）
      return;
    }
    try {
      audio.src = url;
      audio.load();
      if (autoPlay) await audio.play().catch(() => {});
    } catch {
      /* 自动播放可能被浏览器策略拦截，用户点播放后重试 */
    }
  }

  play() {
    const audio = this.ensureAudio();
    if (audio.src) void audio.play().catch(() => {});
  }

  pause() {
    this.audio?.pause();
  }

  seek(progress: number) {
    const audio = this.audio;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.max(0, Math.min(1, progress)) * audio.duration;
    }
  }

  setQuality(q: Quality) {
    this.quality = q;
    // 音质变化：清除当前曲缓存，重新加载
    this.urlCache.delete(`${this.currentTrackId}::${q}`);
  }

  /**
   * 绑定 store ↔ audio 同步。
   * store 变化驱动 audio；audio 的 timeupdate 回写 store 进度（真实时间）。
   */
  private bindStoreSync() {
    const audio = this.ensureAudio();
    let prevTrackId = usePlayerStore.getState().currentTrack.id;
    let prevPlaying = usePlayerStore.getState().isPlaying;
    let prevSeek = usePlayerStore.getState().progress;
    let internalUpdate = false;

    usePlayerStore.subscribe((s) => {
      // 切歌
      if (s.currentTrack.id !== prevTrackId) {
        prevTrackId = s.currentTrack.id;
        void this.load(s.currentTrack, s.isPlaying);
        // 预取下一首
        const idx = s.queue.findIndex((q) => q.track.id === s.currentTrack.id);
        const next = s.queue[(idx + 1) % s.queue.length]?.track;
        if (next) this.prefetchNext(next);
      }

      // 播放/暂停
      if (s.isPlaying !== prevPlaying) {
        prevPlaying = s.isPlaying;
        if (s.isPlaying) {
          if (audio.src) void audio.play().catch(() => {});
          else void this.load(s.currentTrack, true);
        } else {
          audio.pause();
        }
      }

      // 外部进度拖动（与 audio 当前进度差异较大时seek）
      if (!internalUpdate && Math.abs(s.progress - prevSeek) > 0.02 && Math.abs(s.progress - audio.currentTime / (audio.duration || 1)) > 0.03) {
        this.seek(s.progress);
      }
      prevSeek = s.progress;
    });

    audio.addEventListener('timeupdate', () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      internalUpdate = true;
      usePlayerStore.getState().setProgress(audio.currentTime / audio.duration);
      internalUpdate = false;
      prevSeek = audio.currentTime / audio.duration;
    });
    audio.addEventListener('ended', () => {
      usePlayerStore.getState().next();
    });
    audio.addEventListener('error', () => {
      // 直链失效：清缓存，下次重试
      const key = `${this.currentTrackId}::${this.quality}`;
      this.urlCache.delete(key);
    });
  }

  /** 初始化时同步当前曲目（App 启动时调用一次） */
  init() {
    const audio = this.ensureAudio();
    const s = usePlayerStore.getState();
    void this.load(s.currentTrack, s.isPlaying);
    const idx = s.queue.findIndex((q) => q.track.id === s.currentTrack.id);
    const next = s.queue[(idx + 1) % s.queue.length]?.track;
    if (next) this.prefetchNext(next);
    return audio;
  }

  destroy() {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.audio?.pause();
    this.audio = null;
    this.urlCache.clear();
    this.prefetch.clear();
  }
}

export const audioPlayer = new AudioPlayer();
export default audioPlayer;
