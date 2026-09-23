-- Recreates the shape of the live, pre-multi-tenant database: the two fixed
-- seat accounts, v1 code hashes, a short conversation, and a photo stored at
-- the bucket root (the pre-0007 path layout). Migration 0007 has to carry
-- every one of these across without loss, and the tests check that it does.

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'role-a@anya-labs.invalid'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'role-b@anya-labs.invalid');

insert into public.room_members (id, role, display_name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'A', 'Arnav'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'B', 'Anya');

-- v1 hashes are HMAC-SHA256(pepper, normalized_code) with no room binding.
-- 'test-pepper' / 'bluetshirt' / 'greenone' are fixtures, not real values.
insert into public.access_secrets (role, secret_hash) values
  ('A', encode(hmac('bluetshirt', 'test-pepper', 'sha256'), 'hex')),
  ('B', encode(hmac('greenone', 'test-pepper', 'sha256'), 'hex'));

insert into public.messages (id, sender_id, sender_role, content, created_at) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A', 'hi', now() - interval '2 days'),
  ('11111111-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'B', 'hello', now() - interval '1 day');

insert into public.messages
  (id, sender_id, sender_role, content, attachment_path, attachment_kind, attachment_mime, attachment_size)
values
  -- A caption-less photo sent with encryption on: the empty caption was
  -- encrypted into a non-empty envelope, which is the only reason it passed
  -- the pre-0007 "content must be non-empty" check.
  ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A', 'ENCv1:aXY=:Y3Q=',
   'legacy-photo-uuid', 'image', 'image/jpeg', 12345);

insert into storage.objects (bucket_id, name, owner) values
  ('attachments', 'legacy-photo-uuid', 'aaaaaaaa-0000-0000-0000-00000000000a');
