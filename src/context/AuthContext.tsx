import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AuthSession } from '@/types';
import { verifyAccessCodeLocally } from '@/utils/accessCode';

/**
 * PHASE 1 NOTICE — this context simulates auth entirely in the browser so the
 * UI/UX can be built and reviewed before a backend exists. `sessionStorage`
 * is used only so a page refresh doesn't kick you back to the landing screen
 * during design review; it is NOT a secure session and holds no secret, just
 * a role letter. Phase 3 replaces this whole context with one backed by a
 * real server session (e.g. an httpOnly, Secure, SameSite cookie issued
 * after the server verifies the access code), while keeping the same
 * `login()` / `logout()` shape so components using it don't need to change.
 */

const SESSION_STORAGE_KEY = 'anya-demo-session';

type AuthStatus = 'idle' | 'verifying' | 'error';

interface AuthContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  errorMessage: string | null;
  login: (code: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (parsed.role === 'A' || parsed.role === 'B') return parsed;
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(readStoredSession);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const login = useCallback(async (code: string) => {
    setStatus('verifying');
    setErrorMessage(null);

    const result = await verifyAccessCodeLocally(code);

    if (!result.ok || !result.role) {
      // Deliberately generic: never reveal *why* a code failed (wrong room,
      // wrong secret, side doesn't exist, etc). Real enforcement of this
      // property happens server-side in Phase 3.
      setStatus('error');
      setErrorMessage("That access code didn't work. Please check it and try again.");
      return false;
    }

    const newSession: AuthSession = { role: result.role, authenticatedAt: Date.now() };
    setSession(newSession);
    setStatus('idle');
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
    } catch {
      // Ignore storage failures; session still works for this tab via state.
    }
    return true;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setStatus('idle');
    setErrorMessage(null);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // No-op.
    }
  }, []);

  const value = useMemo(
    () => ({ session, status, errorMessage, login, logout }),
    [session, status, errorMessage, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
