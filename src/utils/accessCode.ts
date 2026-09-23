/**
 * This module only checks that a code is *shaped* like a valid access code
 * — length and character set — purely so the UI can give instant feedback
 * on an obviously-empty or malformed entry before making a network call.
 * It is intentionally NOT the security mechanism, and `AuthContext.login()`
 * treats it as such: real verification (hashing, rate limiting, and working
 * out which seat the code belongs to) happens entirely server-side in the
 * verify-access-code Edge Function, which normalizes the code itself and
 * never trusts anything computed here. See
 * supabase/functions/verify-access-code/index.ts.
 *
 * Nothing here — or anywhere client-side — determines which side a person
 * is. Each seat has its own distinct secret, so the code that matches *is*
 * the identity; the server decides, and returns the role in its response.
 */

const MIN_CODE_LENGTH = 6;
const NORMALIZED_PATTERN = /^[a-z0-9]+$/;

export type AccessCodeFormatError = 'empty' | 'too_short' | 'invalid_characters';

/**
 * Codes are entered from memory, often on a borrowed phone, sometimes in a
 * hurry — so entry is deliberately forgiving: case doesn't matter, and
 * spaces/hyphens are ignored entirely. "Blue Tshirt", "blue-tshirt" and
 * "bluetshirt" are all the same code.
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
  return null;
}


/** Mirrors MIN_NEW_CODE_LENGTH in supabase/functions/_shared/codes.ts. */
export const MIN_NEW_CODE_LENGTH = 8;

/**
 * Why a code someone is *choosing* would be rejected, or null if it's fine.
 * Mirrors newCodeProblem() in the functions' shared module, so problems show
 * up while typing rather than after a round trip — the server still makes
 * the real decision.
 *
 * `publicWords` is what anyone looking at the room already knows: its name
 * and both people's names. A code containing one adds no secrecy.
 */
export function newCodeProblem(rawCode: string, publicWords: string[]): string | null {
  const code = normalizeAccessCode(rawCode);
  if (!code) return 'Choose a code.';
  if (!/^[a-z0-9]+$/.test(code)) return 'Codes can only use letters and numbers (spaces and dashes are fine).';
  if (code.length < MIN_NEW_CODE_LENGTH) return `At least ${MIN_NEW_CODE_LENGTH} letters or numbers.`;
  for (const word of publicWords) {
    const w = normalizeAccessCode(word);
    if (w.length >= 3 && code.includes(w)) return 'Can’t contain the room name or anyone’s name — those aren’t secret.';
  }
  if (/^(.)\1+$/.test(code)) return 'Too easy to guess.';
  return null;
}
