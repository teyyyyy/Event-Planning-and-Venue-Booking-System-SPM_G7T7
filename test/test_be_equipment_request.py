"""Unit tests for backend/equipment_request.py."""

import pytest
from pydantic import ValidationError

import equipment_request as er
from eq_world import EVENT, err, reservation, world
from tc import tc

Item = er.EquipmentRequestItemInput


def avail(client=None, event=EVENT):
    return er.calculate_availability(client or world(), dict(event))


def submitted(items, request_id=7, created_by="c1", event_id=1):
    return {"Equipment Request": [{"request_id": request_id, "event_id": event_id, "status": "Submitted", "created_by": created_by}],
            "Equipment Request Item": items}


@tc("BE-EQREQ-001", "db", "Supabase credentials are missing.", "HTTP 500 \"Backend Supabase credentials are not configured.\"", pre="Service-role key empty.",
    steps="1. Blank the key. 2. Call db().", kind="Config")
def test_db_missing(monkeypatch):
    monkeypatch.setattr(er, "SUPABASE_SERVICE_ROLE_KEY", "")
    assert err(er.db)[0] == 500


@tc("BE-EQREQ-002", "db", "Credentials are present.", "Client is created from URL and key.", pre="URL and key set.", steps="1. Stub create_client. 2. Call db().")
def test_db_ok(monkeypatch):
    monkeypatch.setattr(er, "SUPABASE_URL", "u")
    monkeypatch.setattr(er, "SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(er, "create_client", lambda *a: a)
    assert er.db() == ("u", "k")


@tc("BE-EQREQ-003", "EquipmentRequestItemInput", "Requested quantity is 0.", "Validation error (quantity must be > 0).", data="requested_quantity = 0",
    steps="1. Instantiate the item with quantity 0.", kind="Negative")
def test_item_zero_quantity():
    with pytest.raises(ValidationError):
        Item(equipment_id="MIC", requested_quantity=0)


@tc("BE-EQREQ-004", "EquipmentRequestItemInput", "Equipment id is empty.", "Validation error (min length 1).", data="equipment_id = \"\"",
    steps="1. Instantiate the item with a blank id.", kind="Negative")
def test_item_blank_id():
    with pytest.raises(ValidationError):
        Item(equipment_id="", requested_quantity=1)


@tc("BE-EQREQ-005", "EquipmentRequestItemInput", "Technical requirements omitted.", "Defaults to an empty string.", steps="1. Instantiate the item without requirements.", kind="Edge")
def test_item_default_requirements():
    assert Item(equipment_id="MIC", requested_quantity=1).technical_requirements == ""


@tc("BE-EQREQ-006", "get_coordinator_event", "Event is assigned to the coordinator.", "The event row is returned.", steps="1. Call get_coordinator_event(client, \"c1\", 1).")
def test_get_event_ok():
    assert er.get_coordinator_event(world(), "c1", 1)["id"] == 1


@tc("BE-EQREQ-007", "get_coordinator_event", "Event belongs to a different coordinator.", "HTTP 404 \"Event not found or is not assigned to this coordinator.\"", data="coordinator c2",
    steps="1. Call get_coordinator_event(client, \"c2\", 1).", kind="Security")
def test_get_event_other_coordinator():
    assert err(er.get_coordinator_event, world(), "c2", 1)[0] == 404


@tc("BE-EQREQ-008", "event_datetimes", "Event has a date and start/end times.", "A (start, end) datetime pair on the event date is returned.", data="2026-10-01 09:00-17:00",
    steps="1. Call event_datetimes(EVENT).")
def test_datetimes_ok():
    start, end = er.event_datetimes(EVENT)
    assert (start.hour, end.hour, start.day) == (9, 17, 1)


@tc("BE-EQREQ-009", "event_datetimes", "Event has no date.", "HTTP 400 \"This event does not have an event date.\"", data="event_date = None", steps="1. Call event_datetimes without a date.", kind="Negative")
def test_datetimes_no_date():
    assert err(er.event_datetimes, {**EVENT, "event_date": None}) == (400, "This event does not have an event date.")


@tc("BE-EQREQ-010", "event_datetimes", "Event has no end time.", "HTTP 400 mentioning an incomplete start and end time.", data="end_time = None", steps="1. Call event_datetimes without an end time.", kind="Negative")
def test_datetimes_no_time():
    assert "complete start and end time" in err(er.event_datetimes, {**EVENT, "end_time": None})[1]


@tc("BE-EQREQ-011", "event_datetimes", "Date string is malformed.", "HTTP 400 \"The event has an invalid date or time.\"", data="event_date = \"not-a-date\"", steps="1. Call event_datetimes with a bad date.", kind="Negative")
def test_datetimes_invalid():
    assert err(er.event_datetimes, {**EVENT, "event_date": "not-a-date"}) == (400, "The event has an invalid date or time.")


@tc("BE-EQREQ-012", "event_datetimes", "End time equals start time.", "HTTP 400 \"The event end time must be after the start time.\"", data="09:00-09:00", steps="1. Call event_datetimes with equal times.", kind="Edge")
def test_datetimes_end_not_after_start():
    assert err(er.event_datetimes, {**EVENT, "end_time": "09:00:00"})[0] == 400


@tc("BE-EQREQ-013", "calculate_availability", "No reservations exist.", "available = total - under maintenance for every equipment item, sorted by name.", pre="MIC 10 (2 in maintenance), PRJ 3.",
    steps="1. Call calculate_availability(client, EVENT).")
def test_avail_basic():
    out = {r["equipment_id"]: r for r in avail()}
    assert out["MIC"]["available_quantity"] == 8 and out["PRJ"]["available_quantity"] == 3 and out["MIC"]["reserved_quantity"] == 0


@tc("BE-EQREQ-014", "calculate_availability", "An active reservation overlaps the event window.", "Reserved quantity is subtracted from availability.", pre="3 MIC reserved 10:00-12:00 on the same day.",
    data="reserved_quantity = 3", steps="1. Call calculate_availability.")
def test_avail_overlap():
    out = {r["equipment_id"]: r for r in avail(world(**reservation()))}
    assert out["MIC"]["reserved_quantity"] == 3 and out["MIC"]["available_quantity"] == 5


@tc("BE-EQREQ-015", "calculate_availability", "The overlapping reservation is Cancelled.", "It is ignored; nothing is reserved.", pre="Reservation status = Cancelled.", steps="1. Call calculate_availability.", kind="Edge")
def test_avail_cancelled_ignored():
    assert {r["equipment_id"]: r for r in avail(world(**reservation(status=" Cancelled ")))}["MIC"]["reserved_quantity"] == 0


@tc("BE-EQREQ-016", "calculate_availability", "Reservation is on a different day.", "It does not overlap and is ignored.", data="reservation 2026-10-02", steps="1. Call calculate_availability.", kind="Edge")
def test_avail_no_overlap():
    out = avail(world(**reservation(start="2026-10-02T10:00:00", end="2026-10-02T12:00:00")))
    assert {r["equipment_id"]: r for r in out}["MIC"]["reserved_quantity"] == 0


@tc("BE-EQREQ-017", "calculate_availability", "Reserved + maintenance exceed total stock.", "Available quantity is clamped at 0, never negative.", data="9 reserved, 2 maintenance, 10 total",
    steps="1. Call calculate_availability.", kind="Edge")
def test_avail_clamped():
    assert {r["equipment_id"]: r for r in avail(world(**reservation(qty=9)))}["MIC"]["available_quantity"] == 0


@tc("BE-EQREQ-018", "calculate_availability", "The reservation tables cannot be read.", "The error is swallowed and nothing is treated as reserved.", pre="Reservation Item table raises.",
    steps="1. Make reservation queries fail. 2. Call calculate_availability.", kind="Negative")
def test_avail_reservation_error():
    client = world()
    client.fail_tables.add("Equipment Reservation Item")
    assert {r["equipment_id"]: r for r in avail(client)}["MIC"]["available_quantity"] == 8


@tc("BE-EQREQ-019", "calculate_availability", "Equipment row has null quantities.", "Null totals/maintenance are treated as 0.", data="total_quantity = None", steps="1. Call calculate_availability.", kind="Edge")
def test_avail_null_quantities():
    client = world(Equipment=[{"equipment_id": "X", "equipment_name": "X", "total_quantity": None, "under_maintenance_count": None}])
    assert avail(client)[0]["available_quantity"] == 0


@tc("BE-EQREQ-020", "calculate_availability", "Event has no time information.", "HTTP 400 is raised before any equipment is queried.", data="start_time = None", steps="1. Call calculate_availability with an incomplete event.", kind="Negative")
def test_avail_bad_event():
    assert err(er.calculate_availability, world(), {**EVENT, "start_time": None})[0] == 400


ROWS = [{"equipment_id": "MIC", "equipment_name": "Microphone", "available_quantity": 8}]


@tc("BE-EQREQ-021", "validate_request_items", "No items supplied.", "HTTP 400 \"At least one equipment item is required.\"", steps="1. Call validate_request_items([], rows).", kind="Negative")
def test_validate_empty():
    assert err(er.validate_request_items, [], ROWS)[1] == "At least one equipment item is required."


@tc("BE-EQREQ-022", "validate_request_items", "Same equipment listed twice (one with padded spaces).", "HTTP 400 \"The same equipment type cannot be added twice.\"", data="\"MIC\" and \" MIC \"",
    steps="1. Call validate_request_items with duplicates.", kind="Negative")
def test_validate_duplicate():
    items = [Item(equipment_id="MIC", requested_quantity=1), Item(equipment_id=" MIC ", requested_quantity=1)]
    assert err(er.validate_request_items, items, ROWS)[0] == 400


@tc("BE-EQREQ-023", "validate_request_items", "Equipment id is not in the catalogue.", "HTTP 400 \"Selected equipment does not exist.\"", data="equipment_id = GHOST", steps="1. Call validate_request_items with an unknown id.", kind="Negative")
def test_validate_unknown():
    assert err(er.validate_request_items, [Item(equipment_id="GHOST", requested_quantity=1)], ROWS)[1] == "Selected equipment does not exist."


@tc("BE-EQREQ-024", "validate_request_items", "Requested quantity exceeds availability.", "HTTP 400 \"Microphone has only 8 available.\"", data="requested 9, available 8", steps="1. Call validate_request_items with quantity 9.", kind="Negative")
def test_validate_exceeds():
    assert err(er.validate_request_items, [Item(equipment_id="MIC", requested_quantity=9)], ROWS)[1] == "Microphone has only 8 available."


@tc("BE-EQREQ-025", "validate_request_items", "Requested quantity equals availability.", "Accepted (no exception).", data="requested 8, available 8", steps="1. Call validate_request_items with quantity 8.", kind="Edge")
def test_validate_boundary():
    er.validate_request_items([Item(equipment_id="MIC", requested_quantity=8)], ROWS)


@tc("BE-EQREQ-026", "coordinator_events", "Coordinator has two events; one already has a request.", "Only the event without a request is returned.", pre="Events 1 and 2 assigned to c1; a request exists for event 2.",
    steps="1. Call coordinator_events(\"c1\").")
def test_coordinator_events(use_db):
    events = [dict(EVENT), {**EVENT, "id": 2, "event_date": "2026-11-01"}]
    use_db(world(**{"Event Details": events}, **submitted([], event_id=2)), er)
    assert [e["id"] for e in er.coordinator_events("c1")] == [1]


@tc("BE-EQREQ-027", "coordinator_events", "Coordinator has no assigned events.", "Empty list.", steps="1. Call coordinator_events(\"nobody\").", kind="Edge")
def test_coordinator_events_none(use_db):
    use_db(world(), er)
    assert er.coordinator_events("nobody") == []


@tc("BE-EQREQ-028", "equipment_catalogue", "Catalogue requested.", "All equipment returned, sorted by name.", steps="1. Call equipment_catalogue().")
def test_catalogue(use_db):
    use_db(world(), er)
    assert [e["equipment_name"] for e in er.equipment_catalogue()] == ["Microphone", "Projector"]


@tc("BE-EQREQ-029", "equipment_catalogue", "Equipment table is empty.", "Empty list.", steps="1. Call equipment_catalogue() with no equipment.", kind="Edge")
def test_catalogue_empty(use_db):
    use_db(world(Equipment=[]), er)
    assert er.equipment_catalogue() == []


@tc("BE-EQREQ-030", "equipment_availability", "Coordinator checks availability for their event.", "Per-equipment availability rows are returned.", steps="1. Call equipment_availability(\"c1\", 1).")
def test_availability_route(use_db):
    use_db(world(), er)
    assert {r["equipment_id"] for r in er.equipment_availability("c1", 1)} == {"MIC", "PRJ"}


@tc("BE-EQREQ-031", "equipment_availability", "Event is not assigned to the coordinator.", "HTTP 404.", steps="1. Call equipment_availability(\"c2\", 1).", kind="Security")
def test_availability_route_forbidden(use_db):
    use_db(world(), er)
    assert err(er.equipment_availability, "c2", 1)[0] == 404


def payload(*items, event_id=1):
    return er.EquipmentRequestInput(event_id=event_id, items=list(items))


@tc("BE-EQREQ-032", "create_equipment_request", "Valid request for an assigned event.", "A Submitted header (created_by = coordinator) and trimmed item rows are saved; ids returned.",
    pre="No existing request for event 1.", data="MIC x2, requirements \"  wireless \"", steps="1. Call create_equipment_request(\"c1\", payload).")
def test_create_ok(use_db):
    client = use_db(world(), er)
    out = er.create_equipment_request("c1", payload(Item(equipment_id=" MIC ", requested_quantity=2, technical_requirements="  wireless ")))
    header = client.tables["Equipment Request"][0]
    item = client.tables["Equipment Request Item"][0]
    assert header["status"] == "Submitted" and header["created_by"] == "c1" and out["request_id"] == header["request_id"]
    assert (item["equipment_id"], item["technical_requirements"]) == ("MIC", "wireless")


@tc("BE-EQREQ-033", "create_equipment_request", "Event already has a request.", "HTTP 409 telling the user to edit the existing request.", pre="Request exists for event 1.",
    steps="1. Call create_equipment_request for event 1 again.", kind="Negative")
def test_create_duplicate(use_db):
    use_db(world(**submitted([])), er)
    assert err(er.create_equipment_request, "c1", payload(Item(equipment_id="MIC", requested_quantity=1)))[0] == 409


@tc("BE-EQREQ-034", "create_equipment_request", "Event is not assigned to the caller.", "HTTP 404 and no header is created.", steps="1. Call create_equipment_request(\"c2\", ...).", kind="Security")
def test_create_wrong_coordinator(use_db):
    client = use_db(world(), er)
    assert err(er.create_equipment_request, "c2", payload(Item(equipment_id="MIC", requested_quantity=1)))[0] == 404 and not client.tables["Equipment Request"]


@tc("BE-EQREQ-035", "create_equipment_request", "Requested quantity exceeds availability.", "HTTP 400 and nothing is inserted.", data="MIC x9 (8 available)", steps="1. Call create_equipment_request with quantity 9.", kind="Negative")
def test_create_exceeds(use_db):
    client = use_db(world(), er)
    assert err(er.create_equipment_request, "c1", payload(Item(equipment_id="MIC", requested_quantity=9)))[0] == 400 and not client.tables["Equipment Request"]


@tc("BE-EQREQ-036", "create_equipment_request", "Header insert returns no row.", "HTTP 500 \"Equipment request could not be created.\"", pre="Insert returns empty data.", steps="1. Simulate empty insert. 2. Call the route.", kind="Negative")
def test_create_header_fails(use_db):
    use_db(world(), er).empty_inserts = True
    assert err(er.create_equipment_request, "c1", payload(Item(equipment_id="MIC", requested_quantity=1)))[1] == "Equipment request could not be created."


@tc("BE-EQREQ-037", "create_equipment_request", "Item insert fails after the header was created.", "Header is deleted (rollback) and HTTP 500 \"Equipment request items could not be saved.\" is raised.", pre="Item table insert raises.",
    steps="1. Make item insert fail. 2. Call the route.", kind="Negative")
def test_create_rollback(use_db):
    client = use_db(world(), er)
    client.fail_tables.add(("Equipment Request Item", "insert"))
    assert err(er.create_equipment_request, "c1", payload(Item(equipment_id="MIC", requested_quantity=1)))[0] == 500 and not client.tables["Equipment Request"]


def edit_world():
    return world(**submitted([
        {"request_id": 7, "equipment_id": "MIC", "requested_quantity": 2, "technical_requirements": "a"},
        {"request_id": 7, "equipment_id": "PRJ", "requested_quantity": 1, "technical_requirements": ""},
    ]))


@tc("BE-EQREQ-038", "edit_equipment_request", "Coordinator changes one item, removes another and adds nothing.", "MIC updated; PRJ deleted; header reset to Submitted with update fields cleared.",
    pre="Request 7 has MIC x2 and PRJ x1; header shows a Technical Support update.", data="new items: MIC x4", steps="1. Call edit_equipment_request(\"c1\", 7, [MIC x4]).")
def test_edit_update_and_remove(use_db):
    client = use_db(edit_world(), er)
    client.tables["Equipment Request"][0].update(status="Updated", updated_by="t1", latest_update_summary="x")
    out = er.edit_equipment_request("c1", 7, er.EquipmentRequestEditInput(items=[Item(equipment_id="MIC", requested_quantity=4)]))
    items = client.tables["Equipment Request Item"]
    header = client.tables["Equipment Request"][0]
    assert [(i["equipment_id"], i["requested_quantity"]) for i in items] == [("MIC", 4)]
    assert (header["status"], header["updated_by"], header["latest_update_summary"]) == ("Submitted", None, None) and out["request_id"] == 7


@tc("BE-EQREQ-039", "edit_equipment_request", "Coordinator adds a new equipment type.", "A new item row with trimmed requirements is inserted.", data="add PRJ x1 alongside MIC x2",
    steps="1. Call edit_equipment_request with MIC and a new PRJ.")
def test_edit_add(use_db):
    client = use_db(world(**submitted([{"request_id": 7, "equipment_id": "MIC", "requested_quantity": 2, "technical_requirements": ""}])), er)
    er.edit_equipment_request("c1", 7, er.EquipmentRequestEditInput(items=[Item(equipment_id="MIC", requested_quantity=2), Item(equipment_id="PRJ", requested_quantity=1, technical_requirements=" hdmi ")]))
    assert {(i["equipment_id"], i["technical_requirements"]) for i in client.tables["Equipment Request Item"]} == {("MIC", ""), ("PRJ", "hdmi")}


@tc("BE-EQREQ-040", "edit_equipment_request", "Request does not exist or belongs to another coordinator.", "HTTP 404.", data="coordinator c2", steps="1. Call edit_equipment_request(\"c2\", 7, ...).", kind="Security")
def test_edit_not_owner(use_db):
    use_db(edit_world(), er)
    assert err(er.edit_equipment_request, "c2", 7, er.EquipmentRequestEditInput(items=[Item(equipment_id="MIC", requested_quantity=1)]))[0] == 404


@tc("BE-EQREQ-041", "edit_equipment_request", "Edited quantity exceeds availability.", "HTTP 400 and existing items are untouched.", data="MIC x9", steps="1. Call edit_equipment_request with quantity 9.", kind="Negative")
def test_edit_exceeds(use_db):
    client = use_db(edit_world(), er)
    assert err(er.edit_equipment_request, "c1", 7, er.EquipmentRequestEditInput(items=[Item(equipment_id="MIC", requested_quantity=9)]))[0] == 400
    assert len(client.tables["Equipment Request Item"]) == 2


@tc("BE-EQREQ-042", "edit_equipment_request", "Edit sends no items.", "HTTP 400 \"At least one equipment item is required.\"", data="items = []", steps="1. Call edit_equipment_request with an empty list.", kind="Negative")
def test_edit_empty(use_db):
    use_db(edit_world(), er)
    assert err(er.edit_equipment_request, "c1", 7, er.EquipmentRequestEditInput(items=[]))[0] == 400


@tc("BE-EQREQ-043", "get_equipment_requests", "Coordinator has no requests.", "Empty list.", steps="1. Call get_equipment_requests(\"c1\").", kind="Edge")
def test_list_none(use_db):
    use_db(world(), er)
    assert er.get_equipment_requests("c1") == []


@tc("BE-EQREQ-044", "get_equipment_requests", "Coordinator has a request updated by technical support.", "Request lists event details, equipment names, item requirements and the updater's name.",
    pre="Request 7 (status Updated, updated_by t1) with MIC x2.", steps="1. Call get_equipment_requests(\"c1\").")
def test_list_full(use_db):
    tables = submitted([{"request_id": 7, "equipment_id": "MIC", "requested_quantity": 2, "technical_requirements": "wireless", "updated_by": "t1"}])
    tables["Equipment Request"][0].update(status="Updated", updated_by="t1", latest_update_summary="MIC: 1 → 2")
    use_db(world(**tables), er)
    out = er.get_equipment_requests("c1")[0]
    assert (out["event_name"], out["updated_by_name"], out["latest_update_summary"]) == ("Gala", "Tom", "MIC: 1 → 2")
    assert out["items"][0]["equipment_name"] == "Microphone" and out["items"][0]["updated_by_name"] == "Tom"


@tc("BE-EQREQ-045", "get_equipment_requests", "Missing event, null requirements and null summary.", "Fallbacks are used: \"Unknown event\", empty strings.", pre="Event row for the request is absent.",
    steps="1. Call get_equipment_requests.", kind="Edge")
def test_list_fallbacks(use_db):
    tables = submitted([{"request_id": 7, "equipment_id": "MIC", "requested_quantity": 2, "technical_requirements": None}], event_id=555)
    use_db(world(**tables), er)
    out = er.get_equipment_requests("c1")[0]
    assert out["event_name"] == "Unknown event" and out["latest_update_summary"] == "" and out["items"][0]["technical_requirements"] == ""


@tc("BE-EQREQ-046", "get_equipment_requests", "Two requests exist.", "Newest request_id first; other coordinators' requests are excluded.", pre="Requests 7 and 8 for c1, 9 for c2.",
    steps="1. Call get_equipment_requests(\"c1\").")
def test_list_order_and_scope(use_db):
    tables = {"Equipment Request": [{"request_id": 7, "event_id": 1, "created_by": "c1"}, {"request_id": 8, "event_id": 1, "created_by": "c1"}, {"request_id": 9, "event_id": 1, "created_by": "c2"}]}
    use_db(world(**tables), er)
    assert [r["request_id"] for r in er.get_equipment_requests("c1")] == [8, 7]
