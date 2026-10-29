-- Stories 8.3 / 8.4. Apply after sprint2_registration_notifications.sql.
-- Assignment, cached workload counts and notifications commit or roll back together.
-- No existing rows are changed by installing this migration. See docs/Coordinator-Assignment.md.
begin;

-- The existing sprint2_event_notifications trigger notifies the incoming coordinator.
-- Keep the outgoing message self-contained: they lose access to the event's details.
create or replace function public.notify_outgoing_coordinator() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.coordinator_id is not null and new.coordinator_id is distinct from old.coordinator_id then
    perform public.emit_notifications(
      array[old.coordinator_id::text],
      new.event_name || ': your event has been reassigned to another coordinator.',
      'event', new.id::text
    );
  end if;
  return new;
end $$;
revoke all on function public.notify_outgoing_coordinator() from public, anon, authenticated;
drop trigger if exists outgoing_coordinator_notification on public."Event Details";
create trigger outgoing_coordinator_notification after update of coordinator_id on public."Event Details"
for each row execute function public.notify_outgoing_coordinator();

create or replace function public.assign_event_coordinator(
  p_event_id bigint, p_coordinator_id uuid, p_expected_coordinator_id uuid, p_lead_id uuid
) returns public."Event Details"
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  event_row public."Event Details"%rowtype;
  previous_id uuid;
begin
  -- The API supplies this actor from the verified session, never from the request body.
  if public.notification_actor() is distinct from p_lead_id::text or not exists (
    select 1 from public.users where id = p_lead_id and lower(trim(role)) = 'event coordinator lead'
  ) then
    raise exception 'Event coordinator lead access required.' using errcode = '42501';
  end if;

  select * into event_row from public."Event Details" where id = p_event_id for update;
  if not found then
    raise exception 'Event request not found.' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(event_row.status, ''))) in ('draft', 'complete', 'completed', 'cancelled', 'rejected') then
    raise exception 'Only active events can be assigned or reassigned.' using errcode = '55000';
  end if;
  if event_row.coordinator_id is distinct from p_expected_coordinator_id then
    raise exception 'The coordinator has changed. Refresh the event list and try again.' using errcode = '55000';
  end if;

  previous_id := event_row.coordinator_id;
  -- Stable ordering serializes workload changes involving the same coordinators.
  perform id from public.users where id in (previous_id, p_coordinator_id) order by id for update;
  if not exists (
    select 1 from public.users where id = p_coordinator_id and lower(trim(role)) = 'event coordinator'
  ) then
    raise exception 'Select an available event coordinator.' using errcode = '22023';
  end if;
  -- Retrying the current assignment is a no-op, with no duplicate notifications.
  if previous_id = p_coordinator_id then return event_row; end if;

  update public."Event Details"
    set coordinator_id = p_coordinator_id,
        status = case when previous_id is null and lower(trim(status)) = 'submitted' then 'Assigned' else status end
    where id = p_event_id returning * into event_row;

  update public.users u set active_event_count = (
    select count(*) from public."Event Details" e
    where e.coordinator_id = u.id
      and lower(trim(coalesce(e.status, ''))) not in ('draft', 'complete', 'completed', 'cancelled', 'rejected')
  ) where u.id in (previous_id, p_coordinator_id);
  return event_row;
end $$;
revoke all on function public.assign_event_coordinator(bigint, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_event_coordinator(bigint, uuid, uuid, uuid) to service_role;

commit;
