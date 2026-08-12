import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTheme } from '@/context/ThemeContext';
import styles from './ThemeToggle.module.scss';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className={styles.button}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          className={styles.icon}
          initial={prefersReducedMotion ? false : { opacity: 0, rotate: -60, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, rotate: 60, scale: 0.6 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {isDark ? <MoonIcon /> : <SunIcon />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.7" />
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.2A8.5 8.5 0 1 1 9.8 4a6.7 6.7 0 0 0 10.2 10.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
