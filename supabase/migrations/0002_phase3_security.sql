-- ANYA LABS — Phase 3 schema: real authentication + security hardening
--
-- This migration does three things:
--
-- 1. Replaces Phase 2's "anyone authenticated can claim a seat" model with
--    real server-verified access codes. The two seats are now provisioned
--    UP FRONT (by you, running scripts/generate-access-codes.mjs once)
--    against two fixed, permanent Supabase Auth users — not claimed
--    on-the-fly by whoever happens to authenticate first. `claim_role()`
--    from Phase 2 is dropped entirely; there is nothing left to claim.
--
-- 2. Adds rate limiting for login attempts (`login_rate_limits` /
--    `check_rate_limit()`), used by the verify-access-code Edge Function.
--
-- 3. Explicitly hardens every function's execute grants. Supabase grants
--    EXECUTE on new functions to anon/authenticated/service_role by
--    default (unlike vanilla Postgres) — several Phase 2 functions relied
--    only on their own internal auth.uid() checks for protection, which
--    happened to be safe but wasn't defense-in-depth. This revokes the
--    default grants and re-grants only what's actually needed.
--
-- UPGRADING FROM PHASE 2 TESTING: if you already claimed a seat while
-- testing Phase 2, that row's `id` belongs to a throwaway anonymous user,
-- not the fixed account this phase provisions. Because `room_members.role`
-- is unique, that leftover row will make generate-access-codes.mjs fail
-- with a duplicate-key error when it tries to seed the same role for the
-- new fixed account. Delete old rows first: `delete from room_members;`
-- (and optionally clean up the orphaned anonymous users under Authentication
-- -> Users in the dashboard — they're harmless left in place, just clutter).
--
-- None of this is reachable from the frontend directly: access codes are
-- verified, and secrets/rate-limit state read or written, only by the
-- verify-access-code Edge Function using the service-role key — a secret
-- that lives solely in that function's environment (see
-- `supabase secrets set` in the README), never in frontend code.

-- ---------------------------------------------------------------------------
-- access_secrets: one HMAC-SHA256 hash per seat. Never the plaintext code —
-- generate-access-codes.mjs shows each code once, in your terminal, and
-- never writes it anywhere. No RLS policies are defined, so this table is
-- unreachable from anon/authenticated entirely; only service_role (which
-- bypasses RLS) can read it, i.e. only the Edge Function.
-- ---------------------------------------------------------------------------
create table public.access_secrets (
  role text primary key check (role in ('A', 'B')),
  secret_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.access_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- login_rate_limits: sliding-window attempt counter + lockout, keyed by
-- caller IP. Same access model as access_secrets — no policies, service
-- role (the Edge Function) only.
-- ---------------------------------------------------------------------------
create table public.login_rate_limits (
  key text primary key,
  attempt_count int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.login_rate_limits enable row level security;

-- Returns true if this attempt is allowed (and records it); false if the
-- caller is currently locked out. Row-locks the counter to stay correct
-- under concurrent requests from the same key.
--
-- Note on limits: this is intentionally simple — rate limiting is per-IP
-- only, with no cross-IP/global limiter. A distributed attacker rotating
-- IPs isn't stopped by this alone. For a small private app that's an
-- accepted tradeoff; revisit if that threat model ever changes.
create or replace function public.check_rate_limit(
  p_key text,
  p_max_attempts int default 8,
  p_window_seconds int default 900,
  p_lockout_seconds int default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.login_rate_limits;
  v_now timestamptz := now();
begin
  select * into v_row from login_rate_limits where key = p_key for update;

  if not found then
    insert into login_rate_limits (key, attempt_count, window_start)
    values (p_key, 1, v_now);
    return true;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return false;
  end if;

  if v_now - v_row.window_start > make_interval(secs => p_window_seconds) then
    update login_rate_limits
    set attempt_count = 1, window_start = v_now, locked_until = null
    where key = p_key;
    return true;
  end if;

  if v_row.attempt_count + 1 > p_max_attempts then
    update login_rate_limits
    set attempt_count = v_row.attempt_count + 1,
        locked_until = v_now + make_interval(secs => p_lockout_seconds)
    where key = p_key;
    return false;
  end if;

  update login_rate_limits
  set attempt_count = v_row.attempt_count + 1
  where key = p_key;
  return true;
end;
$$;

revoke execute on function public.check_rate_limit(text, int, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int, int) to service_role;

revoke select, insert, update, delete on public.access_secrets from anon, authenticated;
revoke select, insert, update, delete on public.login_rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retire Phase 2's claim-on-demand model. Seats are provisioned up front by
-- generate-access-codes.mjs (which seeds room_members directly using the
-- service-role key), so there's nothing left for a client to "claim".
-- ---------------------------------------------------------------------------
drop function if exists public.claim_role(text);

-- ---------------------------------------------------------------------------
-- Harden the remaining Phase 2 functions: explicit revoke + re-grant.
-- Functionally unchanged (each already gated on auth.uid() internally) —
-- this removes reliance on that being the *only* thing standing between
-- anon and these SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.edit_message(uuid, text) from public, anon;
revoke execute on function public.delete_message(uuid) from public, anon;
revoke execute on function public.mark_messages_delivered(uuid[]) from public, anon;
revoke execute on function public.mark_messages_read(uuid[]) from public, anon;

grant execute on function public.touch_presence() to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.mark_messages_delivered(uuid[]) to authenticated;
grant execute on function public.mark_messages_read(uuid[]) to authenticated;
