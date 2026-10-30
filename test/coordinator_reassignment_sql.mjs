// Isolated PostgreSQL checks for stories 8.3/8.4. See docs/Coordinator-Assignment.md.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const sql = name => readFile(new URL(`../backend/sql/${name}`, import.meta.url), 'utf8');
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create table users(id uuid primary key, role text, active_event_count bigint default 0);
create table "Event Details"(id bigint primary key, event_name text, event_date date, event_end_date date,
  start_time time, end_time time, event_capacity integer, status text, organiser_id uuid, coordinator_id uuid references users(id));
create table "Venue Booking Requests"(request_id bigint generated always as identity primary key, event_id bigint, venue_id bigint, venue_staff_id uuid, coordinator_id uuid, status text);
create table "Equipment Request"(request_id bigint generated always as identity primary key, event_id bigint, status text, created_by uuid);
create table "Equipment Request Item"(request_id bigint, equipment_id text, requested_quantity integer, technical_requirements text);
`);
await db.exec(await sql('sprint2_registration_notifications.sql'));
await db.exec(await sql('coordinator_reassignment.sql'));
await db.exec(await sql('coordinator_reassignment.sql')); // migration is rerunnable
const ids = Object.fromEntries(['lead', 'c1', 'c2', 'c3', 'organiser'].map((key, i) => [key, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]));
for (const [key, role] of Object.entries({ lead: ' Event Coordinator Lead ', c1: 'Event Coordinator', c2: 'event coordinator', c3: ' Event Coordinator ', organiser: 'Event Organiser' })) {
  await db.query('insert into users(id,role) values($1,$2)', [ids[key], role]);
}
const q = (text, values = []) => db.query(text, values);
const one = async (text, values = []) => (await q(text, values)).rows[0];
await q(`insert into "Event Details"(id,event_name,status,organiser_id,coordinator_id)
  values(99,'Reassigned Gala','Confirmed',$1,$2)`, [ids.organiser, ids.c1]);
await q(`insert into "Venue Booking Requests"(event_id,venue_id,venue_staff_id,coordinator_id,status)
  values(99,10,$2,$1,'Alternative Offered')`, [ids.c2, ids.v]);
await db.exec(await sql('sync_venue_booking_coordinators.sql'));
assert.equal((await one('select coordinator_id from "Venue Booking Requests" where event_id=99')).coordinator_id, ids.c1);
assert.equal((await one('select previous_coordinator_id from venue_booking_coordinator_id_backup where request_id=(select request_id from "Venue Booking Requests" where event_id=99)')).previous_coordinator_id, ids.c2);
const actor = key => q("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-actor-id': ids[key] })]);
const assign = (id, target, expected, lead = ids.lead) => one('select * from assign_event_coordinator($1,$2,$3,$4)', [id, target, expected, lead]);
const notes = async () => (await q('select recipient_id,description from notifications order by id')).rows;
const clear = () => db.exec('delete from notifications');
const counts = async () => (await q("select id,active_event_count::int as n from users where id <> $1 and id <> $2 order by id", [ids.lead, ids.organiser])).rows.map(r => r.n);
const blocked = async (fn, code) => {
  await assert.rejects(fn, error => { assert.equal(error.code, code, error.message); return true; });
};
await actor('lead');
await q(`insert into "Event Details"(id,event_name,status,organiser_id) values(1,'Gala','Submitted',$1)`, [ids.organiser]);
await q(`insert into "Venue Booking Requests"(event_id,venue_id,venue_staff_id,coordinator_id,status)
  values(1,9,$2,$1,'Alternative Offered')`, [ids.c2, ids.v]);
await clear();

// Initial assignment is atomic, sets Assigned, and notifies only the incoming coordinator.
assert.equal((await assign(1, ids.c1, null)).status, 'Assigned');
assert.deepEqual(await counts(), [1, 0, 0]);
assert.equal((await one('select coordinator_id from "Venue Booking Requests" where event_id=1')).coordinator_id, ids.c1);
assert.deepEqual((await notes()).map(r => r.recipient_id), [ids.c1]);
await clear();

// Every active lifecycle status is reassignable; status is preserved and both recipients are notified.
let current = ids.c1;
for (const status of ['Assigned', 'Under review', 'Approved', 'Planning', 'Confirmed', 'Submitted']) {
  await q('update "Event Details" set status=$1 where id=1', [status]);
  await clear();
  const next = current === ids.c1 ? ids.c2 : ids.c1;
  const result = await assign(1, next, current);
  assert.equal(result.status, status);
  assert.equal(result.coordinator_id, next);
  assert.equal((await one('select coordinator_id from "Venue Booking Requests" where event_id=1')).coordinator_id, next);
  assert.deepEqual(await counts(), next === ids.c1 ? [1, 0, 0] : [0, 1, 0]);
  const messages = await notes();
  assert.deepEqual(messages.map(r => r.recipient_id).sort(), [current, next].sort());
  assert.match(messages.find(r => r.recipient_id === current).description, /Gala: your event has been reassigned/);
  assert.match(messages.find(r => r.recipient_id === next).description, /Gala: coordinator assigned/);
  current = next;
}

// No arbitrary reassignment limit, and old/new counts do not accumulate drift.
for (let i = 0; i < 25; i++) {
  const next = current === ids.c2 ? ids.c3 : ids.c2;
  await clear();
  await assign(1, next, current);
  assert.equal((await notes()).length, 2);
  current = next;
}
assert.deepEqual(await counts(), current === ids.c2 ? [0, 1, 0] : [0, 0, 1]);
await clear();
await assign(1, current, current);
assert.deepEqual(await notes(), []); // no-op cannot duplicate notifications

// Stale browser state and invalid targets must not mutate anything.
await blocked(() => assign(1, ids.c1, null), '55000');
await blocked(() => assign(1, ids.organiser, current), '22023');
await blocked(() => assign(1, null, current), '22023');
await blocked(() => assign(999, ids.c1, current), 'P0002');
assert.deepEqual(await notes(), []);
assert.equal((await one('select coordinator_id from "Event Details" where id=1')).coordinator_id, current);

// A second stale writer cannot overwrite the winner.
const winner = current === ids.c1 ? ids.c2 : ids.c1;
await assign(1, winner, current);
await blocked(() => assign(1, ids.c3, current), '55000');
current = winner;

for (const status of ['Draft', 'Complete', 'Completed', ' Cancelled ', 'Rejected']) {
  await q('update "Event Details" set status=$1 where id=1', [status]);
  await clear();
  await blocked(() => assign(1, ids.c3, current), '55000');
  assert.deepEqual(await notes(), []);
}
await q('update "Event Details" set status=$1 where id=1', ['Confirmed']);
await clear();

// Server actor identity and role are checked, and direct browser RPC execution is revoked.
await actor('c1');
await blocked(() => assign(1, ids.c3, current), '42501');
await blocked(() => assign(1, ids.c3, current, ids.c1), '42501');
await actor('lead');
for (const role of ['anon', 'authenticated']) {
  const permission = await one(`select has_function_privilege($1, 'public.assign_event_coordinator(bigint,uuid,uuid,uuid)', 'EXECUTE') as allowed`, [role]);
  assert.equal(permission.allowed, false);
}
assert.equal((await one(`select has_function_privilege('service_role', 'public.assign_event_coordinator(bigint,uuid,uuid,uuid)', 'EXECUTE') as allowed`)).allowed, true);

// Even if the first notification was written, a later failure rolls back the entire reassignment.
await db.exec(`create function reject_assignment_notification() returns trigger language plpgsql as $$
begin if new.description like '%coordinator assigned%' then raise exception 'Simulated notification failure'; end if; return new; end $$;
create trigger reject_assignment_notification before insert on notifications for each row execute function reject_assignment_notification();`);
const beforeCounts = await counts();
await blocked(() => assign(1, ids.c3, current), 'P0001');
assert.equal((await one('select coordinator_id from "Event Details" where id=1')).coordinator_id, current);
assert.deepEqual(await counts(), beforeCounts);
assert.deepEqual(await notes(), []);
await db.exec('drop trigger reject_assignment_notification on notifications; drop function reject_assignment_notification();');

// Workload counts reflect other active events but exclude inactive events and stale cached values.
await q(`insert into "Event Details"(id,event_name,status,coordinator_id) values
  (2,'Other active','Planning',$1),(3,'Old event','Completed',$1),(4,'Draft event','Draft',$1)`, [ids.c3]);
await db.exec('update users set active_event_count=99');
await assign(1, ids.c3, current);
assert.equal((await one('select active_event_count::int as n from users where id=$1', [ids.c3])).n, 2);
assert.equal((await one('select active_event_count::int as n from users where id=$1', [current])).n, 0);

// Rollback removes only new objects; completed assignments and notifications survive.
const notificationCount = (await notes()).length;
await db.exec(await sql('rollback_coordinator_reassignment.sql'));
assert.equal((await one('select coordinator_id from "Event Details" where id=1')).coordinator_id, ids.c3);
assert.equal((await notes()).length, notificationCount);
assert.equal((await one("select to_regprocedure('assign_event_coordinator(bigint,uuid,uuid,uuid)') as fn")).fn, null);
await db.exec(await sql('coordinator_reassignment.sql'));
await db.close();
console.log('Coordinator assignment SQL checks passed: statuses, repeat reassignment, both notifications, workloads, permissions, stale writes, atomic rollback and migration rollback.');
