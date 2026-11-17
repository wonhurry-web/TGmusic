import { useEffect, useRef, useState } from 'react';
import { Search, X, Play, Plus, Loader2, TrendingUp } from 'lucide-react';
import type { SearchResult, Track } from '../../types';
import { getMusicApi } from '../../services/musicApi';
import { usePlayerStore } from '../../store/player';

const HOT_KEYWORDS = ['周杰伦', '夜空中最亮的星', '晴天', '摇滚', '治愈', '起风了'];

export default function SearchTab() {
  const [keyword, setKeyword] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = async (kw: string) => {
    const q = kw.trim();
    if (!q) return;
    setKeyword(q);
    setSearching(true);
    setSearched(true);
    const res = await getMusicApi().search(q);
    setResult(res);
    setSearching(false);
  };

  const clear = () => {
    setKeyword('');
    setResult(null);
    setSearched(false);
    inputRef.current?.focus();
  };

  return (
    <div className="tab-scroll search-tab">
      {/* 搜索框 */}
      <div className="search-box">
        <Search size={18} className="search-icon" />
        <input
          ref={inputRef}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch(keyword)}
          placeholder="搜索歌曲、歌手、歌单"
          aria-label="搜索"
        />
        {keyword && (
          <button className="search-clear" onClick={clear} aria-label="清空搜索">
            <X size={16} />
          </button>
        )}
      </div>

      {!searched && (
        <section className="content-section">
          <div className="section-header">
            <div className="section-title">
              <TrendingUp size={18} />
              <h2>热门搜索</h2>
            </div>
          </div>
          <div className="hot-tags">
            {HOT_KEYWORDS.map((kw, i) => (
              <button key={kw} className="hot-tag" onClick={() => doSearch(kw)}>
                <span className="hot-rank tabular">{i + 1}</span>
                {kw}
              </button>
            ))}
          </div>
          <p className="search-hint">输入关键词，发现你想听的音乐</p>
        </section>
      )}

      {searching && (
        <div className="tab-loading">
          <Loader2 size={22} className="spin" />
          <span>搜索中…</span>
        </div>
      )}

      {searched && !searching && (
        <section className="content-section">
          <div className="section-header">
            <div className="section-title">
              <Search size={18} />
              <h2>搜索结果</h2>
            </div>
            <span className="section-sub">{result?.songs.length ?? 0} 首歌曲</span>
          </div>
          {result && result.songs.length > 0 ? (
            <div className="song-list">
              {result.songs.map((track) => (
                <SongRow key={track.id} track={track} onPlay={() => playTrack(track)} onAdd={() => addToQueue(track)} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={36} />
              <p>没有找到「{keyword}」相关的歌曲</p>
              <span>换个关键词试试吧</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function SongRow({ track, onPlay, onAdd, extra }: {
  track: Track;
  onPlay: () => void;
  onAdd?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="song-row" onClick={onPlay}>
      <div className="song-cover" style={{ background: track.cover }}>
        <Play size={14} fill="currentColor" className="song-cover-play" />
      </div>
      <div className="song-info">
        <h4>{track.title}</h4>
        <p>{track.artist} · {track.source}</p>
      </div>
      <span className="song-duration tabular">{fmtSec(track.duration)}</span>
      <div className="song-actions" onClick={(e) => e.stopPropagation()}>
        {onAdd && (
          <button className="mini-icon-btn" onClick={onAdd} title="加入队列">
            <Plus size={18} />
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

export function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
