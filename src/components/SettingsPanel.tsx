import { useEffect, useRef, useState } from 'react';
import {
  X, Music4, Palette, Radio, ChevronRight, Check,
  Sun, Moon, Sparkles, UploadCloud, DownloadCloud, Users, Loader2, AlertCircle,
  Smartphone, QrCode, KeyRound, RefreshCw, ShieldCheck, ShieldAlert, Trash2,
} from 'lucide-react';
import type { ThemeMode } from '../types';
import type { RoomMember, SyncStatus } from '../services/syncService';
import syncService from '../services/syncService';
import { useThemeStore } from '../store/theme';
import { useSettingsStore } from '../store/settings';
import { qualityOptions } from '../data/mock';
import {
  requestQrLogin, checkQrLogin, sendSmsCode, loginBySms, parseManualCredential,
} from '../services/authApi';
import { qrToDataUrl } from '../services/qrcode';
import Logo from './Logo';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  members: RoomMember[];
}

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'colorful', label: '炫彩', icon: Sparkles },
];

const statusText: Record<SyncStatus, string> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  reconnecting: '重连中…',
  error: '连接错误',
};

type LoginTab = 'qr' | 'sms' | 'manual';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span className="toggle-knob" />
    </button>
  );
}

export default function SettingsPanel({ open, onClose, syncStatus, members }: SettingsPanelProps) {
  const theme = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setMode);
  const settings = useSettingsStore();
  const [showSyncConfig, setShowSyncConfig] = useState(false);
  const [toast, setToast] = useState('');
  const profile = settings.kugouProfile;

  // 登录面板状态
  const [loginTab, setLoginTab] = useState<LoginTab>('qr');
  const [qrImg, setQrImg] = useState('');
  const [qrKey, setQrKey] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrTip, setQrTip] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [smsLoading, setSmsLoading] = useState(false);
  const [manual, setManual] = useState('');
  const pollRef = useRef<number | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // 面板关闭时停止扫码轮询
  useEffect(() => {
    if (!open) stopPolling();
    return () => stopPolling();
  }, [open]);

  const applyProfile = (p: NonNullable<typeof profile>, msg: string) => {
    settings.setKugouProfile(p);
    flash(msg);
  };

  // 扫码登录
  const startQr = async () => {
    setQrLoading(true);
    setQrTip('');
    setQrImg('');
    stopPolling();
    try {
      const session = await requestQrLogin();
      if (!session.key) throw new Error('二维码 key 为空');
      setQrKey(session.key);
      setQrImg(qrToDataUrl(session.qrUrl || session.key));
      setQrTip('请用酷狗概念版 App 扫码登录');
      let ticks = 0;
      pollRef.current = window.setInterval(async () => {
        ticks++;
        try {
          const r = await checkQrLogin(session.key);
          if (r.status === 4 && r.profile) {
            stopPolling();
            applyProfile(r.profile, '扫码登录成功，已获取个人 Token');
          } else if (r.status === 0) {
            stopPolling();
            setQrTip('二维码已过期，请点击刷新');
          } else if (r.status === 2) {
            setQrTip('已扫码，请在手机上确认登录');
          }
        } catch {
          /* 轮询单次失败忽略 */
        }
        if (ticks > 120) stopPolling(); // 最多轮询约 2 分钟（1s/次）
      }, 1000);
    } catch (e) {
      setQrTip(e instanceof Error ? e.message : '获取二维码失败');
    } finally {
      setQrLoading(false);
    }
  };

  // 手机号发送验证码
  const doSendSms = async () => {
    if (!/^1\d{10}$/.test(phone)) return flash('请输入正确的手机号');
    setSmsLoading(true);
    try {
      await sendSmsCode(phone);
      setSmsSent(true);
      flash('验证码已发送');
    } catch (e) {
      flash(e instanceof Error ? e.message : '验证码发送失败');
    } finally {
      setSmsLoading(false);
    }
  };

  // 手机号登录
  const doSmsLogin = async () => {
    if (!smsSent) return flash('请先获取验证码');
    setSmsLoading(true);
    try {
      const p = await loginBySms(phone, smsCode);
      applyProfile(p, '手机号登录成功，已获取个人 Token');
    } catch (e) {
      flash(e instanceof Error ? e.message : '登录失败');
    } finally {
      setSmsLoading(false);
    }
  };

  // 手动填入
  const doManual = () => {
    try {
      const p = parseManualCredential(manual);
      applyProfile(p, '个人 Token 已保存');
    } catch (e) {
      flash(e instanceof Error ? e.message : '凭证解析失败');
    }
  };

  // 上传 / 同步 token
  const uploadTokens = () => {
    if (!syncService.connected) return flash('请先开启同步并连接成功');
    if (!profile?.token) return flash('请先获取个人 Token');
    syncService.uploadTokens([{
      provider: 'kugou', label: '酷狗概念版',
      accountId: profile.userid, bound: true, token: profile.token,
    }]);
    flash('个人 Token 已上传共享给好友');
  };

  const fetchTokens = () => {
    if (!syncService.connected) return flash('请先开启同步并连接成功');
    syncService.fetchTokens();
    flash('正在获取最新 Token…');
  };

  const statusClass = syncStatus === 'connected' ? 'ok' : syncStatus === 'error' ? 'bad' : 'wait';

  return (
    <>
      <div className={`overlay ${open ? 'visible' : ''}`} onClick={onClose} />
      <aside className={`settings-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="settings-head">
          <div className="settings-brand">
            <Logo size={40} />
            <div>
              <h2>设置中心</h2>
              <p>一起听</p>
            </div>
          </div>
          <button className="header-icon-btn" onClick={onClose} aria-label="关闭设置">
            <X size={20} />
          </button>
        </div>

        <div className="settings-scroll">
          {/* 音质切换 */}
          <section className="settings-section">
            <div className="settings-section-title"><Music4 size={16} /> 音质切换</div>
            <div className="quality-grid">
              {qualityOptions.map((q) => (
                <button
                  key={q.value}
                  className={`quality-option ${settings.quality === q.value ? 'selected' : ''}`}
                  onClick={() => settings.setQuality(q.value)}
                >
                  <span className="quality-label">{q.label}</span>
                  <span className="quality-desc">{q.desc}</span>
                  {settings.quality === q.value && <Check size={13} className="quality-check" />}
                </button>
              ))}
            </div>
          </section>

          {/* 酷狗概念版个人 Token */}
          <section className="settings-section">
            <div className="settings-section-title"><KeyRound size={16} /> 酷狗概念版 · 个人 Token</div>

            {profile ? (
              <div className={`profile-card ${profile.expired ? 'expired' : ''}`}>
                <div className="profile-avatar"><Music4 size={22} /></div>
                <div className="profile-main">
                  <div className="profile-name">
                    {profile.nickname || '酷狗用户'}
                    {profile.expired
                      ? <span className="profile-badge bad"><ShieldAlert size={11} /> 已过期</span>
                      : <span className="profile-badge ok"><ShieldCheck size={11} /> 有效</span>}
                  </div>
                  <div className="profile-sub">UID {profile.userid || '—'} · {profile.source === 'qr' ? '扫码登录' : profile.source === 'sms' ? '手机号' : '手动填入'}</div>
                  <div className="profile-token">{profile.token.slice(0, 12)}••••••{profile.token.slice(-6)}</div>
                </div>
                <button
                  className="profile-refresh"
                  title="清除并重新登录"
                  onClick={() => { settings.setKugouProfile(null); flash('已清除，请重新获取 Token'); }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <div className="profile-empty">尚未获取个人 Token。在线曲库需要你的酷狗概念版登录态才能直连抓取。</div>
            )}

            <div className="login-tabs">
              <button className={loginTab === 'qr' ? 'active' : ''} onClick={() => setLoginTab('qr')}>
                <QrCode size={14} /> 扫码
              </button>
              <button className={loginTab === 'sms' ? 'active' : ''} onClick={() => setLoginTab('sms')}>
                <Smartphone size={14} /> 手机号
              </button>
              <button className={loginTab === 'manual' ? 'active' : ''} onClick={() => setLoginTab('manual')}>
                <KeyRound size={14} /> 手动填入
              </button>
            </div>

            {loginTab === 'qr' && (
              <div className="login-pane">
                <div className="qr-box">
                  {qrImg ? <img src={qrImg} alt="扫码登录二维码" /> : <QrCode size={64} />}
                </div>
                <p className="login-hint">{qrTip || '点击下方按钮获取登录二维码'}</p>
                <button className="token-btn primary" onClick={startQr} disabled={qrLoading}>
                  {qrLoading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                  {qrKey ? '刷新二维码' : '获取二维码'}
                </button>
              </div>
            )}

            {loginTab === 'sms' && (
              <div className="login-pane">
                <label className="login-field">
                  <span>手机号</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号" inputMode="numeric" />
                </label>
                <label className="login-field">
                  <span>验证码</span>
                  <div className="login-code-row">
                    <input value={smsCode} onChange={(e) => setSmsCode(e.target.value)} placeholder="验证码" inputMode="numeric" />
                    <button onClick={doSendSms} disabled={smsLoading || smsSent}>
                      {smsSent ? '已发送' : '获取验证码'}
                    </button>
                  </div>
                </label>
                <button className="token-btn primary" onClick={doSmsLogin} disabled={smsLoading}>
                  {smsLoading ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} 登录并获取 Token
                </button>
                <p className="login-hint small">手机号登录需服务端配置加密公钥；若不可用请改用扫码或手动填入。</p>
              </div>
            )}

            {loginTab === 'manual' && (
              <div className="login-pane">
                <textarea
                  className="manual-input"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder={'粘贴凭证 JSON 或 key=value，例如：\n{"token":"...","userid":"...","mid":"...","dfid":"..."}\n也可直接粘贴纯 token 字符串'}
                  rows={4}
                />
                <button className="token-btn primary" onClick={doManual}><KeyRound size={15} /> 保存凭证</button>
                <p className="login-hint small">可从抓包工具或已登录的酷狗概念版导出 token 后粘贴至此。</p>
              </div>
            )}

            <div className="token-actions">
              <button className="token-btn" onClick={uploadTokens}>
                <UploadCloud size={16} /> 上传共享
              </button>
              <button className="token-btn" onClick={fetchTokens}>
                <DownloadCloud size={16} /> 同步 Token
              </button>
            </div>
            <p className="settings-note">个人 Token 平时仅存本地；点「上传共享」同步给一起听的好友。在线曲库默认用你的 Token 直连酷狗，过期后自动走服务端代理。</p>
          </section>

          {/* 主题切换 */}
          <section className="settings-section">
            <div className="settings-section-title"><Palette size={16} /> 主题切换</div>
            <div className="theme-options">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    className={`theme-option ${theme === opt.value ? 'selected' : ''} theme-${opt.value}`}
                    onClick={() => setTheme(opt.value)}
                  >
                    <span className={`theme-swatch swatch-${opt.value}`} />
                    <Icon size={16} />
                    <span>{opt.label}</span>
                    {theme === opt.value && <Check size={14} className="theme-check" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 一起听同步（公网 IP） */}
          <section className="settings-section">
            <div className="setting-row">
              <div className="setting-row-icon"><Radio size={18} /></div>
              <div className="setting-row-text">
                <h3>一起听同步</h3>
                <p>统一调控队列、歌曲与在线频道；未开启时频道不显示任何消息</p>
              </div>
              <Toggle checked={settings.frpSync} onChange={settings.setFrpSync} />
            </div>
            <div className={`sync-status ${statusClass}`}>
              {syncStatus === 'connecting' || syncStatus === 'reconnecting'
                ? <Loader2 size={15} className="spin" />
                : syncStatus === 'error'
                  ? <AlertCircle size={15} />
                  : <span className={`status-dot ${statusClass}`} />}
              <span>{statusText[syncStatus]}</span>
              {syncStatus === 'connected' && <span className="status-count">{members.length} 人在线</span>}
            </div>
            {members.length > 0 && (
              <div className="sync-members">
                <Users size={14} />
                {members.map((m) => <span key={m.id} className="member-chip">{m.nickname}</span>)}
              </div>
            )}
            <button className="sync-config-toggle" onClick={() => setShowSyncConfig((v) => !v)}>
              {showSyncConfig ? '收起服务器配置' : '公网服务器配置'} <ChevronRight size={14} className={showSyncConfig ? 'rot90' : ''} />
            </button>
            {showSyncConfig && (
              <div className="sync-config">
                <label>
                  <span>公网地址（wss://域名:57899）</span>
                  <input
                    value={settings.syncServerUrl}
                    onChange={(e) => settings.setSyncServerUrl(e.target.value)}
                    placeholder="wss://YOUR_FRP_HOST:57899"
                  />
                </label>
                <label>
                  <span>房间号</span>
                  <input
                    value={settings.roomId}
                    onChange={(e) => settings.setRoomId(e.target.value)}
                    placeholder="music"
                  />
                </label>
                <label>
                  <span>鉴权 Token（可选）</span>
                  <input
                    value={settings.authToken}
                    onChange={(e) => settings.setAuthToken(e.target.value)}
                    placeholder="留空则不校验"
                  />
                </label>
                <p className="settings-note">公网入口为 wss://&lt;你的frp节点&gt;:57899（SakuraFrp 等隧道仅透传 TLS，必须用 wss）。局域网直连用 ws://192.168.1.101:8788。修改后需关闭再开启开关重连。</p>
              </div>
            )}
          </section>

          <div className="settings-footer">
            <Logo size={28} />
            <span>一起听 · v0.4.0</span>
          </div>
        </div>

        {toast && <div className="settings-toast">{toast}</div>}
      </aside>
    </>
  );
}
