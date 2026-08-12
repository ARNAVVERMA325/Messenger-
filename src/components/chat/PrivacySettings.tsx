import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEncryption } from '@/context/EncryptionContext';
import styles from './PrivacySettings.module.scss';

const FORGET_CONFIRM_WINDOW_MS = 2600;

export function PrivacySettings({ onClose }: { onClose: () => void }) {
  const { isSupported, hasKey, isEnabled, setPassphrase, setEnabled, forgetKey } = useEncryption();
  const [passphraseInput, setPassphraseInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const forgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => () => {
    if (forgetTimer.current) clearTimeout(forgetTimer.current);
  }, []);

  async function handleSavePassphrase(e: React.FormEvent) {
    e.preventDefault();
    if (!passphraseInput.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await setPassphrase(passphraseInput.trim());
      setPassphraseInput('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } finally {
      setIsSaving(false);
    }
  }

  function handleForgetTap() {
    if (!confirmingForget) {
      setConfirmingForget(true);
      forgetTimer.current = setTimeout(() => setConfirmingForget(false), FORGET_CONFIRM_WINDOW_MS);
      return;
    }
    forgetKey();
    setConfirmingForget(false);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <motion.div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Privacy settings"
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.header}>
          <span className={styles.title}>Privacy</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {!isSupported ? (
          <p className={styles.unsupported}>
            This browser doesn't support the Web Crypto API this feature needs, so message encryption isn't
            available here.
          </p>
        ) : (
          <>
            <p className={styles.intro}>
              Optionally encrypt message text in this browser before it's sent — the server only ever stores and
              sees scrambled ciphertext. Both of you need to enter the exact same passphrase, agreed on some other
              way (in person, a call — never through this app before encryption is on).
            </p>

            <div className={styles.section}>
              <label className={styles.label} htmlFor="privacy-passphrase">
                {hasKey ? 'Change passphrase' : 'Set a passphrase'}
              </label>
              <form className={styles.passphraseRow} onSubmit={handleSavePassphrase}>
                <input
                  id="privacy-passphrase"
                  className={styles.passphraseInput}
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Shared passphrase"
                  value={passphraseInput}
                  onChange={(e) => setPassphraseInput(e.target.value)}
                />
                <button type="submit" className={styles.saveButton} disabled={!passphraseInput.trim() || isSaving}>
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </form>
              {justSaved && <p className={styles.confirmation}>Saved. Encryption uses this passphrase now.</p>}
              <p className={styles.hint}>
                Stored only on this device. If you both forget it, anything encrypted with it is gone for good —
                there's no reset.
              </p>
            </div>

            <div className={styles.section}>
              <div className={styles.toggleRow}>
                <div>
                  <div className={styles.toggleLabel}>Encrypt new messages</div>
                  <div className={styles.toggleSubtext}>
                    {hasKey ? 'Applies to messages you send from now on.' : 'Set a passphrase first.'}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label="Encrypt new messages"
                  className={`${styles.switch} ${isEnabled ? styles.switchOn : ''}`}
                  disabled={!hasKey}
                  onClick={() => setEnabled(!isEnabled)}
                >
                  <span className={styles.switchThumb} />
                </button>
              </div>
            </div>

            {hasKey && (
              <div className={styles.section}>
                <button type="button" className={styles.forgetButton} onClick={handleForgetTap}>
                  {confirmingForget ? 'Tap again to forget key' : 'Forget key on this device'}
                </button>
                <p className={styles.hint}>
                  Turns encryption off here and clears the passphrase-derived key from this browser. You can set the
                  same passphrase again later to read old encrypted messages.
                </p>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
