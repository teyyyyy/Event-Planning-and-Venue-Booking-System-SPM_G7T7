"""Unit tests for backend/equipment_reservation.py (Technical Support reserves equipment for events)."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import equipment_reservation as rs
import main
from auth import current_user
from eq_world import EVENT, err, world
from tc import tc

Item = rs.ReservationItemInput
REQUEST = {"request_id": 7, "event_id": 1, "status": "Submitted", "created_by": "c1"}
REQUEST_ITEMS = [
    {"request_id": 7, "equipment_id": "MIC", "requested_quantity": 2, "technical_requirements": "wireless"},
    {"request_id": 7, "equipment_id": "PRJ", "requested_quantity": 1, "technical_requirements": None},
]


def header(rid=50, status="Reserved", event_id=1, request_id=7, updated_at="2026-09-02T00:00:00"):
    return {"reservation_id": rid, "event_id": event_id, "request_id": request_id, "status": status, "reserved_by": "t1",
            "created_at": "2026-09-01T00:00:00", "updated_at": updated_at}


def line(rid, equipment_id, qty, item_id=None, start="2026-10-01T09:00:00", end="2026-10-01T17:00:00"):
    row = {"reservation_id": rid, "equipment_id": equipment_id, "reserved_quantity": qty, "start_datetime": start, "end_datetime": end}
    if item_id is not None:
        row["reservation_item_id"] = item_id
    return row


def w(headers=(), lines=(), items=REQUEST_ITEMS):
    """Event 1 with request 7 (MIC x2, PRJ x1) plus the given reservation headers and item lines."""
    return world(**{
        "Equipment Request": [dict(REQUEST)], "Equipment Request Item": [dict(i) for i in items],
        "Equipment Reservation": [dict(h) for h in headers], "Equipment Reservation Item": [dict(l) for l in lines],
    })


def booked(status="Reserved"):
    """Reservation 50 for event 1 holds MIC x2 and PRJ x1."""
    return w([header(status=status)], [line(50, "MIC", 2, item_id=501), line(50, "PRJ", 1, item_id=502)])


def reserve(staff="t1", event_id=1, request_id=7):
    return rs.create_reservation(staff, rs.ReservationCreateInput(event_id=event_id, request_id=request_id, items=[Item(equipment_id="MIC", reserved_quantity=99)]))


def update(*items, staff="t1", rid=50):
    return rs.update_reservation(staff, rid, rs.ReservationUpdateInput(items=list(items)))


# ---- helpers ---------------------------------------------------------------------------

@tc("BE-EQRES-001", "db", "The Supabase URL ends with /rest/v1/ and the key is set.", "The client is created with the trimmed project URL and the service-role key.",
    pre="SUPABASE_URL = https://p.supabase.co/rest/v1/", steps="1. Stub create_client. 2. Call db().", kind="Config")
def test_db(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://p.supabase.co/rest/v1/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(rs, "create_client", lambda *a: a)
    assert rs.db() == ("https://p.supabase.co", "k")


@tc("BE-EQRES-002", "ReservationItemInput", "A reserved quantity of 0 or a negative quantity is supplied.", "0 is accepted (drop the item); a negative quantity is a validation error.",
    data="reserved_quantity = 0, -1", steps="1. Instantiate the item with 0. 2. Instantiate it with -1.", kind="Edge")
def test_item_quantity_bounds():
    assert Item(equipment_id="MIC", reserved_quantity=0).reserved_quantity == 0
    with pytest.raises(ValidationError):
        Item(equipment_id="MIC", reserved_quantity=-1)


@tc("BE-EQRES-003", "require_technical_support", "The staff id belongs to Technical Support Staff.", "The user row is returned.", data="t1", steps="1. Call require_technical_support(client, \"t1\").")
def test_staff_ok():
    assert rs.require_technical_support(w(), "t1")["name"] == "Tom"


@tc("BE-EQRES-004", "require_technical_support", "The staff id is unknown or belongs to another role.", "HTTP 404 for an unknown id; HTTP 403 for an Event Coordinator.",
    data="\"ghost\", \"c1\"", steps="1. Call with an unknown id. 2. Call with a coordinator id.", kind="Security")
def test_staff_rejected():
    assert err(rs.require_technical_support, w(), "ghost") == (404, "Technical Support Staff user was not found.")
    assert err(rs.require_technical_support, w(), "c1") == (403, "Only Technical Support Staff can manage equipment reservations.")


@tc("BE-EQRES-005", "get_event / get_request / get_request_items", "The event and its equipment request exist.", "The event row, the request header and its item rows are returned.",
    steps="1. Call get_event, get_request and get_request_items for event 1 / request 7.")
def test_lookups_ok():
    client = w()
    assert rs.get_event(client, 1)["event_name"] == "Gala"
    assert rs.get_request(client, 1)["request_id"] == 7
    assert [i["equipment_id"] for i in rs.get_request_items(client, 7)] == ["MIC", "PRJ"]


@tc("BE-EQRES-006", "get_event / get_request", "The event does not exist, or exists without an equipment request.", "HTTP 404 with a message naming what is missing.",
    data="event 404; event 1 without a request", steps="1. Call get_event(client, 404). 2. Call get_request on an event without a request.", kind="Negative")
def test_lookups_missing():
    assert err(rs.get_event, w(), 404) == (404, "Event was not found.")
    assert err(rs.get_request, world(), 1) == (404, "This event does not have an equipment request.")


@tc("BE-EQRES-007", "event_datetimes", "The event has a date and start/end times.", "A (start, end) datetime pair on the event date is returned.", data="2026-10-01 09:00-17:00", steps="1. Call event_datetimes(EVENT).")
def test_datetimes_ok():
    start, end = rs.event_datetimes(EVENT)
    assert (start.isoformat(), end.isoformat()) == ("2026-10-01T09:00:00", "2026-10-01T17:00:00")


@tc("BE-EQRES-008", "event_datetimes", "The schedule is incomplete, malformed or ends before it starts.", "HTTP 400 with the matching message for each case.",
    data="no end_time; event_date = \"soon\"; 09:00-09:00", steps="1. Call event_datetimes with each bad schedule.", kind="Negative")
def test_datetimes_invalid():
    assert err(rs.event_datetimes, {**EVENT, "end_time": None}) == (400, "The event must have a date, start time and end time.")
    assert err(rs.event_datetimes, {**EVENT, "event_date": "soon"}) == (400, "The event has an invalid date or time.")
    assert err(rs.event_datetimes, {**EVENT, "end_time": "09:00:00"}) == (400, "The event end time must be after the start time.")


@tc("BE-EQRES-009", "get_equipment_map", "Equipment ids are requested, or none are.", "Rows keyed by equipment_id; an empty list returns {} without querying.",
    data="[\"MIC\"], []", steps="1. Call get_equipment_map with [\"MIC\"]. 2. Call it with [].", kind="Edge")
def test_equipment_map():
    client = w()
    assert list(rs.get_equipment_map(client, ["MIC"])) == ["MIC"]
    calls = len(client.log)
    assert rs.get_equipment_map(client, []) == {} and len(client.log) == calls


@tc("BE-EQRES-010", "overlapping_reserved_quantities", "Reservations overlap the event window with different statuses.",
    "Only Reserved, Modified and Needs Recheck reservations are summed per equipment; Cancelled ones and non-overlapping times are ignored.",
    pre="MIC: 2 Reserved, 1 Modified, 1 Needs Recheck (null qty counts 0), 5 Cancelled, 4 on another day.", steps="1. Call overlapping_reserved_quantities(client, EVENT).")
def test_overlap_statuses():
    client = w(
        [header(1, "Reserved"), header(2, "Modified"), header(3, "Needs Recheck"), header(4, "Cancelled"), header(5, "Reserved")],
        [line(1, "MIC", 2), line(2, "MIC", 1), line(3, "MIC", None), line(3, "PRJ", 1), line(4, "MIC", 5),
         line(5, "MIC", 4, start="2026-10-02T09:00:00", end="2026-10-02T17:00:00")],
    )
    assert rs.overlapping_reserved_quantities(client, dict(EVENT)) == {"MIC": 3, "PRJ": 1}


@tc("BE-EQRES-011", "overlapping_reserved_quantities", "The only overlapping reservation is the one being edited, or there is none.", "{} — an excluded reservation does not count against itself.",
    data="exclude_reservation_id = 50", steps="1. Call with exclude_reservation_id=50. 2. Call on an empty schedule.", kind="Edge")
def test_overlap_excluded():
    assert rs.overlapping_reserved_quantities(booked(), dict(EVENT), exclude_reservation_id=50) == {}
    assert rs.overlapping_reserved_quantities(w(), dict(EVENT)) == {}


@tc("BE-EQRES-012", "availability_for_items", "Items are checked against stock, maintenance and other reservations.",
    "available = total - maintenance - reserved elsewhere, never below 0.", pre="MIC 10 (2 maintenance) with 9 reserved elsewhere; PRJ 3 free.",
    steps="1. Call availability_for_items with MIC x1 and PRJ x2.", kind="Edge")
def test_availability_for_items():
    client = w([header(1, event_id=99)], [line(1, "MIC", 9)])
    rows = {r["equipment_id"]: r for r in rs.availability_for_items(client, dict(EVENT), [Item(equipment_id="MIC", reserved_quantity=1), Item(equipment_id="PRJ", reserved_quantity=2)])}
    assert (rows["MIC"]["reserved_elsewhere"], rows["MIC"]["available_quantity"]) == (9, 0)
    assert (rows["PRJ"]["available_quantity"], rows["PRJ"]["requested_reservation_quantity"], rows["PRJ"]["equipment_name"]) == (3, 2, "Projector")


@tc("BE-EQRES-013", "availability_for_items", "An item refers to equipment that does not exist.", "HTTP 400 \"Equipment GHOST was not found.\"", data="GHOST",
    steps="1. Call availability_for_items with GHOST x1.", kind="Negative")
def test_availability_unknown():
    assert err(rs.availability_for_items, w(), dict(EVENT), [Item(equipment_id="GHOST", reserved_quantity=1)]) == (400, "Equipment GHOST was not found.")


@tc("BE-EQRES-014", "validate_no_duplicates", "The same equipment appears twice (once with padding).", "HTTP 400 \"The same equipment cannot appear more than once.\"", data="\"MIC\", \" MIC \"",
    steps="1. Call validate_no_duplicates with MIC and \" MIC \".", kind="Negative")
def test_no_duplicates():
    rs.validate_no_duplicates([Item(equipment_id="MIC", reserved_quantity=1), Item(equipment_id="PRJ", reserved_quantity=1)])
    assert err(rs.validate_no_duplicates, [Item(equipment_id="MIC", reserved_quantity=1), Item(equipment_id=" MIC ", reserved_quantity=1)])[0] == 400


@tc("BE-EQRES-015", "validate_request_items", "Reserved items are compared with the equipment request.",
    "Accepted within the requested quantities; HTTP 400 for equipment not in the request or more than was requested.",
    data="MIC x2 (ok); PRJ x2 (requested 1); CAM x1 (not requested)", steps="1. Validate MIC x2. 2. Validate PRJ x2. 3. Validate CAM x1.", kind="Negative")
def test_validate_against_request():
    client = w()
    rs.validate_request_items(client, 7, [Item(equipment_id="MIC", reserved_quantity=2)])
    assert err(rs.validate_request_items, client, 7, [Item(equipment_id="PRJ", reserved_quantity=2)]) == (400, "Reserved quantity for PRJ cannot exceed the requested quantity of 1.")
    assert err(rs.validate_request_items, client, 7, [Item(equipment_id="CAM", reserved_quantity=1)]) == (400, "CAM is not part of this equipment request.")


@tc("BE-EQRES-016", "reservation_response", "The reservation and the current request list different equipment.",
    "One line per equipment in either list, with requested/reserved quantities, names (id when unknown) and currently_requested/currently_reserved flags.",
    pre="Reservation holds MIC x2 and CAM x1 (no catalogue row); request asks for MIC x2 and PRJ x1.", steps="1. Call reservation_response(client, reservation 50).")
def test_reservation_response():
    client = w([header()], [line(50, "MIC", 2, item_id=501), line(50, "CAM", 1, item_id=502)])
    out = rs.reservation_response(client, header())
    lines = {i["equipment_id"]: i for i in out["items"]}
    assert (out["start_datetime"], out["event"]["event_name"], out["status"]) == ("2026-10-01T09:00:00", "Gala", "Reserved")
    assert (lines["MIC"]["reserved_quantity"], lines["MIC"]["requested_quantity"], lines["MIC"]["technical_requirements"]) == (2, 2, "wireless")
    assert (lines["CAM"]["equipment_name"], lines["CAM"]["currently_requested"], lines["CAM"]["currently_reserved"]) == ("CAM", False, True)
    assert (lines["PRJ"]["reserved_quantity"], lines["PRJ"]["currently_reserved"], lines["PRJ"]["technical_requirements"]) == (0, False, "")


# ---- GET routes ------------------------------------------------------------------------

@tc("BE-EQRES-017", "reservation_list", "Technical support opens the reservation list.",
    "Non-cancelled reservations with event details and an \"Equipment × qty\" summary, sorted by event date; unknown events show \"Unknown event\".",
    pre="Reservation 50 (event 1, 2026-10-01), 60 (missing event 77), 70 Cancelled.", steps="1. Call reservation_list(\"t1\").")
def test_list(use_db):
    client = use_db(w([header(50), header(60, event_id=77), header(70, status="Cancelled")],
                      [line(50, "MIC", 2), line(50, "PRJ", None), line(60, "CAM", 1)]), rs)
    client.tables["Event Details"].append({**EVENT, "id": 2, "event_date": "2026-09-01"})
    client.tables["Equipment Reservation"].append(header(80, event_id=2))
    out = rs.reservation_list("t1")
    assert [r["reservation_id"] for r in out] == [60, 80, 50]
    by_id = {r["reservation_id"]: r for r in out}
    assert (by_id[50]["equipment_description"], by_id[50]["equipment_count"]) == ("Microphone × 2, Projector × 0", 2)
    assert (by_id[60]["event_name"], by_id[60]["equipment_description"]) == ("Unknown event", "CAM × 1")
    assert by_id[80]["equipment_count"] == 0


@tc("BE-EQRES-018", "reservation_list", "There are no active reservations, or the caller is not Technical Support.", "Empty list; HTTP 403 for a coordinator.",
    steps="1. Call reservation_list(\"t1\") with only a Cancelled reservation. 2. Call reservation_list(\"c1\").", kind="Edge")
def test_list_empty_and_forbidden(use_db):
    use_db(w([header(status="Cancelled")]), rs)
    assert rs.reservation_list("t1") == []
    assert err(rs.reservation_list, "c1")[0] == 403


@tc("BE-EQRES-019", "reservation_for_event", "The event already has an active reservation.", "mode \"existing\" with the newest non-cancelled reservation's details.",
    pre="Reservation 40 Cancelled, 50 Reserved for event 1.", steps="1. Call reservation_for_event(\"t1\", 1).")
def test_for_event_existing(use_db):
    use_db(w([header(40, status="Cancelled"), header(50)], [line(50, "MIC", 2, item_id=501)]), rs)
    out = rs.reservation_for_event("t1", 1)
    assert (out["mode"], out["reservation_id"], out["items"][0]["equipment_id"]) == ("existing", 50, "MIC")


@tc("BE-EQRES-020", "reservation_for_event", "The event has a request but no reservation yet.",
    "mode \"new\": each requested item is proposed at its requested quantity with current availability; unknown equipment shows its id and 0 available.",
    pre="Request 7: MIC x2, PRJ x1; another event reserves 1 PRJ.", steps="1. Call reservation_for_event(\"t1\", 1).")
def test_for_event_new(use_db):
    use_db(w([header(1, event_id=99)], [line(1, "PRJ", 1)]), rs)
    out = rs.reservation_for_event("t1", 1)
    items = {i["equipment_id"]: i for i in out["items"]}
    assert (out["mode"], out["request_id"], out["end_datetime"]) == ("new", 7, "2026-10-01T17:00:00")
    assert (items["MIC"]["reserved_quantity"], items["MIC"]["available_quantity"], items["MIC"]["technical_requirements"]) == (2, 8, "wireless")
    assert (items["PRJ"]["available_quantity"], items["PRJ"]["technical_requirements"]) == (2, "")


@tc("BE-EQRES-021", "reservation_for_event", "The equipment request has no items.", "HTTP 400 \"This equipment request does not contain any equipment.\"",
    steps="1. Call reservation_for_event(\"t1\", 1) on an empty request.", kind="Negative")
def test_for_event_empty_request(use_db):
    use_db(w(items=[]), rs)
    assert err(rs.reservation_for_event, "t1", 1) == (400, "This equipment request does not contain any equipment.")


# ---- create ----------------------------------------------------------------------------

@tc("BE-EQRES-022", "create_reservation", "Technical support reserves the equipment for an event.",
    "A Reserved header (reserved_by = staff) and one item per requested equipment over the event window are created; quantities come from the request, not the payload.",
    data="payload asks for MIC x99", steps="1. Call create_reservation(\"t1\", event 1, request 7).")
def test_create_ok(use_db):
    client = use_db(w(), rs)
    out = reserve()
    saved = client.tables["Equipment Reservation"][0]
    assert (saved["status"], saved["reserved_by"], out["message"]) == ("Reserved", "t1", "Equipment reserved successfully.")
    assert {(i["equipment_id"], i["reserved_quantity"], i["start_datetime"]) for i in client.tables["Equipment Reservation Item"]} == {
        ("MIC", 2, "2026-10-01T09:00:00"), ("PRJ", 1, "2026-10-01T09:00:00")}


@tc("BE-EQRES-023", "create_reservation", "Requested items with quantity 0 are skipped.", "Only positive quantities are reserved; a request with nothing positive is rejected with HTTP 400.",
    data="MIC x0, PRJ x1; then all x0", steps="1. Reserve a request with MIC x0, PRJ x1. 2. Reserve a request where every quantity is 0.", kind="Edge")
def test_create_skips_zero(use_db):
    client = use_db(w(items=[{**REQUEST_ITEMS[0], "requested_quantity": 0}, REQUEST_ITEMS[1]]), rs)
    reserve()
    assert [i["equipment_id"] for i in client.tables["Equipment Reservation Item"]] == ["PRJ"]
    use_db(w(items=[{**REQUEST_ITEMS[0], "requested_quantity": None}]), rs)
    assert err(reserve) == (400, "At least one equipment item must be requested.")


@tc("BE-EQRES-024", "create_reservation", "The request id does not belong to the event, or the event already has an active reservation.", "HTTP 400 and HTTP 409 respectively; nothing is created.",
    data="request_id = 8; existing reservation 50", steps="1. Reserve with request 8. 2. Reserve an event that already has reservation 50.", kind="Negative")
def test_create_conflicts(use_db):
    client = use_db(w(), rs)
    assert err(reserve, request_id=8) == (400, "The equipment request does not belong to this event.")
    use_db(booked(), rs)
    assert err(reserve) == (409, "This event already has an active equipment reservation.")
    assert client.tables["Equipment Reservation"] == []


@tc("BE-EQRES-025", "create_reservation", "The request has no items, or one item exceeds what is free during the event.",
    "HTTP 400 for an empty request; HTTP 409 \"Projector only has 0 available during this event period.\"", pre="Another event reserves all 3 projectors.",
    steps="1. Reserve an empty request. 2. Reserve while projectors are fully booked.", kind="Negative")
def test_create_unavailable(use_db):
    use_db(w(items=[]), rs)
    assert err(reserve) == (400, "This equipment request does not contain any equipment.")
    client = use_db(w([header(1, event_id=99)], [line(1, "PRJ", 3)]), rs)
    assert err(reserve) == (409, "Projector only has 0 available during this event period.")
    assert len(client.tables["Equipment Reservation"]) == 1


@tc("BE-EQRES-026", "create_reservation", "The header insert returns no row.", "HTTP 500 \"Equipment reservation could not be created.\"", pre="Inserts return empty data.",
    steps="1. Simulate empty inserts. 2. Call create_reservation.", kind="Negative")
def test_create_header_fails(use_db):
    use_db(w(), rs).empty_inserts = True
    assert err(reserve) == (500, "Equipment reservation could not be created.")


@tc("BE-EQRES-027", "create_reservation", "Item rows fail (insert raises or returns nothing) after the header was created.",
    "The header is deleted again and HTTP 500 \"Reservation items could not be created. The reservation was cancelled.\" is returned.",
    steps="1. Make the item insert raise; reserve. 2. Make it return no rows; reserve.", kind="Negative")
def test_create_rollback(use_db):
    client = use_db(w(), rs)
    client.fail_tables.add(("Equipment Reservation Item", "insert"))
    assert err(reserve)[0] == 500 and client.tables["Equipment Reservation"] == []

    client = use_db(w(), rs)
    table = client.table

    def empty_items_after_header(name):
        if name == "Equipment Reservation Item" and client.tables["Equipment Reservation"]:
            client.empty_inserts = True
        return table(name)

    client.table = empty_items_after_header
    assert err(reserve) == (500, "Reservation items could not be created. The reservation was cancelled.")
    assert client.tables["Equipment Reservation"] == []


# ---- update ----------------------------------------------------------------------------

@tc("BE-EQRES-028", "update_reservation", "Technical support lowers MIC, drops PRJ and keeps the rest.",
    "MIC is updated, PRJ (quantity 0) is deleted, an omitted line is deleted, and the header becomes Modified.",
    pre="Reservation 50: MIC x2, PRJ x1 and a stale CAM line.", data="MIC x1, PRJ x0", steps="1. Call update_reservation(\"t1\", 50, [MIC x1, PRJ x0]).", kind="State")
def test_update_ok(use_db):
    client = booked()
    client.tables["Equipment Reservation Item"].append(line(50, "CAM", 1, item_id=503))
    use_db(client, rs)
    out = update(Item(equipment_id="MIC", reserved_quantity=1), Item(equipment_id="PRJ", reserved_quantity=0))
    assert [(i["equipment_id"], i["reserved_quantity"]) for i in client.tables["Equipment Reservation Item"]] == [("MIC", 1)]
    assert (client.tables["Equipment Reservation"][0]["status"], out["message"]) == ("Modified", "Equipment reservation updated successfully.")


@tc("BE-EQRES-029", "update_reservation", "A requested item that was not reserved yet is added, and a 0 is sent for an unreserved item.",
    "A new reservation line is inserted for the event window; the 0 item is ignored.", pre="Reservation 50 holds only MIC x2; a Needs Recheck status.",
    data="MIC x2, PRJ x1, CAM x0", steps="1. Call update_reservation with MIC x2, PRJ x1, CAM x0.", kind="Edge")
def test_update_adds_line(use_db):
    client = use_db(w([header(status="Needs Recheck")], [line(50, "MIC", 2, item_id=501)]), rs)
    update(Item(equipment_id="MIC", reserved_quantity=2), Item(equipment_id="PRJ", reserved_quantity=1), Item(equipment_id="CAM", reserved_quantity=0))
    assert {(i["equipment_id"], i["reserved_quantity"], i["end_datetime"]) for i in client.tables["Equipment Reservation Item"]} == {
        ("MIC", 2, "2026-10-01T17:00:00"), ("PRJ", 1, "2026-10-01T17:00:00")}


@tc("BE-EQRES-030", "update_reservation", "The reservation is missing, Cancelled or Completed.", "HTTP 404, then HTTP 400 for each closed status; nothing changes.",
    data="reservation 99; status Cancelled; status Completed", steps="1. Update reservation 99. 2. Update a Cancelled one. 3. Update a Completed one.", kind="State")
def test_update_closed(use_db):
    use_db(booked(), rs)
    assert err(update, Item(equipment_id="MIC", reserved_quantity=1), rid=99) == (404, "Equipment reservation was not found.")
    use_db(booked(" Cancelled "), rs)
    assert err(update, Item(equipment_id="MIC", reserved_quantity=1)) == (400, "A cancelled reservation cannot be modified.")
    use_db(booked("Completed"), rs)
    assert err(update, Item(equipment_id="MIC", reserved_quantity=1)) == (400, "A completed reservation cannot be modified.")


@tc("BE-EQRES-031", "update_reservation", "Every item is set to 0, an item is duplicated, or more is reserved than was requested.",
    "HTTP 400 asking to cancel instead; HTTP 400 for duplicates; HTTP 400 naming the requested limit.", data="all x0; MIC twice; MIC x3 (requested 2)",
    steps="1. Update with all zeros. 2. Update with MIC twice. 3. Update with MIC x3.", kind="Negative")
def test_update_invalid(use_db):
    use_db(booked(), rs)
    assert err(update, Item(equipment_id="MIC", reserved_quantity=0)) == (400, "At least one item must remain reserved. Cancel the reservation instead.")
    assert err(update, Item(equipment_id="MIC", reserved_quantity=1), Item(equipment_id="MIC", reserved_quantity=1))[0] == 400
    assert err(update, Item(equipment_id="MIC", reserved_quantity=3))[1] == "Reserved quantity for MIC cannot exceed the requested quantity of 2."


@tc("BE-EQRES-032", "update_reservation", "Another event has booked the projectors in the meantime.",
    "The reservation's own lines are not counted against it, but other reservations are: HTTP 409 when nothing is left.",
    pre="Reservation 50 holds PRJ x1; reservation 60 (event 99) holds 3 PRJ.", data="PRJ x1", steps="1. Call update_reservation with PRJ x1.", kind="Negative")
def test_update_unavailable(use_db):
    client = booked()
    client.tables["Equipment Reservation"].append(header(60, event_id=99))
    client.tables["Equipment Reservation Item"].append(line(60, "PRJ", 3))
    use_db(client, rs)
    assert err(update, Item(equipment_id="PRJ", reserved_quantity=1)) == (409, "Projector only has 0 available during this event period.")


@tc("BE-EQRES-033", "update_reservation", "The header update returns no row.", "HTTP 500 \"Equipment reservation could not be updated.\"", pre="Updates return empty data.",
    steps="1. Simulate empty updates. 2. Call update_reservation.", kind="Negative")
def test_update_header_fails(use_db):
    use_db(booked(), rs).empty_updates = True
    assert err(update, Item(equipment_id="MIC", reserved_quantity=1)) == (500, "Equipment reservation could not be updated.")


# ---- cancel ----------------------------------------------------------------------------

@tc("BE-EQRES-034", "cancel_reservation", "Technical support cancels an active reservation.", "The header becomes Cancelled and a confirmation is returned.",
    steps="1. Call cancel_reservation(\"t1\", 50).", kind="State")
def test_cancel_ok(use_db):
    client = use_db(booked(), rs)
    assert rs.cancel_reservation("t1", 50) == {"message": "Equipment reservation cancelled successfully.", "reservation_id": 50, "status": "Cancelled"}
    assert client.tables["Equipment Reservation"][0]["status"] == "Cancelled"


@tc("BE-EQRES-035", "cancel_reservation", "The reservation is missing, already Cancelled or Completed.", "HTTP 404, then HTTP 400 for each closed status.",
    steps="1. Cancel reservation 99. 2. Cancel a Cancelled one. 3. Cancel a Completed one.", kind="State")
def test_cancel_closed(use_db):
    use_db(booked(), rs)
    assert err(rs.cancel_reservation, "t1", 99) == (404, "Equipment reservation was not found.")
    use_db(booked("Cancelled"), rs)
    assert err(rs.cancel_reservation, "t1", 50) == (400, "This reservation has already been cancelled.")
    use_db(booked("completed"), rs)
    assert err(rs.cancel_reservation, "t1", 50) == (400, "A completed reservation cannot be cancelled.")


@tc("BE-EQRES-036", "cancel_reservation", "The header update returns no row.", "HTTP 500 \"Equipment reservation could not be cancelled.\"", pre="Updates return empty data.",
    steps="1. Simulate empty updates. 2. Call cancel_reservation.", kind="Negative")
def test_cancel_update_fails(use_db):
    use_db(booked(), rs).empty_updates = True
    assert err(rs.cancel_reservation, "t1", 50) == (500, "Equipment reservation could not be cancelled.")


# ---- HTTP authorisation ----------------------------------------------------------------

http = TestClient(main.app)
# Ordered so that the final create runs after the existing reservation has been cancelled.
ROUTES = (
    ("GET", "/api/equipment-reservation/t1/reservations", None),
    ("GET", "/api/equipment-reservation/t1/events/1", None),
    ("PUT", "/api/equipment-reservation/t1/50", {"items": [{"equipment_id": "MIC", "reserved_quantity": 1}]}),
    ("DELETE", "/api/equipment-reservation/t1/50", None),
    ("POST", "/api/equipment-reservation/t1", {"event_id": 1, "request_id": 7}),
)


def call_routes(headers=None):
    return [http.request(method, path, json=body, headers=headers) for method, path, body in ROUTES]


def sign_in(monkeypatch, user):
    monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: user)


@tc("BE-EQRES-037", "Equipment reservation routes", "A caller without a bearer token targets Technical Support staff t1 on every route.",
    "HTTP 401 for list, view, update, cancel and create; the database is never queried and reservation 50 stays Reserved.",
    pre="Reservation 50 for event 1; t1 is Technical Support Staff.", data="no Authorization header; Authorization = \"Basic t1\"",
    steps="1. Call each route for t1 without a token. 2. Repeat with a Basic-scheme header.", kind="Security")
def test_http_requires_token(use_db):
    client = use_db(booked(), rs)
    for headers in (None, {"Authorization": "Basic t1"}):
        assert [r.status_code for r in call_routes(headers)] == [401] * 5
    assert client.log == [] and client.tables["Equipment Reservation"][0]["status"] == "Reserved"


@tc("BE-EQRES-038", "Equipment reservation routes", "A signed-in Technical Support staff member puts another staff member's id in the path.",
    "HTTP 403 \"You can only access your own technical support workspace.\" on every route; the database is never queried.",
    pre="Signed in as t2 (Technical Support Staff); reservation 50 for event 1.", data="path staff_id = t1",
    steps="1. Sign in as t2. 2. Call each route for t1.", kind="Security")
def test_http_rejects_other_staff_id(monkeypatch, use_db):
    client = use_db(booked(), rs)
    sign_in(monkeypatch, {"id": "t2", "name": "Tia", "role": "Technical Support Staff", "email": "t2@x"})
    assert {(r.status_code, r.json()["detail"]) for r in call_routes()} == {(403, "You can only access your own technical support workspace.")}
    assert client.log == []


@tc("BE-EQRES-039", "Equipment reservation routes", "A signed-in Technical Support staff member uses their own id in the path.",
    "Every route runs: the list and event view load, the update and cancel succeed, and the new reservation is recorded as reserved by the signed-in user.",
    pre="Signed in as t1; reservation 50 for event 1 holds MIC x2 and PRJ x1.", data="MIC x1",
    steps="1. Sign in as t1. 2. List, view, update and cancel reservation 50. 3. Reserve event 1 again.", kind="Security")
def test_http_own_staff_id(monkeypatch, use_db):
    client = use_db(booked(), rs)
    sign_in(monkeypatch, {"id": "t1", "name": "Tom", "role": "Technical Support Staff", "email": "t@x"})
    listed, viewed, updated, cancelled, created = call_routes()
    assert [r.status_code for r in (listed, viewed, updated, cancelled, created)] == [200] * 5
    assert (listed.json()[0]["reservation_id"], viewed.json()["mode"]) == (50, "existing")
    assert (updated.json()["status"], cancelled.json()["status"]) == ("Modified", "Cancelled")
    assert created.json()["reserved_by"] == client.tables["Equipment Reservation"][-1]["reserved_by"] == "t1"
