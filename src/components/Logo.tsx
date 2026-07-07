interface LogoProps {
  size?: number;
}

/**
 * runnit mark: rounded dark tile with an outlined "run" (play) triangle whose
 * stroke fades JS-yellow → TS-blue.
 */
export function Logo({ size = 26 }: LogoProps) {
  return (
    <svg
      className="brand-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="runnit logo"
    >
      <defs>
        <linearGradient id="runnit-play" x1="9" y1="8" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7c948" />
          <stop offset="0.52" stopColor="#f7c948" />
          <stop offset="0.62" stopColor="#2e7df6" />
          <stop offset="1" stopColor="#2e7df6" />
        </linearGradient>
      </defs>

      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="#12151c" />
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="none" stroke="#252b36" strokeWidth="1" />

      {/* outlined play triangle */}
      <path
        d="M11 9 L22.5 16 L11 23 Z"
        fill="none"
        stroke="url(#runnit-play)"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
