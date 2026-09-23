import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthSession, SideRole } from '@/types';
import { getFormatError } from '@/utils/accessCode';
import { supabase } from '@/lib/supabaseClient';
import { functionErrorMessage, normalizeHandle, rememberRoom } from '@/lib/rooms';
import {
  setEphemeralSession,
  isEphemeralSession,
  isIdleExpired,
  touchActivity,
  clearActivity,
} from '@/lib/deviceSession';

/**
 * Signing in, creating rooms, and keeping the session honest.
 *
 * Nothing in this file decides whether a code is valid. `login()` hands the
 * room name and code to the verify-access-code Edge Function, which is the
 * only place codes are checked (rate-limited, hashed with a server-side
 * pepper, compared in constant time). On success it returns a single-use
 * token, which this file redeems for a real Supabase session belonging to
 * that seat's account. `createRoom()` works the same way via create-room.
 *
 * Every seat is a stable account, so signing out is a real signOut():
 * entering the right code again always returns to the same seat, from any
 * device.
 */

type AuthStatus = 'idle' | 'verifying' | 'error';

export interface CreateRoomInput {
  handle: string;
  you: { name: string; code: string };
  partner: { name: string; code: string };
  sharedDevice: boolean;
}

export type CreateRoomResult =
  | { ok: true; handle: string; signedIn: boolean }
  | { ok: false; error: string };

interface AuthContextValue {
  session: AuthSession | null;
  status: AuthStatus;
  errorMessage: string | null;
  isInitializing: boolean;
  /**
   * True when this app is newer than the database it's talking to — the
   * multi-room migration or functions haven't been deployed yet. The UI
   * says so plainly instead of failing in confusing ways.
   */
  backendOutdated: boolean;
  login: (room: string, code: string, sharedDevice?: boolean) => Promise<boolean>;
  createRoom: (input: CreateRoomInput) => Promise<CreateRoomResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GENERIC_LOGIN_ERROR = "That room and code didn't match. Please check both and try again.";
const RATE_LIMIT_ERROR = 'Too many attempts. Please wait a while and try again.';

interface SeatTokenResponse {
  role: SideRole;
  roomId?: string;
  handle?: string;
  tokenHash: string | null;
}

// PostgREST / Postgres error codes that mean "this column, table or
// relationship doesn't exist" — i.e. the database predates this app.
const SCHEMA_MISSING_CODES = new Set(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205']);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [backendOutdated, setBackendOutdated] = useState(false);
  // Mirrors backendOutdated for code that needs the answer in the same tick
  // it was discovered — state set during an await isn't visible to the
  // closure that's still running.
  const outdatedRef = useRef(false);
  const mounted = useRef(true);
  // Held in a ref so the idle watcher below can call logout without listing
  // it as a dependency and tearing down its listeners on every render.
  const logoutRef = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const markOutdated = useCallback(() => {
    outdatedRef.current = true;
    if (mounted.current) setBackendOutdated(true);
  }, []);

  /** Looks up which room and seat a signed-in account holds. */
  const loadSeat = useCallback(async (userId: string): Promise<AuthSession | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('room_members')
      .select('role, room_id, rooms ( handle )')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      if (SCHEMA_MISSING_CODES.has(error.code ?? '')) markOutdated();
      console.error('Failed to load seat', error);
      return null;
    }
    const row = data as { role: SideRole; room_id: string; rooms: { handle: string } | null } | null;
    if (!row?.rooms) return null;

    return {
      userId,
      role: row.role,
      roomId: row.room_id,
      roomHandle: row.rooms.handle,
      authenticatedAt: Date.now(),
    };
  }, [markOutdated]);

  // Resume an existing Supabase session (e.g. after a page refresh).
  useEffect(() => {
    if (!supabase) {
      setIsInitializing(false);
      return;
    }

    (async () => {
      // Checked before the session is honoured, so a restored tab on a
      // borrowed phone never briefly renders the chat before signing out.
      if (isEphemeralSession() && isIdleExpired()) {
        await supabase.auth.signOut().catch(() => {});
        setEphemeralSession(false);
        clearActivity();
        if (mounted.current) setIsInitializing(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (user) {
        const restored = await loadSeat(user.id);
        if (restored && mounted.current) setSession(restored);
      }

      if (mounted.current) setIsInitializing(false);
    })();

    // Keep local state in sync if the session disappears (e.g. expires, or
    // is revoked because the other device changed this seat's code) without
    // logout() having been called here.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && mounted.current) setSession(null);
    });

    return () => subscription.unsubscribe();
  }, [loadSeat]);

  /** Turns a single-use token from an Edge Function into a real session. */
  const redeem = useCallback(
    async (response: SeatTokenResponse): Promise<AuthSession | null> => {
      if (!supabase || !response.tokenHash) return null;
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: response.tokenHash, type: 'magiclink' });
      if (error || !data.session) throw error ?? new Error('token redemption failed');

      // The function reports the room directly; older deployments of it
      // didn't, in which case look it up (and flag the backend as behind).
      if (response.roomId && response.handle) {
        return {
          userId: data.session.user.id,
          role: response.role,
          roomId: response.roomId,
          roomHandle: response.handle,
          authenticatedAt: Date.now(),
        };
      }
      return loadSeat(data.session.user.id);
    },
    [loadSeat],
  );

  const login = useCallback(
    async (room: string, code: string, sharedDevice?: boolean) => {
      if (!supabase) return false;

      // Decided before anything writes a session, so the very first write
      // already lands in the right store (see src/lib/deviceSession.ts).
      setEphemeralSession(Boolean(sharedDevice));
      setStatus('verifying');
      setErrorMessage(null);

      // UX only — avoids a round trip for an obviously malformed entry. The
      // Edge Function re-validates everything itself.
      if (getFormatError(code)) {
        setStatus('error');
        setErrorMessage(GENERIC_LOGIN_ERROR);
        return false;
      }

      try {
        const handle = normalizeHandle(room);
        const { data, error } = await supabase.functions.invoke<SeatTokenResponse>('verify-access-code', {
          // An empty room is omitted, which the function treats as "the
          // original room" — how the first couple's codes keep working.
          body: handle ? { room: handle, code: code.trim() } : { code: code.trim() },
        });

        if (error || !data) {
          const { status: httpStatus } = await functionErrorMessage(error, GENERIC_LOGIN_ERROR);
          if (!mounted.current) return false;
          setStatus('error');
          setErrorMessage(httpStatus === 429 ? RATE_LIMIT_ERROR : GENERIC_LOGIN_ERROR);
          return false;
        }

        const next = await redeem(data);
        if (!next) {
          // The code was right and a Supabase session now exists, but it
          // can't be tied to a room — don't leave that session lying around.
          await supabase.auth.signOut().catch(() => {});
          if (!mounted.current) return false;
          setStatus('error');
          setErrorMessage(
            outdatedRef.current
              ? 'ANYA LABS is being upgraded right now. Please try again in a few minutes.'
              : GENERIC_LOGIN_ERROR,
          );
          return false;
        }
        if (!mounted.current) return false;

        touchActivity();
        rememberRoom(next.roomHandle);
        setSession(next);
        setStatus('idle');
        return true;
      } catch {
        if (!mounted.current) return false;
        setStatus('error');
        setErrorMessage(GENERIC_LOGIN_ERROR);
        return false;
      }
    },
    [redeem],
  );

  const createRoom = useCallback(
    async (input: CreateRoomInput): Promise<CreateRoomResult> => {
      if (!supabase) return { ok: false, error: 'Not connected.' };
      setEphemeralSession(input.sharedDevice);

      const { data, error } = await supabase.functions.invoke<SeatTokenResponse>('create-room', {
        body: { handle: input.handle, you: input.you, partner: input.partner },
      });

      if (error || !data) {
        const { message, status: httpStatus } = await functionErrorMessage(
          error,
          "The room couldn't be created. Please try again.",
        );
        if (httpStatus === 404) markOutdated();
        return { ok: false, error: httpStatus === 404 ? 'Creating rooms isn’t available here yet.' : message };
      }

      const handle = data.handle ?? normalizeHandle(input.handle);
      rememberRoom(handle);

      // The room exists either way; if the automatic sign-in fails, the
      // creator can still sign in normally with their code.
      try {
        const next = await redeem(data);
        if (next && mounted.current) {
          touchActivity();
          setSession(next);
          return { ok: true, handle, signedIn: true };
        }
      } catch (redeemError) {
        console.error('Room created, but automatic sign-in failed', redeemError);
      }
      return { ok: true, handle, signedIn: false };
    },
    [redeem, markOutdated],
  );

  // Keeps a shared-device session honest while it's open: records real
  // interaction, and signs out once the idle limit passes. The visibility
  // check matters most on Android, where the browser is usually backgrounded
  // rather than closed — coming back to a phone that sat for an hour lands
  // on the login screen, not the chat.
  useEffect(() => {
    if (!session || !isEphemeralSession()) return;

    let lastWrite = 0;
    const record = () => {
      // Throttled: interaction fires constantly, and this writes to storage.
      const now = Date.now();
      if (now - lastWrite < 30_000) return;
      lastWrite = now;
      touchActivity();
    };

    const check = () => {
      if (isIdleExpired()) logoutRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
      else record();
    };

    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown'];
    events.forEach((event) => document.addEventListener(event, record, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(check, 30_000);

    return () => {
      events.forEach((event) => document.removeEventListener(event, record));
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [session]);

  const logout = useCallback(() => {
    // deviceSessionStorage.removeItem() clears both stores, so signOut()
    // wipes the session wherever it was kept; resetting the flag afterwards
    // means the next person to sign in on this tab starts from the default
    // again rather than silently inheriting this visit's choice.
    supabase?.auth.signOut().catch(() => {});
    setEphemeralSession(false);
    clearActivity();
    setSession(null);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  const value = useMemo(
    () => ({ session, status, errorMessage, isInitializing, backendOutdated, login, createRoom, logout }),
    [session, status, errorMessage, isInitializing, backendOutdated, login, createRoom, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
