-- Multi-day events: an event runs from event_date + start_time to
-- event_end_date + end_time. NULL event_end_date means a single-day event.
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table "Event Details"
  add column if not exists event_end_date date;

update "Event Details" set event_end_date = event_date where event_end_date is null;
