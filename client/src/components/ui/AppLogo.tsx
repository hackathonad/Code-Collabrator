interface AppLogoProps {
  className?: string;
  size?: number;
}

export const AppLogo = ({ className = "", size = 28 }: AppLogoProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`shrink-0 ${className}`.trim()}
    aria-hidden
  >
    <rect x="2" y="4" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-[var(--accent)] opacity-90" />
    <rect x="18" y="6" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)] opacity-70" />
    <path d="M8 18 L14 24 L24 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]" />
    <rect x="4" y="22" width="24" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.25" className="text-[var(--border)]" />
  </svg>
);
