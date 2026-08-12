import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ConnectionStatus, Message, Participant, SideRole } from '@/types';
import { PARTICIPANTS, createMockMessages } from '@/data/mockData';
import { createId } from '@/utils/id';

/**
 * PHASE 1 NOTICE — message sending/receiving/typing here is simulated
 * entirely on the client (in-memory + timers) so the full interaction design
 * — bubbles, statuses, typing, unread — can be reviewed before any backend
 * exists. Connection status is the one piece that's already real: it's
 * driven by the browser's actual online/offline events.
 *
 * Phase 2 replaces the simulated parts with a real backend: sendMessage()
 * will call the backend instead of pushing into local state, and messages/
 * typing/read-receipts will stream in over a realtime subscription instead
 * of setTimeout. The shape of this context is intentionally kept small so
 * that swap doesn't ripple through the UI components.
 */

const CANNED_REPLIES: Record<SideRole, string[]> = {
  A: ["on it", "omw", "😊", "can't wait", "tell me everything"],
  B: ['okay!', 'one sec', '❤️', "I'll call you after", 'same honestly'],
};

interface ChatContextValue {
  myRole: SideRole;
  otherRole: SideRole;
  me: Participant;
  other: Participant;
  messages: Message[];
  typingRole: SideRole | null;
  connectionStatus: ConnectionStatus;
  unreadCount: number;
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  loadMoreHistory: () => void;
  sendMessage: (text: string) => void;
  deleteMessage: (id: string) => void;
  editMessage: (id: string, text: string) => void;
  clearUnread: () => void;
  notifyTyping: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ myRole, children }: { myRole: SideRole; children: ReactNode }) {
  const otherRole: SideRole = myRole === 'A' ? 'B' : 'A';

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [typingRole, setTypingRole] = useState<SideRole | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const typingNotifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const track = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay);
    timers.current.push(id);
    return id;
  }, []);

  // Simulated initial history fetch (Phase 2: real network request).
  useEffect(() => {
    setIsLoadingHistory(true);
    const id = setTimeout(() => {
      setMessages(createMockMessages());
      setIsLoadingHistory(false);
      setHasMoreHistory(false); // demo dataset has no further pages
    }, 700);
    return () => clearTimeout(id);
  }, []);

  // Real connection status: browser online/offline events.
  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus('connecting');
      track(() => setConnectionStatus('online'), 900);
    };
    const handleOffline = () => setConnectionStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [track]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      if (typingNotifyTimer.current) clearTimeout(typingNotifyTimer.current);
    };
  }, []);

  const loadMoreHistory = useCallback(() => {
    // Demo dataset is finite; Phase 2 will page through real history here.
    setHasMoreHistory(false);
  }, []);

  const simulateReply = useCallback(() => {
    track(() => setTypingRole(otherRole), 500 + Math.random() * 400);

    track(
      () => {
        setTypingRole(null);
        const replies = CANNED_REPLIES[otherRole];
        const text = replies[Math.floor(Math.random() * replies.length)];
        const reply: Message = {
          id: createId(),
          senderRole: otherRole,
          text,
          createdAt: Date.now(),
          status: 'delivered',
        };
        setMessages((prev) => [...prev, reply]);
        setUnreadCount((prev) => prev + 1);
      },
      1600 + Math.random() * 900,
    );
  }, [otherRole, track]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const id = createId();
      const message: Message = {
        id,
        senderRole: myRole,
        text: trimmed,
        createdAt: Date.now(),
        status: connectionStatus === 'offline' ? 'sending' : 'sent',
      };
      setMessages((prev) => [...prev, message]);

      if (connectionStatus === 'offline') return;

      track(() => {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'delivered' } : m)));
      }, 500);

      track(() => {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'read' } : m)));
      }, 1400);

      if (Math.random() < 0.7) simulateReply();
    },
    [connectionStatus, myRole, track, simulateReply],
  );

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const editMessage = useCallback((id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: trimmed, editedAt: Date.now() } : m)));
  }, []);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  // Lets the message input trigger a brief "typing" flicker on the other
  // side, purely as an interaction demo until real presence exists.
  const notifyTyping = useCallback(() => {
    if (Math.random() > 0.35) return;
    if (typingNotifyTimer.current) return;
    track(() => setTypingRole(otherRole), 700);
    typingNotifyTimer.current = setTimeout(() => {
      setTypingRole(null);
      typingNotifyTimer.current = null;
    }, 1800);
  }, [otherRole, track]);

  const value = useMemo<ChatContextValue>(
    () => ({
      myRole,
      otherRole,
      me: { ...PARTICIPANTS[myRole], isOnline: true, lastSeenAt: Date.now() },
      other: PARTICIPANTS[otherRole],
      messages,
      typingRole,
      connectionStatus,
      unreadCount,
      isLoadingHistory,
      hasMoreHistory,
      loadMoreHistory,
      sendMessage,
      deleteMessage,
      editMessage,
      clearUnread,
      notifyTyping,
    }),
    [
      myRole,
      otherRole,
      messages,
      typingRole,
      connectionStatus,
      unreadCount,
      isLoadingHistory,
      hasMoreHistory,
      loadMoreHistory,
      sendMessage,
      deleteMessage,
      editMessage,
      clearUnread,
      notifyTyping,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
