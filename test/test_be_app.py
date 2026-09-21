"""Unit tests for backend/main.py (application wiring), exercised through FastAPI's TestClient."""

import pytest
from fastapi.testclient import TestClient

import coordinator_assignment as ca
import event_organiser as eo
import main
from fake_supabase import FakeClient
from tc import tc

client = TestClient(main.app)


@tc("BE-APP-001", "app (main.py)", "The application is created.", "Title and version match the API description.", steps="1. Read main.app.title and version.", kind="Config")
def test_app_metadata():
    assert (main.app.title, main.app.version) == ("Event Coordinator Assignment API", "1.0.0")


@tc("BE-APP-002", "app routers", "All eight routers are registered.", "Routes from the coordinator, organiser, venue request, venue approval, venue catalogue and three equipment modules exist.", steps="1. Collect the route paths from main.app.openapi().")
def test_routers_registered():
    paths = set(main.app.openapi()["paths"])
    assert {"/api/health", "/api/event-organisers/{organiser_id}/requests", "/api/venue-booking-requests",
            "/api/equipment", "/api/equipment-update/{staff_id}/requests/summary", "/api/equipment-availability/{staff_id}/events",
            "/api/venues", "/api/venue-bookings", "/api/venue-catalogue", "/api/venue-catalogue/{venue_id}"} <= paths


@tc("BE-APP-003", "GET /api/health", "Health check is called over HTTP.", "200 with {\"status\": \"ok\", ...}.", steps="1. GET /api/health.")
def test_http_health():
    response = client.get("/api/health")
    assert response.status_code == 200 and response.json()["status"] == "ok"


@tc("BE-APP-004", "CORS middleware", "Preflight from the Vite dev origin.", "Origin http://localhost:5173 is allowed.", data="Origin: http://localhost:5173", steps="1. Send OPTIONS /api/health with CORS headers.", kind="Config")
def test_cors_allowed():
    response = client.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


@tc("BE-APP-005", "CORS middleware", "Preflight from an unknown origin.", "No Access-Control-Allow-Origin header is returned.", data="Origin: https://evil.example", steps="1. Send OPTIONS with an unlisted origin.", kind="Security")
def test_cors_blocked():
    response = client.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in response.headers


@tc("BE-APP-006", "GET /api/venue-booking-requests", "Request has no Authorization header.", "HTTP 401 from the auth dependency.", steps="1. GET /api/venue-booking-requests with no header.", kind="Security")
def test_http_venue_requires_auth():
    assert client.get("/api/venue-booking-requests").status_code == 401


@tc("BE-APP-007", "POST /api/event-organisers/{id}/requests", "Body is missing required fields.", "HTTP 422 validation error.", data="{}", steps="1. POST an empty JSON body.", kind="Negative")
def test_http_validation_422():
    assert client.post("/api/event-organisers/o1/requests", json={}).status_code == 422


@tc("BE-APP-008", "PATCH /api/events/{id}/status", "An invalid status is sent over HTTP.", "HTTP 400 \"Invalid event status.\" (rejected before the database is used).", data="event_status = \"Nope\"", steps="1. PATCH /api/events/1/status with an invalid status.", kind="Negative")
def test_http_invalid_status():
    response = client.patch("/api/events/1/status", json={"event_status": "Nope"})
    assert (response.status_code, response.json()["detail"]) == (400, "Invalid event status.")


@tc("BE-APP-009", "GET /api/users/{id}/role", "Backend credentials are not configured.", "HTTP 500 with the configuration message.", pre="Service-role key unset.", steps="1. Blank the key. 2. GET /api/users/u1/role.", kind="Config")
def test_http_missing_credentials(monkeypatch):
    monkeypatch.setattr(ca, "SUPABASE_SERVICE_ROLE_KEY", None)
    assert client.get("/api/users/u1/role").status_code == 500


@tc("BE-APP-010", "POST /api/event-organisers/{id}/requests", "A valid draft is posted over HTTP.", "HTTP 200 and the created Draft row.", pre="Database replaced by a fake client.",
    data="future-dated event", steps="1. Patch db(). 2. POST a valid event body.")
def test_http_create_draft(monkeypatch):
    from datetime import date, timedelta
    fake = FakeClient({"Event Details": []})
    monkeypatch.setattr(eo, "db", lambda: fake)
    body = {"event_name": "Gala", "event_type": "Workshop", "event_date": (date.today() + timedelta(days=3)).isoformat(),
            "event_capacity": 10, "description": "d", "start_time": "09:00", "end_time": "17:00"}
    response = client.post("/api/event-organisers/o1/requests", json=body)
    assert response.status_code == 200 and response.json()["status"] == "Draft"
