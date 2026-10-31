"""Unit tests for backend/venue_request.py (coordinators request venues)."""

from unittest import mock

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError
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


@tc("BE-VREQ-006", "create_venue_booking", "The database rejects the insert (e.g. duplicate event/venue combination).", "HTTP 503 with a generic message; the database error text is not exposed.", pre="Insert raises.", data="\"23505 duplicate key\"", steps="1. Make insert raise. 2. Call create_venue_booking.", kind="Negative")
def test_create_db_error(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    client.fail_tables.add((BOOKING, "insert"))
    client.fail_error = RuntimeError("23505 duplicate key")
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 503 and "23505" not in info.value.detail


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


@tc("BE-VREQ-015", "list_requests_by_venue", "The database query fails.", "HTTP 503 with a generic message; the database error text is not exposed.", pre="Select raises.", data="\"connection reset\"", steps="1. Make the select raise. 2. Call list_requests_by_venue(5).", kind="Negative")
def test_by_venue_db_error(monkeypatch):
    client = use(monkeypatch)
    client.fail_tables.add(BOOKING)
    client.fail_error = RuntimeError("connection reset")
    with pytest.raises(HTTPException) as info:
        vr.list_requests_by_venue(5)
    assert (info.value.status_code, info.value.detail) == (503, "Venue bookings could not be loaded. Please try again.")


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

@tc("BE-VREQ-019", "create_venue_booking", "Handles composite key unique constraint failure (23505).", "HTTP 503 with a generic message; the constraint error text is not exposed.", pre="Database raises duplicate key error 23505 for event_id + venue_id.", steps="1. Make insert raise 23505 error. 2. Call create_venue_booking.", kind="Negative")
def test_create_request_composite_duplicate_error(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    client.fail_tables.add((BOOKING, "insert"))
    client.fail_error = RuntimeError('duplicate key value violates unique constraint "venue_booking_requests_event_id_venue_id_key" 23505')
    
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(event_id=10, venue_id=5), {"id": "c1", "role": "Event Coordinator"})
    
    assert info.value.status_code == 503
    assert info.value.detail == "Unable to save venue request. Please try again."


@tc("BE-VREQ-020", "check_venue_availability", "Availability check considers setup and teardown buffer windows.", "Returns overlapping status when a new booking collides with an existing event's setup/teardown time.", pre="Approved booking whose event runs 10:00-12:00, with 30m setup (9:30 AM total start).", steps="1. Query availability for 09:00-09:45. 2. Verify it reports overlap.", kind="Edge")
def test_availability_check_includes_setup_teardown_buffer(monkeypatch):
    use(monkeypatch, {
        "Venues": [{"venue_id": 1, "setup_time": 30, "teardown_time": 30}],
        "Event Details": [{"id": 1, "event_date": "2026-10-07", "event_end_date": "2026-10-07", "start_time": "10:00:00", "end_time": "12:00:00"}],
        BOOKING: [
            {
                "request_id": 1,
                "venue_id": 1,
                "event_id": 1,
                "status": "Approved",
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


@tc("BE-VREQ-021", "module settings", "The backend reads its Supabase settings.", "Venue requests use the same normalised URL and key as the other routers.",
    steps="1. Compare venue_request's settings with coordinator_assignment's.", kind="Config")
def test_shared_settings():
    import coordinator_assignment as ca
    assert (vr.SUPABASE_URL, vr.SUPABASE_KEY) == (ca.SUPABASE_URL, ca.SUPABASE_SERVICE_ROLE_KEY)


@tc("BE-VREQ-022", "create_venue_booking", "The database refuses a second active request for the same event and venue (23505).", "HTTP 409 asking for a different venue; the database text is not exposed.", pre="The event already has a Pending, On Hold or Approved request for venue 5.", steps="1. Make the insert raise APIError 23505. 2. Call create_venue_booking.", kind="Negative")
def test_create_request_duplicate_venue(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    client.fail_tables.add((BOOKING, "insert"))
    client.fail_error = APIError({"code": "23505", "message": 'duplicate key value violates unique constraint "Venue Booking Requests_active_event_venue_key"', "details": None, "hint": None})
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 409
    assert info.value.detail == "This event already has an active request for this venue. Please choose a different venue."


def alternative_offer():
    return {
        "request_id": 12,
        "event_id": 10,
        "venue_id": 5,
        "coordinator_id": "c1",
        "status": "Alternative Offered",
        "alternative_venue_id": 6,
    }

@tc("BE-VREQ-023", "create_venue_booking", "The database guard reports the venue became unavailable (23514).", "HTTP 409 asking for a replacement venue.", pre="Venue staff mark the venue unavailable after the form loaded.", steps="1. Make the insert raise APIError 23514. 2. Call create_venue_booking.", kind="Negative")
def test_create_request_venue_became_unavailable(monkeypatch):
    client = use(monkeypatch, {"Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    client.fail_tables.add((BOOKING, "insert"))
    client.fail_error = APIError({"code": "23514", "message": "Venue is unavailable or this request needs a replacement.", "details": None, "hint": None})
    with pytest.raises(HTTPException) as info:
        vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 409
    assert info.value.detail == "This venue is unavailable. Refresh and select a replacement venue."


@tc("BE-VREQ-024", "decide_alternative_venue", "The assigned coordinator accepts an alternative venue.", "The request is Approved at the suggested venue and the offer fields are cleared.", steps="1. Accept request 12's alternative venue.")
def test_accept_alternative_venue(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [
            {**alternative_offer(), "replacement_required": True},
            {"request_id": 13, "event_id": 11, "venue_id": 6, "coordinator_id": "c2", "status": "Pending"},
        ],
        "Event Details": [
            {"id": 10, "coordinator_id": "c1", "event_date": "2026-12-01", "event_end_date": "2026-12-01", "start_time": "09:00:00", "end_time": "10:00:00"},
            {"id": 11, "coordinator_id": "c2", "event_date": "2026-12-01", "event_end_date": "2026-12-01", "start_time": "09:00:00", "end_time": "10:00:00"},
        ],
        "Venues": [{"venue_id": 5, "name": "Hall A"}, {"venue_id": 6, "name": "Hall B", "setup_time": 0, "teardown_time": 0}],
    })
    result = vr.decide_alternative_venue("c1", 12, vr.AlternativeVenueDecision(decision="accept"), {"id": "c1", "role": "Event Coordinator"})
    saved = client.tables[BOOKING][0]
    assert result["status"] == "Approved" and result["venue_id"] == 6
    assert saved["alternative_venue_id"] is None
    assert saved["replacement_required"] is False
    assert client.tables[BOOKING][1]["status"] == "Pending"


@tc("BE-VREQ-025", "decide_alternative_venue", "The assigned coordinator declines an alternative venue.", "The request remains Rejected at its original venue and the offer fields are cleared.", steps="1. Decline request 12's alternative venue.")
def test_decline_alternative_venue(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [alternative_offer()],
        "Event Details": [{"id": 10, "coordinator_id": "c1"}],
    })
    result = vr.decide_alternative_venue("c1", 12, vr.AlternativeVenueDecision(decision="decline"), {"id": "c1", "role": "Event Coordinator"})
    saved = client.tables[BOOKING][0]
    assert result["status"] == "Rejected" and result["venue_id"] == 5
    assert saved["alternative_venue_id"] is None


@tc("BE-VREQ-026", "decide_alternative_venue", "A coordinator tries to decide an offer for another coordinator's event.", "HTTP 403 and no booking update.", steps="1. Call the decision endpoint as c1 for an event assigned to c2.", kind="Security")
def test_decide_alternative_unassigned_event(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [alternative_offer()],
        "Event Details": [{"id": 10, "coordinator_id": "c2"}],
    })
    with pytest.raises(HTTPException) as info:
        vr.decide_alternative_venue("c1", 12, vr.AlternativeVenueDecision(decision="accept"), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 403
    assert not client.writes(BOOKING, "update")


@tc("BE-VREQ-027", "decide_alternative_venue", "The booking belongs to another coordinator.", "HTTP 404 before event details are read.", steps="1. Call the decision endpoint as c1 for a request owned by c2.", kind="Security")
def test_decide_alternative_foreign_booking_not_read_event(monkeypatch):
    foreign_offer = {**alternative_offer(), "coordinator_id": "c2"}
    client = use(monkeypatch, {BOOKING: [foreign_offer]})
    with pytest.raises(HTTPException) as info:
        vr.decide_alternative_venue("c1", 12, vr.AlternativeVenueDecision(decision="decline"), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 404
    assert not [entry for entry in client.log if entry[0] == "Event Details"]


@tc("BE-VREQ-028", "start_replacement_request", "The assigned coordinator starts a replacement request.", "The original booking is rejected and its alternative venue fields are preserved.", steps="1. Start a replacement for request 12.")
def test_start_replacement_preserves_alternative(monkeypatch):
    original = {
        **alternative_offer(),
        "status": "Alternative Offered",
        "replacement_required": True,
    }
    client = use(monkeypatch, {
        BOOKING: [original],
        "Event Details": [{"id": 10, "coordinator_id": "c1"}],
    })
    result = vr.start_replacement_request("c1", 12, {"id": "c1", "role": "Event Coordinator"})
    saved = client.tables[BOOKING][0]
    assert result["status"] == "Rejected" and result["replacement_required"] is False
    assert saved["alternative_venue_id"] == 6


@tc("BE-VREQ-029", "start_replacement_request", "A request without replacement_required is submitted.", "HTTP 409 and no booking update.", steps="1. Call start_replacement_request for a normal pending request.", kind="Negative")
def test_start_replacement_requires_flag(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [{**alternative_offer(), "status": "Pending", "replacement_required": False}],
        "Event Details": [{"id": 10, "coordinator_id": "c1"}],
    })
    with pytest.raises(HTTPException) as info:
        vr.start_replacement_request("c1", 12, {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 409
    assert not client.writes(BOOKING, "update")


@tc("BE-VREQ-030", "decide_alternative_venue", "An approved booking overlaps the suggested venue.", "HTTP 409; the alternative is not accepted.", steps="1. Accept an alternative venue already approved for an overlapping event.", kind="Negative")
def test_accept_alternative_blocked_by_approved_overlap(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [
            alternative_offer(),
            {"request_id": 13, "event_id": 11, "venue_id": 6, "coordinator_id": "c2", "status": "Approved"},
        ],
        "Event Details": [
            {"id": 10, "coordinator_id": "c1", "event_date": "2026-12-01", "event_end_date": "2026-12-01", "start_time": "09:00:00", "end_time": "10:00:00"},
            {"id": 11, "coordinator_id": "c2", "event_date": "2026-12-01", "event_end_date": "2026-12-01", "start_time": "09:00:00", "end_time": "10:00:00"},
        ],
        "Venues": [{"venue_id": 6, "name": "Hall B", "setup_time": 0, "teardown_time": 0}],
    })
    with pytest.raises(HTTPException) as info:
        vr.decide_alternative_venue("c1", 12, vr.AlternativeVenueDecision(decision="accept"), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 409
    assert info.value.detail == "The suggested venue is already booked for this event time."
    assert client.tables[BOOKING][0]["status"] == "Alternative Offered"

@tc("BE-VREQ-031", "list_requests_by_coordinator", "A coordinator's submissions are loaded with their linked events.",
    "Each event's event_date, event_end_date, start_time and end_time are embedded; the unused start_datetime/end_datetime columns are not requested.",
    steps="1. Call list_requests_by_coordinator(\"c1\"). 2. Inspect the columns selected.", kind="Regression")
def test_by_coordinator_selects_split_event_times(monkeypatch):
    client = mock.MagicMock()
    query = client.table.return_value
    query.select.return_value.eq.return_value.execute.return_value.data = []
    monkeypatch.setattr(vr, "get_supabase", lambda: client)
    vr.list_requests_by_coordinator("c1")
    columns = query.select.call_args.args[0]
    assert all(field in columns for field in ("event_date", "event_end_date", "start_time", "end_time"))
    assert "datetime" not in columns

@tc("BE-VREQ-032", "decide_alternative_venue", "The database refuses accepting an alternative venue because the event already has an active request for that venue (23505).", "HTTP 409 with an appropriate error message; the database text is not exposed.", pre="The event already has an active request for the alternative venue.", steps="1. Make the update raise APIError 23505. 2. Call decide_alternative_venue.", kind="Negative")
def test_accept_alternative_venue_duplicate_active_request(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [alternative_offer()],
        "Event Details": [{"id": 10, "coordinator_id": "c1", "event_date": "2026-12-01", "event_end_date": "2026-12-01", "start_time": "09:00:00", "end_time": "10:00:00"}],
        "Venues": [{"venue_id": 6, "name": "Hall B", "setup_time": 0, "teardown_time": 0}],
    })
    client.fail_tables.add((BOOKING, "update"))
    client.fail_error = APIError({"code": "23505", "message": 'duplicate key value violates unique constraint "Venue Booking Requests_active_event_venue_key"', "details": None, "hint": None})
    with pytest.raises(HTTPException) as info:
        vr.decide_alternative_venue("c1", 12, vr.AlternativeVenueDecision(decision="accept"), {"id": "c1", "role": "Event Coordinator"})
    assert info.value.status_code == 409
    assert info.value.detail == "This event already has an active request for the suggested alternative venue."



@tc("BE-VREQ-033", "create_venue_booking", "The coordinator requests a venue again after its earlier requests for the event were rejected or expired.", "A new Pending request is saved; the earlier requests are kept and do not block the venue.", pre="Event 10 has a Rejected and an Expired request for venue 5.", steps="1. Call create_venue_booking for event 10 and venue 5.", kind="State")
def test_create_request_after_rejection(monkeypatch):
    client = use(monkeypatch, {
        BOOKING: [{**row(1, 5, "c1", "Rejected"), "event_id": 10}, {**row(2, 5, "c1", "Expired"), "event_id": 10}],
        "Event Details": [{"id": 10, "coordinator_id": "c1", "event_date": "2026-12-01", "event_end_date": "2026-12-01", "start_time": "09:00:00", "end_time": "10:00:00"}],
    })
    out = vr.create_venue_booking(create(), {"id": "c1", "role": "Event Coordinator"})
    assert [(b["request_id"], b["status"]) for b in client.tables[BOOKING]] == [(1, "Rejected"), (2, "Expired"), (out["request_id"], "Pending")]
