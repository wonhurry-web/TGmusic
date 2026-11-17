import { useEffect, useState } from 'react';
import type { TabKey } from './types';
import { usePlayerStore } from './store/player';
import { useThemeStore } from './store/theme';
import Header from './components/Header';
import TabBar from './components/TabBar';
import RecommendTab from './components/tabs/RecommendTab';
import SearchTab from './components/tabs/SearchTab';
import QueueTab from './components/tabs/QueueTab';
import PlayerBar from './components/PlayerBar';
import SettingsPanel from './components/SettingsPanel';
import ChatPanel from './components/ChatPanel';
import LyricsPanel from './components/LyricsPanel';
import Logo from './components/Logo';
import { useSync } from './hooks/useSync';
import audioPlayer from './services/audioPlayer';
import { useSettingsStore } from './store/settings';

export default function App() {
  const { status: syncStatus, members } = useSync();
  const [tab, setTab] = useState<TabKey>('recommend');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const tick = usePlayerStore((s) => s.tick);
  const addListened = usePlayerStore((s) => s.addListened);
  const theme = useThemeStore((s) => s.mode);

  // 初始化音频引擎（首次交互前不自动播放）
  useEffect(() => {
    audioPlayer.init();
    return () => audioPlayer.destroy();
  }, []);

  // 每秒：真实音频在播则只累加时长（进度由 audio timeupdate 驱动），否则模拟推进
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (audioPlayer.isRealPlaying) addListened(1);
      else tick();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tick, addListened]);

  // 音质切换 → 通知音频引擎重新解析直链
  const quality = useSettingsStore((s) => s.quality);
  useEffect(() => {
    audioPlayer.setQuality(quality);
  }, [quality]);

  // 炫彩主题标记（供背景光斑使用）
  useEffect(() => {
    document.body.dataset.colorful = theme === 'colorful' ? 'true' : 'false';
  }, [theme]);

  // 三栏左右滑动切换
  const touchStartX = useState({ x: 0 })[0];
  const tabOrder: TabKey[] = ['recommend', 'search', 'queue'];
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.x = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.x;
    if (Math.abs(dx) < 60) return;
    const idx = tabOrder.indexOf(tab);
    if (dx < 0 && idx < tabOrder.length - 1) setTab(tabOrder[idx + 1]);
    if (dx > 0 && idx > 0) setTab(tabOrder[idx - 1]);
  };

  return (
    <div className="app-shell">
      {/* 背景装饰（炫彩主题） */}
      <div className="ambient-bg" aria-hidden />

      <div className="app-main">
        <Header onOpenSettings={() => setSettingsOpen(true)} />
        <TabBar active={tab} onChange={setTab} />

        <main
          className="tab-content"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {tab === 'recommend' && <RecommendTab />}
          {tab === 'search' && <SearchTab />}
          {tab === 'queue' && <QueueTab />}
        </main>

        <PlayerBar
          onOpenQueue={() => setTab('queue')}
          onOpenLyrics={() => setLyricsOpen(true)}
        />
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        syncStatus={syncStatus}
        members={members}
      />
      <ChatPanel syncStatus={syncStatus} members={members} />
      <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />

      {/* 首次加载的品牌闪屏遮罩（轻量，仅 CSS 动画） */}
      <div className="boot-splash" aria-hidden>
        <Logo size={72} animated showText />
      </div>
    </div>
  );
}
