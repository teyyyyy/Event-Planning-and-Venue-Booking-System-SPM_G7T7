-- Stories 25.1–25.3. Apply AFTER significant_event_changes.sql and the
-- notification / venue approval migrations, before deploying the application.
begin;
alter table public."Venues"
  add column if not exists is_available boolean not null default true,
  add column if not exists unavailability_reason text not null default '';
alter table public."Venues" drop constraint if exists venue_unavailability_reason;
alter table public."Venues" add constraint venue_unavailability_reason
  check (length(unavailability_reason) <= 1000 and (is_available or length(trim(unavailability_reason)) > 0));
alter table public."Venue Booking Requests"
  add column if not exists replacement_required boolean not null default false;

-- Disrupted requests stay Pending as history; they must not prevent a new
-- request for the same event. Preserve the existing one-live-request policy
-- (expired venue holds from venue_holds.sql are history too).
drop index if exists public."Venue Booking Requests_live_event_id_key";
do $$ begin
  if not exists (select 1 from public."Venue Booking Requests"
    where status is distinct from 'Superseded' and status is distinct from 'Expired' and not replacement_required
    group by event_id having count(*) > 1) then
    create unique index "Venue Booking Requests_live_event_id_key"
      on public."Venue Booking Requests"(event_id)
      where status is distinct from 'Superseded' and status is distinct from 'Expired' and not replacement_required;
  end if;
end $$;

create or replace function public.guard_venue_availability() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare available boolean;
begin
  -- A row lock serializes inserts/approvals with venue blocking. Checking in
  -- Python alone would leave a race between reading and inserting a booking.
  if TG_OP = 'INSERT' or new.venue_id is distinct from old.venue_id
     or (new.status = 'Approved' and old.status is distinct from 'Approved') then
    select is_available into available from public."Venues" where venue_id = new.venue_id for update;
    if available is distinct from true or new.replacement_required then
      raise exception 'Venue is unavailable or this request needs a replacement.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_venue_availability on public."Venue Booking Requests";
create trigger guard_venue_availability before insert or update on public."Venue Booking Requests"
for each row execute function public.guard_venue_availability();

create or replace function public.venue_unavailability_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare affected record;
begin
  if new.is_available or not old.is_available then return new; end if;
  for affected in
    update public."Venue Booking Requests" b
      set status = 'Pending', replacement_required = true, decided_at = null
      from public."Event Details" e
      where b.venue_id = new.venue_id and b.event_id = e.id
        and b.status in ('Pending', 'Approved', 'On Hold') and not b.replacement_required
        and lower(coalesce(e.status, '')) not in ('cancelled', 'completed')
        -- Bookings have no times of their own; an event without an end time counts as upcoming.
        and coalesce(
          (coalesce(e.event_end_date, e.event_date)::date + e.end_time::time) at time zone 'Asia/Singapore',
          'infinity'::timestamptz) > now()
      returning b.request_id, b.coordinator_id, e.coordinator_id as event_coordinator_id, e.event_name
  loop
    perform public.emit_notifications(
      array[coalesce(affected.event_coordinator_id, affected.coordinator_id)::text],
      coalesce(affected.event_name, 'Event') || ': ' || new.name || ' is unavailable (' ||
        new.unavailability_reason || '). Your venue request is Pending. Please request a replacement venue.',
      'venue_booking', affected.request_id::text);
  end loop;
  return new;
end $$;
drop trigger if exists venue_unavailability_changes on public."Venues";
create trigger venue_unavailability_changes after update of is_available on public."Venues"
for each row execute function public.venue_unavailability_changes();
revoke all on function public.guard_venue_availability(), public.venue_unavailability_changes() from public, anon, authenticated;
commit;
