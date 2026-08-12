import styles from './Logo.module.scss';

interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 22, showWordmark = true, className }: LogoProps) {
  return (
    <span className={[styles.logo, className].filter(Boolean).join(' ')}>
      <svg
        className={styles.mark}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        role="img"
        aria-label="ANYA LABS"
      >
        <defs>
          <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e2a56d" />
            <stop offset="100%" stopColor="#c96f5c" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="18" fill="var(--color-surface-alt)" />
        <path
          d="M32 15 L47 47 H40.2 L37 39.5 H27 L23.8 47 H17 Z M32 24.5 L28.3 33.5 H35.7 Z"
          fill="url(#logo-gradient)"
        />
      </svg>
      {showWordmark && (
        <span className={styles.wordmark}>
          ANYA <span className={styles.labs}>LABS</span>
        </span>
      )}
    </span>
  );
}
