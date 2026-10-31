-- Align existing venue request ownership with each event's current coordinator.
-- Apply after coordinator_reassignment.sql and before releasing the updated application.
-- Previous IDs are preserved so the data change can be reviewed or reversed if necessary.
begin;

create table if not exists public.venue_booking_coordinator_id_backup (
  request_id bigint primary key references public."Venue Booking Requests"(request_id) on delete cascade,
  previous_coordinator_id uuid,
  captured_at timestamptz not null default now()
);
alter table public.venue_booking_coordinator_id_backup enable row level security;
revoke all on public.venue_booking_coordinator_id_backup from public, anon, authenticated, service_role;

insert into public.venue_booking_coordinator_id_backup(request_id, previous_coordinator_id)
select booking.request_id, booking.coordinator_id
from public."Venue Booking Requests" as booking
join public."Event Details" as event on event.id = booking.event_id
where event.coordinator_id is not null
  and booking.coordinator_id is distinct from event.coordinator_id
on conflict (request_id) do nothing;

update public."Venue Booking Requests" as booking
set coordinator_id = event.coordinator_id
from public."Event Details" as event
where event.id = booking.event_id
  and event.coordinator_id is not null
  and booking.coordinator_id is distinct from event.coordinator_id;

commit;
