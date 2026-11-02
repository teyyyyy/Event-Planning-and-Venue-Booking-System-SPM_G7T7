-- Alternative venue offers: venue staff suggest a catalogue venue, stored as alternative_venue_id.
-- Databases built from the earlier venue_approval.sql stored the suggestion as free text in
-- alternative_venue; this replaces that column. Each text value is matched to the one catalogue venue
-- with that name (ignoring case and surrounding spaces). If any value matches no venue or several,
-- nothing is changed and the error names those requests, so no offer is lost; fix them and re-run.
-- Run after venue_approval.sql. Transactional and safe to re-run: once alternative_venue is gone,
-- as in Supabase, it does nothing. Undo with rollback_coordinator_alternative_venue.sql.
begin;
alter table public."Venue Booking Requests"
  add column if not exists alternative_venue_id bigint references public."Venues"(venue_id) on delete set null;

do $$
declare unmatched text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Venue Booking Requests' and column_name = 'alternative_venue'
  ) then
    return;
  end if;

  update public."Venue Booking Requests" b set alternative_venue_id = v.venue_id
  from public."Venues" v
  where b.alternative_venue_id is null
    and lower(trim(v.name)) = lower(trim(b.alternative_venue))
    and (select count(*) from public."Venues" same where lower(trim(same.name)) = lower(trim(b.alternative_venue))) = 1;

  select string_agg(format('request %s (%L)', request_id, alternative_venue), ', ' order by request_id) into unmatched
  from public."Venue Booking Requests"
  where alternative_venue_id is null and trim(coalesce(alternative_venue, '')) <> '';
  if unmatched is not null then
    raise exception 'Alternative venue text matches no single catalogue venue for %. Fix these and re-run.', unmatched;
  end if;

  alter table public."Venue Booking Requests" drop column alternative_venue;
end;
$$;
commit;
