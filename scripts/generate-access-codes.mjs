#!/usr/bin/env node
// ANYA LABS — one-time (or rotate-anytime) setup script.
//
// Run this locally, never in a deployed environment. It uses your
// Supabase project's SERVICE ROLE key — a secret that bypasses every
// access control in the database — which this script only ever reads
// from an environment variable and never writes anywhere.
//
// What it does:
//   1. Ensures the two fixed auth users (one per seat, "A" and "B") exist.
//   2. Seeds their room_members rows directly (service role bypasses RLS).
//   3. Sets each seat's access code — random by default, or one you choose
//      (see CODE_A / CODE_B below) — hashes it with
//      HMAC-SHA256(code, CODE_PEPPER), and stores only the hash in
//      access_secrets. The plaintext codes are printed once, below, and
//      never stored anywhere by this script or the database.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/generate-access-codes.mjs
//
// CHOOSING YOUR OWN CODES (optional): set CODE_A and/or CODE_B to a phrase
// instead of letting this script pick a random one:
//
//   CODE_A="chai biscuit 2am" CODE_B="that blue umbrella" \
//   node scripts/generate-access-codes.mjs
//
// A chosen phrase is worth it when the code has to be recalled from memory
// on someone else's phone, with nothing saved to look it up from. Entry is
// forgiving — case, spaces and hyphens are all ignored — so "Chai Biscuit
// 2am" and "chaibiscuit2am" are the same code. Pick something only the two
// of you would know; see customCode() below for what gets rejected and why.
//
// The code is the whole identity: each side's code is distinct, and the
// login function works out which seat you are by seeing which stored hash
// your code matches. Nothing in the code itself announces its side.
//
// Optionally pass CODE_PEPPER=<existing value> to rotate the two codes
// without changing the pepper your Edge Function already has configured.
// If you omit it, this script generates a new pepper and prints it —
// you MUST then run `supabase secrets set CODE_PEPPER=<that value>` for
// the deployed verify-access-code function to match.

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHmac } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CODE_PEPPER = process.env.CODE_PEPPER ?? randomBytes(32).toString('hex');
const pepperWasGenerated = !process.env.CODE_PEPPER;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Find both in your Supabase project: Project Settings -> API.\n\n' +
      'Usage:\n' +
      '  SUPABASE_URL=https://xxxx.supabase.co \\\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=eyJ... \\\n' +
      '  node scripts/generate-access-codes.mjs',
  );
  process.exit(1);
}

const ROLES = ['A', 'B'];

// Excludes visually ambiguous characters (0/O, 1/I/L) so a code can be
// hand-typed on a phone without guesswork. 31 symbols ^ 7 positions is
// ~27 billion combinations — short enough to type once (sessions persist,
// see src/lib/supabaseClient.ts), comfortably ahead of what the
// login endpoint's rate limiting (8 attempts/15min/IP) can be used to grind
// through.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SECRET_LENGTH = 7;

// A self-chosen code is memorable precisely because it's personal, which is
// the whole point when it has to be recalled on a borrowed phone with
// nothing saved to look it up from. The floor exists because a *short*
// self-chosen code is the weak case — see the rejection messages below.
const MIN_CUSTOM_LENGTH = 8;

/**
 * CRITICAL: must stay byte-for-byte equivalent to `normalizeAccessCode()`
 * in src/utils/accessCode.ts and `normalizeCode()` in
 * supabase/functions/verify-access-code/index.ts. The hash stored below is
 * computed over this normalized form, so drift means valid codes stop
 * working.
 */
function normalizeCode(raw) {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '');
}

function emailForRole(role) {
  return `role-${role.toLowerCase()}@anya-labs.invalid`;
}

function randomCode() {
  const bytes = randomBytes(SECRET_LENGTH);
  let secretPart = '';
  for (let i = 0; i < SECRET_LENGTH; i++) {
    secretPart += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return normalizeCode(secretPart);
}

// Turns a chosen phrase into a real code. Exits with an explanation rather
// than silently accepting something weak.
function customCode(rawPhrase, role) {
  const phrase = normalizeCode(rawPhrase);

  if (!/^[a-z0-9]+$/.test(phrase)) {
    console.error(
      `CODE_${role} can only contain letters and numbers (spaces and hyphens are fine — they're ignored).`,
    );
    process.exit(1);
  }

  if (phrase.length < MIN_CUSTOM_LENGTH) {
    console.error(
      `CODE_${role} is too short — it needs at least ${MIN_CUSTOM_LENGTH} letters/numbers.\n` +
        'Short codes are the one case where a self-chosen code is genuinely weaker than a random\n' +
        'one: the login endpoint is rate limited per IP, but that limit is not a defense against\n' +
        'an attacker rotating IPs, so the code itself has to carry the weight.',
    );
    process.exit(1);
  }

  // "anya" is the app's own branding and "arnav" is the GitHub account that
  // hosts it — both are the first things anyone looking at this project
  // would try, so they add no secrecy no matter how long the rest is.
  for (const guessable of ['anya', 'arnav']) {
    if (phrase.includes(guessable)) {
      console.error(
        `CODE_${role} contains "${guessable}", which is public knowledge for this project\n` +
          '(the app is called ANYA LABS and lives on github.com/ARNAVVERMA325). Pick something only\n' +
          'the two of you would know — an inside joke, a shared memory, a made-up word.',
      );
      process.exit(1);
    }
  }

  if (/^[0-9]+$/.test(phrase)) {
    console.warn(
      `Note: CODE_${role} is all digits, which is weaker per character than mixing in letters.\n` +
        'Long enough that it still works, but a word or phrase would be both safer and easier to recall.\n',
    );
  }

  return phrase;
}

function codeForRole(role) {
  const chosen = process.env[`CODE_${role}`];
  return chosen ? customCode(chosen, role) : randomCode();
}

// A seat is now identified purely by which stored hash a code matches, so
// two identical codes would make the seats genuinely ambiguous — the login
// function would hand out whichever it compared last. The old trailing role
// digit used to make this impossible; nothing does now, so check explicitly.
function assertCodesDiffer(codeByRole) {
  const [a, b] = ROLES.map((role) => codeByRole[role]);
  if (a === b) {
    console.error(
      'CODE_A and CODE_B are the same code — each side needs its own.\n' +
        "(Spaces, dashes and capitals are ignored, so \"Blue Tshirt\" and \"blue-tshirt\" count as identical.)",
    );
    process.exit(1);
  }
}

function hashCode(code) {
  return createHmac('sha256', CODE_PEPPER).update(code).digest('hex');
}

async function main() {
  // Build (and validate) both codes before touching anything, so a rejected
  // CODE_B can't leave Side A already rotated to a code you'd never see.
  const codeByRole = Object.fromEntries(ROLES.map((role) => [role, codeForRole(role)]));
  assertCodesDiffer(codeByRole);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: usersPage, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    console.error('Failed to list existing users:', listError.message);
    process.exit(1);
  }
  const existingByEmail = new Map(usersPage.users.map((u) => [u.email, u]));

  const results = [];

  for (const role of ROLES) {
    const email = emailForRole(role);
    let user = existingByEmail.get(email);

    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: randomBytes(24).toString('hex'), // never used — auth only ever happens via the Edge Function's magic-link flow
        email_confirm: true,
        user_metadata: { anya_role: role },
      });
      if (error || !data.user) {
        console.error(`Failed to create user for Side ${role}:`, error?.message);
        process.exit(1);
      }
      user = data.user;
      console.log(`Created auth user for Side ${role}.`);
    } else {
      console.log(`Auth user for Side ${role} already exists — reusing it.`);
    }

    const { error: memberError } = await admin
      .from('room_members')
      .upsert({ id: user.id, role }, { onConflict: 'id' });
    if (memberError) {
      console.error(`Failed to seed room_members for Side ${role}:`, memberError.message);
      process.exit(1);
    }

    const code = codeByRole[role];
    const secretHash = hashCode(code);

    const { error: secretError } = await admin
      .from('access_secrets')
      .upsert({ role, secret_hash: secretHash }, { onConflict: 'role' });
    if (secretError) {
      console.error(`Failed to store access secret for Side ${role}:`, secretError.message);
      process.exit(1);
    }

    results.push({ role, code });
  }

  console.log('\nDone. Give each person their code — shown once, right here, never stored:\n');
  for (const { role, code } of results) {
    console.log(`  Side ${role}: ${code}`);
  }

  if (pepperWasGenerated) {
    console.log('\nA new CODE_PEPPER was generated for this run. Set it on your Edge Function now:\n');
    console.log(`  supabase secrets set CODE_PEPPER=${CODE_PEPPER}\n`);
    console.log('Without that, verify-access-code will reject both codes above (hash mismatch).');
  }
}

main();
