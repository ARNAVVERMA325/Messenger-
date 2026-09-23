// Everything about access codes and room names that more than one function
// needs: normalizing, validating, and hashing. Kept in one place because
// these rules only work if every function applies them identically.

/**
 * Codes are entered from memory, often on a borrowed phone — so entry is
 * forgiving: case-insensitive, with spaces and hyphens ignored entirely.
 *
 * CRITICAL: must stay byte-for-byte equivalent to `normalizeAccessCode()` in
 * src/utils/accessCode.ts and `normalizeCode()` in
 * scripts/generate-access-codes.mjs. Stored hashes are computed over this
 * normalized form, so any drift silently rejects valid codes.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '');
}

/** Shape check for a code being *entered*. Legacy random codes are 7 characters. */
export function isPlausibleCode(code: string): boolean {
  return code.length >= 6 && code.length <= 128 && /^[a-z0-9]+$/.test(code);
}

/** Minimum length for a code being *chosen* — a short chosen code is the weak case. */
export const MIN_NEW_CODE_LENGTH = 8;

/**
 * Why a chosen code is unacceptable, or null if it's fine.
 *
 * `publicWords` is what anyone looking at this room already knows — its
 * handle and both display names. A code containing one of those adds no
 * secrecy however long the rest is, which is the generalised form of the
 * "no 'anya' or 'arnav'" rule the original single-room setup script had.
 */
export function newCodeProblem(code: string, publicWords: string[]): string | null {
  if (!/^[a-z0-9]+$/.test(code)) {
    return 'Codes can only use letters and numbers (spaces and dashes are fine — they’re ignored).';
  }
  if (code.length < MIN_NEW_CODE_LENGTH) {
    return `Codes need at least ${MIN_NEW_CODE_LENGTH} letters or numbers.`;
  }
  if (code.length > 128) {
    return 'That code is too long.';
  }
  for (const word of publicWords) {
    const w = normalizeCode(word);
    if (w.length >= 3 && code.includes(w)) {
      return 'A code can’t contain the room name or anyone’s name — those aren’t secret.';
    }
  }
  if (/^(.)\1+$/.test(code)) {
    return 'That code is too easy to guess.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Room handles
// ---------------------------------------------------------------------------

const RESERVED_HANDLES = new Set([
  'admin', 'api', 'app', 'chat', 'create', 'help', 'login', 'new', 'r', 'room',
  'rooms', 'settings', 'signup', 'support', 'www',
]);

/** Lowercases and tidies what someone typed as a room name into a handle. */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Why a handle is unacceptable, or null if it's fine. Mirrors the rooms.handle check. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 3 || handle.length > 30) return 'Room names need 3 to 30 characters.';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(handle)) {
    return 'Room names can use letters, numbers and dashes.';
  }
  if (RESERVED_HANDLES.has(handle)) return 'That room name is reserved — try another.';
  return null;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** v1: what the original single-room deployment stored. Not bound to a room. */
export function hashV1(code: string, pepper: string): Promise<string> {
  return hmacSha256Hex(pepper, code);
}

/**
 * v2: bound to its room, so the same code in two rooms hashes differently
 * and a leaked pepper can't test one guess against every room at once.
 *
 * CRITICAL: must match hashCodeV2() in scripts/generate-access-codes.mjs.
 */
export function hashV2(code: string, roomId: string, pepper: string): Promise<string> {
  return hmacSha256Hex(pepper, `v2:${roomId}:${code}`);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SeatSecret {
  role: 'A' | 'B';
  secret_hash: string;
  hash_version: number;
}

/**
 * Which seat (if any) a code opens, checking every seat with no early exit
 * so response timing doesn't reveal how many seats exist or which one a
 * guess matched. Also reports whether the match was a v1 hash, so the
 * caller can upgrade it while the plaintext is in hand.
 */
export async function matchSeat(
  code: string,
  roomId: string,
  seats: SeatSecret[],
  pepper: string,
): Promise<{ role: 'A' | 'B'; wasV1: boolean } | null> {
  const [v1, v2] = await Promise.all([hashV1(code, pepper), hashV2(code, roomId, pepper)]);
  let match: { role: 'A' | 'B'; wasV1: boolean } | null = null;
  for (const seat of seats) {
    const candidate = seat.hash_version === 1 ? v1 : v2;
    if (timingSafeEqual(candidate, seat.secret_hash)) {
      match = { role: seat.role, wasV1: seat.hash_version === 1 };
    }
  }
  return match;
}

/** Random hex, for per-room encryption salts. */
export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
