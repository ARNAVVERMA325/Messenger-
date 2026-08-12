# ANYA LABS

A private, two-person messaging app. Elegant and personal on the surface;
built like a real messaging product underneath, not a mockup.

Built in phases, reviewed as it goes. See **Project status** below for what's
real today and what's still a placeholder.

## Project status — Phase 2 of 7

**Phase 1 (Product + UI)** shipped a complete, polished mobile-first
interface. **Phase 2 (Real messaging)** replaces the simulated backend from
Phase 1 with a real one: Supabase Postgres + Realtime + Auth.

**What's real right now:**
- **Messages live in Postgres** (`supabase/migrations/0001_init.sql`), not
  memory or LocalStorage: history, pagination (30 at a time, infinite
  scroll), edit, soft-delete, delivered/read receipts.
- **Realtime** over a Supabase Realtime channel: new messages, edits,
  deletes, and receipt updates stream to both people live; presence tracks
  who's online; typing is an ephemeral broadcast (nothing persisted).
- **Real sessions.** Signing in creates a genuine Supabase Auth session
  (anonymous auth under the hood), persisted by the Supabase client itself
  — not a hand-rolled `sessionStorage` flag.
- **Real access control.** Every table has row-level security; nothing is
  reachable with just the public anon key. Reads/writes are enforced
  Postgres-side by the policies and `SECURITY DEFINER` functions in the
  migration — see that file for the full model, including a required manual
  dashboard step for Realtime.
- **Reconnect handling.** The connection banner reflects the *actual*
  realtime channel state (not just the browser's online/offline events),
  and reconnecting triggers a backfill fetch for anything missed while
  disconnected.
- Everything from Phase 1: theming, animations, mobile layout, etc.

**What's still provisional (Phase 3's job, and clearly commented in code):**
- **The access code's secret portion still isn't verified against
  anything.** `login()` (`src/context/AuthContext.tsx`) checks the code's
  *shape*, reads its role digit, then calls a `claim_role` RPC that's
  first-come-first-served per seat with no rate limiting. Until Phase 3
  ships a server-verified secret check (a hashed check in an Edge Function
  that becomes the only path allowed to call `claim_role`), **anyone who
  opens the deployed URL before both seats are claimed can claim one** —
  don't share the URL publicly until Phase 3 lands. Once both seats are
  claimed, the room is closed to further claims.
- **Logout doesn't fully sign out.** A seat is bound to this browser's
  anonymous Supabase identity, and there's no way yet to reclaim a seat
  with a *different* identity — so logging out only clears local UI state
  (with a flag so it survives a refresh) rather than truly invalidating the
  session. Real, safe sign-out arrives in Phase 3 once seats are bound to
  the verified code instead of to this ephemeral identity. Full reasoning
  is in the `logout()` comment in `AuthContext.tsx`.

### About the access code

The product spec for ANYA LABS is:

```
ROOM IDENTIFIER + SECRET AUTHENTICATION + ROLE ("1" or "5")
```

The final digit (`1` → Side A, `5` → Side B) only ever selects **which chat
profile loads** after a person is authenticated — it is never the security
check itself (see the provisional-gaps note above for exactly what that
means right now).

## Roadmap

1. Product + UI
2. **Real messaging** *(this phase)* — backend + realtime, history,
   pagination, edit/delete
3. Authentication + security (server-verified secret check, rate limiting,
   real sign-out, session expiration)
4. Optional client-side privacy layer (AES-GCM, documented threat model)
5. Personal features (nicknames, avatars, reactions, pinned/favorite messages, etc.)
6. Polish (motion, skeletons, offline handling, accessibility)
7. Security + bug audit (two full passes)

## Setting up Supabase

The app needs a Supabase project to run — there's no built-in demo mode
beyond a "backend not configured" screen.

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run the contents of
   `supabase/migrations/0001_init.sql` once, top to bottom.
3. **Required manual step:** in the dashboard, go to **Project Settings →
   Realtime** and turn **off** "Allow public access". The migration defines
   RLS policies for the realtime channel (presence/typing), but they're
   only enforced once public access is disabled — this can't be done via
   SQL. (This is separate from — and in addition to — the RLS already
   protecting the `messages` table itself, which works regardless.)
4. Copy your project's URL and anon/public key from **Project Settings →
   API**.
5. Copy `.env.example` to `.env.local` and fill in those two values.
6. `npm run dev`.

Both values are safe to expose publicly (see `src/lib/supabaseClient.ts` for
why) — they identify your project but grant no access on their own; every
table is locked down with RLS. Never put a Supabase **service-role** key in
this app's frontend code or in a `VITE_`-prefixed variable — that key
bypasses RLS entirely and only ever belongs server-side (a future Edge
Function, in Phase 3).

## Getting started

```bash
npm install
npm run dev      # local dev server — needs .env.local, see above
npm run build    # type-check + production build
npm run lint     # oxlint
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
configured in Netlify for this phase; there's no service-role key or other
secret involved anywhere in the frontend.

## Tech stack

- **React + TypeScript + Vite** — straightforward, fast, no framework magic.
- **Supabase** — Postgres (data + row-level security), Realtime (live
  messages, presence, typing), Auth (anonymous sessions for now).
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
