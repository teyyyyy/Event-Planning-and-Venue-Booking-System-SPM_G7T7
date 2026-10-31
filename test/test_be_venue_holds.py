"""Unit tests for tentative venue holds (stories 22.1 and 22.2).

Covers backend/venue_holds.py and the hold-aware parts of venue_approval.py, venue_request.py and
event_changes.py. The database functions that place, remove, remind and expire holds are verified
against PostgreSQL by test/venue_holds_sql.mjs.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

import event_changes as ec
import venue_approval as va
import venue_holds as vh
import venue_request as vr
from fake_supabase import FakeClient
from tc import tc

BOOKING = "Venue Booking Requests"
STAFF = {"id": "staff-1", "role": "Venue Staff"}
COORDINATOR = {"id": "c1", "role": "Event Coordinator"}


def at(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


def event(event_id, day="2099-03-01", start="10:00:00", end="12:00:00", **extra):
    return {"id": event_id, "event_name": f"Event {event_id}", "event_date": day, "event_end_date": day,
            "start_time": start, "end_time": end, "coordinator_id": "c1", **extra}


def booking(request_id, event_id, status="Pending", venue_id=1, **extra):
    return {"request_id": request_id, "event_id": event_id, "venue_id": venue_id, "status": status,
            "venue_staff_id": "staff-1", "coordinator_id": "c1", **extra}


def world(monkeypatch, events=(), bookings=(), venues=None):
    client = FakeClient({
        "Event Details": list(events), BOOKING: list(bookings),
        "Venues": venues if venues is not None else [{"venue_id": 1, "name": "Hall A", "setup_time": 60, "teardown_time": 30},
                                                     {"venue_id": 2, "name": "Hall B"}],
        "users": [{"id": "c1", "name": "Cara", "email": "c@x"}],
    })
    for module, name in ((va, "db"), (vh, "db"), (vr, "get_supabase")):
        monkeypatch.setattr(module, name, lambda client=client: client)
    return client


def stub_rpc(client, data=None, error=None):
    calls = []

    def rpc(name, params):
        calls.append((name, params))

        def execute():
            if error:
                raise APIError({"message": error[1], "code": error[0], "details": None, "hint": None})
            return SimpleNamespace(data=data)
        return SimpleNamespace(execute=execute)
    client.rpc = rpc
    return calls


def err(fn, *args, **kwargs):
    with pytest.raises(HTTPException) as info:
        fn(*args, **kwargs)
    return info.value.status_code, info.value.detail


# ---- hold state ------------------------------------------------------------------------------

@tc("BE-VHOLD-001", "effective_status", "Bookings are read with active, overdue and missing hold expiries.",
    "An unexpired hold stays On Hold; a hold past or without its expiry reads as Expired; other statuses are unchanged.",
    data="On Hold +1h, On Hold -1m, On Hold no expiry, Approved, Pending", steps="1. Call effective_status for each booking.", kind="Edge")
def test_effective_status():
    assert vh.effective_status({"status": "On Hold", "hold_expires_at": at(hours=1)}) == "On Hold"
    assert vh.effective_status({"status": "On Hold", "hold_expires_at": at(minutes=-1)}) == "Expired"
    assert vh.effective_status({"status": "On Hold", "hold_expires_at": None}) == "Expired"
    assert vh.effective_status({"status": "Approved"}) == "Approved"
    assert vh.effective_status({"status": "Pending", "hold_expires_at": at(minutes=-1)}) == "Pending"


@tc("BE-VHOLD-002", "blocks_venue", "Bookings in each state are checked for whether they make the venue unavailable.",
    "Only confirmed (Approved) bookings and unexpired holds block the venue.",
    data="Approved, On Hold +1h, On Hold -1m, Expired, Pending, Rejected", steps="1. Call blocks_venue for each booking.")
def test_blocks_venue():
    assert vh.blocks_venue({"status": "Approved"})
    assert vh.blocks_venue({"status": "On Hold", "hold_expires_at": at(hours=1)})
    assert not vh.blocks_venue({"status": "On Hold", "hold_expires_at": at(minutes=-1)})
    for status in ("Expired", "Pending", "Rejected"):
        assert not vh.blocks_venue({"status": status, "hold_expires_at": at(hours=1)})


@tc("BE-VHOLD-003", "hold_fields / buffered", "A hold is shown, and a booked period is widened by venue buffers.",
    "The expiry is converted from UTC to SGT; the period gains the venue's setup and teardown minutes (with the alternative column names).",
    data="2099-03-01T02:00Z; setup 60 / teardown 30; setup_minutes 15 / turnaround_time 5", steps="1. Call hold_fields. 2. Call buffered with each venue.")
def test_hold_fields_and_buffers():
    assert vh.hold_fields({"status": "On Hold", "hold_expires_at": "2099-03-01T02:00:00+00:00"}) == {
        "status": "On Hold", "hold_expires_at": "2099-03-01T10:00:00+08:00"}
    assert vh.hold_fields({"status": "Pending"}) == {"status": "Pending", "hold_expires_at": None}
    window = vh.booking_window(event(1))
    assert [t.strftime("%H:%M") for t in vh.buffered(window, {"setup_time": 60, "teardown_time": 30})] == ["09:00", "12:30"]
    assert [t.strftime("%H:%M") for t in vh.buffered(window, {"setup_minutes": 15, "turnaround_time": 5})] == ["09:45", "12:05"]


@tc("BE-VHOLD-004", "find_conflict", "Other requests at the venue overlap the period in different states.",
    "An unexpired hold or confirmed booking overlapping through the setup buffer conflicts; expired holds, pending requests, other venues and the request itself do not.",
    pre="Hall A: setup 60, teardown 30. Requested 10:00-12:00.", data="Other event 12:30-14:00 (its setup starts 11:30)",
    steps="1. Call find_conflict with each competing booking.", kind="Edge")
def test_find_conflict(monkeypatch):
    venue = {"venue_id": 1, "setup_time": 60, "teardown_time": 30}
    window = vh.booking_window(event(1))
    for competing, expected in (
        (booking(2, 2, "On Hold", hold_expires_at=at(days=1)), 2),
        (booking(2, 2, "Approved"), 2),
        (booking(2, 2, "On Hold", hold_expires_at=at(minutes=-1)), None),
        (booking(2, 2, "Expired", hold_expires_at=at(minutes=-1)), None),
        (booking(2, 2, "Pending"), None),
        (booking(2, 2, "Approved", venue_id=2), None),
    ):
        client = world(monkeypatch, [event(1), event(2, start="12:30:00", end="14:00:00")], [booking(1, 1), competing])
        found = vh.find_conflict(client, 1, venue, window)
        assert (found or {}).get("request_id") == expected, competing
    client = world(monkeypatch, [event(1)], [booking(1, 1, "On Hold", hold_expires_at=at(days=1))])
    assert vh.find_conflict(client, 1, venue, window, exclude_request_id=1) is None


@tc("BE-VHOLD-005", "find_conflict", "A hold covers several days of a multi-day event.",
    "A request on the second day conflicts with it; one clear of the buffers on another day does not.",
    data="Hold 2099-02-28 09:00 to 2099-03-02 10:30", steps="1. Call find_conflict for 2099-03-01 and for 2099-03-05.", kind="Edge")
def test_find_conflict_multi_day(monkeypatch):
    retreat = {**event(9, day="2099-02-28", start="09:00:00", end="10:30:00"), "event_end_date": "2099-03-02"}
    client = world(monkeypatch, [retreat], [booking(9, 9, "On Hold", hold_expires_at=at(days=1))])
    venue = {"venue_id": 1}
    assert vh.find_conflict(client, 1, venue, vh.booking_window(event(1)))["request_id"] == 9
    assert vh.find_conflict(client, 1, venue, vh.booking_window(event(1, day="2099-03-05"))) is None


# ---- coordinator venue status ------------------------------------------------------------------

@tc("BE-VHOLD-006", "GET /api/venue-availability", "A coordinator views venue statuses for their event.",
    "Each venue is Confirmed, On Hold (with SGT expiry), Expired or Available for the event's period; a confirmed booking outranks a hold, and the coordinator's own request is flagged.",
    pre="Event 1 10:00-12:00. Hall A: another event's active hold and an expired hold. Hall B: own Approved booking and an active hold. Hall C: free.",
    steps="1. Call venue_availability(1) as coordinator c1.")
def test_venue_availability(monkeypatch):
    venues = [{"venue_id": 1, "name": "A"}, {"venue_id": 2, "name": "B"}, {"venue_id": 3, "name": "C"}, {"venue_id": 4, "name": "D"}]
    events = [event(1), event(2), event(3), event(4, day="2099-04-01")]
    expiry = "2099-02-20T02:00:00+00:00"
    bookings = [
        booking(10, 2, "On Hold", venue_id=1, hold_expires_at=expiry),
        booking(11, 3, "On Hold", venue_id=1, hold_expires_at=at(minutes=-1)),
        booking(12, 1, "Approved", venue_id=2),
        booking(13, 3, "On Hold", venue_id=2, hold_expires_at=expiry),
        booking(14, 4, "Approved", venue_id=3),  # another day
        booking(15, 3, "Expired", venue_id=4, hold_expires_at=at(minutes=-5)),
    ]
    world(monkeypatch, events, bookings, venues)
    statuses = {row["venue_id"]: row for row in vh.venue_availability(1, COORDINATOR)}
    assert statuses[1] == {"venue_id": 1, "status": "On Hold", "hold_expires_at": "2099-02-20T10:00:00+08:00", "request_id": 10, "own_event": False}
    assert (statuses[2]["status"], statuses[2]["own_event"], statuses[2]["hold_expires_at"]) == ("Confirmed", True, None)
    assert statuses[3] == {"venue_id": 3, "status": "Available", "hold_expires_at": None, "request_id": None, "own_event": False}
    assert (statuses[4]["status"], statuses[4]["request_id"]) == ("Expired", 15)


@tc("BE-VHOLD-007", "GET /api/venue-availability", "The event is missing, belongs to another coordinator, or has no times.",
    "HTTP 404, 403 and 400 respectively, with explanatory messages.", data="event 99; event 1 for c2; event 5 without times",
    steps="1. Call venue_availability for each case.", kind="Negative")
def test_venue_availability_errors(monkeypatch):
    world(monkeypatch, [event(1), {**event(5), "start_time": None}])
    assert err(vh.venue_availability, 99, COORDINATOR) == (404, "Event not found.")
    assert err(vh.venue_availability, 1, {"id": "c2"}) == (403, "You can only check venues for events assigned to you.")
    assert err(vh.venue_availability, 5, COORDINATOR)[0] == 400


# ---- placing and removing holds (venue staff) ------------------------------------------------------

@tc("BE-VHOLD-008", "POST /api/venue-booking-requests/{id}/hold", "Venue staff hold a pending request with an expiry entered without a time zone.",
    "place_venue_hold is called with the request, the staff member's verified id and the expiry read as SGT; the On Hold request is returned with its expiry in SGT.",
    data="expires_at = 2099-02-25T18:00", steps="1. Call place_hold(1, expires_at, staff).")
def test_place_hold(monkeypatch):
    client = world(monkeypatch, [event(1)])
    saved = booking(1, 1, "On Hold", hold_expires_at="2099-02-25T10:00:00+00:00", hold_placed_at="2099-02-20T00:00:00+00:00")
    calls = stub_rpc(client, data=saved)
    out = va.place_hold(1, va.HoldDetails(expires_at="2099-02-25T18:00"), STAFF)
    assert calls == [("place_venue_hold", {"p_request_id": 1, "p_staff_id": "staff-1", "p_expires_at": "2099-02-25T18:00:00+08:00"})]
    assert (out["status"], out["hold_expires_at"], out["venue_name"]) == ("On Hold", "2099-02-25T18:00:00+08:00", "Hall A")
    assert out["hold_placed_at"] == "2099-02-20T08:00:00+08:00"


@tc("BE-VHOLD-009", "POST /api/venue-booking-requests/{id}/hold", "The expiry is sent with an explicit offset and the database returns a list.",
    "The offset is kept as given and the first returned row is used.", data="expires_at = 2099-02-25T10:00:00Z",
    steps="1. Call place_hold with a UTC expiry.", kind="Edge")
def test_place_hold_with_offset(monkeypatch):
    client = world(monkeypatch, [event(1)])
    calls = stub_rpc(client, data=[booking(1, 1, "On Hold", hold_expires_at="2099-02-25T10:00:00+00:00")])
    assert va.place_hold(1, va.HoldDetails(expires_at="2099-02-25T10:00:00Z"), STAFF)["status"] == "On Hold"
    assert calls[0][1]["p_expires_at"] == "2099-02-25T10:00:00+00:00"


@tc("BE-VHOLD-010", "hold_action", "The database refuses a hold action.",
    "Not found is 404, another staff member's request 403, an invalid expiry or event time 400, a wrong status or a conflicting booking 409, each with the database message; other errors propagate.",
    data="P0002, 42501, 22023, 55000, 23P01, XX000", steps="1. Make the RPC raise each code. 2. Call place_hold / remove_hold.", kind="Negative")
def test_hold_errors(monkeypatch):
    for code, status in (("P0002", 404), ("42501", 403), ("22023", 400), ("55000", 409), ("23P01", 409)):
        client = world(monkeypatch)
        stub_rpc(client, error=(code, f"message {code}"))
        assert err(va.place_hold, 1, va.HoldDetails(expires_at="2099-02-25T18:00"), STAFF) == (status, f"message {code}")
        assert err(va.remove_hold, 1, STAFF) == (status, f"message {code}")
    stub_rpc(world(monkeypatch), error=("XX000", "internal"))
    with pytest.raises(APIError):
        va.remove_hold(1, STAFF)


@tc("BE-VHOLD-011", "hold_action", "The database returns no row.", "HTTP 500 \"The venue hold could not be saved.\"",
    data="data = None; data = []", steps="1. Make the RPC return nothing. 2. Call place_hold and remove_hold.", kind="Negative")
def test_hold_no_row(monkeypatch):
    for data in (None, []):
        stub_rpc(world(monkeypatch), data=data)
        assert err(va.remove_hold, 1, STAFF) == (500, "The venue hold could not be saved.")


@tc("BE-VHOLD-012", "DELETE /api/venue-booking-requests/{id}/hold", "Venue staff remove an active hold.",
    "remove_venue_hold is called for the staff member and the request is returned as Pending without an expiry.",
    steps="1. Call remove_hold(1, staff).")
def test_remove_hold(monkeypatch):
    client = world(monkeypatch, [event(1)])
    calls = stub_rpc(client, data=booking(1, 1, "Pending"))
    out = va.remove_hold(1, STAFF)
    assert calls == [("remove_venue_hold", {"p_request_id": 1, "p_staff_id": "staff-1"})]
    assert (out["status"], out["hold_expires_at"]) == ("Pending", None)


# ---- approving and rejecting held requests ----------------------------------------------------------

@tc("BE-VHOLD-013", "decide", "Venue staff approve or reject a request that is on hold.",
    "Approval converts the hold into the confirmed booking; rejection releases it. Both are guarded on the On Hold status.",
    pre="Request 1 On Hold until tomorrow; no competing bookings.", steps="1. Approve request 1. 2. Reject a second held request.")
def test_decide_held(monkeypatch):
    held = dict(hold_expires_at=at(days=1))
    client = world(monkeypatch, [event(1), event(2, day="2099-05-01")], [booking(1, 1, "On Hold", **held), booking(2, 2, "On Hold", **held)])
    assert va.approve_request(1, STAFF)["status"] == "Approved"
    assert va.reject_request(2, va.RejectionDetails(reason="Not suitable"), STAFF)["status"] == "Rejected"
    assert [row["status"] for row in client.tables[BOOKING]] == ["Approved", "Rejected"]


@tc("BE-VHOLD-014", "decide", "Venue staff try to approve or reject an expired hold, whether or not the database has marked it yet.",
    "HTTP 409 \"This hold has expired. The event coordinator must submit a new venue request.\" and the request is unchanged.",
    data="On Hold with past expiry; Expired", steps="1. Approve each request. 2. Reject each request.", kind="Negative")
def test_decide_expired(monkeypatch):
    message = "This hold has expired. The event coordinator must submit a new venue request."
    for status in ("On Hold", "Expired"):
        client = world(monkeypatch, [event(1)], [booking(1, 1, status, hold_expires_at=at(minutes=-1))])
        assert err(va.approve_request, 1, STAFF) == (409, message)
        assert err(va.reject_request, 1, None, STAFF) == (409, message)
        assert client.tables[BOOKING][0]["status"] == status


@tc("BE-VHOLD-015", "decide", "Another event holds the venue at an overlapping time, or its hold has expired.",
    "Approval is refused (409, venue on hold) while the other hold is active, and allowed once it has expired.",
    pre="Hall A setup 60. Request 1 10:00-12:00; event 2 12:30-14:00 holds Hall A.", steps="1. Approve with the active hold. 2. Expire it and approve again.")
def test_decide_blocked_by_hold(monkeypatch):
    events = [event(1), event(2, start="12:30:00", end="14:00:00")]
    world(monkeypatch, events, [booking(1, 1), booking(2, 2, "On Hold", hold_expires_at=at(days=1))])
    assert err(va.approve_request, 1, STAFF) == (409, "Cannot approve: Venue is on hold for another event during this time (including setup/teardown buffers).")
    world(monkeypatch, events, [booking(1, 1), booking(2, 2, "On Hold", hold_expires_at=at(minutes=-1))])
    assert va.approve_request(1, STAFF)["status"] == "Approved"


@tc("BE-VHOLD-016", "GET /api/venue-booking-requests", "Venue staff list requests with active and overdue holds.",
    "Active holds show On Hold with their expiry in SGT; an overdue hold already shows Expired.",
    steps="1. Call list_requests(staff).")
def test_staff_list(monkeypatch):
    world(monkeypatch, [event(1), event(2)], [
        booking(1, 1, "On Hold", hold_expires_at="2099-02-25T10:00:00+00:00", created_at="2"),
        booking(2, 2, "On Hold", hold_expires_at=at(minutes=-1), created_at="1"),
    ])
    rows = va.list_requests(STAFF)
    assert [(r["status"], r["hold_expires_at"]) for r in rows][0] == ("On Hold", "2099-02-25T18:00:00+08:00")
    assert rows[1]["status"] == "Expired"


# ---- coordinator requests -------------------------------------------------------------------------

@tc("BE-VHOLD-017", "POST /api/venue-bookings", "A coordinator requests a venue that is held or booked for an overlapping time.",
    "HTTP 409 explains the venue is booked or on hold; nothing is inserted. A request for the same time at an expired hold's venue is accepted.",
    pre="Event 1 (c1) 10:00-12:00; event 2 holds Hall A 11:00-13:00.", steps="1. Request Hall A with the hold active. 2. With an approved booking. 3. With the hold expired.", kind="Negative")
def test_create_blocked(monkeypatch):
    events = [event(1), event(2, start="11:00:00", end="13:00:00")]
    request = vr.VenueBookingCreate(event_id=1, venue_id=1, coordinator_id="c1")
    message = "This venue is already booked or on hold for this event's time. Please choose a different venue."
    for competing in (booking(2, 2, "On Hold", hold_expires_at=at(days=1)), booking(2, 2, "Approved")):
        client = world(monkeypatch, events, [competing])
        assert err(vr.create_venue_booking, request, COORDINATOR) == (409, message)
        assert len(client.tables[BOOKING]) == 1
    client = world(monkeypatch, events, [booking(2, 2, "On Hold", hold_expires_at=at(minutes=-1))])
    assert "request_id" in vr.create_venue_booking(request, COORDINATOR)
    assert len(client.tables[BOOKING]) == 2


@tc("BE-VHOLD-018", "GET /api/venue-booking-requests/venues/{id}", "The calendar and coordinator overlap check read a venue's bookings.",
    "By default, confirmed bookings and active holds are returned (an overdue hold is left out); with include_pending, pending requests and expired holds are added. Statuses are effective and expiries in SGT.",
    pre="Hall A: Approved, active hold, overdue hold, Expired, Pending, Rejected.", steps="1. Call list_requests_by_venue(1). 2. Call it with include_pending=True.")
def test_list_by_venue(monkeypatch):
    world(monkeypatch, bookings=[
        booking(1, 1, "Approved"), booking(2, 2, "On Hold", hold_expires_at="2099-02-25T10:00:00+00:00"),
        booking(3, 3, "On Hold", hold_expires_at=at(minutes=-1)), booking(4, 4, "Expired", hold_expires_at=at(days=-1)),
        booking(5, 5, "Pending"), booking(6, 6, "Rejected"),
    ])
    assert [(r["request_id"], r["status"]) for r in vr.list_requests_by_venue(1)] == [(1, "Approved"), (2, "On Hold")]
    assert vr.list_requests_by_venue(1)[1]["hold_expires_at"] == "2099-02-25T18:00:00+08:00"
    assert [(r["request_id"], r["status"]) for r in vr.list_requests_by_venue(1, include_pending=True)] == [
        (1, "Approved"), (2, "On Hold"), (3, "Expired"), (4, "Expired"), (5, "Pending")]


@tc("BE-VHOLD-019", "GET /api/venue-booking-requests/coordinators/{id}", "A coordinator lists their submissions with an active and an overdue hold.",
    "The active hold shows On Hold with its SGT expiry; the overdue one shows Expired so the coordinator knows to submit a new request.",
    steps="1. Call list_requests_by_coordinator(\"c1\").")
def test_list_by_coordinator(monkeypatch):
    world(monkeypatch, bookings=[booking(1, 1, "On Hold", hold_expires_at="2099-02-25T10:00:00+00:00"),
                                 booking(2, 2, "On Hold", hold_expires_at=at(minutes=-1))])
    rows = vr.list_requests_by_coordinator("c1")
    assert [(r["status"], r["hold_expires_at"]) for r in rows][0] == ("On Hold", "2099-02-25T18:00:00+08:00")
    assert rows[1]["status"] == "Expired"


@tc("BE-VHOLD-020", "live_arrangements", "An event has an expired venue hold and an active one.",
    "The expired hold is history and is not listed as an arrangement a significant change would reopen; the active hold is.",
    steps="1. Call live_arrangements for the event.", kind="Edge")
def test_live_arrangements_skip_expired():
    client = FakeClient({BOOKING: [booking(1, 1, "Expired"), booking(2, 1, "On Hold", venue_id=2)], "Equipment Request": []})
    assert ec.live_arrangements(client, [1])["1"]["venue_requests"] == [{"request_id": 2, "status": "On Hold"}]
