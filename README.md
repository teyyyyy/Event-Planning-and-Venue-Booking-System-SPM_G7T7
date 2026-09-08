# Gather

Minimal starting point for the event management Scrum project.

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

The API health check is available at `http://localhost:8000/api/health`.

## Authentication

Login/logout is backed by a SQLite `users` table (auto-created on startup) and a
JWT stored in an **HttpOnly** cookie. Two demo accounts are seeded automatically:

| Email             | Password      |
| ----------------- | ------------- |
| `demo@gather.app` | `password123` |
| `alice@gather.app`| `password123` |

Endpoints:

- `POST /api/auth/login` — `{ "email", "password" }`, sets the `access_token` cookie
- `POST /api/auth/logout` — clears the cookie
- `GET  /api/auth/me` — returns the current user (401 if not signed in)

Set a real `SECRET_KEY` env var before deploying (defaults to a dev value), and
flip the login cookie's `secure=True` once served over HTTPS.
