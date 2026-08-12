import { motion } from 'framer-motion';
import styles from './TypingIndicator.module.scss';

export function TypingIndicator({ name }: { name: string }) {
  return (
    <motion.div
      className={styles.row}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2 }}
    >
      <div className={styles.bubble} role="status" aria-label={`${name} is typing`}>
        <span />
        <span />
        <span />
      </div>
    </motion.div>
  );
}
