// Isolated PostgreSQL checks for venue_booking_statuses.sql.
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
create table users(id uuid primary key, role text);
create table "Event Details"(id bigint primary key, event_name text, event_date date, event_end_date date,
  start_time time, end_time time, status text, organiser_id uuid, coordinator_id uuid, venue_id bigint);
create table "Venue Booking Requests"(request_id bigint primary key, event_id bigint, venue_id bigint,
  venue_staff_id uuid, coordinator_id uuid, status text not null);
create table "Equipment Request"(request_id bigint generated always as identity primary key, event_id bigint,
  status text, created_by uuid, assigned_staff_id uuid);
`);
const read = (name) => readFile(new URL(`../backend/sql/${name}`, import.meta.url), 'utf8');
await db.exec(await read('sprint2_registration_notifications.sql'));
const sql = await read('venue_booking_statuses.sql');

const keys = ['o', 'c', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
const ids = Object.fromEntries(keys.map((key, i) => [key, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]));
for (const key of keys) {
  const role = key === 'o' ? 'Event Organiser' : key === 'c' ? 'Event Coordinator' : 'Venue Staff';
  await db.query('insert into users values ($1, $2)', [ids[key], role]);
}
await db.query("select set_config('request.headers', $1, false)", [JSON.stringify({ 'x-actor-id': ids.o })]);
await db.query(`insert into "Event Details"(id, event_name, status, organiser_id, coordinator_id) values
  (1, 'Gala', 'Confirmed', $1, $2), (2, 'Fair', 'Confirmed', $1, $2)`, [ids.o, ids.c]);
// Event 1 has a request in every status; event 2 has one Approved request and one in the wrong case.
const bookings = [
  [1, 1, 'v1', 'Pending'], [2, 1, 'v2', 'On Hold'], [3, 1, 'v3', 'Approved'], [4, 1, 'v4', 'Alternative Offered'],
  [5, 1, 'v5', 'Rejected'], [6, 1, 'v6', 'Superseded'], [7, 1, 'v7', 'Expired'], [8, 2, 'v1', 'Approved'],
  [9, 2, 'v2', 'approved'],
];
for (const [requestId, eventId, staff, status] of bookings) {
  await db.query(`insert into "Venue Booking Requests" values ($1, $2, $1, $3, $4, $5)`,
    [requestId, eventId, ids[staff], ids.c, status]);
}
const statuses = async () => Object.fromEntries((await db.query(
  `select request_id, status from "Venue Booking Requests" order by request_id`)).rows
  .map((r) => [Number(r.request_id), r.status]));
const staffFor = async (eventId) => (await db.query('select event_notification_staff($1) as s', [eventId])).rows[0].s.sort();
const hasConstraint = async () => (await db.query(
  `select 1 from pg_constraint where conname = 'venue_booking_requests_status_check'`)).rows.length === 1;
const expected = (list) => list.map((k) => ids[k]).sort();

// An unknown status blocks the whole migration and names the request.
await assert.rejects(db.exec(sql), /Not applied: unknown status on venue booking requests \{9\}/);
await db.exec('rollback'); // end the aborted transaction, as closing the SQL editor session would
assert.equal(await hasConstraint(), false);

await db.exec(`update "Venue Booking Requests" set status = 'Approved' where request_id = 9`);
await db.exec(sql);
await db.exec(sql); // rerunnable
assert.equal(await hasConstraint(), true);

// Every listed status is accepted; anything else is refused by the named constraint.
for (const status of ['Pending', 'On Hold', 'Approved', 'Expired', 'Rejected', 'Alternative Offered', 'Superseded', 'Cancelled']) {
  await db.query(`update "Venue Booking Requests" set status = $1 where request_id = 9`, [status]);
}
for (const status of ['approved', 'Confirmed', '']) {
  await assert.rejects(db.query(`update "Venue Booking Requests" set status = $1 where request_id = 9`, [status]),
    (e) => e.code === '23514' && /venue_booking_requests_status_check/.test(e.message));
}
await db.exec(`update "Venue Booking Requests" set status = 'Rejected' where request_id = 9`);

// Staff on Superseded or Expired requests are no longer notified; Alternative Offered still is.
assert.deepEqual(await staffFor(1), expected(['c', 'v1', 'v2', 'v3', 'v4']));

// Cancelling the event cancels its open requests only, after notifying their staff.
await db.exec('delete from notifications');
await db.exec(`update "Event Details" set status = 'Cancelled' where id = 1`);
assert.deepEqual(await statuses(), {
  1: 'Cancelled', 2: 'Cancelled', 3: 'Cancelled', 4: 'Cancelled',
  5: 'Rejected', 6: 'Superseded', 7: 'Expired', 8: 'Approved', 9: 'Rejected',
});
const notified = (await db.query('select recipient_id, description from notifications')).rows;
assert.deepEqual(notified.map((n) => n.recipient_id).sort(), expected(['c', 'v1', 'v2', 'v3', 'v4']));
assert.ok(notified.every((n) => n.description === 'Gala: cancelled.'));

// Reopening the event leaves its requests cancelled; other status changes cancel nothing.
await db.exec(`update "Event Details" set status = 'Confirmed' where id = 1`);
await db.exec(`update "Event Details" set status = 'Completed' where id = 2`);
assert.equal((await statuses())[1], 'Cancelled');
assert.equal((await statuses())[8], 'Approved');

// The documented rollback removes the constraint and trigger and restores the old recipients.
const rollback = sql.slice(sql.indexOf('-- Rollback:'), sql.indexOf('\nbegin;')).split('\n')
  .filter((line) => line.startsWith('--   ')).map((line) => line.slice(5)).join('\n');
await db.exec(rollback);
assert.equal(await hasConstraint(), false);
await db.exec(`update "Event Details" set status = 'Cancelled' where id = 2`);
assert.equal((await statuses())[8], 'Approved');
assert.deepEqual(await staffFor(1), expected(['c', 'v6', 'v7']));
await db.exec(sql); // and the migration applies again after a rollback
assert.equal(await hasConstraint(), true);
console.log('Venue booking status SQL checks passed: status guard, constraint, event cancellation, recipients, rerun and rollback.');
await db.close();
