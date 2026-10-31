"""Tentative venue holds (stories 22.1 and 22.2) and the booked periods they protect.

Venue staff hold a pending booking request until an expiry time. backend/sql/venue_holds.sql
places, removes and expires holds atomically and notifies the coordinator; this module gives the
API one reading of hold state. A hold whose expiry has passed counts as Expired straight away,
before the scheduled database job marks it, so it never blocks or confirms a venue.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import require_coordinator
from coordinator_assignment import EVENT_TABLE, db

router = APIRouter()
BOOKING_TABLE = "Venue Booking Requests"
VENUE_TABLE = "Venues"
PENDING, APPROVED, ON_HOLD, EXPIRED = "Pending", "Approved", "On Hold", "Expired"
SGT = timezone(timedelta(hours=8))  # Singapore has no DST, so a fixed offset is exact


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


def booking_window(event: dict[str, Any] | None) -> tuple[datetime, datetime] | None:
    """The booked period, from the event's dates and times; booking rows have no times of their own."""
    event = event or {}
    start = event_datetime(event, "event_date", "start_time")
    end = event_datetime(event, "event_end_date", "end_time")
    return (datetime.fromisoformat(start), datetime.fromisoformat(end)) if start and end else None


def is_active_hold(booking: dict[str, Any], now: datetime | None = None) -> bool:
    expires = booking.get("hold_expires_at")
    return (
        booking.get("status") == ON_HOLD
        and bool(expires)
        and datetime.fromisoformat(expires) > (now or datetime.now(timezone.utc))
    )


def effective_status(booking: dict[str, Any], now: datetime | None = None) -> str:
    """The stored status, except that a hold past its expiry is already Expired."""
    if booking.get("status") == ON_HOLD and not is_active_hold(booking, now):
        return EXPIRED
    return booking.get("status")


def blocks_venue(booking: dict[str, Any], now: datetime | None = None) -> bool:
    """Confirmed bookings and unexpired holds make a venue unavailable; nothing else does."""
    return booking.get("status") == APPROVED or is_active_hold(booking, now)


def hold_fields(booking: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """The status and hold expiry to show for a booking row, in SGT."""
    return {"status": effective_status(booking, now), "hold_expires_at": to_sgt(booking.get("hold_expires_at"))}


def buffered(window: tuple[datetime, datetime], venue: dict[str, Any]) -> tuple[datetime, datetime]:
    """Widen a booked period by the venue's setup and teardown minutes."""
    setup = int(venue.get("setup_time") or venue.get("setup_minutes") or 0)
    teardown = int(venue.get("teardown_time") or venue.get("turnaround_time") or venue.get("teardown_minutes") or 0)
    return window[0] - timedelta(minutes=setup), window[1] + timedelta(minutes=teardown)


def events_by_id(client, bookings: list[dict[str, Any]]) -> dict[Any, dict[str, Any]]:
    event_ids = list({b["event_id"] for b in bookings})
    if not event_ids:
        return {}
    return {e["id"]: e for e in client.table(EVENT_TABLE).select("*").in_("id", event_ids).execute().data or []}


def find_conflict(
    client,
    venue_id: Any,
    venue: dict[str, Any],
    window: tuple[datetime, datetime],
    exclude_request_id: Any = None,
) -> dict[str, Any] | None:
    """A confirmed booking or unexpired hold at the venue that overlaps window, including buffers."""
    bookings = [
        b for b in client.table(BOOKING_TABLE).select("*").eq("venue_id", venue_id).in_("status", [APPROVED, ON_HOLD]).execute().data or []
        if b.get("request_id") != exclude_request_id and blocks_venue(b)
    ]
    events = events_by_id(client, bookings)
    start, end = buffered(window, venue)
    for booking in bookings:
        other = booking_window(events.get(booking["event_id"]))
        if other:
            other_start, other_end = buffered(other, venue)
            if start < other_end and end > other_start:
                return booking
    return None


# Precedence when several requests overlap the period: a confirmed booking wins over a hold,
# and an active hold over one that has expired.
VENUE_STATUS = {APPROVED: "Confirmed", ON_HOLD: "On Hold", EXPIRED: "Expired"}
STATUS_RANK = {"Confirmed": 0, "On Hold": 1, "Expired": 2}


@router.get("/api/venue-availability")
def venue_availability(event_id: int, user: dict[str, Any] = Depends(require_coordinator)):
    """Each venue's status for the period of one of the coordinator's events:
    Confirmed, On Hold (with its expiry), Expired or Available."""
    client = db()
    result = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute()
    event = result.data if result else None
    if not event:
        raise HTTPException(404, "Event not found.")
    if str(event.get("coordinator_id")) != str(user["id"]):
        raise HTTPException(403, "You can only check venues for events assigned to you.")
    window = booking_window(event)
    if not window:
        raise HTTPException(400, "This event has no start or end time, so venue availability can't be checked.")

    venues = client.table(VENUE_TABLE).select("*").execute().data or []
    bookings = client.table(BOOKING_TABLE).select("*").in_("status", [APPROVED, ON_HOLD, EXPIRED]).execute().data or []
    events = events_by_id(client, bookings)
    now = datetime.now(timezone.utc)
    statuses = []
    for venue in venues:
        start, end = buffered(window, venue)
        found = []
        for booking in bookings:
            other = booking_window(events.get(booking["event_id"])) if booking.get("venue_id") == venue["venue_id"] else None
            if other:
                other_start, other_end = buffered(other, venue)
                if start < other_end and end > other_start:
                    found.append((STATUS_RANK[VENUE_STATUS[effective_status(booking, now)]], booking))
        if found:
            _, booking = min(found, key=lambda item: item[0])
            status = VENUE_STATUS[effective_status(booking, now)]
            statuses.append({
                "venue_id": venue["venue_id"],
                "status": status,
                "hold_expires_at": to_sgt(booking.get("hold_expires_at")) if status != "Confirmed" else None,
                "request_id": booking.get("request_id"),
                "own_event": str(booking.get("event_id")) == str(event_id),
            })
        else:
            statuses.append({"venue_id": venue["venue_id"], "status": "Available", "hold_expires_at": None,
                             "request_id": None, "own_event": False})
    return statuses
