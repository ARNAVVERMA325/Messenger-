import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/context/ChatContext';
import { useEncryption } from '@/context/EncryptionContext';
import { formatLastSeen } from '@/utils/formatTime';
import { Settings } from './Settings';
import styles from './ChatHeader.module.scss';

export function ChatHeader() {
  const { other, typingRole, otherRole } = useChat();
  const { logout } = useAuth();
  const { isEnabled: encryptionEnabled } = useEncryption();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const isTyping = typingRole === otherRole;

  return (
    <header className={styles.header}>
      <div className={styles.avatarWrap}>
        <div className={styles.avatar} aria-hidden="true">
          {other.initials}
        </div>
        <span className={`${styles.presenceDot} ${other.isOnline ? styles.online : ''}`} aria-hidden="true" />
      </div>

      <div className={styles.identity}>
        <span className={styles.name}>{other.name}</span>
        <span className={styles.status}>
          {isTyping ? (
            <span className={styles.typingDots} aria-label={`${other.name} is typing`}>
              <span />
              <span />
              <span />
            </span>
          ) : (
            <span className={styles.statusText}>
              {other.isOnline ? 'Online' : formatLastSeen(other.lastSeenAt)}
            </span>
          )}
        </span>
      </div>

      <button
        type="button"
        className={styles.iconButton}
        onClick={() => setIsSettingsOpen(true)}
        aria-label="Settings"
      >
        <LockIcon filled={encryptionEnabled} />
      </button>

      <button
        type="button"
        className={`${styles.iconButton} ${styles.iconButtonDanger}`}
        onClick={logout}
        aria-label="Leave chat"
      >
        <LeaveIcon />
      </button>

      <AnimatePresence>{isSettingsOpen && <Settings onClose={() => setIsSettingsOpen(false)} />}</AnimatePresence>
    </header>
  );
}

function LockIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.15 : 0}
      />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 17l5-5-5-5M20 12H9M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
