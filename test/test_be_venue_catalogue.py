"""Unit tests for backend/venue_catalogue.py (venue catalogue read for staff, edit for venue staff)."""

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


def update(**kw):
    base = dict(accessible=1, accessibility_details="Step-free", emergency_access="Emergency exit beside main entrance",
                venue_restrictions="Keep emergency exits clear", setup_time=90, teardown_time=30)
    return vc.VenueUpdate(**{**base, **kw})


def availability(**kw):
    return vc.VenueAvailability(**{"is_available": True, **kw})


def venue(i=1, **kw):
    return {"venue_id": i, "name": f"Hall {i}", "location": "SG", "capacity": 100, "accessible": 1,
            "accessibility_details": "Step-free", "emergency_access": "Emergency exit beside main entrance",
            "venue_restrictions": "Keep emergency exits clear", "setup_time": 90, "teardown_time": 30,
            "is_available": True, "unavailability_reason": "", **kw}


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


@tc("BE-VCAT-001", "require_reader", "Caller is Event Coordinator, Event Coordinator Lead, Venue Staff or Technical Support Staff (odd casing/spacing).", "The user is returned.",
    data="event coordinator, event coordinator lead, venue staff, technical support staff", steps="1. Call require_reader for each role.")
def test_reader_allowed():
    for role in ("event coordinator", "event coordinator lead", "venue staff", "  Technical SUPPORT staff "):
        assert vc.require_reader({"role": role})


@tc("BE-VCAT-002", "require_reader", "Caller is an organiser, attendee or has no role.", "HTTP 403 for each.",
    data="event organiser, attendee, {}", steps="1. Call require_reader for each disallowed role.", kind="Security")
def test_reader_denied():
    for user in ({"role": "event organiser"}, {"role": "attendee"}, {}):
        assert err(vc.require_reader, user)[0] == 403


@tc("BE-VCAT-003", "VenueUpdate", "A complete valid venue update is supplied.", "The update is accepted and all fields are retained.",
    steps="1. Instantiate VenueUpdate with valid accessibility, safety and duration fields.")
def test_update_ok():
    out = update()
    assert out.accessible == 1
    assert out.accessibility_details == "Step-free"
    assert out.emergency_access == "Emergency exit beside main entrance"
    assert out.venue_restrictions == "Keep emergency exits clear"
    assert out.setup_time == 90
    assert out.teardown_time == 30


@tc("BE-VCAT-004", "VenueUpdate", "\"accessible\" is not 0 or 1.", "Validation error.",
    data="accessible = 2", steps="1. Instantiate VenueUpdate with accessible=2.", kind="Negative")
def test_update_accessible_values():
    invalid(accessible=2)
    assert update(accessible=0).accessible == 0


@tc("BE-VCAT-005", "VenueUpdate", "Accessibility and safety text contains surrounding spaces.", "The text is trimmed.",
    data="padded accessibility_details, emergency_access and venue_restrictions",
    steps="1. Instantiate VenueUpdate with padded text. 2. Inspect the stored values.", kind="Edge")
def test_update_text_trimmed():
    out = update(accessibility_details="  ramp  ", emergency_access="  rear exit  ", venue_restrictions="  no open flames  ")
    assert out.accessibility_details == "ramp"
    assert out.emergency_access == "rear exit"
    assert out.venue_restrictions == "no open flames"


@tc("BE-VCAT-006", "VenueUpdate", "Accessibility or safety text exceeds 1000 characters.", "Validation error.",
    data="1001 characters", steps="1. Instantiate VenueUpdate with each over-length field.", kind="Edge")
def test_update_text_limits():
    for field in ("accessibility_details", "emergency_access", "venue_restrictions"):
        invalid(**{field: "x" * 1001})


@tc("BE-VCAT-007", "VenueUpdate", "Setup and teardown durations are whole non-negative minutes.", "Zero and positive whole minutes are accepted; missing values are allowed.",
    data="setup_time=0, teardown_time=45", steps="1. Instantiate VenueUpdate with valid durations. 2. Instantiate without duration fields.")
def test_update_durations():
    assert update(setup_time=0, teardown_time=45).teardown_time == 45
    assert update(setup_time=None, teardown_time=None).setup_time is None
    assert vc.VenueUpdate(accessible=1).setup_time is None


@tc("BE-VCAT-008", "VenueUpdate", "A setup or teardown duration is negative, fractional, non-numeric or too large.", "Validation error for every invalid value.",
    data="-1, 2.5, \"45\", 2147483648, True", steps="1. Instantiate VenueUpdate with each invalid duration.", kind="Negative")
def test_update_invalid_durations():
    for bad in (-1, 2.5, "45", 2_147_483_648, True):
        with pytest.raises(ValidationError):
            update(setup_time=bad)
        with pytest.raises(ValidationError):
            update(teardown_time=bad)


@tc("BE-VCAT-009", "VenueUpdate", "An unknown top-level field is sent.", "Validation error because extra fields are forbidden.",
    data="capacity = 5", steps="1. Instantiate VenueUpdate with an extra field.", kind="Security")
def test_update_extra_field():
    invalid(capacity=5)


@tc("BE-VCAT-010", "VenueAvailability", "Venue is marked available.", "The update is accepted and any supplied unavailability reason is cleared.",
    data="is_available=True", steps="1. Instantiate VenueAvailability as available.")
def test_availability_available():
    out = availability(unavailability_reason="No longer relevant")
    assert out.is_available is True
    assert out.unavailability_reason == ""


@tc("BE-VCAT-011", "VenueAvailability", "Venue is marked unavailable with a reason.", "The reason is trimmed and retained.",
    data="is_available=False, reason=' Maintenance '", steps="1. Instantiate VenueAvailability as unavailable with a reason.")
def test_availability_unavailable_with_reason():
    out = availability(is_available=False, unavailability_reason="  Maintenance  ")
    assert out.is_available is False
    assert out.unavailability_reason == "Maintenance"


@tc("BE-VCAT-012", "VenueAvailability", "Venue is marked unavailable without a reason.", "Validation error requiring an unavailability reason.",
    data="is_available=False, reason blank", steps="1. Instantiate VenueAvailability without a reason.", kind="Negative")
def test_availability_unavailable_requires_reason():
    with pytest.raises(ValidationError, match="reason for venue unavailability"):
        availability(is_available=False, unavailability_reason="   ")


@tc("BE-VCAT-013", "VenueAvailability", "An unavailability reason exceeds 1000 characters.", "Validation error.",
    data="1001 characters", steps="1. Instantiate VenueAvailability with an over-length reason.", kind="Edge")
def test_availability_reason_limit():
    with pytest.raises(ValidationError):
        availability(is_available=False, unavailability_reason="x" * 1001)


@tc("BE-VCAT-014", "VenueAvailability", "An unknown field is supplied.", "Validation error because extra fields are forbidden.",
    data="status = Closed", steps="1. Instantiate VenueAvailability with an extra field.", kind="Security")
def test_availability_extra_field():
    with pytest.raises(ValidationError):
        vc.VenueAvailability(is_available=True, status="Closed")


@tc("BE-VCAT-015", "unavailable", "The helper is asked for an error response.", "An HTTP 503 with a retry message is returned.",
    steps="1. Call unavailable(Exception()).", kind="Negative")
def test_unavailable():
    error = vc.unavailable(Exception("x"))
    assert (error.status_code, "try again" in error.detail) == (503, True)


@tc("BE-VCAT-016", "list_venues", "The catalogue is requested.", "All venues are returned ordered by name.",
    pre="Two venues stored out of order.", steps="1. Call list_venues().")
def test_list_venues(use_db):
    use_db(world([venue(1, name="Zeta"), venue(2, name="Alpha")]), vc)
    assert [v["name"] for v in vc.list_venues(user={})] == ["Alpha", "Zeta"]


@tc("BE-VCAT-017", "list_venues", "There are no venues.", "Empty list.",
    steps="1. Call list_venues() on an empty table.", kind="Edge")
def test_list_empty(use_db):
    use_db(world([]), vc)
    assert vc.list_venues(user={}) == []


@tc("BE-VCAT-018", "list_venues", "The database fails with an API error or a network error.", "HTTP 503 for both.",
    pre="Venues table raises.", steps="1. Raise APIError. 2. Raise httpx.ConnectError.", kind="Negative")
def test_list_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add("Venues")
    for error in (api_error(), httpx.ConnectError("down")):
        client.fail_error = error
        assert err(vc.list_venues, user={})[0] == 503


@tc("BE-VCAT-019", "venue_detail", "An existing venue is requested.", "The venue row is returned.",
    steps="1. Call venue_detail(1).")
def test_detail_found(use_db):
    use_db(world(), vc)
    assert vc.venue_detail(1, user={})["name"] == "Hall 1"


@tc("BE-VCAT-020", "venue_detail", "The venue does not exist.", "HTTP 404 \"Venue not found.\"",
    steps="1. Call venue_detail(99).", kind="Negative")
def test_detail_missing(use_db):
    use_db(world(), vc)
    assert err(vc.venue_detail, 99, user={}) == (404, "Venue not found.")


@tc("BE-VCAT-021", "venue_detail", "The database fails.", "HTTP 503.",
    steps="1. Make the Venues table raise APIError. 2. Call venue_detail(1).", kind="Negative")
def test_detail_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add("Venues")
    client.fail_error = api_error()
    assert err(vc.venue_detail, 1, user={})[0] == 503


@tc("BE-VCAT-022", "update_venue", "Venue staff saves valid changes.", "The venue row is updated with accessibility, safety and duration fields and returned.",
    steps="1. Call update_venue(1, update, staff).")
def test_update_venue_ok(use_db):
    client = use_db(world(), vc)
    out = vc.update_venue(1, update(accessible=0, emergency_access="Rear exit", venue_restrictions="No open flames",
                                   setup_time=120, teardown_time=45), user={"role": "venue staff"})
    assert out["accessible"] == 0
    assert out["emergency_access"] == "Rear exit"
    assert out["venue_restrictions"] == "No open flames"
    assert out["setup_time"] == 120 and out["teardown_time"] == 45
    assert client.tables["Venues"][1]["accessible"] == 0
    assert client.tables["Venues"][1]["emergency_access"] == "Rear exit"


@tc("BE-VCAT-023", "update_venue", "The venue does not exist.", "HTTP 404 \"Venue not found. Changes were not saved.\"",
    steps="1. Call update_venue(99, update, staff).", kind="Negative")
def test_update_venue_missing(use_db):
    use_db(world(), vc)
    assert err(vc.update_venue, 99, update(), user={})[1] == "Venue not found. Changes were not saved."


@tc("BE-VCAT-024", "update_venue", "The database fails while saving.", "HTTP 503.",
    steps="1. Make the update raise httpx.ReadTimeout.", kind="Negative")
def test_update_venue_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add(("Venues", "update"))
    client.fail_error = httpx.ReadTimeout("slow")
    assert err(vc.update_venue, 1, update(), user={})[0] == 503


@tc("BE-VCAT-025", "update_availability", "Venue staff marks a venue unavailable with a reason.", "The availability fields are updated and returned.",
    data="is_available=False, reason=Maintenance", steps="1. Call update_availability for venue 1.")
def test_update_availability_ok(use_db):
    client = use_db(world(), vc)
    out = vc.update_availability(1, availability(is_available=False, unavailability_reason="Maintenance"),
                                 user={"role": "venue staff"})
    assert out["is_available"] is False
    assert out["unavailability_reason"] == "Maintenance"
    assert client.tables["Venues"][1]["is_available"] is False


@tc("BE-VCAT-026", "update_availability", "Venue staff marks a venue available again.", "The unavailability reason is cleared.",
    pre="Venue is currently unavailable.", steps="1. Mark venue 1 available.")
def test_update_availability_clears_reason(use_db):
    use_db(world([venue(1, is_available=False, unavailability_reason="Maintenance")]), vc)
    out = vc.update_availability(1, availability(), user={"role": "venue staff"})
    assert out["is_available"] is True
    assert out["unavailability_reason"] == ""


@tc("BE-VCAT-027", "update_availability", "The venue does not exist.", "HTTP 404 \"Venue not found. Changes were not saved.\"",
    steps="1. Update availability for venue 99.", kind="Negative")
def test_update_availability_missing(use_db):
    use_db(world(), vc)
    assert err(vc.update_availability, 99, availability(is_available=False, unavailability_reason="Maintenance"),
               user={}) == (404, "Venue not found. Changes were not saved.")


@tc("BE-VCAT-028", "update_availability", "The database fails while saving availability.", "HTTP 503.",
    steps="1. Make the Venues update raise an API error.", kind="Negative")
def test_update_availability_unavailable(use_db):
    client = use_db(world(), vc)
    client.fail_tables.add(("Venues", "update"))
    client.fail_error = api_error()
    assert err(vc.update_availability, 1, availability(is_available=False, unavailability_reason="Maintenance"),
               user={})[0] == 503


def http(role, monkeypatch, client=None):
    app = FastAPI()
    app.include_router(vc.router)
    app.dependency_overrides[current_user] = lambda: {"id": "u1", "role": role}
    monkeypatch.setattr(vc, "db", lambda: client or world())
    return TestClient(app)


UPDATE_BODY = {
    "accessible": 1,
    "accessibility_details": "Step-free",
    "emergency_access": "Emergency exit beside main entrance",
    "venue_restrictions": "Keep emergency exits clear",
    "setup_time": 60,
    "teardown_time": 30,
}

AVAILABILITY_BODY = {
    "is_available": False,
    "unavailability_reason": "Maintenance",
}


@tc("BE-VCAT-029", "GET /api/venue-catalogue", "Technical Support, Event Coordinator and Event Coordinator Lead request the catalogue over HTTP.", "All three roles get 200.",
    steps="1. GET as Technical Support. 2. GET as Event Coordinator. 3. GET as Event Coordinator Lead.", kind="Security")
def test_http_get_roles(monkeypatch):
    assert http("technical support staff", monkeypatch).get("/api/venue-catalogue").status_code == 200
    assert http("event coordinator", monkeypatch).get("/api/venue-catalogue").status_code == 200
    assert http("event coordinator lead", monkeypatch).get("/api/venue-catalogue").status_code == 200


@tc("BE-VCAT-030", "GET /api/venue-catalogue", "Event Organiser and Attendee request the catalogue over HTTP.", "Both roles get HTTP 403.",
    steps="1. GET as Event Organiser. 2. GET as Attendee.", kind="Security")
def test_http_get_forbidden_roles(monkeypatch):
    assert http("event organiser", monkeypatch).get("/api/venue-catalogue").status_code == 403
    assert http("attendee", monkeypatch).get("/api/venue-catalogue").status_code == 403


@tc("BE-VCAT-031", "PUT /api/venue-catalogue/{id}", "A Technical Support user tries to edit a venue.", "HTTP 403 and nothing is saved.",
    pre="Caller role = technical support staff.", steps="1. PUT a valid body as Technical Support.", kind="Security")
def test_http_put_forbidden_for_technical_support(monkeypatch):
    client = world()
    assert http("technical support staff", monkeypatch, client).put("/api/venue-catalogue/1", json=UPDATE_BODY).status_code == 403
    assert not client.writes("Venues", "update")


@tc("BE-VCAT-032", "PUT /api/venue-catalogue/{id}", "Venue staff sends an invalid body over HTTP.", "HTTP 422 and nothing is saved.",
    data="accessible = 2", steps="1. PUT an invalid accessibility value as Venue Staff.", kind="Negative")
def test_http_put_validation(monkeypatch):
    client = world()
    bad = {**UPDATE_BODY, "accessible": 2}
    assert http("venue staff", monkeypatch, client).put("/api/venue-catalogue/1", json=bad).status_code == 422
    assert not client.writes("Venues", "update")


@tc("BE-VCAT-033", "PUT /api/venue-catalogue/{id}", "Venue staff sends a fractional setup duration.", "HTTP 422 and nothing is saved.",
    data="setup_time = 2.5", steps="1. PUT a valid body with setup_time 2.5 as Venue Staff.", kind="Negative")
def test_http_put_rejects_fractional_duration(monkeypatch):
    client = world()
    bad = {**UPDATE_BODY, "setup_time": 2.5}
    assert http("venue staff", monkeypatch, client).put("/api/venue-catalogue/1", json=bad).status_code == 422
    assert not client.writes("Venues", "update")


@tc("BE-VCAT-034", "PATCH /api/venue-catalogue/{id}/availability", "Venue Staff marks a venue unavailable over HTTP.", "HTTP 200 and the venue is updated.",
    steps="1. PATCH venue 1 availability as Venue Staff.")
def test_http_patch_availability(monkeypatch):
    client = world()
    response = http("venue staff", monkeypatch, client).patch("/api/venue-catalogue/1/availability", json=AVAILABILITY_BODY)
    assert response.status_code == 200
    assert response.json()["is_available"] is False
    assert response.json()["unavailability_reason"] == "Maintenance"


@tc("BE-VCAT-035", "PATCH /api/venue-catalogue/{id}/availability", "Technical Support tries to change venue availability.", "HTTP 403 and nothing is saved.",
    steps="1. PATCH venue 1 availability as Technical Support.", kind="Security")
def test_http_patch_forbidden_for_technical_support(monkeypatch):
    client = world()
    assert http("technical support staff", monkeypatch, client).patch("/api/venue-catalogue/1/availability", json=AVAILABILITY_BODY).status_code == 403
    assert not client.writes("Venues", "update")


@tc("BE-VCAT-036", "PATCH /api/venue-catalogue/{id}/availability", "Venue Staff marks a venue unavailable without a reason.", "HTTP 422 and nothing is saved.",
    data="is_available=False, reason blank", steps="1. PATCH an invalid availability body.", kind="Negative")
def test_http_patch_requires_reason(monkeypatch):
    client = world()
    bad = {"is_available": False, "unavailability_reason": "   "}
    assert http("venue staff", monkeypatch, client).patch("/api/venue-catalogue/1/availability", json=bad).status_code == 422
    assert not client.writes("Venues", "update")


@tc("BE-VCAT-037", "HTTP authentication", "An anonymous user accesses venue catalogue endpoints.", "Authentication rejects the requests.",
    steps="1. GET catalogue. 2. GET venue detail. 3. PUT venue update. 4. PATCH venue availability.", kind="Security")
def test_anonymous_requests_rejected(monkeypatch):
    app = FastAPI()
    app.include_router(vc.router)
    monkeypatch.setattr(vc, "db", lambda: world())
    client = TestClient(app)

    assert client.get("/api/venue-catalogue").status_code == 401
    assert client.get("/api/venue-catalogue/1").status_code == 401
    assert client.put("/api/venue-catalogue/1", json=UPDATE_BODY).status_code == 401
    assert client.patch("/api/venue-catalogue/1/availability", json=AVAILABILITY_BODY).status_code == 401
