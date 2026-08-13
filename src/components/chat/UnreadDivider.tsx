import styles from './UnreadDivider.module.scss';

export function UnreadDivider() {
  return (
    <div className={styles.divider} role="separator" aria-label="Unread messages">
      <span className={styles.line} aria-hidden="true" />
      <span className={styles.label}>Unread</span>
      <span className={styles.line} aria-hidden="true" />
    </div>
  );
}
