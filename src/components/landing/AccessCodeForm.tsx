import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/common/Spinner';
import { SHARED_DEVICE_IDLE_MS } from '@/lib/deviceSession';
import { rememberedRoom } from '@/lib/rooms';
import styles from './AccessCodeForm.module.scss';

/**
 * Room name + code. The room name comes from, in order: an invite link
 * (/r/<room>), the last room used on this phone, or typing it. On a
 * borrowed phone it's never remembered (see rememberRoom), so the person
 * types it — which is why both fields are built to be forgiving about
 * capitals and spaces.
 */
export function AccessCodeForm({ initialRoom }: { initialRoom?: string }) {
  const [room, setRoom] = useState(() => initialRoom || rememberedRoom());
  const [code, setCode] = useState('');
  const [sharedDevice, setSharedDevice] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const { login, status, errorMessage } = useAuth();
  const navigate = useNavigate();
  const errorId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const isSubmitting = status === 'verifying';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting || !code.trim()) return;

    const ok = await login(room, code, sharedDevice);
    if (ok) {
      navigate('/chat', { replace: true });
    } else {
      setShakeKey((k) => k + 1);
      codeRef.current?.focus();
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={`${styles.field} ${errorMessage ? styles.hasError : ''}`}>
        <input
          id="room-name"
          className={styles.input}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          placeholder="Room name"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          disabled={isSubmitting}
          aria-label="Room name"
        />
      </div>

      <motion.div
        key={shakeKey}
        animate={shakeKey > 0 && !prefersReducedMotion ? { x: [0, -9, 8, -6, 5, -3, 0] } : undefined}
        transition={{ duration: 0.45, ease: 'easeInOut' }}
        className={`${styles.field} ${errorMessage ? styles.hasError : ''}`}
      >
        <input
          ref={codeRef}
          id="access-code"
          className={styles.input}
          type={revealed ? 'text' : 'password'}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Your code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={isSubmitting}
          aria-label="Your code"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? errorId : undefined}
        />
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? 'Hide code' : 'Show code'}
          tabIndex={-1}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button type="submit" className={styles.submit} disabled={isSubmitting || !code.trim()}>
          {isSubmitting ? (
            <Spinner size={16} thickness={2} />
          ) : (
            <>
              <span className={styles.submitLabel}>Enter</span>
              <ArrowIcon />
            </>
          )}
        </button>
      </motion.div>

      <label className={styles.sharedDevice}>
        <input
          type="checkbox"
          className={styles.sharedDeviceBox}
          checked={sharedDevice}
          onChange={(e) => setSharedDevice(e.target.checked)}
          disabled={isSubmitting}
        />
        <span>
          This isn't my phone
          <span className={styles.sharedDeviceNote}>
            Signs you out when you close the browser, or after {SHARED_DEVICE_IDLE_MS / 60_000} minutes of inactivity,
            and doesn't remember your room.
          </span>
        </span>
      </label>

      {errorMessage ? (
        <p className={styles.error} id={errorId} role="alert">
          {errorMessage}
        </p>
      ) : (
        <p className={styles.hint}>Capitals and spaces don't matter in either field.</p>
      )}
    </form>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.6 6.7C4.3 8.2 2 12 2 12s3.6 7 10 7c1.8 0 3.3-.5 4.6-1.2M9.9 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7-.5.9-1.4 2.2-2.7 3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
