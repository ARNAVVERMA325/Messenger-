-- The live project, after 0007: everything that existed is still there,
-- attached to one legacy room, and the pre-0007 client still works.
\set ON_ERROR_STOP on

create schema if not exists u;
grant usage on schema u to authenticated;
create or replace function u.ok(cond boolean, what text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok   %', what;
end $$;
grant execute on function u.ok(boolean, text) to authenticated;

-- Data carried across.
select u.ok((select count(*) from public.rooms where is_legacy) = 1, 'exactly one legacy room was created');
select u.ok((select handle from public.rooms where is_legacy) = 'anya-labs', 'the legacy room has the default handle');
select u.ok((select encryption_salt from public.rooms where is_legacy) is null,
            'the legacy room keeps the deployment-wide salt, so existing encrypted messages stay readable');

select u.ok((select count(*) from public.room_members
             where room_id = (select id from public.rooms where is_legacy)) = 2,
            'both existing members moved into the legacy room');
select u.ok((select count(*) from public.messages) = 3, 'no message was lost');
select u.ok((select count(*) from public.messages
             where room_id = (select id from public.rooms where is_legacy)) = 3,
            'every existing message belongs to the legacy room');
select u.ok((select count(*) from public.access_secrets
             where room_id = (select id from public.rooms where is_legacy) and hash_version = 1) = 2,
            'both existing code hashes carried over as v1 (still valid, upgraded on next login)');
select u.ok(
  (select secret_hash from public.access_secrets where role = 'A')
    = encode(hmac('bluetshirt', 'test-pepper', 'sha256'), 'hex'),
  'the existing hash itself is untouched — the current code keeps working');
select u.ok(
  (select attachment_path from public.messages where id = '11111111-0000-0000-0000-000000000003') = 'legacy-photo-uuid',
  'the existing photo message still points at its file');

-- The pre-0007 client, as the legacy member A.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', false);

select u.ok((select count(*) from public.messages) = 3, 'the legacy member still reads their whole history');
select u.ok((select count(*) from storage.objects where name = 'legacy-photo-uuid') = 1,
            'the legacy member can still read their pre-0007 photo');

-- Old client: sends without room_id, on the channel named "room",
-- uploading to the bucket root.
insert into public.messages (sender_id, sender_role, content)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'A', 'still works');
select u.ok((select count(*) from public.messages where content = 'still works') = 1,
            'the pre-0007 client can still send a message');

select set_config('realtime.topic', 'room', false);
insert into realtime.messages (topic, payload) values ('room', '{"event":"typing"}');
select u.ok((select count(*) from realtime.messages) > 0,
            'the pre-0007 client can still use its "room" channel (legacy compat)');

insert into storage.objects (bucket_id, name) values ('attachments', 'old-client-root-upload');
insert into public.messages (sender_id, sender_role, content, attachment_path, attachment_kind)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'A', '', 'old-client-root-upload', 'image');
select u.ok(true, 'the pre-0007 client can still send a photo (root-level upload, legacy compat)');

-- The live bug the harness found: no caption + encryption off.
select u.ok((select count(*) from public.messages where attachment_path = 'old-client-root-upload' and content = '') = 1,
            'a caption-less photo with encryption off is now accepted');

reset role;

-- Plain text still can't be empty.
do $$ begin
  insert into public.messages (sender_id, sender_role, content, room_id)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'A', '', (select id from public.rooms where is_legacy));
  raise exception 'FAIL: an empty text-only message was accepted';
exception when check_violation then
  raise notice 'ok   an empty text-only message is still rejected';
end $$;

drop schema u cascade;
