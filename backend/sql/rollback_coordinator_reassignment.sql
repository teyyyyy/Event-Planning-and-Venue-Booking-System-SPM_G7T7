-- Roll back application code first. Does not undo completed assignments or delete notifications.
begin;
drop function if exists public.assign_event_coordinator(bigint, uuid, uuid, uuid);
drop trigger if exists outgoing_coordinator_notification on public."Event Details";
drop function if exists public.notify_outgoing_coordinator();
commit;
