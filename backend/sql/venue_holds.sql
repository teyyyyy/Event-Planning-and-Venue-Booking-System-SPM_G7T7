-- Stories 22.1 and 22.2: tentative venue holds and hold-expiry notifications.
-- Run in the Supabase SQL Editor AFTER sprint2_registration_notifications.sql and
-- significant_event_changes.sql. Safe to rerun.
-- Enable the pg_cron extension first (Dashboard > Integrations > Cron, or Database > Extensions)
-- so reminders and expiries run every minute; without it the app still treats holds past their
-- expiry as Expired, but no reminder or expiry notifications are sent.
--
-- Rollback: select cron.unschedule('venue-hold-expiry'); set any 'On Hold' or 'Expired' booking
-- back to 'Pending'; drop the functions created below; drop the hold_* columns; drop the index
-- "Venue Booking Requests_live_event_id_key"; then rerun significant_event_changes.sql to recreate
-- it without the Expired exclusion (that file only creates the index when it is missing).
begin;

-- A hold lives on the booking request it reserves the venue for. Status 'On Hold' marks an active
-- hold; 'Expired' marks one whose expiry passed before it was approved, rejected or removed.
alter table public."Venue Booking Requests"
  add column if not exists hold_expires_at timestamptz,
  add column if not exists hold_placed_by uuid references public.users(id),
  add column if not exists hold_placed_at timestamptz,
  add column if not exists hold_reminder_sent_at timestamptz;
create index if not exists venue_booking_active_holds
  on public."Venue Booking Requests"(hold_expires_at) where status = 'On Hold';

-- An expired hold is history: the coordinator must be able to submit a new request for the event,
-- so the one-live-booking-per-event index ignores Expired rows as well as Superseded ones.
do $$
declare
  live text := 'status is distinct from ''Superseded'' and status is distinct from ''Expired''';
  duplicates boolean;
begin
  -- venue_unavailability.sql also leaves out requests that need a replacement venue.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Venue Booking Requests' and column_name = 'replacement_required'
  ) then
    live := live || ' and not replacement_required';
  end if;
  drop index if exists public."Venue Booking Requests_live_event_id_key";
  execute format(
    'select exists (select 1 from public."Venue Booking Requests" where %s group by event_id having count(*) > 1)', live
  ) into duplicates;
  if duplicates then
    raise notice 'Some events already have several live venue bookings; one-live-booking index not created.';
  else
    execute format(
      'create unique index "Venue Booking Requests_live_event_id_key" on public."Venue Booking Requests"(event_id) where %s', live
    );
  end if;
end $$;

-- The time an event occupies a venue, widened by the venue's setup and teardown minutes.
-- Event dates and times are Singapore wall-clock values; a blank end date means a single-day event.
create or replace function public.venue_booking_period(p_event_id bigint, p_venue_id bigint) returns tstzrange
language sql stable security definer set search_path = public, pg_temp as $$
  with bounds as (
    select
      (e.event_date::date + e.start_time::time) at time zone 'Asia/Singapore'
        - make_interval(mins => coalesce((to_jsonb(v)->>'setup_time')::int, 0)) as starts_at,
      (coalesce(e.event_end_date, e.event_date)::date + e.end_time::time) at time zone 'Asia/Singapore'
        + make_interval(mins => coalesce((to_jsonb(v)->>'teardown_time')::int, 0)) as ends_at
    from public."Event Details" e, public."Venues" v
    where e.id = p_event_id and v.venue_id = p_venue_id
      and e.event_date is not null and e.start_time is not null and e.end_time is not null
  )
  select tstzrange(starts_at, ends_at) from bounds where ends_at > starts_at;
$$;

-- Another request that makes the venue unavailable for p_period: a confirmed (Approved) booking or
-- an unexpired hold. Expired holds and pending or closed requests never block a venue.
create or replace function public.venue_hold_conflict(p_request_id bigint, p_venue_id bigint, p_period tstzrange)
returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select b.request_id from public."Venue Booking Requests" b
  where b.venue_id = p_venue_id and b.request_id <> p_request_id
    and (b.status = 'Approved' or (b.status = 'On Hold' and b.hold_expires_at > now()))
    and public.venue_booking_period(b.event_id, b.venue_id) && p_period
  order by b.request_id
  limit 1;
$$;

-- How long before expiry the coordinator is reminded (agreed by the team for story 22.2).
create or replace function public.venue_hold_reminder_lead() returns interval
language sql immutable as $$ select interval '24 hours' $$;

-- Tell the event's current coordinator about a hold. Every notice names the event, the venue and
-- the expiry time, and links to the booking request.
create or replace function public.venue_hold_notice(p_request_id bigint, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hold record;
  expiry text;
  message text;
begin
  select b.request_id, b.hold_expires_at, coalesce(e.coordinator_id, b.coordinator_id)::text as recipient,
         coalesce(e.event_name, 'Event') as event_name, coalesce(v.name, 'The venue') as venue_name
  into hold
  from public."Venue Booking Requests" b
  left join public."Event Details" e on e.id = b.event_id
  left join public."Venues" v on v.venue_id = b.venue_id
  where b.request_id = p_request_id;
  expiry := to_char(hold.hold_expires_at at time zone 'Asia/Singapore', 'DD Mon YYYY, HH24:MI') || ' SGT';
  message := case p_kind
    when 'placed' then format('%s: %s is on hold for your event until %s.', hold.event_name, hold.venue_name, expiry)
    when 'reminder' then format('%s: your hold on %s expires on %s. Finish your arrangements before then.',
      hold.event_name, hold.venue_name, expiry)
    when 'expired' then format('%s: your hold on %s expired on %s. Submit a new venue request to continue.',
      hold.event_name, hold.venue_name, expiry)
    when 'removed' then format('%s: the hold on %s (until %s) was removed. Your venue request is pending again.',
      hold.event_name, hold.venue_name, expiry)
  end;
  perform public.emit_notifications(array[hold.recipient], message, 'venue_booking', hold.request_id::text);
end $$;

create or replace function public.place_venue_hold(p_request_id bigint, p_staff_id uuid, p_expires_at timestamptz)
returns public."Venue Booking Requests"
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  booking public."Venue Booking Requests"%rowtype;
  venue public."Venues"%rowtype;
  event_row public."Event Details"%rowtype;
  period tstzrange;
begin
  select * into booking from public."Venue Booking Requests" where request_id = p_request_id for update;
  if not found then
    raise exception 'Venue booking request not found.' using errcode = 'P0002';
  end if;
  if booking.venue_staff_id is distinct from p_staff_id then
    raise exception 'This venue booking request is assigned to another venue staff member.' using errcode = '42501';
  end if;
  if booking.status is distinct from 'Pending' then
    raise exception 'Only pending requests can be placed on hold. This request is %.', lower(booking.status)
      using errcode = '55000';
  end if;
  -- Read through jsonb: replacement_required and is_available exist only once venue_unavailability.sql runs.
  if coalesce((to_jsonb(booking)->>'replacement_required')::boolean, false) then
    raise exception 'This request needs a replacement venue and cannot be held.' using errcode = '55000';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Enter a hold expiry date and time in the future.' using errcode = '22023';
  end if;

  -- Locking the venue serialises holds on it, so two overlapping holds cannot both succeed.
  select * into venue from public."Venues" where venue_id = booking.venue_id for update;
  if coalesce((to_jsonb(venue)->>'is_available')::boolean, true) is false then
    raise exception 'This venue is unavailable and cannot be held.' using errcode = '55000';
  end if;
  select * into event_row from public."Event Details" where id = booking.event_id;
  period := public.venue_booking_period(booking.event_id, booking.venue_id);
  if period is null then
    raise exception 'The event needs a date, start time and end time before its venue can be held.' using errcode = '22023';
  end if;
  if p_expires_at > (event_row.event_date::date + event_row.start_time::time) at time zone 'Asia/Singapore' then
    raise exception 'The hold must expire before the event starts.' using errcode = '22023';
  end if;
  if public.venue_hold_conflict(booking.request_id, booking.venue_id, period) is not null then
    raise exception 'The venue is already booked or on hold for this time (including setup and teardown).'
      using errcode = '23P01';
  end if;

  update public."Venue Booking Requests"
  set status = 'On Hold', hold_expires_at = p_expires_at, hold_placed_by = p_staff_id, hold_placed_at = now(),
      -- A hold shorter than the reminder lead time is announced once, by the notice below.
      hold_reminder_sent_at = case when p_expires_at <= now() + public.venue_hold_reminder_lead() then now() end
  where request_id = p_request_id
  returning * into booking;
  perform public.venue_hold_notice(booking.request_id, 'placed');
  return booking;
end $$;

create or replace function public.remove_venue_hold(p_request_id bigint, p_staff_id uuid)
returns public."Venue Booking Requests"
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  booking public."Venue Booking Requests"%rowtype;
begin
  select * into booking from public."Venue Booking Requests" where request_id = p_request_id for update;
  if not found then
    raise exception 'Venue booking request not found.' using errcode = 'P0002';
  end if;
  if booking.venue_staff_id is distinct from p_staff_id then
    raise exception 'This venue booking request is assigned to another venue staff member.' using errcode = '42501';
  end if;
  if booking.status is distinct from 'On Hold' then
    raise exception 'This request is not on hold.' using errcode = '55000';
  end if;
  if booking.hold_expires_at <= now() then
    raise exception 'This hold has already expired.' using errcode = '55000';
  end if;
  -- The notice reads the hold before it is cleared.
  perform public.venue_hold_notice(booking.request_id, 'removed');
  update public."Venue Booking Requests"
  set status = 'Pending', hold_expires_at = null, hold_placed_by = null, hold_placed_at = null, hold_reminder_sent_at = null
  where request_id = p_request_id
  returning * into booking;
  return booking;
end $$;

-- Run every minute by pg_cron: remind coordinators of holds expiring within the lead time, then
-- expire holds whose time has passed. Each hold is reminded and expired at most once.
create or replace function public.process_venue_holds() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hold record;
  reminded integer := 0;
  expired integer := 0;
begin
  for hold in
    update public."Venue Booking Requests" set hold_reminder_sent_at = now()
    where status = 'On Hold' and hold_reminder_sent_at is null
      and hold_expires_at > now() and hold_expires_at <= now() + public.venue_hold_reminder_lead()
    returning request_id
  loop
    perform public.venue_hold_notice(hold.request_id, 'reminder');
    reminded := reminded + 1;
  end loop;
  for hold in
    update public."Venue Booking Requests" set status = 'Expired'
    where status = 'On Hold' and hold_expires_at <= now()
    returning request_id
  loop
    perform public.venue_hold_notice(hold.request_id, 'expired');
    expired := expired + 1;
  end loop;
  return jsonb_build_object('reminded', reminded, 'expired', expired);
end $$;

revoke all on function public.venue_booking_period(bigint, bigint) from public, anon, authenticated;
revoke all on function public.venue_hold_conflict(bigint, bigint, tstzrange) from public, anon, authenticated;
revoke all on function public.venue_hold_notice(bigint, text) from public, anon, authenticated;
revoke all on function public.place_venue_hold(bigint, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.remove_venue_hold(bigint, uuid) from public, anon, authenticated;
revoke all on function public.process_venue_holds() from public, anon, authenticated;
grant execute on function public.place_venue_hold(bigint, uuid, timestamptz) to service_role;
grant execute on function public.remove_venue_hold(bigint, uuid) to service_role;

-- Schedule the sweep when pg_cron is enabled; rerunning replaces the job instead of adding another.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venue-hold-expiry';
    perform cron.schedule('venue-hold-expiry', '* * * * *', 'select public.process_venue_holds()');
  else
    raise notice 'pg_cron is not enabled: enable it, then rerun this file to schedule venue hold reminders and expiries.';
  end if;
end $$;

commit;
