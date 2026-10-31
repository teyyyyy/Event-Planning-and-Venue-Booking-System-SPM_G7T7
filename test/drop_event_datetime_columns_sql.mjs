// Isolated PostgreSQL checks for drop_event_datetime_columns.sql.
// Install @electric-sql/pglite in a temporary directory, then set PGLITE_MODULE to its
// dist/index.js to run (see README).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create table "Event Details"(id bigint primary key, event_name text,
  event_date date, event_end_date date, start_time time, end_time time,
  start_datetime timestamptz, end_datetime timestamptz);
create table "Equipment Reservation Item"(reservation_item_id bigint primary key,
  start_datetime timestamptz not null, end_datetime timestamptz not null);
insert into "Equipment Reservation Item" values (1, '2026-10-03 09:00+08', '2026-10-03 17:00+08');
insert into "Event Details" values
  (1, 'Created in the app', '2026-10-03', '2026-10-03', '09:00', '17:00', null, null),
  (2, 'Single day, copies match', '2026-10-03', null, '09:00', '17:00', '2026-10-03 09:00+08', '2026-10-03 17:00+08'),
  (3, 'Multi-day, copies match', '2026-10-03', '2026-10-05', '09:00', '17:00', '2026-10-03 09:00+08', '2026-10-05 17:00+08'),
  (4, 'Stray start', '2026-10-03', '2026-10-03', '09:00', '17:00', '2026-10-03 10:00+08', null),
  (5, 'Times only in the copy', null, null, null, null, null, '2026-10-04 12:00+08');
`);
const sql = await readFile(new URL('../backend/sql/drop_event_datetime_columns.sql', import.meta.url), 'utf8');
const datetimeColumns = async (table) => (await db.query(
  `select column_name from information_schema.columns where table_name = '${table}' and column_name like '%datetime' order by 1`,
)).rows.map((r) => r.column_name);
const both = ['end_datetime', 'start_datetime'];

// Values the split columns don't reproduce block the drop, and neither column is dropped.
await assert.rejects(db.exec(sql), /Not dropped: start_datetime on events \{4\}/);
assert.deepEqual(await datetimeColumns('Event Details'), both);
await db.exec(`update "Event Details" set start_datetime = null where id = 4`);
await assert.rejects(db.exec(sql), /Not dropped: end_datetime on events \{5\}/);
assert.deepEqual(await datetimeColumns('Event Details'), both);

// Once nothing would be lost, both columns go; events and equipment reservations are untouched.
await db.exec(`update "Event Details" set end_datetime = null where id = 5`);
await db.exec(sql);
assert.deepEqual(await datetimeColumns('Event Details'), []);
assert.deepEqual(await datetimeColumns('Equipment Reservation Item'), both);
const events = (await db.query(`select id, event_date::text as day, start_time::text as start from "Event Details" order by id`)).rows;
assert.deepEqual(events.map((e) => [Number(e.id), e.day, e.start]),
  [[1, '2026-10-03', '09:00:00'], [2, '2026-10-03', '09:00:00'], [3, '2026-10-03', '09:00:00'], [4, '2026-10-03', '09:00:00'], [5, null, null]]);
await db.exec(sql); // rerunnable

// The documented rollback restores both columns, filled from the split columns in SGT.
const rollback = sql.slice(sql.indexOf('-- Rollback:'), sql.indexOf('\nbegin;')).split('\n')
  .filter((line) => line.startsWith('--   ')).map((line) => line.slice(5)).join('\n');
await db.exec(rollback);
assert.deepEqual(await datetimeColumns('Event Details'), both);
const restored = (await db.query(`select id,
  start_datetime = timestamptz '2026-10-03 09:00+08' as starts_ok,
  end_datetime = case id when 3 then timestamptz '2026-10-05 17:00+08' else timestamptz '2026-10-03 17:00+08' end as ends_ok,
  start_datetime is null and end_datetime is null as empty
  from "Event Details" order by id`)).rows;
assert.deepEqual(restored.map((r) => [Number(r.id), r.starts_ok, r.ends_ok, r.empty]),
  [[1, true, true, false], [2, true, true, false], [3, true, true, false], [4, true, true, false], [5, null, null, true]]);

// A half-applied state (one column already gone) still finishes cleanly.
await db.exec(`alter table "Event Details" drop column end_datetime`);
await db.exec(sql);
assert.deepEqual(await datetimeColumns('Event Details'), []);
console.log('Drop event datetime columns SQL checks passed: data-loss guard, atomic drop, rerun, rollback and partial state.');
await db.close();
