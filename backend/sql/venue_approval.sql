-- Venue approval (venue staff approve / reject venue booking requests).
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table "Venue Booking Requests"
  add column if not exists rejection_reason  text,
  add column if not exists alternative_venue_id bigint references public."Venues"(venue_id) on delete set null,
  add column if not exists decided_at        timestamptz;
