# ANYA LABS

A private, two-person messaging app. Elegant and personal on the surface;
built like a real messaging product underneath, not a mockup.

Built in phases, reviewed as it goes. See **Project status** below for what's
real today and what's still a placeholder.

## Project status — Phase 3 of 7

**Phase 1 (Product + UI)** shipped a complete, polished mobile-first
interface. **Phase 2 (Real messaging)** replaced the simulated backend with
Supabase Postgres + Realtime. **Phase 3 (Authentication + security)**
replaces Phase 2's "anyone authenticated can claim a seat" placeholder with
real, server-verified access codes.

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
- **No per-code password strength story to worry about** — codes are
  128-bit random values this app generates for you, not something a person
  chooses, so there's no weak-password problem to solve here.
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

The product spec for ANYA LABS is:

```
ROOM IDENTIFIER + SECRET AUTHENTICATION + ROLE ("1" or "5")
```

`generate-access-codes.mjs` produces codes shaped like
`ANYA-<32 random hex chars>-1` / `...-5`. `ANYA` is a constant, public
prefix (branding, not secret — there's only one room, so there's nothing
for it to select between). The random middle segment is the actual secret,
independently generated per seat — knowing one side's code reveals nothing
about the other's, even though they share the same visible prefix. The
final digit only ever selects **which chat profile loads** after the secret
is verified; see `src/utils/accessCode.ts` and the Edge Function for why
it's never treated as part of the security check itself.

## Roadmap

1. Product + UI
2. Real messaging — backend + realtime, history, pagination, edit/delete
3. **Authentication + security** *(this phase)* — server-verified secret
   check, rate limiting, real sign-out
4. Optional client-side privacy layer (AES-GCM, documented threat model)
5. Personal features (nicknames, avatars, reactions, pinned/favorite messages, etc.)
6. Polish (motion, skeletons, offline handling, accessibility)
7. Security + bug audit (two full passes)

## Setting up Supabase

The app needs a Supabase project to run — there's no built-in demo mode
beyond a "backend not configured" screen. You'll also need the
[Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in
(`supabase login`) to deploy the Edge Function and set its secrets.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql`, then
   `supabase/migrations/0002_phase3_security.sql`, in that order.
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
8. `npm run dev`.

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

Both are public values, safe to set as plain (non-secret) environment
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

The codebase is intentionally small and readable — one folder per concern
(`components`, `context`, `hooks`, `utils`, `types`, `lib`) — so it stays
maintainable by a single person. Note on typing: `src/lib/database.types.ts`
declares the Postgres row shapes by hand and they're applied as casts at the
query boundary in `ChatContext`/`AuthContext`, rather than threaded through
`createClient`'s generic — this project's TypeScript toolchain doesn't
reliably resolve that generic today (see the comment in
`src/lib/supabaseClient.ts`).
