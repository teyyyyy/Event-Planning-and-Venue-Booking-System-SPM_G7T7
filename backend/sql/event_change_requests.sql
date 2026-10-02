-- Run in the Supabase SQL Editor after sprint2_registration_notifications.sql.
-- Safe to rerun; stores each organiser request and notifies its assigned coordinator atomically.
begin;

create table if not exists public.event_change_requests (
  id bigint generated always as identity primary key,
  event_id bigint not null references public."Event Details"(id),
  organiser_id uuid not null references public.users(id),
  coordinator_id uuid not null references public.users(id),
  request_text text not null check (length(trim(request_text)) between 1 and 5000),
  proposed_event_name text,
  proposed_event_type text,
  proposed_event_date date,
  proposed_event_end_date date,
  proposed_event_capacity bigint,
  proposed_description text,
  proposed_start_time time without time zone,
  proposed_end_time time without time zone,
  review_status text not null default 'Pending',
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  review_comments text,
  created_at timestamptz not null default now()
);

alter table public.event_change_requests
  add column if not exists proposed_event_name text,
  add column if not exists proposed_event_type text,
  add column if not exists proposed_event_date date,
  add column if not exists proposed_event_end_date date,
  add column if not exists proposed_event_capacity bigint,
  add column if not exists proposed_description text,
  add column if not exists proposed_start_time time without time zone,
  add column if not exists proposed_end_time time without time zone,
  add column if not exists review_status text not null default 'Pending',
  add column if not exists reviewed_by uuid references public.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_comments text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_change_requests'::regclass
      and conname = 'event_change_requests_review_status_check'
  ) then
    alter table public.event_change_requests
      add constraint event_change_requests_review_status_check
      check (review_status in ('Pending', 'Approved', 'Rejected'));
  end if;
end $$;

create index if not exists event_change_requests_event
  on public.event_change_requests(event_id, created_at desc);

create index if not exists event_change_requests_coordinator
  on public.event_change_requests(coordinator_id, created_at desc);

create index if not exists event_change_requests_pending_coordinator
  on public.event_change_requests(coordinator_id, created_at desc)
  where review_status = 'Pending';

alter table public.event_change_requests enable row level security;
revoke all on public.event_change_requests from anon, authenticated;
grant all on public.event_change_requests to service_role;
grant usage, select on sequence public.event_change_requests_id_seq to service_role;

drop function if exists public.submit_event_change_request(bigint, uuid, text);
drop function if exists public.review_event_change_request(bigint, uuid, text, text);

create or replace function public.submit_event_change_request(
  p_event_id bigint,
  p_organiser_id uuid,
  p_request_text text,
  p_event_name text,
  p_event_type text,
  p_event_date date,
  p_event_end_date date,
  p_event_capacity integer,
  p_description text,
  p_start_time time without time zone,
  p_end_time time without time zone
)
returns public.event_change_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_row public."Event Details"%rowtype;
  change_request public.event_change_requests%rowtype;
  event_status text;
begin
  if p_request_text is null or length(trim(p_request_text)) not between 1 and 5000 then
    raise exception 'Change requests must contain 1 to 5,000 characters.'
      using errcode = '22023';
  end if;

  select * into event_row
  from public."Event Details"
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event request not found.' using errcode = 'P0002';
  end if;

  if event_row.organiser_id is distinct from p_organiser_id then
    raise exception 'You can only request changes to your own event.'
      using errcode = '42501';
  end if;

  event_status := lower(trim(coalesce(event_row.status, '')));
  if event_status in ('', 'draft', 'completed', 'cancelled', 'rejected') then
    raise exception 'Change requests are not available for this event status.'
      using errcode = '22023';
  end if;

  if event_row.coordinator_id is null then
    raise exception 'An event coordinator must be assigned before requesting changes.'
      using errcode = '22023';
  end if;

  if p_event_name is null or length(trim(p_event_name)) = 0
    or p_event_type is null or length(trim(p_event_type)) = 0
    or p_event_date is null or p_event_end_date is null
    or p_event_capacity is null or p_event_capacity <= 0
    or p_description is null or length(trim(p_description)) = 0
    or p_start_time is null or p_end_time is null then
    raise exception 'All proposed event fields are required.'
      using errcode = '22023';
  end if;

  if p_event_date < current_date and p_event_date is distinct from event_row.event_date then
    raise exception 'A changed event start date cannot be in the past.'
      using errcode = '22023';
  end if;

  if p_event_end_date < current_date
    and p_event_end_date is distinct from coalesce(event_row.event_end_date, event_row.event_date) then
    raise exception 'A changed event end date cannot be in the past.'
      using errcode = '22023';
  end if;

  insert into public.event_change_requests (
    event_id, organiser_id, coordinator_id, request_text,
    proposed_event_name, proposed_event_type, proposed_event_date,
    proposed_event_end_date, proposed_event_capacity, proposed_description,
    proposed_start_time, proposed_end_time
  )
  values (
    p_event_id, p_organiser_id, event_row.coordinator_id, trim(p_request_text),
    trim(p_event_name), trim(p_event_type), p_event_date, p_event_end_date,
    p_event_capacity, trim(p_description), p_start_time, p_end_time
  )
  returning * into change_request;

  perform public.emit_notifications(
    array[event_row.coordinator_id::text],
    format('Change request for "%s": %s', coalesce(event_row.event_name, 'Event'), trim(p_request_text)),
    'event',
    event_row.id::text
  );

  return change_request;
end;
$$;

revoke all on function public.submit_event_change_request(
  bigint, uuid, text, text, text, date, date, integer, text, time without time zone, time without time zone
) from public, anon, authenticated;
grant execute on function public.submit_event_change_request(
  bigint, uuid, text, text, text, date, date, integer, text, time without time zone, time without time zone
) to service_role;

commit;
