import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * `VITE_`-prefixed env vars are inlined into the built frontend bundle by
 * Vite, so they are PUBLIC — never put anything here that isn't safe for
 * anyone to read. The anon key is designed for this: it identifies your
 * Supabase project but grants no access on its own. Every table this app
 * touches has row-level security enabled (see supabase/migrations), so the
 * anon key alone can't read or write anything — access is only granted
 * through the RLS policies and RPC functions in that migration. The
 * service-role key (which bypasses RLS entirely) must never appear in
 * frontend code or a VITE_ variable; it only ever belongs in a server-side
 * environment (a future Edge Function, in Phase 3).
 *
 * Note on types: table/row shapes are declared by hand in
 * src/lib/database.types.ts and applied at the boundary (see mapRow() in
 * ChatContext) rather than threaded through createClient's generic — the
 * TypeScript toolchain in this project doesn't reliably resolve Supabase's
 * generated-Database generic today, so queries below return loosely-typed
 * data that gets cast to those row types once, on the way in.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
