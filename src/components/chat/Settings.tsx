import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/context/ChatContext';
import { useEncryption } from '@/context/EncryptionContext';
import { supabase } from '@/lib/supabaseClient';
import { forgetRememberedRoom, functionErrorMessage, inviteLink } from '@/lib/rooms';
import styles from './Settings.module.scss';

const FORGET_CONFIRM_WINDOW_MS = 2600;

export function Settings({ onClose }: { onClose: () => void }) {
  const { isSupported, hasKey, isEnabled, setPassphrase, setEnabled, forgetKey } = useEncryption();
  const { room, me, other, myRole, setDisplayName } = useChat();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();

  const [passphraseInput, setPassphraseInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const forgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [nameInput, setNameInput] = useState(me.name === myRole ? '' : me.name);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameJustSaved, setNameJustSaved] = useState(false);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(
    () => () => {
      if (forgetTimer.current) clearTimeout(forgetTimer.current);
    },
    [],
  );

  const link = inviteLink(room.handle);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (older browser, or no permission) — the link is
      // shown in full right beside the button, so it can be copied by hand.
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!nameInput.trim() || isSavingName) return;
    setIsSavingName(true);
    try {
      const ok = await setDisplayName(nameInput.trim());
      if (ok) {
        setNameJustSaved(true);
        setTimeout(() => setNameJustSaved(false), 3000);
      }
    } finally {
      setIsSavingName(false);
    }
  }

  async function handleSavePassphrase(e: React.FormEvent) {
    e.preventDefault();
    if (!passphraseInput.trim() || isSaving || !room.isLoaded) return;
    setIsSaving(true);
    try {
      await setPassphrase(passphraseInput.trim(), room.encryptionSalt);
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
        aria-label="Settings"
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <h3 className={styles.sectionTitle}>Your room</h3>
        <div className={styles.section}>
          <div className={styles.label}>Room name</div>
          <div className={styles.roomName}>{room.handle}</div>
          <div className={styles.linkRow}>
            <span className={styles.linkText}>{link}</span>
            <button type="button" className={styles.saveButton} onClick={handleCopyLink}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className={styles.hint}>
            Opening this link fills in the room name, so {other.name} only needs their code. The link isn't a secret —
            the codes are.
          </p>
        </div>

        <h3 className={styles.sectionTitle}>Profile</h3>
        <div className={styles.section}>
          <label className={styles.label} htmlFor="settings-name">
            Your name
          </label>
          <form className={styles.passphraseRow} onSubmit={handleSaveName}>
            <input
              id="settings-name"
              className={styles.passphraseInput}
              type="text"
              maxLength={40}
              autoComplete="off"
              placeholder={`Currently "${me.name}"`}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <button type="submit" className={styles.saveButton} disabled={!nameInput.trim() || isSavingName}>
              {isSavingName ? 'Saving…' : 'Save'}
            </button>
          </form>
          {nameJustSaved && <p className={styles.confirmation}>Saved.</p>}
          <p className={styles.hint}>Shown to {other.name} at the top of your chat.</p>
        </div>

        <ChangeCode />

        <h3 className={styles.sectionTitle}>Privacy</h3>

        {!isSupported ? (
          <p className={styles.unsupported}>
            This browser doesn't support the Web Crypto API this feature needs, so message encryption isn't available
            here.
          </p>
        ) : (
          <>
            <p className={styles.intro}>
              Optionally encrypt messages in this browser before they're sent — the server only ever stores scrambled
              ciphertext. Photos and voice notes are always encrypted this way, so they need a passphrase too. Both of
              you enter the exact same one, agreed on some other way (in person, a call — never through this app).
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
                <button
                  type="submit"
                  className={styles.saveButton}
                  disabled={!passphraseInput.trim() || isSaving || !room.isLoaded}
                >
                  {isSaving ? 'Saving…' : !room.isLoaded ? 'Loading…' : 'Save'}
                </button>
              </form>
              {justSaved && <p className={styles.confirmation}>Saved. Encryption uses this passphrase now.</p>}
              <p className={styles.hint}>
                Stored only on this device. If you both forget it, anything encrypted with it is gone for good — there's
                no reset.
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

        <DeleteRoom
          handle={room.handle}
          otherName={other.name}
          onDeleted={() => {
            forgetRememberedRoom();
            logout();
            navigate('/', { replace: true });
          }}
        />
      </motion.div>
    </div>
  );
}

/**
 * Asks for the current code as well as the new one. A signed-in session on
 * its own isn't enough — otherwise anyone who picked up a phone you'd left
 * signed in could change your code and lock you out of your own room.
 */
function ChangeCode() {
  const { other } = useChat();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || isSaving || !current.trim() || !next.trim()) return;
    setIsSaving(true);
    setError(null);
    setDone(false);
    try {
      const { error: invokeError } = await supabase.functions.invoke('change-code', {
        body: { currentCode: current, newCode: next },
      });
      if (invokeError) {
        const { message } = await functionErrorMessage(invokeError, "Your code couldn't be changed. Please try again.");
        setError(message);
        return;
      }
      setCurrent('');
      setNext('');
      setDone(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <h3 className={styles.sectionTitle}>Your code</h3>
      <div className={styles.section}>
        <form onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="current-code">
            Current code
          </label>
          <input
            id="current-code"
            className={styles.stackInput}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <label className={styles.label} htmlFor="new-code">
            New code
          </label>
          <input
            id="new-code"
            className={styles.stackInput}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Something only you'd remember"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <button type="submit" className={styles.saveButton} disabled={isSaving || !current.trim() || !next.trim()}>
            {isSaving ? 'Changing…' : 'Change code'}
          </button>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className={styles.confirmation}>Changed. Any other phone you'd left signed in has been signed out.</p>
          )}
          <p className={styles.hint}>
            At least 8 letters or numbers, and not your names or the room's. {other.name} will see that you changed it,
            but never the code itself.
          </p>
        </form>
      </div>
    </>
  );
}

function DeleteRoom({ handle, otherName, onDeleted }: { handle: string; otherName: string; onDeleted: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [typedHandle, setTypedHandle] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke('delete-room', {
        body: { currentCode: code, confirmHandle: typedHandle },
      });
      if (invokeError) {
        const { message } = await functionErrorMessage(invokeError, "The room couldn't be deleted. Please try again.");
        setError(message);
        return;
      }
      onDeleted();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className={styles.dangerZone}>
      {!isOpen ? (
        <button type="button" className={styles.forgetButton} onClick={() => setIsOpen(true)}>
          Delete this room…
        </button>
      ) : (
        <form onSubmit={handleSubmit}>
          <p className={styles.dangerText}>
            This permanently erases every message, photo and voice note — yours <strong>and {otherName}'s</strong> — and
            both of your codes. There's no undo.
          </p>
          <label className={styles.label} htmlFor="delete-code">
            Your code
          </label>
          <input
            id="delete-code"
            className={styles.stackInput}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <label className={styles.label} htmlFor="delete-handle">
            Type the room name, <strong>{handle}</strong>, to confirm
          </label>
          <input
            id="delete-handle"
            className={styles.stackInput}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={typedHandle}
            onChange={(e) => setTypedHandle(e.target.value)}
          />
          <div className={styles.dangerActions}>
            <button type="button" className={styles.cancelButton} onClick={() => setIsOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.deleteButton}
              disabled={isDeleting || !code.trim() || typedHandle.trim().toLowerCase() !== handle}
            >
              {isDeleting ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
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
