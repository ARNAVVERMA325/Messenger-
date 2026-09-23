// Run with:  deno test supabase/functions/_shared/codes.test.ts
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { createHmac } from 'node:crypto';
import {
  handleProblem,
  hashV1,
  hashV2,
  isPlausibleCode,
  matchSeat,
  newCodeProblem,
  normalizeCode,
  normalizeHandle,
  type SeatSecret,
} from './codes.ts';

const PEPPER = 'test-pepper';
const ROOM = '0000000a-0000-0000-0000-000000000000';
const OTHER_ROOM = '0000000b-0000-0000-0000-000000000000';

Deno.test('normalizeCode ignores case, spaces and dashes', () => {
  for (const input of ['Blue Tshirt', 'blue-tshirt', '  BLUE  T-SHIRT ', 'bluetshirt']) {
    assertEquals(normalizeCode(input), 'bluetshirt');
  }
});

Deno.test('v1 hash is byte-identical to the Node setup script that created the live codes', async () => {
  // scripts/generate-access-codes.mjs used createHmac('sha256', PEPPER).update(code).
  // If this drifts, every existing code stops working the moment the new
  // login function is deployed.
  const fromNode = createHmac('sha256', PEPPER).update('bluetshirt').digest('hex');
  assertEquals(await hashV1('bluetshirt', PEPPER), fromNode);
});

Deno.test('v2 hash is bound to its room', async () => {
  assertNotEquals(await hashV2('bluetshirt', ROOM, PEPPER), await hashV2('bluetshirt', OTHER_ROOM, PEPPER));
  assertNotEquals(await hashV2('bluetshirt', ROOM, PEPPER), await hashV1('bluetshirt', PEPPER));
  const fromNode = createHmac('sha256', PEPPER).update(`v2:${ROOM}:bluetshirt`).digest('hex');
  assertEquals(await hashV2('bluetshirt', ROOM, PEPPER), fromNode);
});

Deno.test('matchSeat finds the right seat across v1 and v2 rows', async () => {
  const seats: SeatSecret[] = [
    { role: 'A', secret_hash: await hashV1('bluetshirt', PEPPER), hash_version: 1 }, // legacy row
    { role: 'B', secret_hash: await hashV2('greenone', ROOM, PEPPER), hash_version: 2 },
  ];
  assertEquals(await matchSeat('bluetshirt', ROOM, seats, PEPPER), { role: 'A', wasV1: true });
  assertEquals(await matchSeat('greenone', ROOM, seats, PEPPER), { role: 'B', wasV1: false });
  assertEquals(await matchSeat('wrongcode', ROOM, seats, PEPPER), null);
});

Deno.test("a v2 code from one room doesn't open a seat in another", async () => {
  const seats: SeatSecret[] = [
    { role: 'A', secret_hash: await hashV2('bluetshirt', OTHER_ROOM, PEPPER), hash_version: 2 },
  ];
  assertEquals(await matchSeat('bluetshirt', ROOM, seats, PEPPER), null);
});

Deno.test('newCodeProblem rejects the weak cases and accepts real phrases', () => {
  const publicWords = ['moon-house', 'Arnav', 'Anya'];
  assert(newCodeProblem('short', publicWords), 'too short');
  assert(newCodeProblem(normalizeCode('arnav loves tea'), publicWords), 'contains a display name');
  assert(newCodeProblem(normalizeCode('moonhouse 2024'), publicWords), 'contains the room handle');
  assert(newCodeProblem('aaaaaaaaaa', publicWords), 'one repeated character');
  assertEquals(newCodeProblem(normalizeCode('that blue umbrella'), publicWords), null);
  assertEquals(newCodeProblem(normalizeCode('chai biscuit 2am'), publicWords), null);
});

Deno.test('short public words do not block codes that merely contain their letters', () => {
  // A two-letter name shouldn't make every code containing "al" invalid.
  assertEquals(newCodeProblem(normalizeCode('royal blue kite'), ['Al']), null);
});

Deno.test('room handles', () => {
  assertEquals(normalizeHandle('  Moon House '), 'moon-house');
  assertEquals(normalizeHandle('moon__house--2'), 'moon-house-2');
  assertEquals(handleProblem('moon-house'), null);
  assert(handleProblem('ab'), 'too short');
  assert(handleProblem('-moon'), 'leading dash');
  assert(handleProblem('admin'), 'reserved');
  assert(handleProblem('moon.house'), 'bad character');
});

Deno.test('isPlausibleCode accepts every code shape that exists today', () => {
  assert(isPlausibleCode('k7m2qxp')); // 7-char random
  assert(isPlausibleCode('bluetshirt')); // chosen phrase
  assert(!isPlausibleCode('abc')); // obviously not a code
});
