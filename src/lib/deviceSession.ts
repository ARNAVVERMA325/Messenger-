/**
 * ANYA LABS — where a signed-in session is allowed to live.
 *
 * This app is often opened on a phone that isn't yours: a friend's, an auto
 * driver's, whatever is available for a few minutes. The default Supabase
 * behaviour (persist the session in localStorage, refresh it forever) is
 * right for your own device and actively wrong for a borrowed one — it
 * leaves whoever picks that phone up next signed in as you, with the whole
 * chat history readable, indefinitely.
 *
 * So the person choosing "this isn't my phone" at login switches session
 * storage to sessionStorage, which the browser discards when the tab or
 * browser closes. Nothing survives to be found later.
 *
 * The flag itself lives in sessionStorage too, deliberately: on a reload the
 * flag is still there (same tab), so the session keeps being read from the
 * right place; once the tab is gone, both the flag and the session go with
 * it and the next visit starts clean.
 */

const EPHEMERAL_FLAG = 'anya.shared-device';
const LAST_ACTIVE_KEY = 'anya.last-active';

/**
 * Why a timeout exists on top of sessionStorage: "the browser discards it on
 * close" is only reliable if closing actually destroys the tab. Android
 * Chrome restores tabs when the app is reopened, and a restored tab usually
 * gets its sessionStorage back with it — so a borrowed phone could come back
 * to a live session hours later. This check doesn't care about tab lifecycle
 * at all: a shared-device session that hasn't been touched in this long is
 * signed out on sight, whether the tab was restored, backgrounded, or never
 * closed in the first place.
 */
export const SHARED_DEVICE_IDLE_MS = 15 * 60 * 1000;

function safeStorage(kind: 'local' | 'session'): Storage | null {
  // Private-mode browsers and blocked-cookie settings can make these throw
  // on access, not just on write — so every touch is guarded.
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isEphemeralSession(): boolean {
  try {
    return safeStorage('session')?.getItem(EPHEMERAL_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Call before signing in, so the session is written to the right place. */
export function setEphemeralSession(on: boolean): void {
  try {
    const store = safeStorage('session');
    if (!store) return;
    if (on) store.setItem(EPHEMERAL_FLAG, '1');
    else store.removeItem(EPHEMERAL_FLAG);
  } catch {
    // A browser that won't let us record the preference also won't persist
    // anything else, which fails safe — nothing is left behind either way.
  }
}

/** Records that the person is still here. No-op outside shared-device mode. */
export function touchActivity(): void {
  if (!isEphemeralSession()) return;
  try {
    safeStorage('session')?.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // Ignore.
  }
}

/**
 * True when a shared-device session has gone untouched past the limit.
 *
 * A missing timestamp counts as expired, not as fresh: the only ways to get
 * here without one are a tab restored from a build that predates this, or
 * storage that was tampered with or partially cleared. Signing out is the
 * safe reading of an ambiguous state on a phone that isn't yours.
 */
export function isIdleExpired(): boolean {
  if (!isEphemeralSession()) return false;
  try {
    const raw = safeStorage('session')?.getItem(LAST_ACTIVE_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > SHARED_DEVICE_IDLE_MS;
  } catch {
    return true;
  }
}

/**
 * A Storage-shaped adapter that routes reads and writes to whichever store
 * this session should be using. Removals always clear BOTH, so signing out
 * can never leave a stale copy behind in the store we happen not to be
 * reading from right now.
 */
export const deviceSessionStorage = {
  getItem(key: string): string | null {
    try {
      return safeStorage(isEphemeralSession() ? 'session' : 'local')?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      safeStorage(isEphemeralSession() ? 'session' : 'local')?.setItem(key, value);
    } catch {
      // Ignore — an unwritable store just means the session won't persist.
    }
  },
  removeItem(key: string): void {
    try {
      safeStorage('session')?.removeItem(key);
      safeStorage('local')?.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};

/** Clears the activity timestamp. Called on sign-out. */
export function clearActivity(): void {
  try {
    safeStorage('session')?.removeItem(LAST_ACTIVE_KEY);
  } catch {
    // Ignore.
  }
}
