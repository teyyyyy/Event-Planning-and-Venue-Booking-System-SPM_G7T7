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
USERS_TABLE = "users"
NOTIFICATIONS_TABLE = "notifications"

ELIGIBLE_EQUIPMENT_STATUSES = {"reserved"}


class SafetyDecisionRequest(BaseModel):
    decision: Literal["Approved", "Rejected", "Changes Requested"]
    comments: str | None = None
    affected_arrangements: list[Literal["Venue", "Equipment"]] | None = None


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


def get_safety_check(event: dict[str, Any]) -> dict[str, Any] | None:
    status = event.get("safety_decision_status")

    if not status:
        return None

    return {
        "event_id": event.get("id"),
        "safety_officer_id": event.get("safety_officer_id"),
        "status": status,
        "comments": event.get("safety_comments"),
        "affected_arrangements": event.get("safety_affected_arrangements") or [],
        "decided_at": event.get("safety_decided_at")
    }


def event_is_ready_for_safety_check(client: Client, event_id: int) -> bool:
    venue_bookings = get_approved_venue_bookings(client, event_id)
    equipment_reservations = get_confirmed_equipment_reservations(client, event_id)

    return bool(venue_bookings and equipment_reservations)


def notify_users(
    client: Client,
    recipient_ids: list[str],
    message: str,
    event_id: int
) -> None:
    recipients = list(dict.fromkeys(
        str(recipient_id)
        for recipient_id in recipient_ids
        if recipient_id
    ))

    if not recipients:
        return

    rows = [
        {
            "recipient_id": recipient_id,
            "message": message,
            "record_type": "event",
            "record_id": str(event_id),
            "is_read": False
        }
        for recipient_id in recipients
    ]

    client.table(NOTIFICATIONS_TABLE).insert(rows).execute()


def technical_support_staff_ids(client: Client) -> list[str]:
    users = client.table(USERS_TABLE).select("id,role").execute().data or []

    return [
        str(user["id"])
        for user in users
        if str(user.get("role", "")).strip().lower() == "technical support staff"
    ]


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

        safety_check = get_safety_check(event)

        if safety_check and safety_check.get("status") in {"Approved", "Rejected"}:
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

    safety_check = get_safety_check(event)

    emergency_access = [
        booking.get(VENUES_TABLE, {}).get("emergency_access")
        for booking in venue_bookings
        if booking.get(VENUES_TABLE, {}).get("emergency_access")
    ]

    venue_restrictions = [
        booking.get(VENUES_TABLE, {}).get("venue_restrictions")
        for booking in venue_bookings
        if booking.get(VENUES_TABLE, {}).get("venue_restrictions")
    ]

    return {
        "event": event,
        "venue_bookings": venue_bookings,
        "equipment_reservations": equipment_reservations,
        "safety_check": safety_check,
        "equipment_placement": event.get("equipment_placement"),
        "crowd_movement": event.get("crowd_movement"),
        "emergency_access": emergency_access,
        "venue_restrictions": venue_restrictions
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
    affected_arrangements = list(dict.fromkeys(request.affected_arrangements or []))

    if request.decision in {"Rejected", "Changes Requested"} and not comments:
        raise HTTPException(
            status_code=400,
            detail="Comments are required when rejecting or requesting changes."
        )

    if request.decision == "Changes Requested" and not affected_arrangements:
        raise HTTPException(
            status_code=400,
            detail="Select whether the requested changes affect Venue, Equipment, or both."
        )

    decided_at = datetime.now(timezone.utc).isoformat()

    if request.decision == "Approved":
        event_status = "Confirmed"
        affected_arrangements = []
    else:
        event_status = "Planning"

        if request.decision == "Rejected":
            affected_arrangements = []

    if request.decision == "Changes Requested":
        if "Venue" in affected_arrangements:
            (
                client.table(VENUE_BOOKING_TABLE)
                .update({"status": "Needs Recheck"})
                .eq("event_id", event_id)
                .eq("status", "Approved")
                .execute()
            )

        if "Equipment" in affected_arrangements:
            reservations = get_confirmed_equipment_reservations(client, event_id)

            for reservation in reservations:
                (
                    client.table(EQUIPMENT_RESERVATION_TABLE)
                    .update({"status": "Needs Recheck"})
                    .eq("reservation_id", reservation["reservation_id"])
                    .execute()
                )

    safety_data = {
        "status": event_status,
        "safety_decision_status": request.decision,
        "safety_comments": comments or None,
        "safety_officer_id": user["id"],
        "safety_decided_at": decided_at,
        "safety_affected_arrangements": affected_arrangements or None
    }

    updated = (
        client.table(EVENTS_TABLE)
        .update(safety_data)
        .eq("id", event_id)
        .execute()
        .data
    )

    if not updated:
        raise HTTPException(
            status_code=500,
            detail="Operational Safety Check could not be saved."
        )

    coordinator_id = event.get("coordinator_id")

    if coordinator_id:
        notify_users(
            client,
            [str(coordinator_id)],
            f'Operational Safety Check for "{event.get("event_name", "Event")}" was {request.decision.lower()}.'
            + (f" Comments: {comments}" if comments else ""),
            event_id
        )

    if request.decision == "Changes Requested" and "Equipment" in affected_arrangements:
        notify_users(
            client,
            technical_support_staff_ids(client),
            f'Equipment arrangements for "{event.get("event_name", "Event")}" require recheck following the Operational Safety Check.'
            + (f" Comments: {comments}" if comments else ""),
            event_id
        )

    return {
        "message": "Operational Safety Check submitted successfully.",
        "event_id": event_id,
        "decision": request.decision,
        "affected_arrangements": affected_arrangements,
        "event_status": event_status
    }
