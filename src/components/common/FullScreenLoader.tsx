import { Spinner } from './Spinner';
import styles from './FullScreenLoader.module.scss';

export function FullScreenLoader() {
  return (
    <div className={styles.screen}>
      <Spinner size={22} thickness={2} />
    </div>
  );
}
