import { AnimatePresence, motion } from 'framer-motion';
import type { ConnectionStatus } from '@/types';
import styles from './ConnectionBanner.module.scss';

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  return (
    <AnimatePresence initial={false}>
      {status !== 'online' && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
        >
          <div className={`${styles.banner} ${status === 'offline' ? styles.offline : styles.connecting}`}>
            {status === 'offline' ? (
              <>
                <span className={styles.dot} aria-hidden="true" />
                You're offline — messages will send once you're back online
              </>
            ) : (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Reconnecting…
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
