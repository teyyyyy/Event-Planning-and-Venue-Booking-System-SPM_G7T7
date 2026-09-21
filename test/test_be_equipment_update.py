"""Unit tests for backend/equipment_update.py (Technical Support equipment updates)."""

import pytest
from pydantic import ValidationError

import equipment_update as eu
from eq_world import err, world
from tc import tc

REQ = {"request_id": 7, "event_id": 1, "status": "Submitted", "created_by": "c1", "created_at": "2026-09-01T00:00:00"}
ITEMS = [
    {"request_id": 7, "equipment_id": "MIC", "requested_quantity": 2, "technical_requirements": "wireless"},
    {"request_id": 7, "equipment_id": "PRJ", "requested_quantity": 1, "technical_requirements": ""},
]


def w(**extra):
    tables = {"Equipment Request": [dict(REQ)], "Equipment Request Item": [dict(i) for i in ITEMS]}
    tables.update(extra)
    return world(**tables)


def item(eid, qty, req=""):
    return eu.EquipmentUpdateItemInput(equipment_id=eid, requested_quantity=qty, technical_requirements=req)


def payload(*items, request_id=7):
    return eu.EventEquipmentUpdateInput(requests=[eu.EquipmentRequestUpdateInput(request_id=request_id, items=list(items))])


def stored(client):
    return {(i["equipment_id"]): i for i in client.tables["Equipment Request Item"]}


@tc("BE-EQUPD-001", "EquipmentUpdateItemInput", "Quantity 0 is supplied (cancel).", "Accepted by the model (ge=0).", data="requested_quantity = 0", steps="1. Instantiate the item with quantity 0.", kind="Edge")
def test_model_zero_ok():
    assert item("MIC", 0).requested_quantity == 0


@tc("BE-EQUPD-002", "EquipmentUpdateItemInput", "Negative quantity is supplied.", "Validation error.", data="requested_quantity = -1", steps="1. Instantiate the item with quantity -1.", kind="Negative")
def test_model_negative():
    with pytest.raises(ValidationError):
        item("MIC", -1)


@tc("BE-EQUPD-003", "require_technical_support", "User id is unknown.", "HTTP 404 \"Technical Support Staff user was not found.\"", steps="1. Call require_technical_support(client, \"nope\").", kind="Negative")
def test_tech_unknown():
    assert err(eu.require_technical_support, world(), "nope")[0] == 404


@tc("BE-EQUPD-004", "require_technical_support", "User is an event coordinator.", "HTTP 403 \"Only Technical Support Staff can access equipment updates.\"", data="user c1", steps="1. Call require_technical_support(client, \"c1\").", kind="Security")
def test_tech_wrong_role():
    assert err(eu.require_technical_support, world(), "c1")[0] == 403


@tc("BE-EQUPD-005", "require_technical_support", "User is Technical Support Staff.", "The user row is returned.", data="user t1", steps="1. Call require_technical_support(client, \"t1\").")
def test_tech_ok():
    assert eu.require_technical_support(world(), "t1")["name"] == "Tom"


@tc("BE-EQUPD-006", "get_event", "Event exists.", "The event row is returned.", steps="1. Call get_event(client, 1).")
def test_get_event_ok():
    assert eu.get_event(world(), 1)["event_name"] == "Gala"


@tc("BE-EQUPD-007", "get_event", "Event does not exist.", "HTTP 404 \"Event was not found.\"", steps="1. Call get_event(client, 99).", kind="Negative")
def test_get_event_missing():
    assert err(eu.get_event, world(), 99) == (404, "Event was not found.")


@tc("BE-EQUPD-008", "get_request_header", "Request exists.", "The header row is returned.", steps="1. Call get_request_header(client, 7).")
def test_get_header_ok():
    assert eu.get_request_header(w(), 7)["event_id"] == 1


@tc("BE-EQUPD-009", "get_request_header", "Request does not exist.", "HTTP 404 \"Equipment request #99 was not found.\"", steps="1. Call get_request_header(client, 99).", kind="Negative")
def test_get_header_missing():
    assert err(eu.get_request_header, w(), 99) == (404, "Equipment request #99 was not found.")


@tc("BE-EQUPD-010", "equipment_request_summary", "Non-technical user requests the summary.", "HTTP 403.", steps="1. Call equipment_request_summary(\"c1\").", kind="Security")
def test_summary_forbidden(use_db):
    use_db(w(), eu)
    assert err(eu.equipment_request_summary, "c1")[0] == 403


@tc("BE-EQUPD-011", "equipment_request_summary", "No requests exist.", "Empty list.", steps="1. Call equipment_request_summary(\"t1\") with no requests.", kind="Edge")
def test_summary_empty(use_db):
    use_db(world(), eu)
    assert eu.equipment_request_summary("t1") == []


@tc("BE-EQUPD-012", "equipment_request_summary", "Request has active items and a zero-quantity item.", "Description lists \"Name × qty\" for active items only; event details included.", pre="MIC x2, PRJ x1, and a Microphone-like item with quantity 0.",
    steps="1. Add a zero-quantity item. 2. Call equipment_request_summary(\"t1\").")
def test_summary_description(use_db):
    client = w()
    client.tables["Equipment Request Item"].append({"request_id": 7, "equipment_id": "GHOST", "requested_quantity": 0})
    use_db(client, eu)
    out = eu.equipment_request_summary("t1")[0]
    assert out["equipment_description"] == "Microphone × 2, Projector × 1" and out["event_name"] == "Gala" and out["request_count"] == 1


@tc("BE-EQUPD-013", "equipment_request_summary", "Request has no active items.", "Description reads \"No active equipment\".", pre="Request with no items.", steps="1. Call equipment_request_summary(\"t1\").", kind="Edge")
def test_summary_no_items(use_db):
    use_db(w(**{"Equipment Request Item": []}), eu)
    assert eu.equipment_request_summary("t1")[0]["equipment_description"] == "No active equipment"


@tc("BE-EQUPD-014", "equipment_request_summary", "Two events on different dates.", "Results are sorted by event date ascending.", pre="Requests for events dated 2026-11-01 and 2026-10-01.",
    steps="1. Call equipment_request_summary(\"t1\").")
def test_summary_sorted(use_db):
    events = [{"id": 1, "event_name": "Late", "event_date": "2026-11-01"}, {"id": 2, "event_name": "Early", "event_date": "2026-10-01"}]
    requests = [{**REQ, "request_id": 7, "event_id": 1}, {**REQ, "request_id": 8, "event_id": 2}]
    use_db(world(**{"Event Details": events, "Equipment Request": requests}), eu)
    assert [r["event_name"] for r in eu.equipment_request_summary("t1")] == ["Early", "Late"]


@tc("BE-EQUPD-015", "equipment_request_summary", "Request's event row is missing.", "Event name falls back to \"Unknown event\".", pre="Header refers to a non-existent event.", steps="1. Call equipment_request_summary(\"t1\").", kind="Edge")
def test_summary_unknown_event(use_db):
    use_db(w(**{"Equipment Request": [{**REQ, "event_id": 404}]}), eu)
    assert eu.equipment_request_summary("t1")[0]["event_name"] == "Unknown event"


@tc("BE-EQUPD-016", "event_equipment_requests", "Event has no requests.", "Returns event, the full catalogue and an empty requests list.", steps="1. Call event_equipment_requests(\"t1\", 1) with no requests.", kind="Edge")
def test_event_requests_none(use_db):
    use_db(world(), eu)
    out = eu.event_equipment_requests("t1", 1)
    assert out["requests"] == [] and len(out["equipment_catalogue"]) == 2 and out["event"]["id"] == 1


@tc("BE-EQUPD-017", "event_equipment_requests", "Event has a request updated by technical support.", "Items carry equipment names; creator and updater names are resolved.", pre="Request 7 created by c1, updated by t1.",
    steps="1. Call event_equipment_requests(\"t1\", 1).")
def test_event_requests_full(use_db):
    client = w()
    client.tables["Equipment Request"][0].update(updated_by="t1", status="Updated", latest_update_summary="s")
    client.tables["Equipment Request Item"][0]["updated_by"] = "t1"
    use_db(client, eu)
    req = eu.event_equipment_requests("t1", 1)["requests"][0]
    assert (req["created_by_name"], req["updated_by_name"], req["status"]) == ("Cara", "Tom", "Updated")
    assert {i["equipment_name"] for i in req["items"]} == {"Microphone", "Projector"} and req["items"][0]["updated_by_name"] == "Tom"


@tc("BE-EQUPD-018", "event_equipment_requests", "Event id does not exist.", "HTTP 404 \"Event was not found.\"", steps="1. Call event_equipment_requests(\"t1\", 99).", kind="Negative")
def test_event_requests_missing_event(use_db):
    use_db(w(), eu)
    assert err(eu.event_equipment_requests, "t1", 99)[0] == 404


@tc("BE-EQUPD-019", "event_equipment_requests", "Non-technical user calls the route.", "HTTP 403.", steps="1. Call event_equipment_requests(\"v1\", 1).", kind="Security")
def test_event_requests_forbidden(use_db):
    use_db(w(), eu)
    assert err(eu.event_equipment_requests, "v1", 1)[0] == 403


@tc("BE-EQUPD-020", "update_event_equipment_requests", "Quantity increased within availability.", "Item updated with updated_by; header set to Updated with summary \"Microphone quantity: 2 → 4\".",
    pre="MIC has 8 available.", data="MIC 2 -> 4 (PRJ unchanged)", steps="1. Call update_event_equipment_requests(\"t1\", 1, payload).")
def test_update_quantity(use_db):
    client = use_db(w(), eu)
    out = eu.update_event_equipment_requests("t1", 1, payload(item("MIC", 4, "wireless"), item("PRJ", 1)))
    header = client.tables["Equipment Request"][0]
    assert stored(client)["MIC"]["requested_quantity"] == 4 and stored(client)["MIC"]["updated_by"] == "t1"
    assert header["status"] == "Updated" and header["latest_update_summary"] == "Microphone quantity: 2 → 4" and header["updated_by"] == "t1"
    assert out["updated_requests"] == [7] and out["updated_by_name"] == "Tom"


@tc("BE-EQUPD-021", "update_event_equipment_requests", "Only the technical requirements change.", "Requirements saved; summary line shows old and new text.", data="\"wireless\" -> \"HDMI\"",
    steps="1. Call update_event_equipment_requests with new requirements.")
def test_update_requirements(use_db):
    client = use_db(w(), eu)
    eu.update_event_equipment_requests("t1", 1, payload(item("MIC", 2, " HDMI "), item("PRJ", 1)))
    assert stored(client)["MIC"]["technical_requirements"] == "HDMI"
    assert client.tables["Equipment Request"][0]["latest_update_summary"] == 'Microphone requirements: "wireless" → "HDMI"'


@tc("BE-EQUPD-022", "update_event_equipment_requests", "Existing item set to quantity 0.", "Item is deleted and the summary records \"Projector: 1 → 0 (Cancelled)\".", data="PRJ quantity 0", steps="1. Call update_event_equipment_requests with PRJ = 0.")
def test_update_cancel(use_db):
    client = use_db(w(), eu)
    eu.update_event_equipment_requests("t1", 1, payload(item("MIC", 2, "wireless"), item("PRJ", 0)))
    assert "PRJ" not in stored(client) and "Projector: 1 → 0 (Cancelled)" in client.tables["Equipment Request"][0]["latest_update_summary"]


@tc("BE-EQUPD-023", "update_event_equipment_requests", "A new equipment type is added.", "New item row inserted with updated_by; summary notes \"Added × n\".", pre="Request holds only MIC.", data="add PRJ x2",
    steps="1. Remove PRJ from the request. 2. Call update_event_equipment_requests adding PRJ x2.")
def test_update_add(use_db):
    client = use_db(w(**{"Equipment Request Item": [dict(ITEMS[0])]}), eu)
    eu.update_event_equipment_requests("t1", 1, payload(item("MIC", 2, "wireless"), item("PRJ", 2)))
    assert stored(client)["PRJ"]["updated_by"] == "t1" and "Projector: Added × 2" in client.tables["Equipment Request"][0]["latest_update_summary"]


@tc("BE-EQUPD-024", "update_event_equipment_requests", "Submitted values equal the stored values.", "Nothing is written, status stays Submitted and updated_requests is empty.", steps="1. Call update_event_equipment_requests with unchanged items.", kind="Edge")
def test_update_no_changes(use_db):
    client = use_db(w(), eu)
    out = eu.update_event_equipment_requests("t1", 1, payload(item("MIC", 2, "wireless"), item("PRJ", 1)))
    assert out["updated_requests"] == [] and client.tables["Equipment Request"][0]["status"] == "Submitted"


@tc("BE-EQUPD-025", "update_event_equipment_requests", "Payload contains no requests.", "HTTP 400 \"There are no equipment request changes to save.\"", data="requests = []", steps="1. Call the route with an empty requests list.", kind="Negative")
def test_update_empty_payload(use_db):
    use_db(w(), eu)
    assert err(eu.update_event_equipment_requests, "t1", 1, eu.EventEquipmentUpdateInput(requests=[]))[0] == 400


@tc("BE-EQUPD-026", "update_event_equipment_requests", "Request belongs to a different event.", "HTTP 400 \"Request #7 does not belong to this event.\"", pre="Event 2 exists.", data="event_id = 2",
    steps="1. Call the route for event 2 with request 7.", kind="Negative")
def test_update_wrong_event(use_db):
    use_db(w(**{"Event Details": [{"id": 1, "event_date": "2026-10-01", "start_time": "09:00:00", "end_time": "17:00:00"}, {"id": 2, "event_date": "2026-10-01", "start_time": "09:00:00", "end_time": "17:00:00"}]}), eu)
    assert err(eu.update_event_equipment_requests, "t1", 2, payload(item("MIC", 2)))[1] == "Request #7 does not belong to this event."


@tc("BE-EQUPD-027", "update_event_equipment_requests", "A request update has no items.", "HTTP 400 \"Request #7 must contain at least one item.\"", data="items = []", steps="1. Call the route with an empty items list.", kind="Negative")
def test_update_no_items(use_db):
    use_db(w(), eu)
    assert err(eu.update_event_equipment_requests, "t1", 1, payload())[1] == "Request #7 must contain at least one item."


@tc("BE-EQUPD-028", "update_event_equipment_requests", "Same equipment appears twice in one request.", "HTTP 400 \"Request #7 contains the same equipment type more than once.\"", data="MIC, MIC", steps="1. Call the route with duplicate MIC items.", kind="Negative")
def test_update_duplicate(use_db):
    use_db(w(), eu)
    assert "more than once" in err(eu.update_event_equipment_requests, "t1", 1, payload(item("MIC", 2), item("MIC", 3), item("PRJ", 1)))[1]


@tc("BE-EQUPD-029", "update_event_equipment_requests", "An existing item is omitted from the update.", "HTTP 400 telling the user to set quantity to 0 instead of removing it.", data="PRJ omitted", steps="1. Call the route without PRJ.", kind="Negative")
def test_update_cannot_remove(use_db):
    use_db(w(), eu)
    assert "Set its quantity to 0" in err(eu.update_event_equipment_requests, "t1", 1, payload(item("MIC", 2)))[1]


@tc("BE-EQUPD-030", "update_event_equipment_requests", "Update references equipment not in the catalogue.", "HTTP 400 \"Equipment GHOST does not exist.\"", data="GHOST added", steps="1. Call the route adding GHOST.", kind="Negative")
def test_update_unknown_equipment(use_db):
    use_db(w(), eu)
    assert err(eu.update_event_equipment_requests, "t1", 1, payload(item("MIC", 2, "wireless"), item("PRJ", 1), item("GHOST", 1)))[1] == "Equipment GHOST does not exist."


@tc("BE-EQUPD-031", "update_event_equipment_requests", "A new equipment item has quantity 0.", "HTTP 400 \"New equipment must have a quantity greater than 0.\"", data="new PRJ x0", steps="1. Remove PRJ. 2. Call the route adding PRJ x0.", kind="Negative")
def test_update_new_zero(use_db):
    use_db(w(**{"Equipment Request Item": [dict(ITEMS[0])]}), eu)
    assert err(eu.update_event_equipment_requests, "t1", 1, payload(item("MIC", 2, "wireless"), item("PRJ", 0)))[1] == "New equipment must have a quantity greater than 0."


@tc("BE-EQUPD-032", "update_event_equipment_requests", "Quantity exceeds availability.", "HTTP 400 \"Microphone has only 8 available for this event.\"", data="MIC x9", steps="1. Call the route with MIC x9.", kind="Negative")
def test_update_exceeds(use_db):
    use_db(w(), eu)
    assert err(eu.update_event_equipment_requests, "t1", 1, payload(item("MIC", 9, "wireless"), item("PRJ", 1)))[1] == "Microphone has only 8 available for this event."


@tc("BE-EQUPD-033", "update_event_equipment_requests", "Non-technical user calls the route.", "HTTP 403 and nothing is written.", steps="1. Call the route as coordinator c1.", kind="Security")
def test_update_forbidden(use_db):
    client = use_db(w(), eu)
    assert err(eu.update_event_equipment_requests, "c1", 1, payload(item("MIC", 4)))[0] == 403 and not client.writes("Equipment Request Item", "update")


@tc("BE-EQUPD-034", "update_event_equipment_requests", "Two requests are submitted and the second is invalid.", "HTTP 400 and the first request is NOT saved (validate-then-save).", pre="Requests 7 and 8 exist for event 1.",
    data="request 7 valid change, request 8 exceeds stock", steps="1. Call the route with both requests.", kind="Regression")
def test_update_all_or_nothing(use_db):
    client = w(**{"Equipment Request": [dict(REQ), {**REQ, "request_id": 8}],
                  "Equipment Request Item": [dict(ITEMS[0]), {"request_id": 8, "equipment_id": "MIC", "requested_quantity": 1, "technical_requirements": ""}]})
    use_db(client, eu)
    body = eu.EventEquipmentUpdateInput(requests=[
        eu.EquipmentRequestUpdateInput(request_id=7, items=[item("MIC", 4, "wireless")]),
        eu.EquipmentRequestUpdateInput(request_id=8, items=[item("MIC", 99)]),
    ])
    assert err(eu.update_event_equipment_requests, "t1", 1, body)[0] == 400
    assert not client.writes("Equipment Request Item", "update")
