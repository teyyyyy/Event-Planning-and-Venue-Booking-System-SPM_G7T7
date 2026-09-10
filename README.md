# Gather

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
