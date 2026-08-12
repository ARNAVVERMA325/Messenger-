import styles from './EmptyState.module.scss';

export function EmptyState({ otherName }: { otherName: string }) {
  return (
    <div className={styles.empty}>
      <div className={styles.icon} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 20l1-5.5A8.5 8.5 0 1 1 21 11.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className={styles.title}>No messages yet</p>
      <p className={styles.subtitle}>Say hello to {otherName} — this space is just for the two of you.</p>
    </div>
  );
}
