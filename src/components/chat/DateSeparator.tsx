import styles from './DateSeparator.module.scss';

export function DateSeparator({ label }: { label: string }) {
  return (
    <div className={styles.separator} role="separator" aria-label={label}>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
