-- Undo coordinator_alternative_venue.sql. Roll back application code first: the current code reads
-- alternative_venue_id. Each offer is stored as its venue's name again; offers whose venue was
-- deleted were already cleared and stay empty.
begin;
alter table public."Venue Booking Requests" add column if not exists alternative_venue text;
update public."Venue Booking Requests" b set alternative_venue = v.name
from public."Venues" v
where v.venue_id = b.alternative_venue_id and b.alternative_venue is null;
alter table public."Venue Booking Requests" drop column if exists alternative_venue_id;
commit;
