// ANYA LABS — verify-access-code: signing in with a room name and a code.
//
// This is the only place an access code is actually checked:
//
//   1. Rate-limited by caller IP, before any other work.
//   2. The room is looked up by its handle. An unknown room gets the same
//      generic error as a wrong code, after the same hashing work, so a
//      response can't be used to discover which room names exist.
//   3. Rate-limited again per room. Per-IP limits alone can't stop someone
//      rotating addresses to guess one couple's code; this caps the total
//      guesses against any single room, from anywhere. (The cost: someone
//      hammering a room can lock its owners out for the lockout window.
//      That's the right trade for a chat app — a short lockout is
//      recoverable, a guessed code isn't.)
//   4. The code is hashed and compared, in constant time, against that
//      room's two seats. Which seat matched IS the identity.
//   5. A v1 hash (from before rooms existed) is upgraded to v2 on the spot,
//      since this is the only moment the plaintext is ever available.
//   6. A single-use session token is minted for that seat's account.
//
// Omitting the room entirely signs in to the legacy room, if one exists —
// the original couple's app and codes keep working exactly as before, and
// the pre-rooms client (which never sends a room) keeps working through the
// rollout.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (provided by Supabase),
// CODE_PEPPER (set with `supabase secrets set`).

import { hashV1, hashV2, isPlausibleCode, matchSeat, normalizeCode, normalizeHandle, type SeatSecret } from '../_shared/codes.ts';
import {
  adminClient,
  allowAttempt,
  clientIp,
  env,
  GENERIC_LOGIN_ERROR,
  json,
  mintSessionToken,
  preflight,
  RATE_LIMIT_ERROR,
  readJson,
} from '../_shared/server.ts';

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  if (!body || typeof body.code !== 'string' || (body.room !== undefined && typeof body.room !== 'string')) {
    return json({ error: GENERIC_LOGIN_ERROR }, 400);
  }

  const pepper = env('CODE_PEPPER');
  const admin = adminClient();

  if (!(await allowAttempt(admin, `login:${clientIp(req)}`, 8, 900, 900))) {
    return json({ error: RATE_LIMIT_ERROR }, 429);
  }

  const code = normalizeCode(body.code);
  const roomInput = typeof body.room === 'string' ? normalizeHandle(body.room) : '';

  const roomQuery = admin.from('rooms').select('id, handle');
  const { data: room, error: roomError } = await (roomInput
    ? roomQuery.eq('handle', roomInput)
    : roomQuery.eq('is_legacy', true)
  ).maybeSingle();

  if (roomError) {
    console.error('room lookup failed', roomError);
    return json({ error: GENERIC_LOGIN_ERROR }, 500);
  }

  if (!room || !isPlausibleCode(code)) {
    // Spend the same hashing work a real check would, so "no such room"
    // and "wrong code" aren't distinguishable by timing either.
    await Promise.all([hashV1(code, pepper), hashV2(code, '00000000-0000-0000-0000-000000000000', pepper)]);
    return json({ error: GENERIC_LOGIN_ERROR }, 401);
  }

  if (!(await allowAttempt(admin, `login-room:${room.id}`, 30, 900, 900))) {
    return json({ error: RATE_LIMIT_ERROR }, 429);
  }

  const { data: seats, error: seatsError } = await admin
    .from('access_secrets')
    .select('role, secret_hash, hash_version')
    .eq('room_id', room.id);

  if (seatsError) {
    console.error('failed to load seat secrets', seatsError);
    return json({ error: GENERIC_LOGIN_ERROR }, 500);
  }

  const match = await matchSeat(code, room.id, (seats ?? []) as SeatSecret[], pepper);
  if (!match) {
    return json({ error: GENERIC_LOGIN_ERROR }, 401);
  }

  if (match.wasV1) {
    // Best-effort: a failed upgrade just means it's retried next login.
    const { error: upgradeError } = await admin
      .from('access_secrets')
      .update({ secret_hash: await hashV2(code, room.id, pepper), hash_version: 2 })
      .eq('room_id', room.id)
      .eq('role', match.role)
      .eq('hash_version', 1);
    if (upgradeError) console.error('v1 -> v2 hash upgrade failed', upgradeError);
  }

  const { data: seat, error: seatError } = await admin
    .from('room_members')
    .select('id')
    .eq('room_id', room.id)
    .eq('role', match.role)
    .maybeSingle();

  if (seatError || !seat) {
    console.error('matched a code but found no seat', seatError);
    return json({ error: GENERIC_LOGIN_ERROR }, 500);
  }

  const tokenHash = await mintSessionToken(admin, seat.id);
  if (!tokenHash) return json({ error: GENERIC_LOGIN_ERROR }, 500);

  return json({ role: match.role, roomId: room.id, handle: room.handle, tokenHash });
});
