import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Message } from '@/types';
import { useChat } from '@/context/ChatContext';
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
  const { beginEdit, deleteMessage, retryMessage } = useChat();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isEditable = isOwn && message.status !== 'sending' && message.status !== 'failed';

  function handleBubbleTap(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isEditable) return;
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

  return (
    <motion.div
      className={`${styles.row} ${isOwn ? styles.sent : styles.received}`}
      layout="position"
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.column}>
        <button
          type="button"
          className={styles.bubbleButton}
          onClick={handleBubbleTap}
          disabled={!isEditable}
          aria-haspopup={isEditable ? 'true' : undefined}
          aria-expanded={isEditable ? isActive : undefined}
        >
          <div className={styles.bubble}>
            {message.text}
            {message.editedAt && <span className={styles.edited}> (edited)</span>}
          </div>
        </button>

        <div className={styles.meta}>
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

        {isActive && isEditable && (
          <div className={styles.actions}>
            <button type="button" className={styles.actionPill} onClick={handleEditTap}>
              Edit
            </button>
            <button
              type="button"
              className={`${styles.actionPill} ${confirmingDelete ? styles.actionPillDanger : ''}`}
              onClick={handleDeleteTap}
            >
              {confirmingDelete ? 'Tap again to delete' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    </motion.div>
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
