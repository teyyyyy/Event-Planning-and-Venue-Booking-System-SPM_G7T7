-- Drops the unused start_datetime / end_datetime columns from "Event Details". An event's timing
-- is stored only as event_date + start_time and event_end_date + end_time (SGT wall-clock values).
-- Nothing in the app writes these two columns, and the venue screens and API no longer read them.
-- "Equipment Reservation Item" keeps its own start_datetime / end_datetime: those are each
-- reservation's booked period and are unaffected.
--
-- Run in the Supabase SQL Editor only AFTER the backend and frontend that stopped reading these
-- columns are deployed: the previous GET /api/venue-booking-requests/coordinators/{id} selects
-- them by name and fails once they are gone. Safe to rerun.
--
-- Nothing is dropped if any event has a start_datetime / end_datetime value that its split
-- columns do not reproduce, since dropping would lose it; the error lists those event ids.
-- Correct the split columns or clear the stray value, then rerun. To inspect them:
--   select id, event_date, start_time, start_datetime, event_end_date, end_time, end_datetime
--   from public."Event Details"
--   where (start_datetime is not null and start_datetime is distinct from
--           (event_date + start_time) at time zone 'Asia/Singapore')
--      or (end_datetime is not null and end_datetime is distinct from
--           (coalesce(event_end_date, event_date) + end_time) at time zone 'Asia/Singapore');
--
-- A view or other object that depends on either column makes the drop fail, changing nothing.
--
-- Rollback: redeploy the previous application version if needed, then re-add the columns filled
-- from the split columns. Values that existed only in the dropped columns cannot be recovered,
-- which is why the drop refuses to lose any.
--   alter table public."Event Details"
--     add column if not exists start_datetime timestamptz,
--     add column if not exists end_datetime timestamptz;
--   update public."Event Details" set
--     start_datetime = (event_date + start_time) at time zone 'Asia/Singapore',
--     end_datetime = (coalesce(event_end_date, event_date) + end_time) at time zone 'Asia/Singapore';
--   notify pgrst, 'reload schema';
begin;

do $$
declare
  col text;
  derived text;
  lost bigint[];
begin
  -- Check every column that still exists before dropping either, so a failure changes nothing.
  foreach col in array array['start_datetime', 'end_datetime'] loop
    continue when not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'Event Details' and column_name = col);
    derived := case col
      when 'start_datetime' then $d$(event_date + start_time) at time zone 'Asia/Singapore'$d$
      else $d$(coalesce(event_end_date, event_date) + end_time) at time zone 'Asia/Singapore'$d$
    end;
    execute format(
      'select array_agg(id order by id) from public."Event Details" where %1$I is not null and %1$I is distinct from %2$s',
      col, derived) into lost;
    if lost is not null then
      raise exception 'Not dropped: % on events % differs from their split dates and times. Correct those events, then rerun.', col, lost;
    end if;
  end loop;

  alter table public."Event Details"
    drop column if exists start_datetime,
    drop column if exists end_datetime;
end $$;

-- The Data API stops offering the columns straight away.
notify pgrst, 'reload schema';

commit;
