import { Link, Navigate, useParams } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Logo } from '@/components/common/Logo';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { useAuth } from '@/context/AuthContext';
import { normalizeHandle } from '@/lib/rooms';
import { AccessCodeForm } from './AccessCodeForm';
import styles from './LandingPage.module.scss';

const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

/** Serves both "/" and "/r/:room" — the latter is an invite link that fills in the room name. */
export function LandingPage() {
  const prefersReducedMotion = useReducedMotion();
  const { session, isInitializing, backendOutdated } = useAuth();
  const { room } = useParams<{ room?: string }>();
  const invitedRoom = room ? normalizeHandle(room) : undefined;

  if (isInitializing) return <FullScreenLoader />;
  if (session) return <Navigate to="/chat" replace />;

  const itemVariants = prefersReducedMotion ? undefined : item;

  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />

      <header className={styles.topBar}>
        <Logo size={26} showWordmark={false} />
        <ThemeToggle />
      </header>

      <main className={styles.content}>
        <motion.div
          className={styles.hero}
          variants={prefersReducedMotion ? undefined : container}
          initial={prefersReducedMotion ? undefined : 'hidden'}
          animate={prefersReducedMotion ? undefined : 'show'}
        >
          <motion.div variants={itemVariants} className={styles.mark}>
            <Logo size={40} showWordmark={false} />
          </motion.div>

          <motion.h1 variants={itemVariants} className={styles.title}>
            A private space for two
          </motion.h1>

          <motion.p variants={itemVariants} className={styles.tagline}>
            {invitedRoom ? (
              <>
                You've been invited to <strong className={styles.invitedRoom}>{invitedRoom}</strong>. Enter your code
                to step inside.
              </>
            ) : (
              'Enter your room and code to step inside.'
            )}
          </motion.p>

          {backendOutdated && (
            <motion.p variants={itemVariants} className={styles.notice} role="status">
              ANYA LABS is being upgraded right now. If signing in doesn't work, try again in a few minutes.
            </motion.p>
          )}

          <motion.div variants={itemVariants} className={styles.formWrap}>
            <AccessCodeForm initialRoom={invitedRoom} />
          </motion.div>

          <motion.p variants={itemVariants} className={styles.createPrompt}>
            New here? <Link to="/create">Create a room for two</Link>
          </motion.p>
        </motion.div>
      </main>

      <footer className={styles.footer}>ANYA LABS — private messaging, made personal</footer>
    </div>
  );
}
