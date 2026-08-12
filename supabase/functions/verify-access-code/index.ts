// ANYA LABS — verify-access-code Edge Function
//
// This is the ONLY place the access code's secret is actually verified.
// Everything the frontend does before calling this (format check, role
// digit parsing) is just UX — this function is what makes that real:
//
//   1. Rate-limits by caller IP (see check_rate_limit in the Phase 3
//      migration) before doing anything else.
//   2. Recomputes the role digit and hashes the whole code with a secret
//      pepper (HMAC-SHA256), never trusting anything the client claims.
//   3. Compares that hash, in constant time, against the hash stored for
//      that role (never the plaintext — see scripts/generate-access-codes.mjs).
//   4. On a match, mints a real Supabase session for that role's fixed,
//      pre-provisioned auth user via a magic-link token (generated
//      server-side, redeemed client-side with verifyOtp — nothing is
//      emailed, this endpoint never touches email delivery).
//
// Every failure path — bad format, wrong secret, rate-limited, room not
// set up yet — returns the same generic error text, so a response can
// never be used to learn whether a given side exists or which part of a
// guess was wrong.
//
// Secrets this function needs (set with `supabase secrets set`, NEVER in
// frontend code or a VITE_ variable):
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided by Supabase in deployed
//                                 functions; only needed manually for local dev.
//   CODE_PEPPER                — set by you; must match what
//                                 scripts/generate-access-codes.mjs used.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CODE_PEPPER = Deno.env.get('CODE_PEPPER')!;

const GENERIC_ERROR = "That access code didn't work. Please check it and try again.";
const RATE_LIMIT_ERROR = 'Too many attempts. Please wait a while and try again.';

type Role = 'A' | 'B';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function roleFromCode(code: string): Role | null {
  const last = code.at(-1);
  if (last === '1') return 'A';
  if (last === '5') return 'B';
  return null;
}

function isValidFormat(code: string): boolean {
  return code.length >= 6 && /^[A-Za-z0-9-]+$/.test(code);
}

async function hmacSha256Hex(message: string, key: string): Promise<string> {
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// .invalid is reserved by RFC 2606 specifically for addresses that must
// never resolve or receive mail — a safety net even if email sending were
// ever accidentally enabled on this project.
function emailForRole(role: Role): string {
  return `role-${role.toLowerCase()}@anya-labs.invalid`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: GENERIC_ERROR }, 405);
  }

  let rawCode: unknown;
  try {
    const body = await req.json();
    rawCode = body?.code;
  } catch {
    return json({ error: GENERIC_ERROR }, 400);
  }

  if (typeof rawCode !== 'string') {
    return json({ error: GENERIC_ERROR }, 400);
  }
  const code = rawCode.trim();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Rate limit first, before any parsing/verification work, keyed by the
  // caller's IP (see the Phase 3 migration for this function's limits and
  // its documented tradeoffs).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { data: allowed, error: rateLimitError } = await admin.rpc('check_rate_limit', {
    p_key: `login:${ip}`,
  });

  if (rateLimitError) {
    console.error('rate limit check failed', rateLimitError);
    return json({ error: GENERIC_ERROR }, 500);
  }
  if (!allowed) {
    return json({ error: RATE_LIMIT_ERROR }, 429);
  }

  if (!isValidFormat(code)) {
    return json({ error: GENERIC_ERROR }, 401);
  }

  const role = roleFromCode(code);
  if (!role) {
    return json({ error: GENERIC_ERROR }, 401);
  }

  const { data: secretRow, error: secretError } = await admin
    .from('access_secrets')
    .select('secret_hash')
    .eq('role', role)
    .maybeSingle();

  if (secretError) {
    console.error('failed to load access secret', secretError);
    return json({ error: GENERIC_ERROR }, 500);
  }
  if (!secretRow) {
    // This role hasn't been provisioned yet (generate-access-codes.mjs
    // hasn't run) — still a generic error, same as a wrong code.
    return json({ error: GENERIC_ERROR }, 401);
  }

  const computedHash = await hmacSha256Hex(code, CODE_PEPPER);
  if (!timingSafeEqual(computedHash, secretRow.secret_hash as string)) {
    return json({ error: GENERIC_ERROR }, 401);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: emailForRole(role),
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('failed to generate session link', linkError);
    return json({ error: GENERIC_ERROR }, 500);
  }

  return json({ role, tokenHash: linkData.properties.hashed_token });
});
