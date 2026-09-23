-- A brand-new self-hosted deployment: every migration on an empty
-- database. There's nothing to preserve, so there must be no legacy room
-- squatting a handle or holding the compat paths open.
\set ON_ERROR_STOP on

do $$ begin
  if (select count(*) from public.rooms) <> 0 then
    raise exception 'FAIL: a fresh install created a room';
  end if;
  raise notice 'ok   a fresh install starts with no rooms';

  if exists (select 1 from storage.buckets where id = 'attachments' and not public) then
    raise notice 'ok   the attachments bucket exists and is private';
  else
    raise exception 'FAIL: the attachments bucket is missing or public';
  end if;
end $$;
