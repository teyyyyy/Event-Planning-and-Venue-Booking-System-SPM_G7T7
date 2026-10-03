"""HTTP access matrix for the five assigned user roles."""

from datetime import date, timedelta
from types import SimpleNamespace
import attendee_registration as ar
import notifications as nt
from fastapi.testclient import TestClient

import coordinator_assignment as ca
import equipment_availability as ea
import equipment_request as er
import equipment_update as eu
import event_organiser as eo
import main
import venue_approval as va
import venue_catalogue as vc
import venue_request as vr
from auth import current_user, require_attendee
from fake_supabase import FakeClient
from tc import tc

USER_IDS = {
    "Event Organiser": "organiser-1",
    "Event Coordinator": "coordinator-1",
    "Venue Staff": "venue-staff-1",
    "Technical Support Staff": "technical-staff-1",
    "Attendee": "attendee-1",
}

ROLE_PATHS = {
    "Event Organiser": (
        "/api/event-organisers/{user_id}/submitted-requests",
        "/api/event-organisers/{user_id}/requests",
    ),
    "Event Coordinator": (
        "/api/events",
        "/api/coordinators",
        "/api/coordinator-workloads",
        "/api/event-coordinators/{user_id}/events",
        "/api/equipment",
        "/api/venues",
        "/api/venue-booking-requests/venues/1",
        "/api/venue-catalogue",
    ),
    "Venue Staff": (
        "/api/venue-booking-requests",
        "/api/venue-catalogue",
    ),
    "Technical Support Staff": (
        "/api/equipment-update/{user_id}/requests/summary",
        "/api/equipment-availability/{user_id}/events",
        "/api/venue-catalogue",
    ),
    "Attendee": ("/api/attendee/events", "/api/attendee/registrations"),
}

ROLE_ACTIONS = {
    "Attendee": ("POST", "/api/attendee/events/1/register", None, {201}),
    "Event Organiser": (
        "POST", "/api/event-organisers/{user_id}/requests",
        {
            "event_name": "Role access test",
            "event_type": "Workshop",
            "event_date": (date.today() + timedelta(days=2)).isoformat(),
            "event_capacity": 10,
            "description": "Authorization matrix test",
            "start_time": "09:00",
            "end_time": "17:00",
        },
        {200},
    ),
    "Event Coordinator": (
        "PATCH", "/api/events/1/status", {"event_status": "Approved"}, {200},
    ),
    "Venue Staff": (
        "POST", "/api/venue-booking-requests/1/approve", None, {200},
    ),
    "Technical Support Staff": (
        "PUT", "/api/equipment-update/{user_id}/events/1/requests", {"requests": []}, {400},
    ),
}

ALL_ROLE_PATHS = tuple(dict.fromkeys(path for paths in ROLE_PATHS.values() for path in paths))


def client_for_role(monkeypatch, role):
    user_id = USER_IDS[role]
    profile = {"id": user_id, "name": role, "role": role, "email": "test@example.com"}
    users = [
        {"id": known_id, "name": known_role, "role": known_role, "email": "test@example.com", "active_event_count": 0}
        for known_role, known_id in USER_IDS.items()
    ]
    event_row = {
        "id": 1, "event_name": "Gala", "organiser_id": USER_IDS["Event Organiser"],
        "coordinator_id": USER_IDS["Event Coordinator"], "status": "Under review",
        "event_date": (date.today() + timedelta(days=10)).isoformat(),
        "event_end_date": (date.today() + timedelta(days=10)).isoformat(),
        "start_time": "09:00", "end_time": "17:00", "event_capacity": 10,
    }
    fake = FakeClient({
        "users": users,
        "Event Details": [event_row, {**event_row, "id": "1"}, {**event_row, "id": "2", "coordinator_id": "coordinator-2"}],
        "Venue Booking Requests": [{
            "request_id": 1, "venue_id": 1, "event_id": 1,
            "coordinator_id": USER_IDS["Event Coordinator"],
            "venue_staff_id": USER_IDS["Venue Staff"], "status": "Pending",
            "created_at": "2026-09-01T00:00:00+00:00",
            "start_datetime": "2026-10-10T09:00:00+00:00",
            "end_datetime": "2026-10-10T17:00:00+00:00",
        }],
        "Venues": [{"venue_id": 1, "name": "Hall A"}],
    })
    for module, attribute in (
        (ca, "db"), (eo, "db"), (er, "db"), (eu, "db"), (ea, "db"),
        (va, "db"), (vc, "db"), (vr, "get_supabase"), (ar, "db"), (nt, "db"),
    ):
        monkeypatch.setattr(module, attribute, lambda fake=fake: fake)
    fake.tables["notifications"] = [{"id": 1, "recipient_id": user_id, "record_type": "event", "record_id": "1", "is_read": False}]
    # This matrix verifies role dispatch; real RPC invariants have SQL tests.
    monkeypatch.setattr(fake, "rpc", lambda name, params: SimpleNamespace(execute=lambda: SimpleNamespace(data={"event_id": 1, "attendee_id": user_id})))
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: profile)
    return TestClient(main.app), user_id


def assert_role_access(client, role, user_id):
    allowed = {
        path.format(user_id=user_id)
        for path in ROLE_PATHS[role]
    }
    allowed.add(f"/api/users/{user_id}/role")
    allowed.add("/api/notifications")
    assert client.patch("/api/notifications/1/read").status_code == 200
    assert client.patch("/api/notifications/999/read").status_code == 404

    for path in allowed:
        response = client.get(path)
        assert response.status_code == 200, f"{role} should access {path}: {response.status_code} {response.text}"

    for path_template in ALL_ROLE_PATHS:
        path = path_template.format(user_id=user_id)
        if path not in allowed:
            response = client.get(path)
            assert response.status_code == 403, f"{role} must not access {path}: {response.status_code} {response.text}"

    assert client.get(f"/api/users/{user_id}-other/role").status_code == 403
    assert client.get(f"/api/event-organisers/{user_id}-other/submitted-requests").status_code == 403
    assert client.get(f"/api/event-coordinators/{user_id}-other/events").status_code == 403

    for owner, (method, path_template, body, allowed_statuses) in ROLE_ACTIONS.items():
        path = path_template.format(user_id=user_id)
        response = client.request(method, path, json=body)
        if role == owner:
            assert response.status_code in allowed_statuses, f"{role} should access {method} {path}: {response.status_code} {response.text}"
        else:
            assert response.status_code == 403, f"{role} must not access {method} {path}: {response.status_code} {response.text}"

    change_request_path = f"/api/event-organisers/{user_id}/requests/1/change-requests"
    proposal = {
        "request_text": "Update the schedule",
        "event_name": "Gala",
        "event_type": "Workshop",
        "event_date": (date.today() + timedelta(days=10)).isoformat(),
        "event_end_date": (date.today() + timedelta(days=10)).isoformat(),
        "event_capacity": 10,
        "description": "Role access test",
        "start_time": "09:00",
        "end_time": "17:00",
    }
    change_response = client.post(change_request_path, json=proposal)
    if role == "Event Organiser":
        assert change_response.status_code == 200, change_response.text
    else:
        assert change_response.status_code == 403, f"{role} must not create event change requests."
    assert client.post(
        f"/api/event-organisers/{user_id}-other/requests/1/change-requests",
        json=proposal,
    ).status_code == 403



@tc("BE-ROLE-001", "Role access matrix", "An Event Organiser requests permitted and restricted route families.", "Only the organiser's own event request and profile routes are accessible.", steps="1. Authenticate as an Event Organiser. 2. Request each route in the role matrix.", kind="Security")
def test_event_organiser_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Event Organiser")
    assert_role_access(client, "Event Organiser", user_id)


@tc("BE-ROLE-002", "Role access matrix", "An Event Coordinator requests permitted and restricted route families.", "Coordinator event, equipment, venue-planning and profile routes are accessible; unrelated routes are denied.", steps="1. Authenticate as an Event Coordinator. 2. Request each route in the role matrix.", kind="Security")
def test_event_coordinator_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Event Coordinator")
    assert_role_access(client, "Event Coordinator", user_id)


@tc("BE-ROLE-003", "Role access matrix", "A Venue Staff member requests permitted and restricted route families.", "Booking approvals, venue catalogue reads and the member's profile are accessible; unrelated routes are denied.", steps="1. Authenticate as Venue Staff. 2. Request each route in the role matrix.", kind="Security")
def test_venue_staff_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Venue Staff")
    assert_role_access(client, "Venue Staff", user_id)


@tc("BE-ROLE-004", "Role access matrix", "A Technical Support Staff member requests permitted and restricted route families.", "Equipment update, availability, venue catalogue reads and the member's profile are accessible; unrelated routes are denied.", steps="1. Authenticate as Technical Support Staff. 2. Request each route in the role matrix.", kind="Security")
def test_technical_support_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Technical Support Staff")
    assert_role_access(client, "Technical Support Staff", user_id)


@tc("BE-ROLE-005", "Role access matrix", "An Attendee requests registration, notification and staff route families.", "The Attendee can browse events, view their registrations, register and access their own notifications/profile; staff routes are denied.", steps="1. Authenticate as an Attendee. 2. Request each route in the role matrix.", kind="Security")
def test_attendee_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Attendee")
    profile = {"id": user_id, "role": "Attendee"}
    assert require_attendee(profile) is profile
    assert_role_access(client, "Attendee", user_id)


@tc("BE-ROLE-006", "Coordinator clarification access", "Each role attempts to submit clarification feedback.", "Only the assigned Event Coordinator can write comments; other roles are denied, and a coordinator cannot target an event assigned elsewhere.", steps="1. Authenticate with each role. 2. Submit feedback for event 1. 3. Try event 2 as its unassigned coordinator.", kind="Security")
def test_clarification_role_and_event_assignment_access(monkeypatch):
    body = {"comment": "Please confirm the event name."}
    for role in USER_IDS:
        client, _ = client_for_role(monkeypatch, role)
        response = client.put("/api/events/1/clarifications", json=body)
        expected = 200 if role == "Event Coordinator" else 403
        assert response.status_code == expected, f"{role} clarification response: {response.status_code} {response.text}"

    client, _ = client_for_role(monkeypatch, "Event Coordinator")
    assert client.put("/api/events/2/clarifications", json=body).status_code == 403
