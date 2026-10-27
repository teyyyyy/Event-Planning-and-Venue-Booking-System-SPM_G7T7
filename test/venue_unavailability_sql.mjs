// Isolated PostgreSQL checks for venue_unavailability.sql (stories 25.1–25.3).
// Install @electric-sql/pglite in a temporary directory, then set PGLITE_MODULE to its
// dist/index.js to run (see README).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create table users(id uuid primary key, name text, role text);
create table "Event Details"(id bigint primary key, event_name text, event_type text, description text,
  event_date date, event_end_date date, start_time time, end_time time, event_capacity integer, status text,
  organiser_id uuid, coordinator_id uuid, layout_required text, facilities_required text[], accessibility_required bigint);
create table "Venue Booking Requests"(request_id bigint generated always as identity primary key,
  created_at timestamptz not null default now(), event_id bigint unique, venue_id bigint not null,
  venue_staff_id uuid, coordinator_id uuid not null, status text not null,
  rejection_reason text, alternative_venue text, decided_at timestamptz);
create table "Equipment Request"(request_id bigint generated always as identity primary key, event_id bigint not null,
  status text default 'Draft', created_by uuid, updated_by uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), latest_update_summary text);
create table "Equipment Request Item"(request_id bigint, equipment_id text, requested_quantity integer not null check(requested_quantity >= 0),
  technical_requirements text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  updated_by uuid, primary key(request_id, equipment_id));
create table event_change_requests(
  id bigint generated always as identity primary key,
  event_id bigint not null references public."Event Details"(id),
  organiser_id uuid not null references public.users(id),
  coordinator_id uuid not null references public.users(id),
  request_text text not null check (length(trim(request_text)) between 1 and 5000),
  created_at timestamptz not null default now()
);
`);
const sql = async (name) => readFile(new URL(`../backend/sql/${name}`, import.meta.url), 'utf8');
for (const name of ['sprint2_registration_notifications.sql', 'event_change_requests.sql', 'significant_event_changes.sql']) {
  await db.exec(await sql(name));
}
await db.exec(await sql('significant_event_changes.sql')); // rerunnable
await db.exec(await sql('event_change_requests.sql')); // the review RPC keeps its link to the trigger


await db.exec('create table "Venues" (venue_id bigint primary key, name text)');
await db.exec(await sql('venue_unavailability.sql'));
await db.exec(await sql('venue_unavailability.sql'));
assert.match((await db.query(`select indexdef from pg_indexes where indexname='Venue Booking Requests_active_event_venue_key'`)).rows[0].indexdef,
  /\(event_id, venue_id\) WHERE .*'approved'.*AND \(NOT replacement_required\)/, 'Requests needing a replacement venue do not count as active');
const c = '00000000-0000-0000-0000-000000000001';
await db.query("insert into users values ($1, 'Coordinator', 'Event Coordinator')", [c]);
await db.exec(`insert into "Venues"(venue_id,name) values (1,'Hall A'),(2,'Hall B');`);
// Like the live table, a booking has no times of its own: whether it is still upcoming comes from its event.
for (const [id, status, day, endDay, endTime] of [
  [1,'Approved','2099-01-01',null,'12:00'], [2,'Pending','2099-01-01',null,'12:00'], [3,'Rejected','2099-01-01',null,'12:00'],
  [4,'Approved','2000-01-01',null,'12:00'], // already over, so left alone
  [5,'On Hold',null,null,null], // no times yet, so treated as upcoming
  [6,'Approved','2000-01-01','2099-01-02','12:00'], // multi-day event that has not ended
]) {
  await db.query(`insert into "Event Details"(id,event_name,status,coordinator_id,event_date,event_end_date,end_time)
    values($1,'Meeting','Approved',$2,$3,$4,$5)`, [id,c,day,endDay,endTime]);
  await db.query(`insert into "Venue Booking Requests"(event_id,venue_id,coordinator_id,status) values($1,1,$2,$3)`, [id,c,status]);
}
await db.exec('delete from notifications');
await db.exec(`update "Venues" set is_available=false, unavailability_reason='Safety inspection' where venue_id=1`);
const rows = (await db.query('select * from "Venue Booking Requests" order by event_id')).rows;
assert.deepEqual(rows.map(r => [r.status,r.replacement_required]),
  [['Pending',true],['Pending',true],['Rejected',false],['Approved',false],['Pending',true],['Pending',true]]);
const notices = (await db.query("select * from notifications where description like '%replacement venue%'")).rows;
assert.equal(notices.length,4);
assert.ok(notices.every(n => n.recipient_id===c && n.description.includes('Safety inspection')));
await assert.rejects(db.exec(`insert into "Venue Booking Requests"(event_id,venue_id,coordinator_id,status)
  values(1,1,'${c}','Pending')`), /unavailable/);
await db.query(`insert into "Venue Booking Requests"(event_id,venue_id,coordinator_id,status) values(1,2,$1,'Pending')`, [c]);
assert.equal((await db.query('select count(*)::int as count from "Venue Booking Requests" where event_id=1')).rows[0].count,2);
await db.exec(`update "Venues" set is_available=false where venue_id=1`);
assert.equal((await db.query("select count(*)::int as count from notifications where description like '%replacement venue%'")).rows[0].count,4);
await db.exec(`update "Venues" set is_available=true,unavailability_reason='' where venue_id=1`);
await assert.rejects(db.exec(`update "Venue Booking Requests" set status='Approved' where event_id=2`), /replacement/);
await db.exec(`update "Venue Booking Requests" set status='Approved' where event_id=1 and venue_id=2`);
await db.query(`insert into "Venue Booking Requests"(event_id,venue_id,coordinator_id,status) values(2,1,$1,'Pending')`, [c]);
await assert.rejects(db.exec(`update "Venues" set is_available=false,unavailability_reason=' ' where venue_id=2`), /constraint/);
// A notification failure must roll back both the venue change and booking reset.
await db.exec(`create function fail_notification() returns trigger language plpgsql as $$ begin raise exception 'notification failed'; end $$;
create trigger test_failure before insert on notifications for each row execute function fail_notification();`);
await assert.rejects(db.exec(`update "Venues" set is_available=false,unavailability_reason='Maintenance' where venue_id=2`), /notification failed/);
assert.equal((await db.query('select is_available from "Venues" where venue_id=2')).rows[0].is_available,true);
assert.equal((await db.query('select status from "Venue Booking Requests" where venue_id=2')).rows[0].status,'Approved');
console.log('Venue unavailability SQL checks passed: atomic resets, notifications, replacement, reopening and guards.');
await db.close();
