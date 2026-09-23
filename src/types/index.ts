// Which of a room's two seats a person holds. Purely positional — the
// server decides it from which seat's code matched, and it carries no
// meaning beyond "me" versus "the other person".
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
  /** When this person last changed their access code (never the code itself). */
  codeChangedAt: number | null;
}

export interface AuthSession {
  userId: string;
  role: SideRole;
  roomId: string;
  /** The room's name as typed at login and used in invite links (/r/<handle>). */
  roomHandle: string;
  authenticatedAt: number;
}
