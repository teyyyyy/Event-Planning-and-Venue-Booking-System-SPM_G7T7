"""Unit tests for backend/coordinator_assignment.py."""

import pytest
from fastapi import HTTPException

import coordinator_assignment as ca
from fake_supabase import FakeClient
from tc import tc

COORDS = [
    {"id": "c1", "name": "Bob", "role": "Event Coordinator", "email": "b@x", "active_event_count": 2},
    {"id": "c2", "name": "Amy", "role": "event coordinator", "email": "a@x", "active_event_count": 1},
    {"id": "c3", "name": "Cat", "role": " Event Coordinator ", "email": "c@x", "active_event_count": 1},
]
ORGANISER = {"id": "o1", "name": "Olly", "role": "Event Organiser", "email": "o@x", "active_event_count": None}


def world(events=None, users=None):
    client = FakeClient({"users": users or [*COORDS, ORGANISER], "Event Details": events or []})
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
    steps="1. Call user_role(\"c1\").")
def test_user_role_found(use_db):
    use_db(world(), ca)
    assert ca.user_role("c1")["role"] == "Event Coordinator"


@tc("BE-COORD-020", "user_role", "Unknown user id is requested.", "HTTP 404 \"User profile not found.\"",
    steps="1. Call user_role(\"nope\").", kind="Negative")
def test_user_role_missing(use_db):
    use_db(world(), ca)
    assert err(ca.user_role, "nope") == (404, "User profile not found.")


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


@tc("BE-COORD-038", "organiser_events", "Organiser has no events.", "An empty list is returned.", steps="1. Call organiser_events(\"nobody\").", kind="Edge")
def test_organiser_events_empty(use_db):
    use_db(world([event()]), ca)
    assert ca.organiser_events("nobody") == []


@tc("BE-COORD-039", "all_events", "All events are requested.", "Every event is returned, ordered by event_date, with coordinator names.",
    pre="Two events on different dates.", steps="1. Call all_events().")
def test_all_events(use_db):
    use_db(world([event(id=1, event_date="2026-12-01", coordinator_id="c2"), event(id=2, event_date="2026-10-01")]), ca)
    out = ca.all_events()
    assert [e["id"] for e in out] == [2, 1] and out[1]["coordinator_name"] == "Amy"


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
