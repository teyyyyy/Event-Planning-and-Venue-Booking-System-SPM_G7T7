// Isolated PostgreSQL checks for drop_venue_status_column.sql.
// Install @electric-sql/pglite in a temporary directory, then set PGLITE_MODULE to its
// dist/index.js to run (see README).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create table "Venues"(venue_id bigint primary key, name text not null,
  status text not null constraint chk_status_availability check (status in ('Available', 'Unavailable')),
  is_available boolean not null default true, unavailability_reason text not null default '');
insert into "Venues" values
  (1, 'Open', 'Available', true, ''),
  (2, 'Closed properly', 'Unavailable', false, 'Renovation'),
  (3, 'Labelled closed only', 'Unavailable', true, ''),
  (4, 'Closed, label stale', 'Available', false, 'Flooding');
`);
const sql = await readFile(new URL('../backend/sql/drop_venue_status_column.sql', import.meta.url), 'utf8');
const hasStatus = async () => (await db.query(
  `select 1 from information_schema.columns where table_name = 'Venues' and column_name = 'status'`,
)).rows.length === 1;

// A status that disagrees with is_available blocks the drop, and the column stays.
await assert.rejects(db.exec(sql), /Not dropped: status disagrees with is_available on venues \{3,4\}/);
await db.exec('rollback'); // end the aborted transaction, as closing the SQL editor session would
assert.equal(await hasStatus(), true);

// Once every venue agrees, the column and its constraint go; availability is untouched.
await db.exec(`update "Venues" set is_available = false, unavailability_reason = 'Maintenance' where venue_id = 3`);
await db.exec(`update "Venues" set status = 'Unavailable' where venue_id = 4`);
await db.exec(sql);
assert.equal(await hasStatus(), false);
assert.equal((await db.query(`select 1 from pg_constraint where conname = 'chk_status_availability'`)).rows.length, 0);
const venues = (await db.query(`select venue_id, is_available, unavailability_reason from "Venues" order by venue_id`)).rows;
assert.deepEqual(venues.map((v) => [Number(v.venue_id), v.is_available, v.unavailability_reason]),
  [[1, true, ''], [2, false, 'Renovation'], [3, false, 'Maintenance'], [4, false, 'Flooding']]);
await db.exec(sql); // rerunnable
await db.exec(`insert into "Venues"(venue_id, name) values (5, 'Added without a status')`);

// The documented rollback restores the column, filled from is_available, with its constraint.
const rollback = sql.slice(sql.indexOf('-- Rollback:'), sql.indexOf('\nbegin;')).split('\n')
  .filter((line) => line.startsWith('--   ')).map((line) => line.slice(5)).join('\n');
await db.exec(rollback);
assert.equal(await hasStatus(), true);
const restored = (await db.query(`select venue_id, status from "Venues" order by venue_id`)).rows;
assert.deepEqual(restored.map((v) => [Number(v.venue_id), v.status]),
  [[1, 'Available'], [2, 'Unavailable'], [3, 'Unavailable'], [4, 'Unavailable'], [5, 'Available']]);
await assert.rejects(db.exec(`update "Venues" set status = 'Closed' where venue_id = 1`), /chk_status_availability/);
await assert.rejects(db.exec(`insert into "Venues"(venue_id, name) values (6, 'No status')`), /null value/);
await db.exec(sql); // and the drop applies again after a rollback
assert.equal(await hasStatus(), false);
console.log('Drop venue status column SQL checks passed: mismatch guard, drop, rerun and rollback.');
await db.close();
