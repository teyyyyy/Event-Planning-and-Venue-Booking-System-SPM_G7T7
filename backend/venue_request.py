from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
from datetime import datetime
from supabase import create_client, Client
import os

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

router = APIRouter()

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
    response = supabase.table('Venues').select('*').execute()
    return response.data

@router.post("/api/venue-bookings")
def create_venue_booking(booking: VenueBookingCreate):
    """Submits a new venue booking request."""
    supabase = get_supabase()
    
    # Structure the payload to match your database schema
    new_request = {
        "event_id": booking.event_id,
        "venue_id": booking.venue_id,
        "start_datetime": booking.start_datetime.isoformat(),
        "end_datetime": booking.end_datetime.isoformat(),
        "status": "Pending" 
    }
    
    try:
        # Assuming your table is named 'Venue_Booking_Requests'
        response = supabase.table('Venue_Booking_Requests').insert(new_request).execute()
        
        if not response.data:
            raise HTTPException(status_code=400, detail="Failed to create venue booking request.")
            
        # The frontend expects request_id in the response body to show success
        return {"request_id": response.data[0].get("request_id")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))