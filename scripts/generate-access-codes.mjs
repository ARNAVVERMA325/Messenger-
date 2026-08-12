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
//   3. Generates two new random access codes, hashes each with
//      HMAC-SHA256(code, CODE_PEPPER), and stores only the hash in
//      access_secrets. The plaintext codes are printed once, below, and
//      never stored anywhere by this script or the database.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/generate-access-codes.mjs
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
const ROLE_DIGIT = { A: '1', B: '5' };

function emailForRole(role) {
  return `role-${role.toLowerCase()}@anya-labs.invalid`;
}

function generateCode(role) {
  const secretPart = randomBytes(16).toString('hex'); // 128 bits
  return `ANYA-${secretPart}-${ROLE_DIGIT[role]}`;
}

function hashCode(code) {
  return createHmac('sha256', CODE_PEPPER).update(code).digest('hex');
}

async function main() {
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

    const code = generateCode(role);
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
