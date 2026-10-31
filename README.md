# Gather

## Venue catalogue — stories 16.1 and 16.2

- Venue Staff: **Venue Catalogue → View details → Edit venue → Save changes**.
  Booking Approvals remains available in the sidebar.
- Technical Support Staff: **Venue Catalogue → View details** (read-only).
  Equipment Update and Equipment Availability Check remain available.

Run `backend/sql/venue_catalogue.sql` in the Supabase SQL Editor before saving
venue edits, then restart the backend. The migration adds `operating_hours` and
`accessibility_details` to the existing `public."Venues"` table; it does not create
another venue table or change existing records. The account's `public.users.role`
must be `Venue Staff` or `Technical Support Staff` respectively.

The editor reuses `facilities`, `accessible` (0/1), and `layouts`, so saved changes
also appear when coordinators reload the venue request flow. Supported
characteristics currently means supported layouts (e.g. Theatre or Banquet).
Facilities/layouts allow up to 30 items of 100 characters each; duplicates are
removed. Accessibility notes allow 1,000 characters. Name, location, and capacity
are displayed but not edited by this story.

Operating hours use one interval per day in local venue time, or Closed. All seven
days must be specified when saving; closing must be later on the same day.
Overnight hours are not supported. Existing records without hours display
"Not specified" until updated. Hours are planning information, not an automatic
booking restriction. Cancel discards the draft; failed saves retain it for retry.

The new `/api/venue-catalogue` routes use the shared authentication module and
enforce staff roles server-side. The existing coordinator `/api/venues` route is
unchanged. No live database changes are made by the tests:

```bash
backend/.venv/bin/python -m unittest discover -s test -p 'venue_catalogue_test.py' -v
```

After database setup, verify with two venues: edit one, refresh, confirm the other
is unchanged; cancel another edit; sign in as Technical Support Staff and confirm
there is no Edit button. Also check invalid hours, empty catalogue and failed save.

Minimal starting point for the event management Scrum project.

## Environment

Copy `.env.example` to `.env` at the repo root and fill in your Supabase project
values. The frontend reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
(Vite is configured with `envDir: '..'` to load the shared root `.env`). `.env` is
git-ignored — never commit the service role key.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The React home UI is available at `http://localhost:5173`.

## Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The backend exposes the event-organiser and coordinator-assignment routers; it
reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the repo-root `.env`.

## Event change requests

Before using the organiser's **Request changes** action, run
`backend/sql/event_change_requests.sql` in the Supabase SQL Editor after
`backend/sql/sprint2_registration_notifications.sql`. The migration stores each
proposed event version and organiser summary in `event_change_requests`, then
notifies the assigned coordinator in the same database transaction. Event
details remain unchanged when a request is submitted. Coordinators can approve
requests to apply the proposed details or reject them with a required reason.
Organisers can see the latest decision and rejection reason in their event
status list. Requests are available for submitted and active events with an
assigned coordinator; Draft, Completed, Cancelled, and Rejected events cannot
receive change requests.

## Coordinator clarification and amendment requests

Before using **Request clarification/amendments** in Event Management, run
`backend/sql/coordinator_clarification_requests.sql` in the Supabase SQL Editor,
then restart the backend. The migration safely ensures the
`coordinator_comments` and `amendments` fields exist on `Event Details`.
Separate cumulative counters track clarification and amendment submissions and
appear in red badges for the coordinator and organiser. Existing non-empty
messages are counted once when the migration first initializes the counters.
Coordinators can submit either or both messages for an event assigned to them
while it is Under review. The organiser sees the latest messages in Event
Status; these requests do not change the submitted event details.

## Significant event changes and change-request processing (10.2, 44.4)

Rerun `backend/sql/event_change_requests.sql`, then run
`backend/sql/significant_event_changes.sql` in the Supabase SQL Editor, and
restart the backend. Both are transactional and rerunnable. Always run
`significant_event_changes.sql` after `event_change_requests.sql`.

- **Significant vs ordinary (10.2):** every saved change to a submitted event is
  classified by a database trigger, whichever screen made it. Date, time,
  capacity, venue, layout, facilities and accessibility changes are
  *Significant*; name, type and description edits are *Ordinary*. Each change is
  logged with its old and new values in `event_change_log`.
- A significant change returns the event's live venue bookings (date, time,
  capacity or venue requirements) and equipment requests (date or time) to
  **Pending**, and the existing notification triggers alert venue staff and
  technical support. Cancelled, rejected, superseded and expired requests are
  left alone; an active venue hold is released back to Pending.
- Organisers see whether their proposed change is significant while filling in
  **Request changes**. Coordinators see the impact on each change request
  before approving it. The **History** button on the event tables, and **Show
  event change history** on a venue booking, list the recorded changes for the
  organiser, the assigned coordinator, and staff reviewing that event's
  requests.
- **Processing (44.4):** approving a significant change request sets it to
  *Awaiting processing*. Ordinary ones are *Not required*. **Process change**
  marks the affected live venue bookings and equipment requests *Superseded* and
  creates new Pending requests for the updated schedule. These are linked to
  the event and the change request through `change_request_id`, and equipment
  items are copied. A new venue booking takes its schedule and requirements
  from `Event Details`, as venue approval does. Venue staff and technical support are notified of the new
  requests, the organiser is told the request was processed, and the request
  becomes *Processed* with a summary. A failure rolls the whole step back.
- **One active request per event per venue (20.1):** an event may request
  several venues, but only one *Pending*, *On Hold* or *Approved* request per
  venue. Rejected, superseded and expired requests, and requests waiting for a
  replacement venue, don't count, so the coordinator can request that venue
  again and processing can create replacements. This rule
  (`Venue Booking Requests_active_event_venue_key`) replaces the original
  `UNIQUE(event_id)`, the one-live-booking-per-event index and
  `unique_event_venue`; the migration prints each old definition before
  dropping it. If an event already has two active requests for the same venue,
  the old rules are kept and the notice names them. Check it with:

  ```sql
  select indexname, indexdef from pg_indexes
  where tablename = 'Venue Booking Requests' and indexdef like 'CREATE UNIQUE%';
  ```

  To undo it, drop that index and recreate the old rules from the printed
  definitions.
- **Alternative venues:** venue staff suggest a catalogue venue, stored in
  `alternative_venue_id`. Databases built from an earlier `venue_approval.sql`
  stored it as text in `alternative_venue`; run
  `backend/sql/coordinator_alternative_venue.sql` after `venue_approval.sql`
  to convert those values to venue IDs. If a value matches no single venue,
  nothing changes and the error names the requests to fix first. It does
  nothing where the text column is already gone. Undo it with
  `rollback_coordinator_alternative_venue.sql`.
- Superseded equipment requests are hidden from the coordinator and
  technical-support screens and can no longer be edited.

The database behaviour is verified against PostgreSQL in isolation:

```bash
PGLITE_MODULE=/tmp/sprint2-sql-test/node_modules/@electric-sql/pglite/dist/index.js node test/significant_event_changes_sql.mjs
```

## Tentative venue holds (22.1, 22.2)

1. In Supabase, enable the **pg_cron** extension (Integrations → Cron, or
   Database → Extensions).
2. Rerun `backend/sql/significant_event_changes.sql`, then run
   `backend/sql/venue_holds.sql` in the SQL Editor. Both are transactional and
   rerunnable; rerun `venue_holds.sql` if you enable pg_cron later, so it can
   schedule the `venue-hold-expiry` job (every minute).
3. Restart the backend.

- **Placing a hold (22.1):** on a Pending request, venue staff choose **Place
  hold…** and an expiry (SGT) that is in the future and no later than the
  event's start. The request becomes *On Hold* and the coordinator is notified.
  While the hold is active, nobody else can hold, approve or request that venue
  for an overlapping time, including setup and teardown; the database locks
  the venue, so two overlapping holds cannot both succeed.
- **Approve** converts the hold into the confirmed booking; **Reject** releases
  it; **Remove hold** returns the request to Pending.
- **Statuses:** the coordinator's venue list shows each venue as *Confirmed*,
  *On Hold* (with its expiry), *Expired* or *Available* for the selected event;
  confirmed and held venues cannot be selected. The venue calendar and the
  venue staff list show holds with their expiry, and expired holds faded.
- **Expiry (22.2):** the coordinator is notified 24 hours before a hold expires
  (or once, when it is placed, if it is shorter than that) and again when it
  expires. Each notice names the event, the venue and the expiry time. Change
  the lead time in `venue_hold_reminder_lead()`.
- An expired hold never counts as a booking: it does not block the venue, it
  cannot be approved, and a significant event change does not revive it. The
  coordinator submits a new request from **My Submissions → Submit new
  request**. The app treats a hold as expired as soon as its time passes,
  before the scheduled job marks it.

The database behaviour is verified against PostgreSQL in isolation:

```bash
PGLITE_MODULE=/tmp/sprint2-sql-test/node_modules/@electric-sql/pglite/dist/index.js node test/venue_holds_sql.mjs
```

## Tests

Unit tests: Vitest + React Testing Library (frontend) and pytest (backend). No database or
`.env` is needed — Supabase is replaced by test doubles.

```bash
# frontend
cd frontend && npm install && npm test

# backend (from the repo root)
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements-dev.txt
cd .. && backend/.venv/bin/python -m pytest
```

Every test carries its case ID, steps and expected result, and the Word register
`docs/Unit-Test-Cases.docx` is generated from them:

```bash
cd docs/test-register && npm install && ./build.sh
```

### Automatic checks for new code

`scripts/test-all.sh` lints the code and runs both suites with coverage gates. It fails if lint finds a
problem, if a test fails, if a test has no `@tc(...)` / `tc(...)` documentation, or if new code is left
untested (backend must stay at 90% of lines, set in `.coveragerc`; frontend thresholds are in
`frontend/vitest.config.js`). It runs automatically:

- **On every push / pull request** — `.github/workflows/ci.yml` runs four jobs in parallel:
  - **Backend - lint, test & coverage:** `ruff`, then `pytest` with the coverage gate.
  - **Frontend - lint, test & build:** ESLint, then Vitest with the coverage gate, then a production build.
  - **Security - secrets & dependency audit:** `gitleaks` scans for committed secrets, and `pip-audit` and
    `npm audit` fail on a known high or critical vulnerability. These run only in CI.
  - **Test register - build unit test cases document:** rebuilds the Word register, which also fails on a
    duplicate test case ID, and uploads it as the `unit-test-cases` artifact.
- **On every commit that touches code or tests** — enable once per clone:
  `git config core.hooksPath .githooks`. The hook runs that checkout's own tests, so install the
  dependencies above in each clone or worktree first. `git commit --no-verify` skips it in an
  emergency; CI still runs on the pull request.
- **In Claude Code** — `.claude/settings.json` re-runs it after any edit to a backend or frontend source file.

When you add a function, add a test with the next free case ID in the matching `test/test_be_*.py`
or `frontend/src/__tests__/*.test.jsx`, then run `scripts/test-all.sh --register` to refresh the register.
**[docs/TESTING.md](docs/TESTING.md)** is the step-by-step guide, with templates for both suites.

### Keeping CI green

- **Change behaviour, change its tests in the same commit.** A new payload shape, status value,
  error message or access rule breaks the existing tests that describe the old one.
- **New code needs tests.** CI fails below the coverage gates: backend 90% of lines; frontend 98% of
  lines, 96% of statements, 94% of functions and 88% of branches.
- **Keep lint clean.** `ruff` (backend) and ESLint (frontend) must pass. The frontend allows its 9 existing
  `react-hooks/exhaustive-deps` warnings but fails on any new warning. If you fix one, lower
  `--max-warnings` in `frontend/package.json` to match.
- **Don't add a dependency with a known high or critical vulnerability.** `npm audit` and `pip-audit`
  fail CI, and they can also start failing later if a new advisory is published for something already installed.
  Update the package (`npm audit fix` / `pip install -U`).
- **Never commit secrets.** `gitleaks` scans the whole history, so a key removed in a later commit still fails.
  `.env` is git-ignored; revoke any key that is committed.
- **Case IDs must be unique.** Someone else may have taken "the next free ID" since you started, and
  a duplicate ID breaks the register. Check again after updating from `main`.
- **Don't hard-code dates that depend on today.** Some forms reject past dates, so a fixed date
  starts failing once it passes. Derive it from the current date (see `FUTURE` in `event_organiser.test.jsx`).
- **Update from `main` and run `scripts/test-all.sh` before opening a pull request.** A branch that
  passes on its own can still fail against a newer `main`.
- **Never merge a pull request while a CI check is red.** That is how `main` breaks for everyone.

## Authentication

Accounts live in **Supabase Auth** (`auth.users`). The React app talks to Supabase
directly via `@supabase/supabase-js`:

- `frontend/src/utils/supabase.js` — creates the client from the `VITE_SUPABASE_*` env vars
- `frontend/src/AuthContext.jsx` — `login` (`signInWithPassword`), `logout`
  (`signOut`), and `onAuthStateChange` to keep React state in sync
- `frontend/src/Login.jsx` — sign-in form
- `frontend/src/App.jsx` — gates the app: unauthenticated users see the login
  screen, authenticated users get the organiser / coordinator views with a log-out
  button

The session (JWT + refresh token) is persisted in `localStorage` and refreshed
automatically by the client.

### Accounts

Self-service sign-up is **out of scope for now** — test accounts are created by
hand in the Supabase dashboard under *Auth → Users* (set a password, mark as
confirmed). A registration flow can be added later.

### FastAPI backend

The Python backend is not part of the auth flow — the browser authenticates with
Supabase directly. The backend serves app data (event requests, coordinator
assignment) via the Supabase service-role key. `frontend/src/api.js` is a helper
that forwards the signed-in user's Supabase JWT as a `Bearer` token for when those
routes need to verify the caller.

## Sprint 2 — attendee registration and notifications (38.1, 38.2, 48.1)

Apply `backend/sql/sprint2_registration_notifications.sql` in the Supabase SQL
Editor **before restarting the backend and frontend with these changes**. The
migration is transactional and rerunnable. It adds registrations, notifications,
restricted RPCs, and notification triggers to the existing event and booking
tables. It does not backfill alerts for historical changes. No live database
migration is performed by the automated tests.

- **Attendee:** Browse events → Register, or My registered events. Refresh events
  loads current details. Cancelled events remain in the registration list.
- **All signed-in users:** Notifications in the top-right corner. The inbox
  refreshes every 30 seconds and supports manual refresh and Mark as read.
  View record opens the associated event or booking details; the link works
  after a page reload and rechecks current permissions.
- Registration requires the Attendee role, a Confirmed event, and a future
  start time in Asia/Singapore. NULL capacity means unlimited; zero means full.
  A transaction locks the event row to serialize registrations and checks
  capacity and duplicate registration before inserting the attendee and timestamp.
- Event submission alerts its assigned coordinator, or the coordinator queue
  when unassigned. Assignment alerts the new assignee. Approval/rejection alerts
  the organiser. Venue/equipment requests alert the assigned reviewer or relevant
  staff queue; decisions alert the requester.
- Confirmed event date/time or approved venue changes alert registered attendees
  and responsible staff. Cancellation also alerts the organiser. Responsible
  staff are the event coordinator, venue reviewers, and the technical-support
  queue when an active equipment request exists. Equipment currently uses a
  shared staff queue; its existing workflow does not have individual assignments.
- Alerts are generated in the same database transaction as the triggering change.
  Equipment request creation now saves its header and items in one RPC so an
  item-save failure also rolls back the alert. Unchanged saves produce no alerts;
  recipient IDs are deduplicated per write. The authenticated backend forwards
  the verified actor ID so that person is excluded.
- Existing event/booking screens retain their current edit and decision workflows.
  The triggers also support future equipment Approved/Rejected transitions; this
  change does not add a separate equipment approval screen.
- Browser database access to the new tables and RPCs is revoked. The backend
  checks identity, role, notification ownership, and access to linked records.
  Attendee withdrawal, waitlists, email, and push notifications remain out of scope.

Verification:

```bash
backend/.venv/bin/python -m pytest
cd frontend
npm test
npm run build
```

An isolated PostgreSQL integration suite also validates the migration, registration
invariants, recipient matrix, rollback, and database permissions:

```bash
npm install --prefix /tmp/sprint2-sql-test @electric-sql/pglite
PGLITE_MODULE=/tmp/sprint2-sql-test/node_modules/@electric-sql/pglite/dist/index.js node test/sprint2_sql.mjs
```

After applying the migration, verify with Attendee, Event Organiser, Event
Coordinator, Venue Staff, and Technical Support Staff accounts. Register for a
future Confirmed event; try a duplicate and a full event; change its venue/time
or cancel it; check recipient inboxes, record links, and read status after refresh.

### Venue unavailability (25.1–25.3)

Apply `backend/sql/venue_unavailability.sql` in the Supabase SQL Editor **after**
`venue_approval.sql`, `sprint2_registration_notifications.sql`, and
`significant_event_changes.sql`, before running this feature. The migration is
safe to rerun. It adds venue availability/reason fields and a
`replacement_required` flag on booking requests.

Venue Staff can open a venue in the catalogue, enter an operational reason, and
choose **Mark unavailable**. Coordinators see the reason and cannot select or
submit requests for the venue. Database guards also protect direct writes and
approvals when availability changes after a page has loaded.

Blocking resets upcoming or ongoing Pending/Approved requests to Pending and
notifies their event coordinators to request a replacement. Completed/cancelled
events, past bookings, and rejected/superseded requests are unaffected. The reset
and notifications commit together. Disrupted requests remain as history and are
excluded from the active-request uniqueness constraint. **My Submissions →
Request replacement venue** selects the same event for another booking.

**Mark available** permits new requests again. It does not restore previous
approvals or remove the replacement requirement from disrupted requests.

Focused database verification uses an isolated PostgreSQL instance, without
accessing the configured Supabase project:

```bash
npm install --prefix /tmp/venue-sql-check --no-package-lock --ignore-scripts @electric-sql/pglite
PGLITE_MODULE=/tmp/venue-sql-check/node_modules/@electric-sql/pglite/dist/index.js node test/venue_unavailability_sql.mjs
```

API checks: `python -m pytest test/venue_unavailability_test.py`.
The catalogue, request, and approval frontend suites cover the corresponding UI.

`is_available` is the only venue-level availability flag. The older `Venues.status`
text column (`Available` / `Unavailable`) is not read or written by anything, so a
venue marked `Unavailable` there stays bookable. Run
`backend/sql/drop_venue_status_column.sql` after `venue_unavailability.sql` to drop
it. It is transactional and rerunnable, and drops nothing while any venue's
`status` disagrees with `is_available`; the error lists those venue ids, and the
file header explains how to resolve each one and how to roll back. Verify it with
`node test/drop_venue_status_column_sql.mjs`, using the same `PGLITE_MODULE` as above.

## Event timing columns

An event's timing is stored only on `Event Details`, as `event_date` + `start_time` and
`event_end_date` + `end_time`: Singapore wall-clock values, where a blank end date means a
single-day event. The frontend combines them in `frontend/src/eventTimes.js`.
`Equipment Reservation Item.start_datetime` / `end_datetime` are each reservation's own booked
period and are separate.

After the backend and frontend that read the split columns are deployed, run
`backend/sql/drop_event_datetime_columns.sql` in the Supabase SQL Editor to drop the unused
`Event Details.start_datetime` / `end_datetime`. It is transactional and rerunnable, and drops
nothing if any event has a value there that its split columns don't reproduce; the error lists
those event ids. The file header has the query to inspect them and the rollback.

The migration is verified against PostgreSQL in isolation:

```bash
npm install --prefix /tmp/sprint2-sql-test @electric-sql/pglite
PGLITE_MODULE=/tmp/sprint2-sql-test/node_modules/@electric-sql/pglite/dist/index.js node test/drop_event_datetime_columns_sql.mjs
```
