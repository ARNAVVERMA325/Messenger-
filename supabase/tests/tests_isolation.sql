-- Tenant isolation: two rooms, X and Y, two people each. Every assertion
-- is phrased from X's side ("can X reach anything of Y's?"), then a few
-- are repeated for anonymous callers. Runs after both the upgrade and the
-- fresh install, so on the upgrade pass the legacy room is a third tenant
-- in the building and gets checked too.
\set ON_ERROR_STOP on

-- Assertion helpers live in their own schema so they vanish with the test DB.
create schema if not exists t;
grant usage on schema t to authenticated, anon;

create or replace function t.ok(cond boolean, what text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', what;
  end if;
  raise notice 'ok   %', what;
end $$;

-- Runs a statement that must fail, and passes only if it does.
create or replace function t.denied(stmt text, what text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok   % (%)', what, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been refused', what;
end $$;

grant execute on all functions in schema t to authenticated, anon;

create or replace function t.as_user(uid uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', uid::text, false) $$;
grant execute on function t.as_user(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as the superuser, i.e. what create-room would do with the
-- service role).
-- ---------------------------------------------------------------------------
insert into public.rooms (id, handle, encryption_salt) values
  ('0000000a-0000-0000-0000-000000000000', 'room-x', 'salt-x'),
  ('0000000b-0000-0000-0000-000000000000', 'room-y', 'salt-y');

insert into auth.users (id, email) values
  ('0000000a-0000-0000-0000-0000000000a1', 'x1@anya-labs.invalid'),
  ('0000000a-0000-0000-0000-0000000000a2', 'x2@anya-labs.invalid'),
  ('0000000b-0000-0000-0000-0000000000b1', 'y1@anya-labs.invalid'),
  ('0000000b-0000-0000-0000-0000000000b2', 'y2@anya-labs.invalid');

insert into public.room_members (id, room_id, role, display_name) values
  ('0000000a-0000-0000-0000-0000000000a1', '0000000a-0000-0000-0000-000000000000', 'A', 'x-one'),
  ('0000000a-0000-0000-0000-0000000000a2', '0000000a-0000-0000-0000-000000000000', 'B', 'x-two'),
  ('0000000b-0000-0000-0000-0000000000b1', '0000000b-0000-0000-0000-000000000000', 'A', 'y-one'),
  ('0000000b-0000-0000-0000-0000000000b2', '0000000b-0000-0000-0000-000000000000', 'B', 'y-two');

insert into public.messages (id, room_id, sender_id, sender_role, content) values
  ('0000000b-1111-0000-0000-000000000001', '0000000b-0000-0000-0000-000000000000',
   '0000000b-0000-0000-0000-0000000000b1', 'A', 'y secret');

insert into storage.objects (bucket_id, name, owner) values
  ('attachments', '0000000a-0000-0000-0000-000000000000/x-file', '0000000a-0000-0000-0000-0000000000a1'),
  ('attachments', '0000000b-0000-0000-0000-000000000000/y-file', '0000000b-0000-0000-0000-0000000000b1');

insert into public.messages (id, room_id, sender_id, sender_role, content, attachment_path, attachment_kind) values
  ('0000000b-1111-0000-0000-000000000002', '0000000b-0000-0000-0000-000000000000',
   '0000000b-0000-0000-0000-0000000000b1', 'A', '',
   '0000000b-0000-0000-0000-000000000000/y-file', 'image');

-- A channel message on Y's topic, so "can X see it" has something to see.
insert into realtime.messages (topic, payload) values ('room:0000000b-0000-0000-0000-000000000000', '{}');

-- ---------------------------------------------------------------------------
-- As x1
-- ---------------------------------------------------------------------------
set role authenticated;
select t.as_user('0000000a-0000-0000-0000-0000000000a1');

select t.ok((select count(*) from public.rooms) = 1, 'x1 sees exactly one room');
select t.ok((select handle from public.rooms) = 'room-x', 'the room x1 sees is room-x');
select t.ok((select count(*) from public.room_members) = 2, 'x1 sees only room-x''s two members');
select t.ok(not exists (select 1 from public.room_members where room_id <> '0000000a-0000-0000-0000-000000000000'),
            'x1 sees no member of any other room');
select t.ok(not exists (select 1 from public.messages where room_id <> '0000000a-0000-0000-0000-000000000000'),
            'x1 sees no message from any other room');

-- Writing into another room, directly or by forging room_id.
select t.denied(
  $$insert into public.messages (room_id, sender_id, sender_role, content)
    values ('0000000b-0000-0000-0000-000000000000', '0000000a-0000-0000-0000-0000000000a1', 'A', 'forged')$$,
  'x1 cannot insert a message into room-y by naming it');

select t.denied(
  $$insert into public.messages (sender_id, sender_role, content)
    values ('0000000b-0000-0000-0000-0000000000b1', 'A', 'impersonating y1')$$,
  'x1 cannot send as someone else');

select t.denied(
  $$insert into public.messages (sender_id, sender_role, content)
    values ('0000000a-0000-0000-0000-0000000000a1', 'B', 'wrong seat')$$,
  'x1 cannot send under the other seat''s role');

-- The default room_id lands a plain insert in x1's own room.
insert into public.messages (sender_id, sender_role, content)
values ('0000000a-0000-0000-0000-0000000000a1', 'A', 'hello x');
select t.ok(
  (select room_id from public.messages where content = 'hello x') = '0000000a-0000-0000-0000-000000000000',
  'an insert without room_id lands in the sender''s own room');

-- Cross-room references.
select t.denied(
  $$insert into public.messages (sender_id, sender_role, content, reply_to_id)
    values ('0000000a-0000-0000-0000-0000000000a1', 'A', 'quote', '0000000b-1111-0000-0000-000000000001')$$,
  'x1 cannot reply to (and so quote) a room-y message');

select t.denied(
  $$insert into public.messages (sender_id, sender_role, content, attachment_path, attachment_kind)
    values ('0000000a-0000-0000-0000-0000000000a1', 'A', '', '0000000b-0000-0000-0000-000000000000/y-file', 'image')$$,
  'x1 cannot attach a file from room-y''s folder');

select t.denied(
  $$insert into public.messages (sender_id, sender_role, content, attachment_path, attachment_kind)
    values ('0000000a-0000-0000-0000-0000000000a1', 'A', '', 'legacy-photo-uuid', 'image')$$,
  'x1 cannot point a message at a root-level (legacy) file');

-- Receipts and edits on someone else's messages.
select public.mark_messages_read(array['0000000b-1111-0000-0000-000000000001'::uuid]);
select public.mark_messages_delivered(array['0000000b-1111-0000-0000-000000000001'::uuid]);

select t.denied(
  $$select public.edit_message('0000000b-1111-0000-0000-000000000001', 'defaced')$$,
  'x1 cannot edit a room-y message');
select t.denied(
  $$select public.delete_message('0000000b-1111-0000-0000-000000000001')$$,
  'x1 cannot delete a room-y message');

-- Storage.
select t.ok((select count(*) from storage.objects where bucket_id = 'attachments'
             and name like '0000000b-%') = 0, 'x1 cannot see room-y''s files');
select t.ok((select count(*) from storage.objects where name = '0000000a-0000-0000-0000-000000000000/x-file') = 1,
            'x1 can see room-x''s own file');
select t.ok((select count(*) from storage.objects where name = 'legacy-photo-uuid') = 0,
            'x1 cannot see the legacy room''s root-level file');

select t.denied(
  $$insert into storage.objects (bucket_id, name) values ('attachments', '0000000b-0000-0000-0000-000000000000/planted')$$,
  'x1 cannot upload into room-y''s folder');
select t.denied(
  $$insert into storage.objects (bucket_id, name) values ('attachments', 'root-level-planted')$$,
  'x1 cannot upload to the bucket root');

insert into storage.objects (bucket_id, name) values ('attachments', '0000000a-0000-0000-0000-000000000000/mine');
select t.ok(true, 'x1 can upload into room-x''s own folder');

-- Realtime.
select set_config('realtime.topic', 'room:0000000b-0000-0000-0000-000000000000', false);
select t.ok((select count(*) from realtime.messages) = 0, 'x1 cannot listen on room-y''s channel');
select t.denied(
  $$insert into realtime.messages (topic, payload) values ('room:0000000b-0000-0000-0000-000000000000', '{}')$$,
  'x1 cannot broadcast on room-y''s channel');

select set_config('realtime.topic', 'room', false);
select t.ok((select count(*) from realtime.messages) = 0, 'x1 cannot use the legacy "room" channel');

select set_config('realtime.topic', 'room:0000000a-0000-0000-0000-000000000000', false);
insert into realtime.messages (topic, payload) values ('room:0000000a-0000-0000-0000-000000000000', '{}');
select t.ok((select count(*) from realtime.messages) > 0, 'x1 can use room-x''s own channel');

-- Secrets are never readable by a signed-in person, own room or not.
select t.denied($$select * from public.access_secrets$$, 'x1 cannot read any code hashes');
select t.denied($$select * from public.login_rate_limits$$, 'x1 cannot read rate-limit state');

reset role;

-- The receipts x1 tried to forge must not have landed.
select t.ok(
  (select read_at is null and delivered_at is null from public.messages
   where id = '0000000b-1111-0000-0000-000000000001'),
  'x1''s receipt calls did not touch room-y''s message');
select t.ok(
  (select content from public.messages where id = '0000000b-1111-0000-0000-000000000001') = 'y secret',
  'room-y''s message is unchanged');

-- ---------------------------------------------------------------------------
-- As y1, the mirror image — a policy that only works in one direction
-- would pass the block above and fail here.
-- ---------------------------------------------------------------------------
set role authenticated;
select t.as_user('0000000b-0000-0000-0000-0000000000b1');
select t.ok((select count(*) from public.messages where content = 'hello x') = 0, 'y1 cannot see room-x''s messages');
select t.ok((select count(*) from public.messages where room_id = '0000000b-0000-0000-0000-000000000000') = 2,
            'y1 sees both of room-y''s own messages');
select t.ok((select count(*) from storage.objects where name like '0000000a-%') = 0, 'y1 cannot see room-x''s files');
reset role;

-- ---------------------------------------------------------------------------
-- A signed-in user with no seat anywhere, and an anonymous caller.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('0000000c-0000-0000-0000-0000000000c1', 'nobody@anya-labs.invalid');
set role authenticated;
select t.as_user('0000000c-0000-0000-0000-0000000000c1');
select t.ok((select count(*) from public.rooms) = 0, 'a seatless account sees no rooms');
select t.ok((select count(*) from public.messages) = 0, 'a seatless account sees no messages');
select t.ok((select count(*) from storage.objects) = 0, 'a seatless account sees no files');
select t.denied(
  $$insert into public.messages (sender_id, sender_role, content)
    values ('0000000c-0000-0000-0000-0000000000c1', 'A', 'hi')$$,
  'a seatless account cannot send anything');
reset role;

set role anon;
select t.as_user('00000000-0000-0000-0000-000000000000');
select t.denied($$select * from public.messages$$, 'anon cannot read messages');
select t.denied($$select * from public.rooms$$, 'anon cannot read rooms');
select t.denied($$select * from public.room_members$$, 'anon cannot read members');
reset role;

drop schema t cascade;
