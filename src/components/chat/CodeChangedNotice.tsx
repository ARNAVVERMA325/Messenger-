import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useChat } from '@/context/ChatContext';
import styles from './CodeChangedNotice.module.scss';

/**
 * "Anya changed their code" — shown to the other person, never with the
 * code itself (only the person who chose it ever sees it).
 *
 * Worth surfacing because in a room for two, a code change is either
 * expected ("I'll change mine once I'm in") or a signal worth a
 * conversation. Dismissing it is remembered per device, keyed to that
 * specific change, so a later change shows again.
 */
export function CodeChangedNotice() {
  const { other, room } = useChat();
  const prefersReducedMotion = useReducedMotion();
  const storageKey = `anya.code-notice.${room.id}.${other.role}`;

  const [dismissedAt, setDismissedAt] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(storageKey)) || 0;
    } catch {
      return 0;
    }
  });

  const changedAt = other.codeChangedAt;
  const visible = changedAt !== null && changedAt > dismissedAt;

  function dismiss() {
    if (changedAt === null) return;
    setDismissedAt(changedAt);
    try {
      localStorage.setItem(storageKey, String(changedAt));
    } catch {
      // Unwritable storage: it's dismissed for this visit, and may show again next time.
    }
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          className={styles.notice}
          role="status"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: 0.22 }}
        >
          <span className={styles.text}>
            <strong>{other.name}</strong> changed their access code
            {changedAt ? ` on ${new Date(changedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}.
          </span>
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            OK
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
