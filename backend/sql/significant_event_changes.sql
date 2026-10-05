-- Stories 10.2 (significant event changes) and 44.4 (processing approved change requests).
-- Run in the Supabase SQL Editor after event_change_requests.sql. Safe to rerun.
--
-- 10.2: every saved change to a submitted event is classified. Schedule, capacity and venue
--       requirement changes are Significant: they are logged as such and the event's live venue
--       booking and equipment requests return to Pending for re-review. Other edits are Ordinary.
-- 44.4: an approved change request with a significant change is "Awaiting processing" until its
--       coordinator processes it. Processing supersedes the affected live requests and initiates
--       new Pending venue / equipment requests linked to the event and the change request.
begin;

-- Fields that can invalidate confirmed arrangements, in display order. venue_id is listed for
-- schemas that store it on the event; absent columns compare equal and are never reported.
create or replace function public.event_change_impact(previous jsonb, current_row jsonb)
returns table(changed_fields text[], significant_fields text[], venue_fields text[], equipment_fields text[])
language sql immutable set search_path = public, pg_temp as $$
  with tracked(ord, field, affects_venue, affects_equipment) as (values
    (1, 'event_name', false, false),
    (2, 'event_type', false, false),
    (3, 'description', false, false),
    (4, 'event_date', true, true),
    (5, 'event_end_date', true, true),
    (6, 'start_time', true, true),
    (7, 'end_time', true, true),
    (8, 'event_capacity', true, false),
    (9, 'venue_id', true, false),
    (10, 'layout_required', true, false),
    (11, 'facilities_required', true, false),
    (12, 'accessibility_required', true, false)
  ), changed as (
    select t.* from tracked t
    where case when t.field = 'event_end_date'
      -- A blank end date means a single-day event, so it equals the start date.
      then coalesce(nullif(previous->'event_end_date', 'null'), previous->'event_date')
        is distinct from coalesce(nullif(current_row->'event_end_date', 'null'), current_row->'event_date')
      else previous->t.field is distinct from current_row->t.field end
  )
  select
    coalesce(array_agg(field order by ord), '{}'),
    coalesce(array_agg(field order by ord) filter (where affects_venue or affects_equipment), '{}'),
    coalesce(array_agg(field order by ord) filter (where affects_venue), '{}'),
    coalesce(array_agg(field order by ord) filter (where affects_equipment), '{}')
  from changed;
$$;
revoke all on function public.event_change_impact(jsonb, jsonb) from public, anon, authenticated;

create table if not exists public.event_change_log (
  id bigint generated always as identity primary key,
  event_id bigint not null references public."Event Details"(id) on delete cascade,
  change_request_id bigint references public.event_change_requests(id),
  changed_by uuid,
  event_status text,
  change_type text not null check (change_type in ('Significant', 'Ordinary')),
  changed_fields text[] not null,
  significant_fields text[] not null default '{}',
  affects_venue boolean not null default false,
  affects_equipment boolean not null default false,
  previous_values jsonb not null,
  new_values jsonb not null,
  reset_venue_request_ids bigint[] not null default '{}',
  reset_equipment_request_ids bigint[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists event_change_log_event on public.event_change_log(event_id, created_at desc);
alter table public.event_change_log enable row level security;
revoke all on public.event_change_log from anon, authenticated;
grant all on public.event_change_log to service_role;
grant usage, select on sequence public.event_change_log_id_seq to service_role;

alter table public.event_change_requests
  add column if not exists change_type text,
  add column if not exists significant_fields text[],
  add column if not exists affects_venue boolean,
  add column if not exists affects_equipment boolean,
  add column if not exists processing_status text,
  add column if not exists processed_by uuid references public.users(id),
  add column if not exists processed_at timestamptz,
  add column if not exists processing_summary text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_change_requests'::regclass
      and conname = 'event_change_requests_processing_status_check'
  ) then
    alter table public.event_change_requests
      add constraint event_change_requests_processing_status_check
      check (processing_status in ('Awaiting processing', 'Processed', 'Not required'));
  end if;
end $$;

alter table public."Venue Booking Requests"
  add column if not exists change_request_id bigint references public.event_change_requests(id);
alter table public."Equipment Request"
  add column if not exists change_request_id bigint references public.event_change_requests(id);

-- One live venue booking per event: a full UNIQUE(event_id) would also block the replacement
-- request that processing creates, so it is narrowed to rows that have not been superseded.
-- The index name keeps "event_id_key", which the venue request form maps to a friendly message.
do $$
declare
  item record;
  event_column smallint := (
    select attnum from pg_attribute
    where attrelid = 'public."Venue Booking Requests"'::regclass and attname = 'event_id'
  );
begin
  for item in
    select conname from pg_constraint
    where conrelid = 'public."Venue Booking Requests"'::regclass and contype = 'u' and conkey = array[event_column]
  loop
    execute format('alter table public."Venue Booking Requests" drop constraint %I', item.conname);
  end loop;
  for item in
    select i.indexrelid::regclass::text as name from pg_index i
    where i.indrelid = 'public."Venue Booking Requests"'::regclass
      and i.indisunique and not i.indisprimary and i.indpred is null
      and i.indnatts = 1 and i.indkey[0] = event_column
  loop
    execute format('drop index %s', item.name);
  end loop;
  if exists (
    select 1 from public."Venue Booking Requests"
    where status is distinct from 'Superseded'
    group by event_id having count(*) > 1
  ) then
    raise notice 'Some events already have several live venue bookings; one-live-booking index not created.';
  else
    create unique index if not exists "Venue Booking Requests_live_event_id_key"
      on public."Venue Booking Requests"(event_id) where status is distinct from 'Superseded';
  end if;
end $$;

-- review_event_change_request sets app.event_change_request_id while it applies an approved
-- proposal, so the change is linked to that request and its processing status is recorded.
create or replace function public.record_event_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  impact record;
  change_request_id bigint := nullif(current_setting('app.event_change_request_id', true), '')::bigint;
  actor text := public.notification_actor();
  significant boolean;
  venue_ids bigint[] := '{}';
  equipment_ids bigint[] := '{}';
begin
  -- Drafts have no arrangements yet; tracking starts once an event is submitted.
  if lower(trim(coalesce(old.status, ''))) in ('', 'draft') then
    return new;
  end if;

  select * into impact from public.event_change_impact(to_jsonb(old), to_jsonb(new));
  significant := cardinality(impact.significant_fields) > 0;

  if cardinality(impact.venue_fields) > 0 then
    with reset as (
      update public."Venue Booking Requests" set status = 'Pending'
      where event_id = new.id
        and lower(trim(coalesce(status, ''))) not in ('pending', 'cancelled', 'rejected', 'superseded')
      returning request_id
    )
    select coalesce(array_agg(request_id order by request_id), '{}') into venue_ids from reset;
  end if;

  if cardinality(impact.equipment_fields) > 0 then
    with reset as (
      update public."Equipment Request" set status = 'Pending', updated_at = now()
      where event_id = new.id
        and lower(trim(coalesce(status, ''))) not in ('pending', 'draft', 'cancelled', 'rejected', 'superseded')
      returning request_id
    )
    select coalesce(array_agg(request_id order by request_id), '{}') into equipment_ids from reset;
  end if;

  if cardinality(impact.changed_fields) > 0 then
    insert into public.event_change_log (
      event_id, change_request_id, changed_by, event_status, change_type,
      changed_fields, significant_fields, affects_venue, affects_equipment,
      previous_values, new_values, reset_venue_request_ids, reset_equipment_request_ids
    )
    values (
      new.id, change_request_id,
      case when actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then actor::uuid end,
      old.status,
      case when significant then 'Significant' else 'Ordinary' end,
      impact.changed_fields, impact.significant_fields,
      cardinality(impact.venue_fields) > 0, cardinality(impact.equipment_fields) > 0,
      (select jsonb_object_agg(field, to_jsonb(old)->field) from unnest(impact.changed_fields) field),
      (select jsonb_object_agg(field, to_jsonb(new)->field) from unnest(impact.changed_fields) field),
      venue_ids, equipment_ids
    );
  end if;

  if change_request_id is not null then
    update public.event_change_requests
    set change_type = case when significant then 'Significant' else 'Ordinary' end,
        significant_fields = impact.significant_fields,
        affects_venue = cardinality(impact.venue_fields) > 0,
        affects_equipment = cardinality(impact.equipment_fields) > 0,
        processing_status = case when significant then 'Awaiting processing' else 'Not required' end
    where id = change_request_id;
  end if;

  return new;
end $$;
revoke all on function public.record_event_change() from public, anon, authenticated;
drop trigger if exists record_event_change on public."Event Details";
create trigger record_event_change after update on public."Event Details"
for each row execute function public.record_event_change();

create or replace function public.process_event_change_request(p_request_id bigint, p_coordinator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  change_request public.event_change_requests%rowtype;
  event_row public."Event Details"%rowtype;
  previous record;
  owner_id uuid;
  starts_at timestamptz;
  ends_at timestamptz;
  new_id bigint;
  venue_requests jsonb := '[]';
  equipment_requests jsonb := '[]';
  summary text[] := '{}';
begin
  select * into change_request
  from public.event_change_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Event change request not found.' using errcode = 'P0002';
  end if;

  if change_request.coordinator_id is distinct from p_coordinator_id then
    raise exception 'You can only process change requests assigned to you.'
      using errcode = '42501';
  end if;

  if change_request.review_status is distinct from 'Approved' then
    raise exception 'Only approved change requests can be processed.' using errcode = '55000';
  end if;

  if change_request.processing_status = 'Processed' then
    raise exception 'This change request has already been processed.' using errcode = '55000';
  end if;

  if change_request.processing_status is distinct from 'Awaiting processing' then
    raise exception 'This change request does not affect venue or equipment arrangements.'
      using errcode = '55000';
  end if;

  select * into event_row
  from public."Event Details"
  where id = change_request.event_id
  for update;

  if not found then
    raise exception 'Event request not found.' using errcode = 'P0002';
  end if;

  -- New requests belong to whoever coordinates the event now.
  owner_id := coalesce(event_row.coordinator_id, p_coordinator_id);
  -- The venue request form stores the event's wall-clock time as UTC; keep that convention.
  starts_at := (event_row.event_date + event_row.start_time) at time zone 'UTC';
  ends_at := (coalesce(event_row.event_end_date, event_row.event_date) + event_row.end_time) at time zone 'UTC';

  if change_request.affects_venue then
    for previous in
      update public."Venue Booking Requests" set status = 'Superseded'
      where event_id = event_row.id
        and lower(trim(coalesce(status, ''))) not in ('cancelled', 'rejected', 'superseded')
      returning *
    loop
      insert into public."Venue Booking Requests" (
        event_id, venue_id, coordinator_id, venue_staff_id, start_datetime, end_datetime,
        accessibility_required, layout_required, facilities_required, status, change_request_id
      )
      values (
        event_row.id, previous.venue_id, owner_id, previous.venue_staff_id, starts_at, ends_at,
        previous.accessibility_required, previous.layout_required, previous.facilities_required,
        'Pending', change_request.id
      )
      returning request_id into new_id;
      venue_requests := venue_requests || jsonb_build_object(
        'request_id', new_id, 'previous_request_id', previous.request_id, 'venue_id', previous.venue_id
      );
      summary := summary || format('Venue booking #%s replaced by #%s.', previous.request_id, new_id);
    end loop;
    if jsonb_array_length(venue_requests) = 0 then
      summary := summary || 'No active venue booking needed a new request.'::text;
    end if;
  end if;

  if change_request.affects_equipment then
    for previous in
      update public."Equipment Request"
      set status = 'Superseded', updated_at = now(), updated_by = p_coordinator_id
      where event_id = event_row.id
        and lower(trim(coalesce(status, ''))) not in ('draft', 'cancelled', 'rejected', 'superseded')
      returning *
    loop
      insert into public."Equipment Request" (event_id, status, created_by, change_request_id, latest_update_summary)
      values (
        event_row.id, 'Pending', owner_id, change_request.id,
        format('Re-initiated for approved change request #%s.', change_request.id)
      )
      returning request_id into new_id;
      insert into public."Equipment Request Item" (request_id, equipment_id, requested_quantity, technical_requirements)
      select new_id, equipment_id, requested_quantity, technical_requirements
      from public."Equipment Request Item"
      where request_id = previous.request_id and requested_quantity > 0;
      equipment_requests := equipment_requests || jsonb_build_object(
        'request_id', new_id, 'previous_request_id', previous.request_id
      );
      summary := summary || format('Equipment request #%s replaced by #%s.', previous.request_id, new_id);
    end loop;
    if jsonb_array_length(equipment_requests) = 0 then
      summary := summary || 'No active equipment request needed a new request.'::text;
    end if;
  end if;

  update public.event_change_requests
  set processing_status = 'Processed',
      processed_by = p_coordinator_id,
      processed_at = now(),
      processing_summary = array_to_string(summary, ' ')
  where id = p_request_id
  returning * into change_request;

  perform public.emit_notifications(
    array[change_request.organiser_id::text],
    format(
      'Change request for "%s" was processed: %s',
      coalesce(event_row.event_name, 'Event'),
      change_request.processing_summary
    ),
    'event',
    event_row.id::text
  );

  return jsonb_build_object(
    'change_request', to_jsonb(change_request),
    'venue_requests', venue_requests,
    'equipment_requests', equipment_requests
  );
end;
$$;

revoke all on function public.process_event_change_request(bigint, uuid) from public, anon, authenticated;
grant execute on function public.process_event_change_request(bigint, uuid) to service_role;

commit;
