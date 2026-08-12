import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthSession } from '@/types';
import type { RoomMemberRow } from '@/lib/database.types';
import { getFormatError, roleFromCode } from '@/utils/accessCode';
import { supabase } from '@/lib/supabaseClient';

/**
 * PHASE 2 NOTICE — sessions here are real: signing in creates (or resumes) a
 * genuine Supabase Auth session, persisted by supabase-js itself, and every
 * table access is enforced server-side by the RLS policies and RPC
 * functions in supabase/migrations/0001_init.sql — not by anything this
 * client claims about itself.
 *
 * What's still provisional (and explicitly Phase 3's job): the access
 * code's secret portion isn't verified against anything yet. `login()`
 * only checks the code's *shape* and reads its role digit (see
 * src/utils/accessCode.ts), then signs in anonymously and calls the
 * `claim_role` RPC, which is first-come-first-served per role with no
 * rate limiting. Concretely: until Phase 3 ships a server-verified secret
 * check, anyone who opens the deployed URL before both seats are claimed
 * can claim one, and repeated failed attempts each create a throwaway
 * anonymous Supabase user (cleanup + rate limiting is Phase 3 too). Once
 * both seats are claimed, the room is closed to further claims.
 */

type AuthStatus = 'idle' | 'verifying' | 'error';

interface AuthContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  errorMessage: string | null;
  isInitializing: boolean;
  login: (code: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GENERIC_LOGIN_ERROR = "That access code didn't work. Please check it and try again.";
const LOGGED_OUT_FLAG = 'anya-logged-out';

function setLoggedOutFlag(value: boolean) {
  try {
    if (value) localStorage.setItem(LOGGED_OUT_FLAG, '1');
    else localStorage.removeItem(LOGGED_OUT_FLAG);
  } catch {
    // Storage disabled: logout still works for this tab via React state,
    // it just won't survive a refresh.
  }
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
  // look up which seat it holds, if any.
  useEffect(() => {
    if (!supabase) {
      setIsInitializing(false);
      return;
    }

    (async () => {
      let loggedOut = false;
      try {
        loggedOut = localStorage.getItem(LOGGED_OUT_FLAG) === '1';
      } catch {
        // Storage disabled: fall through and treat as not logged out.
      }
      if (loggedOut) {
        if (mounted.current) setIsInitializing(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;

      if (user) {
        const { data: member } = await supabase.from('room_members').select('role').eq('id', user.id).single();
        const role = (member as Pick<RoomMemberRow, 'role'> | null)?.role;
        if (role && mounted.current) {
          setSession({ userId: user.id, role, authenticatedAt: Date.now() });
        }
      }

      if (mounted.current) setIsInitializing(false);
    })();
  }, []);

  const login = useCallback(async (code: string) => {
    if (!supabase) return false;

    setStatus('verifying');
    setErrorMessage(null);

    const formatError = getFormatError(code);
    const intendedRole = roleFromCode(code);

    if (formatError || !intendedRole) {
      setStatus('error');
      setErrorMessage(GENERIC_LOGIN_ERROR);
      return false;
    }

    let createdNewAnonymousSession = false;

    try {
      let { data: authData } = await supabase.auth.getSession();
      if (!authData.session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        authData = { session: data.session };
        createdNewAnonymousSession = true;
      }

      const { data: member, error: claimError } = await supabase.rpc('claim_role', { p_role: intendedRole });
      if (claimError) throw claimError;

      const userId = authData.session?.user.id;
      if (!userId) throw new Error('missing session after sign-in');

      if (!mounted.current) return false;
      setLoggedOutFlag(false);
      setSession({ userId, role: (member as RoomMemberRow).role, authenticatedAt: Date.now() });
      setStatus('idle');
      return true;
    } catch {
      // Deliberately generic: never reveal *why* a code failed (wrong
      // secret, wrong room, role already taken, room full, etc). Real
      // enforcement of this property is completed server-side in Phase 3.
      //
      // Only discard the anonymous identity if THIS attempt just created it
      // and it never claimed a seat. If we reused an existing, already-
      // seated identity and claim_role merely hiccuped (e.g. a dropped
      // request), signing out here would destroy that person's only way
      // back into their own seat — see the logout() comment below.
      if (createdNewAnonymousSession) {
        await supabase.auth.signOut().catch(() => {});
      }
      if (!mounted.current) return false;
      setStatus('error');
      setErrorMessage(GENERIC_LOGIN_ERROR);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    // Deliberately does NOT call supabase.auth.signOut(): a seat is bound
    // to this browser's anonymous Supabase identity via room_members, and
    // claim_role has no "reclaim with a new identity" path (see
    // supabase/migrations/0001_init.sql). Signing out would invalidate
    // that identity for good, permanently locking this person out of their
    // own seat. This just clears local UI state; the underlying session
    // stays valid so re-entering the same code signs back into the same
    // seat. A real, safe sign-out is Phase 3's job, once seats are bound
    // to the verified access code rather than to this ephemeral identity.
    setLoggedOutFlag(true);
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
