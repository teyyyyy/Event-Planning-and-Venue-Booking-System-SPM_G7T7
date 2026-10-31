from fastapi import APIRouter, Depends, HTTPException
from typing import List, Literal
from datetime import datetime, timezone
from pydantic import BaseModel
from supabase import Client
from postgrest.exceptions import APIError
from database import create_client
from auth import require_coordinator_or_staff, require_coordinator_path
# Shared, normalised settings: accepts VITE_SUPABASE_URL and strips a /rest/v1 suffix.
from coordinator_assignment import SUPABASE_SERVICE_ROLE_KEY as SUPABASE_KEY, SUPABASE_URL
from venue_constants import ALTERNATIVE_OFFERED, APPROVED, EXPIRED, ON_HOLD, PENDING, REJECTED
from venue_holds import booking_window, find_conflict, hold_fields, venue_guard_refused

router = APIRouter()

BOOKING_TABLE = 'Venue Booking Requests'
EVENTS_TABLE = 'Event Details'
VENUES_TABLE = 'Venues'

# --- Pydantic Models ---

class VenueResponse(BaseModel):
    venue_id: int
    name: str
    capacity: int
    location: str
    facilities: List[str]

class VenueBookingCreate(BaseModel):
    event_id: int
    venue_id: int
    coordinator_id: str

class AlternativeVenueDecision(BaseModel):
    decision: Literal["accept", "decline"]


# --- Helper Function ---

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Endpoints ---

@router.get("/api/venues", dependencies=[Depends(require_coordinator_or_staff)])
def get_all_venues():
    """Fetches the complete venue catalogue."""
    supabase = get_supabase()
    response = supabase.table(VENUES_TABLE).select('*').execute()
    return response.data

@router.post("/api/venue-bookings")
def create_venue_booking(booking: VenueBookingCreate, user=Depends(require_coordinator_or_staff)):
    """Submits a new venue booking request."""
    supabase = get_supabase()
    if str(booking.coordinator_id) != str(user["id"]):
        raise HTTPException(status_code=403, detail="You can only request venues for your own events.")
    event = (
        supabase.table(EVENTS_TABLE).select("*").eq("id", booking.event_id)
        .maybe_single().execute().data
    )
    if not event or str(event.get("coordinator_id")) != str(user["id"]):
        raise HTTPException(status_code=403, detail="You can only request venues for events assigned to you.")
    
    venue = supabase.table(VENUES_TABLE).select("*").eq("venue_id", booking.venue_id).maybe_single().execute().data
    if not venue:
        raise HTTPException(404, "Venue not found.")
    if venue.get("is_available") is False:
        raise HTTPException(409, "This venue is unavailable. Please select another venue.")
    # A confirmed booking or an unexpired hold makes the venue unavailable for overlapping times.
    window = booking_window(event)
    if window and find_conflict(supabase, booking.venue_id, venue, window):
        raise HTTPException(409, "This venue is already booked or on hold for this event's time. Please choose a different venue.")

    new_request = {
        "event_id": booking.event_id,
        "venue_id": booking.venue_id,
        "coordinator_id": booking.coordinator_id,
        "status": PENDING
    }
    
    try:
        response = supabase.table(BOOKING_TABLE).insert(new_request).execute()
        
        if not response.data:
            raise HTTPException(status_code=400, detail="Failed to create venue booking request.")
            
        return {"request_id": response.data[0].get("request_id")}
    except HTTPException:
        raise
    except APIError as e:
        # An event may request several venues, but only one active request per venue (story 20.1).
        if e.code == "23505":
            raise HTTPException(409, "This event already has an active request for this venue. Please choose a different venue.") from e
        if venue_guard_refused(e):
            raise HTTPException(409, "This venue is unavailable. Refresh and select a replacement venue.") from e
        raise HTTPException(503, "Unable to save venue request. Please try again.") from e
    except Exception as e:
        raise HTTPException(503, "Unable to save venue request. Please try again.") from e

@router.get("/api/venue-booking-requests/venues/{venue_id}", dependencies=[Depends(require_coordinator_or_staff)])
def list_requests_by_venue(venue_id: int, include_pending: bool = False):
    client = get_supabase()
    try:
        query = client.table(BOOKING_TABLE).select(f'*, "{EVENTS_TABLE}"(*)').eq("venue_id", venue_id)
        
        # Holds are always shown; pending requests and expired holds only on request.
        statuses = [APPROVED, ON_HOLD, PENDING, EXPIRED] if include_pending else [APPROVED, ON_HOLD]
        rows = [{**row, **hold_fields(row)} for row in query.in_("status", statuses).execute().data or []]
        return rows if include_pending else [row for row in rows if row["status"] != EXPIRED]
    
    except Exception as e:
        raise HTTPException(503, "Venue bookings could not be loaded. Please try again.") from e

@router.get("/api/venue-booking-requests/coordinators/{coordinator_id}", dependencies=[Depends(require_coordinator_path)])
def list_requests_by_coordinator(coordinator_id: str):
    client = get_supabase()
    bookings = (
        client.table(BOOKING_TABLE)
        .select(f'*, "{EVENTS_TABLE}"(layout_required, facilities_required, accessibility_required, event_date, event_end_date, start_time, end_time)')
        .eq("coordinator_id", coordinator_id)
        .execute()
        .data or []
    )
    return [{**booking, **hold_fields(booking)} for booking in bookings]


@router.post("/api/venue-booking-requests/coordinators/{coordinator_id}/{request_id}/alternative")
def decide_alternative_venue(
    coordinator_id: str,
    request_id: int,
    decision: AlternativeVenueDecision,
    user=Depends(require_coordinator_path),
):
    if str(user.get("role", "")).strip().lower() != "event coordinator":
        raise HTTPException(403, "Event Coordinator access required.")
    client = get_supabase()
    booking = (
        client.table(BOOKING_TABLE).select("*").eq("request_id", request_id)
        .eq("coordinator_id", user["id"]).maybe_single().execute().data
    )
    if not booking:
        raise HTTPException(404, "Venue booking request not found.")
    event = (
        client.table(EVENTS_TABLE).select("*").eq("id", booking["event_id"])
        .maybe_single().execute().data
    )
    if not event or str(event.get("coordinator_id")) != str(user["id"]):
        raise HTTPException(403, "You can only decide alternatives for your assigned events.")
    if (
        booking.get("status") != ALTERNATIVE_OFFERED
        or not booking.get("alternative_venue_id")
    ):
        raise HTTPException(409, "This request has no pending alternative venue offer.")

    changes = {
        "status": REJECTED,
        "alternative_venue_id": None,
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }
    if decision.decision == "accept":
        alternative_id = booking["alternative_venue_id"]
        venue = (
            client.table(VENUES_TABLE).select("*").eq("venue_id", alternative_id)
            .maybe_single().execute().data
        )
        
        if not venue or venue.get("is_available") is False:
            raise HTTPException(409, "The suggested venue is no longer available.")
        window = booking_window(event)
        if window and find_conflict(client, alternative_id, venue, window, request_id):
            raise HTTPException(409, "The suggested venue is already booked for this event time.")
        changes.update({
            "venue_id": alternative_id,
            "status": APPROVED,
            "rejection_reason": None,
            "replacement_required": False,
        })

    try:
        updated = (
            client.table(BOOKING_TABLE).update(changes)
            .eq("request_id", request_id)
            .eq("coordinator_id", user["id"])
            .eq("status", ALTERNATIVE_OFFERED)
            .eq("alternative_venue_id", booking["alternative_venue_id"])
            .execute().data
        )
    except APIError as error:
        if error.code == "23505":
            raise HTTPException(409, "This event already has an active request for the suggested alternative venue.") from error
        if venue_guard_refused(error):
            raise HTTPException(409, "The suggested venue is no longer available.") from error
        raise
    if not updated:
        raise HTTPException(409, "This alternative offer was just decided by someone else.")
    return updated[0]


@router.post("/api/venue-booking-requests/coordinators/{coordinator_id}/{request_id}/replacement")
def start_replacement_request(
    coordinator_id: str,
    request_id: int,
    user=Depends(require_coordinator_path),
):
    if str(user.get("role", "")).strip().lower() != "event coordinator":
        raise HTTPException(403, "Event Coordinator access required.")
    client = get_supabase()
    booking = (
        client.table(BOOKING_TABLE).select("*").eq("request_id", request_id)
        .eq("coordinator_id", user["id"]).maybe_single().execute().data
    )
    if not booking:
        raise HTTPException(404, "Venue booking request not found.")
    event = (
        client.table(EVENTS_TABLE).select("*").eq("id", booking["event_id"])
        .maybe_single().execute().data
    )
    if not event or str(event.get("coordinator_id")) != str(user["id"]):
        raise HTTPException(403, "You can only replace requests for your assigned events.")
    if not booking.get("replacement_required"):
        raise HTTPException(409, "This request does not require a replacement venue.")

    updated = (
        client.table(BOOKING_TABLE)
        .update({
            "status": REJECTED,
            "replacement_required": False,
            "decided_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("request_id", request_id)
        .eq("coordinator_id", user["id"])
        .eq("status", booking["status"])
        .eq("replacement_required", True)
        .execute().data
    )
    if not updated:
        raise HTTPException(409, "This replacement request was just updated by someone else.")
    return updated[0]