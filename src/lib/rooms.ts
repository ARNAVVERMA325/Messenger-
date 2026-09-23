/**
 * Client-side helpers for rooms: tidying what people type, remembering the
 * last room on a personal device, invite links, and reading the friendly
 * error messages the Edge Functions send back.
 *
 * Nothing here is a security check — every function re-validates on the
 * server. These exist so mistakes are caught instantly, without a round
 * trip on a slow connection.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { isEphemeralSession } from '@/lib/deviceSession';

/** Mirrors normalizeHandle() in supabase/functions/_shared/codes.ts. */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const RESERVED_HANDLES = new Set([
  'admin', 'api', 'app', 'chat', 'create', 'help', 'login', 'new', 'r', 'room',
  'rooms', 'settings', 'signup', 'support', 'www',
]);

/** Mirrors handleProblem() in the functions' shared module. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 3 || handle.length > 30) return 'Room names need 3 to 30 characters.';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(handle)) return 'Room names can use letters, numbers and dashes.';
  if (RESERVED_HANDLES.has(handle)) return 'That room name is reserved — try another.';
  return null;
}

export function inviteLink(handle: string): string {
  return `${window.location.origin}/r/${handle}`;
}

// ---------------------------------------------------------------------------
// Remembering the room name — on your own phone only.
//
// The name isn't secret, but on a borrowed phone it would still tell the
// next person which room you use. So it's only remembered when the person
// didn't tick "This isn't my phone".
// ---------------------------------------------------------------------------
const LAST_ROOM_KEY = 'anya.last-room';

export function rememberedRoom(): string {
  try {
    return localStorage.getItem(LAST_ROOM_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberRoom(handle: string): void {
  try {
    if (isEphemeralSession()) localStorage.removeItem(LAST_ROOM_KEY);
    else localStorage.setItem(LAST_ROOM_KEY, handle);
  } catch {
    // Storage unavailable: the field simply won't be prefilled next time.
  }
}

export function forgetRememberedRoom(): void {
  try {
    localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * The functions answer failures with `{ error: "<sentence for a person>" }`.
 * supabase-js wraps non-2xx responses in FunctionsHttpError, with the raw
 * Response on `.context` — this digs the sentence back out.
 */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<{ message: string; status?: number }> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined;
    const status = response?.status;
    try {
      const body = (await response?.clone().json()) as { error?: unknown } | undefined;
      if (typeof body?.error === 'string' && body.error) return { message: body.error, status };
    } catch {
      // Not JSON — fall through to the fallback.
    }
    return { message: fallback, status };
  }
  return { message: fallback };
}
