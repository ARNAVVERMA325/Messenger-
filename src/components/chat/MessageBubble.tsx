import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Message } from '@/types';
import { useChat } from '@/context/ChatContext';
import { useDecryptedMessage } from '@/hooks/useDecryptedMessage';
import { AttachmentView } from './AttachmentView';
import { isEncryptedContent } from '@/lib/crypto';
import { formatMessageTime } from '@/utils/formatTime';
import styles from './MessageBubble.module.scss';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  isActive: boolean;
  onToggleActive: (id: string | null) => void;
}

const DELETE_CONFIRM_WINDOW_MS = 2600;

export function MessageBubble({ message, isOwn, isActive, onToggleActive }: MessageBubbleProps) {
  const prefersReducedMotion = useReducedMotion();
  const { beginEdit, beginReply, deleteMessage, retryMessage } = useChat();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decrypted = useDecryptedMessage(message.text);
  const isEncrypted = isEncryptedContent(message.text);

  useEffect(() => {
    if (!isActive && confirmingDelete) setConfirmingDelete(false);
  }, [isActive, confirmingDelete]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  if (message.deletedAt) {
    return (
      <div className={`${styles.row} ${isOwn ? styles.sent : styles.received}`}>
        <div className={`${styles.bubble} ${styles.deletedBubble}`}>
          <span className={styles.deletedText}>This message was deleted</span>
        </div>
      </div>
    );
  }

  // A still-sending or failed-to-send message keeps its client-only
  // "temp:" id until the server confirms it — replying/editing/deleting it
  // before then has nothing real to point at yet.
  const hasRealId = !message.id.startsWith('temp:');
  const canInteract = hasRealId && (decrypted.status === 'plain' || decrypted.status === 'decrypted');
  const canDelete = isOwn && canInteract;
  // Editing rewrites the message's text, so a photo or voice note sent
  // without a caption has nothing to edit. Deleting it is still yours to do,
  // which is why the two are separate.
  const canEdit = canDelete && Boolean(message.text);

  function handleBubbleKeyDown(e: React.KeyboardEvent) {
    // Only when the bubble itself has focus — otherwise Enter on a nested
    // control (play, view photo) would also toggle the actions menu.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (canInteract) onToggleActive(isActive ? null : message.id);
    }
  }

  function handleBubbleTap(e: React.MouseEvent) {
    e.stopPropagation();
    if (!canInteract) return;
    onToggleActive(isActive ? null : message.id);
  }

  function handleDeleteTap(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRM_WINDOW_MS);
      return;
    }
    deleteMessage(message.id);
    onToggleActive(null);
  }

  function handleEditTap(e: React.MouseEvent) {
    e.stopPropagation();
    beginEdit(message.id);
    onToggleActive(null);
  }

  function handleReplyTap(e: React.MouseEvent) {
    e.stopPropagation();
    beginReply(message.id);
    onToggleActive(null);
  }

  return (
    <motion.div
      className={`${styles.row} ${isOwn ? styles.sent : styles.received}`}
      layout="position"
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.column}>
        {/* Deliberately a div, not a button. Attachments put real buttons
            inside the bubble (view photo, play voice note), and a <button>
            inside a <button> is invalid HTML with undefined event
            behaviour — it's what made the photo overlay reopen itself.
            Keyboard access is preserved through the explicit key handler. */}
        <div
          className={styles.bubbleButton}
          onClick={handleBubbleTap}
          onKeyDown={handleBubbleKeyDown}
          role={canInteract ? 'button' : undefined}
          tabIndex={canInteract ? 0 : undefined}
          aria-haspopup={canInteract ? 'true' : undefined}
          aria-expanded={canInteract ? isActive : undefined}
        >
          <div className={styles.bubble}>
            {message.replyToId && <ReplyQuote replyToId={message.replyToId} />}
            {message.attachment && (
              <div className={styles.attachment}>
                <AttachmentView attachment={message.attachment} />
              </div>
            )}
            {/* A photo or voice note can travel without a caption, in which
                case there is no text row to render at all. */}
            {(message.text || !message.attachment) && <BubbleContent decrypted={decrypted} />}
            {message.editedAt && <span className={styles.edited}> (edited)</span>}
          </div>
        </div>

        <div className={styles.meta}>
          {isEncrypted && (
            <span className={styles.lockIcon} aria-label="Encrypted" title="Encrypted">
              <LockIcon />
            </span>
          )}
          <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
          {isOwn && (
            <span className={styles.ticks}>
              <StatusIcon status={message.status} />
            </span>
          )}
        </div>

        {message.status === 'failed' && (
          <button
            type="button"
            className={styles.retryNotice}
            onClick={(e) => {
              e.stopPropagation();
              retryMessage(message.id);
            }}
          >
            Not delivered — tap to retry
          </button>
        )}

        {isActive && canInteract && (
          <div className={styles.actions}>
            <button type="button" className={styles.actionPill} onClick={handleReplyTap}>
              Reply
            </button>
            {canEdit && (
              <button type="button" className={styles.actionPill} onClick={handleEditTap}>
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className={`${styles.actionPill} ${confirmingDelete ? styles.actionPillDanger : ''}`}
                onClick={handleDeleteTap}
              >
                {confirmingDelete ? 'Tap again to delete' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ReplyQuote({ replyToId }: { replyToId: string }) {
  const { messages, myRole, other } = useChat();
  const original = messages.find((m) => m.id === replyToId);
  const decrypted = useDecryptedMessage(original?.text ?? '');

  if (!original) {
    return (
      <div className={styles.replyQuote}>
        <span className={styles.replyQuoteText}>Original message unavailable</span>
      </div>
    );
  }

  const senderName = original.senderRole === myRole ? 'You' : other.name;
  let previewText: string;
  if (original.deletedAt) previewText = 'This message was deleted';
  else if (decrypted.status === 'plain' || decrypted.status === 'decrypted') previewText = decrypted.text;
  else if (decrypted.status === 'locked') previewText = '🔒 Locked message';
  else if (decrypted.status === 'failed') previewText = 'Unable to decrypt';
  else previewText = '···';

  return (
    <div className={styles.replyQuote}>
      <span className={styles.replyQuoteSender}>{senderName}</span>
      <span className={styles.replyQuoteText}>{previewText}</span>
    </div>
  );
}

function BubbleContent({ decrypted }: { decrypted: ReturnType<typeof useDecryptedMessage> }) {
  switch (decrypted.status) {
    case 'plain':
    case 'decrypted':
      return <>{decrypted.text}</>;
    case 'decrypting':
      return <span className={styles.placeholderText}>· · ·</span>;
    case 'locked':
      return <span className={styles.placeholderText}>🔒 Enter your passphrase in Privacy settings to read this</span>;
    case 'failed':
      return <span className={styles.placeholderText}>Unable to decrypt this message</span>;
  }
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-label="Sending">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.5" />
          <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'sent':
      return (
        <svg width="14" height="12" viewBox="0 0 16 12" fill="none" aria-label="Sent">
          <path d="M2 6.5l3.5 3.5L14 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'delivered':
      return (
        <svg width="18" height="12" viewBox="0 0 20 12" fill="none" aria-label="Delivered">
          <path d="M1 6.5L4.5 10 12 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 6.5L10.5 10 18 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'read':
      return (
        <svg width="18" height="12" viewBox="0 0 20 12" fill="none" aria-label="Read" className={styles.ticksRead}>
          <path d="M1 6.5L4.5 10 12 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 6.5L10.5 10 18 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'failed':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-label="Failed to send">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v6M12 16.5v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
