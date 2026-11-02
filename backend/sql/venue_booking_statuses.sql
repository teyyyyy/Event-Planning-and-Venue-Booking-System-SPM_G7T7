-- Venue booking request statuses: one fixed set, cancellation with the event, and narrower
-- event-change notification recipients.
--
-- Apply AFTER sprint2_registration_notifications.sql, significant_event_changes.sql,
-- venue_holds.sql, coordinator_alternative_venue.sql and venue_unavailability.sql.
-- Transactional and safe to rerun.
--
-- 1. status may only be one of the statuses in backend/venue_constants.py, in that exact case.
--    Nothing is changed if any request has another status; the error lists those request ids.
--    Fix each one (e.g. update public."Venue Booking Requests" set status = 'Rejected'
--    where request_id = <id>;), then rerun. To inspect them:
--      select request_id, event_id, status from public."Venue Booking Requests"
--      where status is null or status not in ('Pending', 'On Hold', 'Approved', 'Expired',
--        'Rejected', 'Alternative Offered', 'Superseded', 'Cancelled');
-- 2. When an event becomes Cancelled, its open venue requests (Pending, On Hold, Approved,
--    Alternative Offered) become Cancelled, which frees the venue. Rejected, Superseded and
--    Expired requests are history and stay as they are. Reopening the event does not reopen
--    them: the coordinator requests a venue again.
-- 3. Staff on a Superseded or Expired request no longer receive the event's change and
--    cancellation notifications; staff on an Alternative Offered request still do.
--
-- Rollback: drop the constraint and the trigger, and restore the earlier recipient rule.
-- Requests already Cancelled stay Cancelled.
--   alter table public."Venue Booking Requests" drop constraint if exists venue_booking_requests_status_check;
--   drop trigger if exists venue_bookings_follow_event_cancellation on public."Event Details";
--   drop function if exists public.cancel_venue_bookings_with_event();
--   create or replace function public.event_notification_staff(target_event bigint) returns text[]
--   language sql stable security definer set search_path = public, pg_temp as $$
--     select coalesce(array_agg(distinct staff_id), '{}') from (
--       select coordinator_id::text as staff_id from public."Event Details" where id = target_event
--       union all
--       select u.id::text from public."Venue Booking Requests" b join public.users u
--         on u.id::text = b.venue_staff_id::text or
--            (b.venue_staff_id is null and lower(trim(u.role)) = 'venue staff')
--         where b.event_id = target_event and lower(trim(b.status)) not in ('cancelled','rejected')
--       union all
--       select u.id::text from public.users u where lower(trim(u.role)) = 'technical support staff'
--         and exists(select 1 from public."Equipment Request" where event_id = target_event and lower(trim(status)) not in ('cancelled','rejected'))
--     ) staff where staff_id is not null;
--   $$;
begin;

do $$
declare
  invalid bigint[];
begin
  select array_agg(request_id order by request_id) into invalid from public."Venue Booking Requests"
  where status is null or status not in ('Pending', 'On Hold', 'Approved', 'Expired',
    'Rejected', 'Alternative Offered', 'Superseded', 'Cancelled');
  if invalid is not null then
    raise exception 'Not applied: unknown status on venue booking requests %. Set each to a valid status, then rerun.', invalid;
  end if;
end $$;

alter table public."Venue Booking Requests" drop constraint if exists venue_booking_requests_status_check;
alter table public."Venue Booking Requests" add constraint venue_booking_requests_status_check
  check (status in ('Pending', 'On Hold', 'Approved', 'Expired',
    'Rejected', 'Alternative Offered', 'Superseded', 'Cancelled'));

create or replace function public.cancel_venue_bookings_with_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if lower(trim(coalesce(new.status, ''))) = 'cancelled'
     and lower(trim(coalesce(old.status, ''))) is distinct from 'cancelled' then
    update public."Venue Booking Requests" set status = 'Cancelled'
    where event_id = new.id
      and lower(trim(coalesce(status, ''))) not in ('cancelled', 'rejected', 'superseded', 'expired');
  end if;
  return new;
end $$;
revoke all on function public.cancel_venue_bookings_with_event() from public, anon, authenticated;
-- Triggers on the same event fire in name order, so sprint2_event_notifications runs first and
-- still notifies the venue staff on the requests this trigger then cancels.
drop trigger if exists venue_bookings_follow_event_cancellation on public."Event Details";
create trigger venue_bookings_follow_event_cancellation after update of status on public."Event Details"
for each row execute function public.cancel_venue_bookings_with_event();

create or replace function public.event_notification_staff(target_event bigint) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct staff_id), '{}') from (
    select coordinator_id::text as staff_id from public."Event Details" where id = target_event
    union all
    select u.id::text from public."Venue Booking Requests" b join public.users u
      on u.id::text = b.venue_staff_id::text or
         (b.venue_staff_id is null and lower(trim(u.role)) = 'venue staff')
      where b.event_id = target_event
        and lower(trim(b.status)) not in ('cancelled','rejected','superseded','expired')
    union all
    select u.id::text from public.users u where lower(trim(u.role)) = 'technical support staff'
      and exists(select 1 from public."Equipment Request" where event_id = target_event and lower(trim(status)) not in ('cancelled','rejected'))
  ) staff where staff_id is not null;
$$;
revoke all on function public.event_notification_staff(bigint) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
