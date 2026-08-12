-- ANYA LABS — Phase 4 schema: room for the optional privacy layer
--
-- This migration makes exactly one change: it widens the `messages.content`
-- length limit so encrypted content fits. Everything else about the
-- privacy layer happens entirely client-side (see src/lib/crypto.ts) — the
-- database still just stores whatever string it's given in `content`; it
-- has no idea whether that string is plaintext or ciphertext, which is the
-- whole point.
--
-- Why widen it: AES-GCM ciphertext for a given plaintext is
-- iv (12 bytes) + tag (16 bytes) + plaintext bytes, then base64-encoded
-- (~4/3 the byte length), plus a short "ENCv1:<iv>:<ciphertext>" envelope.
-- The client caps message input at MAX_MESSAGE_LENGTH (see
-- src/utils/constants.ts, currently 2000 characters) — 12000 comfortably
-- covers that even in the worst case of every character being a 4-byte
-- UTF-8 code point.

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (char_length(content) between 1 and 12000);

create or replace function public.edit_message(p_id uuid, p_content text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.messages;
begin
  if p_content is null or char_length(trim(p_content)) = 0 or char_length(p_content) > 12000 then
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
