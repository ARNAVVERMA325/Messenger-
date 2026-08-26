# ANYA LABS

A private, two-person messaging app. Elegant and personal on the surface;
built like a real messaging product underneath, not a mockup.

Built in phases, reviewed as it goes. See **Project status** below for what's
real today and what's still a placeholder.

## Project status — all 7 phases shipped

**Phase 1 (Product + UI)** shipped a complete, polished mobile-first
interface. **Phase 2 (Real messaging)** replaced the simulated backend with
Supabase Postgres + Realtime. **Phase 3 (Authentication + security)**
replaced Phase 2's "anyone authenticated can claim a seat" placeholder with
real, server-verified access codes. **Phase 4 (Privacy layer)** added
optional client-side message encryption. **Phase 5 (Personal features)**
adds real names and reply-to-message — deliberately just those two, see
below. **Phase 6 (polish)** and **Phase 7 (security audit)** followed, and
photos and voice notes were added after that (see below).

**What's real right now:**
- **Access codes are actually verified**, server-side, in the
  `verify-access-code` Edge Function (`supabase/functions/verify-access-code`):
  rate-limited by IP, hashed with a server-side pepper (HMAC-SHA256, never
  the plaintext), compared in constant time. Nothing about this is decided
  in the browser.
- **Rate limiting.** Repeated failed attempts from the same IP get
  temporarily locked out (`login_rate_limits` / `check_rate_limit()` in the
  Phase 3 migration).
- **Two fixed seats, provisioned up front.** Running
  `npm run generate-access-codes` once creates two permanent Supabase Auth
  accounts (one per seat) and prints the two plaintext codes — shown once,
  in your terminal, never stored anywhere. There's no more "first person to
  authenticate claims a seat": the room is fully provisioned before anyone
  ever opens the URL.
- **Real sign-in, real sign-out.** A valid code redeems a single-use,
  server-minted token for a real Supabase session tied to that seat's fixed
  account. Because the account is stable (not an ephemeral per-browser
  identity like Phase 2's), signing out is a real `signOut()` — logging back
  in with the correct code always returns to the same seat, from any device.
- **Generic errors, everywhere.** Every failure — malformed code, wrong
  code, rate-limited, seat not provisioned yet — returns the same message.
  A response can never be used to learn whether a side exists or which part
  of a guess was wrong.
- **Hardened database grants.** Every function's `EXECUTE` privilege is
  explicit (Supabase auto-grants new functions to `anon`/`authenticated` by
  default, unlike vanilla Postgres — Phase 2's functions happened to be safe
  via their own internal checks, but Phase 3 revokes the default grants and
  re-grants only what's needed, so that's no longer the only thing standing
  between `anon` and a `SECURITY DEFINER` function).
- Everything from Phases 1–2: full UI, realtime messaging, RLS on every
  table, HTTPS everywhere (Netlify + Supabase are HTTPS-only by default).

**What's still open, on purpose:**
- **Self-chosen codes shift some responsibility to you.** Random codes are
  the default and need no thought. If you set `CODE_A`/`CODE_B` yourself,
  the script enforces a length floor and rejects the obviously-guessable
  cases, but it can't judge whether your phrase is genuinely private —
  pick something only the two of you would know.
- **Rate limiting is per-IP only**, with no global/cross-IP limiter — a
  documented, accepted tradeoff for a small private app (see the comment on
  `check_rate_limit` in the migration).
- **Session length** follows your Supabase project's default JWT/refresh
  token expiry. If you want shorter sessions, that's a one-line change in
  **Authentication → Settings** in the dashboard, not app code.
- Phase 7 (security + bug audit) is where all of this gets re-examined with
  fresh, adversarial eyes — treat this phase as "should be solid," not
  "has been penetration tested."

### About the access code

Each seat has its own independent secret. There is no shared prefix and no
role digit: the login function hashes whatever you type and checks it
against both seats' stored hashes, and **whichever one matches is who you
are**. Nothing in a code announces which side it belongs to, and knowing
one side's code reveals nothing about the other's.

Entry is deliberately forgiving, because a code often has to be typed from
memory on a borrowed phone: case, spaces and hyphens are all ignored, so
`Blue Tshirt`, `blue-tshirt` and `bluetshirt` are the same code. That
normalization must stay identical in all three places that touch a code —
`src/utils/accessCode.ts`, the Edge Function, and the setup script — since
the stored hash is computed over the normalized form.

By default `generate-access-codes.mjs` picks a random 7-character code
(~27 billion combinations). You can choose your own phrase instead with
`CODE_A` / `CODE_B`, which is worth doing when the code must be recalled
with nothing available to look it up from. The script rejects the cases
that are actually weak — under 8 characters, or containing `anya`/`arnav`,
both of which are public knowledge for this project and so add no secrecy.
It also refuses to set both seats to the same code, which would make them
genuinely ambiguous.

## Privacy layer (optional, off by default)

Phase 4 adds an optional layer that encrypts message *text* in the browser
before it's sent. It's off until both people turn it on with the same
passphrase — nothing changes for anyone who doesn't use it. Here's exactly
what it does, in the terms the spec for this feature asked for directly:

**What is encrypted.** Only the text content of messages — what you type
into the message box. Nothing else: not who's messaging whom, not
timestamps, not delivered/read receipts, not typing/online presence, not
message length (well — ciphertext length, which correlates with plaintext
length). This is deliberately **not** described as full end-to-end
encryption of "the conversation" — it's encryption of message *content*,
and that distinction matters. If you turn it on, message text specifically
has the property that only someone holding the shared passphrase can read
it — including Anthropic, Supabase, or anyone with database access; that
part genuinely is end-to-end in the normal sense of the term. The metadata
listed above is not covered and Supabase can see all of it either way.

**Where encryption happens.** Entirely in your browser, in
`src/lib/crypto.ts`, using the Web Crypto API — nothing invented here, just
two standard, native primitives: PBKDF2 (turns your passphrase into a key)
and AES-GCM (authenticated encryption of the message text). There is no
server-side component to this feature at all: no Edge Function, no table,
no API call. The database just stores whatever string the browser hands it
and has no way to tell encrypted content from plain text, let alone
decrypt it.

**What the server can still see.** Everything except message text: sender,
recipient (there are only two people, so this is trivial anyway), exact
timestamps, edited/deleted status and when, delivered/read state, and
approximate message length. A Supabase project owner (or anyone who
obtained the service-role key) could read all of that regardless of whether
this feature is on. Turning encryption on does not hide that this
conversation exists, roughly how active it is, or when — only what was
actually said.

**How keys are created and stored.** Both people enter the exact same
passphrase (agreed on some other way — in person, a phone call — never
sent through this app before encryption is on, since that would defeat the
point). Each browser independently derives a 256-bit key from that
passphrase via PBKDF2 (250,000 iterations) and a salt that's public but
fixed per deployment (`VITE_ENCRYPTION_SALT` — see `.env.example`). The
derived key is cached in that browser's storage (via `deviceSessionStorage`,
so on a borrowed phone it is discarded with the tab rather than left behind)
so you don't have to retype the passphrase every visit. It is also cleared
on sign-out. Nothing about the passphrase or the key
is ever sent anywhere, stored server-side, or recoverable by anyone but the
two of you. Practical consequence: **if someone has access to your
unlocked device and its browser storage, they can read your encrypted
messages** — this protects the content in transit and at rest in the
database, not from someone holding the device itself.

**What happens if the passphrase or key is lost.** It's gone, permanently,
by design — that's what makes it a real secret rather than a recoverable
password. There's no "forgot passphrase" flow, because building one would
require storing something server-side that could decrypt your messages,
which defeats the entire point of this feature. If you both forget the
passphrase, every message encrypted with it stays permanently unreadable in
this app. You can still set a *new* passphrase going forward for new
messages; it just won't unlock the old ones. Write your passphrase down
somewhere durable if that risk matters to you — this app deliberately
gives you no other way back in.

One more honest limitation, since precision matters more than sounding
impressive: the PBKDF2 salt is public and shared by every user of a given
deployment (it has to be, so both browsers derive the same key with no way
to exchange a private salt between them). That means it defends against
a generic rainbow-table attack but not one built specifically targeting
this deployment's salt — set a unique `VITE_ENCRYPTION_SALT` per
deployment and pick a passphrase that isn't a common word or short phrase.

## Designed for infrequent, low-bandwidth visits

Two behaviors exist specifically because one of you may only open this app
for a few minutes at a time, from a borrowed device, on a slow connection —
not something a generic messaging app assumes:

- **Opens to what's new, not the bottom.** If there's a message you haven't
  seen, the chat opens scrolled to the first one, with an "Unread" divider
  — not dumped at the very latest message with everything new buried above
  it. See `initialUnreadMessageId` in `ChatContext`.
- **Fast by default, full history on request.** Opening the chat only
  fetches the last 15 messages (`FAST_LOAD_LIMIT`), not the usual 30, and
  doesn't paginate further until you tap **Show past chats**. That choice
  is never remembered — it's off again the next time the chat is opened,
  every time, on purpose. Sending and receiving new messages work
  identically either way; this only affects how much old history gets
  fetched up front.
- **"This isn't my phone."** Ticking this at login keeps the session in
  `sessionStorage` instead of `localStorage`, so the browser discards it when
  the tab or browser closes. Without it, the default behaviour — a session
  that persists and refreshes itself indefinitely — would leave whoever picks
  that phone up next signed in as you, with the full history readable. The
  cached encryption key follows the same rule, and is cleared on sign-out
  either way.

  Closing isn't relied on by itself, though: Android Chrome restores tabs
  when the app is reopened, and a restored tab usually gets its
  `sessionStorage` back too. So a shared-device session also expires after
  `SHARED_DEVICE_IDLE_MS` (15 minutes) without interaction, checked both on
  a timer and before any restored session is honoured on load. That check
  doesn't depend on tab lifecycle at all. See `src/lib/deviceSession.ts`.

## Photos and voice notes

Attachments are always encrypted — there is no unencrypted path — so
**sending one requires a passphrase set in Settings**. Until both of you
have set the same one, the camera and microphone buttons stay hidden
rather than silently uploading a readable file to a bucket meant to hold
ciphertext.

What that buys, and what it doesn't:

- **Nothing is written to the phone unless you ask.** The bucket holds
  ciphertext; the decrypted photo or voice note exists only as an in-memory
  blob URL that dies with the tab. Tapping a photo opens it full screen,
  where a **Save** button writes it to the device — the one deliberate
  exception. Long-press "save image" stays suppressed everywhere, so
  saving is always a choice rather than something that happens by
  brushing the screen.
- **Screenshots still work.** No web app can prevent them. If that matters,
  it needs to be a conversation between the two of you, not a feature.
- **Nothing downloads until tapped.** Each attachment shows a placeholder
  sized from metadata stored on the message row, so a photo-heavy history
  costs nothing to scroll on a slow connection.
- **Photos are downscaled before upload** (1600px max, JPEG). A side effect
  worth knowing: the canvas re-encode strips EXIF, including the GPS
  coordinates phone cameras embed by default.
- **Voice notes prefer Opus** — roughly 30kB a minute, capped at 5 minutes.

Deleting a message also deletes its file. Storage is capped at 25MB per
attachment by the database itself, not just the client.

## Personal features

The product spec's Phase 5 list includes avatars, reactions, pinned/
favorite messages, search, attachments, notes, and a shared calendar.
Shipped exactly two of those, on purpose (see the product rule about
staying small, not becoming a bloated social network) — the two that
came up as genuinely wanted, not the full list for its own sake:

- **Real names instead of "A"/"B".** Settings (the lock icon in the chat
  header) → Profile → set your name. Self-service only — you can only ever
  set your own, never the other side's. Shows up for the other person
  live, no refresh needed.
- **Reply-to-message.** Tap any message (yours or theirs) → Reply. Useful
  for a conversation that isn't continuous — referencing something from
  three weeks ago actually works instead of everyone re-explaining what
  they mean.

Reactions, pinned messages, and search are natural next additions if you
want them — the schema and component patterns here (see `MessageBubble`'s
tap-to-reveal actions, and how `reply_to_id` was added) are built to
extend the same way. Attachments and a shared notebook/calendar are bigger
scope changes (storage, sync model) that deserve their own deliberate pass
rather than being bolted on, especially given the low-bandwidth use case
above.

## Roadmap

1. Product + UI
2. Real messaging — backend + realtime, history, pagination, edit/delete
3. Authentication + security — server-verified secret check, rate
   limiting, real sign-out
4. Optional client-side privacy layer — AES-GCM message encryption,
   documented threat model (see "Privacy layer" above)
5. **Personal features** *(this phase)* — real names, reply-to-message
   (see "Personal features" above)
6. Polish (motion, skeletons, offline handling, accessibility)
7. Security + bug audit (two full passes)

## Setting up Supabase

The app needs a Supabase project to run — there's no built-in demo mode
beyond a "backend not configured" screen. You'll also need the
[Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in
(`supabase login`) to deploy the Edge Function and set its secrets.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the four files in `supabase/migrations/` in
   order (`0001_init.sql`, `0002_phase3_security.sql`,
   `0003_phase4_privacy.sql`, `0004_phase5_personal.sql`).
3. **Required manual step:** in the dashboard, go to **Project Settings →
   Realtime** and turn **off** "Allow public access". The migrations define
   RLS policies for the realtime channel (presence/typing), but they're only
   enforced once public access is disabled — this can't be done via SQL.
   (Separate from, and in addition to, the RLS already protecting the
   `messages` table, which works regardless.)
4. Copy your project's URL and anon/public key from **Project Settings →
   API**. Copy `.env.example` to `.env.local` and fill those two in.
5. Link the CLI to your project (`supabase link --project-ref <your-ref>`),
   then deploy the Edge Function: `supabase functions deploy verify-access-code`.
6. Set the function's pepper secret — pick any long random value, or let the
   next step generate one for you and print the command to run.
7. Provision the two seats and generate the actual access codes:
   ```bash
   SUPABASE_URL=https://your-project.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
   npm run generate-access-codes
   ```
   Find the service-role key in **Project Settings → API** (the "secret"
   key, not the anon one — this command needs it locally, once, and it's
   never written to any file). The script prints the two access codes once;
   give one to each person. If it also prints a `supabase secrets set
   CODE_PEPPER=...` command, run that now — the deployed function won't
   accept any code until it has a matching pepper.
8. Optional (Phase 4 privacy layer): set `VITE_ENCRYPTION_SALT` in
   `.env.local`/Netlify to a unique random value for this deployment (e.g.
   `openssl rand -hex 16`) — see "Privacy layer" above. Skippable; the
   feature works with a shared default salt, just with a documented,
   weaker guarantee against a targeted rainbow-table attack.
9. `npm run dev`.

**Never commit** the service-role key or the pepper anywhere, and never put
either in a `VITE_`-prefixed variable — both are server-only secrets. The
two values in `.env.local`/Netlify (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) remain the only ones the frontend ever sees, and
they're safe to be public (see `src/lib/supabaseClient.ts`).

**Rotating a code:** re-run `npm run generate-access-codes` (with the same
`CODE_PEPPER` as an env var, to avoid having to update the Edge Function
secret) — it's idempotent for the accounts/seats and just issues fresh
codes.

## Getting started

```bash
npm install
npm run dev                    # local dev server — needs .env.local, see above
npm run build                  # type-check + production build
npm run lint                   # oxlint
npm run generate-access-codes  # provision seats / (re)generate access codes
```

## Deploying (Netlify)

This repo includes `netlify.toml`, which:
- builds with `npm run build` and publishes `dist/`
- redirects all paths to `index.html` (required for client-side routing)
- sets baseline security headers

To deploy: connect the repo in Netlify, or run `netlify deploy` from the
Netlify CLI. In the Netlify site's **Environment variables** settings, add
the same two values from `.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ENCRYPTION_SALT` (optional — see "Privacy layer" above)

All three are public values, safe to set as plain (non-secret) environment
variables — see "Setting up Supabase" above. Nothing else needs to be
configured in Netlify; the service-role key and `CODE_PEPPER` live only in
Supabase (as an Edge Function secret) and your own terminal when running the
setup script — never in Netlify, never in this repo, never in the frontend
bundle. Netlify serves everything over HTTPS by default.

## Tech stack

- **React + TypeScript + Vite** — straightforward, fast, no framework magic.
- **Supabase** — Postgres (data + row-level security), Realtime (live
  messages, presence, typing), Auth (real sessions for two fixed accounts),
  Edge Functions (Deno) for the one thing that must never run client-side:
  verifying the access code.
- **SCSS Modules** for styling — CSS custom properties drive the dark/light
  theme at runtime; SCSS partials hold static design tokens and mixins.
- **React Router** for the two-screen flow (`/` and `/chat`).
- **Framer Motion** for the soft, purposeful animations, with
  `prefers-reduced-motion` respected throughout.
- **Web Crypto API** (native browser, no library) for the optional privacy
  layer — PBKDF2 key derivation and AES-GCM message encryption.

The codebase is intentionally small and readable — one folder per concern
(`components`, `context`, `hooks`, `utils`, `types`, `lib`) — so it stays
maintainable by a single person. Note on typing: `src/lib/database.types.ts`
declares the Postgres row shapes by hand and they're applied as casts at the
query boundary in `ChatContext`/`AuthContext`, rather than threaded through
`createClient`'s generic — this project's TypeScript toolchain doesn't
reliably resolve that generic today (see the comment in
`src/lib/supabaseClient.ts`).
