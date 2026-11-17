import { MessageCircle, Settings2 } from 'lucide-react';
import { usePlayerStore } from '../store/player';
import { useChatStore } from '../store/chat';

/** 格式化已听时长 */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return '刚刚开始';
}

interface HeaderProps {
  onOpenSettings: () => void;
}

export default function Header({ onOpenSettings }: HeaderProps) {
  const listened = usePlayerStore((s) => s.listenedSeconds);
  const unread = useChatStore((s) => s.unread);
  const openPanel = useChatStore((s) => s.openPanel);

  return (
    <header className="app-header">
      {/* 左上角：在线频道聊天气泡 */}
      <button className="header-icon-btn chat-entry" onClick={openPanel} aria-label="在线频道聊天">
        <MessageCircle size={22} strokeWidth={2} />
        {unread > 0 && (
          <span className="unread-badge tabular">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {/* 中部：已听时长 */}
      <div className="listened-pill">
        <span className="listened-label">已听</span>
        <span className="listened-value tabular">{formatDuration(listened)}</span>
      </div>

      {/* 右上角：设置中心 */}
      <button className="header-icon-btn" onClick={onOpenSettings} aria-label="设置中心">
        <Settings2 size={22} strokeWidth={2} />
      </button>
    </header>
  );
}
