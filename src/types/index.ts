// Which side of the private room a person is on. The access-code's final
// digit ("1" -> A, "5" -> B) only ever picks *which UI/profile* loads —
// see src/utils/accessCode.ts for why that digit is not the security check.
export type SideRole = 'A' | 'B';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type AttachmentKind = 'image' | 'audio';

/**
 * The envelope around an attachment, never its contents. These fields are
 * stored unencrypted on purpose so the UI can size a placeholder or show a
 * voice note's length without downloading and decrypting the file first —
 * which on a slow connection is the whole point. The file itself is
 * ciphertext in Storage (see src/lib/attachments.ts).
 */
export interface Attachment {
  path: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface Message {
  id: string;
  senderRole: SideRole;
  text: string;
  createdAt: number; // epoch ms
  status: MessageStatus; // meaningful only for messages sent by the local user
  editedAt?: number;
  deletedAt?: number;
  readAt?: number; // when the recipient read it (set on received messages once marked read)
  replyToId?: string;
  attachment?: Attachment;
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
