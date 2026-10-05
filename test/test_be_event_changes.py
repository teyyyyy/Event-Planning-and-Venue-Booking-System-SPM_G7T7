"""Unit tests for backend/event_changes.py (stories 10.2 and 44.4).

The database trigger and processing RPC are verified against PostgreSQL in
test/significant_event_changes_sql.mjs; these tests cover the API layer around them.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

import coordinator_assignment as ca
import event_changes as ec
from fake_supabase import FakeClient
from tc import tc

ORGANISER = {"id": "o1", "name": "Olly", "role": "Event Organiser"}
COORDINATOR = {"id": "c1", "name": "Bob", "role": "Event Coordinator"}
VENUE_STAFF = {"id": "v1", "name": "Vic", "role": "Venue Staff"}
TECH = {"id": "t1", "name": "Tess", "role": "Technical Support Staff"}
ATTENDEE = {"id": "a1", "name": "Ann", "role": "Attendee"}
EVENT = {
    "id": 1, "event_name": "Gala", "event_type": "Workshop", "description": "Plan",
    "event_date": "2026-11-01", "event_end_date": "2026-11-01", "start_time": "10:00:00", "end_time": "12:00:00",
    "event_capacity": 50, "status": "Confirmed", "organiser_id": "o1", "coordinator_id": "c1",
}


def proposal(**overrides):
    keys = ("event_name", "event_type", "description", "event_date", "event_end_date", "start_time", "end_time", "event_capacity")
    return {**{key: EVENT[key] for key in keys}, **overrides}


def change_request(**overrides):
    base = {"id": 11, "event_id": 1, "organiser_id": "o1", "coordinator_id": "c1", "review_status": "Pending"}
    return {**base, **{f"proposed_{key}": value for key, value in proposal().items()}, **overrides}


def world(bookings=(), equipment=(), log=(), users=(ORGANISER, COORDINATOR, VENUE_STAFF, TECH, ATTENDEE)):
    return FakeClient({
        "Event Details": [EVENT], "users": list(users), "Venue Booking Requests": list(bookings),
        "Equipment Request": list(equipment), "event_change_log": list(log),
    })


def err(fn, *args, **kwargs):
    with pytest.raises(HTTPException) as info:
        fn(*args, **kwargs)
    return info.value.status_code, info.value.detail


def rpc_raising(code, message="Database message."):
    def execute():
        raise APIError({"message": message, "code": code, "details": None, "hint": None})
    return lambda *_: SimpleNamespace(execute=execute)


# ---- classification (10.2) ------------------------------------------------------------
@tc("BE-EVCHG-001", "db", "The change routes need a database client.", "The coordinator module's configured client is returned.",
    steps="1. Stub coordinator_assignment.db. 2. Call event_changes.db().", kind="Config")
def test_db_delegates_to_coordinator_client(monkeypatch):
    monkeypatch.setattr(ca, "db", lambda: "client")
    assert ec.db() == "client"


@tc("BE-EVCHG-002", "comparable", "Values are normalised before comparing.",
    "Times compare by HH:MM, a blank end date equals the start date, and missing values stay None.",
    data="start_time 08:00:00; event_end_date None; event_date 2026-11-01", steps="1. Call comparable for a time, a blank end date and a missing field.")
def test_comparable_normalises_values():
    assert ec.comparable({"start_time": "08:00:00"}, "start_time") == "08:00"
    assert ec.comparable({"event_date": "2026-11-01", "event_end_date": None}, "event_end_date") == "2026-11-01"
    assert ec.comparable({"event_capacity": 50}, "event_capacity") == "50"
    assert ec.comparable({}, "venue_id") is None


@tc("BE-EVCHG-003", "classify_change", "Only the name, type and description are changed.",
    "The change is Ordinary: no significant fields and no venue or equipment impact.",
    data="event_name Gala → Gala Night; description changed", steps="1. Classify a proposal that only edits descriptive fields.")
def test_classify_ordinary_change():
    assert ec.classify_change(EVENT, proposal(event_name="Gala Night", event_type="Seminar", description="New")) == {
        "change_type": "Ordinary", "significant_fields": [], "affects_venue": False, "affects_equipment": False,
    }


@tc("BE-EVCHG-004", "classify_change", "The start and end times move.",
    "The change is Significant, lists both time fields and affects the venue and equipment.",
    data="10:00-12:00 → 14:00-16:00", steps="1. Classify a proposal with new times.")
def test_classify_schedule_change():
    assert ec.classify_change(EVENT, proposal(start_time="14:00", end_time="16:00")) == {
        "change_type": "Significant", "significant_fields": ["start_time", "end_time"],
        "affects_venue": True, "affects_equipment": True,
    }


@tc("BE-EVCHG-005", "classify_change", "Only the capacity changes.",
    "The change is Significant for the venue but does not affect equipment.",
    data="event_capacity 50 → 200", steps="1. Classify a capacity-only proposal.")
def test_classify_capacity_change():
    out = ec.classify_change(EVENT, proposal(event_capacity=200))
    assert out["significant_fields"] == ["event_capacity"]
    assert (out["affects_venue"], out["affects_equipment"]) == (True, False)


@tc("BE-EVCHG-006", "classify_change", "Proposed values only differ in format, or a field is absent from the proposal.",
    "No change is reported: HH:MM equals HH:MM:SS, a blank end date equals the start date and absent fields are ignored.",
    data="start_time 10:00; event_end_date blank; no venue fields", steps="1. Classify a proposal equal to the event apart from formatting.", kind="Edge")
def test_classify_ignores_formatting_and_absent_fields():
    out = ec.classify_change(EVENT, proposal(start_time="10:00", end_time="12:00", event_end_date=None))
    assert out["change_type"] == "Ordinary" and out["significant_fields"] == []


@tc("BE-EVCHG-007", "live_arrangements", "No event ids are given.", "An empty mapping is returned without querying.",
    steps="1. Call live_arrangements with an empty list.", kind="Edge")
def test_live_arrangements_without_events():
    client = world()
    assert ec.live_arrangements(client, []) == {}
    assert not client.log


@tc("BE-EVCHG-008", "live_arrangements", "Events have venue bookings and equipment requests in mixed states.",
    "Only live requests are grouped per event in request order; cancelled, rejected, superseded and draft equipment requests are left out.",
    pre="Event 1: Approved and Superseded bookings; Updated, Draft and Rejected equipment. Event 2: Cancelled booking.",
    steps="1. Call live_arrangements for events 1 and 2.")
def test_live_arrangements_filters_closed_requests():
    client = world(
        bookings=[
            {"request_id": 5, "event_id": 1, "venue_id": 7, "status": "Approved"},
            {"request_id": 3, "event_id": 1, "venue_id": 7, "status": "Superseded"},
            {"request_id": 6, "event_id": 2, "venue_id": 7, "status": "Cancelled"},
        ],
        equipment=[
            {"request_id": 9, "event_id": 1, "status": "Updated"},
            {"request_id": 8, "event_id": 1, "status": "Draft"},
            {"request_id": 4, "event_id": 1, "status": " rejected "},
        ],
    )
    assert ec.live_arrangements(client, [1, 2]) == {
        "1": {"venue_requests": [{"request_id": 5, "status": "Approved"}], "equipment_requests": [{"request_id": 9, "status": "Updated"}]},
    }


# ---- change request impact -------------------------------------------------------------
ARRANGEMENTS = {"1": {"venue_requests": [{"request_id": 5, "status": "Approved"}], "equipment_requests": [{"request_id": 9, "status": "Approved"}]}}


@tc("BE-EVCHG-009", "change_impact", "A pending change request moves the event's times.",
    "The preview is Significant and lists the live venue booking and equipment request that approval would reopen.",
    steps="1. Call change_impact for a pending request with new times.")
def test_impact_preview_for_pending_request():
    request = change_request(proposed_start_time="14:00", proposed_end_time="16:00")
    assert ec.change_impact(request, EVENT, ARRANGEMENTS) == {
        "change_type": "Significant", "significant_fields": ["start_time", "end_time"],
        "affects_venue": True, "affects_equipment": True,
        "venue_requests": [{"request_id": 5, "status": "Approved"}],
        "equipment_requests": [{"request_id": 9, "status": "Approved"}],
    }


@tc("BE-EVCHG-010", "change_impact", "A pending capacity change is previewed.",
    "Only the venue booking is listed; the equipment request is unaffected.",
    steps="1. Call change_impact for a pending capacity-only request.")
def test_impact_capacity_lists_only_venue():
    out = ec.change_impact(change_request(proposed_event_capacity=200), EVENT, ARRANGEMENTS)
    assert out["venue_requests"] == [{"request_id": 5, "status": "Approved"}] and out["equipment_requests"] == []


@tc("BE-EVCHG-011", "change_impact", "An approved request already has its impact recorded by the database.",
    "The recorded classification is used (the event already holds the new values) with the arrangements to be replaced.",
    pre="change_type Significant, affects equipment only.", steps="1. Call change_impact for the approved request.")
def test_impact_uses_recorded_classification():
    request = change_request(review_status="Approved", change_type="Significant", significant_fields=["start_time"],
                             affects_venue=False, affects_equipment=True)
    assert ec.change_impact(request, EVENT, ARRANGEMENTS) == {
        "change_type": "Significant", "significant_fields": ["start_time"], "affects_venue": False, "affects_equipment": True,
        "venue_requests": [], "equipment_requests": [{"request_id": 9, "status": "Approved"}],
    }


@tc("BE-EVCHG-012", "change_impact", "Requests without a usable comparison.",
    "No impact is returned for a pending request whose event is missing, a rejected request, or one approved before change tracking.",
    steps="1. Call change_impact for each case.", kind="Edge")
def test_impact_unavailable():
    assert ec.change_impact(change_request(), None, ARRANGEMENTS) is None
    assert ec.change_impact(change_request(review_status="Rejected"), EVENT, ARRANGEMENTS) is None
    assert ec.change_impact(change_request(review_status="Approved"), EVENT, ARRANGEMENTS) is None


@tc("BE-EVCHG-013", "change_impact", "A recorded impact has no significant field list and no live arrangements.",
    "Empty lists are returned rather than None.", steps="1. Call change_impact for an Ordinary approved request with no arrangements.", kind="Edge")
def test_impact_recorded_ordinary_without_arrangements():
    out = ec.change_impact(change_request(review_status="Approved", change_type="Ordinary", significant_fields=None), EVENT, {})
    assert out == {"change_type": "Ordinary", "significant_fields": [], "affects_venue": False, "affects_equipment": False,
                   "venue_requests": [], "equipment_requests": []}


# ---- change history visibility ---------------------------------------------------------
@tc("BE-EVCHG-014", "can_view_changes", "Each role asks for an event's change history.",
    "The owning organiser, the assigned coordinator, venue staff reviewing a booking (or its shared queue) and technical support with an equipment request may view it; others may not.",
    pre="Event 1 has a booking assigned to v1 and an equipment request.", steps="1. Call can_view_changes for each user.", kind="Security")
def test_can_view_changes_by_role():
    client = world(bookings=[{"request_id": 5, "event_id": 1, "venue_staff_id": "v1"}], equipment=[{"request_id": 9, "event_id": 1}])
    assert ec.can_view_changes(client, EVENT, ORGANISER)
    assert not ec.can_view_changes(client, EVENT, {**ORGANISER, "id": "o2"})
    assert ec.can_view_changes(client, EVENT, COORDINATOR)
    assert not ec.can_view_changes(client, EVENT, {**COORDINATOR, "id": "c2"})
    assert ec.can_view_changes(client, EVENT, VENUE_STAFF)
    assert not ec.can_view_changes(client, EVENT, {**VENUE_STAFF, "id": "v2"})
    assert ec.can_view_changes(client, EVENT, TECH)
    assert not ec.can_view_changes(client, EVENT, ATTENDEE)


@tc("BE-EVCHG-015", "can_view_changes", "Staff ask about an event whose booking is unassigned and which has no equipment request.",
    "Any venue staff member may view it from the shared queue; technical support may not.",
    steps="1. Call can_view_changes for venue staff and technical support.", kind="Security")
def test_can_view_changes_shared_queue():
    client = world(bookings=[{"request_id": 5, "event_id": 1, "venue_staff_id": None}])
    assert ec.can_view_changes(client, EVENT, {**VENUE_STAFF, "id": "v9"})
    assert not ec.can_view_changes(client, EVENT, TECH)


@tc("BE-EVCHG-016", "event_change_log", "The assigned coordinator opens an event's change history.",
    "Entries are returned newest first with the name of the user who made each change; unknown actors have no name.",
    pre="Two log entries: an ordinary edit by c1 and a significant change by a removed user.", steps="1. Call event_change_log(1) as c1.")
def test_change_log_lists_entries(use_db):
    use_db(world(log=[
        {"id": 1, "event_id": 1, "change_type": "Ordinary", "changed_by": "c1", "created_at": "2026-10-01T00:00:00Z"},
        {"id": 2, "event_id": 1, "change_type": "Significant", "changed_by": "gone", "created_at": "2026-10-02T00:00:00Z"},
        {"id": 3, "event_id": 2, "change_type": "Ordinary", "changed_by": "c1", "created_at": "2026-10-03T00:00:00Z"},
    ]), ec)
    out = ec.event_change_log(1, COORDINATOR)
    assert [(entry["id"], entry["changed_by_name"]) for entry in out] == [(2, None), (1, "Bob")]


@tc("BE-EVCHG-017", "event_change_log", "An event has no recorded changes, or a change has no recorded actor.",
    "An empty list is returned; an entry without an actor has no name and no user lookup is made.",
    steps="1. Call event_change_log with an empty log. 2. Add an entry without changed_by and call again.", kind="Edge")
def test_change_log_empty_and_anonymous(use_db):
    client = use_db(world(), ec)
    assert ec.event_change_log(1, ORGANISER) == []
    client.tables["event_change_log"] = [{"id": 1, "event_id": 1, "changed_by": None, "created_at": "2026-10-01T00:00:00Z"}]
    assert ec.event_change_log(1, ORGANISER)[0]["changed_by_name"] is None
    assert not [entry for entry in client.log if entry[0] == "users"]


@tc("BE-EVCHG-018", "event_change_log", "A user asks for history of a missing event or one they do not work on.",
    "HTTP 404 for the missing event; HTTP 403 for an attendee.", steps="1. Request event 99. 2. Request event 1 as an attendee.", kind="Security")
def test_change_log_access_errors(use_db):
    use_db(world(), ec)
    assert err(ec.event_change_log, 99, COORDINATOR) == (404, "Event not found.")
    assert err(ec.event_change_log, 1, ATTENDEE) == (403, "You do not have access to this event's change history.")


# ---- processing (44.4) -----------------------------------------------------------------
@tc("BE-EVCHG-019", "process_event_change_request", "The assigned coordinator processes an approved change request.",
    "The processing RPC is called with the request and the caller's id, and its result (updated request and new venue/equipment requests) is returned.",
    steps="1. Stub the RPC. 2. Call process_event_change_request(11) as c1.")
def test_process_calls_rpc(use_db, monkeypatch):
    client = use_db(world(), ec)
    calls = []
    result = {"change_request": {"id": 11, "processing_status": "Processed"}, "venue_requests": [{"request_id": 31}], "equipment_requests": []}

    def rpc(name, params):
        calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=result))

    monkeypatch.setattr(client, "rpc", rpc)
    assert ec.process_event_change_request(11, COORDINATOR) == result
    assert calls == [("process_event_change_request", {"p_request_id": 11, "p_coordinator_id": "c1"})]


@tc("BE-EVCHG-020", "process_event_change_request", "The processing RPC rejects the request.",
    "Missing → HTTP 404, another coordinator's request → HTTP 403, not approved / already processed / nothing to process → HTTP 409, each with the database message.",
    data="P0002, 42501, 55000", steps="1. Make the RPC raise each mapped error. 2. Call the route.", kind="Negative")
def test_process_maps_database_errors(use_db, monkeypatch):
    client = use_db(world(), ec)
    for code, status in (("P0002", 404), ("42501", 403), ("55000", 409)):
        monkeypatch.setattr(client, "rpc", rpc_raising(code, f"Message {code}"))
        assert err(ec.process_event_change_request, 11, COORDINATOR) == (status, f"Message {code}")


@tc("BE-EVCHG-021", "process_event_change_request", "The processing RPC fails unexpectedly or returns nothing.",
    "An unmapped database error propagates to the API error handler; an empty result is HTTP 500.",
    steps="1. Raise an unknown APIError. 2. Return no data.", kind="Negative")
def test_process_unexpected_failures(use_db, monkeypatch):
    client = use_db(world(), ec)
    monkeypatch.setattr(client, "rpc", rpc_raising("XX000", "Database unavailable."))
    with pytest.raises(APIError, match="Database unavailable"):
        ec.process_event_change_request(11, COORDINATOR)
    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(execute=lambda: SimpleNamespace(data=None)))
    assert err(ec.process_event_change_request, 11, COORDINATOR) == (500, "Event change request could not be processed.")
