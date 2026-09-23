import { useAuth } from '@/context/AuthContext';
import { ChatProvider, useChat } from '@/context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { CodeChangedNotice } from './CodeChangedNotice';
import { ConnectionBanner } from '@/components/common/ConnectionBanner';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import styles from './ChatPage.module.scss';

function ChatPageInner() {
  const { connectionStatus } = useChat();

  return (
    <div className={styles.page}>
      <ChatHeader />
      <CodeChangedNotice />
      <ConnectionBanner status={connectionStatus} />
      <MessageList />
      <MessageInput />
    </div>
  );
}

export function ChatPage() {
  const { session } = useAuth();
  if (!session) return null; // guarded by ProtectedRoute; this satisfies TypeScript

  return (
    <ChatProvider session={session}>
      <ChatPageInner />
    </ChatProvider>
  );
}
