// Hand-written to match supabase/migrations (through 0007). If the schema
// changes, update this alongside the migration. These are applied as casts
// at the query boundary (see ChatContext/AuthContext) rather than threaded
// through supabase-js's generic Database parameter — see the note in
// supabaseClient.ts for why.

export interface RoomRow {
  id: string;
  handle: string;
  /** Null for the legacy room, which uses the deployment-wide salt. */
  encryption_salt: string | null;
  is_legacy: boolean;
  created_at: string;
}

export interface RoomMemberRow {
  id: string;
  room_id: string;
  role: 'A' | 'B';
  display_name: string;
  created_at: string;
  last_seen_at: string;
  code_changed_at: string | null;
}

export interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  sender_role: 'A' | 'B';
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  reply_to_id: string | null;
  attachment_path: string | null;
  attachment_kind: 'image' | 'audio' | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_width: number | null;
  attachment_height: number | null;
  attachment_duration_ms: number | null;
}
