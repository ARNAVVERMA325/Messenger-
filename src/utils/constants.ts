/** Client-side cap on message length. Kept comfortably below the database's
 * limit (see supabase/migrations/0003_phase4_privacy.sql) so encrypted
 * messages — which are meaningfully larger than their plaintext — never
 * risk exceeding it. */
export const MAX_MESSAGE_LENGTH = 2000;
