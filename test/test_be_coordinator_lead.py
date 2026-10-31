"""Lead API contracts; real PostgreSQL effects live in coordinator_reassignment_sql.mjs."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import auth
import coordinator_assignment as ca
import main
import notifications
from fake_supabase import FakeClient
from tc import tc


@tc("BE-COORD-071", "Active events", "The lead browses events across coordinators.",
    "All active events, including unassigned events, appear; inactive events are excluded and filtering works.",
    steps="1. Seed all statuses. 2. List all active events. 3. Filter c1 and an unknown coordinator.")
def test_active_events(use_db):
    statuses = ["Submitted", "Assigned", "Under review", "Approved", "Planning", "Confirmed", "Draft", "Complete", "Completed", " Cancelled ", "Rejected"]
    use_db(FakeClient({
        "users": [{"id": "c1", "name": "Bob", "role": "Event Coordinator"}],
        "Event Details": [{"id": i, "status": status, "event_name": status, "coordinator_id": "c1" if i else None}
                          for i, status in enumerate(statuses)],
    }), ca)
    assert [row["id"] for row in ca.lead_active_events()] == list(range(6))
    filtered = ca.lead_active_events("c1")
    assert [row["id"] for row in filtered] == list(range(1, 6))
    assert all(row["coordinator_name"] == "Bob" for row in filtered)
    assert ca.lead_active_events("unknown") == []


@tc("BE-COORD-072", "Lead-only endpoints", "Different roles attempt Lead reads and mutations.",
    "Only the Lead can list active events, view the queue or assign/reassign; unauthenticated calls fail.",
    steps="1. Request both lists and PATCH with each role. 2. Try without authentication.", kind="Security")
def test_lead_permissions(monkeypatch, use_db):
    fake = use_db(FakeClient(), ca)
    monkeypatch.setattr(fake, "rpc", lambda *_: SimpleNamespace(execute=lambda: SimpleNamespace(data={"id": 1, "coordinator_id": "c2"})))
    client = TestClient(main.app)
    for role in ["Event Coordinator Lead", "Event Coordinator", "Event Organiser", "Attendee", "Venue Staff", "Technical Support Staff", "Safety Officer"]:
        monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda role=role: {"id": "lead", "role": role})
        expected = 200 if role == "Event Coordinator Lead" else 403
        assert client.get("/api/event-coordinator-lead/events").status_code == expected
        assert client.get("/api/event-coordinator-lead/unassigned-queue").status_code == expected
        assert client.patch("/api/event-coordinator-lead/events/1/coordinator", json={"coordinator_id": "c2"}).status_code == expected
    monkeypatch.delitem(main.app.dependency_overrides, auth.current_user)
    assert client.get("/api/event-coordinator-lead/events").status_code == 401
    assert client.patch("/api/event-coordinator-lead/events/1/coordinator", json={"coordinator_id": "c2"}).status_code == 401


@tc("BE-COORD-073", "Assignment error handling", "The transaction rejects a missing event, bad role/target, or stale assignment.",
    "HTTP 404/403/400/409 carries the database reason; an unexpected failure is propagated.",
    steps="1. Simulate each database error. 2. Call assignment.", kind="Negative")
def test_assignment_errors(monkeypatch, use_db):
    fake = use_db(FakeClient(), ca)
    for code, status in [("P0002", 404), ("42501", 403), ("22023", 400), ("55000", 409), ("XX000", None)]:
        def rpc(*_):
            raise APIError({"code": code, "message": "Rejected transaction", "details": None, "hint": None})
        monkeypatch.setattr(fake, "rpc", rpc)
        with pytest.raises(ca.HTTPException if status else APIError) as error:
            ca.assign_from_unassigned_queue("1", ca.CoordinatorAssignment(coordinator_id="c2"), {"id": "lead"})
        if status:
            assert error.value.status_code == status
            assert error.value.detail == "Rejected transaction"


@tc("BE-COORD-074", "Empty assignment response", "The RPC unexpectedly returns no event.",
    "HTTP 409 tells the user to refresh instead of reporting success.", steps="1. Return no RPC data. 2. Assign.", kind="Negative")
def test_assignment_empty(monkeypatch, use_db):
    fake = use_db(FakeClient(), ca)
    monkeypatch.setattr(fake, "rpc", lambda *_: SimpleNamespace(execute=lambda: SimpleNamespace(data=None)))
    with pytest.raises(ca.HTTPException) as error:
        ca.assign_from_unassigned_queue("1", ca.CoordinatorAssignment(coordinator_id="c2"), {"id": "lead"})
    assert error.value.status_code == 409


@tc("BE-COORD-075", "Missing assignment migration", "The database has not installed the assignment RPC.",
    "HTTP 503 identifies coordinator_reassignment.sql and no success is reported.", steps="1. Simulate PGRST202. 2. Assign as Lead.", kind="Config")
def test_missing_migration(monkeypatch, use_db):
    fake = use_db(FakeClient(), ca)
    def rpc(*_):
        raise APIError({"code": "PGRST202", "message": "Could not find assign_event_coordinator", "details": None, "hint": None})
    monkeypatch.setattr(fake, "rpc", rpc)
    monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda: {"id": "lead", "role": "Event Coordinator Lead"})
    response = TestClient(main.app).patch("/api/event-coordinator-lead/events/1/coordinator", json={"coordinator_id": "c2"})
    assert response.status_code == 503
    assert "coordinator_reassignment.sql" in response.json()["detail"]


@tc("BE-COORD-076", "Verified assignment actor", "The body attempts to spoof the Lead identity.",
    "The RPC receives the authenticated Lead ID, not a body-supplied ID or role.",
    steps="1. Authenticate as lead. 2. Include another lead ID in the body. 3. Inspect RPC arguments.", kind="Security")
def test_verified_actor(monkeypatch, use_db):
    fake = use_db(FakeClient(), ca)
    def rpc(name, params):
        assert params["p_lead_id"] == "verified-lead"
        assert params["p_expected_coordinator_id"] == "c1"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"id": 1, "coordinator_id": "c2"}))
    monkeypatch.setattr(fake, "rpc", rpc)
    monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda: {"id": "verified-lead", "role": "Event Coordinator Lead"})
    response = TestClient(main.app).patch("/api/event-coordinator-lead/events/1/coordinator", json={
        "coordinator_id": "c2", "expected_coordinator_id": "c1", "p_lead_id": "spoofed", "role": "Event Coordinator Lead",
    })
    assert response.status_code == 200


@tc("BE-COORD-077", "Reassignment inbox access", "An event has moved from c1 to c2 and both have notifications.",
    "Each sees only their own message; the outgoing coordinator can read the message but cannot open or manage the event.",
    steps="1. Read notifications as each coordinator. 2. Open the event link. 3. Try status mutation as outgoing coordinator.", kind="Security")
def test_reassignment_notification_access(monkeypatch, use_db):
    fake = FakeClient({
        "Event Details": [{"id": 1, "event_name": "Gala", "status": "Confirmed", "coordinator_id": "c2"}],
        "notifications": [
            {"id": 1, "recipient_id": "c1", "description": "Gala: your event has been reassigned to another coordinator.", "record_type": "event", "record_id": "1", "is_read": False},
            {"id": 2, "recipient_id": "c2", "description": "Gala: coordinator assigned.", "record_type": "event", "record_id": "1", "is_read": False},
        ],
    })
    use_db(fake, ca, notifications)
    client = TestClient(main.app)
    for uid, note_id, access in [("c1", 1, 403), ("c2", 2, 200)]:
        monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda uid=uid: {"id": uid, "role": "Event Coordinator"})
        inbox = client.get("/api/notifications").json()
        assert len(inbox) == 1 and inbox[0]["id"] == note_id
        assert "Gala" in inbox[0]["description"]
        assert client.patch(f"/api/notifications/{note_id}/read").status_code == 200
        assert client.get(f"/api/notifications/{note_id}/record").status_code == access
        assert client.get(f"/api/notifications/{3 - note_id}/record").status_code == 404
        if uid == "c1":
            # This legacy route uses a string path ID; FakeClient does not perform SQL casts.
            fake.tables["Event Details"][0]["id"] = "1"
            assert client.patch("/api/events/1/status", json={"event_status": "Completed"}).status_code == 403
            fake.tables["Event Details"][0]["id"] = 1


@tc("BE-COORD-078", "Complete Lead lists and workloads", "Events and users span several database pages.",
    "The active list, unassigned queue, coordinator choices and counts include records beyond the first page.",
    steps="1. Seed 1,005 users and events. 2. List active and unassigned events. 3. Inspect coordinator choices and workload.", kind="Edge")
def test_paginated_lead_reads(use_db):
    users = [{"id": f"u{i:04}", "name": f"User {i}", "role": "Event Organiser"} for i in range(1004)]
    users.append({"id": "u1004", "name": "Coordinator", "role": "Event Coordinator", "active_event_count": 0})
    events = [{"id": i, "event_name": f"Event {i}", "status": "Submitted", "coordinator_id": None} for i in range(1004)]
    events.append({"id": 1004, "event_name": "Last event", "status": "Confirmed", "coordinator_id": "u1004"})
    use_db(FakeClient({"users": users, "Event Details": events}), ca)
    assert len(ca.lead_active_events()) == 1005
    assert len(ca.unassigned_queue({"id": "lead"})) == 1004
    assert ca.coordinators()[0]["id"] == "u1004"
    assert ca.coordinator_workloads()[0]["active_event_count"] == 1
