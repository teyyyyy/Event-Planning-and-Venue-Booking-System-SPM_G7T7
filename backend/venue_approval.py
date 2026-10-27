from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from postgrest.exceptions import APIError

from auth import require_venue_staff
from coordinator_assignment import EVENT_TABLE, db
from venue_holds import (
    APPROVED, BOOKING_TABLE, EXPIRED, ON_HOLD, PENDING, SGT, VENUE_TABLE,
    booking_window, effective_status, event_datetime, find_conflict, to_sgt,
)

router = APIRouter()
REJECTED = "Rejected"

# Event Details columns that may hold accessibility once the booking-request
# feature writes it there; the first one present wins over the booking row.
EVENT_ACCESSIBILITY_COLUMNS = ("accessibility_required", "accessibility")


class RejectionDetails(BaseModel):
    reason: str | None = None
    alternative_venue: str | None = None


class HoldDetails(BaseModel):
    expires_at: datetime  # without an offset it is read as SGT


def clean(text: str | None) -> str | None:
    return (text or "").strip() or None


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
        "status": effective_status(booking),
        "hold_expires_at": to_sgt(booking.get("hold_expires_at")),
        "hold_placed_at": to_sgt(booking.get("hold_placed_at")),
        "replacement_required": booking.get("replacement_required", False),
        "is_available": venue.get("is_available", True),
        "unavailability_reason": venue.get("unavailability_reason", ""),
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
        "setup_time": venue.get("setup_time"),
        "teardown_time": venue.get("teardown_time"),
        "accessibility_required": bool(accessibility),
        "layout_required": booking.get("layout_required"),
        "facilities_required": booking.get("facilities_required") or [],
        "coordinator_name": coordinator.get("name"),
        "coordinator_email": coordinator.get("email"),
        "rejection_reason": booking.get("rejection_reason"),
        "alternative_venue": booking.get("alternative_venue"),
        "change_request_id": booking.get("change_request_id"),
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
    status = effective_status(booking)
    if status == EXPIRED:
        raise HTTPException(409, "This hold has expired. The event coordinator must submit a new venue request.")
    if status not in (PENDING, ON_HOLD):
        raise HTTPException(409, f"This request has already been {status.lower()}.")

    # Prevent approvals if event logic overlaps (including setup/teardown buffers).
    # Approving a held request converts its hold into the confirmed booking.
    if changes.get("status") == APPROVED:
        venue = client.table(VENUE_TABLE).select("*").eq("venue_id", booking["venue_id"]).maybe_single().execute().data or {}
        if booking.get("replacement_required") or venue.get("is_available") is False:
            raise HTTPException(409, "This booking needs a replacement venue and cannot be approved.")
        event = client.table(EVENT_TABLE).select("*").eq("id", booking["event_id"]).maybe_single().execute().data
        requested = booking_window(booking, event)
        conflict = find_conflict(client, booking["venue_id"], venue, requested, request_id) if requested else None
        if conflict and conflict.get("status") == ON_HOLD:
            raise HTTPException(409, "Cannot approve: Venue is on hold for another event during this time (including setup/teardown buffers).")
        if conflict:
            raise HTTPException(409, "Cannot approve: Venue is already booked during this time (including setup/teardown buffers).")

    # Guard on status so two staff deciding at once can't overwrite each other.
    try:
        updated = (
            client.table(BOOKING_TABLE)
            .update({**changes, "decided_at": datetime.now(timezone.utc).isoformat()})
            .eq("request_id", request_id)
            .eq("status", booking["status"])
            .execute()
            .data
        )
    except APIError as error:
        if error.code == "23514":
            raise HTTPException(409, "Venue availability changed. Refresh this request before deciding.") from error
        raise
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


def hold_action(name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Run a hold RPC; venue_holds.sql checks ownership, status, expiry and conflicts atomically."""
    client = db()
    try:
        result = client.rpc(name, params).execute()
    except APIError as error:
        status = {"P0002": 404, "42501": 403, "22023": 400, "55000": 409, "23P01": 409}.get(error.code)
        if status:
            raise HTTPException(status, error.message) from error
        raise
    booking = result.data[0] if isinstance(result.data, list) and result.data else result.data
    if not booking:
        raise HTTPException(500, "The venue hold could not be saved.")
    return enrich(client, [booking])[0]


@router.post("/api/venue-booking-requests/{request_id}/hold")
def place_hold(request_id: int, details: HoldDetails, staff: dict[str, Any] = Depends(require_venue_staff)):
    expires_at = details.expires_at if details.expires_at.tzinfo else details.expires_at.replace(tzinfo=SGT)
    return hold_action(
        "place_venue_hold",
        {"p_request_id": request_id, "p_staff_id": staff["id"], "p_expires_at": expires_at.isoformat()},
    )


@router.delete("/api/venue-booking-requests/{request_id}/hold")
def remove_hold(request_id: int, staff: dict[str, Any] = Depends(require_venue_staff)):
    return hold_action("remove_venue_hold", {"p_request_id": request_id, "p_staff_id": staff["id"]})
