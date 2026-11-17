import { ListMusic, Pin, PinOff, Trash2, Play, Music2,ArrowUpToLine } from 'lucide-react';
import { usePlayerStore } from '../../store/player';
import { fmtSec } from './SearchTab';

export default function QueueTab() {
  const queue = usePlayerStore((s) => s.queue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePin = usePlayerStore((s) => s.togglePin);
  const moveToTop = usePlayerStore((s) => s.moveToTop);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);

  return (
    <div className="tab-scroll queue-tab">
      <div className="queue-header-info">
        <div>
          <h2><ListMusic size={18} /> 播放队列</h2>
          <p>像 KTV 一样，一起点歌 · 共 {queue.length} 首</p>
        </div>
        <div className="queue-controls">
          <button onClick={prev} aria-label="上一首">⏮</button>
          <button className="queue-play" onClick={() => (isPlaying ? usePlayerStore.getState().setPlaying(false) : usePlayerStore.getState().setPlaying(true))} aria-label="播放/暂停">
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={next} aria-label="下一首">⏭</button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="empty-state">
          <Music2 size={36} />
          <p>队列空空如也</p>
          <span>去推荐或搜索页添加歌曲吧</span>
        </div>
      ) : (
        <div className="queue-list">
          {queue.map((item, index) => {
            const isCurrent = item.track.id === currentTrack.id;
            return (
              <div key={item.id} className={`queue-item ${isCurrent ? 'current' : ''} ${item.pinned ? 'pinned' : ''}`}>
                <div className="queue-index tabular">
                  {item.pinned ? <Pin size={14} className="pin-icon" /> : <span>{index + 1}</span>}
                </div>
                <div className="queue-body" onClick={() => playTrack(item.track)}>
                  <div className="song-cover" style={{ background: item.track.cover }}>
                    {isCurrent && isPlaying ? (
                      <span className="playing-bars"><i/><i/><i/></span>
                    ) : (
                      <Play size={14} fill="currentColor" className="song-cover-play" />
                    )}
                  </div>
                  <div className="song-info">
                    <h4>{item.track.title} {isCurrent && <span className="now-tag">正在播放</span>}</h4>
                    <p>{item.track.artist} · {item.addedBy} 添加 · {fmtSec(item.track.duration)}</p>
                  </div>
                </div>
                <div className="queue-actions">
                  <button className="mini-icon-btn" onClick={() => moveToTop(item.id)} title="置顶">
                    <ArrowUpToLine size={16} />
                  </button>
                  <button className="mini-icon-btn" onClick={() => togglePin(item.id)} title={item.pinned ? '取消置顶' : '置顶'}>
                    {item.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </button>
                  <button className="mini-icon-btn danger" onClick={() => removeFromQueue(item.id)} title="移除">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="queue-tip">
        <span>💡 置顶歌曲优先播放；播完的歌曲自动出队，不占队列</span>
      </div>
    </div>
  );
}
