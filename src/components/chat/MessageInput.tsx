import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@/context/ChatContext';
import { useDecryptedMessage } from '@/hooks/useDecryptedMessage';
import { MAX_MESSAGE_LENGTH } from '@/utils/constants';
import styles from './MessageInput.module.scss';

export function MessageInput() {
  const { sendMessage, notifyTyping, editingMessage, editMessage, cancelEdit, replyingTo, cancelReply } = useChat();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEditing = Boolean(editingMessage);

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
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Message"
            rows={1}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            autoComplete="off"
            maxLength={MAX_MESSAGE_LENGTH}
          />
        </div>
        <button
          type="submit"
          className={styles.sendButton}
          disabled={!value.trim()}
          aria-label={isEditing ? 'Save edit' : 'Send message'}
        >
          {isEditing ? <CheckIcon /> : <SendIcon />}
        </button>
      </form>
    </div>
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
