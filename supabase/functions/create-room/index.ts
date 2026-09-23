// ANYA LABS — create-room: set up a new private space for two.
//
// Anyone can call this, and that's safe for a specific reason: it can only
// ever create a NEW room. It never reads, joins or modifies an existing one,
// so there is nothing for a stranger to take over — the worst they can do
// is make a room of their own, which is the point.
//
// The person creating the room sets up both seats — their own name and
// code, and their partner's. That's deliberate: it works when the partner
// has no phone of their own to receive an invite on, which is exactly who
// this app exists for. The partner can change their code afterwards from
// inside the app, and should (see change-code).
//
// Abuse limits: 3 rooms per IP per hour. Everything created here is rolled
// back if any step fails, so a half-built room never exists.

import {
  handleProblem,
  hashV2,
  newCodeProblem,
  normalizeCode,
  normalizeHandle,
  randomHex,
} from '../_shared/codes.ts';
import {
  adminClient,
  allowAttempt,
  clientIp,
  env,
  json,
  mintSessionToken,
  preflight,
  RATE_LIMIT_ERROR,
  readJson,
} from '../_shared/server.ts';

const MAX_NAME_LENGTH = 40;

interface SeatInput {
  name: string;
  code: string;
}

function readSeat(value: unknown): SeatInput | null {
  if (!value || typeof value !== 'object') return null;
  const { name, code } = value as Record<string, unknown>;
  if (typeof name !== 'string' || typeof code !== 'string') return null;
  return { name: name.trim(), code: normalizeCode(code) };
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  const you = readSeat(body?.you);
  const partner = readSeat(body?.partner);
  if (!body || typeof body.handle !== 'string' || !you || !partner) {
    return json({ error: 'Please fill in every field.' }, 400);
  }

  const handle = normalizeHandle(body.handle);
  const problem =
    handleProblem(handle) ??
    (!you.name || !partner.name ? 'Both names are needed.' : null) ??
    (you.name.length > MAX_NAME_LENGTH || partner.name.length > MAX_NAME_LENGTH
      ? `Names can be up to ${MAX_NAME_LENGTH} characters.`
      : null) ??
    newCodeProblem(you.code, [handle, you.name, partner.name]) ??
    newCodeProblem(partner.code, [handle, you.name, partner.name]) ??
    (you.code === partner.code ? 'Each of you needs a different code.' : null);

  if (problem) return json({ error: problem }, 400);

  const pepper = env('CODE_PEPPER');
  const admin = adminClient();

  if (!(await allowAttempt(admin, `create:${clientIp(req)}`, 3, 3600, 3600))) {
    return json({ error: RATE_LIMIT_ERROR }, 429);
  }

  const { data: room, error: roomError } = await admin
    .from('rooms')
    .insert({ handle, encryption_salt: randomHex(16) })
    .select('id, handle')
    .single();

  if (roomError || !room) {
    // 23505 = unique_violation: the handle was taken (possibly a moment ago,
    // by someone else racing for the same name).
    if (roomError?.code === '23505') return json({ error: 'That room name is taken — try another.' }, 409);
    console.error('failed to create room', roomError);
    return json({ error: "The room couldn't be created. Please try again." }, 500);
  }

  const createdUserIds: string[] = [];

  // Undo everything on any failure below. Deleting the room cascades to its
  // members, messages and secrets; the auth accounts need deleting too.
  const rollBack = async (reason: unknown) => {
    console.error('create-room failed, rolling back', reason);
    await admin.from('rooms').delete().eq('id', room.id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  };

  try {
    const seats = [
      { role: 'A' as const, ...you },
      { role: 'B' as const, ...partner },
    ];

    for (const seat of seats) {
      const { data, error } = await admin.auth.admin.createUser({
        // .invalid is reserved (RFC 2606): it can never resolve or receive
        // mail. The account is reached only through this app's codes.
        email: `seat-${crypto.randomUUID()}@anya-labs.invalid`,
        password: randomHex(24), // never used; sign-in is always via a minted token
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error('createUser returned no user');
      createdUserIds.push(data.user.id);

      const { error: memberError } = await admin
        .from('room_members')
        .insert({ id: data.user.id, room_id: room.id, role: seat.role, display_name: seat.name });
      if (memberError) throw memberError;

      const { error: secretError } = await admin.from('access_secrets').insert({
        room_id: room.id,
        role: seat.role,
        secret_hash: await hashV2(seat.code, room.id, pepper),
        hash_version: 2,
      });
      if (secretError) throw secretError;
    }
  } catch (error) {
    await rollBack(error);
    return json({ error: "The room couldn't be created. Please try again." }, 500);
  }

  // Sign the creator straight in.
  const tokenHash = await mintSessionToken(admin, createdUserIds[0]);
  if (!tokenHash) {
    // The room exists and is usable — only the automatic sign-in failed.
    return json({ roomId: room.id, handle: room.handle, role: 'A', tokenHash: null });
  }

  return json({ roomId: room.id, handle: room.handle, role: 'A', tokenHash });
});
