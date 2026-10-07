begin;

alter table public."Event Details"
  add column if not exists coordinator_comments text,
  add column if not exists amendments text,
  add column if not exists coordinator_comments_count integer not null default 0,
  add column if not exists amendments_count integer not null default 0;

update public."Event Details"
set coordinator_comments_count = case
      when nullif(trim(coordinator_comments), '') is not null then 1
      else coordinator_comments_count
    end,
    amendments_count = case
      when nullif(trim(amendments), '') is not null then 1
      else amendments_count
    end
where (coordinator_comments_count = 0 and nullif(trim(coordinator_comments), '') is not null)
   or (amendments_count = 0 and nullif(trim(amendments), '') is not null);

create or replace function public.submit_coordinator_feedback(
  p_event_id bigint,
  p_coordinator_id uuid,
  p_coordinator_comments text,
  p_amendments text
)
returns setof public."Event Details"
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(p_coordinator_comments), '') is null
     and nullif(trim(p_amendments), '') is null then
    raise exception 'Enter a clarification request, an amendment request, or both.'
      using errcode = '22023';
  end if;

  if length(coalesce(p_coordinator_comments, '')) > 5000
     or length(coalesce(p_amendments, '')) > 5000 then
    raise exception 'Clarification and amendment requests must be 5,000 characters or fewer each.'
      using errcode = '22023';
  end if;

  return query
  update public."Event Details" as event_row
  set coordinator_comments = case
        when nullif(trim(p_coordinator_comments), '') is not null then trim(p_coordinator_comments)
        else event_row.coordinator_comments
      end,
      amendments = case
        when nullif(trim(p_amendments), '') is not null then trim(p_amendments)
        else event_row.amendments
      end,
      coordinator_comments_count = coalesce(event_row.coordinator_comments_count, 0)
        + case when nullif(trim(p_coordinator_comments), '') is not null then 1 else 0 end,
      amendments_count = coalesce(event_row.amendments_count, 0)
        + case when nullif(trim(p_amendments), '') is not null then 1 else 0 end
  where event_row.id = p_event_id
    and event_row.coordinator_id = p_coordinator_id
    and lower(trim(coalesce(event_row.status, ''))) in ('submitted', 'under review')
  returning event_row.*;
end;
$$;

revoke all on function public.submit_coordinator_feedback(bigint, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_coordinator_feedback(bigint, uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
