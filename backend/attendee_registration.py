from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from auth import require_attendee
from coordinator_assignment import db, EVENT_TABLE

router = APIRouter(prefix="/api/attendee", tags=["Attendee registration"])
SGT = timezone(timedelta(hours=8))
EVENT_FIELDS = "id,event_name,event_type,description,event_date,event_end_date,start_time,end_time,status,event_capacity"


def event_view(client, event):
    # Only approved bookings are published as the event venue.
    bookings = client.table("Venue Booking Requests").select("venue_id").eq("event_id", event["id"]).eq("status", "Approved").execute().data or []
    ids = list({b["venue_id"] for b in bookings})
    venues = client.table("Venues").select("venue_id,name,location").in_("venue_id", ids).execute().data if ids else []
    return {key: event.get(key) for key in EVENT_FIELDS.split(",")} | {"venues": venues or []}


def has_started(event):
    try:
        start = datetime.fromisoformat(f"{event['event_date']}T{event['start_time']}").replace(tzinfo=SGT)
        return start <= datetime.now(SGT)
    except (KeyError, TypeError, ValueError):
        return True


@router.get("/events")
def available_events(user=Depends(require_attendee)):
    client = db()
    events = client.table(EVENT_TABLE).select(EVENT_FIELDS).eq("status", "Confirmed").order("event_date").execute().data or []
    registered = {r["event_id"] for r in client.table("event_registrations").select("event_id").eq("attendee_id", user["id"]).execute().data or []}
    return [event_view(client, event) | {"registered": event["id"] in registered} for event in events if not has_started(event)]


@router.get("/registrations")
def registrations(user=Depends(require_attendee)):
    client = db()
    rows = client.table("event_registrations").select("event_id,registered_at").eq("attendee_id", user["id"]).order("registered_at", desc=True).execute().data or []
    if not rows:
        return []
    events = {e["id"]: e for e in client.table(EVENT_TABLE).select(EVENT_FIELDS).in_("id", [r["event_id"] for r in rows]).execute().data or []}
    return [event_view(client, events[r["event_id"]]) | {"registered_at": r["registered_at"], "registered": True} for r in rows if r["event_id"] in events]


@router.post("/events/{event_id}/register", status_code=201)
def register(event_id: int, user=Depends(require_attendee)):
    # The RPC locks the event row, then checks status, start, duplicate and capacity
    # in one transaction. The attendee identity always comes from verified auth.
    try:
        result = db().rpc("register_for_event", {"p_event_id": event_id, "p_attendee_id": str(user["id"])}).execute()
    except APIError as error:
        codes = {"P0002": 404, "23505": 409, "P0001": 409, "42501": 403}
        if error.code in codes:
            raise HTTPException(codes[error.code], error.message) from error
        raise HTTPException(503, "Registration is temporarily unavailable. Please try again.") from error
    return {"message": "Registration successful.", "registration": result.data}
