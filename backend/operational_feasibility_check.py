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
EQUIPMENT_RESERVATION_ITEM_TABLE = "Equipment Reservation Item"
EQUIPMENT_TABLE = "Equipment"
EVENT_CHANGE_LOG_TABLE = "event_change_log"

ELIGIBLE_EQUIPMENT_STATUSES = {"reserved"}
SAFETY_INFORMATION_FIELDS = {"equipment_placement", "crowd_movement"}


class SafetyDecisionRequest(BaseModel):
    decision: Literal["Approved", "Rejected", "Changes Requested"]
    comments: str | None = None
    affected_arrangements: list[Literal["Venue", "Equipment"]] | None = None


def get_approved_venue_bookings(client: Client, event_id: int) -> list[dict[str, Any]]:
    bookings = (
        client.table(VENUE_BOOKING_TABLE)
        .select("*")
        .eq("event_id", event_id)
        .eq("status", "Approved")
        .execute()
        .data
        or []
    )

    if not bookings:
        return []

    venue_ids = list({
        booking.get("venue_id")
        for booking in bookings
        if booking.get("venue_id") is not None
    })

    venues = (
        client.table(VENUES_TABLE)
        .select("*")
        .in_("venue_id", venue_ids)
        .execute()
        .data
        or []
    ) if venue_ids else []

    venue_map = {
        str(venue["venue_id"]): venue
        for venue in venues
    }

    return [
        {
            **booking,
            VENUES_TABLE: venue_map.get(
                str(booking.get("venue_id")),
                {}
            )
        }
        for booking in bookings
    ]


def venue_arrangements_are_ready(
    client: Client,
    event_id: int
) -> bool:
    """
    Venue arrangements are ready for safety review only when:
    - there is at least one venue booking request,
    - no venue booking request is unresolved,
    - and at least one venue booking request is Approved.

    Rejected requests are considered resolved and do not block safety review.
    """
    bookings = (
        client.table(VENUE_BOOKING_TABLE)
        .select("request_id,status")
        .eq("event_id", event_id)
        .execute()
        .data
        or []
    )

    if not bookings:
        return False

    statuses = {
        str(booking.get("status") or "").strip().lower()
        for booking in bookings
    }

    unresolved_statuses = {
        "pending",
        "on hold",
        "alternative offered",
        "expired",
        "needs recheck",
    }

    if statuses & unresolved_statuses:
        return False

    return "approved" in statuses


def get_confirmed_equipment_reservations(client: Client, event_id: int) -> list[dict[str, Any]]:
    reservations = (
        client.table(EQUIPMENT_RESERVATION_TABLE)
        .select("*")
        .eq("event_id", event_id)
        .execute()
        .data
        or []
    )

    confirmed = [
        reservation
        for reservation in reservations
        if str(reservation.get("status", "")).strip().lower()
        in ELIGIBLE_EQUIPMENT_STATUSES
    ]

    if not confirmed:
        return []

    reservation_ids = [
        reservation["reservation_id"]
        for reservation in confirmed
        if reservation.get("reservation_id") is not None
    ]

    reservation_items = (
        client.table(EQUIPMENT_RESERVATION_ITEM_TABLE)
        .select("reservation_item_id,reservation_id,equipment_id,reserved_quantity")
        .in_("reservation_id", reservation_ids)
        .execute()
        .data
        or []
    ) if reservation_ids else []

    equipment_ids = list({
        item.get("equipment_id")
        for item in reservation_items
        if item.get("equipment_id") is not None
    })

    equipment = (
        client.table(EQUIPMENT_TABLE)
        .select("equipment_id,equipment_name")
        .in_("equipment_id", equipment_ids)
        .execute()
        .data
        or []
    ) if equipment_ids else []

    equipment_map = {
        str(row["equipment_id"]): row.get("equipment_name")
        for row in equipment
    }

    items_by_reservation: dict[str, list[dict[str, Any]]] = {}

    for item in reservation_items:
        reservation_key = str(item.get("reservation_id"))
        items_by_reservation.setdefault(reservation_key, []).append({
            **item,
            "equipment_name": equipment_map.get(
                str(item.get("equipment_id")),
                item.get("equipment_id")
            )
        })

    return [
        {
            **reservation,
            "items": items_by_reservation.get(
                str(reservation.get("reservation_id")),
                []
            )
        }
        for reservation in confirmed
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


def safety_information_revised_after_rejection(
    client: Client,
    event: dict[str, Any]
) -> bool:
    """
    A rejected safety check means the Safety Officer found the organiser-provided
    safety information insufficient.

    Venue and equipment arrangements remain approved/reserved. The event becomes
    eligible for another Operational Safety Check only after equipment_placement
    or crowd_movement has actually changed after the rejection.
    """
    if str(event.get("safety_decision_status") or "").strip().lower() != "rejected":
        return True

    decided_at = event.get("safety_decided_at")

    if not decided_at:
        return False

    changes = (
        client.table(EVENT_CHANGE_LOG_TABLE)
        .select("changed_fields,created_at")
        .eq("event_id", event["id"])
        .gt("created_at", decided_at)
        .order("created_at")
        .execute()
        .data
        or []
    )

    for change in changes:
        changed_fields = {
            str(field).strip()
            for field in (change.get("changed_fields") or [])
        }

        if changed_fields & SAFETY_INFORMATION_FIELDS:
            return True

    return False


def event_is_ready_for_safety_check(
    client: Client,
    event_id: int,
    event: dict[str, Any] | None = None
) -> bool:
    if event is None:
        event = (
            client.table(EVENTS_TABLE)
            .select("*")
            .eq("id", event_id)
            .maybe_single()
            .execute()
            .data
        )

    if not event:
        return False

    if not venue_arrangements_are_ready(client, event_id):
        return False

    equipment_reservations = get_confirmed_equipment_reservations(
        client,
        event_id
    )

    if not equipment_reservations:
        return False

    safety_status = str(
        event.get("safety_decision_status") or ""
    ).strip().lower()

    if safety_status == "approved":
        return False

    if safety_status == "rejected":
        return safety_information_revised_after_rejection(client, event)

    return True


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

        if not event_is_ready_for_safety_check(client, event_id, event):
            continue

        eligible_events.append({
            **event,
            "safety_check": get_safety_check(event)
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

    if not event_is_ready_for_safety_check(client, event_id, event):
        raise HTTPException(
            status_code=400,
            detail="Event is not ready for an Operational Safety Check."
        )

    venue_bookings = get_approved_venue_bookings(client, event_id)
    equipment_reservations = get_confirmed_equipment_reservations(client, event_id)

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

    if not event_is_ready_for_safety_check(client, event_id, event):
        raise HTTPException(
            status_code=400,
            detail="Event is not ready for an Operational Safety Check."
        )

    comments = (request.comments or "").strip()
    affected_arrangements = list(
        dict.fromkeys(request.affected_arrangements or [])
    )

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

    elif request.decision == "Rejected":
        # Rejection means the organiser-provided safety information is
        # insufficient. Existing venue/equipment approvals remain valid.
        event_status = "Planning"
        affected_arrangements = []

    else:
        # Changes Requested returns the event to Planning so the organiser can
        # submit an Event Change Request. Existing approved venue bookings and
        # reserved equipment reservations remain unchanged. Any venue/equipment
        # impact is handled later by the normal Event Change Request workflow.
        event_status = "Planning"

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

    return {
        "message": "Operational Safety Check submitted successfully.",
        "event_id": event_id,
        "decision": request.decision,
        "affected_arrangements": affected_arrangements,
        "event_status": event_status
    }
