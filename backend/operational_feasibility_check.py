from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from auth import require_safety_officer
from coordinator_assignment import db


router = APIRouter()

EVENTS_TABLE = "Event Details"
VENUE_BOOKING_TABLE = "Venue Booking Requests"
VENUES_TABLE = "Venues"
EQUIPMENT_RESERVATION_TABLE = "Equipment Reservation"
SAFETY_CHECK_TABLE = "Operational Safety Check"

ELIGIBLE_EQUIPMENT_STATUSES = {"reserved", "modified"}


class SafetyDecisionRequest(BaseModel):
    decision: Literal["Approved", "Rejected", "Changes Requested"]
    comments: str | None = None


def get_approved_venue_bookings(client: Client, event_id: int) -> list[dict[str, Any]]:
    response = (
        client.table(VENUE_BOOKING_TABLE)
        .select(f'*, "{VENUES_TABLE}"(*)')
        .eq("event_id", event_id)
        .eq("status", "Approved")
        .execute()
    )
    return response.data or []


def get_confirmed_equipment_reservations(client: Client, event_id: int) -> list[dict[str, Any]]:
    response = (
        client.table(EQUIPMENT_RESERVATION_TABLE)
        .select("*")
        .eq("event_id", event_id)
        .execute()
    )

    reservations = response.data or []

    return [
        reservation
        for reservation in reservations
        if str(reservation.get("status", "")).strip().lower()
        in ELIGIBLE_EQUIPMENT_STATUSES
    ]


def get_safety_check(client: Client, event_id: int) -> dict[str, Any] | None:
    response = (
        client.table(SAFETY_CHECK_TABLE)
        .select("*")
        .eq("event_id", event_id)
        .maybe_single()
        .execute()
    )
    return response.data if response else None


def event_is_ready_for_safety_check(client: Client, event_id: int) -> bool:
    venue_bookings = get_approved_venue_bookings(client, event_id)
    equipment_reservations = get_confirmed_equipment_reservations(client, event_id)

    return bool(venue_bookings and equipment_reservations)


@router.get(
    "/api/safety-check/events",
    dependencies=[Depends(require_safety_officer)]
)
def list_events_for_safety_check():
    client = db()

    events = client.table(EVENTS_TABLE).select("*").execute().data or []
    eligible_events = []

    for event in events:
        event_id = event.get("id")

        if event_id is None:
            continue

        if not event_is_ready_for_safety_check(client, event_id):
            continue

        safety_check = get_safety_check(client, event_id)

        if safety_check and safety_check.get("status") == "Approved":
            continue

        eligible_events.append({
            **event,
            "safety_check": safety_check
        })

    return eligible_events


@router.get(
    "/api/safety-check/events/{event_id}",
    dependencies=[Depends(require_safety_officer)]
)
def get_event_for_safety_check(event_id: int):
    client = db()

    event = (
        client.table(EVENTS_TABLE)
        .select("*")
        .eq("id", event_id)
        .maybe_single()
        .execute()
        .data
    )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Event not found."
        )

    venue_bookings = get_approved_venue_bookings(client, event_id)
    equipment_reservations = get_confirmed_equipment_reservations(client, event_id)

    if not venue_bookings or not equipment_reservations:
        raise HTTPException(
            status_code=400,
            detail="Event is not ready for an Operational Safety Check."
        )

    safety_check = get_safety_check(client, event_id)

    return {
        "event": event,
        "venue_bookings": venue_bookings,
        "equipment_reservations": equipment_reservations,
        "safety_check": safety_check,

        # These fields are required for the Operational Safety Check,
        # but are not currently stored in the database.
        "equipment_placement": None,
        "crowd_movement": None,
        "emergency_access": None,
        "venue_restrictions": None
    }


@router.post("/api/safety-check/events/{event_id}/decision")
def submit_safety_decision(
    event_id: int,
    request: SafetyDecisionRequest,
    user: dict[str, Any] = Depends(require_safety_officer)
):
    client = db()

    event = (
        client.table(EVENTS_TABLE)
        .select("*")
        .eq("id", event_id)
        .maybe_single()
        .execute()
        .data
    )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Event not found."
        )

    if not event_is_ready_for_safety_check(client, event_id):
        raise HTTPException(
            status_code=400,
            detail="Event is not ready for an Operational Safety Check."
        )

    comments = (request.comments or "").strip()

    if request.decision in {"Rejected", "Changes Requested"} and not comments:
        raise HTTPException(
            status_code=400,
            detail="Comments are required when rejecting or requesting changes."
        )

    existing_check = get_safety_check(client, event_id)

    safety_data = {
        "event_id": event_id,
        "safety_officer_id": user["id"],
        "status": request.decision,
        "comments": comments or None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    if existing_check:
        (
            client.table(SAFETY_CHECK_TABLE)
            .update(safety_data)
            .eq("event_id", event_id)
            .execute()
        )
    else:
        client.table(SAFETY_CHECK_TABLE).insert(safety_data).execute()

    if request.decision == "Approved":
        event_status = "Preparation"
    else:
        event_status = "Planning"

    (
        client.table(EVENTS_TABLE)
        .update({"status": event_status})
        .eq("id", event_id)
        .execute()
    )

    return {
        "message": "Operational Safety Check submitted successfully.",
        "event_id": event_id,
        "decision": request.decision,
        "event_status": event_status
    }