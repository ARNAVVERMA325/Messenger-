import { Logo } from './Logo';
import styles from './SetupNotice.module.scss';

/** Shown instead of the app when Supabase env vars aren't set — see .env.example. */
export function SetupNotice() {
  return (
    <div className={styles.screen}>
      <div className={styles.mark}>
        <Logo size={36} showWordmark={false} />
      </div>
      <p className={styles.title}>Backend not configured yet</p>
      <p className={styles.subtitle}>
        ANYA LABS needs a Supabase project to run. Copy <code>.env.example</code> to{' '}
        <code>.env.local</code>, fill in your project's URL and anon key, and restart the dev server.
      </p>
      <code className={styles.code}>
        VITE_SUPABASE_URL=https://your-project.supabase.co
        <br />
        VITE_SUPABASE_ANON_KEY=your-anon-public-key
      </code>
    </div>
  );
}
