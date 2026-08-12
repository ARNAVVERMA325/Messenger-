// Which side of the private room a person is on. The access-code's final
// digit ("1" -> A, "5" -> B) only ever picks *which UI/profile* loads —
// see src/utils/accessCode.ts for why that digit is not the security check.
export type SideRole = 'A' | 'B';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  senderRole: SideRole;
  text: string;
  createdAt: number; // epoch ms
  status: MessageStatus; // meaningful only for messages sent by the local user
  editedAt?: number;
  deletedAt?: number;
  readAt?: number; // when the recipient read it (set on received messages once marked read)
}

export type ConnectionStatus = 'online' | 'connecting' | 'offline';

export interface Participant {
  role: SideRole;
  name: string;
  initials: string;
  isOnline: boolean;
  lastSeenAt: number | null;
}

export interface AuthSession {
  userId: string;
  role: SideRole;
  authenticatedAt: number;
}
