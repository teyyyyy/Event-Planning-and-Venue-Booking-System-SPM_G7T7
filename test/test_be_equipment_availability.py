"""Unit tests for backend/equipment_availability.py."""

import equipment_availability as ea
from eq_world import EVENT, err, reservation, world
from tc import tc

REQ = {"request_id": 7, "event_id": 1, "status": "Submitted"}


def with_request(items, **extra):
    return world(**{"Equipment Request": [dict(REQ)], "Equipment Request Item": items, **extra})


def ri(eid, qty):
    return {"request_id": 7, "equipment_id": eid, "requested_quantity": qty}


@tc("BE-EQAVAIL-001", "require_technical_support", "User id is unknown.", "HTTP 404.", steps="1. Call require_technical_support(client, \"nope\").", kind="Negative")
def test_tech_unknown():
    assert err(ea.require_technical_support, world(), "nope")[0] == 404


@tc("BE-EQAVAIL-002", "require_technical_support", "User is venue staff.", "HTTP 403 \"Only Technical Support Staff can check equipment availability.\"", steps="1. Call require_technical_support(client, \"v1\").", kind="Security")
def test_tech_wrong_role():
    assert err(ea.require_technical_support, world(), "v1")[1] == "Only Technical Support Staff can check equipment availability."


@tc("BE-EQAVAIL-003", "require_technical_support", "User is Technical Support Staff.", "User row is returned.", steps="1. Call require_technical_support(client, \"t1\").")
def test_tech_ok():
    assert ea.require_technical_support(world(), "t1")["id"] == "t1"


@tc("BE-EQAVAIL-004", "get_event", "Event exists / does not exist.", "Row is returned for id 1; HTTP 404 \"Event was not found.\" for id 99.", steps="1. Call get_event(client, 1). 2. Call get_event(client, 99).")
def test_get_event():
    assert ea.get_event(world(), 1)["id"] == 1 and err(ea.get_event, world(), 99)[0] == 404


@tc("BE-EQAVAIL-005", "event_datetimes", "Event has date and times.", "Start and end datetimes are returned.", data="09:00-17:00", steps="1. Call event_datetimes(EVENT).")
def test_datetimes_ok():
    assert [d.hour for d in ea.event_datetimes(EVENT)] == [9, 17]


@tc("BE-EQAVAIL-006", "event_datetimes", "Event has no date.", "HTTP 400 \"This event does not have an event date.\"", steps="1. Call event_datetimes without a date.", kind="Negative")
def test_datetimes_no_date():
    assert err(ea.event_datetimes, {**EVENT, "event_date": None})[1] == "This event does not have an event date."


@tc("BE-EQAVAIL-007", "event_datetimes", "Event has no start time.", "HTTP 400 \"This event does not have a complete start and end time.\"", steps="1. Call event_datetimes without a start time.", kind="Negative")
def test_datetimes_no_time():
    assert err(ea.event_datetimes, {**EVENT, "start_time": None})[0] == 400


@tc("BE-EQAVAIL-008", "event_datetimes", "Event has an unparsable date.", "HTTP 400 \"The event has an invalid date or time.\"", data="event_date = \"xx\"", steps="1. Call event_datetimes with a bad date.", kind="Negative")
def test_datetimes_invalid():
    assert err(ea.event_datetimes, {**EVENT, "event_date": "xx"})[0] == 400


@tc("BE-EQAVAIL-009", "event_datetimes", "End time is not after the start time.", "HTTP 400 \"The event end time must be after the start time.\"", data="17:00-09:00", steps="1. Call event_datetimes with reversed times.", kind="Edge")
def test_datetimes_reversed():
    assert err(ea.event_datetimes, {**EVENT, "start_time": "17:00:00", "end_time": "09:00:00"})[0] == 400


@tc("BE-EQAVAIL-010", "get_overlapping_reservations", "Active reservations overlap for two equipment types, one split across two rows.", "Quantities are summed per equipment id.", pre="MIC reserved 2 + 1 in the window, PRJ reserved 1.",
    steps="1. Call get_overlapping_reservations(client, EVENT).")
def test_overlap_sums():
    client = world(**{"Equipment Reservation": [{"reservation_id": 1, "status": "Active", "event_id": 99}, {"reservation_id": 2, "status": "Active", "event_id": 98}],
                      "Equipment Reservation Item": [
                          {"reservation_id": 1, "equipment_id": "MIC", "reserved_quantity": 2, "start_datetime": "2026-10-01T10:00:00", "end_datetime": "2026-10-01T12:00:00"},
                          {"reservation_id": 2, "equipment_id": "MIC", "reserved_quantity": 1, "start_datetime": "2026-10-01T09:00:00", "end_datetime": "2026-10-01T10:00:00"},
                          {"reservation_id": 2, "equipment_id": "PRJ", "reserved_quantity": 1, "start_datetime": "2026-10-01T09:00:00", "end_datetime": "2026-10-01T10:00:00"}]})
    assert ea.get_overlapping_reservations(client, dict(EVENT)) == {"MIC": 3, "PRJ": 1}


@tc("BE-EQAVAIL-011", "get_overlapping_reservations", "No reservation items overlap.", "Empty dict.", steps="1. Call get_overlapping_reservations with no reservations.", kind="Edge")
def test_overlap_none():
    assert ea.get_overlapping_reservations(world(), dict(EVENT)) == {}


@tc("BE-EQAVAIL-012", "get_overlapping_reservations", "Overlapping reservation is Cancelled.", "It is not counted.", pre="Reservation status = Cancelled.", steps="1. Call get_overlapping_reservations.", kind="Edge")
def test_overlap_cancelled():
    assert ea.get_overlapping_reservations(world(**reservation(status="Cancelled")), dict(EVENT)) == {}


@tc("BE-EQAVAIL-013", "get_overlapping_reservations", "The reservation belongs to the event being checked.", "It is excluded so an event does not conflict with itself.", pre="Reservation event_id = 1.", steps="1. Call get_overlapping_reservations for event 1.", kind="Regression")
def test_overlap_own_event():
    assert ea.get_overlapping_reservations(world(**reservation(event_id=1)), dict(EVENT)) == {}


@tc("BE-EQAVAIL-014", "get_overlapping_reservations", "Reservation item table cannot be read.", "Empty dict (error swallowed).", pre="Reservation Item table raises.", steps="1. Make the table fail. 2. Call get_overlapping_reservations.", kind="Negative")
def test_overlap_item_error():
    client = world(**reservation())
    client.fail_tables.add("Equipment Reservation Item")
    assert ea.get_overlapping_reservations(client, dict(EVENT)) == {}


@tc("BE-EQAVAIL-015", "get_overlapping_reservations", "Reservation header table cannot be read.", "Empty dict (error swallowed).", pre="Reservation table raises.", steps="1. Make the header table fail. 2. Call get_overlapping_reservations.", kind="Negative")
def test_overlap_header_error():
    client = world(**reservation())
    client.fail_tables.add("Equipment Reservation")
    assert ea.get_overlapping_reservations(client, dict(EVENT)) == {}


@tc("BE-EQAVAIL-016", "calculate_event_availability", "Stock covers the requested quantity.", "Status \"Available\" with zero shortage.", data="MIC requested 5, available 8", steps="1. Call calculate_event_availability with MIC x5.")
def test_calc_available():
    out = ea.calculate_event_availability(world(), dict(EVENT), [ri("MIC", 5)])[0]
    assert (out["availability_status"], out["available_quantity"], out["shortage_quantity"]) == ("Available", 8, 0)


@tc("BE-EQAVAIL-017", "calculate_event_availability", "Stock is partly available.", "Status \"Insufficient\" and shortage = requested - available.", data="MIC requested 10, available 8", steps="1. Call calculate_event_availability with MIC x10.")
def test_calc_insufficient():
    out = ea.calculate_event_availability(world(), dict(EVENT), [ri("MIC", 10)])[0]
    assert (out["availability_status"], out["shortage_quantity"]) == ("Insufficient", 2)


@tc("BE-EQAVAIL-018", "calculate_event_availability", "All stock is reserved.", "Status \"Unavailable\" (available = 0).", pre="8 MIC reserved in the window.", data="MIC requested 1", steps="1. Call calculate_event_availability with MIC x1.")
def test_calc_unavailable():
    out = ea.calculate_event_availability(world(**reservation(qty=8)), dict(EVENT), [ri("MIC", 1)])[0]
    assert (out["availability_status"], out["available_quantity"], out["reserved_quantity"]) == ("Unavailable", 0, 8)


@tc("BE-EQAVAIL-019", "calculate_event_availability", "Requested equipment is missing from the catalogue.", "Row shows \"Unavailable\" with the whole request as shortage and the id as name.", data="GHOST x3", steps="1. Call calculate_event_availability with GHOST x3.", kind="Edge")
def test_calc_unknown_equipment():
    out = ea.calculate_event_availability(world(), dict(EVENT), [ri("GHOST", 3)])[0]
    assert (out["equipment_name"], out["shortage_quantity"], out["availability_status"]) == ("GHOST", 3, "Unavailable")


@tc("BE-EQAVAIL-020", "calculate_event_availability", "No request items.", "Empty list.", steps="1. Call calculate_event_availability with [].", kind="Edge")
def test_calc_empty():
    assert ea.calculate_event_availability(world(), dict(EVENT), []) == []


@tc("BE-EQAVAIL-021", "availability_events", "Non-technical user calls the route.", "HTTP 403.", steps="1. Call availability_events(\"c1\").", kind="Security")
def test_events_forbidden(use_db):
    use_db(world(), ea)
    assert err(ea.availability_events, "c1")[0] == 403


@tc("BE-EQAVAIL-022", "availability_events", "No equipment requests exist.", "Empty list.", steps="1. Call availability_events(\"t1\") with no requests.", kind="Edge")
def test_events_empty(use_db):
    use_db(world(), ea)
    assert ea.availability_events("t1") == []


@tc("BE-EQAVAIL-023", "availability_events", "A request has one active and one zero-quantity item.", "Only the active item counts; the description lists \"Name × qty\".", data="MIC x2, PRJ x0", steps="1. Call availability_events(\"t1\").")
def test_events_description(use_db):
    use_db(with_request([ri("MIC", 2), ri("PRJ", 0)]), ea)
    out = ea.availability_events("t1")[0]
    assert (out["requested_equipment_count"], out["equipment_description"], out["event_name"]) == (1, "Microphone × 2", "Gala")


@tc("BE-EQAVAIL-024", "availability_events", "Request has no items.", "Description \"No active equipment\".", steps="1. Call availability_events(\"t1\") for an item-less request.", kind="Edge")
def test_events_no_items(use_db):
    use_db(with_request([]), ea)
    assert ea.availability_events("t1")[0]["equipment_description"] == "No active equipment"


@tc("BE-EQAVAIL-025", "availability_events", "A request's event is missing; another exists later.", "Requests whose event row is missing are skipped; the rest are sorted by event date.", pre="Requests for events 1 (2026-11-01), 2 (2026-10-01) and 404 (missing).",
    steps="1. Call availability_events(\"t1\").")
def test_events_skip_and_sort(use_db):
    events = [{"id": 1, "event_name": "Late", "event_date": "2026-11-01"}, {"id": 2, "event_name": "Early", "event_date": "2026-10-01"}]
    headers = [{"request_id": 7, "event_id": 1, "status": "Submitted"}, {"request_id": 8, "event_id": 2, "status": "Submitted"}, {"request_id": 9, "event_id": 404, "status": "Submitted"}]
    use_db(world(**{"Event Details": events, "Equipment Request": headers}), ea)
    assert [e["event_name"] for e in ea.availability_events("t1")] == ["Early", "Late"]


@tc("BE-EQAVAIL-026", "event_availability", "All requested equipment is available.", "all_equipment_available = True and unavailable count 0.", data="MIC x2, PRJ x1", steps="1. Call event_availability(\"t1\", 1).")
def test_event_avail_all(use_db):
    use_db(with_request([ri("MIC", 2), ri("PRJ", 1)]), ea)
    out = ea.event_availability("t1", 1)
    assert out["all_equipment_available"] is True and out["unavailable_equipment_count"] == 0 and out["request_id"] == 7


@tc("BE-EQAVAIL-027", "event_availability", "One equipment type is short.", "all_equipment_available = False and unavailable count 1.", data="MIC x2, PRJ x5 (3 in stock)", steps="1. Call event_availability(\"t1\", 1).")
def test_event_avail_short(use_db):
    use_db(with_request([ri("MIC", 2), ri("PRJ", 5)]), ea)
    out = ea.event_availability("t1", 1)
    assert out["all_equipment_available"] is False and out["unavailable_equipment_count"] == 1


@tc("BE-EQAVAIL-028", "event_availability", "Event has no equipment request.", "HTTP 404 \"This event does not have an equipment request.\"", steps="1. Call event_availability(\"t1\", 1) without a request.", kind="Negative")
def test_event_avail_no_request(use_db):
    use_db(world(), ea)
    assert err(ea.event_availability, "t1", 1)[1] == "This event does not have an equipment request."


@tc("BE-EQAVAIL-029", "event_availability", "Request contains only zero-quantity items.", "Availability list is empty and all_equipment_available is False.", data="MIC x0", steps="1. Call event_availability(\"t1\", 1).", kind="Edge")
def test_event_avail_only_zero(use_db):
    use_db(with_request([ri("MIC", 0)]), ea)
    out = ea.event_availability("t1", 1)
    assert out["availability"] == [] and out["all_equipment_available"] is False


@tc("BE-EQAVAIL-030", "event_availability", "Event id does not exist.", "HTTP 404 \"Event was not found.\"", steps="1. Call event_availability(\"t1\", 99).", kind="Negative")
def test_event_avail_no_event(use_db):
    use_db(world(), ea)
    assert err(ea.event_availability, "t1", 99)[0] == 404


@tc("BE-EQAVAIL-031", "event_catalogue_availability", "Catalogue is checked for an event with reservations.", "Every equipment item is listed (sorted by name) with reserved and available quantities.", pre="3 MIC reserved in the window.",
    steps="1. Call event_catalogue_availability(\"t1\", 1).")
def test_catalogue(use_db):
    use_db(world(**reservation()), ea)
    out = {r["equipment_id"]: r for r in ea.event_catalogue_availability("t1", 1)}
    assert out["MIC"]["reserved_quantity"] == 3 and out["MIC"]["available_quantity"] == 5 and out["PRJ"]["available_quantity"] == 3


@tc("BE-EQAVAIL-032", "event_catalogue_availability", "Non-technical user requests the catalogue.", "HTTP 403.", steps="1. Call event_catalogue_availability(\"c1\", 1).", kind="Security")
def test_catalogue_forbidden(use_db):
    use_db(world(), ea)
    assert err(ea.event_catalogue_availability, "c1", 1)[0] == 403


@tc("BE-EQAVAIL-033", "event_catalogue_availability", "Event id does not exist.", "HTTP 404.", steps="1. Call event_catalogue_availability(\"t1\", 99).", kind="Negative")
def test_catalogue_no_event(use_db):
    use_db(world(), ea)
    assert err(ea.event_catalogue_availability, "t1", 99)[0] == 404
