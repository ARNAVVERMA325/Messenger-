-- ANYA LABS — Phase 2 schema
--
-- This app is a single, private two-person room: there is no multi-room
-- concept, so there's no room_id anywhere — the whole database *is* the
-- room. Everything here assumes exactly two participants, "A" and "B".
--
-- PHASE 2 vs PHASE 3 — read this before relying on it in production:
--   `claim_role()` below lets any authenticated (anonymous) Supabase
--   session claim the "A" or "B" seat, first-come-first-served, capped at
--   one person per role. It does NOT yet verify the access code's secret
--   portion against anything — that's Phase 3's job (a hashed-secret check
--   in a server-side Edge Function, with rate limiting, that becomes the
--   only path allowed to call claim_role). Until Phase 3 ships, anyone who
--   opens the deployed URL before both seats are claimed can take one.
--   Once both seats are claimed, the room is closed to further claims.
--
-- Everything else here (RLS on messages, realtime authorization) is the
-- real, permanent access-control model — it's only role assignment that's
-- still provisional.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- room_members: the two seats ("A" and "B") and who currently holds them.
-- ---------------------------------------------------------------------------
create table public.room_members (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('A', 'B')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (role)
);

alter table public.room_members enable row level security;

create policy "members can view room_members"
  on public.room_members
  for select
  to authenticated
  using (true);

-- No insert/update/delete policies are defined on purpose: every write goes
-- through a SECURITY DEFINER function below, so we control exactly what a
-- session is allowed to change instead of exposing raw column writes.

create or replace function public.claim_role(p_role text)
returns public.room_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_existing public.room_members;
  v_row public.room_members;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_role not in ('A', 'B') then
    raise exception 'invalid role';
  end if;

  select * into v_existing from room_members where id = auth.uid();
  if found then
    return v_existing; -- idempotent: same session re-entering keeps its seat
  end if;

  select count(*) into v_count from room_members;
  if v_count >= 2 then
    raise exception 'room is full';
  end if;

  if exists (select 1 from room_members where role = p_role) then
    raise exception 'role already taken';
  end if;

  insert into room_members (id, role) values (auth.uid(), p_role)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.claim_role(text) to authenticated;

create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update room_members set last_seen_at = now() where id = auth.uid();
$$;

grant execute on function public.touch_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_role text not null check (sender_role in ('A', 'B')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
);

create index messages_created_at_idx on public.messages (created_at);

alter table public.messages enable row level security;

-- Only the two claimed room members can ever see messages.
create policy "members can read messages"
  on public.messages
  for select
  to authenticated
  using (exists (select 1 from room_members where id = (select auth.uid())));

-- Members can only insert messages as themselves, under their own claimed role.
create policy "members can send messages as themselves"
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_role = (select role from room_members where id = (select auth.uid()))
  );

-- No UPDATE/DELETE policy: edits, soft-deletes, and delivery/read receipts
-- all go through the functions below, which enforce who can change what.

create or replace function public.edit_message(p_id uuid, p_content text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.messages;
begin
  if p_content is null or char_length(trim(p_content)) = 0 or char_length(p_content) > 4000 then
    raise exception 'invalid content';
  end if;

  update messages
  set content = trim(p_content), edited_at = now()
  where id = p_id
    and sender_id = auth.uid()
    and deleted_at is null
  returning * into v_row;

  if not found then
    raise exception 'message not found or not editable';
  end if;

  return v_row;
end;
$$;

grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.delete_message(p_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.messages;
begin
  update messages
  set deleted_at = now()
  where id = p_id
    and sender_id = auth.uid()
    and deleted_at is null
  returning * into v_row;

  if not found then
    raise exception 'message not found or not deletable';
  end if;

  return v_row;
end;
$$;

grant execute on function public.delete_message(uuid) to authenticated;

create or replace function public.mark_messages_delivered(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update messages
  set delivered_at = coalesce(delivered_at, now())
  where id = any (p_ids)
    and sender_id <> auth.uid()
    and exists (select 1 from room_members where id = auth.uid());
$$;

grant execute on function public.mark_messages_delivered(uuid[]) to authenticated;

create or replace function public.mark_messages_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update messages
  set read_at = coalesce(read_at, now()),
      delivered_at = coalesce(delivered_at, now())
  where id = any (p_ids)
    and sender_id <> auth.uid()
    and exists (select 1 from room_members where id = auth.uid());
$$;

grant execute on function public.mark_messages_read(uuid[]) to authenticated;

-- Stream row changes to subscribed clients (gated by the SELECT policy above).
alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------------
-- Realtime Authorization for Presence (online/last-seen) and Broadcast
-- (typing indicator) on the "room" channel. Without this, anyone holding
-- the public anon key could join that channel and see presence/typing
-- events even without a claimed seat — this closes that gap the same way
-- RLS closes it for the messages table.
--
-- RLS is already enabled on realtime.messages by default (Supabase docs
-- explicitly say not to run ALTER TABLE ... ENABLE ROW LEVEL SECURITY on
-- it), so only the policies are needed here.
--
-- REQUIRED MANUAL STEP — this migration alone is not enough: in the
-- Supabase dashboard, go to Project Settings -> Realtime and turn OFF
-- "Allow public access". Until you do, these policies are defined but not
-- enforced, and the channel stays open to anyone with the anon key. The
-- client also has to open the channel with `{ config: { private: true } }`
-- for these policies to apply (already done in src/context/ChatContext.tsx).
-- ---------------------------------------------------------------------------
create policy "room members can listen on the room channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'room'
    and exists (select 1 from public.room_members where id = (select auth.uid()))
  );

create policy "room members can send on the room channel"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() = 'room'
    and exists (select 1 from public.room_members where id = (select auth.uid()))
  );
