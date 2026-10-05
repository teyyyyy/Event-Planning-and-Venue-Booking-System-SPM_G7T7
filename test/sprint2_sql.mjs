// Isolated PostgreSQL integration checks. Install @electric-sql/pglite in a
// temporary directory, then set PGLITE_MODULE to its dist/index.js to run.
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
create table "Event Details"(id bigint primary key, event_name text, event_type text, description text, event_date date, event_end_date date, start_time time, end_time time, event_capacity integer, status text, organiser_id uuid, coordinator_id uuid);
create table "Venue Booking Requests"(request_id bigint generated always as identity primary key, event_id bigint, venue_id bigint, venue_staff_id uuid, coordinator_id uuid, status text);
create table "Equipment Request"(request_id bigint generated always as identity primary key, event_id bigint, status text, created_by uuid, updated_by uuid);
create table "Equipment Request Item"(request_id bigint, equipment_id text, requested_quantity integer check(requested_quantity > 0), technical_requirements text);
create table event_change_requests(
  id bigint generated always as identity primary key,
  event_id bigint not null references public."Event Details"(id),
  organiser_id uuid not null references public.users(id),
  coordinator_id uuid not null references public.users(id),
  request_text text not null check (length(trim(request_text)) between 1 and 5000),
  created_at timestamptz not null default now()
);
`);
const migration = await readFile(new URL('../backend/sql/sprint2_registration_notifications.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // rerunnable
const changeRequestMigration = await readFile(new URL('../backend/sql/event_change_requests.sql', import.meta.url), 'utf8');
await db.exec(changeRequestMigration);
await db.exec(changeRequestMigration); // rerunnable
const ids = Object.fromEntries(['a','b','c','d','o','v','t'].map((key, i) => [key, `00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`]));
for (const [key, role] of Object.entries({a:'Attendee',b:'Attendee',c:'Event Coordinator',d:'Event Coordinator',o:'Event Organiser',v:'Venue Staff',t:'Technical Support Staff'})) {
  await db.query('insert into users values($1,$2)', [ids[key],role]);
}
const q = (sql, params=[]) => db.query(sql, params);
const notifications = async () => (await q('select recipient_id,description,record_type,record_id from notifications order by id')).rows;
const clear = async () => db.exec('delete from notifications');
const actor = async key => q("select set_config('request.headers', $1, false)", [JSON.stringify({'x-actor-id': ids[key]})]);
const recipients = rows => rows.map(r => r.recipient_id).sort();
const expectRecipients = async keys => assert.deepEqual(recipients(await notifications()), keys.map(k => ids[k]).sort());
const submitChangeRequest = (eventId, organiserId, summary, proposal = {}) => q(
  'select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [
    eventId, organiserId, summary,
    proposal.event_name ?? 'Gather updated',
    proposal.event_type ?? 'Conference',
    proposal.event_date ?? '2099-02-01',
    proposal.event_end_date ?? '2099-02-02',
    proposal.event_capacity ?? 25,
    proposal.description ?? 'Updated event plan',
    proposal.start_time ?? '10:00',
    proposal.end_time ?? '15:00',
  ],
);
const reviewChangeRequest = (requestId, coordinatorId, decision, comments = null) => q(
  'select * from review_event_change_request($1,$2,$3,$4)',
  [requestId, coordinatorId, decision, comments],
);
const blocked = async (sql,params,code) => {
  try { await q(sql,params); assert.fail('Expected database rejection'); }
  catch (e) { assert.equal(e.code,code,e.message); }
};
await actor('o');
await q(`insert into "Event Details"(id,event_name,event_type,description,event_date,event_end_date,start_time,end_time,event_capacity,status,organiser_id,coordinator_id)
  values(1,'Gather','Workshop','Original event','2099-01-01','2099-01-01','12:00','13:00',1,'Submitted',$1,null)`,[ids.o]);
await expectRecipients(['c','d']);
await clear();
await q(`update "Event Details" set coordinator_id=$1,status='Under review' where id=1`,[ids.c]);
await expectRecipients(['c']);
await clear();
await actor('o');
const changeRequest = await submitChangeRequest(1, ids.o, 'Add wheelchair-accessible seating');
assert.equal(changeRequest.rows[0].event_id, 1);
assert.equal(changeRequest.rows[0].organiser_id, ids.o);
assert.equal(changeRequest.rows[0].coordinator_id, ids.c);
assert.equal(changeRequest.rows[0].request_text, 'Add wheelchair-accessible seating');
assert.equal(changeRequest.rows[0].review_status, 'Pending');
assert.equal(changeRequest.rows[0].proposed_event_name, 'Gather updated');
assert.equal(changeRequest.rows[0].proposed_event_capacity, 25);
assert.equal((await q('select event_name,event_capacity from "Event Details" where id=1')).rows[0].event_name, 'Gather',
  'Submitting a proposal must not modify the event record');
assert.deepEqual(
  (await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='event_change_requests'
    and column_name like 'proposed_%' order by column_name`)).rows.map(row => row.column_name),
  [
    'proposed_description',
    'proposed_end_time',
    'proposed_event_capacity',
    'proposed_event_date',
    'proposed_event_end_date',
    'proposed_event_name',
    'proposed_event_type',
    'proposed_start_time',
  ],
);
await expectRecipients(['c']);
assert.equal((await notifications())[0].record_type, 'event');
assert.match((await notifications())[0].description, /Add wheelchair-accessible seating/);
await clear();
await blocked('select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [1, ids.o, 'Add more seating', 'Gather updated', 'Conference', '2099-02-01', '2099-02-02', 25, 'Updated event plan', '10:00', '15:00'], '22023');
assert.equal((await q('select count(*)::int as n from event_change_requests where event_id=1')).rows[0].n,1);
await blocked(
  'select * from review_event_change_request($1,$2,$3,$4)',
  [1, ids.d, 'Approved', null],
  '42501',
);
await blocked(
  'select * from review_event_change_request($1,$2,$3,$4)',
  [1, ids.c, 'Rejected', '   '],
  '22023',
);
await actor('c');
const rejected = await reviewChangeRequest(1, ids.c, 'Rejected', 'Please revise the proposed event schedule.');
assert.equal(rejected.rows[0].review_status, 'Rejected');
assert.equal(rejected.rows[0].reviewed_by, ids.c);
assert.equal(rejected.rows[0].review_comments, 'Please revise the proposed event schedule.');
await expectRecipients(['o']);
assert.match((await notifications())[0].description, /rejected: Please revise the proposed event schedule/);
await clear();
assert.equal((await q('select event_name from "Event Details" where id=1')).rows[0].event_name, 'Gather',
  'Rejecting a proposal must not modify the event');
await actor('o');
await submitChangeRequest(1, ids.o, 'Add more seating');
assert.equal((await q('select count(*)::int as n from event_change_requests where event_id=1')).rows[0].n,2);
await clear();
await actor('c');
const approved = await reviewChangeRequest(2, ids.c, 'Approved');
assert.equal(approved.rows[0].review_status, 'Approved');
assert.equal(approved.rows[0].reviewed_by, ids.c);
assert.ok(approved.rows[0].reviewed_at);
await expectRecipients(['o']);
assert.match((await notifications())[0].description, /was approved/);
await clear();
assert.deepEqual(
  (await q('select event_name,event_type,event_date::text,event_end_date::text,event_capacity,description,start_time,end_time from "Event Details" where id=1')).rows[0],
  {
    event_name: 'Gather updated', event_type: 'Conference', event_date: '2099-02-01',
    event_end_date: '2099-02-02', event_capacity: 25, description: 'Updated event plan',
    start_time: '10:00:00', end_time: '15:00:00',
  },
  'Approving a proposal must apply all proposed event details',
);
await actor('o');
await submitChangeRequest(1, ids.o, 'Add more seating');
assert.equal((await q('select count(*)::int as n from event_change_requests where event_id=1')).rows[0].n,3);
await blocked('select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [1, ids.c, 'Wrong owner', 'X', 'Workshop', '2099-02-01', '2099-02-01', 10, 'X', '10:00', '11:00'], '42501');
await blocked('select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [1, ids.o, '   ', 'X', 'Workshop', '2099-02-01', '2099-02-01', 10, 'X', '10:00', '11:00'], '22023');
await clear();
await q(`insert into "Event Details"(id,event_name,event_type,description,event_date,event_end_date,start_time,end_time,event_capacity,status,organiser_id,coordinator_id)
  values(4,'Historical','Workshop','Existing historical details','2020-01-01','2020-01-01','12:00','13:00',10,'Confirmed',$1,$2)`,[ids.o,ids.c]);
await clear();
await actor('o');
const historicalProposal = await submitChangeRequest(4, ids.o, 'Keep the existing schedule', {
  event_name: 'Historical updated',
  event_date: '2020-01-01',
  event_end_date: '2020-01-01',
});
assert.equal(historicalProposal.rows[0].proposed_event_date.toISOString().slice(0, 10), '2020-01-01');
await blocked(
  'select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [4, ids.o, 'Move into the past', 'Historical updated', 'Workshop', '2019-12-31', '2020-01-01', 10, 'Revised', '12:00', '13:00'],
  '22023',
);
await clear();
await actor('c');
await reviewChangeRequest(3, ids.c, 'Approved');
await expectRecipients(['o']);
await clear();
await actor('o');
await db.exec(`
create function reject_change_request_notification() returns trigger language plpgsql as $$
begin
  if new.description like '%FAIL CHANGE NOTIFICATION%' then
    raise exception 'Simulated notification failure';
  end if;
  return new;
end $$;
create trigger reject_change_request_notification before insert on notifications
for each row execute function reject_change_request_notification();
`);
await blocked(
  'select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [1, ids.o, 'FAIL CHANGE NOTIFICATION', 'Gather updated', 'Conference', '2099-02-01', '2099-02-02', 25, 'Updated event plan', '10:00', '15:00'],
  'P0001',
);
assert.equal(
  (await q('select count(*)::int as n from event_change_requests where event_id=1')).rows[0].n,
  3,
  'A failed coordinator notification must roll back its change-request row',
);
await db.exec('drop trigger reject_change_request_notification on notifications; drop function reject_change_request_notification();');
await clear();
await q(`update "Event Details" set event_capacity=1 where id=1`);
await clear();
await actor('c');
await q(`update "Event Details" set status='Approved' where id=1`);
await expectRecipients(['o']);
await clear();
await q(`update "Event Details" set status='Approved' where id=1`);
assert.equal((await notifications()).length,0,'No-op save must be silent');
await q(`update "Event Details" set status='Confirmed' where id=1`);
const registration = await q('select * from register_for_event(1,$1)',[ids.a]);
assert.equal(registration.rows[0].attendee_id,ids.a);
assert.ok(registration.rows[0].registered_at);
await blocked('select register_for_event(1,$1)',[ids.a],'23505');
await blocked('select register_for_event(1,$1)',[ids.b],'P0001');
await blocked('select register_for_event(999,$1)',[ids.a],'P0002');
await blocked('select register_for_event(1,$1)',[ids.o],'42501');
await q(`insert into "Event Details"(id,event_name,event_date,event_end_date,start_time,end_time,event_capacity,status,organiser_id,coordinator_id)
  values(2,'Past','2000-01-01',null,'12:00','13:00',null,'Confirmed',$1,$2),
        (3,'Draft','2099-01-01',null,'12:00','13:00',null,'Draft',$1,$2)`,[ids.o,ids.c]);
await blocked('select register_for_event(2,$1)',[ids.b],'P0001');
await blocked('select register_for_event(3,$1)',[ids.b],'P0001');
await clear();
await q(`insert into "Venue Booking Requests"(event_id,venue_id,venue_staff_id,coordinator_id,status) values(1,2,$1,$2,'Pending')`,[ids.v,ids.c]);
await expectRecipients(['v']);
await clear();
await actor('v');
await q(`update "Venue Booking Requests" set status='Approved' where request_id=1`);
await expectRecipients(['a','c']);
assert.equal((await notifications()).find(n=>n.recipient_id===ids.a).record_type,'event');
await clear();
await actor('c');
await q('select submit_equipment_request(1,$1,$2)',[ids.c, JSON.stringify([{equipment_id:'MIC',requested_quantity:2,technical_requirements:''}])]);
await expectRecipients(['t']);
await clear();
await actor('t');
await q(`update "Equipment Request" set status='Rejected' where event_id=1`);
await expectRecipients(['c']);
await clear();
await actor('c');
await q(`update "Equipment Request" set status='Submitted' where event_id=1`);
await clear();
await q(`update "Event Details" set start_time='14:00',end_time='15:00' where id=1`);
await expectRecipients(['a','v','t']);
await clear();
await q(`update "Event Details" set status='Cancelled' where id=1`);
await expectRecipients(['a','o','v','t']);
assert.equal((await q('select count(*)::int as n from event_registrations where event_id=1')).rows[0].n,1,'Cancellation preserves registrations');
await clear();
await blocked('select * from submit_event_change_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[1,ids.o,'Change after cancellation','X','Workshop','2099-02-01','2099-02-01',10,'X','10:00','11:00'],'22023');
await blocked('select submit_equipment_request(3,$1,$2)',[ids.c,JSON.stringify([{equipment_id:'BAD',requested_quantity:-1}])],'23514');
assert.equal((await notifications()).length,0,'Failed item insert must not leave a notification');
assert.equal((await q('select count(*)::int as n from "Equipment Request" where event_id=3')).rows[0].n,0);
await q(`update "Event Details" set status='Confirmed',event_capacity=null where id=3`);
await q('select register_for_event(3,$1)',[ids.a]);
await q('select register_for_event(3,$1)',[ids.b]);
assert.equal((await q('select count(*)::int as n from event_registrations where event_id=3')).rows[0].n,2);
await clear();
// Same user qualifies as organiser and coordinator; one alert, actor excluded.
await actor('o');
await q(`update "Event Details" set organiser_id=$1,coordinator_id=$1,status='Cancelled' where id=3`,[ids.c]);
await expectRecipients(['a','b','c']);
await clear();
// Rolled-back event changes also roll back notifications.
await db.exec('begin');
await q(`update "Event Details" set status='Rejected' where id=3`);
await db.exec('rollback');
assert.equal((await notifications()).length,0);
const grants = (await q(`select has_function_privilege('authenticated','register_for_event(bigint,uuid)','execute') as register, has_table_privilege('authenticated','notifications','select') as read, has_function_privilege('anon','emit_notifications(text[],text,text,text)','execute') as emit`)).rows[0];
assert.deepEqual(grants,{register:false,read:false,emit:false});
assert.equal((await q(`select has_function_privilege('authenticated','submit_event_change_request(bigint,uuid,text,text,text,date,date,integer,text,time without time zone,time without time zone)','execute') as execute`)).rows[0].execute,false);
assert.equal((await q(`select has_function_privilege('authenticated','review_event_change_request(bigint,uuid,text,text)','execute') as execute`)).rows[0].execute,false);
assert.equal((await q(`select has_function_privilege('service_role','review_event_change_request(bigint,uuid,text,text)','execute') as execute`)).rows[0].execute,true);
console.log('PASS: migrations rerun, role checks, duplicate/capacity/start guards, transactional approval and rejection, required rejection reasons, organiser review metadata, coordinator notification, actor exclusion, deduplication, no-op saves, transaction rollback, cancellation retention, database permissions.');
await db.close();
