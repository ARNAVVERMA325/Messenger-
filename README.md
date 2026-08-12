# ANYA LABS

A private, two-person messaging app. Elegant and personal on the surface;
built like a real messaging product underneath, not a mockup.

Built in phases, reviewed as it goes. See **Project status** below for what's
real today and what's still a placeholder.

## Project status — Phase 1 of 7

This is **Phase 1: Product + UI**. It ships a complete, polished mobile-first
interface — landing screen, access-code entry, full chat UI (bubbles,
timestamps, date separators, typing indicator, presence, unread indicator,
auto-scroll, empty/loading/error states, connection status, dark/light theme).

**What's real right now:**
- The full UI/UX, including animations, theming, and responsive/mobile layout.
- Connection status (online/offline banner) — driven by the browser's actual
  `online`/`offline` events.
- Theme preference persistence.

**What's simulated for this preview (clearly marked in code comments)** and
will be replaced in later phases:
- **Authentication** (`src/context/AuthContext.tsx`, `src/utils/accessCode.ts`)
  — accepts any well-formed code client-side. No server, no secret
  verification, no rate limiting yet. This is intentionally **not** the
  security mechanism — see the note below.
- **Messaging** (`src/context/ChatContext.tsx`) — messages, delivery/read
  status, and the "other side" replying/typing are all simulated in memory
  with `setTimeout`, seeded from `src/data/mockData.ts`. Nothing is sent over
  a network or persisted.

### About the access code

The product spec for ANYA LABS is:

```
ROOM IDENTIFIER + SECRET AUTHENTICATION + ROLE ("1" or "5")
```

The final digit (`1` → Side A, `5` → Side B) only ever selects **which chat
profile loads** after a person is authenticated — it is never the security
check itself. Phase 3 implements real server-side verification of the secret
portion (hashed, rate-limited, session-issuing); Phase 1's local check exists
purely so this UI could be built and reviewed before that backend exists.

## Roadmap

1. **Product + UI** *(this phase)*
2. Real messaging (backend + realtime, history, pagination, edit/delete)
3. Authentication + security (server-side auth, sessions, rate limiting)
4. Optional client-side privacy layer (AES-GCM, documented threat model)
5. Personal features (nicknames, avatars, reactions, pinned/favorite messages, etc.)
6. Polish (motion, skeletons, offline handling, accessibility)
7. Security + bug audit (two full passes)

## Getting started

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build
npm run lint     # oxlint
```

## Deploying (Netlify)

This repo includes `netlify.toml`, which:
- builds with `npm run build` and publishes `dist/`
- redirects all paths to `index.html` (required for client-side routing)
- sets baseline security headers

To deploy: connect the repo in Netlify, or run `netlify deploy` from the
Netlify CLI. No environment variables are required yet — Phase 1 has no
backend. Once a backend is added (Phase 2+), any **public** configuration
(e.g. a Supabase project URL and anon/publishable key) will be documented
here and set as Netlify environment variables (`VITE_`-prefixed, since only
`VITE_*` variables are exposed to the built frontend). Anything that must
stay secret (service-role keys, database credentials) will never live in
frontend code or a `VITE_` variable — those belong only to server-side
functions/edge functions, configured as regular (non-`VITE_`) environment
variables.

## Tech stack

- **React + TypeScript + Vite** — straightforward, fast, no framework magic.
- **SCSS Modules** for styling — CSS custom properties drive the dark/light
  theme at runtime; SCSS partials hold static design tokens and mixins.
- **React Router** for the two-screen flow (`/` and `/chat`).
- **Framer Motion** for the soft, purposeful animations, with
  `prefers-reduced-motion` respected throughout.

The codebase is intentionally small and readable — one folder per concern
(`components`, `context`, `hooks`, `utils`, `types`, `data`) — so it stays
maintainable by a single person as later phases add a real backend.
