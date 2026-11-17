import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Share2, SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import type { LyricLine } from '../types';
import { getMusicApi } from '../services/musicApi';
import { usePlayerStore } from '../store/player';
import { useChatStore } from '../store/chat';
import { fmtSec } from './tabs/SearchTab';

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function LyricsPanel({ open, onClose }: LyricsPanelProps) {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const shareTrack = useChatStore((s) => s.shareTrack);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时加载歌词
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setLyrics([]);
    getMusicApi().getLyrics(track).then((data) => {
      if (!alive) return;
      setLyrics(data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, track.id]);

  const currentSec = progress * track.duration;

  // 计算当前歌词行索引
  let activeIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (currentSec >= lyrics[i].time) activeIndex = i;
  }

  // 当前行自动滚动到容器中央
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const container = listRef.current;
      const el = activeRef.current;
      const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: target, behavior: 'smooth' });
    }
  }, [activeIndex, open]);

  // 点击歌词行跳转进度
  const jumpTo = (line: LyricLine) => {
    setProgress(Math.min(line.time / track.duration, 0.999));
  };

  return (
    <div className={`lyrics-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
      {/* 模糊背景：用当前封面渐变铺底 */}
      <div className="lyrics-bg" style={{ background: track.cover }} />
      <div className="lyrics-bg-veil" />

      <div className="lyrics-inner">
        {/* 顶部栏 */}
        <div className="lyrics-head">
          <button className="lyrics-icon-btn" onClick={onClose} aria-label="收起歌词">
            <ChevronDown size={24} />
          </button>
          <div className="lyrics-head-info">
            <h3>{track.title}</h3>
            <p>{track.artist}</p>
          </div>
          <button
            className="lyrics-icon-btn"
            onClick={() => shareTrack(track)}
            aria-label="分享到频道"
          >
            <Share2 size={20} />
          </button>
        </div>

        {/* 旋转唱片 */}
        <div className="vinyl-wrap">
          <div className={`vinyl-disc ${isPlaying ? 'spinning' : ''}`} style={{ background: track.cover }}>
            <div className="vinyl-hole" />
          </div>
          <div className={`vinyl-tonearm ${isPlaying ? 'on' : ''}`} />
        </div>

        {/* 歌词列表 */}
        <div className="lyrics-list" ref={listRef}>
          {loading ? (
            <div className="lyrics-loading"><span className="spinner" /></div>
          ) : (
            <>
              <div className="lyrics-spacer" />
              {lyrics.map((line, i) => (
                <div
                  key={i}
                  ref={i === activeIndex ? activeRef : undefined}
                  className={`lyric-line ${i === activeIndex ? 'active' : ''} ${i < activeIndex ? 'passed' : ''}`}
                  onClick={() => jumpTo(line)}
                >
                  {line.text}
                </div>
              ))}
              <div className="lyrics-spacer" />
            </>
          )}
        </div>

        {/* 底部控制 */}
        <div className="lyrics-footer">
          <div
            className="lyrics-progress"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setProgress((e.clientX - rect.left) / rect.width);
            }}
            role="slider"
            aria-label="播放进度"
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="lyrics-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="lyrics-times tabular">
            <span>{fmtSec(Math.floor(currentSec))}</span>
            <span>{fmtSec(track.duration)}</span>
          </div>
          <div className="lyrics-controls">
            <button onClick={prev} aria-label="上一首"><SkipBack size={22} fill="currentColor" /></button>
            <button className="lyrics-play" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
            </button>
            <button onClick={next} aria-label="下一首"><SkipForward size={22} fill="currentColor" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
