from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
from datetime import datetime
from supabase import create_client, Client
import os

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

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
    start_datetime: datetime
    end_datetime: datetime

# --- Helper Function ---

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Endpoints ---

@router.get("/api/venues")
def get_all_venues():
    """Fetches the complete venue catalogue."""
    supabase = get_supabase()
    response = supabase.table(VENUES_TABLE).select('*').execute()
    return response.data

@router.post("/api/venue-bookings")
def create_venue_booking(booking: VenueBookingCreate):
    """Submits a new venue booking request."""
    supabase = get_supabase()
    
    new_request = {
        "event_id": booking.event_id,
        "venue_id": booking.venue_id,
        "coordinator_id": booking.coordinator_id,
        "start_datetime": booking.start_datetime.isoformat(),
        "end_datetime": booking.end_datetime.isoformat(),
        "status": "Pending" 
    }
    
    try:
        response = supabase.table(BOOKING_TABLE).insert(new_request).execute()
        
        if not response.data:
            raise HTTPException(status_code=400, detail="Failed to create venue booking request.")
            
        return {"request_id": response.data[0].get("request_id")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/venue-booking-requests/{venue_id}")
def list_requests_by_venue(venue_id: int):
    client = get_supabase()
    bookings = (
        client.table(BOOKING_TABLE).select("*").eq("venue_id", venue_id).eq("status", 'Approved').execute().data or []
    )
    return bookings