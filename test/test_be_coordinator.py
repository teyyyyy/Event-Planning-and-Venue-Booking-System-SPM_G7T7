"""Unit tests for backend/coordinator_assignment.py."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

import coordinator_assignment as ca
from fake_supabase import FakeClient
from tc import tc

COORDS = [
    {"id": "c1", "name": "Bob", "role": "Event Coordinator", "email": "b@x", "active_event_count": 2},
    {"id": "c2", "name": "Amy", "role": "event coordinator", "email": "a@x", "active_event_count": 1},
    {"id": "c3", "name": "Cat", "role": " Event Coordinator ", "email": "c@x", "active_event_count": 1},
]
ORGANISER = {"id": "o1", "name": "Olly", "role": "Event Organiser", "email": "o@x", "active_event_count": None}


def world(events=None, users=None, change_requests=None):
    client = FakeClient({
        "users": users or [*COORDS, ORGANISER],
        "Event Details": events or [],
        "event_change_requests": change_requests or [],
    })
    return client


def event(**kw):
    return {"id": 1, "event_name": "Gala", "status": "Submitted", "organiser_id": "o1", "coordinator_id": None,
            "event_date": "2026-10-01", **kw}


def count(client, uid):
    return next(u for u in client.tables["users"] if u["id"] == uid)["active_event_count"]


def err(fn, *a, **kw):
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    return info.value.status_code, info.value.detail


# ---- db / helpers ---------------------------------------------------------
@tc("BE-COORD-001", "db", "Supabase URL or service-role key is not configured.",
    "HTTP 500 \"Backend Supabase credentials are not configured.\"", pre="SUPABASE_SERVICE_ROLE_KEY is empty.",
    steps="1. Blank the key. 2. Call db().", kind="Config")
def test_db_missing_credentials(monkeypatch):
    monkeypatch.setattr(ca, "SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setattr(ca, "SUPABASE_SERVICE_ROLE_KEY", None)
    assert err(ca.db)[0] == 500


@tc("BE-COORD-002", "db", "Both credentials are configured.", "A client built from the URL and key is returned.",
    pre="URL and key set.", data="url = https://x.supabase.co; key = k",
    steps="1. Stub create_client. 2. Call db().")
def test_db_builds_client(monkeypatch):
    monkeypatch.setattr(ca, "SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setattr(ca, "SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(ca, "create_client", lambda url, key: ("client", url, key))
    assert ca.db() == ("client", "https://x.supabase.co", "k")


@tc("BE-COORD-003", "fetch_one", "Query matches a row.", "The row dict is returned.",
    steps="1. Build a query for users.id = c1. 2. Call fetch_one.")
def test_fetch_one_found():
    assert ca.fetch_one(world().table("users").select("*").eq("id", "c1"))["name"] == "Bob"


@tc("BE-COORD-004", "fetch_one", "Query matches nothing.", "None is returned.",
    steps="1. Build a query for a missing id. 2. Call fetch_one.", kind="Negative")
def test_fetch_one_missing():
    assert ca.fetch_one(world().table("users").select("*").eq("id", "zz")) is None


@tc("BE-COORD-005", "coordinator_records", "Users table mixes coordinators with other roles.",
    "Only event coordinators are returned; role matching ignores case and whitespace.",
    pre="3 coordinators (varied casing) and 1 organiser exist.", steps="1. Call coordinator_records(client).")
def test_coordinator_records_filters():
    assert {u["id"] for u in ca.coordinator_records(world())} == {"c1", "c2", "c3"}


@tc("BE-COORD-006", "coordinator_records", "Users table is empty.", "An empty list is returned.",
    steps="1. Call coordinator_records on an empty users table.", kind="Edge")
def test_coordinator_records_empty():
    assert ca.coordinator_records(world(users=[{"id": "x", "role": "n/a"}])) == []


@tc("BE-COORD-007", "is_active_status", "Statuses that still occupy a coordinator are checked.",
    "Under review / Submitted / Approved etc. are active.", data="\"Under review\", \"Approved\", \"Planning\"",
    steps="1. Call is_active_status for each status.")
def test_is_active_true():
    assert all(ca.is_active_status(s) for s in ("Under review", "Approved", "Planning", "Submitted"))


@tc("BE-COORD-008", "is_active_status", "Terminal statuses are checked (case/whitespace-insensitive).",
    "Draft, Complete(d), Cancelled and Rejected are inactive.", data="\" CANCELLED \", \"Completed\", \"draft\", \"Rejected\"",
    steps="1. Call is_active_status for each status.", kind="Edge")
def test_is_active_false():
    assert not any(ca.is_active_status(s) for s in (" CANCELLED ", "Completed", "draft", "complete", "Rejected"))


@tc("BE-COORD-009", "is_active_status", "Status is None.", "A blank status is not in the inactive set, so it is treated as active.",
    data="None", steps="1. Call is_active_status(None).", kind="Edge")
def test_is_active_none():
    assert ca.is_active_status(None) is True


@tc("BE-COORD-010", "view", "Event has an assignment and the coordinator is in the users map.",
    "Response carries coordinator id, name, email and maps status/organiser fields.",
    data="request with organiser_id o1; assignment coordinator c2",
    steps="1. Call view(request, {\"coordinator_id\": \"c2\"}, users).")
def test_view_with_coordinator():
    out = ca.view({"id": 1, "event_name": "Gala", "status": "Approved", "organiser_id": "o1", "event_date": "2026-10-01"},
                  {"coordinator_id": "c2"}, {"c2": COORDS[1]})
    assert (out["coordinator_name"], out["coordinator_email"], out["event_status"], out["event_organiser_id"]) == ("Amy", "a@x", "Approved", "o1")
    assert out["event_title"] == out["event_name"] == "Gala"


@tc("BE-COORD-011", "view", "Event has no assignment.", "Coordinator fields are None.",
    steps="1. Call view(request, None, {}).", kind="Edge")
def test_view_unassigned():
    out = ca.view({"id": 1}, None, {})
    assert out["assigned_coordinator_id"] is None and out["coordinator_name"] is None and out["coordinator_email"] is None


@tc("BE-COORD-012", "view", "Single-day event with no event_end_date.", "event_end_date falls back to event_date.",
    data="event_date = 2026-10-01; no end date", steps="1. Call view on the request.", kind="Edge")
def test_view_end_date_fallback():
    assert ca.view({"id": 1, "event_date": "2026-10-01"}, None, {})["event_end_date"] == "2026-10-01"


@tc("BE-COORD-013", "view", "Assigned coordinator id is not in the users map.", "Coordinator name/email are None but the id is kept.",
    steps="1. Call view with assignment c9 and an empty users map.", kind="Edge")
def test_view_unknown_coordinator():
    out = ca.view({"id": 1}, {"coordinator_id": "c9"}, {})
    assert out["assigned_coordinator_id"] == "c9" and out["coordinator_name"] is None


@tc("BE-COORD-014", "active_workloads", "Coordinators have differing active_event_count values, one is null.",
    "Returns {id: count} from the database; null counts as 0.", pre="c1=2, c2=1, c3=None in the database.",
    steps="1. Set c3 count to None. 2. Call active_workloads.")
def test_active_workloads():
    client = world()
    client.tables["users"][2]["active_event_count"] = None
    assert ca.active_workloads(client, COORDS) == {"c1": 2, "c2": 1, "c3": 0}


@tc("BE-COORD-015", "adjust_workload", "Increase a coordinator's count by 1.", "active_event_count goes from 2 to 3.",
    data="coordinator c1, amount +1", steps="1. Call adjust_workload(client, \"c1\", 1).")
def test_adjust_up():
    client = world()
    ca.adjust_workload(client, "c1", 1)
    assert count(client, "c1") == 3


@tc("BE-COORD-016", "adjust_workload", "Decrease a count that is already 0.", "Count is clamped at 0, never negative.",
    pre="c1 count = 0.", data="amount -1", steps="1. Set c1 count to 0. 2. Call adjust_workload(..., -1).", kind="Edge")
def test_adjust_clamped():
    client = world()
    client.tables["users"][0]["active_event_count"] = 0
    ca.adjust_workload(client, "c1", -1)
    assert count(client, "c1") == 0


@tc("BE-COORD-017", "adjust_workload", "Coordinator id does not exist.", "HTTP 400 \"Coordinator not found.\"",
    steps="1. Call adjust_workload with id \"nope\".", kind="Negative")
def test_adjust_unknown():
    assert err(ca.adjust_workload, world(), "nope", 1) == (400, "Coordinator not found.")


# ---- routes ----------------------------------------------------------------
@tc("BE-COORD-018", "health_check", "Health endpoint is called.", "Returns status ok and the service name.",
    steps="1. Call health_check().")
def test_health():
    assert ca.health_check() == {"status": "ok", "service": "event-coordinator-assignment"}


@tc("BE-COORD-019", "user_role", "Known user id is requested.", "The user's id, name, role and email are returned.",
    steps="1. Call user_role with the authenticated profile.")
def test_user_role_returns_authenticated_profile():
    profile = {"id": "c1", "name": "Bob", "role": "Event Coordinator", "email": "b@x"}
    assert ca.user_role("c1", profile) == profile


@tc("BE-COORD-020", "GET /api/users/{user_id}/role", "The authenticated profile is passed to the route.",
    "The profile is returned without an additional database read.",
    steps="1. Pass the authenticated profile to user_role.")
def test_user_role_does_not_fetch_profile_again(monkeypatch):
    profile = {"id": "c1", "name": "Bob", "role": "Event Coordinator", "email": "b@x"}
    monkeypatch.setattr(ca, "db", lambda: pytest.fail("role handler must not query the database"))
    assert ca.user_role("c1", profile) == profile


@tc("BE-COORD-021", "assign_event", "Three coordinators with workloads 2/1/1; a new event is assigned.",
    "The least-loaded coordinator, ties broken alphabetically (Amy), is chosen; status becomes Under review; Amy's count rises to 2.",
    pre="Event 1 exists, unassigned.", steps="1. Call assign_event(1).", data="workloads c1=2, c2=1, c3=1")
def test_assign_event_picks_least_loaded(use_db):
    client = use_db(world([event()]), ca)
    out = ca.assign_event(1)
    assert out["assigned_coordinator_id"] == "c2" and out["event_status"] == "Under review"
    assert count(client, "c2") == 2 and count(client, "c1") == 2


@tc("BE-COORD-022", "assign_event", "Event id does not exist.", "HTTP 404 \"Event request not found.\"",
    steps="1. Call assign_event(99).", kind="Negative")
def test_assign_event_missing(use_db):
    use_db(world([event()]), ca)
    assert err(ca.assign_event, 99) == (404, "Event request not found.")


@tc("BE-COORD-023", "assign_event", "Database does not contain exactly 3 coordinators.", "HTTP 500 \"Exactly 3 event coordinators are required.\"",
    pre="Only 2 coordinators exist.", steps="1. Remove one coordinator. 2. Call assign_event(1).", kind="Negative")
def test_assign_event_needs_three(use_db):
    use_db(world([event()], users=COORDS[:2]), ca)
    assert err(ca.assign_event, 1)[0] == 500


@tc("BE-COORD-024", "assign_event", "Event already has a coordinator when it is (re)assigned.",
    "Coordinator is updated, but no workload increment is applied (already counted).",
    pre="Event 1 already has coordinator_id c1.", steps="1. Call assign_event(1). 2. Compare counts.", kind="Edge")
def test_assign_event_already_assigned_no_increment(use_db):
    client = use_db(world([event(coordinator_id="c1")]), ca)
    ca.assign_event(1)
    assert count(client, "c2") == 1


@tc("BE-COORD-025", "assign_coordinator_endpoint", "POST assign-coordinator route is called.", "Delegates to assign_event and returns its view.",
    steps="1. Call assign_coordinator_endpoint(1).")
def test_assign_endpoint(use_db):
    use_db(world([event()]), ca)
    assert ca.assign_coordinator_endpoint(1)["coordinator_name"] == "Amy"


@tc("BE-COORD-026", "reassign_coordinator", "Active event is moved from c1 to c3.", "Old coordinator count -1, new +1, coordinator_id updated.",
    pre="Event 1 has coordinator c1 with status Approved.", data="coordinator_id = c3",
    steps="1. Call reassign_coordinator(1, CoordinatorAssignment(\"c3\")).")
def test_reassign_moves_workload(use_db):
    client = use_db(world([event(coordinator_id="c1", status="Approved")]), ca)
    out = ca.reassign_coordinator(1, ca.CoordinatorAssignment(coordinator_id="c3"))
    assert (count(client, "c1"), count(client, "c3")) == (1, 2) and out["assigned_coordinator_id"] == "c3"


@tc("BE-COORD-027", "reassign_coordinator", "Inactive (Cancelled) event is reassigned.", "coordinator_id changes but workload counts do not.",
    pre="Event 1 status = Cancelled.", steps="1. Call reassign_coordinator to c3.", kind="Edge")
def test_reassign_inactive_no_workload(use_db):
    client = use_db(world([event(coordinator_id="c1", status="Cancelled")]), ca)
    ca.reassign_coordinator(1, ca.CoordinatorAssignment(coordinator_id="c3"))
    assert (count(client, "c1"), count(client, "c3")) == (2, 1)


@tc("BE-COORD-028", "reassign_coordinator", "Event is reassigned to its current coordinator.", "No workload change.",
    steps="1. Call reassign_coordinator(1, c1) when c1 already owns it.", kind="Edge")
def test_reassign_same_coordinator(use_db):
    client = use_db(world([event(coordinator_id="c1", status="Approved")]), ca)
    ca.reassign_coordinator(1, ca.CoordinatorAssignment(coordinator_id="c1"))
    assert count(client, "c1") == 2


@tc("BE-COORD-029", "reassign_coordinator", "Event id does not exist.", "HTTP 404 \"Event request not found.\"",
    steps="1. Call reassign_coordinator(99, c1).", kind="Negative")
def test_reassign_missing_event(use_db):
    use_db(world([event()]), ca)
    assert err(ca.reassign_coordinator, 99, ca.CoordinatorAssignment(coordinator_id="c1"))[0] == 404


@tc("BE-COORD-030", "reassign_coordinator", "Target user is not an event coordinator.", "HTTP 400 \"Select an available event coordinator.\"",
    data="coordinator_id = o1 (an organiser)", steps="1. Call reassign_coordinator with the organiser id.", kind="Negative")
def test_reassign_non_coordinator(use_db):
    use_db(world([event()]), ca)
    assert err(ca.reassign_coordinator, 1, ca.CoordinatorAssignment(coordinator_id="o1")) == (400, "Select an available event coordinator.")


@tc("BE-COORD-031", "update_event_status", "Status is not one of the allowed values.", "HTTP 400 \"Invalid event status.\"",
    data="event_status = \"Bogus\"", steps="1. Call update_event_status(1, EventStatusUpdate(\"Bogus\")).", kind="Negative")
def test_status_invalid(use_db):
    use_db(world([event()]), ca)
    assert err(ca.update_event_status, 1, ca.EventStatusUpdate(event_status="Bogus")) == (400, "Invalid event status.")


@tc("BE-COORD-032", "update_event_status", "Event id does not exist.", "HTTP 404 \"Event request not found.\"",
    steps="1. Call update_event_status(99, Approved).", kind="Negative")
def test_status_missing_event(use_db):
    use_db(world([event()]), ca)
    assert err(ca.update_event_status, 99, ca.EventStatusUpdate(event_status="Approved"))[0] == 404


@tc("BE-COORD-033", "update_event_status", "Active event is cancelled.", "Status stored as Cancelled and the coordinator's active count drops by 1.",
    pre="Event 1 Approved, coordinator c1 (count 2).", data="event_status = Cancelled", steps="1. Call update_event_status(1, Cancelled).")
def test_status_active_to_inactive(use_db):
    client = use_db(world([event(coordinator_id="c1", status="Approved")]), ca)
    out = ca.update_event_status(1, ca.EventStatusUpdate(event_status="Cancelled"))
    assert out["event_status"] == "Cancelled" and count(client, "c1") == 1


@tc("BE-COORD-034", "update_event_status", "Cancelled event is reinstated as Planning.", "Coordinator's active count rises by 1.",
    pre="Event 1 Cancelled, coordinator c1 (count 2).", data="event_status = Planning", steps="1. Call update_event_status(1, Planning).")
def test_status_inactive_to_active(use_db):
    client = use_db(world([event(coordinator_id="c1", status="Cancelled")]), ca)
    ca.update_event_status(1, ca.EventStatusUpdate(event_status="Planning"))
    assert count(client, "c1") == 3


@tc("BE-COORD-035", "update_event_status", "Status changes between two active states.", "Workload is unchanged.",
    data="Approved -> Planning", steps="1. Call update_event_status(1, Planning).", kind="Edge")
def test_status_active_to_active(use_db):
    client = use_db(world([event(coordinator_id="c1", status="Approved")]), ca)
    ca.update_event_status(1, ca.EventStatusUpdate(event_status="Planning"))
    assert count(client, "c1") == 2


@tc("BE-COORD-036", "update_event_status", "Event has no coordinator.", "Status updates; no workload adjustment; coordinator fields are None.",
    steps="1. Call update_event_status on an unassigned event.", kind="Edge")
def test_status_unassigned(use_db):
    use_db(world([event(status="Approved")]), ca)
    out = ca.update_event_status(1, ca.EventStatusUpdate(event_status="Cancelled"))
    assert out["coordinator_name"] is None


@tc("BE-COORD-037", "organiser_events", "Organiser lists their own requests.", "Only that organiser's events are returned, ordered by date, with coordinator details.",
    pre="Two events for o1 and one for another organiser.", steps="1. Call organiser_events(\"o1\").")
def test_organiser_events(use_db):
    events = [event(id=1, event_date="2026-11-01", coordinator_id="c1"), event(id=2, event_date="2026-10-01"), event(id=3, organiser_id="other")]
    use_db(world(events), ca)
    out = ca.organiser_events("o1")
    assert [e["id"] for e in out] == [2, 1] and out[1]["coordinator_name"] == "Bob" and out[0]["coordinator_name"] is None


@tc("BE-COORD-047", "organiser_events", "One organiser event has a pending change request.",
    "That event is marked has_pending_change_request true; reviewed history does not block another event.",
    pre="Event 1 has Pending history; Event 2 has Approved history.", steps="1. Call organiser_events(\"o1\").")
def test_organiser_events_marks_pending_change_requests(use_db):
    events = [event(id=1, event_date="2026-11-01", coordinator_id="c1"), event(id=2, event_date="2026-10-01", coordinator_id="c1")]
    change_requests = [
        {"id": 1, "event_id": 1, "review_status": "Rejected", "review_comments": "Provide a revised schedule", "created_at": "2026-02-01T00:00:00Z"},
        {"id": 2, "event_id": 1, "review_status": "Pending", "created_at": "2026-03-01T00:00:00Z"},
        {"id": 3, "event_id": 2, "review_status": "Approved", "review_comments": None, "created_at": "2026-02-15T00:00:00Z"},
    ]
    use_db(world(events, change_requests=change_requests), ca)
    out = {item["id"]: item for item in ca.organiser_events("o1")}
    assert out[1]["has_pending_change_request"] is True
    assert out[1]["latest_change_request"]["review_status"] == "Pending"
    assert out[2]["has_pending_change_request"] is False
    assert out[2]["latest_change_request"]["review_status"] == "Approved"
    assert out[2]["latest_change_request"]["review_comments"] is None


def change_request(**overrides):
    return {
        "id": 11, "event_id": 1, "organiser_id": "o1", "coordinator_id": "c1",
        "review_status": "Pending", "request_text": "Move the event",
        "proposed_event_name": "Morning Gala", "proposed_event_type": "Workshop",
        "proposed_event_date": "2026-10-02", "proposed_event_end_date": "2026-10-03",
        "proposed_event_capacity": 50, "proposed_description": "Updated plan",
        "proposed_start_time": "08:00", "proposed_end_time": "12:00",
        **overrides,
    }


@tc("BE-COORD-048", "review_event_change_request", "Assigned coordinator approves a pending request.",
    "The request is Approved and all proposed event fields are applied; reviewer and review time are recorded.",
    steps="1. Seed a pending request. 2. Approve it as its assigned coordinator.")
def test_approve_event_change_request_applies_proposal(use_db):
    client = use_db(world([event(status="Confirmed", event_type="Workshop", event_capacity=10)], [*COORDS, ORGANISER], [change_request()]), ca)
    reviewed = ca.review_event_change_request(
        11, ca.EventChangeRequestReview(decision="Approved"), {"id": "c1", "role": "Event Coordinator"}
    )
    assert reviewed["review_status"] == "Approved"
    assert reviewed["reviewed_by"] == "c1"
    assert reviewed["reviewed_at"]
    assert client.tables["Event Details"][0] == {
        **event(status="Confirmed", event_type="Workshop", event_capacity=10),
        "event_name": "Morning Gala", "event_type": "Workshop",
        "event_date": "2026-10-02", "event_end_date": "2026-10-03",
        "event_capacity": 50, "description": "Updated plan",
        "start_time": "08:00", "end_time": "12:00",
    }
    assert client.tables["notifications"][0]["recipient_id"] == "o1"
    assert "was approved" in client.tables["notifications"][0]["description"]


@tc("BE-COORD-049", "review_event_change_request", "Assigned coordinator rejects a pending request with a reason.",
    "The request is Rejected and the event details remain unchanged.",
    steps="1. Seed a pending request. 2. Reject with a reason.")
def test_reject_event_change_request_preserves_event(use_db):
    client = use_db(world([event(status="Confirmed", event_capacity=10)], [*COORDS, ORGANISER], [change_request()]), ca)
    original_event = dict(client.tables["Event Details"][0])
    reviewed = ca.review_event_change_request(
        11,
        ca.EventChangeRequestReview(decision="Rejected", review_comments="Please revise the event schedule."),
        {"id": "c1", "role": "Event Coordinator"},
    )
    assert reviewed["review_status"] == "Rejected"
    assert reviewed["review_comments"] == "Please revise the event schedule."
    assert reviewed["reviewed_by"] == "c1"
    assert client.tables["Event Details"][0] == original_event
    assert client.tables["notifications"][0]["recipient_id"] == "o1"
    assert "Please revise the event schedule." in client.tables["notifications"][0]["description"]


@tc("BE-COORD-050", "review_event_change_request", "A coordinator rejects without a reason.",
    "HTTP 400 and the database is not called.", kind="Negative",
    steps="1. Attempt to reject a pending request with a blank reason.")
def test_reject_event_change_request_requires_reason(use_db):
    client = use_db(world(change_requests=[change_request()]), ca)
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Rejected", review_comments="  "),
        {"id": "c1", "role": "Event Coordinator"},
    ) == (400, "A reason is required when rejecting a change request.")
    assert not client.log


@tc("BE-COORD-051", "review_event_change_request", "Another coordinator attempts to review the request.",
    "HTTP 403 and the request remains Pending.", kind="Security",
    steps="1. Attempt to approve c1's request as coordinator c2.")
def test_review_event_change_request_wrong_coordinator(use_db):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Approved"),
        {"id": "c2", "role": "Event Coordinator"},
    )[0] == 403
    assert client.tables["event_change_requests"][0]["review_status"] == "Pending"


@tc("BE-COORD-052", "review_event_change_request", "A coordinator reviews an already-decided request.",
    "HTTP 409; a completed decision cannot be overwritten.", kind="State",
    steps="1. Seed an Approved request. 2. Attempt to reject it.")
def test_review_event_change_request_cannot_be_overwritten(use_db):
    client = use_db(
        world(
            [event(status="Confirmed", event_capacity=50)],
            [*COORDS, ORGANISER],
            [change_request(review_status="Approved", reviewed_by="c1", review_comments=None)],
        ),
        ca,
    )
    original_event = dict(client.tables["Event Details"][0])
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Rejected", review_comments="Try again."),
        {"id": "c1", "role": "Event Coordinator"},
    )[0] == 409
    assert client.tables["Event Details"][0] == original_event
    assert client.tables["event_change_requests"][0]["review_status"] == "Approved"


@tc("BE-COORD-053", "review_event_change_request", "The requested change request does not exist.",
    "HTTP 404 with the database error message.", kind="Negative",
    steps="1. Make the review RPC return a P0002 APIError. 2. Attempt to approve the request.")
def test_review_event_change_request_missing_request(use_db, monkeypatch):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    error = APIError({"message": "Change request not found.", "code": "P0002", "details": None, "hint": None})

    def execute():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(execute=execute))
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Approved"),
        {"id": "c1", "role": "Event Coordinator"},
    ) == (404, "Change request not found.")


@tc("BE-COORD-054", "review_event_change_request", "The coordinator is not assigned to the change request.",
    "HTTP 403 with the database error message.", kind="Security",
    steps="1. Make the review RPC return a 42501 APIError. 2. Attempt to approve the request.")
def test_review_event_change_request_unassigned_coordinator(use_db, monkeypatch):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    error = APIError({"message": "Request is assigned to another coordinator.", "code": "42501", "details": None, "hint": None})

    def execute():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(execute=execute))
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Approved"),
        {"id": "c1", "role": "Event Coordinator"},
    ) == (403, "Request is assigned to another coordinator.")


@tc("BE-COORD-055", "review_event_change_request", "The review RPC rejects an invalid decision.",
    "HTTP 400 with the database error message.", kind="Negative",
    steps="1. Make the review RPC return a 22023 APIError. 2. Attempt to approve the request.")
def test_review_event_change_request_invalid_decision(use_db, monkeypatch):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    error = APIError({"message": "Decision must be Approved or Rejected.", "code": "22023", "details": None, "hint": None})

    def execute():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(execute=execute))
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Approved"),
        {"id": "c1", "role": "Event Coordinator"},
    ) == (400, "Decision must be Approved or Rejected.")


@tc("BE-COORD-056", "review_event_change_request", "A reviewed request is submitted for another review.",
    "HTTP 409 with the database error message.", kind="State",
    steps="1. Make the review RPC return a 55000 APIError. 2. Attempt to approve the request.")
def test_review_event_change_request_already_reviewed_error(use_db, monkeypatch):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    error = APIError({"message": "Change request has already been reviewed.", "code": "55000", "details": None, "hint": None})

    def execute():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(execute=execute))
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Approved"),
        {"id": "c1", "role": "Event Coordinator"},
    ) == (409, "Change request has already been reviewed.")


@tc("BE-COORD-057", "review_event_change_request", "The review RPC returns no updated request.",
    "HTTP 500 with an explicit review failure.", kind="Negative",
    steps="1. Make the review RPC return no data. 2. Attempt to approve the request.")
def test_review_event_change_request_empty_rpc_result(use_db, monkeypatch):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(
        execute=lambda: SimpleNamespace(data=[]),
    ))
    assert err(
        ca.review_event_change_request,
        11,
        ca.EventChangeRequestReview(decision="Approved"),
        {"id": "c1", "role": "Event Coordinator"},
    ) == (500, "Event change request could not be reviewed.")


@tc("BE-COORD-058", "review_event_change_request", "The review RPC fails with an unmapped database error.",
    "The original APIError propagates instead of becoming a success-shaped response.", kind="Negative",
    steps="1. Make the review RPC return an unknown APIError. 2. Attempt to approve the request.")
def test_review_event_change_request_unmapped_database_error(use_db, monkeypatch):
    client = use_db(world([event()], [*COORDS, ORGANISER], [change_request()]), ca)
    error = APIError({"message": "Database unavailable.", "code": "XX000", "details": None, "hint": None})

    def execute():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(execute=execute))
    with pytest.raises(APIError, match="Database unavailable"):
        ca.review_event_change_request(
            11,
            ca.EventChangeRequestReview(decision="Approved"),
            {"id": "c1", "role": "Event Coordinator"},
        )


@tc("BE-COORD-038", "organiser_events", "Organiser has no events.", "An empty list is returned.", steps="1. Call organiser_events(\"nobody\").", kind="Edge")
def test_organiser_events_empty(use_db):
    use_db(world([event()]), ca)
    assert ca.organiser_events("nobody") == []


@tc("BE-COORD-039", "all_events", "A coordinator requests events.", "Only events assigned to that coordinator are returned.",
    pre="One assigned event and one unrelated event exist.", steps="1. Call all_events() as coordinator c2.", kind="Security")
def test_all_events(use_db):
    use_db(world([event(id=1, event_date="2026-12-01", coordinator_id="c2"), event(id=2, event_date="2026-10-01")]), ca)
    out = ca.all_events({"id": "c2", "role": "Event Coordinator"})
    assert [e["id"] for e in out] == [1] and out[0]["coordinator_name"] == "Amy"


@tc("BE-COORD-045", "event_change_requests", "A coordinator opens the Event Change Request tab.",
    "Only requests assigned to that coordinator are returned, newest first, with event, organiser and proposal details.",
    pre="Two requests are assigned to c1 and one to c2.", steps="1. Call event_change_requests as coordinator c1.", kind="Security")
def test_event_change_requests_for_assigned_coordinator(use_db):
    change_requests = [
        {"id": 1, "event_id": 1, "organiser_id": "o1", "coordinator_id": "c1", "request_text": "Move earlier", "review_status": "Pending", "created_at": "2026-02-01T00:00:00Z", "proposed_event_name": "Morning Gala", "proposed_event_type": "Workshop", "proposed_event_date": "2026-10-01", "proposed_event_end_date": "2026-10-01", "proposed_event_capacity": 50, "proposed_description": "Updated plan", "proposed_start_time": "08:00:00", "proposed_end_time": "12:00:00"},
        {"id": 2, "event_id": 2, "organiser_id": "o1", "coordinator_id": "c2", "request_text": "Different coordinator", "review_status": "Pending", "created_at": "2026-03-01T00:00:00Z"},
        {"id": 3, "event_id": 1, "organiser_id": "o1", "coordinator_id": "c1", "request_text": "Add seating", "review_status": "Approved", "created_at": "2026-04-01T00:00:00Z", "proposed_event_name": "Seated Gala"},
    ]
    use_db(world([event(id=1, coordinator_id="c1"), event(id=2, coordinator_id="c2")], change_requests=change_requests), ca)
    out = ca.event_change_requests({"id": "c1", "role": "Event Coordinator"})
    assert [item["id"] for item in out] == [3, 1]
    assert out[1]["event"]["event_title"] == "Gala"
    assert out[1]["organiser_name"] == "Olly"
    assert out[1]["proposal"]["event_name"] == "Morning Gala"
    assert out[1]["request_text"] == "Move earlier"


@tc("BE-COORD-046", "change_request_view", "A change request references an event that is no longer available.",
    "The request is still returned with event set to None and its proposal intact.", steps="1. Call change_request_view without an event map.", kind="Edge")
def test_change_request_view_missing_event():
    out = ca.change_request_view({"id": 9, "event_id": 99, "organiser_id": "o1", "coordinator_id": "c1", "proposed_event_name": "Updated"}, {}, {"o1": ORGANISER, "c1": COORDS[0]})
    assert out["event"] is None and out["proposal"]["event_name"] == "Updated" and out["coordinator_name"] == "Bob"


@tc("BE-COORD-040", "coordinators", "Coordinator list is requested.", "Only coordinators, sorted by name case-insensitively (Amy, Bob, Cat).",
    steps="1. Call coordinators().")
def test_coordinators_sorted(use_db):
    use_db(world(), ca)
    assert [u["name"] for u in ca.coordinators()] == ["Amy", "Bob", "Cat"]


@tc("BE-COORD-041", "coordinator_workloads", "Workload summary is requested.", "One entry per coordinator with id, name, role and active_event_count.",
    steps="1. Call coordinator_workloads().")
def test_coordinator_workloads(use_db):
    use_db(world(), ca)
    out = {w["id"]: w["active_event_count"] for w in ca.coordinator_workloads()}
    assert out == {"c1": 2, "c2": 1, "c3": 1}


@tc("BE-COORD-042", "EVENT_STATUSES", "Allowed status list is inspected.", "It contains the seven lifecycle statuses.",
    steps="1. Read ca.EVENT_STATUSES.", kind="Config")
def test_status_set():
    assert ca.EVENT_STATUSES == {"Under review", "Approved", "Planning", "Confirmed", "Completed", "Cancelled", "Rejected"}


@tc("BE-COORD-043", "require_organiser_event", "An organiser opens an event request that is theirs, someone else's, or missing.", "Owner passes; another organiser is HTTP 403; unknown event is HTTP 404.",
    pre="Event 1 belongs to o1.", data="caller o1 / o2, event 1 / 99", steps="1. Call the guard as o1 for event 1. 2. As o2 for event 1. 3. As o1 for event 99.", kind="Security")
def test_organiser_event_guard(use_db):
    use_db(world([event()]), ca)
    user = {"id": "o1", "role": "Event Organiser"}
    assert ca.require_organiser_event(1, user) is user
    assert err(ca.require_organiser_event, 1, {"id": "o2", "role": "Event Organiser"})[0] == 403
    assert err(ca.require_organiser_event, 99, user)[0] == 404


@tc("BE-COORD-044", "require_assigned_coordinator_event", "A coordinator manages an event assigned to them, to someone else, or missing.", "Assigned coordinator passes; another coordinator is HTTP 403; unknown event is HTTP 404.",
    pre="Event 1 is assigned to c1.", data="caller c1 / c2, event 1 / 99", steps="1. Call the guard as c1 for event 1. 2. As c2 for event 1. 3. As c1 for event 99.", kind="Security")
def test_assigned_coordinator_event_guard(use_db):
    use_db(world([event(coordinator_id="c1")]), ca)
    user = {"id": "c1", "role": "Event Coordinator"}
    assert ca.require_assigned_coordinator_event(1, user) is user
    assert err(ca.require_assigned_coordinator_event, 1, {"id": "c2", "role": "Event Coordinator"})[0] == 403
    assert err(ca.require_assigned_coordinator_event, 99, user)[0] == 404


@tc("BE-COORD-059", "event_change_requests", "A coordinator opens a pending request that moves the event's start time, and one that was processed.",
    "The pending request previews a Significant change with the live venue booking and equipment request that approval reopens; the processed one returns its processing status and summary.",
    pre="Event 1 has an Approved booking and an Updated equipment request. Request 11 Pending (new times); request 12 Processed.",
    steps="1. Call event_change_requests as coordinator c1.")
def test_event_change_requests_include_impact_and_processing(use_db):
    client = world(
        [event(id=1, coordinator_id="c1", start_time="10:00:00", end_time="12:00:00", event_date="2026-10-02", event_end_date="2026-10-03",
               event_capacity=50, event_name="Morning Gala", event_type="Workshop", description="Updated plan")],
        change_requests=[
            change_request(created_at="2026-02-01T00:00:00Z"),
            change_request(id=12, review_status="Approved", created_at="2026-01-01T00:00:00Z", change_type="Significant",
                           significant_fields=["start_time"], affects_venue=True, affects_equipment=True,
                           processing_status="Processed", processed_at="2026-01-02T00:00:00Z",
                           processing_summary="Venue booking #5 replaced by #6."),
        ],
    )
    client.tables["Venue Booking Requests"] = [{"request_id": 5, "event_id": 1, "venue_id": 7, "status": "Approved"}]
    client.tables["Equipment Request"] = [{"request_id": 9, "event_id": 1, "status": "Updated"}]
    use_db(client, ca)
    pending, processed = ca.event_change_requests({"id": "c1", "role": "Event Coordinator"})
    assert pending["processing_status"] is None
    assert pending["impact"] == {
        "change_type": "Significant", "significant_fields": ["start_time"], "affects_venue": True, "affects_equipment": True,
        "venue_requests": [{"request_id": 5, "status": "Approved"}], "equipment_requests": [{"request_id": 9, "status": "Updated"}],
    }
    assert (processed["processing_status"], processed["processed_at"], processed["processing_summary"]) == (
        "Processed", "2026-01-02T00:00:00Z", "Venue booking #5 replaced by #6.")
    assert processed["impact"]["change_type"] == "Significant"


@tc("BE-COORD-060", "organiser_events", "An organiser's change request was approved and awaits processing.",
    "The latest change request returned with the event includes its processing status and significant-change classification.",
    pre="Event 1 has an Approved request with processing_status Awaiting processing.", steps="1. Call organiser_events(\"o1\").")
def test_organiser_events_include_processing_status(use_db):
    use_db(world([event(coordinator_id="c1")], change_requests=[change_request(
        review_status="Approved", created_at="2026-02-01T00:00:00Z", change_type="Significant", processing_status="Awaiting processing",
    )]), ca)
    latest = ca.organiser_events("o1")[0]["latest_change_request"]
    assert (latest["review_status"], latest["change_type"], latest["processing_status"]) == ("Approved", "Significant", "Awaiting processing")
