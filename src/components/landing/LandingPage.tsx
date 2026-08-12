import { Navigate } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Logo } from '@/components/common/Logo';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { useAuth } from '@/context/AuthContext';
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

export function LandingPage() {
  const prefersReducedMotion = useReducedMotion();
  const { session, isInitializing } = useAuth();

  if (isInitializing) return <FullScreenLoader />;
  if (session) return <Navigate to="/chat" replace />;

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
          <motion.div variants={prefersReducedMotion ? undefined : item} className={styles.mark}>
            <Logo size={40} showWordmark={false} />
          </motion.div>

          <motion.h1 variants={prefersReducedMotion ? undefined : item} className={styles.title}>
            A private space for two
          </motion.h1>

          <motion.p variants={prefersReducedMotion ? undefined : item} className={styles.tagline}>
            Enter your access code to step inside.
          </motion.p>

          <motion.div variants={prefersReducedMotion ? undefined : item} className={styles.formWrap}>
            <AccessCodeForm />
          </motion.div>
        </motion.div>
      </main>

      <footer className={styles.footer}>ANYA LABS — private messaging, made personal</footer>
    </div>
  );
}
