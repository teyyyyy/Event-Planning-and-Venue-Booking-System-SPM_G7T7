-- Drops the unused "Venues".status column. Whether a venue can be requested, held or approved is
-- decided only by is_available + unavailability_reason (venue_unavailability.sql, stories 25.1–25.3).
-- Nothing in the app or in a database function reads or writes status, so a venue marked
-- 'Unavailable' there is still bookable; keeping the column only invites that mismatch.
-- Its check constraint chk_status_availability ('Available' / 'Unavailable') goes with it.
--
-- Apply AFTER venue_unavailability.sql. No application change has to be deployed first. Safe to rerun.
--
-- Nothing is dropped if any venue's status disagrees with is_available, since dropping would lose
-- a decision someone may have meant to make; the error lists those venue ids. For each one, either
-- close it properly (this notifies anyone affected and flags its open requests for replacement):
--   update public."Venues" set is_available = false, unavailability_reason = '<reason>' where venue_id = <id>;
-- or, if it is in fact open, record that:
--   update public."Venues" set status = 'Available' where venue_id = <id>;
-- then rerun. To inspect them:
--   select venue_id, name, status, is_available, unavailability_reason from public."Venues"
--   where (status = 'Unavailable') is distinct from (not is_available);
--
-- A view or other object that depends on the column makes the drop fail, changing nothing.
--
-- Rollback: re-add the column and its constraint, filled from is_available. The guard above means
-- no information is lost.
--   alter table public."Venues" add column if not exists status text;
--   update public."Venues" set status = case when is_available then 'Available' else 'Unavailable' end;
--   alter table public."Venues" alter column status set not null;
--   alter table public."Venues" drop constraint if exists chk_status_availability;
--   alter table public."Venues" add constraint chk_status_availability check (status in ('Available', 'Unavailable'));
--   notify pgrst, 'reload schema';
begin;

do $$
declare
  mismatched bigint[];
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Venues' and column_name = 'status') then
    execute $q$select array_agg(venue_id order by venue_id) from public."Venues"
      where (status = 'Unavailable') is distinct from (not is_available)$q$ into mismatched;
    if mismatched is not null then
      raise exception 'Not dropped: status disagrees with is_available on venues %. Mark them unavailable with a reason or set status to Available, then rerun.', mismatched;
    end if;
  end if;

  alter table public."Venues" drop column if exists status;
end $$;

-- The Data API stops offering the column straight away.
notify pgrst, 'reload schema';

commit;
