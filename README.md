# ANYA LABS

Private messaging for two. Each couple gets their own room — a name, two
seats, and a code each — and nothing else: no email, no phone number, no
profile anyone else can find.

It was built for one long-distance couple where one person has no phone of
their own and borrows one for a few minutes at a time, and every design
decision follows from that: codes you can recall from memory on a stranger's
phone, sessions that don't outlive a borrowed device, and a first load light
enough for patchy mobile data.

## How it works

- **A room** has a name (`blue-umbrella`), two seats, and a private chat.
  Anyone can create one at `/create`. The person creating it sets up **both**
  seats — their own name and code, and their partner's — so the partner
  never needs a phone or inbox to be invited. They're just told their code.
- **Signing in** is the room name plus your code. Capitals, spaces and
  hyphens never matter (`Blue Umbrella` = `blue-umbrella`, `Chai Biscuit` =
  `chaibiscuit`). An invite link (`/r/blue-umbrella`) fills the room name in.
- **Your code is your identity.** Each seat's code is distinct; the server
  works out who you are from which seat your code matches. Change yours any
  time in Settings (it needs your current code, not just a session). The
  other person is told you changed it — never what it is.
- **There is no password reset.** Nothing stores an email or phone number,
  so a forgotten code can't be recovered from inside the app. An admin with
  the service-role key can reset one (see "Resetting a forgotten code").
- **Deleting a room** (Settings) erases every message, photo, voice note and
  both accounts. Either person can do it; it requires their code and the
  room's name typed out.

## What's actually enforced, and where

Access control lives in the database, not the app. Every table has row-level
security, and since migration `0007` every rule asks the same question:
**is the caller a member of this row's room?** That covers messages, members,
read receipts, the realtime channel (one per room, `room:<room id>`), and
stored files (each room's live under `<room id>/`).

This is tested, not assumed: `supabase/tests` runs every migration against a
real Postgres and checks — from both sides — that one room can't read,
write, forge receipts in, reply into, attach files from, or listen in on
another. The suite has been mutation-tested: removing the room check from
message reads, or from receipts, makes it fail.

- **Codes are verified server-side only**, in the `verify-access-code` Edge
  Function: hashed with a server-side pepper (HMAC-SHA256, never stored in
  plaintext), compared in constant time against the room's two seats.
- **Rate limiting at two levels.** Per IP, and per room — so someone
  rotating IP addresses still can't make more than 30 guesses per 15 minutes
  against any one couple. (The trade-off: hammering a room can lock its
  owners out for that window. A short lockout is recoverable; a guessed code
  isn't.)
- **Unknown rooms look exactly like wrong codes** — same message, same
  hashing work — so the login can't be used to discover which rooms exist.
- **Hashes are bound to their room** (v2: `HMAC(pepper, "v2:" + room + ":" +
  code)`), so a leaked pepper can't test one guess against every room at
  once. Rooms from before this existed hold v1 hashes; each is upgraded the
  next time its owner signs in, the only moment the plaintext exists.
- **Creating a room can't touch another room.** `create-room` only ever
  makes something new, rolls back completely on any failure, and is limited
  to 3 rooms per IP per hour.
- **No secret ever reaches the browser.** The frontend sees only the project
  URL and anon key, both public by design. The service-role key and the
  pepper exist only as Edge Function secrets.

**Still open, on purpose:**
- **Chosen codes shift some responsibility to you.** The server enforces a
  length floor and rejects codes containing the room name or either
  person's name (those aren't secret), but it can't judge whether a phrase is
  genuinely private.
- **Session length** follows your Supabase project's JWT/refresh settings
  (**Authentication → Settings**), except on shared devices — see below.
- **No abuse tooling yet.** Rooms can be created by anyone. There's rate
  limiting, but no moderation, reporting, or per-room storage quota beyond
  the 25MB-per-file cap.

## Designed for borrowed phones and slow data

- **"This isn't my phone."** Ticking this at sign-in keeps the session in
  `sessionStorage`, doesn't remember the room name, and expires the session
  after 15 minutes without interaction. The expiry doesn't rely on the tab
  closing: Android Chrome restores tabs (and usually their `sessionStorage`)
  when the app reopens, so it's checked on a timer, when the tab comes back
  into view, and before any restored session is honoured. Signing out also
  clears the cached encryption key and any decrypted photos held in memory.
  See `src/lib/deviceSession.ts`.
- **Opens to what's new, not the bottom.** Unread messages get an "Unread"
  divider and the chat opens there.
- **Fast by default, full history on request.** Opening the chat fetches
  only the last 15 messages until you tap **Show past chats** — a choice
  never remembered, on purpose.
- **Light first load.** The chat and create-room screens are separate
  chunks, fetched only when needed, with retries for a dropped request on a
  patchy connection.

## Privacy layer (optional)

An optional layer encrypts message *text* in the browser before it's sent.
It's off until both people turn it on with the same passphrase, agreed on
some other way (in person, a call — never through this app).

**What's encrypted:** message text, photos and voice notes. **What isn't:**
who's talking, timestamps, receipts, presence, and approximate message
length. So this is encryption of *content* — genuinely end-to-end for that
content, since only someone with the passphrase can read it (including
anyone with database access) — but it doesn't hide that the conversation
exists or how active it is.

**How it works:** PBKDF2 (250,000 iterations) derives a 256-bit key from the
passphrase; AES-GCM encrypts. Both are native Web Crypto — nothing invented
here, and no server component at all. Each room created since `0007` has its
own random salt. The original room keeps the deployment-wide salt
(`VITE_ENCRYPTION_SALT`), because a different salt would derive a different
key and make every message it ever encrypted unreadable.

**If the passphrase is lost, so is everything encrypted with it.** There's
no recovery, by design — any recovery path would mean storing something
server-side that could decrypt your messages. The derived key is cached on
the device so you don't retype it each visit, which means **someone holding
your unlocked device can read your encrypted messages**: this protects
content in transit and at rest, not from the device itself.

## Photos and voice notes

Attachments are always encrypted — there is no unencrypted path — so
sending one needs a passphrase. The camera and microphone buttons are always
visible, and explain what's needed if one hasn't been set.

- **Nothing is written to the phone unless you ask.** Storage holds only
  ciphertext; the readable file exists as an in-memory blob URL that dies
  with the tab. A photo opened full screen has a **Save** button — the one
  deliberate exception. Long-press "save image" is suppressed everywhere.
- **Screenshots still work.** No web app can prevent them.
- **Nothing downloads until tapped.** Placeholders are sized from metadata
  on the message row, so a photo-heavy history costs nothing to scroll.
- **Photos are downscaled** to 1600px JPEG before upload, which also strips
  EXIF — including the GPS coordinates phone cameras embed by default.
- **Voice notes prefer Opus** — about 30kB a minute, capped at 5 minutes.

Deleting a message deletes its file too. The database itself caps each
attachment at 25MB.

## Personal features

Real names instead of "A"/"B" (Settings → Profile, visible to the other
person live), and reply-to-message (tap a message → Reply). Reactions,
pinned messages and search are natural next additions and would extend the
same patterns (`MessageBubble`'s tap-to-reveal actions, the way
`reply_to_id` was added).

## Setting up your own deployment

Everything below is what a fresh, self-hosted copy needs. You'll need the
[Supabase CLI](https://supabase.com/docs/guides/cli) logged in
(`npx supabase login`).

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run every file in `supabase/migrations/` in order,
   `0001` through the highest number. On a fresh project, `0007` creates no
   "legacy" room — you start empty.
3. Link the CLI and deploy the four functions:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy verify-access-code
   npx supabase functions deploy create-room
   npx supabase functions deploy change-code
   npx supabase functions deploy delete-room
   ```
4. Set the pepper — any long random value, **once**. Changing it later
   invalidates every room's codes.
   ```bash
   npx supabase secrets set CODE_PEPPER=$(openssl rand -hex 32)
   ```
5. **Project Settings → Realtime:** turn **off** "Allow public access", so
   the per-room channel policies are enforced (this can't be done in SQL).
6. Copy `.env.example` to `.env.local` with your project URL and anon key
   (**Project Settings → API**). Optionally set `VITE_ENCRYPTION_SALT` to a
   random value — it's only used by a room from before `0007`.
7. `npm install && npm run dev`, open `/create`, and make your first room.

To deploy the frontend, connect the repo to Netlify (the included
`netlify.toml` handles the build, client-side routing and security headers)
and set the same `VITE_` variables there. They're all public values.
**Never** put the service-role key or the pepper in a `VITE_` variable, in
Netlify, or in this repo.

### Resetting a forgotten code

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
CODE_PEPPER=<the value your functions already use> \
ROOM=blue-umbrella \
CODE_B="a new phrase" \
npm run generate-access-codes
```

Only the seats you name (`CODE_A` and/or `CODE_B`, or `random` for a
generated one) change. The script refuses to run without the existing
pepper, since a new one would silently break every room.

### Running the tests

```bash
# Database: needs a local Postgres (any 16+). Runs every migration twice —
# as an upgrade of an existing single-room database, and as a fresh
# install — then the isolation suite against each.
PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh

# Edge Function logic (hashing, normalisation, validation):
deno test supabase/functions/_shared/codes.test.ts
```

## Upgrading an existing single-room deployment

If you ran this app before rooms existed, migration `0007` converts your
room in place: members, messages, code hashes and attachments are all kept,
and the room is named `anya-labs` (rename it with
`update public.rooms set handle = 'new-name' where is_legacy;`). Your
existing codes keep working, and signing in with **no** room name still
reaches this room — so nobody has to learn anything new.

The app you already have deployed keeps working after the SQL runs, before
the new frontend ships: the old client's channel name and upload paths stay
allowed for that one room (marked `LEGACY COMPAT` in the migration).

Order matters: **run `0007`, then deploy the four functions, then the
frontend.** The new frontend detects an un-migrated database and says it's
being upgraded rather than failing in confusing ways.

## Tech stack

- **React + TypeScript + Vite**, **SCSS Modules** with CSS custom properties
  for theming, **React Router**, **Framer Motion** (reduced motion respected).
- **Supabase**: Postgres with row-level security, Realtime (messages,
  presence, typing), Auth (two accounts per room, reached only through
  codes), Storage (encrypted attachments), and Deno Edge Functions for
  everything that must never run in a browser.
- **Web Crypto** for encryption — no crypto library.

Row types are declared by hand in `src/lib/database.types.ts` and applied at
the query boundary rather than threaded through `createClient`'s generic,
which this project's TypeScript toolchain doesn't resolve reliably (see
`src/lib/supabaseClient.ts`).
