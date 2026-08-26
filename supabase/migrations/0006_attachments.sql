-- ANYA LABS — Phase 8: photo and voice-note attachments
--
-- Files live in a PRIVATE Storage bucket, never a public one: the anon key
-- is in the frontend bundle, so a public bucket would make every attachment
-- readable by anyone who found a URL. Access is gated the same way messages
-- are — you must hold one of the two seats in room_members.
--
-- What lands in the bucket is ciphertext. Attachments are encrypted in the
-- browser (AES-GCM, the same key derived from the shared passphrase — see
-- src/lib/crypto.ts) before upload, so the bytes at rest are unreadable
-- without that passphrase, and the decrypted photo or audio only ever
-- exists in memory on the viewing device. Nothing is written to the phone's
-- gallery or downloads.
--
-- Note the deliberate asymmetry with messages.content: text is encrypted
-- *optionally* (the privacy layer can be off), but the columns below only
-- ever describe the envelope — path, type, size, dimensions, duration —
-- never the content itself. That metadata is intentionally readable so the
-- UI can reserve layout space and show a duration without downloading and
-- decrypting the file first, which matters on a slow connection.

-- ---------------------------------------------------------------------------
-- Attachment metadata on messages. All nullable: a message is either plain
-- text, or text plus one attachment.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column attachment_path text,
  add column attachment_kind text check (attachment_kind in ('image', 'audio')),
  add column attachment_mime text,
  add column attachment_size int,
  -- Images: intrinsic pixel size, so a placeholder can occupy the right
  -- shape before the file is fetched. Audio: duration in ms, so the player
  -- can render its length without loading the audio.
  add column attachment_width int,
  add column attachment_height int,
  add column attachment_duration_ms int;

-- Either both path and kind are set, or neither is.
alter table public.messages
  add constraint messages_attachment_complete
  check (
    (attachment_path is null and attachment_kind is null)
    or (attachment_path is not null and attachment_kind is not null)
  );

-- A hard ceiling enforced by the database, not just the client. Generous
-- enough for a compressed photo or a few minutes of Opus audio, small
-- enough that a runaway upload can't quietly consume the project's storage
-- quota. The client also limits this (see src/lib/attachments.ts) — this is
-- the copy that can't be bypassed by a modified frontend.
alter table public.messages
  add constraint messages_attachment_size_check
  check (attachment_size is null or attachment_size between 1 and 26214400); -- 25 MB

-- ---------------------------------------------------------------------------
-- The bucket itself.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- RLS on storage.objects is already enabled by Supabase; only policies are
-- needed. Same gate as the messages table: hold a seat, or see nothing.
create policy "room members can read attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and exists (select 1 from public.room_members where id = (select auth.uid()))
  );

create policy "room members can upload attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (select 1 from public.room_members where id = (select auth.uid()))
  );

-- Deleting is restricted to whoever uploaded the file (storage.objects.owner
-- is set automatically on insert), so removing your own message can clean up
-- its file without giving either side the ability to wipe the other's.
create policy "members can delete their own attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and owner = (select auth.uid())
  );
