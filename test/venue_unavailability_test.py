"""Stories 25.1–25.3 API validation and authorization."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
import venue_catalogue as vc
import venue_request as vr
import venue_approval as va
from auth import current_user
from main import app
from fake_supabase import FakeClient


def test_reason_validation():
    with pytest.raises(ValidationError):
        vc.VenueAvailability(is_available=False, unavailability_reason="  ")
    with pytest.raises(ValidationError):
        vc.VenueAvailability(is_available="false", unavailability_reason="Safety")
    assert vc.VenueAvailability(is_available=True, unavailability_reason="old").unavailability_reason == ""


def test_staff_can_toggle_and_coordinator_cannot(monkeypatch):
    client = FakeClient({"Venues": [{"venue_id": 5, "is_available": True}]})
    monkeypatch.setattr(vc, "db", lambda: client)
    try:
        app.dependency_overrides[current_user] = lambda: {"id": "c1", "role": "Event Coordinator"}
        api = TestClient(app)
        assert api.patch("/api/venue-catalogue/5/availability", json={"is_available": False, "unavailability_reason": "Safety"}).status_code == 403
        app.dependency_overrides[current_user] = lambda: {"id": "s1", "role": "Venue Staff"}
        result = api.patch("/api/venue-catalogue/5/availability", json={"is_available": False, "unavailability_reason": " Safety "})
        assert result.status_code == 200 and result.json()["unavailability_reason"] == "Safety"
        assert api.patch("/api/venue-catalogue/5/availability", json={"is_available": True}).json()["is_available"] is True
        assert api.patch("/api/venue-catalogue/9/availability", json={"is_available": True}).status_code == 404
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_unavailable_venue_rejects_direct_booking(monkeypatch):
    client = FakeClient({"Venues": [{"venue_id": 5, "is_available": False}], "Event Details": [{"id": 10, "coordinator_id": "c1"}]})
    monkeypatch.setattr(vr, "get_supabase", lambda: client)
    with pytest.raises(HTTPException) as error:
        vr.create_venue_booking(vr.VenueBookingCreate(event_id=10, venue_id=5, coordinator_id="c1"), {"id": "c1"})
    assert error.value.status_code == 409
    assert not client.tables.get("Venue Booking Requests")


@pytest.mark.parametrize("available,replacement", [(False, False), (True, True)])
def test_disrupted_booking_cannot_be_approved(monkeypatch, available, replacement):
    client = FakeClient({"Venues": [{"venue_id": 5, "is_available": available}], "Venue Booking Requests": [{"request_id": 1, "venue_id": 5, "venue_staff_id": "s1", "status": "Pending", "replacement_required": replacement}]})
    monkeypatch.setattr(va, "db", lambda: client)
    with pytest.raises(HTTPException) as error:
        va.approve_request(1, {"id": "s1"})
    assert error.value.status_code == 409
