"""Unit tests for backend/venue_approval.py."""

import pytest
from fastapi import HTTPException

import venue_approval as va
from fake_supabase import FakeClient
from tc import tc

STAFF = {"id": "s1", "role": "venue staff"}
BOOKING = {
    "request_id": 1, "venue_id": 5, "event_id": 10, "status": "Pending", "venue_staff_id": "s1", "coordinator_id": "c1",
    "created_at": "2026-09-01T00:00:00+00:00", "start_datetime": "2026-10-03T08:00:00+00:00", "end_datetime": "2026-10-03T18:00:00+00:00",
    "accessibility_required": 1, "layout_required": "Theatre", "facilities_required": ["Parking"],
}
EVENT = {"id": 10, "event_name": "Gala", "event_type": "Dinner", "description": "d", "event_capacity": 100,
         "event_date": "2026-10-03", "event_end_date": "2026-10-05", "start_time": "09:00:00", "end_time": "17:00:00"}
VENUE = {"venue_id": 5, "venue_name": "Hall A"}
USER = {"id": "c1", "name": "Cara", "email": "c@x"}


def err(fn, *a, **kw):
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    return info.value.status_code, info.value.detail


def world(bookings=(BOOKING,), events=(EVENT,), venues=(VENUE,), users=(USER,)):
    return FakeClient({va.BOOKING_TABLE: list(bookings), va.EVENT_TABLE: list(events), va.VENUE_TABLE: list(venues), "users": list(users)})


@tc("BE-VENUE-001", "clean", "Text with surrounding whitespace.", "Trimmed text is returned.", data="\"  hi  \"", steps="1. Call clean(\"  hi  \").")
def test_clean_trims():
    assert va.clean("  hi  ") == "hi"


@tc("BE-VENUE-002", "clean", "None, empty and whitespace-only input.", "None is returned in every case.", data="None, \"\", \"   \"", steps="1. Call clean for each value.", kind="Edge")
def test_clean_blank():
    assert va.clean(None) is None and va.clean("") is None and va.clean("   ") is None


@tc("BE-VENUE-003", "to_sgt", "UTC timestamp is converted.", "Returned as the same instant in +08:00.", data="2026-10-03T08:00:00+00:00", steps="1. Call to_sgt.")
def test_to_sgt():
    assert va.to_sgt("2026-10-03T08:00:00+00:00") == "2026-10-03T16:00:00+08:00"


@tc("BE-VENUE-004", "to_sgt", "Timestamp crosses midnight when converted.", "Date rolls forward into the next day.", data="2026-10-03T20:00:00+00:00", steps="1. Call to_sgt.", kind="Edge")
def test_to_sgt_next_day():
    assert va.to_sgt("2026-10-03T20:00:00+00:00").startswith("2026-10-04T04:00")


@tc("BE-VENUE-005", "to_sgt", "No timestamp is provided.", "None is returned.", data="None", steps="1. Call to_sgt(None).", kind="Edge")
def test_to_sgt_none():
    assert va.to_sgt(None) is None


@tc("BE-VENUE-006", "event_datetime", "Event has date and time.", "Wall-clock value is stamped with +08:00.", data="event_date 2026-10-03, start 09:00:00", steps="1. Call event_datetime(event, \"event_date\", \"start_time\").")
def test_event_datetime():
    assert va.event_datetime(EVENT, "event_date", "start_time") == "2026-10-03T09:00:00+08:00"


@tc("BE-VENUE-007", "event_datetime", "End date column is missing (single-day event).", "Falls back to event_date.", data="no event_end_date", steps="1. Call event_datetime(event, \"event_end_date\", \"end_time\").", kind="Edge")
def test_event_datetime_fallback():
    event = {"event_date": "2026-10-03", "end_time": "17:00:00"}
    assert va.event_datetime(event, "event_end_date", "end_time") == "2026-10-03T17:00:00+08:00"


@tc("BE-VENUE-008", "event_datetime", "Time is missing.", "None is returned.", data="no start_time", steps="1. Call event_datetime on an event without a start time.", kind="Negative")
def test_event_datetime_no_time():
    assert va.event_datetime({"event_date": "2026-10-03"}, "event_date", "start_time") is None


@tc("BE-VENUE-009", "event_accessibility", "Event has accessibility_required.", "That value is returned.", data="accessibility_required = True", steps="1. Call event_accessibility.")
def test_accessibility_primary():
    assert va.event_accessibility({"accessibility_required": True}) is True


@tc("BE-VENUE-010", "event_accessibility", "Only the alternative column \"accessibility\" is present.", "Its value is used.", data="accessibility = False", steps="1. Call event_accessibility.", kind="Edge")
def test_accessibility_secondary():
    assert va.event_accessibility({"accessibility": False}) is False


@tc("BE-VENUE-011", "event_accessibility", "Neither accessibility column has a value.", "None is returned.", steps="1. Call event_accessibility({}).", kind="Edge")
def test_accessibility_none():
    assert va.event_accessibility({}) is None


@tc("BE-VENUE-012", "view", "Booking with a full event, venue and coordinator.", "Response merges booking, event, venue and coordinator; event dates are SGT and multi-day end date is honoured.",
    steps="1. Call view(BOOKING, EVENT, VENUE, users).")
def test_view_full():
    out = va.view(BOOKING, EVENT, VENUE, {"c1": USER})
    assert (out["venue_name"], out["event_name"], out["coordinator_name"]) == ("Hall A", "Gala", "Cara")
    assert (out["start_datetime"], out["end_datetime"]) == ("2026-10-03T09:00:00+08:00", "2026-10-05T17:00:00+08:00")
    assert out["facilities_required"] == ["Parking"] and out["layout_required"] == "Theatre"


@tc("BE-VENUE-013", "view", "Event and venue are missing.", "Booking timestamps are converted to SGT; venue name falls back to \"Venue <id>\"; event fields are None.",
    steps="1. Call view(BOOKING, None, None, {}).", kind="Edge")
def test_view_fallbacks():
    out = va.view(BOOKING, None, None, {})
    assert out["start_datetime"] == "2026-10-03T16:00:00+08:00" and out["venue_name"] == "Venue 5" and out["event_name"] is None
    assert out["accessibility_required"] is True


@tc("BE-VENUE-014", "view", "Event says accessibility not required but booking row says required.", "Event value wins (False).", data="event accessibility_required = False; booking = 1", steps="1. Call view.")
def test_view_event_accessibility_priority():
    assert va.view(BOOKING, {**EVENT, "accessibility_required": False}, VENUE, {})["accessibility_required"] is False


@tc("BE-VENUE-015", "view", "Venue row uses the alternative \"name\" column.", "That name is used.", data="venue = {\"name\": \"Hall B\"}", steps="1. Call view with the alternative venue row.", kind="Edge")
def test_view_venue_name_alt():
    assert va.view(BOOKING, None, {"name": "Hall B"}, {})["venue_name"] == "Hall B"


@tc("BE-VENUE-016", "view", "Booking has no facilities list.", "facilities_required is an empty list.", data="facilities_required = None", steps="1. Call view.", kind="Edge")
def test_view_facilities_default():
    assert va.view({**BOOKING, "facilities_required": None}, None, None, {})["facilities_required"] == []


@tc("BE-VENUE-017", "enrich", "Empty booking list.", "Empty list returned without querying.", steps="1. Call enrich(client, []).", kind="Edge")
def test_enrich_empty():
    client = world()
    assert va.enrich(client, []) == [] and not client.log


@tc("BE-VENUE-018", "enrich", "Two bookings share an event and venue.", "Each is enriched from the batched lookups.", pre="Event, venue and coordinator exist.", steps="1. Call enrich with two bookings.")
def test_enrich_batch():
    out = va.enrich(world(), [BOOKING, {**BOOKING, "request_id": 2}])
    assert [o["request_id"] for o in out] == [1, 2] and out[1]["venue_name"] == "Hall A" and out[0]["coordinator_email"] == "c@x"


@tc("BE-VENUE-019", "enrich", "Bookings have no coordinator_id.", "The users table is not queried; coordinator fields are None.", steps="1. Call enrich with a coordinator-less booking.", kind="Edge")
def test_enrich_no_users():
    client = world()
    out = va.enrich(client, [{**BOOKING, "coordinator_id": None}])
    assert out[0]["coordinator_name"] is None and not any(t == "users" for t, *_ in client.log)


@tc("BE-VENUE-020", "owned_booking", "Assigned staff opens their booking.", "The booking row is returned.", steps="1. Call owned_booking(client, 1, STAFF).")
def test_owned_ok():
    assert va.owned_booking(world(), 1, STAFF)["request_id"] == 1


@tc("BE-VENUE-021", "owned_booking", "Request id does not exist.", "HTTP 404 \"Venue booking request not found.\"", steps="1. Call owned_booking(client, 99, STAFF).", kind="Negative")
def test_owned_missing():
    assert err(va.owned_booking, world(), 99, STAFF) == (404, "Venue booking request not found.")


@tc("BE-VENUE-022", "owned_booking", "Booking is assigned to another staff member.", "HTTP 403.", data="staff id s2 vs assigned s1", steps="1. Call owned_booking with staff s2.", kind="Security")
def test_owned_other_staff():
    assert err(va.owned_booking, world(), 1, {"id": "s2"})[0] == 403


@tc("BE-VENUE-023", "decide", "Pending request is approved.", "Status is stored as Approved with a decided_at timestamp and the enriched booking is returned.", pre="Booking 1 Pending, owned by s1.",
    steps="1. Call decide(1, STAFF, {\"status\": \"Approved\"}).")
def test_decide_approve(use_db):
    client = use_db(world(), va)
    out = va.decide(1, STAFF, {"status": "Approved"})
    assert out["status"] == "Approved" and client.tables[va.BOOKING_TABLE][0]["decided_at"]


@tc("BE-VENUE-024", "decide", "Request was already decided.", "HTTP 409 \"This request has already been approved.\"", pre="Booking status = Approved.", steps="1. Call decide again.", kind="Negative")
def test_decide_twice(use_db):
    use_db(world([{**BOOKING, "status": "Approved"}]), va)
    assert err(va.decide, 1, STAFF, {"status": "Rejected"}) == (409, "This request has already been approved.")


@tc("BE-VENUE-025", "decide", "Another staff member tries to decide.", "HTTP 403 and nothing is written.", steps="1. Call decide with staff s2.", kind="Security")
def test_decide_other_staff(use_db):
    client = use_db(world(), va)
    assert err(va.decide, 1, {"id": "s2"}, {"status": "Approved"})[0] == 403 and not client.writes(va.BOOKING_TABLE, "update")


@tc("BE-VENUE-026", "decide", "Row is decided by someone else between the read and the guarded update.", "HTTP 409 \"This request was just decided by someone else.\"", pre="Update matches no rows.",
    steps="1. Simulate empty update. 2. Call decide.", kind="Edge")
def test_decide_race(use_db):
    use_db(world(), va).empty_updates = True
    assert err(va.decide, 1, STAFF, {"status": "Approved"}) == (409, "This request was just decided by someone else.")


@tc("BE-VENUE-027", "approve_request", "Staff approves a pending request.", "Status Approved; rejection reason and alternative venue are cleared.", pre="Booking has stale rejection fields.",
    steps="1. Call approve_request(1, STAFF).")
def test_approve(use_db):
    client = use_db(world([{**BOOKING, "rejection_reason": "old", "alternative_venue": "old"}]), va)
    out = va.approve_request(1, STAFF)
    assert out["status"] == "Approved" and out["rejection_reason"] is None and out["alternative_venue"] is None and client.tables[va.BOOKING_TABLE][0]["rejection_reason"] is None


@tc("BE-VENUE-028", "reject_request", "Staff rejects with reason and alternative venue.", "Status Rejected; both values trimmed and stored.", data="reason \"  Double booked \", alternative \" Hall B\"",
    steps="1. Call reject_request(1, RejectionDetails(...), STAFF).")
def test_reject_details(use_db):
    use_db(world(), va)
    out = va.reject_request(1, va.RejectionDetails(reason="  Double booked ", alternative_venue=" Hall B"), STAFF)
    assert (out["status"], out["rejection_reason"], out["alternative_venue"]) == ("Rejected", "Double booked", "Hall B")


@tc("BE-VENUE-029", "reject_request", "Staff rejects with no body.", "Still rejected; reason and alternative are None.", data="details = None", steps="1. Call reject_request(1, None, STAFF).", kind="Edge")
def test_reject_no_body(use_db):
    use_db(world(), va)
    out = va.reject_request(1, None, STAFF)
    assert out["status"] == "Rejected" and out["rejection_reason"] is None


@tc("BE-VENUE-030", "list_requests", "Staff lists their requests.", "Only their own bookings are returned, newest created_at first.", pre="Two bookings for s1, one for s2.",
    steps="1. Call list_requests(STAFF).")
def test_list_requests(use_db):
    bookings = [BOOKING, {**BOOKING, "request_id": 2, "created_at": "2026-09-05T00:00:00+00:00"}, {**BOOKING, "request_id": 3, "venue_staff_id": "s2"}]
    use_db(world(bookings), va)
    assert [r["request_id"] for r in va.list_requests(STAFF)] == [2, 1]


@tc("BE-VENUE-031", "list_requests", "Staff has no requests.", "Empty list.", steps="1. Call list_requests for a staff member with none.", kind="Edge")
def test_list_empty(use_db):
    use_db(world(), va)
    assert va.list_requests({"id": "nobody"}) == []


@tc("BE-VENUE-032", "get_request", "Staff fetches one of their requests.", "The enriched booking is returned.", steps="1. Call get_request(1, STAFF).")
def test_get_request(use_db):
    use_db(world(), va)
    assert va.get_request(1, STAFF)["venue_name"] == "Hall A"


@tc("BE-VENUE-033", "get_request", "Staff fetches another staff member's request.", "HTTP 403.", steps="1. Call get_request(1, {\"id\": \"s2\"}).", kind="Security")
def test_get_request_forbidden(use_db):
    use_db(world(), va)
    assert err(va.get_request, 1, {"id": "s2"})[0] == 403
