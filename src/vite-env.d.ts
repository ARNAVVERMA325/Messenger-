/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Optional. Public, non-secret — see src/lib/crypto.ts for why. */
  readonly VITE_ENCRYPTION_SALT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
