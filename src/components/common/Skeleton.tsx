import styles from './Skeleton.module.scss';

const WIDTHS = ['58%', '38%', '70%', '45%', '62%', '33%'];
const SIDES: Array<'left' | 'right'> = ['left', 'right', 'left', 'left', 'right', 'left'];

export function MessageListSkeleton() {
  return (
    <div className={styles.list} aria-hidden="true">
      {WIDTHS.map((width, i) => (
        <div key={i} className={`${styles.row} ${styles[SIDES[i]]}`}>
          <div className={styles.bubble} style={{ width }} />
        </div>
      ))}
    </div>
  );
}
