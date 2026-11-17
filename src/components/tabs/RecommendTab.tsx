import { useEffect, useState } from 'react';
import { Play, Plus, Music2, Disc3 } from 'lucide-react';
import type { Playlist, Track } from '../../types';
import { getMusicApi } from '../../services/musicApi';
import { usePlayerStore } from '../../store/player';
import { useChatStore } from '../../store/chat';

export default function RecommendTab() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [daily, setDaily] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const shareTrack = useChatStore((s) => s.shareTrack);

  useEffect(() => {
    let alive = true;
    const api = getMusicApi();
    Promise.all([api.getPlaylists(), api.getDailyRecommend()]).then(([ps, ds]) => {
      if (!alive) return;
      setPlaylists(ps);
      setDaily(ds);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="tab-loading">
        <div className="spinner" />
        <span>正在为你挑选好歌…</span>
      </div>
    );
  }

  return (
    <div className="tab-scroll recommend-tab">
      {/* 每日推荐 */}
      <section className="content-section">
        <div className="section-header">
          <div className="section-title">
            <Disc3 size={18} />
            <h2>每日推荐</h2>
          </div>
          <span className="section-sub">为你精选</span>
        </div>
        <div className="daily-grid">
          {daily.map((track, index) => (
            <div key={track.id} className="daily-card" onClick={() => playTrack(track)}>
              <div className="daily-cover" style={{ background: track.cover }}>
                <span className="daily-index tabular">{String(index + 1).padStart(2, '0')}</span>
                <button
                  className="daily-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    playTrack(track);
                  }}
                  aria-label={`播放 ${track.title}`}
                >
                  <Play size={16} fill="currentColor" />
                </button>
              </div>
              <span className="daily-title">{track.title}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 歌单推荐 */}
      <section className="content-section">
        <div className="section-header">
          <div className="section-title">
            <Music2 size={18} />
            <h2>推荐歌单</h2>
          </div>
          <span className="section-sub">来自各平台</span>
        </div>
        <div className="playlist-list">
          {playlists.map((pl) => (
            <div key={pl.id} className="playlist-card">
              <div className="playlist-cover" style={{ background: pl.cover }}>
                <button className="cover-play" onClick={() => pl.tracks[0] && playTrack(pl.tracks[0])} aria-label={`播放歌单 ${pl.name}`}>
                  <Play size={18} fill="currentColor" />
                </button>
              </div>
              <div className="playlist-info">
                <h3>{pl.name}</h3>
                <p>{pl.description}</p>
                <div className="playlist-meta">
                  <span className="source-tag">{pl.source}</span>
                  <span>{pl.trackCount} 首</span>
                </div>
              </div>
              <div className="playlist-actions">
                <button
                  className="mini-icon-btn"
                  title="加入队列"
                  onClick={() => pl.tracks.forEach((t) => addToQueue(t))}
                >
                  <Plus size={18} />
                </button>
                <button
                  className="mini-icon-btn"
                  title="分享到频道"
                  onClick={() => pl.tracks[0] && shareTrack(pl.tracks[0])}
                >
                  <MessageShareIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MessageShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
