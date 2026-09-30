"""Unit tests for backend/main.py (application wiring), exercised through FastAPI's TestClient."""

import pytest
from fastapi.testclient import TestClient

import coordinator_assignment as ca
import event_organiser as eo
import main
from auth import current_user
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


@tc("BE-APP-007", "POST /api/event-organisers/{id}/requests", "Authenticated organiser sends a body missing required fields.", "HTTP 422 validation error.", data="{}", steps="1. Authenticate as o1. 2. POST an empty JSON body.", kind="Negative")
def test_http_validation_422(monkeypatch):
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "o1", "role": "Event Organiser"})
    assert client.post("/api/event-organisers/o1/requests", json={}).status_code == 422


@tc("BE-APP-008", "PATCH /api/events/{id}/status", "A request has no Authorization header.", "HTTP 401 before status validation or database access.", data="event_status = \"Nope\"", steps="1. PATCH /api/events/1/status without a bearer token.", kind="Security")
def test_http_status_requires_auth():
    response = client.patch("/api/events/1/status", json={"event_status": "Nope"})
    assert response.status_code == 401


@tc("BE-APP-009", "GET /api/users/{id}/role", "Backend credentials are not configured.", "HTTP 500 with the configuration message.", pre="Service-role key unset.", steps="1. Blank the key. 2. GET /api/users/u1/role.", kind="Config")
def test_http_missing_credentials(monkeypatch):
    monkeypatch.setattr(ca, "SUPABASE_SERVICE_ROLE_KEY", None)
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "u1", "role": "Attendee"})
    assert client.get("/api/users/u1/role").status_code == 500


@tc("BE-APP-010", "POST /api/event-organisers/{id}/requests", "A valid draft is posted over HTTP.", "HTTP 200 and the created Draft row.", pre="Database replaced by a fake client.",
    data="future-dated event", steps="1. Patch db(). 2. POST a valid event body.")
def test_http_create_draft(monkeypatch):
    from datetime import date, timedelta
    fake = FakeClient({"Event Details": []})
    monkeypatch.setattr(eo, "db", lambda: fake)
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "o1", "role": "Event Organiser"})
    body = {"event_name": "Gala", "event_type": "Workshop", "event_date": (date.today() + timedelta(days=3)).isoformat(),
            "event_capacity": 10, "description": "d", "start_time": "09:00", "end_time": "17:00"}
    response = client.post("/api/event-organisers/o1/requests", json=body)
    assert response.status_code == 200 and response.json()["status"] == "Draft"


@tc("BE-APP-011", "GET /api/events", "An Attendee requests coordinator event management data.", "HTTP 403; no event data is returned.", steps="1. Authenticate as Attendee. 2. GET /api/events.", kind="Security")
def test_http_attendee_cannot_read_coordinator_events(monkeypatch):
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "a1", "role": "Attendee"})
    assert client.get("/api/events").status_code == 403


@tc("BE-APP-012", "GET /api/event-organisers/{id}/requests", "An organiser requests another user's event status.", "HTTP 403; the event list is not queried.", steps="1. Authenticate as organiser o1. 2. GET requests for o2.", kind="Security")
def test_http_organiser_cannot_read_other_user_events(monkeypatch):
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "o1", "role": "Event Organiser"})
    assert client.get("/api/event-organisers/o2/requests").status_code == 403


@tc("BE-APP-013", "GET /api/event-coordinators/{id}/events", "A coordinator supplies another coordinator's id.", "HTTP 403; another coordinator's events are not returned.", steps="1. Authenticate as c1. 2. GET events for c2.", kind="Security")
def test_http_coordinator_cannot_impersonate_path_user(monkeypatch):
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "c1", "role": "Event Coordinator"})
    assert client.get("/api/event-coordinators/c2/events").status_code == 403


@tc("BE-APP-014", "Protected API routes", "Requests omit the bearer token.", "All event, venue, and equipment data routes return HTTP 401.", steps="1. Request representative data routes without Authorization.", kind="Security")
def test_http_data_routes_require_authentication():
    paths = [
        "/api/events", "/api/venues", "/api/venue-booking-requests/venues/1",
        "/api/event-coordinators/c1/events", "/api/equipment",
        "/api/equipment-update/t1/requests/summary", "/api/equipment-availability/t1/events",
        "/api/venue-catalogue",
    ]
    assert all(client.get(path).status_code == 401 for path in paths)


@tc("BE-APP-015", "Protected API routes", "An authenticated user with an unrelated role requests restricted data.", "HTTP 403 for coordinator, venue, and equipment operations.", steps="1. Authenticate as Event Organiser. 2. Request coordinator, venue approval, and equipment update routes.", kind="Security")
def test_http_role_boundaries(monkeypatch):
    user = {"id": "o1", "role": "Event Organiser"}
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: user)
    assert client.get("/api/events").status_code == 403
    assert client.get("/api/venue-booking-requests").status_code == 403
    assert client.get("/api/equipment-update/o1/requests/summary").status_code == 403
