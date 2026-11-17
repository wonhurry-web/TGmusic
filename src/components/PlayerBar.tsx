import { SkipBack, SkipForward, Play, Pause, ListMusic } from 'lucide-react';
import { usePlayerStore } from '../store/player';
import { fmtSec } from './tabs/SearchTab';

interface PlayerBarProps {
  onOpenQueue: () => void;
  onOpenLyrics: () => void;
}

export default function PlayerBar({ onOpenQueue, onOpenLyrics }: PlayerBarProps) {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setProgress = usePlayerStore((s) => s.setProgress);

  const currentSec = Math.floor(progress * track.duration);

  return (
    <div className="player-bar">
      {/* 进度条 */}
      <div
        className="player-progress"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setProgress((e.clientX - rect.left) / rect.width);
        }}
        role="slider"
        aria-label="播放进度"
        aria-valuenow={Math.round(progress * 100)}
      >
        <div className="player-progress-fill" style={{ width: `${progress * 100}%` }}>
          <span className="progress-knob" />
        </div>
      </div>

      <div className="player-content">
        <div className="player-track" onClick={onOpenLyrics} title="点击查看歌词">
          <div className="player-cover" style={{ background: track.cover }}>
            {isPlaying && <span className="playing-bars cover-bars"><i/><i/><i/></span>}
          </div>
          <div className="player-meta">
            <h4>{track.title}</h4>
            <p>{track.artist} · 点击查看歌词</p>
          </div>
        </div>

        <div className="player-controls">
          <button onClick={prev} aria-label="上一首"><SkipBack size={20} fill="currentColor" /></button>
          <button className="play-main" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button onClick={next} aria-label="下一首"><SkipForward size={20} fill="currentColor" /></button>
        </div>

        <div className="player-right">
          <span className="player-time tabular">{fmtSec(currentSec)} / {fmtSec(track.duration)}</span>
          <button onClick={onOpenQueue} aria-label="打开队列"><ListMusic size={20} /></button>
        </div>
      </div>
    </div>
  );
}
