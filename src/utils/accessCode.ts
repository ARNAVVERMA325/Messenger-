import type { SideRole } from '@/types';

/**
 * This module only checks that a code is *shaped* like a valid access code
 * — length and character set — purely so the UI can give instant feedback
 * on an obviously-empty or malformed entry before making a network call.
 * It is intentionally NOT the security mechanism, and `AuthContext.login()`
 * treats it as such: real verification (hashing, rate limiting, and the
 * role assignment that comes from a valid code) happens entirely
 * server-side in the verify-access-code Edge Function, which normalizes and
 * parses the code itself and never trusts anything computed here. See
 * supabase/functions/verify-access-code/index.ts.
 *
 * Per the product spec, the final digit ("1" = Side A, "5" = Side B) only
 * ever selects which chat profile/UI loads for an already-authenticated
 * person — it must never be treated as a secret or as proof of identity.
 */

const MIN_CODE_LENGTH = 6;
const NORMALIZED_PATTERN = /^[a-z0-9]+$/;

export type AccessCodeFormatError = 'empty' | 'too_short' | 'invalid_characters' | 'missing_role_digit';

/**
 * Codes are entered from memory, often on a borrowed phone, sometimes in a
 * hurry — so entry is deliberately forgiving: case doesn't matter, and
 * spaces/hyphens are ignored entirely. "Chai Biscuit 1", "chai-biscuit-1"
 * and "chaibiscuit1" are all the same code.
 *
 * CRITICAL: this must stay byte-for-byte equivalent to `normalizeCode()` in
 * supabase/functions/verify-access-code/index.ts and `normalizeCode()` in
 * scripts/generate-access-codes.mjs. The hash stored server-side is computed
 * over the *normalized* form, so if these three ever drift apart, correct
 * codes start being rejected.
 */
export function normalizeAccessCode(rawCode: string): string {
  return rawCode.trim().toLowerCase().replace(/[\s-]+/g, '');
}

export function getFormatError(rawCode: string): AccessCodeFormatError | null {
  const code = normalizeAccessCode(rawCode);
  if (code.length === 0) return 'empty';
  if (code.length < MIN_CODE_LENGTH) return 'too_short';
  if (!NORMALIZED_PATTERN.test(code)) return 'invalid_characters';
  if (!roleFromCode(code)) return 'missing_role_digit';
  return null;
}

export function roleFromCode(rawCode: string): SideRole | null {
  const code = normalizeAccessCode(rawCode);
  const lastChar = code.at(-1);
  if (lastChar === '1') return 'A';
  if (lastChar === '5') return 'B';
  return null;
}
