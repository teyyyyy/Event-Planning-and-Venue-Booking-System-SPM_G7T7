"""HTTP access matrix for the five assigned user roles."""

from datetime import date, timedelta
from types import SimpleNamespace
import attendee_registration as ar
import notifications as nt
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import coordinator_assignment as ca
import equipment_availability as ea
import equipment_request as er
import equipment_reservation as rs
import equipment_update as eu
import event_changes as ec
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
        "/api/events/1/change-log",
    ),
    "Event Coordinator": (
        "/api/events",
        "/api/coordinators",
        "/api/coordinator-workloads",
        "/api/event-coordinators/{user_id}/events",
        "/api/event-change-requests",
        "/api/events/1/change-log",
        "/api/equipment",
        "/api/venues",
        "/api/venue-booking-requests/venues/1",
        "/api/venue-booking-requests/coordinators/{user_id}",
        "/api/venue-catalogue",
    ),
    "Venue Staff": (
        "/api/venue-booking-requests",
        "/api/venue-catalogue",
        "/api/venues",
        "/api/venue-booking-requests/venues/1",
        "/api/events/1/change-log",
    ),
    "Technical Support Staff": (
        "/api/equipment-update/{user_id}/requests/summary",
        "/api/equipment-availability/{user_id}/events",
        "/api/equipment-reservation/{user_id}/reservations",
        "/api/equipment-reservation/{user_id}/events/1",
        "/api/venue-catalogue",
        "/api/events/1/change-log",
    ),
    "Attendee": ("/api/attendee/events", "/api/attendee/registrations"),
}

# (owner, method, path, body, statuses the owner may get); every other role must get 403.
ROLE_ACTIONS = (
    ("Attendee", "POST", "/api/attendee/events/1/register", None, {201}),
    (
        "Event Organiser", "POST", "/api/event-organisers/{user_id}/requests",
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
    ("Event Coordinator", "POST", "/api/events/1/clarification-requests",
     {"coordinator_comments": "Please clarify the schedule.", "amendments": "Update the venue setup."}, {200}),
    ("Event Coordinator", "PATCH", "/api/events/1/status", {"event_status": "Approved"}, {200}),
    ("Venue Staff", "POST", "/api/venue-booking-requests/1/approve", None, {200}),
    ("Technical Support Staff", "PUT", "/api/equipment-update/{user_id}/events/1/requests", {"requests": []}, {400}),
    # Reach the handler without writing: request 2 is not event 1's request, reservation 999 does not exist.
    ("Technical Support Staff", "POST", "/api/equipment-reservation/{user_id}", {"event_id": 1, "request_id": 2}, {400}),
    ("Technical Support Staff", "PUT", "/api/equipment-reservation/{user_id}/999", {"items": [{"equipment_id": "MIC", "reserved_quantity": 1}]}, {404}),
    ("Technical Support Staff", "DELETE", "/api/equipment-reservation/{user_id}/999", None, {404}),
)

RESERVATION_ROUTES = (
    ("GET", "/api/equipment-reservation/{staff_id}/reservations", None),
    ("GET", "/api/equipment-reservation/{staff_id}/events/1", None),
    ("POST", "/api/equipment-reservation/{staff_id}", {"event_id": 1, "request_id": 1}),
    ("PUT", "/api/equipment-reservation/{staff_id}/1", {"items": [{"equipment_id": "MIC", "reserved_quantity": 1}]}),
    ("DELETE", "/api/equipment-reservation/{staff_id}/1", None),
)

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
        "coordinator_comments_count": 0, "amendments_count": 0,
        "event_date": (date.today() + timedelta(days=10)).isoformat(),
        "event_end_date": (date.today() + timedelta(days=10)).isoformat(),
        "start_time": "09:00", "end_time": "17:00", "event_capacity": 10,
    }
    fake = FakeClient({
        "users": users,
        "Event Details": [event_row, {**event_row, "id": "1"}],
        "Venue Booking Requests": [{
            "request_id": 1, "venue_id": 1, "event_id": 1,
            "coordinator_id": USER_IDS["Event Coordinator"],
            "venue_staff_id": USER_IDS["Venue Staff"], "status": "Pending",
            "created_at": "2026-09-01T00:00:00+00:00",
            "start_datetime": "2026-10-10T09:00:00+00:00",
            "end_datetime": "2026-10-10T17:00:00+00:00",
        }],
        "Venues": [{"venue_id": 1, "name": "Hall A"}],
        "Equipment Request": [{"request_id": 1, "event_id": 1, "status": "Submitted", "created_by": USER_IDS["Event Coordinator"]}],
        "Equipment Request Item": [{"request_id": 1, "equipment_id": "MIC", "requested_quantity": 1, "technical_requirements": ""}],
        "Equipment": [{"equipment_id": "MIC", "equipment_name": "Microphone", "total_quantity": 5, "under_maintenance_count": 0}],
        "event_change_log": [{"id": 1, "event_id": 1, "change_type": "Significant", "changed_by": USER_IDS["Event Coordinator"]}],
        "event_change_requests": [{
            "id": 1, "event_id": 1, "organiser_id": USER_IDS["Event Organiser"],
            "coordinator_id": USER_IDS["Event Coordinator"], "request_text": "Update the schedule",
            "review_status": "Pending", "created_at": "2026-09-01T00:00:00+00:00",
            "proposed_event_name": "Updated Gala", "proposed_event_type": "Workshop",
            "proposed_event_date": (date.today() + timedelta(days=10)).isoformat(),
            "proposed_event_end_date": (date.today() + timedelta(days=10)).isoformat(),
            "proposed_event_capacity": 10, "proposed_description": "Updated details",
            "proposed_start_time": "09:00", "proposed_end_time": "17:00",
        }],
    })
    for module, attribute in (
        (ca, "db"), (eo, "db"), (er, "db"), (eu, "db"), (ea, "db"), (rs, "db"),
        (va, "db"), (vc, "db"), (vr, "get_supabase"), (ar, "db"), (nt, "db"), (ec, "db"),
    ):
        monkeypatch.setattr(module, attribute, lambda fake=fake: fake)
    fake.tables["notifications"] = [{"id": 1, "recipient_id": user_id, "record_type": "event", "record_id": "1", "is_read": False}]
    # This matrix verifies role dispatch; real RPC invariants have SQL tests.
    def role_rpc(name, params):
        if name == "review_event_change_request":
            if params["p_coordinator_id"] != USER_IDS["Event Coordinator"]:
                raise APIError({"message": "You can only review change requests assigned to you.", "code": "42501", "details": None, "hint": None})
            data = {
                "id": params["p_request_id"], "event_id": 1,
                "organiser_id": USER_IDS["Event Organiser"],
                "coordinator_id": USER_IDS["Event Coordinator"],
                "request_text": "Update the schedule", "review_status": params["p_decision"],
                "reviewed_by": params["p_coordinator_id"], "reviewed_at": "2026-10-04T00:00:00+00:00",
                "review_comments": params["p_review_comments"],
                "proposed_event_name": "Updated Gala", "proposed_event_type": "Workshop",
                "proposed_event_date": event_row["event_date"], "proposed_event_end_date": event_row["event_end_date"],
                "proposed_event_capacity": 10, "proposed_description": "Updated details",
                "proposed_start_time": "09:00", "proposed_end_time": "17:00",
            }
        elif name == "process_event_change_request":
            data = {"change_request": {"id": params["p_request_id"], "processing_status": "Processed"},
                    "venue_requests": [], "equipment_requests": []}
        elif name == "submit_coordinator_feedback":
            event = next(row for row in fake.tables["Event Details"] if str(row["id"]) == str(params["p_event_id"]))
            if event["coordinator_id"] != params["p_coordinator_id"]:
                raise APIError({"message": "You can only manage events assigned to you.", "code": "42501", "details": None, "hint": None})
            if params["p_coordinator_comments"]:
                event["coordinator_comments"] = params["p_coordinator_comments"]
                event["coordinator_comments_count"] = event.get("coordinator_comments_count", 0) + 1
            if params["p_amendments"]:
                event["amendments"] = params["p_amendments"]
                event["amendments_count"] = event.get("amendments_count", 0) + 1
            data = [dict(event)]
        else:
            data = {"event_id": 1, "attendee_id": user_id}
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))

    monkeypatch.setattr(fake, "rpc", role_rpc)
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

    for owner, method, path_template, body, allowed_statuses in ROLE_ACTIONS:
        path = path_template.format(user_id=user_id)
        response = client.request(method, path, json=body)
        if role == owner:
            assert response.status_code in allowed_statuses, f"{role} should access {method} {path}: {response.status_code} {response.text}"
        else:
            assert response.status_code == 403, f"{role} must not access {method} {path}: {response.status_code} {response.text}"

    review_response = client.patch(
        "/api/event-change-requests/1/review",
        json={"decision": "Approved", "coordinator_id": "coordinator-2"},
    )
    if role == "Event Coordinator":
        assert review_response.status_code == 200, review_response.text
    else:
        assert review_response.status_code == 403, f"{role} must not review event change requests."

    process_response = client.post("/api/event-change-requests/1/process")
    if role == "Event Coordinator":
        assert process_response.status_code == 200, process_response.text
    else:
        assert process_response.status_code == 403, f"{role} must not process event change requests."

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



@tc("BE-ROLE-001", "Role access matrix", "An Event Organiser requests permitted and restricted route families.", "Only the organiser's own event request, event change history and profile routes are accessible; processing change requests is denied.", steps="1. Authenticate as an Event Organiser. 2. Request each route in the role matrix.", kind="Security")
def test_event_organiser_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Event Organiser")
    assert_role_access(client, "Event Organiser", user_id)


@tc("BE-ROLE-002", "Role access matrix", "An Event Coordinator requests permitted and restricted route families.", "Coordinator event, change history, change-request processing, equipment, venue-planning (including the coordinator's own venue booking submissions) and profile routes are accessible; unrelated routes are denied.", steps="1. Authenticate as an Event Coordinator. 2. Request each route in the role matrix.", kind="Security")
def test_event_coordinator_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Event Coordinator")
    assert_role_access(client, "Event Coordinator", user_id)


@tc("BE-ROLE-006", "Role access matrix", "A different coordinator attempts to review a request assigned to coordinator-1.",
    "The request is denied even though the caller has the Event Coordinator role.",
    steps="1. Authenticate as coordinator-2. 2. Review coordinator-1's request.", kind="Security")
def test_coordinator_cannot_review_unassigned_change_request(monkeypatch):
    client, _ = client_for_role(monkeypatch, "Event Coordinator")
    monkeypatch.setitem(
        main.app.dependency_overrides,
        current_user,
        lambda: {"id": "coordinator-2", "name": "Other coordinator", "role": "Event Coordinator"},
    )
    response = client.patch("/api/event-change-requests/1/review", json={"decision": "Approved"})
    assert response.status_code == 403


@tc("BE-ROLE-008", "Coordinator clarification requests", "The assigned coordinator requests clarification and amendments for an event.",
    "Both messages are saved on the event and visible in the organiser's own event status list.",
    steps="1. Authenticate as coordinator-1 and submit both messages. 2. Authenticate as organiser-1 and load their requests.", kind="Security")
def test_organiser_can_view_coordinator_feedback(monkeypatch):
    client, _ = client_for_role(monkeypatch, "Event Coordinator")
    response = client.post(
        "/api/events/1/clarification-requests",
        json={"coordinator_comments": "Please clarify the schedule.", "amendments": "Update the venue setup."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["coordinator_comments_count"] == 1
    assert response.json()["amendments_count"] == 1
    second_response = client.post(
        "/api/events/1/clarification-requests",
        json={"coordinator_comments": "Please clarify the schedule.", "amendments": ""},
    )
    assert second_response.status_code == 200, second_response.text
    assert second_response.json()["coordinator_comments_count"] == 2
    assert second_response.json()["amendments_count"] == 1

    monkeypatch.setitem(
        main.app.dependency_overrides,
        current_user,
        lambda: {"id": USER_IDS["Event Organiser"], "name": "Organiser", "role": "Event Organiser"},
    )
    organiser_response = client.get(f"/api/event-organisers/{USER_IDS['Event Organiser']}/requests")
    assert organiser_response.status_code == 200, organiser_response.text
    event = next(item for item in organiser_response.json() if item["coordinator_comments"])
    assert event["coordinator_comments"] == "Please clarify the schedule."
    assert event["amendments"] == "Update the venue setup."
    assert event["coordinator_comments_count"] == 2
    assert event["amendments_count"] == 1
    assert event["amendments"] == "Update the venue setup."


@tc("BE-ROLE-009", "Coordinator clarification requests", "A different coordinator tries to request clarification for an event assigned to coordinator-1.",
    "The request is denied and the event is not changed.",
    steps="1. Authenticate as coordinator-2. 2. POST clarification and amendment fields for event 1.", kind="Security")
def test_coordinator_cannot_request_feedback_for_unassigned_event(monkeypatch):
    client, _ = client_for_role(monkeypatch, "Event Coordinator")
    monkeypatch.setitem(
        main.app.dependency_overrides,
        current_user,
        lambda: {"id": "coordinator-2", "name": "Other coordinator", "role": "Event Coordinator"},
    )
    response = client.post(
        "/api/events/1/clarification-requests",
        json={"coordinator_comments": "Clarify this.", "amendments": ""},
    )
    assert response.status_code == 403


@tc("BE-ROLE-003", "Role access matrix", "A Venue Staff member requests permitted and restricted route families.", "Booking approvals, venue catalogue and venue list reads, bookings per venue, change history for events they review and the member's profile are accessible; unrelated routes are denied.", steps="1. Authenticate as Venue Staff. 2. Request each route in the role matrix.", kind="Security")
def test_venue_staff_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Venue Staff")
    assert_role_access(client, "Venue Staff", user_id)


@tc("BE-ROLE-004", "Role access matrix", "A Technical Support Staff member requests permitted and restricted route families.", "Equipment update, availability, equipment reservation (list, view, create, update, cancel), venue catalogue reads, change history for events with equipment requests and the member's profile are accessible; unrelated routes are denied.", steps="1. Authenticate as Technical Support Staff. 2. Request each route in the role matrix.", kind="Security")
def test_technical_support_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Technical Support Staff")
    assert_role_access(client, "Technical Support Staff", user_id)


@tc("BE-ROLE-005", "Role access matrix", "An Attendee requests registration, notification and staff route families.", "The Attendee can browse events, view their registrations, register and access their own notifications/profile; staff routes and event change history are denied.", steps="1. Authenticate as an Attendee. 2. Request each route in the role matrix.", kind="Security")
def test_attendee_access(monkeypatch):
    client, user_id = client_for_role(monkeypatch, "Attendee")
    profile = {"id": user_id, "role": "Attendee"}
    assert require_attendee(profile) is profile
    assert_role_access(client, "Attendee", user_id)


@tc("BE-ROLE-007", "Role access matrix", "Each non-Technical Support role calls every equipment reservation route with a Technical Support staff member's id in the path.",
    "HTTP 403 \"Technical support access required.\" for list, view, create, update and cancel; no reservation table is read or written.",
    pre="technical-staff-1 is Technical Support Staff; reservation 1 for event 1 is Reserved.", data="path staff_id = technical-staff-1",
    steps="1. Authenticate as each of the other four roles. 2. Call each reservation route for technical-staff-1.", kind="Security")
def test_other_roles_cannot_use_reservation_routes(monkeypatch):
    staff_id = USER_IDS["Technical Support Staff"]
    for role in USER_IDS.keys() - {"Technical Support Staff"}:
        client, _ = client_for_role(monkeypatch, role)
        fake = rs.db()
        fake.tables["Equipment Reservation"] = [{"reservation_id": 1, "event_id": 1, "request_id": 1, "status": "Reserved"}]
        for method, path_template, body in RESERVATION_ROUTES:
            response = client.request(method, path_template.format(staff_id=staff_id), json=body)
            assert (response.status_code, response.json()["detail"]) == (403, "Technical support access required."), f"{role} {method} {path_template}"
        assert not [name for name, _, _ in fake.log if name.startswith("Equipment Reservation")]
        assert fake.tables["Equipment Reservation"][0]["status"] == "Reserved"


@tc("BE-ROLE-010", "Role access matrix", "coordinator-1 requests coordinator-2's venue booking submissions.",
    "HTTP 403 \"You can only access your own coordinator requests.\"; the Venue Booking Requests table is not read.",
    pre="coordinator-1 and coordinator-2 are Event Coordinators; coordinator-2 has a Pending venue booking request.",
    data="path coordinator_id = coordinator-2",
    steps="1. Authenticate as coordinator-1. 2. GET /api/venue-booking-requests/coordinators/coordinator-2.", kind="Security")
def test_coordinator_cannot_list_another_coordinators_venue_requests(monkeypatch):
    client, _ = client_for_role(monkeypatch, "Event Coordinator")
    fake = vr.get_supabase()
    fake.tables["Venue Booking Requests"].append({"request_id": 2, "venue_id": 1, "event_id": 1, "coordinator_id": "coordinator-2", "status": "Pending"})
    response = client.get("/api/venue-booking-requests/coordinators/coordinator-2")
    assert (response.status_code, response.json()["detail"]) == (403, "You can only access your own coordinator requests.")
    assert not [name for name, _, _ in fake.log if name == "Venue Booking Requests"]
