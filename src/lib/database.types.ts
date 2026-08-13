// Hand-written to match supabase/migrations/0001_init.sql. If the schema
// changes, update this alongside the migration. These are applied as casts
// at the query boundary (see ChatContext/AuthContext) rather than threaded
// through supabase-js's generic Database parameter — see the note in
// supabaseClient.ts for why.

export interface RoomMemberRow {
  id: string;
  role: 'A' | 'B';
  display_name: string;
  created_at: string;
  last_seen_at: string;
}

export interface MessageRow {
  id: string;
  sender_id: string;
  sender_role: 'A' | 'B';
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  reply_to_id: string | null;
}
