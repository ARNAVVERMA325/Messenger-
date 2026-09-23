-- ANYA LABS — many rooms, one app
--
-- Until now the whole database WAS the room: exactly two seats, "A" and
-- "B", and every policy asked only "are you one of the two members?". With
-- more than one couple that question becomes dangerous — it would let any
-- member of any room read every room. So this migration introduces rooms
-- and rewrites every access rule to ask "are you a member of THIS row's
-- room?" instead.
--
-- Three properties this migration is built to guarantee, and which
-- supabase/tests checks against a real Postgres:
--
--   1. Nothing existing is lost. If this database already has a room's
--      worth of members, it becomes the "legacy" room, and every member,
--      message, code hash and attachment is attached to it in place.
--   2. The app already deployed keeps working after this runs, before its
--      replacement ships. The old client talks on a realtime channel named
--      "room" and uploads photos to the bucket root; both are still allowed,
--      for the legacy room only (marked LEGACY COMPAT below — safe to drop
--      in a later migration once every client is on the new build).
--   3. A fresh install gets no legacy room at all — it starts empty and
--      purely multi-tenant.
--
-- One user belongs to exactly one room (room_members.id stays the primary
-- key). That keeps "which room am I in?" a single, unambiguous lookup,
-- which every policy below leans on.

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- What people type to log in, and what appears in invite links
  -- (/r/<handle>). Not a secret — codes carry the security.
  handle text not null unique
    check (handle ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  -- PBKDF2 salt for this room's optional passphrase encryption. NULL means
  -- "use the deployment-wide salt", which is what the legacy room has
  -- always used — changing it would silently make every existing encrypted
  -- message unreadable, because the same passphrase would derive a
  -- different key.
  encryption_salt text,
  is_legacy boolean not null default false,
  created_at timestamptz not null default now()
);

-- At most one legacy room can exist.
create unique index rooms_single_legacy on public.rooms (is_legacy) where is_legacy;

alter table public.rooms enable row level security;

-- Only an existing deployment (one that already has members or messages)
-- gets a legacy room; a fresh install has nothing to preserve.
--
-- The handle is changeable afterwards with:
--   update public.rooms set handle = 'your-name-here' where is_legacy;
insert into public.rooms (handle, is_legacy)
select 'anya-labs', true
where exists (select 1 from public.room_members)
   or exists (select 1 from public.messages);

-- ---------------------------------------------------------------------------
-- room_members: add the room, make "role" unique per room instead of
-- globally, and track code changes so the other person can be told.
-- ---------------------------------------------------------------------------
alter table public.room_members
  add column room_id uuid references public.rooms (id) on delete cascade,
  add column code_changed_at timestamptz;

update public.room_members
set room_id = (select id from public.rooms where is_legacy)
where room_id is null;

alter table public.room_members alter column room_id set not null;
alter table public.room_members drop constraint room_members_role_key;
alter table public.room_members add constraint room_members_room_role_key unique (room_id, role);

-- ---------------------------------------------------------------------------
-- Who am I, and where? Every policy below is phrased in terms of these.
--
-- SECURITY DEFINER so they read room_members without re-entering its own
-- RLS policy (which itself calls my_room_id() — that would recurse), and
-- STABLE so Postgres evaluates them once per statement when wrapped in a
-- scalar subquery, not once per row.
-- ---------------------------------------------------------------------------
create or replace function public.my_room_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select room_id from public.room_members where id = auth.uid()
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.room_members where id = auth.uid()
$$;

create or replace function public.my_room_is_legacy()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.is_legacy
     from public.rooms r
     join public.room_members m on m.room_id = r.id
     where m.id = auth.uid()),
    false
  )
$$;

revoke execute on function public.my_room_id() from public, anon;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.my_room_is_legacy() from public, anon;
grant execute on function public.my_room_id() to authenticated, service_role;
grant execute on function public.my_role() to authenticated, service_role;
grant execute on function public.my_room_is_legacy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
alter table public.messages add column room_id uuid references public.rooms (id) on delete cascade;

update public.messages
set room_id = (select id from public.rooms where is_legacy)
where room_id is null;

alter table public.messages alter column room_id set not null;

-- Clients never have to (and can't usefully) choose the room: an insert
-- that omits room_id lands in the sender's own room. The insert policy
-- below still checks it, so passing someone else's room_id just fails.
alter table public.messages alter column room_id set default public.my_room_id();

-- Every read is "this room's messages in time order".
drop index if exists public.messages_created_at_idx;
create index messages_room_created_idx on public.messages (room_id, created_at);
create index messages_attachment_path_idx on public.messages (attachment_path) where attachment_path is not null;

-- Live bug fix, found by the test harness: a photo or voice note with no
-- caption stores an empty content string whenever message encryption is
-- switched off, and the old "content must be non-empty" check rejected it.
-- (It only ever worked with encryption on, because an empty string
-- encrypts to a non-empty envelope.) Text is still required when there's
-- nothing attached.
alter table public.messages drop constraint messages_content_check;
alter table public.messages add constraint messages_content_check
  check (
    char_length(content) <= 12000
    and (char_length(content) >= 1 or attachment_path is not null)
  );

-- Cross-room references that the row-level policies can't express on their
-- own: a message's attachment must live in its own room's folder, and a
-- reply can only quote a message from the same room.
create or replace function public.check_message_room_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_legacy boolean;
begin
  if new.attachment_path is not null
     and new.attachment_path not like new.room_id::text || '/%' then
    -- LEGACY COMPAT: files uploaded before 0007 (or by the pre-0007 client
    -- during rollout) sit at the bucket root. Only the legacy room may
    -- reference a root-level path; everyone else must use their folder.
    select is_legacy into v_is_legacy from public.rooms where id = new.room_id;
    if position('/' in new.attachment_path) <> 0 or not coalesce(v_is_legacy, false) then
      raise exception 'attachment must be stored in the message''s own room folder';
    end if;
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages where id = new.reply_to_id and room_id = new.room_id
  ) then
    raise exception 'a reply can only quote a message from the same room';
  end if;

  return new;
end;
$$;

create trigger messages_room_consistency
  before insert or update of room_id, attachment_path, reply_to_id
  on public.messages
  for each row
  execute function public.check_message_room_consistency();

-- ---------------------------------------------------------------------------
-- access_secrets: one row per (room, seat), plus a hash version.
--
--   v1 = HMAC(pepper, code)                     — what the legacy room has
--   v2 = HMAC(pepper, 'v2:' || room_id || ':' || code)
--
-- v2 binds each hash to its room, so identical codes in two different rooms
-- hash differently, and a leaked pepper can't be used to test one guess
-- against every room at once. Existing v1 rows keep working and are
-- upgraded to v2 transparently the next time their owner logs in (the
-- login function is the only place the plaintext code is ever available).
-- ---------------------------------------------------------------------------
alter table public.access_secrets
  add column room_id uuid references public.rooms (id) on delete cascade,
  add column hash_version smallint not null default 1;

update public.access_secrets
set room_id = (select id from public.rooms where is_legacy)
where room_id is null;

alter table public.access_secrets alter column room_id set not null;
alter table public.access_secrets alter column hash_version set default 2;
alter table public.access_secrets drop constraint access_secrets_pkey;
alter table public.access_secrets add primary key (room_id, role);
alter table public.access_secrets add constraint access_secrets_hash_version_check check (hash_version in (1, 2));

-- ---------------------------------------------------------------------------
-- Row-level security, rewritten room by room.
-- ---------------------------------------------------------------------------
create policy "members can view their own room"
  on public.rooms
  for select
  to authenticated
  using (id = (select public.my_room_id()));

drop policy "members can view room_members" on public.room_members;
create policy "members can view their own room's members"
  on public.room_members
  for select
  to authenticated
  using (room_id = (select public.my_room_id()));

drop policy "members can read messages" on public.messages;
create policy "members can read their own room's messages"
  on public.messages
  for select
  to authenticated
  using (room_id = (select public.my_room_id()));

drop policy "members can send messages as themselves" on public.messages;
create policy "members can send into their own room, as themselves"
  on public.messages
  for insert
  to authenticated
  with check (
    room_id = (select public.my_room_id())
    and sender_id = (select auth.uid())
    and sender_role = (select public.my_role())
  );

-- ---------------------------------------------------------------------------
-- Receipts: these were scoped only by "not my own message", which in a
-- multi-room world would let anyone mark any room's messages as read by
-- passing their ids. Now they only touch the caller's own room.
-- ---------------------------------------------------------------------------
create or replace function public.mark_messages_delivered(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update messages
  set delivered_at = coalesce(delivered_at, now())
  where id = any (p_ids)
    and room_id = public.my_room_id()
    and sender_id <> auth.uid();
$$;

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
    and room_id = public.my_room_id()
    and sender_id <> auth.uid();
$$;

revoke execute on function public.mark_messages_delivered(uuid[]) from public, anon;
revoke execute on function public.mark_messages_read(uuid[]) from public, anon;
grant execute on function public.mark_messages_delivered(uuid[]) to authenticated;
grant execute on function public.mark_messages_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: one private channel per room, "room:<room id>".
-- ---------------------------------------------------------------------------
drop policy "room members can listen on the room channel" on realtime.messages;
drop policy "room members can send on the room channel" on realtime.messages;

create policy "members can listen on their own room's channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'room:' || (select public.my_room_id())::text
    -- LEGACY COMPAT: the pre-0007 client's single channel named "room".
    or (realtime.topic() = 'room' and (select public.my_room_is_legacy()))
  );

create policy "members can send on their own room's channel"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() = 'room:' || (select public.my_room_id())::text
    -- LEGACY COMPAT: see above.
    or (realtime.topic() = 'room' and (select public.my_room_is_legacy()))
  );

-- ---------------------------------------------------------------------------
-- Storage: each room's files live under "<room id>/...".
-- ---------------------------------------------------------------------------
drop policy "room members can read attachments" on storage.objects;
drop policy "room members can upload attachments" on storage.objects;

create policy "members can read their own room's attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (
      (storage.foldername(name))[1] = (select public.my_room_id())::text
      -- Files from before 0007 sit at the bucket root. They belong to
      -- whichever room's message points at them — and the trigger on
      -- messages guarantees only the legacy room can point at one.
      or (
        position('/' in name) = 0
        and exists (
          select 1 from public.messages m
          where m.attachment_path = storage.objects.name
            and m.room_id = (select public.my_room_id())
        )
      )
    )
  );

create policy "members can upload into their own room's folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      (storage.foldername(name))[1] = (select public.my_room_id())::text
      -- LEGACY COMPAT: the pre-0007 client uploads to the bucket root.
      or (position('/' in name) = 0 and (select public.my_room_is_legacy()))
    )
  );

-- "members can delete their own attachments" (owner = auth.uid()) is left
-- as is: it was already per-person, which is narrower than per-room.

-- ---------------------------------------------------------------------------
-- Grants. rooms is new, so it gets nothing by default (see 0005 for why
-- nothing here is left to Supabase's default privileges).
-- ---------------------------------------------------------------------------
grant select on public.rooms to authenticated;
grant select, insert, update, delete on public.rooms to service_role;
grant delete on public.room_members to service_role;
grant delete on public.access_secrets to service_role;
grant delete on public.messages to service_role;
