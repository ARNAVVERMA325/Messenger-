-- ANYA LABS — Phase 5 schema: nicknames + reply-to-message
--
-- Small, deliberately restrained additions — see the Phase 5 section of the
-- README for why these two and not the rest of the "possible features"
-- list from the product spec.

-- ---------------------------------------------------------------------------
-- Nicknames: room_members.display_name already existed (unused since
-- Phase 2) as the intended home for this. Self-service only — a person can
-- set their own name, never the other seat's.
-- ---------------------------------------------------------------------------
create or replace function public.set_display_name(p_name text)
returns public.room_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.room_members;
  v_clean text;
begin
  v_clean := trim(p_name);
  if char_length(v_clean) > 40 then
    raise exception 'name too long';
  end if;

  update room_members
  set display_name = v_clean
  where id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'no seat for this session';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- So a nickname change shows up for the other person live, not just next
-- time they reload — gated the same way messages already are: the client
-- only receives changefeed rows its own SELECT RLS policy would allow it
-- to read, which for room_members is already "any authenticated member".
alter publication supabase_realtime add table public.room_members;

-- ---------------------------------------------------------------------------
-- Reply-to-message: a message may optionally point at the one it's
-- replying to. Nullable, and cleared (not cascaded) if that message is
-- later deleted — the reply itself should survive, just losing its quote.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column reply_to_id uuid references public.messages (id) on delete set null;

create index messages_reply_to_id_idx on public.messages (reply_to_id) where reply_to_id is not null;

-- No RLS change needed: Phase 2/3's insert policy already governs the row
-- as a whole (sender_id/sender_role), and doesn't restrict individual
-- columns, so it already permits setting reply_to_id on insert.
