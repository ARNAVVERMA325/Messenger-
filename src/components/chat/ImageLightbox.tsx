import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import styles from './ImageLightbox.module.scss';

/**
 * Full-screen view for a photo already decrypted into a blob URL.
 *
 * The download button is the one place an attachment is deliberately
 * written to the device. Everywhere else the app avoids that on purpose —
 * long-press "save image" stays suppressed — so saving stays an explicit
 * choice rather than something that happens by brushing the screen.
 */
export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const prefersReducedMotion = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // Stop the conversation behind the overlay from scrolling under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <motion.div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={onClose}
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className={styles.bar} onClick={(e) => e.stopPropagation()}>
        <a
          href={url}
          download={`anya-photo-${Date.now()}.jpg`}
          className={styles.barButton}
          aria-label="Download photo"
        >
          <DownloadIcon />
          <span>Save</span>
        </a>
        <button ref={closeRef} type="button" className={styles.barButton} onClick={onClose} aria-label="Close photo">
          <CloseIcon />
        </button>
      </div>

      <motion.img
        src={url}
        alt="Photo"
        className={styles.image}
        onClick={(e) => e.stopPropagation()}
        initial={prefersReducedMotion ? false : { scale: 0.96 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  );
}

function DownloadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
