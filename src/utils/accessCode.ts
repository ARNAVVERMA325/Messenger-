import type { SideRole } from '@/types';

/**
 * PHASE 2 NOTICE
 * ---------------------------------------------------------------------------
 * This module only checks that a code is *shaped* like a valid access code
 * and reads its role digit. It is intentionally NOT the security mechanism.
 *
 * Per the product spec, the final digit ("1" = Side A, "5" = Side B) only
 * ever selects which chat profile/UI loads for an already-authenticated
 * person — it must never be treated as a secret or as proof of identity.
 * `AuthContext.login()` uses this module's output to sign in with Supabase
 * and claim that role's seat, but nothing here verifies the code's secret
 * portion against anything. Real verification (hashing, rate limiting, a
 * server-side check that gates the seat claim) is Phase 3's job.
 */

const MIN_CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-Za-z0-9-]+$/;

export type AccessCodeFormatError = 'empty' | 'too_short' | 'invalid_characters' | 'missing_role_digit';

export function getFormatError(rawCode: string): AccessCodeFormatError | null {
  const code = rawCode.trim();
  if (code.length === 0) return 'empty';
  if (code.length < MIN_CODE_LENGTH) return 'too_short';
  if (!CODE_PATTERN.test(code)) return 'invalid_characters';
  if (!roleFromCode(code)) return 'missing_role_digit';
  return null;
}

export function roleFromCode(rawCode: string): SideRole | null {
  const code = rawCode.trim();
  const lastChar = code.at(-1);
  if (lastChar === '1') return 'A';
  if (lastChar === '5') return 'B';
  return null;
}
