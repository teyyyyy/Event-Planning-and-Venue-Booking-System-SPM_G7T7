"""Unit tests for backend/venue_catalogue.py (venue catalogue read for staff, edit for venue staff)."""

import copy

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from pydantic import ValidationError

import venue_catalogue as vc
from auth import current_user
from fake_supabase import FakeClient
from tc import tc

WEEK = {day: {"closed": False, "opens": "09:00", "closes": "18:00"} for day in vc.DAYS}


def update(**kw):
    base = dict(operating_hours=copy.deepcopy(WEEK), facilities=["Wi-Fi"], accessible=1, accessibility_details="Step-free", layouts=["Theatre"])
    return vc.VenueUpdate(**{**base, **kw})


def venue(i=1, **kw):
    return {"venue_id": i, "name": f"Hall {i}", "location": "SG", "capacity": 100, **kw}


def world(rows=None):
    return FakeClient({"Venues": rows if rows is not None else [venue(2), venue(1)]})


def err(fn, *a, **kw):
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    return info.value.status_code, info.value.detail


def invalid(**kw):
    with pytest.raises(ValidationError):
        update(**kw)


def api_error():
    return APIError({"code": "XX000", "message": "outage", "details": None, "hint": None})


@tc("BE-VCAT-001", "require_reader", "Caller is Venue Staff or Technical Support Staff (odd casing/spacing).", "The user is returned.", data="\"venue staff\", \"  Technical SUPPORT staff \"",
    steps="1. Call require_reader for each role.")
def test_reader_allowed():
    assert vc.require_reader({"role": "venue staff"}) and vc.require_reader({"role": "  Technical SUPPORT staff "})


@tc("BE-VCAT-002", "require_reader", "Caller is an event coordinator or has no role.", "HTTP 403 \"Venue Staff or Technical Support Staff access required.\"", data="role = \"event coordinator\"; {}",
    steps="1. Call require_reader with a coordinator. 2. Call it with no role.", kind="Security")
def test_reader_denied():
    assert err(vc.require_reader, {"role": "event coordinator"})[0] == 403 and err(vc.require_reader, {})[0] == 403


@tc("BE-VCAT-003", "Hours", "A closed day with no times.", "Accepted.", data="closed = True", steps="1. Instantiate Hours(closed=True).")
def test_hours_closed_ok():
    assert vc.Hours(closed=True).opens is None


@tc("BE-VCAT-004", "Hours", "A closed day that still has times.", "Validation error \"Closed days cannot have operating times.\"", data="closed = True, opens 09:00", steps="1. Instantiate Hours(closed=True, opens=\"09:00\").", kind="Negative")
def test_hours_closed_with_times():
    with pytest.raises(ValidationError, match="Closed days cannot have operating times"):
        vc.Hours(closed=True, opens="09:00")


@tc("BE-VCAT-005", "Hours", "An open day with valid times.", "Accepted.", data="09:00-18:00", steps="1. Instantiate Hours(closed=False, opens=\"09:00\", closes=\"18:00\").")
def test_hours_open_ok():
    assert vc.Hours(closed=False, opens="09:00", closes="18:00").closes == "18:00"


@tc("BE-VCAT-006", "Hours", "An open day is missing its closing time.", "Validation error \"Enter both times in HH:MM format.\"", data="closes = None", steps="1. Instantiate Hours(closed=False, opens=\"09:00\").", kind="Negative")
def test_hours_missing_time():
    with pytest.raises(ValidationError, match="HH:MM"):
        vc.Hours(closed=False, opens="09:00")


@tc("BE-VCAT-007", "Hours", "Times are not zero-padded HH:MM or are out of range.", "Validation error for each.", data="\"9:00\", \"24:00\", \"12:60\"", steps="1. Instantiate Hours with each bad opening time.", kind="Edge")
def test_hours_bad_format():
    for bad in ("9:00", "24:00", "12:60"):
        with pytest.raises(ValidationError):
            vc.Hours(closed=False, opens=bad, closes="23:59")


@tc("BE-VCAT-008", "Hours", "Closing time equals or precedes opening time.", "Validation error \"Closing time must be later than opening time on the same day.\"", data="18:00-09:00 and 09:00-09:00", steps="1. Instantiate Hours with each range.", kind="Edge")
def test_hours_close_before_open():
    for opens, closes in (("18:00", "09:00"), ("09:00", "09:00")):
        with pytest.raises(ValidationError, match="later than opening"):
            vc.Hours(closed=False, opens=opens, closes=closes)


@tc("BE-VCAT-009", "Hours", "Payload has an unknown field or a non-boolean \"closed\".", "Validation error (extra fields forbidden, strict types).", data="extra = 1; closed = \"yes\"", steps="1. Instantiate Hours with an extra field. 2. Instantiate with closed=\"yes\".", kind="Negative")
def test_hours_strict():
    with pytest.raises(ValidationError):
        vc.Hours(closed=True, extra=1)
    with pytest.raises(ValidationError):
        vc.Hours(closed="yes")


@tc("BE-VCAT-010", "VenueUpdate", "A complete valid update.", "Accepted and lists are kept.", steps="1. Instantiate VenueUpdate with all seven days.")
def test_update_ok():
    assert update().layouts == ["Theatre"]


@tc("BE-VCAT-011", "VenueUpdate", "Only six days of operating hours are supplied.", "Validation error \"Specify all seven days.\"", data="sunday missing", steps="1. Remove sunday. 2. Instantiate VenueUpdate.", kind="Negative")
def test_update_missing_day():
    hours = copy.deepcopy(WEEK)
    del hours["sunday"]
    with pytest.raises(ValidationError, match="all seven days"):
        update(operating_hours=hours)


@tc("BE-VCAT-012", "VenueUpdate", "An unknown day name is supplied.", "Validation error.", data="\"funday\"", steps="1. Replace sunday with funday. 2. Instantiate VenueUpdate.", kind="Negative")
def test_update_unknown_day():
    hours = copy.deepcopy(WEEK)
    hours["funday"] = hours.pop("sunday")
    invalid(operating_hours=hours)


@tc("BE-VCAT-013", "VenueUpdate", "Facilities contain padding and case-insensitive duplicates.", "Items are trimmed and de-duplicated, keeping the first spelling.", data="[\"  wi-fi \", \"Wi-Fi\", \"Projector\"]", steps="1. Instantiate VenueUpdate with those facilities.", kind="Edge")
def test_update_dedupes():
    assert update(facilities=["  wi-fi ", "Wi-Fi", "Projector"]).facilities == ["wi-fi", "Projector"]


@tc("BE-VCAT-014", "VenueUpdate", "A list contains a blank item.", "Validation error \"Each item must be one line of 1–100 characters.\"", data="[\"Wi-Fi\", \"   \"]", steps="1. Instantiate VenueUpdate with a blank facility.", kind="Negative")
def test_update_blank_item():
    with pytest.raises(ValidationError, match="1–100 characters"):
        update(facilities=["Wi-Fi", "   "])


@tc("BE-VCAT-015", "VenueUpdate", "An item is 101 characters or contains a line break.", "Validation error.", data="\"x\"*101; \"a\\nb\"", steps="1. Instantiate VenueUpdate with each bad layout.", kind="Edge")
def test_update_item_limits():
    invalid(layouts=["x" * 101])
    invalid(layouts=["a\nb"])
    assert update(layouts=["x" * 100]).layouts == ["x" * 100]


@tc("BE-VCAT-016", "VenueUpdate", "More than 30 facilities are supplied.", "Validation error (max 30 items).", data="31 facilities", steps="1. Instantiate VenueUpdate with 31 facilities.", kind="Edge")
def test_update_too_many_items():
    invalid(facilities=[f"f{i}" for i in range(31)])
    assert len(update(facilities=[f"f{i}" for i in range(30)]).facilities) == 30


@tc("BE-VCAT-017", "VenueUpdate", "\"accessible\" is not 0 or 1.", "Validation error.", data="accessible = 2", steps="1. Instantiate VenueUpdate with accessible=2.", kind="Negative")
def test_update_accessible_values():
    invalid(accessible=2)
    assert update(accessible=0).accessible == 0


@tc("BE-VCAT-018", "VenueUpdate", "Accessibility details have padding, or exceed 1000 characters.", "Padding is trimmed; over-length is rejected.", data="\"  ramp  \"; 1001 chars", steps="1. Instantiate with padded text. 2. Instantiate with 1001 characters.", kind="Edge")
def test_update_details():
    assert update(accessibility_details="  ramp  ").accessibility_details == "ramp"
    invalid(accessibility_details="x" * 1001)


@tc("BE-VCAT-019", "VenueUpdate", "An unknown top-level field is sent.", "Validation error (extra fields forbidden).", data="capacity = 5", steps="1. Instantiate VenueUpdate with an extra field.", kind="Security")
def test_update_extra_field():
    invalid(capacity=5)


@tc("BE-VCAT-020", "unavailable", "The helper is asked for an error response.", "An HTTP 503 with a retry message is returned.", steps="1. Call unavailable(Exception()).", kind="Negative")
def test_unavailable():
    error = vc.unavailable(Exception("x"))
    assert (error.status_code, "try again" in error.detail) == (503, True)


@tc("BE-VCAT-021", "list_venues", "The catalogue is requested.", "All venues are returned ordered by name.", pre="Two venues stored out of order.", steps="1. Call list_venues().")
def test_list_venues(use_db):
    use_db(world([venue(1, name="Zeta"), venue(2, name="Alpha")]), vc)
    assert [v["name"] for v in vc.list_venues(user={})] == ["Alpha", "Zeta"]


@tc("BE-VCAT-022", "list_venues", "There are no venues.", "Empty list.", steps="1. Call list_venues() on an empty table.", kind="Edge")
def test_list_empty(use_db):
    use_db(world([]), vc)
    assert vc.list_venues(user={}) == []


@tc("BE-VCAT-023", "list_venues", "The database fails with an API error or a network error.", "HTTP 503 for both.", pre="Venues table raises.", steps="1. Raise APIError. 2. Raise httpx.ConnectError.", kind="Negative")
def test_list_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add("Venues")
    for error in (api_error(), httpx.ConnectError("down")):
        client.fail_error = error
        assert err(vc.list_venues, user={})[0] == 503


@tc("BE-VCAT-024", "venue_detail", "An existing venue is requested.", "The venue row is returned.", steps="1. Call venue_detail(1).")
def test_detail_found(use_db):
    use_db(world(), vc)
    assert vc.venue_detail(1, user={})["name"] == "Hall 1"


@tc("BE-VCAT-025", "venue_detail", "The venue does not exist.", "HTTP 404 \"Venue not found.\"", steps="1. Call venue_detail(99).", kind="Negative")
def test_detail_missing(use_db):
    use_db(world(), vc)
    assert err(vc.venue_detail, 99, user={}) == (404, "Venue not found.")


@tc("BE-VCAT-026", "venue_detail", "The database fails.", "HTTP 503.", steps="1. Make the Venues table raise APIError. 2. Call venue_detail(1).", kind="Negative")
def test_detail_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add("Venues")
    client.fail_error = api_error()
    assert err(vc.venue_detail, 1, user={})[0] == 503


@tc("BE-VCAT-027", "update_venue", "Venue staff saves valid changes.", "The venue row is updated with the new hours, lists and accessibility, and returned.", steps="1. Call update_venue(1, update, staff).")
def test_update_venue_ok(use_db):
    client = use_db(world(), vc)
    out = vc.update_venue(1, update(facilities=["Stage"], accessible=0), user={"role": "venue staff"})
    assert out["facilities"] == ["Stage"] and out["accessible"] == 0 and out["operating_hours"]["monday"] == WEEK["monday"]
    assert client.tables["Venues"][1]["facilities"] == ["Stage"]


@tc("BE-VCAT-028", "update_venue", "The venue does not exist.", "HTTP 404 \"Venue not found. Changes were not saved.\"", steps="1. Call update_venue(99, update, staff).", kind="Negative")
def test_update_venue_missing(use_db):
    use_db(world(), vc)
    assert err(vc.update_venue, 99, update(), user={})[1] == "Venue not found. Changes were not saved."


@tc("BE-VCAT-029", "update_venue", "The database fails while saving.", "HTTP 503.", steps="1. Make the update raise httpx.ReadTimeout.", kind="Negative")
def test_update_venue_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add(("Venues", "update"))
    client.fail_error = httpx.ReadTimeout("slow")
    assert err(vc.update_venue, 1, update(), user={})[0] == 503


def http(role, monkeypatch, client=None):
    app = FastAPI()
    app.include_router(vc.router)
    app.dependency_overrides[current_user] = lambda: {"id": "u1", "role": role}
    monkeypatch.setattr(vc, "db", lambda: client or world())
    return TestClient(app)


BODY = {"operating_hours": WEEK, "facilities": ["Wi-Fi"], "accessible": 1, "accessibility_details": "", "layouts": []}


@tc("BE-VCAT-030", "PUT /api/venue-catalogue/{id}", "A Technical Support user tries to edit a venue.", "HTTP 403 (read-only role) and nothing is saved.", pre="Caller role = technical support staff.", steps="1. PUT a valid body as technical support.", kind="Security")
def test_http_put_forbidden_for_technical_support(monkeypatch):
    client = world()
    assert http("technical support staff", monkeypatch, client).put("/api/venue-catalogue/1", json=BODY).status_code == 403
    assert not client.writes("Venues", "update")


@tc("BE-VCAT-031", "GET /api/venue-catalogue", "Technical support and coordinators request the catalogue over HTTP.", "Technical support gets 200; a coordinator gets 403.", steps="1. GET as technical support. 2. GET as event coordinator.", kind="Security")
def test_http_get_roles(monkeypatch):
    assert http("technical support staff", monkeypatch).get("/api/venue-catalogue").status_code == 200
    assert http("event coordinator", monkeypatch).get("/api/venue-catalogue").status_code == 403


@tc("BE-VCAT-032", "PUT /api/venue-catalogue/{id}", "Venue staff sends an invalid body over HTTP (a day missing).", "HTTP 422 and nothing is saved.", data="monday..saturday only", steps="1. PUT a body with six days as venue staff.", kind="Negative")
def test_http_put_validation(monkeypatch):
    client = world()
    bad = {**BODY, "operating_hours": {d: WEEK[d] for d in vc.DAYS[:-1]}}
    assert http("venue staff", monkeypatch, client).put("/api/venue-catalogue/1", json=bad).status_code == 422
    assert not client.writes("Venues", "update")
