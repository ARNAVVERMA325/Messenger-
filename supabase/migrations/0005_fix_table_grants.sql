-- ANYA LABS — fix missing table-level GRANTs
--
-- Migrations 0001-0004 set up Row Level Security policies on every table,
-- but RLS only restricts access an operation is otherwise allowed to
-- attempt — it doesn't grant that access in the first place. That base
-- permission comes from ordinary Postgres GRANTs, and none were ever
-- issued for these tables (only functions got explicit grants, in the
-- Phase 3 migration). This was invisible until now because nothing had
-- run against a real, live project yet.
--
-- Without this, generate-access-codes.mjs fails with
-- "permission denied for table room_members" when it tries to seed a
-- seat, and — more importantly — the deployed app itself would fail the
-- same way the first time it tried to send or read a message, and the
-- verify-access-code Edge Function would fail the same way on every
-- login attempt.

-- room_members: the app reads this directly (member names / last-seen);
-- only the setup script writes to it directly (every other write goes
-- through set_display_name/touch_presence, which run as the function
-- owner and don't need caller-side grants).
grant select on public.room_members to authenticated;
grant select, insert, update on public.room_members to service_role;

-- messages: the app reads and sends directly; edits/deletes go through
-- edit_message/delete_message instead, so no update/delete grant needed
-- here.
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.messages to service_role;

-- access_secrets: read directly by the verify-access-code Edge Function
-- (service_role), written directly by the setup script (service_role).
-- Deliberately no grant to anon/authenticated — Phase 3 already revoked
-- those, this just adds what service_role was always meant to have.
grant select, insert, update on public.access_secrets to service_role;

-- login_rate_limits needs no grant here: it's only ever touched through
-- check_rate_limit(), which already runs as the function owner.
