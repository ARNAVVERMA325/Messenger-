import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useChat } from '@/context/ChatContext';
import { groupByDay, formatDateSeparator } from '@/utils/formatTime';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { UnreadDivider } from './UnreadDivider';
import { TypingIndicator } from './TypingIndicator';
import { EmptyState } from './EmptyState';
import { MessageListSkeleton } from '@/components/common/Skeleton';
import styles from './MessageList.module.scss';

const BOTTOM_THRESHOLD_PX = 96;

export function MessageList() {
  const {
    myRole,
    other,
    otherRole,
    messages,
    initialUnreadMessageId,
    typingRole,
    isLoadingHistory,
    isLoadingMore,
    hasMoreHistory,
    arePastChatsShown,
    loadMoreHistory,
    showPastChats,
    unreadCount,
    clearUnread,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCount = useRef(0);
  const paginationAdjustRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

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
    setShowJumpButton(!nearBottom);
    if (nearBottom && unreadCount > 0) clearUnread();
  }, [unreadCount, clearUnread]);

  // Land on the first unread message (if there is one) instead of always the
  // very bottom — important for anyone who doesn't open this daily: opening
  // it after weeks away should show "here's what's new", not bury it under
  // an auto-scroll straight past it. Falls back to the bottom otherwise.
  useEffect(() => {
    if (isLoadingHistory) return;

    requestAnimationFrame(() => {
      const target = initialUnreadMessageId && document.getElementById(`message-${initialUnreadMessageId}`);
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        isNearBottomRef.current = false;
        setShowJumpButton(true);
      } else {
        scrollToBottom(false);
      }
    });
    prevMessageCount.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingHistory]);

  // Preserve scroll position when older messages are prepended above the viewport.
  useLayoutEffect(() => {
    const pending = paginationAdjustRef.current;
    const el = scrollRef.current;
    if (!pending || !el) return;
    el.scrollTop = el.scrollHeight - pending.scrollHeight + pending.scrollTop;
  }, [messages]);

  // New messages: auto-scroll if already near the bottom, otherwise surface the jump button.
  // Skipped entirely when the growth was actually a pagination prepend (handled above).
  useEffect(() => {
    if (isLoadingHistory) return;
    const wasPrepend = paginationAdjustRef.current !== null;
    paginationAdjustRef.current = null;

    const grew = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;
    if (!grew || wasPrepend) return;

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

  const captureScrollForPrepend = useCallback(() => {
    const el = scrollRef.current;
    if (el) paginationAdjustRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
  }, []);

  const handleLoadMore = useCallback(() => {
    captureScrollForPrepend();
    loadMoreHistory();
  }, [loadMoreHistory, captureScrollForPrepend]);

  const handleShowPastChats = useCallback(() => {
    captureScrollForPrepend();
    showPastChats();
  }, [showPastChats, captureScrollForPrepend]);

  const hasMessages = messages.length > 0;

  // Infinite scroll upward for older history — only once "Show past chats"
  // has been used; before that, older history is deliberately not fetched
  // at all (see FAST_LOAD_LIMIT in ChatContext), so there's nothing to
  // paginate into yet. Re-runs once loading finishes and the empty/skeleton
  // state gives way to the real scroll container — otherwise the sentinel
  // ref is still null from the pre-load render and the observer would
  // never attach for a conversation with a full page.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || !hasMoreHistory || isLoadingHistory || !hasMessages || !arePastChatsShown) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadMore();
      },
      { root: scrollRef.current, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreHistory, handleLoadMore, isLoadingHistory, hasMessages, arePastChatsShown]);

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
        <div
          className={styles.scrollArea}
          ref={scrollRef}
          onScroll={handleScroll}
          onClick={() => setActiveMessageId(null)}
        >
          {hasMoreHistory && !arePastChatsShown ? (
            <div className={styles.showPastChatsRow}>
              <button type="button" className={styles.showPastChatsButton} onClick={handleShowPastChats}>
                Show past chats
              </button>
            </div>
          ) : (
            <div ref={topSentinelRef} className={styles.sentinel} />
          )}
          {isLoadingMore && <div className={styles.loadingMore}>Loading earlier messages…</div>}

          {dayGroups.map((group) => (
            <div key={group.dayKey}>
              <DateSeparator label={formatDateSeparator(group.items[0].createdAt)} />
              {group.items.map((message) => (
                <div key={message.id} id={`message-${message.id}`}>
                  {message.id === initialUnreadMessageId && <UnreadDivider />}
                  <MessageBubble
                    message={message}
                    isOwn={message.senderRole === myRole}
                    isActive={activeMessageId === message.id}
                    onToggleActive={setActiveMessageId}
                  />
                </div>
              ))}
            </div>
          ))}

          <AnimatePresence>{isTyping && <TypingIndicator name={other.name} />}</AnimatePresence>
        </div>
      )}

      {showJumpButton && (
        <button type="button" className={styles.jumpButton} onClick={handleJumpClick}>
          {unreadCount > 0 ? 'New messages' : 'Jump to latest'}
          {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
        </button>
      )}
    </div>
  );
}
