-- Complete the attendee test account created through Supabase Auth.
-- Run in the Supabase SQL Editor. Existing allowed roles are preserved.
begin;
do $$
declare existing_expression text;
begin
  select pg_get_expr(conbin, conrelid) into existing_expression
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and conname = 'users_role_check' and contype = 'c';
  if existing_expression is not null and position('Attendee' in existing_expression) = 0 then
    alter table public.users drop constraint users_role_check;
    execute format(
      'alter table public.users add constraint users_role_check check ((%s) or role = %L)',
      existing_expression, 'Attendee'
    );
  end if;
  if not exists(select 1 from auth.users where email = 'attendee.test@example.com') then
    raise exception 'Create attendee.test@example.com in Supabase Auth first.';
  end if;
end $$;

insert into public.users(id, name, email, role, active_event_count)
select id, 'Test Attendee', email, 'Attendee', 0
from auth.users where email = 'attendee.test@example.com'
on conflict (id) do update
set name = excluded.name, email = excluded.email, role = excluded.role;
commit;

select id, name, email, role from public.users
where email = 'attendee.test@example.com';
