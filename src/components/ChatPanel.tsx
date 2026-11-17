import { useEffect, useRef, useState } from 'react';
import { X, Send, Smile, Music2, Users, MessageCircle, WifiOff } from 'lucide-react';
import { useChatStore } from '../store/chat';
import { usePlayerStore } from '../store/player';
import { getDeviceAvatar, getDeviceUserId } from '../services/identity';
import type { RoomMember, SyncStatus } from '../services/syncService';

const EMOJIS = ['🎵', '🎶', '👍', '❤️', '😂', '🔥', '✨', '🙌'];

interface ChatPanelProps {
  /** 由设置中的「一起听同步」统一调控：只有已连接才有真实频道 */
  syncStatus: SyncStatus;
  /** 服务端下发的真实房间成员 */
  members: RoomMember[];
}

export default function ChatPanel({ syncStatus, members }: ChatPanelProps) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const closePanel = useChatStore((s) => s.closePanel);
  const messages = useChatStore((s) => s.messages);
  const sendText = useChatStore((s) => s.sendText);
  const shareTrack = useChatStore((s) => s.shareTrack);
  const sendError = useChatStore((s) => s.sendError);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const connected = syncStatus === 'connected';
  const myId = getDeviceUserId();

  useEffect(() => {
    if (panelOpen) {
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [messages, panelOpen]);

  const send = () => {
    if (!text.trim()) return;
    if (sendText(text)) {
      setText('');
      setShowEmoji(false);
    }
  };

  const doShare = () => {
    shareTrack(currentTrack);
  };

  const tip = sendError;

  return (
    <>
      <div className={`overlay ${panelOpen ? 'visible' : ''}`} onClick={closePanel} />
      <aside className={`chat-panel ${panelOpen ? 'open' : ''}`} aria-hidden={!panelOpen}>
        <div className="chat-head">
          <div className="chat-head-info">
            <div className="chat-title"><MessageCircle size={18} /> 在线频道</div>
            <div className="chat-subtitle">
              {connected ? (
                <>
                  <span className="online-dot" /> {members.length} 人在线 · 一起听一起聊
                </>
              ) : (
                <>
                  <span className="online-dot offline" /> 未接入 · 在设置中开启「一起听同步」
                </>
              )}
            </div>
          </div>
          <button className="header-icon-btn" onClick={closePanel} aria-label="关闭聊天">
            <X size={20} />
          </button>
        </div>

        <div className="chat-members">
          <div className="member-avatars">
            {connected && members.length > 0 ? (
              members.map((m) => (
                <span
                  key={m.id}
                  className={`member-avatar ${m.id === myId ? 'me' : ''}`}
                  style={{ background: m.avatar || getDeviceAvatar() }}
                  title={m.id === myId ? `${m.nickname}（我）` : m.nickname}
                />
              ))
            ) : (
              <span className="member-avatar" style={{ background: getDeviceAvatar() }} title="我（未接入）" />
            )}
          </div>
          <div className="member-label">
            {connected ? (
              <>
                <Users size={13} /> 真实房间成员
              </>
            ) : (
              <>
                <WifiOff size={13} /> 离线占位
              </>
            )}
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              {connected ? '频道里还没有人说话，来打个招呼吧' : '接入在线频道后，这里只会显示真实成员的聊天'}
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg ${msg.self ? 'self' : ''}`}>
              {!msg.self && <span className="msg-avatar" style={{ background: msg.sender.avatar }} />}
              <div className="msg-content">
                <span className="msg-sender">{msg.self ? '我' : msg.sender.nickname}</span>
                {msg.type === 'text' && <div className="msg-bubble">{msg.content}</div>}
                {msg.type === 'emoji' && <div className="msg-emoji">{msg.content}</div>}
                {msg.type === 'track' && msg.track && (
                  <div className="msg-track-card" onClick={() => playTrack(msg.track!)}>
                    <div className="msg-track-cover" style={{ background: msg.track.cover }}>
                      <Music2 size={16} />
                    </div>
                    <div className="msg-track-info">
                      <h4>{msg.track.title}</h4>
                      <p>{msg.track.artist} · 点击播放</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {tip && <div className="chat-tip">{tip}</div>}

        {showEmoji && (
          <div className="emoji-picker">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => { setText((t) => t + e); setShowEmoji(false); }}>{e}</button>
            ))}
          </div>
        )}

        <div className="chat-input-area">
          <button
            className="chat-tool-btn"
            onClick={() => setShowEmoji((v) => !v)}
            aria-label="表情"
            disabled={!connected}
          >
            <Smile size={20} />
          </button>
          <button
            className="chat-tool-btn"
            onClick={doShare}
            aria-label="分享当前歌曲"
            title={connected ? '分享正在播放的歌曲' : '未接入在线频道'}
            disabled={!connected}
          >
            <Music2 size={20} />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={connected ? '说点什么…' : '未接入在线频道'}
            className="chat-input"
            disabled={!connected}
          />
          <button className="chat-send" onClick={send} aria-label="发送" disabled={!connected || !text.trim()}>
            <Send size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}
