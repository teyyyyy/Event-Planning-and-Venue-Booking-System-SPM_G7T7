-- Run in Supabase SQL Editor after the existing migrations. Safe to rerun.
-- Event dates/times are Singapore wall-clock values. Apply before the new app.
begin;

create table if not exists public.event_registrations (
  id bigint generated always as identity primary key,
  event_id bigint not null references public."Event Details"(id),
  attendee_id uuid not null references public.users(id),
  registered_at timestamptz not null default now(),
  unique (event_id, attendee_id)
);
create index if not exists registrations_attendee on public.event_registrations(attendee_id);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.users(id),
  description text not null,
  record_type text not null check (record_type in ('event', 'venue_booking', 'equipment_request')),
  record_id text not null,
  created_at timestamptz not null default now(),
  is_read boolean not null default false
);
create index if not exists notifications_recipient on public.notifications(recipient_id, created_at desc);
alter table public.event_registrations enable row level security;
alter table public.notifications enable row level security;
-- Access goes through the authenticated backend. No browser writes can bypass
-- capacity checks or forge notifications/read status for another recipient.
revoke all on public.event_registrations, public.notifications from anon, authenticated;
grant all on public.event_registrations, public.notifications to service_role;
grant usage, select on sequence public.event_registrations_id_seq, public.notifications_id_seq to service_role;

create or replace function public.register_for_event(p_event_id bigint, p_attendee_id uuid)
returns public.event_registrations
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public."Event Details"%rowtype; r public.event_registrations%rowtype;
begin
  if not exists (select 1 from public.users where id = p_attendee_id and lower(trim(role)) = 'attendee') then
    raise exception 'Attendee access required.' using errcode = '42501';
  end if;
  select * into e from public."Event Details" where id = p_event_id for update;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.event_registrations where event_id = p_event_id and attendee_id = p_attendee_id) then
    raise exception 'You are already registered for this event.' using errcode = '23505';
  end if;
  if lower(trim(e.status)) is distinct from 'confirmed' then
    raise exception 'Registration is allowed only for confirmed events.';
  end if;
  if e.event_date is null or e.start_time is null or
     (e.event_date::date + e.start_time::time) at time zone 'Asia/Singapore' <= clock_timestamp() then
    raise exception 'Registration is closed because the event has started.';
  end if;
  if e.event_capacity is not null and
     (select count(*) from public.event_registrations where event_id = p_event_id) >= e.event_capacity then
    raise exception 'This event is full.';
  end if;
  insert into public.event_registrations(event_id, attendee_id) values(p_event_id, p_attendee_id) returning * into r;
  return r;
end $$;
revoke all on function public.register_for_event(bigint, uuid) from public, anon, authenticated;
grant execute on function public.register_for_event(bigint, uuid) to service_role;

-- The API supplies this header only after authenticating the user. Browser
-- clients cannot impersonate actors: their header is ignored unless service_role.
create or replace function public.notification_actor() returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare headers jsonb;
begin
  if auth.role() = 'service_role' then
    headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
    return headers->>'x-actor-id';
  end if;
  return auth.uid()::text;
end $$;

create or replace function public.emit_notifications(recipients text[], message text, kind text, target text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications(recipient_id, description, record_type, record_id)
  select distinct u.id, message, kind, target
  from public.users u where u.id::text = any(recipients)
    and u.id::text is distinct from public.notification_actor();
$$;
revoke all on function public.emit_notifications(text[], text, text, text) from public, anon, authenticated;

-- Staff responsible for this event, including the shared queues used by the
-- current application when no individual reviewer is assigned.
create or replace function public.event_notification_staff(target_event bigint) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct staff_id), '{}') from (
    select coordinator_id::text as staff_id from public."Event Details" where id = target_event
    union all
    select u.id::text from public."Venue Booking Requests" b join public.users u
      on u.id::text = b.venue_staff_id::text or
         (b.venue_staff_id is null and lower(trim(u.role)) = 'venue staff')
      where b.event_id = target_event and lower(trim(b.status)) not in ('cancelled','rejected')
    union all
    select u.id::text from public.users u where lower(trim(u.role)) = 'technical support staff'
      and exists(select 1 from public."Equipment Request" where event_id = target_event and lower(trim(status)) not in ('cancelled','rejected'))
  ) staff where staff_id is not null;
$$;
revoke all on function public.event_notification_staff(bigint) from public, anon, authenticated;

create or replace function public.event_notification_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare previous jsonb := '{}'; current_row jsonb := to_jsonb(new);
  recipients text[] := '{}'; audience text[]; changes text[] := '{}';
  new_status text := lower(trim(new.status)); old_status text;
begin
  if TG_OP = 'UPDATE' then previous := to_jsonb(old); end if;
  old_status := lower(trim(previous->>'status'));
  if new_status = 'submitted' and old_status is distinct from new_status then
    if new.coordinator_id is not null then recipients := array[new.coordinator_id::text];
    else select array_agg(id::text) into recipients from public.users where lower(trim(role)) = 'event coordinator'; end if;
    changes := array_append(changes, 'submitted for approval');
  end if;
  if current_row->>'coordinator_id' is not null and current_row->>'coordinator_id' is distinct from previous->>'coordinator_id' then
    recipients := coalesce(recipients, '{}') || array[new.coordinator_id::text];
    changes := array_append(changes, 'coordinator assigned');
  end if;
  if new_status in ('approved','rejected') and old_status is distinct from new_status then
    recipients := coalesce(recipients, '{}') || array[new.organiser_id::text];
    changes := array_append(changes, new_status);
  end if;
  if TG_OP = 'UPDATE' and old_status = 'confirmed' and
    (current_row->>'event_date', current_row->>'event_end_date', current_row->>'start_time', current_row->>'end_time', current_row->>'venue_id')
    is distinct from
    (previous->>'event_date', previous->>'event_end_date', previous->>'start_time', previous->>'end_time', previous->>'venue_id') then
    select array_agg(attendee_id::text) into audience from public.event_registrations where event_id = new.id;
    recipients := coalesce(recipients, '{}') || coalesce(audience, '{}') || array[new.coordinator_id::text];
    recipients := recipients || public.event_notification_staff(new.id);
    changes := array_append(changes, 'event details changed');
  end if;
  if new_status = 'cancelled' and old_status is distinct from new_status then
    select array_agg(attendee_id::text) into audience from public.event_registrations where event_id = new.id;
    recipients := coalesce(recipients, '{}') || coalesce(audience, '{}') || array[new.organiser_id::text, new.coordinator_id::text];
    recipients := recipients || public.event_notification_staff(new.id);
    changes := array_append(changes, 'cancelled');
  end if;
  if cardinality(changes) > 0 then
    perform public.emit_notifications(recipients, new.event_name || ': ' || array_to_string(changes, '; ') || '.', 'event', new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists sprint2_event_notifications on public."Event Details";
create trigger sprint2_event_notifications after insert or update on public."Event Details"
for each row execute function public.event_notification_changes();

create or replace function public.booking_notification_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n jsonb := to_jsonb(new); o jsonb := '{}'; recipients text[] := '{}'; audience text[]; notified text[] := '{}';
  kind text; reviewer text; requester text; label text; message text; e public."Event Details"%rowtype;
  next_status text := lower(trim(n->>'status')); prior_status text;
begin
  if TG_OP = 'UPDATE' then o := to_jsonb(old); end if;
  prior_status := lower(trim(o->>'status'));
  if TG_TABLE_NAME = 'Venue Booking Requests' then
    kind := 'venue_booking'; reviewer := n->>'venue_staff_id'; requester := n->>'coordinator_id'; label := 'Venue booking';
  else
    kind := 'equipment_request'; reviewer := n->>'assigned_staff_id'; requester := n->>'created_by'; label := 'Equipment request';
  end if;
  if next_status in ('pending','submitted') and next_status is distinct from prior_status then
    if reviewer is not null then recipients := array[reviewer];
    else
      select array_agg(id::text) into recipients from public.users
      where lower(trim(role)) = case when kind = 'venue_booking' then 'venue staff' else 'technical support staff' end;
    end if;
    message := label || ' submitted.';
  end if;
  if reviewer is not null and reviewer is distinct from
     (case when kind = 'venue_booking' then o->>'venue_staff_id' else o->>'assigned_staff_id' end) then
    recipients := coalesce(recipients, '{}') || array[reviewer];
    message := coalesce(message || ' ', '') || label || ' assigned.';
  end if;
  if next_status in ('approved','rejected') and next_status is distinct from prior_status then
    recipients := coalesce(recipients, '{}') || array[requester];
    message := coalesce(message || ' ', '') || label || ' ' || next_status || '.';
  end if;
  if message is not null then
    notified := coalesce(recipients, '{}');
    perform public.emit_notifications(recipients, message, kind, n->>'request_id');
  end if;
  -- Venue is represented by approved booking rows, not just an event column.
  if kind = 'venue_booking' and
     ((next_status = 'approved' and (prior_status is distinct from next_status or n->>'venue_id' is distinct from o->>'venue_id'))
      or (prior_status = 'approved' and next_status is distinct from prior_status)) then
    select * into e from public."Event Details" where id = (n->>'event_id')::bigint;
    if lower(trim(e.status)) = 'confirmed' then
      select array_agg(attendee_id::text) into audience from public.event_registrations where event_id = e.id;
      recipients := coalesce(audience, '{}') || array[e.coordinator_id::text, reviewer];
      recipients := recipients || public.event_notification_staff(e.id);
      -- A reviewer/requester already notified above receives one alert for this write.
      if message is not null then
        recipients := array(select x from unnest(recipients) x where not exists(select 1 from unnest(notified) sent where sent = x));
      end if;
      perform public.emit_notifications(recipients, e.event_name || ': venue changed.', 'event', e.id::text);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sprint2_venue_notifications on public."Venue Booking Requests";
create trigger sprint2_venue_notifications after insert or update on public."Venue Booking Requests"
for each row execute function public.booking_notification_changes();
drop trigger if exists sprint2_equipment_notifications on public."Equipment Request";
create trigger sprint2_equipment_notifications after insert or update on public."Equipment Request"
for each row execute function public.booking_notification_changes();
-- Header, items and notification must commit together.
create or replace function public.submit_equipment_request(p_event_id bigint, p_coordinator_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare request_id_value bigint; saved_items jsonb;
begin
  perform 1 from public."Event Details" where id = p_event_id and coordinator_id = p_coordinator_id for update;
  if not found then raise exception 'Event not found or is not assigned to this coordinator.' using errcode = '42501'; end if;
  if exists(select 1 from public."Equipment Request" where event_id = p_event_id) then
    raise exception 'An equipment request has already been submitted for this event.' using errcode = '23505';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one equipment item is required.';
  end if;
  insert into public."Equipment Request"(event_id, status, created_by)
  values(p_event_id, 'Submitted', p_coordinator_id) returning request_id into request_id_value;
  insert into public."Equipment Request Item"(request_id, equipment_id, requested_quantity, technical_requirements)
  select request_id_value, equipment_id, requested_quantity, technical_requirements
  from jsonb_populate_recordset(null::public."Equipment Request Item", p_items);
  select jsonb_agg(to_jsonb(i)) into saved_items from public."Equipment Request Item" i where request_id = request_id_value;
  return jsonb_build_object('request_id', request_id_value, 'event_id', p_event_id, 'items', saved_items);
end $$;
revoke all on function public.submit_equipment_request(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_equipment_request(bigint, uuid, jsonb) to service_role;
commit;
