// ANYA LABS — change-code: replace your own access code.
//
// Requires your CURRENT code, not just a signed-in session. The case this
// guards: you signed in on a friend's phone and forgot to leave. A session
// alone must not be enough for whoever picks that phone up to change your
// code and lock you out of your own room.
//
// On success:
//   - every OTHER session of your seat is signed out, so changing your code
//     is also how you evict a session you left open somewhere;
//   - room_members.code_changed_at is set, which the other person's app
//     shows as "<name> changed their code" — without the code itself, which
//     is never shown to anyone but the person who chose it.

import { hashV2, matchSeat, newCodeProblem, normalizeCode, type SeatSecret } from '../_shared/codes.ts';
import { adminClient, allowAttempt, env, json, preflight, RATE_LIMIT_ERROR, readJson, requireMember } from '../_shared/server.ts';

const WRONG_CURRENT_CODE = "Your current code wasn't right.";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const admin = adminClient();
  const member = await requireMember(req, admin);
  if (!member) return json({ error: 'Please sign in again.' }, 401);

  const body = await readJson(req);
  if (!body || typeof body.currentCode !== 'string' || typeof body.newCode !== 'string') {
    return json({ error: 'Please fill in both codes.' }, 400);
  }

  if (!(await allowAttempt(admin, `change-code:${member.userId}`, 5, 900, 900))) {
    return json({ error: RATE_LIMIT_ERROR }, 429);
  }

  const pepper = env('CODE_PEPPER');
  const currentCode = normalizeCode(body.currentCode);
  const newCode = normalizeCode(body.newCode);

  const [{ data: seats, error: seatsError }, { data: members, error: membersError }] = await Promise.all([
    admin.from('access_secrets').select('role, secret_hash, hash_version').eq('room_id', member.roomId),
    admin.from('room_members').select('display_name').eq('room_id', member.roomId),
  ]);
  if (seatsError || membersError || !seats) {
    console.error('failed to load room for code change', seatsError ?? membersError);
    return json({ error: "Your code couldn't be changed. Please try again." }, 500);
  }

  const currentMatch = await matchSeat(currentCode, member.roomId, seats as SeatSecret[], pepper);
  if (!currentMatch || currentMatch.role !== member.role) {
    return json({ error: WRONG_CURRENT_CODE }, 403);
  }

  const publicWords = [member.handle, ...(members ?? []).map((m) => (m.display_name as string) ?? '')];
  const problem = newCodeProblem(newCode, publicWords);
  if (problem) return json({ error: problem }, 400);

  // The two seats must stay distinguishable: a code is the whole identity,
  // so if both seats shared one, the login function couldn't tell them apart.
  const otherSeats = (seats as SeatSecret[]).filter((seat) => seat.role !== member.role);
  if (await matchSeat(newCode, member.roomId, otherSeats, pepper)) {
    return json({ error: 'That code is already in use in this room — pick a different one.' }, 400);
  }

  const { error: updateError } = await admin
    .from('access_secrets')
    .update({ secret_hash: await hashV2(newCode, member.roomId, pepper), hash_version: 2 })
    .eq('room_id', member.roomId)
    .eq('role', member.role);
  if (updateError) {
    console.error('failed to store new code', updateError);
    return json({ error: "Your code couldn't be changed. Please try again." }, 500);
  }

  await admin.from('room_members').update({ code_changed_at: new Date().toISOString() }).eq('id', member.userId);

  // Evict any other session this seat has open (a borrowed phone left
  // signed in). Their current access token lapses on its own within the
  // hour; this stops it from ever being refreshed.
  const { error: signOutError } = await admin.auth.admin.signOut(member.accessToken, 'others');
  if (signOutError) console.error('could not sign out other sessions', signOutError);

  return json({ ok: true });
});
