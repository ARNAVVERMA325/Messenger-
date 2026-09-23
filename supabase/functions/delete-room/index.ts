// ANYA LABS — delete-room: permanently erase a room and everything in it.
//
// Either person can do this, because either person must be able to take
// their own words back out of the world — but it erases BOTH people's
// history, so it demands two things a lingering session alone can't
// supply: the caller's current code, and the room's name typed out.
//
// Order matters: files first (nothing else references them once the rows
// are gone, so a failure later would orphan them silently), then the room
// row, whose deletion cascades to members, messages and code hashes, then
// the two accounts.

import { matchSeat, normalizeCode, normalizeHandle, type SeatSecret } from '../_shared/codes.ts';
import { adminClient, allowAttempt, env, json, preflight, RATE_LIMIT_ERROR, readJson, requireMember } from '../_shared/server.ts';

const BUCKET = 'attachments';
const PAGE = 1000;

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const admin = adminClient();
  const member = await requireMember(req, admin);
  if (!member) return json({ error: 'Please sign in again.' }, 401);

  const body = await readJson(req);
  if (!body || typeof body.currentCode !== 'string' || typeof body.confirmHandle !== 'string') {
    return json({ error: 'Please fill in both fields.' }, 400);
  }

  if (!(await allowAttempt(admin, `delete-room:${member.userId}`, 5, 900, 900))) {
    return json({ error: RATE_LIMIT_ERROR }, 429);
  }

  if (normalizeHandle(body.confirmHandle) !== member.handle) {
    return json({ error: "That isn't this room's name." }, 400);
  }

  const { data: seats, error: seatsError } = await admin
    .from('access_secrets')
    .select('role, secret_hash, hash_version')
    .eq('room_id', member.roomId);
  if (seatsError || !seats) return json({ error: "The room couldn't be deleted. Please try again." }, 500);

  const match = await matchSeat(normalizeCode(body.currentCode), member.roomId, seats as SeatSecret[], env('CODE_PEPPER'));
  if (!match || match.role !== member.role) {
    return json({ error: "Your code wasn't right." }, 403);
  }

  // 1. Files: everything in the room's folder, plus any pre-rooms files at
  //    the bucket root that this room's messages point at (legacy room only).
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(BUCKET).list(member.roomId, { limit: PAGE, offset });
    if (error) {
      console.error('failed to list room files', error);
      return json({ error: "The room couldn't be deleted. Please try again." }, 500);
    }
    paths.push(...(data ?? []).map((file) => `${member.roomId}/${file.name}`));
    if (!data || data.length < PAGE) break;
  }

  const { data: rootLevel } = await admin
    .from('messages')
    .select('attachment_path')
    .eq('room_id', member.roomId)
    .not('attachment_path', 'is', null)
    .not('attachment_path', 'like', '%/%');
  paths.push(...(rootLevel ?? []).map((row) => row.attachment_path as string));

  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + PAGE));
    if (error) {
      console.error('failed to remove room files', error);
      return json({ error: "The room couldn't be deleted. Please try again." }, 500);
    }
  }

  // 2. The room, cascading to members, messages and code hashes.
  const { data: members } = await admin.from('room_members').select('id').eq('room_id', member.roomId);
  const { error: roomError } = await admin.from('rooms').delete().eq('id', member.roomId);
  if (roomError) {
    console.error('failed to delete room', roomError);
    return json({ error: "The room couldn't be deleted. Please try again." }, 500);
  }

  // 3. The accounts. Nothing references them any more; a failure here
  //    leaves a seatless account that can't sign in to anything.
  for (const { id } of members ?? []) {
    const { error } = await admin.auth.admin.deleteUser(id as string);
    if (error) console.error('failed to delete seat account', id, error);
  }

  return json({ ok: true });
});
