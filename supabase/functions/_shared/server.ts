// Plumbing shared by every function: responses, the service-role client,
// rate limiting, and working out who's calling.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

export const GENERIC_LOGIN_ERROR = "That room and code didn't match. Please check both and try again.";
export const RATE_LIMIT_ERROR = 'Too many attempts. Please wait a while and try again.';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Handles CORS preflight and non-POST methods; returns null for a POST to carry on with. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return null;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret ${name}`);
  return value;
}

/**
 * The service-role client bypasses every RLS policy, which is why it only
 * ever exists inside these functions and never reaches a browser. Each
 * function is responsible for checking, itself, that the caller is allowed
 * to do what it's about to do.
 */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * True when this attempt is allowed. Backed by check_rate_limit() from the
 * Phase 3 migration. A failure to check counts as "not allowed" — failing
 * open would turn a database hiccup into an unmetered brute-force window.
 */
export async function allowAttempt(
  admin: SupabaseClient,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
  lockoutSeconds: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_key: key,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
    p_lockout_seconds: lockoutSeconds,
  });
  if (error) {
    console.error('rate limit check failed', error);
    return false;
  }
  return data === true;
}

export interface Member {
  userId: string;
  roomId: string;
  role: 'A' | 'B';
  handle: string;
  displayName: string;
  accessToken: string;
}

/**
 * Resolves the signed-in caller from their bearer token and finds their
 * seat. Null for no session, an invalid token, or an account without a
 * seat — the caller should answer all three the same way.
 */
export async function requireMember(req: Request, admin: SupabaseClient): Promise<Member | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const { data: member, error: memberError } = await admin
    .from('room_members')
    .select('room_id, role, display_name, rooms ( handle )')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (memberError || !member) return null;

  const room = member.rooms as unknown as { handle: string } | null;
  if (!room) return null;

  return {
    userId: userData.user.id,
    roomId: member.room_id as string,
    role: member.role as 'A' | 'B',
    handle: room.handle,
    displayName: (member.display_name as string) ?? '',
    accessToken: token,
  };
}

/**
 * Mints a single-use magic-link token for a seat's account. Nothing is
 * emailed — the browser redeems the token with verifyOtp, and the account's
 * address is a reserved .invalid one that can never receive mail anyway.
 */
export async function mintSessionToken(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) {
    console.error('could not load seat account', userError);
    return null;
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.hashed_token) {
    console.error('failed to generate session link', error);
    return null;
  }
  return data.properties.hashed_token;
}
