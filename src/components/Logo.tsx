interface LogoProps {
  size?: number;
  animated?: boolean;
  showText?: boolean; // 是否在音符右侧显示「一起听」字样（默认大尺寸自动显示）
}

/**
 * 一起听 Logo：黑底 + 银色音符 + 「一起听」银色字样。
 * 小尺寸（<56）默认只显示音符，保证清晰；大尺寸自动带文字。
 */
export default function Logo({ size = 96, animated = false, showText }: LogoProps) {
  const withText = showText ?? size >= 56;
  const w = withText ? 300 : 120;
  const h = 120;

  return (
    <svg
      width={size * (withText ? 2.5 : 1)}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="一起听 Logo"
      style={{ maxWidth: '100%' }}
    >
      <defs>
        <linearGradient id="silverNote" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--logo-silver-1)" />
          <stop offset="45%" stopColor="var(--logo-silver-2)" />
          <stop offset="100%" stopColor="var(--logo-silver-3)" />
        </linearGradient>
        <linearGradient id="silverText" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--logo-silver-1)" />
          <stop offset="100%" stopColor="var(--logo-silver-3)" />
        </linearGradient>
        <linearGradient id="silverShine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id="noteGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 黑色底 */}
      <rect x="0" y="0" width={w} height={h} rx="26" fill="#0a0a0c" />
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="25" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

      {/* 银色八分音符 */}
      <g filter="url(#noteGlow)" className={animated ? 'logo-note' : undefined}>
        <rect x="68" y="30" width="7" height="52" rx="3.5" fill="url(#silverNote)" />
        <path
          d="M75 30 C 92 33, 100 42, 96 58 C 94 48, 86 41, 75 40 Z"
          fill="url(#silverNote)"
        />
        <ellipse cx="52" cy="84" rx="21" ry="15" transform="rotate(-20 52 84)" fill="url(#silverNote)" />
        <ellipse cx="48" cy="79" rx="11" ry="5" transform="rotate(-20 48 79)" fill="url(#silverShine)" opacity="0.5" />
      </g>

      {/* 「一起听」银色字样 */}
      {withText && (
        <text
          x="140"
          y="76"
          fill="url(#silverText)"
          fontFamily="'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif"
          fontSize="46"
          fontWeight="700"
          letterSpacing="6"
        >一起听</text>
      )}
    </svg>
  );
}
