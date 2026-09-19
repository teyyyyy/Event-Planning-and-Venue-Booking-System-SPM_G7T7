from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_venue_staff
from coordinator_assignment import EVENT_TABLE, db

router = APIRouter()
BOOKING_TABLE = "Venue Booking Requests"
VENUE_TABLE = "Venues"
PENDING, APPROVED, REJECTED = "Pending", "Approved", "Rejected"
SGT = timezone(timedelta(hours=8))  # Singapore has no DST, so a fixed offset is exact

# Event Details columns that may hold accessibility once the booking-request
# feature writes it there; the first one present wins over the booking row.
EVENT_ACCESSIBILITY_COLUMNS = ("accessibility_required", "accessibility")


class RejectionDetails(BaseModel):
    reason: str | None = None
    alternative_venue: str | None = None


def clean(text: str | None) -> str | None:
    return (text or "").strip() or None


def to_sgt(timestamp: str | None) -> str | None:
    """Booking timestamps are stored in UTC; show them in SGT."""
    return datetime.fromisoformat(timestamp).astimezone(SGT).isoformat() if timestamp else None


def event_datetime(event: dict[str, Any], date_key: str, time_key: str) -> str | None:
    """Event Details dates/times are naive wall-clock values entered in SGT.

    A missing event_end_date means a single-day event, so it falls back to event_date.
    """
    day = event.get(date_key) or event.get("event_date")
    if day and event.get(time_key):
        return datetime.fromisoformat(f"{day}T{event[time_key]}").replace(tzinfo=SGT).isoformat()
    return None


def event_accessibility(event: dict[str, Any]) -> Any:
    return next((event[key] for key in EVENT_ACCESSIBILITY_COLUMNS if event.get(key) is not None), None)


def view(booking: dict[str, Any], event: dict[str, Any] | None, venue: dict[str, Any] | None, users: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Booking row enriched with Event Details; event values take priority over the booking row's copies."""
    event, venue = event or {}, venue or {}
    accessibility = event_accessibility(event)
    if accessibility is None:
        accessibility = booking.get("accessibility_required")
    coordinator = users.get(str(booking.get("coordinator_id"))) or {}
    return {
        "request_id": booking["request_id"],
        "status": booking["status"],
        "created_at": booking.get("created_at"),
        "decided_at": booking.get("decided_at"),
        "venue_id": booking["venue_id"],
        "venue_name": venue.get("venue_name") or venue.get("name") or f"Venue {booking['venue_id']}",
        "event_id": booking["event_id"],
        "event_name": event.get("event_name"),
        "event_type": event.get("event_type"),
        "event_description": event.get("description"),
        "event_capacity": event.get("event_capacity"),
        "start_datetime": event_datetime(event, "event_date", "start_time") or to_sgt(booking.get("start_datetime")),
        "end_datetime": event_datetime(event, "event_end_date", "end_time") or to_sgt(booking.get("end_datetime")),
        "accessibility_required": bool(accessibility),
        "layout_required": booking.get("layout_required"),
        "facilities_required": booking.get("facilities_required") or [],
        "coordinator_name": coordinator.get("name"),
        "coordinator_email": coordinator.get("email"),
        "rejection_reason": booking.get("rejection_reason"),
        "alternative_venue": booking.get("alternative_venue"),
    }


def enrich(client, bookings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not bookings:
        return []
    event_ids = list({b["event_id"] for b in bookings})
    venue_ids = list({b["venue_id"] for b in bookings})
    user_ids = list({str(b["coordinator_id"]) for b in bookings if b.get("coordinator_id")})
    events = {e["id"]: e for e in client.table(EVENT_TABLE).select("*").in_("id", event_ids).execute().data or []}
    venues = {v["venue_id"]: v for v in client.table(VENUE_TABLE).select("*").in_("venue_id", venue_ids).execute().data or []}
    users = {str(u["id"]): u for u in client.table("users").select("id,name,email").in_("id", user_ids).execute().data or []} if user_ids else {}
    return [view(b, events.get(b["event_id"]), venues.get(b["venue_id"]), users) for b in bookings]


def owned_booking(client, request_id: int, staff: dict[str, Any]) -> dict[str, Any]:
    booking = client.table(BOOKING_TABLE).select("*").eq("request_id", request_id).maybe_single().execute()
    if not booking or not booking.data:
        raise HTTPException(404, "Venue booking request not found.")
    if str(booking.data.get("venue_staff_id")) != str(staff["id"]):
        raise HTTPException(403, "This venue booking request is assigned to another venue staff member.")
    return booking.data


def decide(request_id: int, staff: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    client = db()
    booking = owned_booking(client, request_id, staff)
    if booking["status"] != PENDING:
        raise HTTPException(409, f"This request has already been {booking['status'].lower()}.")
    # Guard on status so two staff deciding at once can't overwrite each other.
    updated = (
        client.table(BOOKING_TABLE)
        .update({**changes, "decided_at": datetime.now(timezone.utc).isoformat()})
        .eq("request_id", request_id)
        .eq("status", PENDING)
        .execute()
        .data
    )
    if not updated:
        raise HTTPException(409, "This request was just decided by someone else.")
    return enrich(client, updated)[0]


@router.get("/api/venue-booking-requests")
def list_requests(staff: dict[str, Any] = Depends(require_venue_staff)):
    client = db()
    bookings = (
        client.table(BOOKING_TABLE).select("*").eq("venue_staff_id", staff["id"]).order("created_at", desc=True).execute().data or []
    )
    return enrich(client, bookings)


@router.get("/api/venue-booking-requests/{request_id}")
def get_request(request_id: int, staff: dict[str, Any] = Depends(require_venue_staff)):
    client = db()
    return enrich(client, [owned_booking(client, request_id, staff)])[0]


@router.post("/api/venue-booking-requests/{request_id}/approve")
def approve_request(request_id: int, staff: dict[str, Any] = Depends(require_venue_staff)):
    return decide(request_id, staff, {"status": APPROVED, "rejection_reason": None, "alternative_venue": None})


@router.post("/api/venue-booking-requests/{request_id}/reject")
def reject_request(request_id: int, details: RejectionDetails | None = None, staff: dict[str, Any] = Depends(require_venue_staff)):
    details = details or RejectionDetails()
    return decide(
        request_id,
        staff,
        {"status": REJECTED, "rejection_reason": clean(details.reason), "alternative_venue": clean(details.alternative_venue)},
    )
