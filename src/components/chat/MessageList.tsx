import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useChat } from '@/context/ChatContext';
import { groupByDay, formatDateSeparator } from '@/utils/formatTime';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { TypingIndicator } from './TypingIndicator';
import { EmptyState } from './EmptyState';
import { MessageListSkeleton } from '@/components/common/Skeleton';
import styles from './MessageList.module.scss';

const BOTTOM_THRESHOLD_PX = 96;

export function MessageList() {
  const { myRole, other, otherRole, messages, typingRole, isLoadingHistory, hasMoreHistory, loadMoreHistory, unreadCount, clearUnread } =
    useChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCount = useRef(0);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const isTyping = typingRole === otherRole;

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < BOTTOM_THRESHOLD_PX;
    isNearBottomRef.current = nearBottom;
    setShowJumpButton(!nearBottom && unreadCount > 0);
    if (nearBottom && unreadCount > 0) clearUnread();
  }, [unreadCount, clearUnread]);

  // Scroll to bottom once initial history finishes loading.
  useEffect(() => {
    if (!isLoadingHistory) {
      requestAnimationFrame(() => scrollToBottom(false));
      prevMessageCount.current = messages.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingHistory]);

  // New messages: auto-scroll if already near the bottom, otherwise surface the jump button.
  useEffect(() => {
    if (isLoadingHistory) return;
    const grew = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;
    if (!grew) return;

    if (isNearBottomRef.current) {
      scrollToBottom(true);
      if (unreadCount > 0) clearUnread();
    } else {
      setShowJumpButton(true);
    }
  }, [messages.length, isLoadingHistory, scrollToBottom, unreadCount, clearUnread]);

  useEffect(() => {
    if (isNearBottomRef.current) scrollToBottom(true);
  }, [isTyping, scrollToBottom]);

  // Infinite scroll upward for older history.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || !hasMoreHistory) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreHistory();
      },
      { root: scrollRef.current, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreHistory, loadMoreHistory]);

  function handleJumpClick() {
    scrollToBottom(true);
    clearUnread();
    setShowJumpButton(false);
  }

  if (isLoadingHistory) {
    return (
      <div className={styles.listWrap}>
        <MessageListSkeleton />
      </div>
    );
  }

  const dayGroups = groupByDay(messages);

  return (
    <div className={styles.listWrap}>
      {messages.length === 0 ? (
        <EmptyState otherName={other.name} />
      ) : (
        <div className={styles.scrollArea} ref={scrollRef} onScroll={handleScroll}>
          <div ref={topSentinelRef} className={styles.sentinel} />
          {hasMoreHistory && <div className={styles.loadingMore}>Loading earlier messages…</div>}

          {dayGroups.map((group) => (
            <div key={group.dayKey}>
              <DateSeparator label={formatDateSeparator(group.items[0].createdAt)} />
              {group.items.map((message) => (
                <MessageBubble key={message.id} message={message} isOwn={message.senderRole === myRole} />
              ))}
            </div>
          ))}

          <AnimatePresence>{isTyping && <TypingIndicator name={other.name} />}</AnimatePresence>
        </div>
      )}

      {showJumpButton && (
        <button type="button" className={styles.jumpButton} onClick={handleJumpClick}>
          New messages
          {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
        </button>
      )}
    </div>
  );
}
