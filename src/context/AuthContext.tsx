import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { AuthSession, SideRole } from '@/types';
import { getFormatError } from '@/utils/accessCode';
import { supabase } from '@/lib/supabaseClient';
import { setEphemeralSession } from '@/lib/deviceSession';

/**
 * PHASE 3 NOTICE — this is the real thing. `login()` sends the access code
 * to the `verify-access-code` Edge Function (supabase/functions/verify-access-code),
 * which is the only place the code's secret is actually checked: it's
 * rate-limited by IP, hashed with a server-side pepper, and compared in
 * constant time against a hash stored server-side (never the plaintext —
 * see scripts/generate-access-codes.mjs). Nothing about *this* file decides
 * whether a code is valid; it only relays the result and, on success,
 * redeems the single-use token the function returns for a real Supabase
 * session belonging to that seat's fixed, pre-provisioned account.
 *
 * Because each seat is now a stable account (not an ephemeral anonymous
 * session claimed on the fly, as in Phase 2), logout can finally be a real
 * sign-out: it ends the session outright, and signing back in with the
 * correct code always re-authenticates the same seat, from any device.
 */

type AuthStatus = 'idle' | 'verifying' | 'error';

interface AuthContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  errorMessage: string | null;
  isInitializing: boolean;
  login: (code: string, name?: string, sharedDevice?: boolean) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GENERIC_LOGIN_ERROR = "That access code didn't work. Please check it and try again.";
const RATE_LIMIT_ERROR = 'Too many attempts. Please wait a while and try again.';

interface VerifyAccessCodeResponse {
  role: SideRole;
  tokenHash: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Resume an existing Supabase session (e.g. after a page refresh) and
  // look up which seat it belongs to.
  useEffect(() => {
    if (!supabase) {
      setIsInitializing(false);
      return;
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;

      if (user) {
        const { data: member } = await supabase.from('room_members').select('role').eq('id', user.id).single();
        const role = (member as { role: SideRole } | null)?.role;
        if (role && mounted.current) {
          setSession({ userId: user.id, role, authenticatedAt: Date.now() });
        }
      }

      if (mounted.current) setIsInitializing(false);
    })();

    // Keep local session state in sync if the token is refreshed elsewhere,
    // or the session disappears (e.g. expires) without logout() being called.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && mounted.current) {
        setSession(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async (code: string, name?: string, sharedDevice?: boolean) => {
    if (!supabase) return false;

    // Decided before anything writes a session, so the very first write
    // already lands in the right store (see src/lib/deviceSession.ts).
    setEphemeralSession(Boolean(sharedDevice));

    setStatus('verifying');
    setErrorMessage(null);

    // Client-side format check is UX only — it just avoids a network round
    // trip for an obviously-empty/malformed entry. The Edge Function does
    // not trust this and re-validates everything itself.
    if (getFormatError(code)) {
      setStatus('error');
      setErrorMessage(GENERIC_LOGIN_ERROR);
      return false;
    }

    try {
      const { data, error } = await supabase.functions.invoke<VerifyAccessCodeResponse>('verify-access-code', {
        body: { code: code.trim() },
      });

      if (error) {
        const isRateLimited = error instanceof FunctionsHttpError && error.context?.status === 429;
        if (!mounted.current) return false;
        setStatus('error');
        setErrorMessage(isRateLimited ? RATE_LIMIT_ERROR : GENERIC_LOGIN_ERROR);
        return false;
      }

      if (!data?.tokenHash || !data.role) throw new Error('malformed verify-access-code response');

      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: data.tokenHash,
        type: 'magiclink',
      });
      if (verifyError || !verifyData.session) throw verifyError ?? new Error('token redemption failed');

      // Purely a personalization nicety, not part of authentication — the
      // code above is what actually proved identity. A blank/unchanged name
      // just leaves whatever's already set.
      const trimmedName = name?.trim();
      if (trimmedName) {
        supabase.rpc('set_display_name', { p_name: trimmedName }).then(({ error: nameError }) => {
          if (nameError) console.error('Failed to set display name', nameError);
        });
      }

      if (!mounted.current) return false;
      setSession({ userId: verifyData.session.user.id, role: data.role, authenticatedAt: Date.now() });
      setStatus('idle');
      return true;
    } catch {
      if (!mounted.current) return false;
      setStatus('error');
      setErrorMessage(GENERIC_LOGIN_ERROR);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    // A real sign-out: each seat is a stable, pre-provisioned account now
    // (see the PHASE 3 NOTICE above), so ending this session outright is
    // safe — re-entering the correct code always signs back into the same
    // seat, unlike Phase 2's ephemeral anonymous identities.
    // deviceSessionStorage.removeItem() clears both stores, so signOut()
    // wipes the session wherever it was kept; resetting the flag afterwards
    // means the next person to sign in on this tab starts from the default
    // again rather than silently inheriting this visit's choice.
    supabase?.auth.signOut().catch(() => {});
    setEphemeralSession(false);
    setSession(null);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const value = useMemo(
    () => ({ session, status, errorMessage, isInitializing, login, logout }),
    [session, status, errorMessage, isInitializing, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
