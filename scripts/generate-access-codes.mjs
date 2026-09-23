#!/usr/bin/env node
// ANYA LABS — reset one room's access codes (the admin recovery tool).
//
// Rooms are created from inside the app now (the create-room function), so
// this script no longer sets anything up. What it's for: someone forgot
// their code. There's no email or SMS reset by design — the whole point is
// that neither person needs a phone number or inbox — so recovery is an
// admin running this with the service-role key.
//
// Run it locally, never in a deployed environment. The SERVICE ROLE key
// bypasses every access control in the database; this script only ever
// reads it from an environment variable and never writes it anywhere.
//
// Usage (PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
//   $env:CODE_PEPPER="<the value already set on your Edge Functions>"
//   $env:ROOM="their-room-name"
//   $env:CODE_B="a new phrase"        # reset only the seat you name
//   node scripts/generate-access-codes.mjs
//
// Set CODE_A and/or CODE_B. Only the seats you name change; the other
// person's code is left exactly as it is. Use the value `random` to have a
// 7-character code generated instead of choosing one.
//
// CODE_PEPPER is REQUIRED and must be the one your functions already use.
// Earlier versions generated a fresh pepper when it was missing; with many
// rooms that would silently invalidate every room's codes at once.

import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes } from 'node:crypto';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CODE_PEPPER, ROOM } = process.env;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (Supabase: Project Settings -> API).');
}
if (!CODE_PEPPER) {
  fail(
    'Missing CODE_PEPPER. It must be the value your Edge Functions already use —\n' +
      'a different one would make the new code (and every other room\'s) stop working.',
  );
}
if (!ROOM) fail('Missing ROOM — the room name whose codes you want to reset.');

const ROLES = ['A', 'B'];
const requested = ROLES.filter((role) => process.env[`CODE_${role}`]);
if (requested.length === 0) fail('Set CODE_A and/or CODE_B (a phrase, or `random`).');

// Excludes visually ambiguous characters (0/O, 1/I/L). 31^7 ≈ 27 billion.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RANDOM_LENGTH = 7;
const MIN_CUSTOM_LENGTH = 8;

/**
 * CRITICAL: must stay byte-for-byte equivalent to normalizeCode() in
 * supabase/functions/_shared/codes.ts and normalizeAccessCode() in
 * src/utils/accessCode.ts. Hashes are computed over this normalized form.
 */
function normalizeCode(raw) {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '');
}

/** CRITICAL: must match hashV2() in supabase/functions/_shared/codes.ts. */
function hashCodeV2(code, roomId) {
  return createHmac('sha256', CODE_PEPPER).update(`v2:${roomId}:${code}`).digest('hex');
}

function hashCodeV1(code) {
  return createHmac('sha256', CODE_PEPPER).update(code).digest('hex');
}

function randomCode() {
  const bytes = randomBytes(RANDOM_LENGTH);
  let code = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return normalizeCode(code);
}

// Same rules as newCodeProblem() in the functions' shared module: the room
// name and both display names are public, so a code containing them adds
// no secrecy however long the rest is.
function chosenCodeProblem(code, publicWords) {
  if (!/^[a-z0-9]+$/.test(code)) return 'can only contain letters and numbers (spaces and dashes are ignored)';
  if (code.length < MIN_CUSTOM_LENGTH) return `needs at least ${MIN_CUSTOM_LENGTH} letters or numbers`;
  for (const word of publicWords) {
    const w = normalizeCode(word);
    if (w.length >= 3 && code.includes(w)) return `contains "${word}", which isn't secret`;
  }
  if (/^(.)\1+$/.test(code)) return 'is too easy to guess';
  return null;
}

async function main() {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const handle = ROOM.trim().toLowerCase();
  const { data: room, error: roomError } = await admin.from('rooms').select('id, handle').eq('handle', handle).maybeSingle();
  if (roomError) fail(`Couldn't look up the room: ${roomError.message}`);
  if (!room) fail(`No room is called "${handle}".`);

  const [{ data: members, error: membersError }, { data: seats, error: seatsError }] = await Promise.all([
    admin.from('room_members').select('id, role, display_name').eq('room_id', room.id),
    admin.from('access_secrets').select('role, secret_hash, hash_version').eq('room_id', room.id),
  ]);
  if (membersError || seatsError) fail(`Couldn't load the room: ${(membersError ?? seatsError).message}`);

  const publicWords = [room.handle, ...members.map((m) => m.display_name ?? '')];

  // Build and validate everything before writing anything, so a bad CODE_B
  // can't leave CODE_A already changed.
  const newCodes = {};
  for (const role of requested) {
    const raw = process.env[`CODE_${role}`];
    const code = raw.trim().toLowerCase() === 'random' ? randomCode() : normalizeCode(raw);
    if (raw.trim().toLowerCase() !== 'random') {
      const problem = chosenCodeProblem(code, publicWords);
      if (problem) fail(`CODE_${role} ${problem}.`);
    }
    newCodes[role] = code;
  }

  // Seats are told apart purely by which hash a code matches, so the two
  // must never be equal — compare against the other seat's CURRENT hash
  // when only one is being reset, or against each other when both are.
  if (requested.length === 2 && newCodes.A === newCodes.B) fail('CODE_A and CODE_B must be different.');
  for (const role of requested) {
    const other = seats.find((s) => s.role !== role && !requested.includes(s.role));
    if (!other) continue;
    const candidate = other.hash_version === 1 ? hashCodeV1(newCodes[role]) : hashCodeV2(newCodes[role], room.id);
    if (candidate === other.secret_hash) fail(`CODE_${role} is the other person's code — pick a different one.`);
  }

  for (const role of requested) {
    const { error } = await admin
      .from('access_secrets')
      .upsert(
        { room_id: room.id, role, secret_hash: hashCodeV2(newCodes[role], room.id), hash_version: 2 },
        { onConflict: 'room_id,role' },
      );
    if (error) fail(`Couldn't store the new code for Side ${role}: ${error.message}`);

    const member = members.find((m) => m.role === role);
    if (member) {
      await admin.from('room_members').update({ code_changed_at: new Date().toISOString() }).eq('id', member.id);
    }
  }

  console.log(`\nRoom "${room.handle}" — new codes, shown once, never stored:\n`);
  for (const role of requested) {
    const name = members.find((m) => m.role === role)?.display_name || `Side ${role}`;
    console.log(`  ${name}: ${newCodes[role]}`);
  }
  console.log('');
}

main();
