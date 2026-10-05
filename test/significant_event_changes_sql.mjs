// Isolated PostgreSQL checks for significant_event_changes.sql (stories 10.2 and 44.4).
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
  start_datetime timestamptz not null, end_datetime timestamptz not null,
  accessibility_required bigint not null default 0, layout_required text, facilities_required text[],
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

const ids = Object.fromEntries(['a', 'c', 'd', 'o', 'v', 't'].map((key, i) => [key, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]));
const roles = { a: 'Attendee', c: 'Event Coordinator', d: 'Event Coordinator', o: 'Event Organiser', v: 'Venue Staff', t: 'Technical Support Staff' };
for (const [key, role] of Object.entries(roles)) await db.query('insert into users values($1,$2,$3)', [ids[key], `${role} ${key}`, role]);

const q = (text, params = []) => db.query(text, params);
const one = async (text, params = []) => (await q(text, params)).rows[0];
const clear = () => db.exec('delete from notifications');
const actor = (key) => q("select set_config('request.headers', $1, false)", [JSON.stringify({ 'x-actor-id': ids[key] })]);
const recipients = async () => (await q('select recipient_id from notifications order by id')).rows.map((r) => r.recipient_id);
const blocked = async (text, params, code) => {
  try { await q(text, params); assert.fail('Expected database rejection'); } catch (e) { assert.equal(e.code, code, e.message); }
};
const log = (eventId) => q('select * from event_change_log where event_id=$1 order by id', [eventId]).then((r) => r.rows);
const venueStatus = (requestId) => one('select status from "Venue Booking Requests" where request_id=$1', [requestId]).then((r) => r.status);
const equipmentStatus = (requestId) => one('select status from "Equipment Request" where request_id=$1', [requestId]).then((r) => r.status);
const processChange = (requestId, coordinatorId) => one('select process_event_change_request($1,$2) as result', [requestId, coordinatorId]).then((r) => r.result);
const submitChange = (eventId, summary, proposal) => one(
  'select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [eventId, ids.o, summary, proposal.event_name, proposal.event_type, proposal.event_date, proposal.event_end_date,
    proposal.event_capacity, proposal.description, proposal.start_time, proposal.end_time],
);
const review = (requestId, decision, comments = null) => one('select * from review_event_change_request($1,$2,$3,$4)', [requestId, ids.c, decision, comments]);
const addEvent = (id, status, extra = '') => q(`insert into "Event Details"(id,event_name,event_type,description,event_date,event_end_date,
  start_time,end_time,event_capacity,status,organiser_id,coordinator_id${extra ? ',layout_required' : ''})
  values($1,'Gala','Workshop','Plan','2099-03-01','2099-03-01','10:00','12:00',50,$2,$3,$4${extra ? ',$5' : ''})`,
  extra ? [id, status, ids.o, ids.c, extra] : [id, status, ids.o, ids.c]);
const addBooking = (eventId, status) => one(`insert into "Venue Booking Requests"(event_id,venue_id,venue_staff_id,coordinator_id,status,
  start_datetime,end_datetime,accessibility_required,layout_required,facilities_required)
  values($1,7,$2,$3,$4,'2099-03-01 10:00+00','2099-03-01 12:00+00',1,'Theatre','{Projector}') returning request_id`,
  [eventId, ids.v, ids.c, status]).then((r) => r.request_id);
const addEquipment = async (eventId, status) => {
  const { request_id } = await one('insert into "Equipment Request"(event_id,status,created_by) values($1,$2,$3) returning request_id', [eventId, status, ids.c]);
  await q(`insert into "Equipment Request Item"(request_id,equipment_id,requested_quantity,technical_requirements)
    values($1,'MIC',2,'Wireless'),($1,'OLD',0,'')`, [request_id]);
  return request_id;
};
const proposalFrom = (overrides = {}) => ({
  event_name: 'Gala', event_type: 'Workshop', event_date: '2099-03-01', event_end_date: '2099-03-01',
  event_capacity: 50, description: 'Plan', start_time: '10:00', end_time: '12:00', ...overrides,
});

// ---- schema -----------------------------------------------------------------------------
assert.equal((await q(`select 1 from pg_constraint where conrelid='"Venue Booking Requests"'::regclass and contype='u'`)).rows.length, 0,
  'The full UNIQUE(event_id) constraint is replaced');
assert.ok(await one(`select 1 as ok from pg_indexes where indexname='Venue Booking Requests_live_event_id_key'`),
  'A partial one-live-booking-per-event index replaces it');
assert.deepEqual(await one(`select has_table_privilege('authenticated','event_change_log','select') as read,
  has_function_privilege('authenticated','process_event_change_request(bigint,uuid)','execute') as process,
  has_function_privilege('service_role','process_event_change_request(bigint,uuid)','execute') as service`),
{ read: false, process: false, service: true });

// ---- 10.2: drafts are not tracked ------------------------------------------------------
await addEvent(1, 'Draft');
await q(`update "Event Details" set start_time='14:00' where id=1`);
assert.equal((await log(1)).length, 0, 'Draft edits are not change-tracked');

// ---- 10.2: ordinary vs significant direct edits -----------------------------------------
await addEvent(2, 'Confirmed');
const booking2 = await addBooking(2, 'Approved');
const equipment2 = await addEquipment(2, 'Approved');
await blocked(`insert into "Venue Booking Requests"(event_id,venue_id,coordinator_id,status,start_datetime,end_datetime)
  values(2,8,$1,'Pending',now(),now())`, [ids.c], '23505');
await actor('c');
await clear();
await q(`update "Event Details" set event_name='Gala Night', description='New plan' where id=2`);
let [entry] = await log(2);
assert.equal(entry.change_type, 'Ordinary');
assert.deepEqual(entry.changed_fields, ['event_name', 'description']);
assert.deepEqual(entry.significant_fields, []);
assert.deepEqual(entry.previous_values, { event_name: 'Gala', description: 'Plan' });
assert.deepEqual(entry.new_values, { event_name: 'Gala Night', description: 'New plan' });
assert.equal(entry.changed_by, ids.c);
assert.equal(entry.event_status, 'Confirmed');
assert.equal(await venueStatus(booking2), 'Approved', 'Ordinary edits leave venue bookings alone');
assert.equal(await equipmentStatus(equipment2), 'Approved', 'Ordinary edits leave equipment requests alone');
assert.deepEqual(await recipients(), [], 'Ordinary edits raise no arrangement alerts');

await q(`update "Event Details" set start_time='14:00', end_time='16:00' where id=2`);
entry = (await log(2))[1];
assert.equal(entry.change_type, 'Significant');
assert.deepEqual(entry.changed_fields, ['start_time', 'end_time']);
assert.deepEqual(entry.significant_fields, ['start_time', 'end_time']);
assert.equal(entry.affects_venue, true);
assert.equal(entry.affects_equipment, true);
assert.deepEqual(entry.reset_venue_request_ids.map(Number), [booking2]);
assert.deepEqual(entry.reset_equipment_request_ids.map(Number), [equipment2]);
assert.equal(entry.change_request_id, null);
assert.equal(await venueStatus(booking2), 'Pending');
assert.equal(await equipmentStatus(equipment2), 'Pending');
const alerted = await recipients();
assert.ok(alerted.includes(ids.v) && alerted.includes(ids.t), 'Venue staff and technical support are alerted to re-review');
assert.equal((await one('select start_time from "Event Details" where id=2')).start_time, '14:00:00', 'The updated details are saved');

await clear();
await q(`update "Event Details" set start_time='15:00', end_time='17:00' where id=2`);
entry = (await log(2))[2];
assert.deepEqual(entry.reset_venue_request_ids, [], 'Already-pending requests are not reset twice');
assert.deepEqual(entry.reset_equipment_request_ids, []);

// Capacity affects the venue only; a single-day blank end date equals its start date.
await addEvent(3, 'Planning');
const booking3 = await addBooking(3, 'Approved');
const equipment3 = await addEquipment(3, 'Submitted');
await q(`update "Event Details" set event_end_date=null where id=3`);
assert.equal((await log(3)).length, 0, 'Clearing a single-day end date is not a change');
await q(`update "Event Details" set event_capacity=200 where id=3`);
entry = (await log(3))[0];
assert.deepEqual(entry.significant_fields, ['event_capacity']);
assert.equal(entry.affects_venue, true);
assert.equal(entry.affects_equipment, false);
assert.equal(await venueStatus(booking3), 'Pending');
assert.equal(await equipmentStatus(equipment3), 'Submitted', 'Capacity does not reopen equipment requests');
await q(`update "Event Details" set layout_required='Banquet' where id=3`);
assert.deepEqual((await log(3))[1].significant_fields, ['layout_required']);
await q(`update "Event Details" set status='Confirmed' where id=3`);
assert.equal((await log(3)).length, 2, 'Status-only updates are not event detail changes');

// Cancelled, rejected and superseded requests are never reopened.
await addEvent(4, 'Confirmed');
const rejected4 = await addBooking(4, 'Rejected');
await q(`update "Event Details" set event_date='2099-04-01', event_end_date='2099-04-01' where id=4`);
assert.equal(await venueStatus(rejected4), 'Rejected');
assert.deepEqual((await log(4))[0].significant_fields, ['event_date', 'event_end_date']);

// ---- 44.4: change request approval records the impact -----------------------------------
await addEvent(10, 'Confirmed');
const booking10 = await addBooking(10, 'Approved');
const equipment10 = await addEquipment(10, 'Updated');
await actor('o');
const significantRequest = await submitChange(10, 'Move to the afternoon', proposalFrom({ start_time: '14:00', end_time: '17:00' }));
assert.equal(significantRequest.processing_status, null, 'Pending requests are not yet processable');
await blocked('select process_event_change_request($1,$2)', [significantRequest.id, ids.c], '55000');
await actor('c');
const approved = await review(significantRequest.id, 'Approved');
assert.equal(approved.change_type, 'Significant');
assert.deepEqual(approved.significant_fields, ['start_time', 'end_time']);
assert.equal(approved.affects_venue, true);
assert.equal(approved.affects_equipment, true);
assert.equal(approved.processing_status, 'Awaiting processing');
entry = (await log(10))[0];
assert.equal(Number(entry.change_request_id), Number(significantRequest.id), 'The change log links the approved request');
assert.equal(entry.changed_by, ids.c);
assert.equal(await venueStatus(booking10), 'Pending', 'Approval reopens affected arrangements (10.2)');
assert.equal(await equipmentStatus(equipment10), 'Pending');
assert.equal(await one(`select current_setting('app.event_change_request_id', true) as s`).then((r) => r.s || ''), '',
  'The request link does not leak into later statements');

// Processing guards.
await blocked('select process_event_change_request($1,$2)', [significantRequest.id, ids.d], '42501');
await blocked('select process_event_change_request($1,$2)', [9999, ids.c], 'P0002');

// ---- 44.4: processing initiates linked replacement requests -----------------------------
await clear();
const result = await processChange(significantRequest.id, ids.c);
assert.equal(result.change_request.processing_status, 'Processed');
assert.equal(result.change_request.processed_by, ids.c);
assert.ok(result.change_request.processed_at);
assert.equal(result.venue_requests.length, 1);
assert.equal(result.equipment_requests.length, 1);
const newBookingId = result.venue_requests[0].request_id;
const newEquipmentId = result.equipment_requests[0].request_id;
assert.equal(result.venue_requests[0].previous_request_id, booking10);
assert.equal(result.equipment_requests[0].previous_request_id, equipment10);
assert.match(result.change_request.processing_summary, new RegExp(`Venue booking #${booking10} replaced by #${newBookingId}\\.`));
assert.match(result.change_request.processing_summary, new RegExp(`Equipment request #${equipment10} replaced by #${newEquipmentId}\\.`));

assert.equal(await venueStatus(booking10), 'Superseded');
const newBooking = await one('select * from "Venue Booking Requests" where request_id=$1', [newBookingId]);
assert.equal(newBooking.status, 'Pending');
assert.equal(Number(newBooking.event_id), 10);
assert.equal(Number(newBooking.change_request_id), Number(significantRequest.id));
assert.equal(Number(newBooking.venue_id), 7);
assert.equal(newBooking.venue_staff_id, ids.v);
assert.equal(newBooking.coordinator_id, ids.c);
assert.equal(newBooking.layout_required, 'Theatre');
assert.deepEqual(newBooking.facilities_required, ['Projector']);
assert.equal(Number(newBooking.accessibility_required), 1);
assert.equal(newBooking.start_datetime.toISOString(), '2099-03-01T14:00:00.000Z', 'The new booking uses the approved schedule');
assert.equal(newBooking.end_datetime.toISOString(), '2099-03-01T17:00:00.000Z');

assert.equal(await equipmentStatus(equipment10), 'Superseded');
const newEquipment = await one('select * from "Equipment Request" where request_id=$1', [newEquipmentId]);
assert.equal(newEquipment.status, 'Pending');
assert.equal(Number(newEquipment.event_id), 10);
assert.equal(Number(newEquipment.change_request_id), Number(significantRequest.id));
assert.equal(newEquipment.created_by, ids.c);
assert.match(newEquipment.latest_update_summary, /change request #\d+/);
assert.deepEqual((await q('select equipment_id,requested_quantity,technical_requirements from "Equipment Request Item" where request_id=$1', [newEquipmentId])).rows,
  [{ equipment_id: 'MIC', requested_quantity: 2, technical_requirements: 'Wireless' }], 'Active items are copied; cancelled (0) items are not');

const notified = await recipients();
assert.ok(notified.includes(ids.v), 'Venue staff are notified of the new venue request');
assert.ok(notified.includes(ids.t), 'Technical support is notified of the new equipment request');
assert.ok(notified.includes(ids.o), 'The organiser is told the request was processed');
assert.ok(!notified.includes(ids.c), 'The acting coordinator is not notified of their own action');
await blocked('select process_event_change_request($1,$2)', [significantRequest.id, ids.c], '55000');

// Ordinary approvals do not need processing; rejected requests cannot be processed.
await actor('o');
const ordinaryRequest = await submitChange(10, 'Rename', proposalFrom({ event_name: 'Gala Afternoon', start_time: '14:00', end_time: '17:00' }));
await actor('c');
const ordinary = await review(ordinaryRequest.id, 'Approved');
assert.equal(ordinary.change_type, 'Ordinary');
assert.deepEqual(ordinary.significant_fields, []);
assert.equal(ordinary.processing_status, 'Not required');
await blocked('select process_event_change_request($1,$2)', [ordinaryRequest.id, ids.c], '55000');
assert.equal(await venueStatus(newBookingId), 'Pending');
await actor('o');
const rejectedRequest = await submitChange(10, 'Bigger room', proposalFrom({ event_name: 'Gala Afternoon', event_capacity: 400, start_time: '14:00', end_time: '17:00' }));
await actor('c');
const rejectedReview = await review(rejectedRequest.id, 'Rejected', 'No larger room available.');
assert.equal(rejectedReview.processing_status, null);
await blocked('select process_event_change_request($1,$2)', [rejectedRequest.id, ids.c], '55000');

// Approval with no arrangements still records the impact; processing notes there was nothing to replace.
await addEvent(11, 'Approved');
await actor('o');
const bareRequest = await submitChange(11, 'Bigger audience', proposalFrom({ event_capacity: 100 }));
await actor('c');
const bareApproval = await review(bareRequest.id, 'Approved');
assert.equal(bareApproval.affects_venue, true);
assert.equal(bareApproval.affects_equipment, false);
const bare = await processChange(bareRequest.id, ids.c);
assert.deepEqual(bare.venue_requests, []);
assert.deepEqual(bare.equipment_requests, []);
assert.equal(bare.change_request.processing_summary, 'No active venue booking needed a new request.');

// A failure while processing rolls everything back.
await addEvent(12, 'Confirmed');
const booking12 = await addBooking(12, 'Approved');
await actor('o');
const failingRequest = await submitChange(12, 'Later start', proposalFrom({ start_time: '11:00', end_time: '13:00' }));
await actor('c');
await review(failingRequest.id, 'Approved');
await db.exec(`
create function fail_processed_notice() returns trigger language plpgsql as $$
begin
  if new.description like '%was processed%' then raise exception 'Simulated notification failure'; end if;
  return new;
end $$;
create trigger fail_processed_notice before insert on notifications for each row execute function fail_processed_notice();
`);
await blocked('select process_event_change_request($1,$2)', [failingRequest.id, ids.c], 'P0001');
assert.equal(await venueStatus(booking12), 'Pending', 'The reopened booking is not superseded when processing fails');
assert.equal((await one('select count(*)::int as n from "Venue Booking Requests" where event_id=12')).n, 1);
assert.equal((await one('select processing_status from event_change_requests where id=$1', [failingRequest.id])).processing_status, 'Awaiting processing');
await db.exec('drop trigger fail_processed_notice on notifications; drop function fail_processed_notice();');
assert.equal((await processChange(failingRequest.id, ids.c)).change_request.processing_status, 'Processed');

console.log('PASS: significant-change classification, change log, arrangement reset, approval linkage, processing guards, linked replacement requests, notifications, rollback, permissions, rerunnable migration.');
await db.close();
