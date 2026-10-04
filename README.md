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

`scripts/test-all.sh` runs both suites with coverage gates. It fails if a test fails, if a test
has no `@tc(...)` / `tc(...)` documentation, or if new code is left untested (backend must stay at
100% of lines; frontend thresholds are in `frontend/vitest.config.js`). It runs automatically:

- **On every push / pull request** — `.github/workflows/tests.yml` also builds the Word register and
  uploads it as the `unit-test-cases` artifact.
- **On every commit that touches code or tests** — enable once per clone:
  `git config core.hooksPath .githooks`
- **In Claude Code** — `.claude/settings.json` re-runs it after any edit to a backend or frontend source file.

When you add a function, add a test with the next free case ID in the matching `test/test_be_*.py`
or `frontend/src/__tests__/*.test.jsx`, then run `scripts/test-all.sh --register` to refresh the register.

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
