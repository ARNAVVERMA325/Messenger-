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
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { AuthSession, ConnectionStatus, Message, MessageStatus, Participant, SideRole } from '@/types';
import type { MessageRow, RoomMemberRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabaseClient';
import { createId } from '@/utils/id';
import { useEncryption } from '@/context/EncryptionContext';

/**
 * PHASE 2 NOTICE — this is the real thing: messages are stored in Postgres
 * (see supabase/migrations/0001_init.sql), streamed to both clients over a
 * Supabase Realtime channel, and access is enforced by row-level security
 * and SECURITY DEFINER RPC functions — not by anything this file claims
 * about itself. Connection status combines the browser's real online/
 * offline events with the realtime channel's actual subscribe state.
 *
 * The one piece that's still local-only: the "typing…" indicator, sent as
 * an ephemeral realtime broadcast that nothing persists — exactly what
 * you'd want for something this transient.
 */

const PAGE_SIZE = 30;
const TYPING_BROADCAST_THROTTLE_MS = 2000;
const TYPING_INDICATOR_TIMEOUT_MS = 2800;
const PRESENCE_HEARTBEAT_MS = 25_000;

function mapRow(row: MessageRow, myRole: SideRole): Message {
  const isOwn = row.sender_role === myRole;
  let status: MessageStatus = 'sent';
  if (isOwn) {
    if (row.read_at) status = 'read';
    else if (row.delivered_at) status = 'delivered';
  }

  return {
    id: row.id,
    senderRole: row.sender_role,
    text: row.deleted_at ? '' : row.content,
    createdAt: new Date(row.created_at).getTime(),
    status,
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : undefined,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : undefined,
    readAt: row.read_at ? new Date(row.read_at).getTime() : undefined,
  };
}

function upsert(list: Message[], next: Message): Message[] {
  const merged = [...list.filter((m) => m.id !== next.id), next];
  merged.sort((a, b) => a.createdAt - b.createdAt);
  return merged;
}

function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Splits freshly-seen rows from the other side into what needs a delivered vs. read receipt. */
function classifyIncoming(rows: MessageRow[], otherRole: SideRole) {
  const fromOther = rows.filter((r) => r.sender_role === otherRole);
  return {
    undeliveredIds: fromOther.filter((r) => !r.delivered_at).map((r) => r.id),
    unreadIds: fromOther.filter((r) => !r.read_at).map((r) => r.id),
  };
}

interface ChatContextValue {
  myRole: SideRole;
  otherRole: SideRole;
  me: Participant;
  other: Participant;
  messages: Message[];
  initialUnreadMessageId: string | null;
  typingRole: SideRole | null;
  connectionStatus: ConnectionStatus;
  unreadCount: number;
  isLoadingHistory: boolean;
  isLoadingMore: boolean;
  hasMoreHistory: boolean;
  loadMoreHistory: () => void;
  sendMessage: (text: string) => void;
  retryMessage: (tempId: string) => void;
  deleteMessage: (id: string) => void;
  editMessage: (id: string, text: string) => void;
  editingMessage: { id: string; text: string } | null;
  beginEdit: (id: string) => void;
  cancelEdit: () => void;
  clearUnread: () => void;
  notifyTyping: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ session, children }: { session: AuthSession; children: ReactNode }) {
  const { userId, role: myRole } = session;
  const otherRole: SideRole = myRole === 'A' ? 'B' : 'A';
  const { encryptOutgoing, decrypt } = useEncryption();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [typingRole, setTypingRole] = useState<SideRole | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [membersByRole, setMembersByRole] = useState<Partial<Record<SideRole, RoomMemberRow>>>({});
  const [otherOnline, setOtherOnline] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(typeof navigator === 'undefined' || navigator.onLine);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [initialUnreadMessageId, setInitialUnreadMessageId] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAt = useRef(0);
  const hasConnectedOnce = useRef(false);
  const tempTextById = useRef<Map<string, string>>(new Map());

  const markDelivered = useCallback((ids: string[]) => {
    if (!supabase || ids.length === 0) return;
    supabase.rpc('mark_messages_delivered', { p_ids: ids }).then(({ error }) => {
      if (error) console.error('mark_messages_delivered failed', error);
    });
  }, []);

  const markRead = useCallback((ids: string[]) => {
    if (!supabase || ids.length === 0) return;
    supabase.rpc('mark_messages_read', { p_ids: ids }).then(({ error }) => {
      if (error) console.error('mark_messages_read failed', error);
    });
  }, []);

  const markVisibleAsRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const ids = messagesRef.current
      .filter((m) => m.senderRole === otherRole && !m.readAt && !m.deletedAt)
      .map((m) => m.id);
    if (ids.length) markRead(ids);
  }, [otherRole, markRead]);

  // --- Initial history -------------------------------------------------
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      setIsLoadingHistory(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (cancelled) return;
      if (error) {
        console.error('Failed to load message history', error);
        setIsLoadingHistory(false);
        return;
      }

      const rows = ((data ?? []) as MessageRow[]).slice().reverse();
      const mapped = rows.map((row) => mapRow(row, myRole));
      // Merge rather than replace: a realtime message can in principle land
      // in local state moments before this initial fetch resolves.
      setMessages((prev) => prev.reduce(upsert, mapped));
      setHasMoreHistory(rows.length === PAGE_SIZE);
      setIsLoadingHistory(false);

      // Capture "where you left off" before markRead below mutates it —
      // set once per mount and never moved again, so opening the chat
      // after time away lands on what's actually new, not the very
      // bottom. Found within this same fetched page: for someone who's
      // been away long enough to rack up more unread than PAGE_SIZE,
      // this lands on the oldest *loaded* unread message rather than the
      // true first one — scrolling further up (existing pagination)
      // still reaches anything earlier than that.
      const firstUnread = rows.find((r) => r.sender_role === otherRole && !r.read_at && !r.deleted_at);
      setInitialUnreadMessageId(firstUnread?.id ?? null);

      const { undeliveredIds, unreadIds } = classifyIncoming(rows, otherRole);
      if (isPageVisible() && unreadIds.length) markRead(unreadIds);
      else if (undeliveredIds.length) markDelivered(undeliveredIds);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRole, otherRole]);

  // --- Room members (names / last-seen) --------------------------------
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('room_members')
      .select('*')
      .then(({ data, error }) => {
        if (error) return console.error('Failed to load room members', error);
        const map: Partial<Record<SideRole, RoomMemberRow>> = {};
        for (const row of (data ?? []) as RoomMemberRow[]) map[row.role] = row;
        setMembersByRole(map);
      });
  }, []);

  const refetchMember = useCallback((role: SideRole) => {
    if (!supabase) return;
    supabase
      .from('room_members')
      .select('*')
      .eq('role', role)
      .single()
      .then(({ data }) => {
        if (data) setMembersByRole((prev) => ({ ...prev, [role]: data }));
      });
  }, []);

  // --- Realtime: messages + presence + typing ---------------------------
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase.channel('room', {
      config: { private: true, broadcast: { self: false }, presence: { key: myRole } },
    });
    channelRef.current = channel;

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload: RealtimePostgresChangesPayload<MessageRow>) => {
        const row = payload.new as MessageRow;
        setMessages((prev) => upsert(prev, mapRow(row, myRole)));
        if (row.sender_role === otherRole) {
          setUnreadCount((c) => c + 1);
          if (isPageVisible()) markRead([row.id]);
          else markDelivered([row.id]);
        }
      },
    );

    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload: RealtimePostgresChangesPayload<MessageRow>) => {
        const row = payload.new as MessageRow;
        setMessages((prev) => upsert(prev, mapRow(row, myRole)));
      },
    );

    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const role = (payload.payload as { role?: SideRole })?.role;
      if (role !== otherRole) return;
      setTypingRole(otherRole);
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
      typingClearTimer.current = setTimeout(() => setTypingRole(null), TYPING_INDICATOR_TIMEOUT_MS);
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const isOnline = Boolean(state[otherRole]?.length);
      setOtherOnline(isOnline);
      if (!isOnline) refetchMember(otherRole);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setRealtimeReady(true);
        await channel.track({ online_at: new Date().toISOString() });

        if (hasConnectedOnce.current && supabase) {
          // Reconnected after a drop: backfill anything missed while we were away.
          const latest = messagesRef.current.at(-1);
          const cursor = latest ? new Date(latest.createdAt).toISOString() : new Date(0).toISOString();
          const { data } = await supabase.from('messages').select('*').gt('created_at', cursor);
          const rows = (data ?? []) as MessageRow[];
          setMessages((prev) => rows.reduce((acc, row) => upsert(acc, mapRow(row, myRole)), prev));

          const { undeliveredIds, unreadIds } = classifyIncoming(rows, otherRole);
          if (isPageVisible() && unreadIds.length) markRead(unreadIds);
          else if (undeliveredIds.length) markDelivered(undeliveredIds);
        }
        hasConnectedOnce.current = true;
      } else {
        setRealtimeReady(false);
      }
    });

    const heartbeat = setInterval(() => {
      supabase?.rpc('touch_presence').then(({ error }) => {
        if (error) console.error('touch_presence failed', error);
      });
    }, PRESENCE_HEARTBEAT_MS);

    const handleVisibility = () => markVisibleAsRead();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    const handleUnload = () => {
      supabase?.rpc('touch_presence');
    };
    window.addEventListener('pagehide', handleUnload);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('pagehide', handleUnload);
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
      supabase?.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRole, otherRole, markDelivered, markRead, markVisibleAsRead, refetchMember]);

  // --- Browser online/offline (real) ------------------------------------
  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const connectionStatus: ConnectionStatus = !browserOnline ? 'offline' : realtimeReady ? 'online' : 'connecting';

  const loadMoreHistory = useCallback(() => {
    if (!supabase || isLoadingMore || !hasMoreHistory) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;

    setIsLoadingMore(true);
    const cursor = new Date(oldest.createdAt).toISOString();

    supabase
      .from('messages')
      .select('*')
      .lt('created_at', cursor)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load older messages', error);
          setIsLoadingMore(false);
          return;
        }
        const rows = ((data ?? []) as MessageRow[]).slice().reverse();
        setMessages((prev) => {
          const mapped = rows.map((row) => mapRow(row, myRole));
          const existingIds = new Set(prev.map((m) => m.id));
          return [...mapped.filter((m) => !existingIds.has(m.id)), ...prev];
        });
        setHasMoreHistory(rows.length === PAGE_SIZE);
        setIsLoadingMore(false);
      });
  }, [isLoadingMore, hasMoreHistory, myRole]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!supabase) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      const tempId = `temp:${createId()}`;
      tempTextById.current.set(tempId, trimmed);

      setMessages((prev) => [
        ...prev,
        { id: tempId, senderRole: myRole, text: trimmed, createdAt: Date.now(), status: 'sending' },
      ]);

      (async () => {
        const contentToStore = await encryptOutgoing(trimmed);
        const { data, error } = await supabase
          .from('messages')
          .insert({ sender_id: userId, sender_role: myRole, content: contentToStore })
          .select()
          .single();

        if (error || !data) {
          console.error('Failed to send message', error);
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)));
          return;
        }
        tempTextById.current.delete(tempId);
        // Keep the known plaintext rather than round-tripping our own
        // message through decrypt() — avoids a "decrypting…" flash on send.
        setMessages((prev) =>
          upsert(prev.filter((m) => m.id !== tempId), { ...mapRow(data as MessageRow, myRole), text: trimmed }),
        );
      })();
    },
    [myRole, userId, encryptOutgoing],
  );

  const retryMessage = useCallback(
    (tempId: string) => {
      const text = tempTextById.current.get(tempId);
      if (!text) return;
      tempTextById.current.delete(tempId);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      sendMessage(text);
    },
    [sendMessage],
  );

  const editMessage = useCallback(
    (id: string, text: string) => {
      if (!supabase || id.startsWith('temp:')) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      (async () => {
        const contentToStore = await encryptOutgoing(trimmed);
        const { data, error } = await supabase.rpc('edit_message', { p_id: id, p_content: contentToStore });
        if (error || !data) return console.error('Failed to edit message', error);
        setMessages((prev) => upsert(prev, { ...mapRow(data as MessageRow, myRole), text: trimmed }));
        setEditingMessage((prev) => (prev?.id === id ? null : prev));
      })();
    },
    [myRole, encryptOutgoing],
  );

  const beginEdit = useCallback(
    async (id: string) => {
      const message = messagesRef.current.find((m) => m.id === id);
      if (!message || message.senderRole !== myRole || message.deletedAt) return;
      // The message's stored text may be an encrypted envelope — resolve
      // it to real plaintext before handing it to the edit input.
      const result = await decrypt(message.text);
      if (result.status !== 'plain' && result.status !== 'decrypted') return;
      setEditingMessage({ id, text: result.text });
    },
    [myRole, decrypt],
  );

  const cancelEdit = useCallback(() => setEditingMessage(null), []);

  const deleteMessage = useCallback(
    (id: string) => {
      if (!supabase) return;
      if (id.startsWith('temp:')) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        return;
      }
      supabase.rpc('delete_message', { p_id: id }).then(({ data, error }) => {
        if (error || !data) return console.error('Failed to delete message', error);
        setMessages((prev) => upsert(prev, mapRow(data as MessageRow, myRole)));
      });
    },
    [myRole],
  );

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_BROADCAST_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { role: myRole } });
  }, [myRole]);

  const me: Participant = useMemo(
    () => ({
      role: myRole,
      name: membersByRole[myRole]?.display_name || myRole,
      initials: myRole,
      isOnline: true,
      lastSeenAt: Date.now(),
    }),
    [myRole, membersByRole],
  );

  const other: Participant = useMemo(
    () => ({
      role: otherRole,
      name: membersByRole[otherRole]?.display_name || otherRole,
      initials: otherRole,
      isOnline: otherOnline,
      lastSeenAt: membersByRole[otherRole] ? new Date(membersByRole[otherRole]!.last_seen_at).getTime() : null,
    }),
    [otherRole, membersByRole, otherOnline],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      myRole,
      otherRole,
      me,
      other,
      messages,
      initialUnreadMessageId,
      typingRole,
      connectionStatus,
      unreadCount,
      isLoadingHistory,
      isLoadingMore,
      hasMoreHistory,
      loadMoreHistory,
      sendMessage,
      retryMessage,
      deleteMessage,
      editMessage,
      editingMessage,
      beginEdit,
      cancelEdit,
      clearUnread,
      notifyTyping,
    }),
    [
      myRole,
      otherRole,
      me,
      other,
      messages,
      initialUnreadMessageId,
      typingRole,
      connectionStatus,
      unreadCount,
      isLoadingHistory,
      isLoadingMore,
      hasMoreHistory,
      loadMoreHistory,
      sendMessage,
      retryMessage,
      deleteMessage,
      editMessage,
      editingMessage,
      beginEdit,
      cancelEdit,
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
