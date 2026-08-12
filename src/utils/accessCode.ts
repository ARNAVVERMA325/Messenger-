import type { SideRole } from '@/types';

/**
 * PHASE 1 NOTICE
 * ---------------------------------------------------------------------------
 * This module only checks that a code is *shaped* like a valid access code
 * and reads its role digit, purely so the UI can be built and demoed.
 *
 * It is intentionally NOT the security mechanism. Per the product spec, the
 * final digit ("1" = Side A, "5" = Side B) only ever selects which chat
 * profile/UI loads for an already-authenticated person — it must never be
 * treated as a secret or as proof of identity. Real authentication (secret
 * verification, hashing, rate limiting, session issuance) is implemented
 * server-side in Phase 3 and will replace the `verifyAccessCodeLocally`
 * function below with a network call to that server.
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

interface LocalVerifyResult {
  ok: boolean;
  role: SideRole | null;
}

/**
 * Placeholder "verification" for the Phase 1 UI preview only: it never talks
 * to a server and accepts any well-formed code. Replaced in Phase 3 by a
 * call to a server endpoint that verifies the secret portion of the code
 * against a hashed value and returns a real session — this function's
 * signature (async, ok/role result) is shaped to make that swap mechanical.
 */
export async function verifyAccessCodeLocally(rawCode: string): Promise<LocalVerifyResult> {
  await new Promise((resolve) => setTimeout(resolve, 650 + Math.random() * 350));

  const formatError = getFormatError(rawCode);
  if (formatError) return { ok: false, role: null };

  return { ok: true, role: roleFromCode(rawCode) };
}
