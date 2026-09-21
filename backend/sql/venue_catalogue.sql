-- Stories 16.1 / 16.2. Run in the Supabase SQL editor. Safe to re-run.
-- Reuses existing venue_id, name, location, capacity, facilities, accessible,
-- and layouts columns used by venue requests. Does not create another table.
begin;
alter table public."Venues"
  add column if not exists operating_hours jsonb,
  add column if not exists accessibility_details text not null default '';
-- NULL operating_hours means not yet specified, not that the venue is closed.
commit;
