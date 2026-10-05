"""Significant event changes (story 10.2) and processing approved change requests (story 44.4).

The database classifies and logs every saved change to a submitted event and reopens the
arrangements it affects (backend/sql/significant_event_changes.sql). This module previews that
classification for pending change requests, serves the change history to the users who work on
the event, and lets the assigned coordinator process an approved change request.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from auth import current_user, require_coordinator

router = APIRouter()
EVENT_TABLE = "Event Details"
BOOKING_TABLE = "Venue Booking Requests"
EQUIPMENT_REQUEST_TABLE = "Equipment Request"

# Mirrors event_change_impact() in significant_event_changes.sql, in the same display order.
VENUE_FIELDS = (
    "event_date", "event_end_date", "start_time", "end_time", "event_capacity",
    "venue_id", "layout_required", "facilities_required", "accessibility_required",
)
EQUIPMENT_FIELDS = ("event_date", "event_end_date", "start_time", "end_time")
TRACKED_FIELDS = ("event_name", "event_type", "description", *VENUE_FIELDS)
# Requests in these states are history, so a significant change neither reopens nor replaces them.
CLOSED_VENUE_STATUSES = {"cancelled", "rejected", "superseded"}
CLOSED_EQUIPMENT_STATUSES = CLOSED_VENUE_STATUSES | {"draft"}


def db():
    from coordinator_assignment import db as coordinator_db

    return coordinator_db()


def status_of(row: dict[str, Any]) -> str:
    return str(row.get("status") or "").strip().lower()


def comparable(record: dict[str, Any], field: str) -> str | None:
    value = record.get(field)
    if field == "event_end_date":
        value = value or record.get("event_date")  # blank end date = single-day event
    if value is None:
        return None
    return str(value)[:5] if field.endswith("_time") else str(value)


def classify_change(current: dict[str, Any], proposed: dict[str, Any]) -> dict[str, Any]:
    """Compare the proposed values with the current event and say what they would affect."""
    changed = [field for field in TRACKED_FIELDS if field in proposed and comparable(current, field) != comparable(proposed, field)]
    # Every equipment field is also a venue field, so the venue fields are the significant ones.
    significant = [field for field in changed if field in VENUE_FIELDS]
    return {
        "change_type": "Significant" if significant else "Ordinary",
        "significant_fields": significant,
        "affects_venue": bool(significant),
        "affects_equipment": any(field in EQUIPMENT_FIELDS for field in changed),
    }


def live_arrangements(client, event_ids: list[Any]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    """Venue bookings and equipment requests per event that a significant change would reopen."""
    if not event_ids:
        return {}
    bookings = client.table(BOOKING_TABLE).select("request_id,event_id,venue_id,status").in_("event_id", event_ids).execute().data or []
    equipment = client.table(EQUIPMENT_REQUEST_TABLE).select("request_id,event_id,status").in_("event_id", event_ids).execute().data or []
    arrangements: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for kind, rows, closed in (
        ("venue_requests", bookings, CLOSED_VENUE_STATUSES),
        ("equipment_requests", equipment, CLOSED_EQUIPMENT_STATUSES),
    ):
        for row in sorted(rows, key=lambda item: item["request_id"]):
            if status_of(row) not in closed:
                entry = arrangements.setdefault(str(row["event_id"]), {"venue_requests": [], "equipment_requests": []})
                entry[kind].append({"request_id": row["request_id"], "status": row.get("status")})
    return arrangements


def change_impact(change_request: dict[str, Any], event: dict[str, Any] | None, arrangements: dict[str, Any]) -> dict[str, Any] | None:
    """What the change request does to confirmed arrangements.

    Pending requests are previewed against the current event. Approved requests use what the
    database recorded when the proposal was applied; requests decided before change tracking
    existed, and rejected ones, have no impact.
    """
    if (change_request.get("review_status") or "Pending") == "Pending":
        if not event:
            return None
        proposal = {
            field.removeprefix("proposed_"): value
            for field, value in change_request.items() if field.startswith("proposed_")
        }
        impact = classify_change(event, proposal)
    elif change_request.get("change_type"):
        impact = {
            "change_type": change_request["change_type"],
            "significant_fields": change_request.get("significant_fields") or [],
            "affects_venue": bool(change_request.get("affects_venue")),
            "affects_equipment": bool(change_request.get("affects_equipment")),
        }
    else:
        return None
    live = arrangements.get(str(change_request.get("event_id")), {})
    return {
        **impact,
        "venue_requests": live.get("venue_requests", []) if impact["affects_venue"] else [],
        "equipment_requests": live.get("equipment_requests", []) if impact["affects_equipment"] else [],
    }


def can_view_changes(client, event: dict[str, Any], user: dict[str, Any]) -> bool:
    """Organiser, assigned coordinator, and the staff reviewing the event's requests."""
    role, uid = str(user.get("role", "")).strip().lower(), str(user["id"])
    if role == "event organiser":
        return str(event.get("organiser_id")) == uid
    if role == "event coordinator":
        return str(event.get("coordinator_id")) == uid
    if role == "venue staff":
        bookings = client.table(BOOKING_TABLE).select("venue_staff_id").eq("event_id", event["id"]).execute().data or []
        # Unassigned bookings are worked from the shared venue staff queue.
        return any(not booking.get("venue_staff_id") or str(booking["venue_staff_id"]) == uid for booking in bookings)
    if role == "technical support staff":
        return bool(client.table(EQUIPMENT_REQUEST_TABLE).select("request_id").eq("event_id", event["id"]).execute().data)
    return False


@router.get("/api/events/{event_id}/change-log")
def event_change_log(event_id: int, user: dict[str, Any] = Depends(current_user)):
    client = db()
    result = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute()
    event = result.data if result else None
    if not event:
        raise HTTPException(404, "Event not found.")
    if not can_view_changes(client, event, user):
        raise HTTPException(403, "You do not have access to this event's change history.")
    entries = (
        client.table("event_change_log").select("*").eq("event_id", event_id)
        .order("created_at", desc=True).order("id", desc=True).execute().data or []
    )
    actor_ids = list({str(entry["changed_by"]) for entry in entries if entry.get("changed_by")})
    users = client.table("users").select("id,name").in_("id", actor_ids).execute().data or [] if actor_ids else []
    names = {str(item["id"]): item.get("name") for item in users}
    return [{**entry, "changed_by_name": names.get(str(entry.get("changed_by")))} for entry in entries]


@router.post("/api/event-change-requests/{request_id}/process")
def process_event_change_request(request_id: int, user: dict[str, Any] = Depends(require_coordinator)):
    try:
        result = db().rpc(
            "process_event_change_request",
            {"p_request_id": request_id, "p_coordinator_id": user["id"]},
        ).execute()
    except APIError as error:
        status = {"P0002": 404, "42501": 403, "55000": 409}.get(error.code)
        if status:
            raise HTTPException(status, error.message) from error
        raise
    if not result.data:
        raise HTTPException(500, "Event change request could not be processed.")
    return result.data
