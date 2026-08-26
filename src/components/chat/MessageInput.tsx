import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@/context/ChatContext';
import { useEncryption } from '@/context/EncryptionContext';
import { useDecryptedMessage } from '@/hooks/useDecryptedMessage';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { prepareImage, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { MAX_MESSAGE_LENGTH } from '@/utils/constants';
import { Spinner } from '@/components/common/Spinner';
import styles from './MessageInput.module.scss';

export function MessageInput() {
  const { sendMessage, notifyTyping, editingMessage, editMessage, cancelEdit, replyingTo, cancelReply } = useChat();
  const { hasKey } = useEncryption();
  const recorder = useVoiceRecorder();
  const [value, setValue] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = Boolean(editingMessage);
  // The controls are shown whether or not a passphrase exists, and explain
  // themselves when tapped without one. Hiding them until a key was set
  // meant the feature was simply invisible, with nothing to indicate it
  // existed or what unlocked it.
  const canAttach = !isEditing;

  /** Attachments are always encrypted, so a key is required to send one. */
  function requireKey(): boolean {
    if (hasKey) return true;
    setAttachError('Photos and voice notes are always encrypted. Set a passphrase in Settings first — you both need the same one.');
    return false;
  }

  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.text);
      textareaRef.current?.focus();
      requestAnimationFrame(resize);
    }
  }, [editingMessage]);

  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (!isEditing) notifyTyping();
    requestAnimationFrame(resize);
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (editingMessage) {
      editMessage(editingMessage.id, trimmed);
    } else {
      sendMessage(trimmed, replyingTo ?? undefined);
      if (replyingTo) cancelReply();
    }
    setValue('');
    requestAnimationFrame(resize);
  }

  async function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice in a row still fires
    // a change event.
    e.target.value = '';
    if (!file) return;

    setAttachError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError('That photo is too large to send.');
      return;
    }

    setIsPreparing(true);
    try {
      const draft = await prepareImage(file);
      sendMessage(value.trim(), replyingTo ?? undefined, draft);
      if (replyingTo) cancelReply();
      setValue('');
      requestAnimationFrame(resize);
    } catch {
      setAttachError("That photo couldn't be prepared. Try another one.");
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleStopRecording() {
    const draft = await recorder.stop();
    if (!draft) return;
    sendMessage(value.trim(), replyingTo ?? undefined, draft);
    if (replyingTo) cancelReply();
    setValue('');
    requestAnimationFrame(resize);
  }

  function handleCancelEdit() {
    cancelEdit();
    setValue('');
    requestAnimationFrame(resize);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      if (isEditing) handleCancelEdit();
      else if (replyingTo) cancelReply();
    }
  }

  return (
    <div className={styles.wrap}>
      {isEditing && (
        <div className={styles.editingBanner}>
          <span>Editing message</span>
          <button type="button" onClick={handleCancelEdit} className={styles.editingCancel}>
            Cancel
          </button>
        </div>
      )}
      {!isEditing && replyingTo && <ReplyPreviewBanner replyToId={replyingTo} onCancel={cancelReply} />}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.field}>
          {canAttach && (
            <button
              type="button"
              className={styles.attachButton}
              onClick={() => {
                setAttachError(null);
                if (requireKey()) fileInputRef.current?.click();
              }}
              disabled={isPreparing || recorder.isRecording}
              aria-label="Send a photo"
            >
              {isPreparing ? <Spinner size={16} thickness={2} /> : <PhotoIcon />}
            </button>
          )}
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={recorder.isRecording ? 'Recording…' : 'Message'}
            rows={1}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            autoComplete="off"
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={recorder.isRecording}
          />
        </div>

        {/* While recording, the send button becomes "stop and send" — the
            recording itself is the message. */}
        {recorder.isRecording ? (
          <>
            <button
              type="button"
              className={styles.cancelRecordButton}
              onClick={recorder.cancel}
              aria-label="Discard recording"
            >
              <CloseIcon />
            </button>
            <button
              type="button"
              className={styles.sendButton}
              onClick={handleStopRecording}
              aria-label="Send voice note"
            >
              <SendIcon />
            </button>
          </>
        ) : canAttach && !value.trim() ? (
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => {
              setAttachError(null);
              if (requireKey()) void recorder.start();
            }}
            disabled={recorder.state === 'requesting'}
            aria-label="Record a voice note"
          >
            {recorder.state === 'requesting' ? <Spinner size={16} thickness={2} /> : <MicIcon />}
          </button>
        ) : (
          <button
            type="submit"
            className={styles.sendButton}
            disabled={!value.trim()}
            aria-label={isEditing ? 'Save edit' : 'Send message'}
          >
            {isEditing ? <CheckIcon /> : <SendIcon />}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.fileInput}
          onChange={handlePickImage}
          tabIndex={-1}
        />
      </form>

      {recorder.isRecording && (
        <p className={styles.recordingHint}>
          <span className={styles.recordingDot} aria-hidden="true" />
          {formatElapsed(recorder.elapsedMs)} · tap send when you're done
        </p>
      )}
      {recorder.state === 'denied' && (
        <p className={styles.attachError} role="alert">
          Microphone access was refused, so voice notes can't be recorded on this device.
        </p>
      )}
      {attachError && (
        <p className={styles.attachError} role="alert">
          {attachError}
        </p>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function PhotoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
      <path d="M21 16l-5-5-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function ReplyPreviewBanner({ replyToId, onCancel }: { replyToId: string; onCancel: () => void }) {
  const { messages, myRole, other } = useChat();
  const original = messages.find((m) => m.id === replyToId);
  const decrypted = useDecryptedMessage(original?.text ?? '');

  let previewText = 'Message unavailable';
  if (original) {
    if (original.deletedAt) previewText = 'This message was deleted';
    else if (decrypted.status === 'plain' || decrypted.status === 'decrypted') previewText = decrypted.text;
    else if (decrypted.status === 'locked') previewText = '🔒 Locked message';
    else if (decrypted.status === 'failed') previewText = 'Unable to decrypt';
    else previewText = '···';
  }

  return (
    <div className={styles.replyBanner}>
      <div className={styles.replyBannerContent}>
        <span className={styles.replyBannerSender}>
          Replying to {original ? (original.senderRole === myRole ? 'yourself' : other.name) : '…'}
        </span>
        <span className={styles.replyBannerText}>{previewText}</span>
      </div>
      <button type="button" onClick={onCancel} className={styles.replyBannerCancel} aria-label="Cancel reply">
        <CancelIcon />
      </button>
    </div>
  );
}

function CancelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12l16-7-7 16-2.5-6.5L4 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
