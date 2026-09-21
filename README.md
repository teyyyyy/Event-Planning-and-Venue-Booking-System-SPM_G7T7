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
