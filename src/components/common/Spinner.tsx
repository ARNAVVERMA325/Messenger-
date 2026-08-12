import styles from './Spinner.module.scss';

export function Spinner({ size = 18, thickness = 2 }: { size?: number; thickness?: number }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size, borderWidth: thickness }}
      role="status"
      aria-label="Loading"
    />
  );
}
