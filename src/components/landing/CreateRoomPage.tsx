import { useId, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Logo } from '@/components/common/Logo';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { Spinner } from '@/components/common/Spinner';
import { useAuth } from '@/context/AuthContext';
import { handleProblem, inviteLink, normalizeHandle } from '@/lib/rooms';
import { newCodeProblem, normalizeAccessCode } from '@/utils/accessCode';
import styles from './CreateRoomPage.module.scss';

/**
 * Setting up a room for two, from the original sketch: a room name, then
 * both seats side by side — each with a name and a code.
 *
 * The creator fills in BOTH seats, on purpose. The person this app was
 * built for doesn't have a phone of their own to receive an invite on, so
 * "send them a link to sign up" isn't an option; "tell them their code on
 * a call" is. The partner can change their code once they're in, after
 * which only they know it.
 */

interface Seat {
  name: string;
  code: string;
}

type Field = 'handle' | 'youName' | 'youCode' | 'partnerName' | 'partnerCode';

export function CreateRoomPage() {
  const { session, isInitializing, createRoom } = useAuth();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();

  const [handleInput, setHandleInput] = useState('');
  const [you, setYou] = useState<Seat>({ name: '', code: '' });
  const [partner, setPartner] = useState<Seat>({ name: '', code: '' });
  const [sharedDevice, setSharedDevice] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    handle: string;
    signedIn: boolean;
    partner: Seat;
  } | null>(null);
  // createRoom() signs the creator in (setting the session) before it
  // returns, and `created` is only set after. A render landing between the
  // two would see "signed in, nothing created" and redirect to the chat —
  // skipping the handover screen with the partner's code on it. This is set
  // synchronously before the call, so no render can miss it.
  const creationInFlight = useRef(false);

  if (isInitializing) return null;
  // Already in a room on this device (and not because we're creating one).
  if (session && !created && !creationInFlight.current) return <Navigate to="/chat" replace />;

  const handle = normalizeHandle(handleInput);
  const publicWords = [handle, you.name, partner.name];

  const problems: Record<Field, string | null> = {
    handle: handleInput.trim() ? handleProblem(handle) : 'Choose a room name.',
    youName: you.name.trim() ? null : 'Your name is needed.',
    partnerName: partner.name.trim() ? null : 'Their name is needed.',
    youCode: newCodeProblem(you.code, publicWords),
    partnerCode:
      newCodeProblem(partner.code, publicWords) ??
      (you.code && normalizeAccessCode(you.code) === normalizeAccessCode(partner.code)
        ? 'Each of you needs a different code.'
        : null),
  };

  const show = (field: Field) => (touched[field] || triedSubmit ? problems[field] : null);
  const touch = (field: Field) => () => setTouched((t) => ({ ...t, [field]: true }));
  const hasProblems = Object.values(problems).some(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTriedSubmit(true);
    setServerError(null);
    if (hasProblems || isCreating) return;

    setIsCreating(true);
    creationInFlight.current = true;
    const result = await createRoom({
      handle,
      you: { name: you.name.trim(), code: you.code },
      partner: { name: partner.name.trim(), code: partner.code },
      sharedDevice,
    });
    setIsCreating(false);

    if (!result.ok) {
      creationInFlight.current = false;
      setServerError(result.error);
      return;
    }
    setCreated({
      handle: result.handle,
      signedIn: result.signedIn,
      partner: { ...partner },
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />

      <header className={styles.topBar}>
        {created ? (
          <Logo size={26} showWordmark={false} />
        ) : (
          <Link to="/" className={styles.back}>
            ← Back
          </Link>
        )}
        <ThemeToggle />
      </header>

      <main className={styles.content}>
        {created ? (
          <Handover
            handle={created.handle}
            partner={created.partner}
            signedIn={created.signedIn}
            onEnter={() =>
              navigate(created.signedIn ? '/chat' : `/r/${created.handle}`, {
                replace: true,
              })
            }
          />
        ) : (
          <motion.form
            className={styles.card}
            onSubmit={handleSubmit}
            noValidate
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className={styles.title}>Create a room</h1>
            <p className={styles.lede}>
              A private space for the two of you. You'll set up both seats now, so your partner doesn't need a phone of
              their own to be invited — you just tell them their code.
            </p>

            <TextField
              label="Room name"
              value={handleInput}
              onChange={setHandleInput}
              onBlur={touch('handle')}
              error={show('handle')}
              placeholder="e.g. blue-umbrella"
              maxLength={40}
              note={
                handle && !problems.handle ? (
                  <>
                    Your link:{' '}
                    <span className={styles.linkPreview}>{inviteLink(handle).replace(/^https?:\/\//, '')}</span>
                  </>
                ) : (
                  'What you’ll both type to get in. It isn’t a secret — the codes are.'
                )
              }
            />

            <div className={styles.pair}>
              <div className={styles.seat} role="group" aria-labelledby="seat-you">
                <span className={styles.seatLabel} id="seat-you">
                  You
                </span>
                <TextField
                  label="Your name"
                  value={you.name}
                  onChange={(name) => setYou((s) => ({ ...s, name }))}
                  onBlur={touch('youName')}
                  error={show('youName')}
                  maxLength={40}
                />
                <TextField
                  label="Your code"
                  value={you.code}
                  onChange={(code) => setYou((s) => ({ ...s, code }))}
                  onBlur={touch('youCode')}
                  error={show('youCode')}
                  secret
                  note="8+ letters or numbers. A phrase only you'd think of."
                />
              </div>

              <div className={styles.connector} aria-hidden="true">
                <span className={styles.connectorLine} />
                <span className={styles.connectorGlyph}>
                  <LinkIcon />
                </span>
                <span className={styles.connectorLine} />
              </div>

              <div className={styles.seat} role="group" aria-labelledby="seat-partner">
                <span className={styles.seatLabel} id="seat-partner">
                  Your partner
                </span>
                <TextField
                  label="Their name"
                  value={partner.name}
                  onChange={(name) => setPartner((s) => ({ ...s, name }))}
                  onBlur={touch('partnerName')}
                  error={show('partnerName')}
                  maxLength={40}
                />
                <TextField
                  label="Their code"
                  value={partner.code}
                  onChange={(code) => setPartner((s) => ({ ...s, code }))}
                  onBlur={touch('partnerCode')}
                  error={show('partnerCode')}
                  secret
                  note="Something they'll remember without writing it down."
                />
              </div>
            </div>

            <label className={styles.checkbox}>
              <input type="checkbox" checked={sharedDevice} onChange={(e) => setSharedDevice(e.target.checked)} />
              <span>This isn't my phone</span>
            </label>

            <p className={styles.warning}>
              <strong>There's no password reset.</strong> Nothing here uses an email or phone number, so a forgotten
              code can't be recovered from inside the app. Make sure you'll both remember yours.
            </p>

            {serverError && (
              <p className={styles.serverError} role="alert">
                {serverError}
              </p>
            )}

            <button type="submit" className={styles.submit} disabled={isCreating}>
              {isCreating ? <Spinner size={16} thickness={2} /> : 'Create room'}
            </button>
          </motion.form>
        )}
      </main>
    </div>
  );
}

function Handover({
  handle,
  partner,
  signedIn,
  onEnter,
}: {
  handle: string;
  partner: Seat;
  signedIn: boolean;
  onEnter: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(handle);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked — the link is shown in full to copy by hand.
    }
  }

  return (
    <motion.div
      className={styles.card}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <h1 className={styles.title}>Your room is ready</h1>
      <p className={styles.lede}>Here's everything {partner.name} needs. Tell them in person or on a call.</p>

      <dl className={styles.handover}>
        <div className={styles.handoverRow}>
          <dt>Link</dt>
          <dd>
            {/* Breaks after "/r/" if it has to wrap, rather than mid-word. */}
            <span className={styles.handoverValue}>
              {link.replace(/^https?:\/\//, '').replace(`/r/${handle}`, '/r/')}
              <wbr />
              {handle}
            </span>
            <button type="button" className={styles.copy} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </dd>
        </div>
        <div className={styles.handoverRow}>
          <dt>Room</dt>
          <dd className={styles.handoverValue}>{handle}</dd>
        </div>
        <div className={styles.handoverRow}>
          <dt>Their code</dt>
          <dd className={`${styles.handoverValue} ${styles.code}`}>{partner.code.trim()}</dd>
        </div>
      </dl>

      <p className={styles.note}>
        Once they're in, they can change their code from Settings — after that, only they will know it. Capitals and
        spaces never matter when typing either one.
      </p>

      {!signedIn && (
        <p className={styles.serverError}>
          The room was created, but signing you in automatically didn't work. Sign in with your room name and code.
        </p>
      )}

      <button type="button" className={styles.submit} onClick={onEnter}>
        {signedIn ? 'Go to your room' : 'Sign in'}
      </button>
    </motion.div>
  );
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  note,
  placeholder,
  maxLength = 128,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error: string | null;
  note?: React.ReactNode;
  placeholder?: string;
  maxLength?: number;
  secret?: boolean;
}) {
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`${styles.input} ${error ? styles.inputError : ''} ${secret ? styles.inputSecret : ''}`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize={secret ? 'off' : 'words'}
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error || note ? messageId : undefined}
      />
      {error ? (
        <p className={styles.fieldError} id={messageId}>
          {error}
        </p>
      ) : note ? (
        <p className={styles.fieldNote} id={messageId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
