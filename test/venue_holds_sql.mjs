// Isolated PostgreSQL checks for venue_holds.sql (stories 22.1 and 22.2).
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
-- Matches the live table: schedule and requirements live on "Event Details".
create table "Venue Booking Requests"(request_id bigint generated always as identity primary key,
  created_at timestamptz not null default now(), event_id bigint unique, venue_id bigint not null,
  venue_staff_id uuid, coordinator_id uuid not null, status text not null,
  rejection_reason text, alternative_venue text, decided_at timestamptz);
create table "Venues"(venue_id bigint primary key, name text, setup_time integer, teardown_time integer);
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
await db.exec(await sql('venue_holds.sql'));
await db.exec(await sql('venue_holds.sql')); // rerunnable; pg_cron is absent here, so only a notice is raised

const ids = Object.fromEntries(['c', 'd', 'o', 'v', 'w'].map((key, i) => [key, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]));
const roles = { c: 'Event Coordinator', d: 'Event Coordinator', o: 'Event Organiser', v: 'Venue Staff', w: 'Venue Staff' };
for (const [key, role] of Object.entries(roles)) await db.query('insert into users values($1,$2,$3)', [ids[key], `${role} ${key}`, role]);

const q = (text, params = []) => db.query(text, params);
const one = async (text, params = []) => (await q(text, params)).rows[0];
const clear = () => db.exec('delete from notifications');
const actor = (key) => q("select set_config('request.headers', $1, false)", [JSON.stringify({ 'x-actor-id': ids[key] })]);
const notices = async () => (await q('select recipient_id, description, record_type, record_id from notifications order by id')).rows;
const rejects = async (promise, code, pattern) => {
  try { await promise; assert.fail('Expected database rejection'); } catch (e) {
    assert.equal(e.code, code, e.message);
    if (pattern) assert.match(e.message, pattern);
  }
};
const booking = (requestId) => one('select * from "Venue Booking Requests" where request_id=$1', [requestId]);
const addEvent = (id, name, day, start, end, extra = {}) => q(
  `insert into "Event Details"(id,event_name,event_date,event_end_date,start_time,end_time,status,organiser_id,coordinator_id)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [id, name, day, extra.endDay ?? day, start, end, extra.status ?? 'Approved', ids.o, extra.coordinator ?? ids.c],
);
const addBooking = (eventId, venueId, status = 'Pending', staff = ids.v) => one(
  `insert into "Venue Booking Requests"(event_id,venue_id,venue_staff_id,coordinator_id,status) values($1,$2,$3,$4,$5) returning request_id`,
  [eventId, venueId, staff, ids.c, status],
).then((r) => r.request_id);
const hold = (requestId, expires, staff = ids.v) => one('select * from place_venue_hold($1,$2,$3)', [requestId, staff, expires]);
const removeHold = (requestId, staff = ids.v) => one('select * from remove_venue_hold($1,$2)', [requestId, staff]);
const sweep = () => one('select process_venue_holds() as result').then((r) => r.result);
const inDays = (days) => one(`select now() + make_interval(days => $1::int) as at`, [days]).then((r) => r.at);
const inHours = (hours) => one(`select now() + make_interval(hours => $1::int) as at`, [hours]).then((r) => r.at);

await q(`insert into "Venues" values (1,'Hall A',60,30),(2,'Hall B',0,0)`);
// Hall A, 2099-03-01 (SGT). Hall A has 60 minutes of setup and 30 of teardown.
await addEvent(1, 'Gala', '2099-03-01', '10:00', '12:00');
await addEvent(2, 'Launch', '2099-03-01', '12:30', '14:00'); // its setup (11:30) overlaps the Gala
await addEvent(3, 'Dinner', '2099-03-01', '18:00', '20:00'); // clear of both, even with buffers
await addEvent(4, 'Retreat', '2099-02-28', '09:00', '10:30', { endDay: '2099-03-02' }); // multi-day, spans the Gala
await addEvent(5, 'No times', '2099-03-05', null, null);
await actor('v');

// ---- 22.1: placing a hold --------------------------------------------------------------
const gala = await addBooking(1, 1);
await clear();
await rejects(hold(999, await inDays(2)), 'P0002');
await rejects(hold(gala, await inDays(2), ids.w), '42501');
await rejects(hold(gala, '2000-01-01T00:00:00Z'), '22023', /future/);
await rejects(hold(gala, null), '22023', /future/);
await rejects(hold(gala, '2099-03-01T02:30:00Z'), '22023', /before the event starts/); // 10:30 SGT, after the 10:00 start
const noTimes = await addBooking(5, 2);
await rejects(hold(noTimes, await inDays(2)), '22023', /date, start time and end time/);
assert.equal((await booking(gala)).status, 'Pending', 'Rejected holds change nothing');
assert.deepEqual(await notices(), []);

const galaExpiry = await inDays(3);
const held = await hold(gala, galaExpiry);
assert.equal(held.status, 'On Hold');
assert.equal(held.hold_expires_at.toISOString(), galaExpiry.toISOString());
assert.equal(held.hold_placed_by, ids.v);
assert.ok(held.hold_placed_at);
assert.equal(held.hold_reminder_sent_at, null, 'A hold longer than the lead time is reminded later');
let sent = await notices();
assert.equal(sent.length, 1, 'Only the coordinator is told; the staff member who placed the hold is the actor');
assert.equal(sent[0].recipient_id, ids.c);
assert.deepEqual([sent[0].record_type, sent[0].record_id], ['venue_booking', String(gala)]);
assert.match(sent[0].description, /^Gala: Hall A is on hold for your event until \d{2} \w{3} \d{4}, \d{2}:\d{2} SGT\.$/);
await rejects(hold(gala, await inDays(2)), '55000', /only pending/i);
await addEvent(11, 'Already approved', '2099-08-01', '09:00', '10:00');
const approved = await addBooking(11, 2, 'Approved');
await rejects(hold(approved, await inDays(2)), '55000', /This request is approved/);

// A held venue is unavailable to other requests for overlapping times, including setup/teardown.
const launch = await addBooking(2, 1);
await rejects(hold(launch, await inDays(2)), '23P01', /already booked or on hold/);
const retreat = await addBooking(4, 1);
await rejects(hold(retreat, '2099-02-27T00:00:00Z'), '23P01', /already booked or on hold/);
const dinner = await hold(await addBooking(3, 1), await inDays(2));
assert.equal(dinner.status, 'On Hold', 'A non-overlapping hold on the same venue is allowed');
await addEvent(7, 'Gala in Hall B', '2099-03-01', '10:00', '12:00');
const hallB = await addBooking(7, 2);
assert.equal((await hold(hallB, await inDays(2))).status, 'On Hold', 'Another venue at the same time is unaffected');

// A confirmed booking blocks a hold too; a pending request does not.
await addEvent(8, 'Briefing', '2099-04-01', '09:00', '10:00');
await addEvent(9, 'Briefing overlap', '2099-04-01', '09:30', '10:30');
const briefing = await addBooking(8, 2);
const overlap = await addBooking(9, 2, 'Approved');
await rejects(hold(briefing, await inDays(2)), '23P01');
await q(`update "Venue Booking Requests" set status='Pending' where request_id=$1`, [overlap]);
assert.equal((await hold(briefing, await inDays(2))).status, 'On Hold');

// A hold shorter than the 24-hour lead time is announced once, when it is placed.
await addEvent(10, 'Short hold', '2099-05-01', '09:00', '10:00');
const shortHold = await hold(await addBooking(10, 2), await inHours(5));
assert.ok(shortHold.hold_reminder_sent_at, 'No separate reminder for a hold already inside the lead time');

// ---- 22.1: removing a hold ---------------------------------------------------------------
await clear();
await rejects(removeHold(gala, ids.w), '42501');
await rejects(removeHold(launch), '55000', /not on hold/);
const released = await removeHold(gala);
assert.equal(released.status, 'Pending');
assert.deepEqual([released.hold_expires_at, released.hold_placed_by, released.hold_placed_at, released.hold_reminder_sent_at], [null, null, null, null]);
sent = await notices();
assert.equal(sent.length, 1);
assert.equal(sent[0].recipient_id, ids.c);
assert.match(sent[0].description, /^Gala: the hold on Hall A \(until .+ SGT\) was removed\. Your venue request is pending again\.$/);
assert.equal((await hold(launch, await inDays(2))).status, 'On Hold', 'Removing the Gala hold frees the venue for the Launch');
await removeHold(launch);
await hold(gala, galaExpiry);

// ---- 22.2: reminders and expiry ------------------------------------------------------------
await clear();
assert.deepEqual(await sweep(), { reminded: 0, expired: 0 }, 'Nothing is due yet');
await q(`update "Venue Booking Requests" set hold_expires_at = now() + interval '23 hours' where request_id=$1`, [gala]);
assert.deepEqual(await sweep(), { reminded: 1, expired: 0 });
sent = await notices();
assert.equal(sent.length, 1);
assert.equal(sent[0].recipient_id, ids.c);
assert.match(sent[0].description, /^Gala: your hold on Hall A expires on .+ SGT\. Finish your arrangements before then\.$/);
assert.deepEqual(await sweep(), { reminded: 0, expired: 0 }, 'A hold is reminded once');

// The event's current coordinator is told, even if the request was made by someone else.
await q('update "Event Details" set coordinator_id=$1 where id=1', [ids.d]);
await q(`update "Venue Booking Requests" set hold_expires_at = now() - interval '1 minute' where request_id=$1`, [gala]);
await clear();
// Until the sweep runs, an expired hold already stops blocking the venue.
assert.equal((await hold(launch, await inDays(2))).status, 'On Hold');
await removeHold(launch);
await rejects(removeHold(gala), '55000', /already expired/);
await clear();
assert.deepEqual(await sweep(), { reminded: 0, expired: 1 }, 'An overdue hold expires without a late reminder');
assert.equal((await booking(gala)).status, 'Expired');
sent = await notices();
assert.equal(sent.length, 1);
assert.equal(sent[0].recipient_id, ids.d);
assert.match(sent[0].description, /^Gala: your hold on Hall A expired on .+ SGT\. Submit a new venue request to continue\.$/);
assert.deepEqual(await sweep(), { reminded: 0, expired: 0 }, 'A hold expires once');
await rejects(hold(gala, await inDays(2)), '55000', /This request is expired/);

// An expired hold is history: the coordinator can submit a new request for the same venue,
// while a second active one (Pending or On Hold) is still refused.
const renewed = await addBooking(1, 2);
await rejects(addBooking(1, 2), '23505');
await q(`update "Venue Booking Requests" set status='On Hold', hold_expires_at=now() + interval '2 days' where request_id=$1`, [renewed]);
await rejects(addBooking(1, 2), '23505');
await q('delete from "Venue Booking Requests" where request_id=$1', [renewed]);

// ---- Significant changes leave expired holds alone and release active ones ---------------------
await addEvent(20, 'Expo', '2099-06-01', '09:00', '17:00', { status: 'Confirmed' });
const expo = await addBooking(20, 2);
await hold(expo, await inDays(2));
await q(`update "Event Details" set start_time='10:00' where id=20`);
assert.equal((await booking(expo)).status, 'Pending', 'A significant change releases an active hold for re-checking');
await hold(expo, await inDays(2));
await q(`update "Venue Booking Requests" set hold_expires_at = now() - interval '1 minute' where request_id=$1`, [expo]);
await sweep();
await q(`update "Event Details" set start_time='11:00' where id=20`);
assert.equal((await booking(expo)).status, 'Expired', 'A significant change does not revive an expired hold');
const change = await one(`insert into event_change_requests(event_id,organiser_id,coordinator_id,request_text,review_status,
  processing_status,affects_venue,affects_equipment) values(20,$1,$2,'Move it','Approved','Awaiting processing',true,false) returning id`, [ids.o, ids.c]);
const processed = await one('select process_event_change_request($1,$2) as result', [change.id, ids.c]).then((r) => r.result);
assert.equal(processed.venue_requests.length, 0, 'Processing does not replace an expired hold');
assert.equal((await booking(expo)).status, 'Expired');

// ---- Atomicity and permissions -------------------------------------------------------------
await addEvent(30, 'Rollback', '2099-07-01', '09:00', '10:00');
const rollback = await addBooking(30, 2);
await db.exec(`create function fail_hold_notice() returns trigger language plpgsql as $$ begin raise exception 'notification failed'; end $$;
create trigger fail_hold_notice before insert on notifications for each row execute function fail_hold_notice();`);
await assert.rejects(hold(rollback, await inDays(2)), /notification failed/);
assert.equal((await booking(rollback)).status, 'Pending', 'A failed notice rolls the hold back');
await db.exec('drop trigger fail_hold_notice on notifications');

const can = (role, signature) => one('select has_function_privilege($1, $2, $3) as ok', [role, signature, 'execute']).then((r) => r.ok);
for (const signature of ['place_venue_hold(bigint,uuid,timestamptz)', 'remove_venue_hold(bigint,uuid)']) {
  assert.equal(await can('service_role', signature), true, `${signature}: the backend may call it`);
  for (const role of ['anon', 'authenticated']) assert.equal(await can(role, signature), false, `${signature}: browsers may not`);
}
for (const signature of ['process_venue_holds()', 'venue_hold_notice(bigint,text)']) {
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await can(role, signature), false, `${signature} is internal`);
}

console.log('PASS: hold rules, overlap and buffer conflicts, multi-day events, removal, reminders, expiry, current-coordinator notices, new requests after expiry, significant changes, rollback, permissions, rerunnable migration.');
await db.close();
