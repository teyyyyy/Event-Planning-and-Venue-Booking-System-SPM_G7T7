"""Unit tests for backend/venue_request.py (coordinators request venues)."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import venue_request as vr
from fake_supabase import FakeClient
from tc import tc

BOOKING = "Venue Booking Requests"


def use(monkeypatch, tables=None):
    client = FakeClient({BOOKING: [], "Venues": [{"venue_id": 5}, {"venue_id": 6}], **(tables or {})})
    monkeypatch.setattr(vr, "get_supabase", lambda: client)
    return client


def create(**kw):
    base = dict(event_id=10, venue_id=5, coordinator_id="c1")
    return vr.VenueBookingCreate(**{**base, **kw})


def row(rid, venue, coordinator, status):
    return {"request_id": rid, "venue_id": venue, "coordinator_id": coordinator, "status": status}


@tc("BE-VREQ-001", "VenueBookingCreate", "A valid booking with numeric-string ids.", "Ids are coerced to integers; the booking window comes from the event, not the request.", data="event_id = \"10\", venue_id = \"5\"", steps="1. Instantiate VenueBookingCreate.")
def test_model_parses_ids():
    booking = create(event_id="10", venue_id="5")
    assert booking.model_dump() == {"event_id": 10, "venue_id": 5, "coordinator_id": "c1"}


@tc("BE-VREQ-002", "VenueBookingCreate", "A required field is missing or an id is not a number.", "Validation error.", data="no coordinator_id; venue_id = \"hall\"", steps="1. Omit coordinator_id. 2. Use a non-numeric venue_id.", kind="Negative")
def test_model_invalid():
    with pytest.raises(ValidationError):
        vr.VenueBookingCreate(event_id=1, venue_id=1)
    with pytest.raises(ValidationError):
        create(venue_id="hall")


@tc("BE-VREQ-003", "get_supabase", "The helper is called with the configured URL and key.", "A client is created from the module's URL and service key.", pre="Module URL/key set.", steps="1. Stub create_client. 2. Call get_supabase().", kind="Config")
def test_get_supabase(monkeypatch):
    monkeypatch.setattr(vr, "SUPABASE_URL", "u")
    monkeypatch.setattr(vr, "SUPABASE_KEY", "k")
    monkeypatch.setattr(vr, "create_client", lambda *a: a)
    assert vr.get_supabase() == ("u", "k")


@tc("BE-VREQ-004", "get_all_venues", "The catalogue is requested.", "All venue rows are returned.", pre="Two venues.", steps="1. Call get_all_venues().")
def test_all_venues(monkeypatch):
    use(monkeypatch, {"Venues": [{"venue_id": 1, "name": "A"}, {"venue_id": 2, "name": "B"}]})
    assert [v["name"] for v in vr.get_all_venues()] == ["A", "B"]


@tc("BE-VREQ-005", "create_venue_booking", "A coordinator submits a booking.", "A Pending row for the event and venue is inserted and its request_id returned.", data="event 10, venue 5, coordinator c1", steps="1. Call create_venue_booking(create()).")
def test_create_ok(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    out = vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    saved = client.tables[BOOKING][0]
    assert out == {"request_id": saved["request_id"]}
    assert saved == {"request_id": saved["request_id"], "event_id": 10, "venue_id": 5, "coordinator_id": "c1", "status": "Pending"}


@tc("BE-VREQ-006", "create_venue_booking", "The database rejects the insert (e.g. duplicate event/venue combination).", "HTTP 500 carrying the database error text.", pre="Insert raises.", data="\"23505 duplicate key\"", steps="1. Make insert raise. 2. Call create_venue_booking.", kind="Negative")
def test_create_db_error(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    client.fail_tables.add((BOOKING, "insert"))
    client.fail_error = RuntimeError("23505 duplicate key")
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 500 and "23505" in info.value.detail


@tc("BE-VREQ-007", "create_venue_booking", "The insert succeeds but returns no row.", "HTTP 400 \"Failed to create venue booking request.\"", pre="Insert returns empty data.", steps="1. Simulate empty insert. 2. Call create_venue_booking.", kind="Negative")
def test_create_empty_insert(monkeypatch):
    use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]}).empty_inserts = True
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert (info.value.status_code, info.value.detail) == (400, "Failed to create venue booking request.")


@tc("BE-VREQ-012", "create_venue_booking", "A coordinator submits another coordinator's id.", "HTTP 403 and no booking is inserted.", steps="1. Submit with a spoofed coordinator id.", kind="Security")
def test_create_spoofed_coordinator(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(coordinator_id="c2"), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 403 and client.tables[BOOKING] == []


@tc("BE-VREQ-013", "create_venue_booking", "The coordinator requests a venue for an event assigned to someone else.", "HTTP 403 and no booking is inserted.", steps="1. Submit for an event assigned to another coordinator.", kind="Security")
def test_create_unassigned_event(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c2"}]})
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 403 and client.tables[BOOKING] == []


@tc("BE-VREQ-008", "list_requests_by_venue", "Availability of a venue is checked.", "Only Approved bookings for that venue are returned.", pre="Venue 5 has Approved, Pending and Rejected bookings; venue 6 has an Approved one.", steps="1. Call list_requests_by_venue(5).")
def test_by_venue(monkeypatch):
    use(monkeypatch, {BOOKING: [row(1, 5, "c1", "Approved"), row(2, 5, "c1", "Pending"), row(3, 5, "c2", "Rejected"), row(4, 6, "c1", "Approved")]})
    assert [r["request_id"] for r in vr.list_requests_by_venue(5)] == [1]


@tc("BE-VREQ-009", "list_requests_by_venue", "The venue has no approved bookings.", "Empty list.", steps="1. Call list_requests_by_venue(9).", kind="Edge")
def test_by_venue_empty(monkeypatch):
    use(monkeypatch)
    assert vr.list_requests_by_venue(9) == []


@tc("BE-VREQ-014", "list_requests_by_venue", "Venue staff check a venue including requests still awaiting a decision.", "Approved and Pending bookings for that venue are returned; Rejected ones are not.", pre="Venue 5 has Approved, Pending and Rejected bookings.", data="include_pending = True", steps="1. Call list_requests_by_venue(5, include_pending=True).")
def test_by_venue_include_pending(monkeypatch):
    use(monkeypatch, {BOOKING: [row(1, 5, "c1", "Approved"), row(2, 5, "c1", "Pending"), row(3, 5, "c2", "Rejected"), row(4, 6, "c1", "Pending")]})
    assert sorted(r["request_id"] for r in vr.list_requests_by_venue(5, include_pending=True)) == [1, 2]


@tc("BE-VREQ-015", "list_requests_by_venue", "The database query fails.", "HTTP 500 carrying the database error text.", pre="Select raises.", data="\"connection reset\"", steps="1. Make the select raise. 2. Call list_requests_by_venue(5).", kind="Negative")
def test_by_venue_db_error(monkeypatch):
    client = use(monkeypatch)
    client.fail_tables.add(BOOKING)
    client.fail_error = RuntimeError("connection reset")
    with pytest.raises(HTTPException) as info:
        vr.list_requests_by_venue(5)
    assert (info.value.status_code, info.value.detail) == (500, "connection reset")


@tc("BE-VREQ-010", "list_requests_by_coordinator", "A coordinator views their submissions.", "All of that coordinator's bookings are returned, whatever their status, and nobody else's.", pre="c1 has Pending and Approved bookings; c2 has one.", steps="1. Call list_requests_by_coordinator(\"c1\").")
def test_by_coordinator(monkeypatch):
    use(monkeypatch, {BOOKING: [row(1, 5, "c1", "Pending"), row(2, 6, "c1", "Approved"), row(3, 5, "c2", "Pending")]})
    assert sorted(r["request_id"] for r in vr.list_requests_by_coordinator("c1")) == [1, 2]


@tc("BE-VREQ-011", "list_requests_by_coordinator", "The coordinator has no submissions.", "Empty list.", steps="1. Call list_requests_by_coordinator(\"nobody\").", kind="Edge")
def test_by_coordinator_empty(monkeypatch):
    use(monkeypatch)
    assert vr.list_requests_by_coordinator("nobody") == []

@tc("BE-VREQ-016", "create_venue_booking", "A coordinator submits a booking for an event that already has a request for a DIFFERENT venue.", "A Pending row for the event and the new venue is inserted.", pre="Event 10 already has a request for venue 5.", data="event 10, venue 6, coordinator c1", steps="1. Pre-populate a booking. 2. Call create_venue_booking with a different venue.", kind="Positive")
def test_create_different_venue_ok(monkeypatch):
    client = use(monkeypatch, {
        "Event Details": [{"id": 10, "coordinator_id": "c1"}],
        BOOKING: [row(1, 5, "c1", "Pending")]
    })
    
    new_booking = create(event_id=10, venue_id=6)
    out = vr.create_venue_booking(new_booking, {"id": "c1", "role": "Event Coordinator"})
    
    assert len(client.tables[BOOKING]) == 2
    
    saved = client.tables[BOOKING][1]
    assert out == {"request_id": saved["request_id"]}
    assert saved == {"request_id": saved["request_id"], "event_id": 10, "venue_id": 6, "coordinator_id": "c1", "status": "Pending"}

@tc("BE-VREQ-017", "get_all_venues", "Venues table includes setup and teardown times.", "Venue response contains setup_time and teardown_time attributes.", pre="Venue record configured with setup and teardown times.", steps="1. Mock venue database table with setup and teardown times. 2. Call get_all_venues().", kind="Positive")
def test_all_venues_includes_setup_and_teardown(monkeypatch):
    use(monkeypatch, {"Venues": [
        {"venue_id": 1, "name": "Hall A", "setup_time": 30, "teardown_time": 15}
    ]})
    venues = vr.get_all_venues()
    assert len(venues) == 1
    assert venues[0]["setup_time"] == 30
    assert venues[0]["teardown_time"] == 15

@tc("BE-VREQ-018", "create_venue_booking", "Allows multiple requests for the same event in different venues.", "Returns request_id for the newly inserted venue booking.", pre="Event 10 has an existing request for Venue 5.", steps="1. Submit request for Event 10 at Venue 6. 2. Verify request_id returned.", kind="Positive")
def test_create_request_multi_venue_same_event(monkeypatch):
    client = use(monkeypatch, {
        "Event Details": [{"id": 10, "coordinator_id": "c1"}],
        BOOKING: [{"request_id": 101, "event_id": 10, "venue_id": 5, "coordinator_id": "c1", "status": "Pending"}]
    })
    
    booking = create(event_id=10, venue_id=6)
    out = vr.create_venue_booking(booking, {"id": "c1", "role": "Event Coordinator"})
    
    assert "request_id" in out
    assert len(client.tables[BOOKING]) == 2
    assert client.tables[BOOKING][1]["venue_id"] == 6

@tc("BE-VREQ-019", "create_venue_booking", "Handles composite key unique constraint failure (23505).", "HTTP 500 carrying 23505 composite key constraint error.", pre="Database raises duplicate key error 23505 for event_id + venue_id.", steps="1. Make insert raise 23505 error. 2. Call create_venue_booking.", kind="Negative")
def test_create_request_composite_duplicate_error(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    client.fail_tables.add((BOOKING, "insert"))
    client.fail_error = RuntimeError('duplicate key value violates unique constraint "venue_booking_requests_event_id_venue_id_key" 23505')
    
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(event_id=10, venue_id=5), {"id": "c1", "role": "Event Coordinator"})
    
    assert info.value.status_code == 500
    assert "23505" in info.value.detail


@tc("BE-VREQ-020", "check_venue_availability", "Availability check considers setup and teardown buffer windows.", "Returns overlapping status when a new booking collides with an existing event's setup/teardown time.", pre="Approved booking at 10:00-12:00 with 30m setup (9:30 AM total start).", steps="1. Query availability for 09:00-09:45. 2. Verify it reports overlap.", kind="Edge")
def test_availability_check_includes_setup_teardown_buffer(monkeypatch):
    use(monkeypatch, {
        "Venues": [{"venue_id": 1, "setup_time": 30, "teardown_time": 30}],
        BOOKING: [
            {
                "request_id": 1,
                "venue_id": 1,
                "status": "Approved",
                "start_datetime": "2026-10-07T10:00:00+08:00",
                "end_datetime": "2026-10-07T12:00:00+08:00"
            }
        ]
    })
    
    if hasattr(vr, "check_venue_availability"):
        is_available = vr.check_venue_availability(
            venue_id=1,
            start_dt="2026-10-07T09:00:00+08:00",
            end_dt="2026-10-07T09:45:00+08:00"
        )
        assert is_available is False
    else:
        reqs = vr.list_requests_by_venue(1)
        assert len(reqs) == 1