from fastapi import APIRouter, Depends, HTTPException
from auth import current_user
from coordinator_assignment import db, EVENT_TABLE
from attendee_registration import event_view

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


def owned_notification(client, notification_id, user):
    result = client.table("notifications").select("*").eq("id", notification_id).eq("recipient_id", user["id"]).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(404, "Notification not found.")
    return result.data


def reserved_equipment(client, event_id):
    reservations = (
        client.table("Equipment Reservation")
        .select("reservation_id")
        .eq("event_id", event_id)
        .eq("status", "Reserved")
        .order("reservation_id", desc=True)
        .execute()
        .data
        or []
    )

    if not reservations:
        return []

    reservation_id = reservations[0]["reservation_id"]

    items = (
        client.table("Equipment Reservation Item")
        .select("equipment_id,reserved_quantity")
        .eq("reservation_id", reservation_id)
        .execute()
        .data
        or []
    )

    if not items:
        return []

    equipment_ids = list({
        item["equipment_id"]
        for item in items
        if item.get("equipment_id")
    })

    equipment_rows = (
        client.table("Equipment")
        .select("equipment_id,equipment_name")
        .in_("equipment_id", equipment_ids)
        .execute()
        .data
        if equipment_ids
        else []
    )

    equipment_map = {
        row["equipment_id"]: row.get("equipment_name") or row["equipment_id"]
        for row in equipment_rows
    }

    return [
        {
            "equipment_id": item["equipment_id"],
            "equipment_name": equipment_map.get(
                item["equipment_id"],
                item["equipment_id"],
            ),
            "reserved_quantity": int(item.get("reserved_quantity") or 0),
        }
        for item in items
        if int(item.get("reserved_quantity") or 0) > 0
    ]


@router.get("")
def list_notifications(user=Depends(current_user)):
    return db().table("notifications").select("*").eq("recipient_id", user["id"]).order("created_at", desc=True).execute().data or []


@router.patch("/{notification_id}/read")
def mark_read(notification_id: int, user=Depends(current_user)):
    rows = db().table("notifications").update({"is_read": True}).eq("id", notification_id).eq("recipient_id", user["id"]).execute().data
    if not rows:
        raise HTTPException(404, "Notification not found.")
    return rows[0]


@router.get("/{notification_id}/record")
def linked_record(notification_id: int, user=Depends(current_user)):
    client = db()
    notification = owned_notification(client, notification_id, user)
    kind, record_id = notification["record_type"], notification["record_id"]
    role, uid = str(user.get("role", "")).strip().lower(), str(user["id"])

    if kind == "event":
        result = client.table(EVENT_TABLE).select("*").eq("id", int(record_id)).maybe_single().execute()
        event = result.data if result else None

        if not event:
            raise HTTPException(404, "Event not found.")

        allowed = (
            (role == "event organiser" and str(event.get("organiser_id")) == uid)
            or (
                role == "event coordinator"
                and str(event.get("coordinator_id")) == uid
            )
            or (
                role == "event coordinator lead"
                and str(event.get("status", "")).strip().lower() == "submitted"
                and not event.get("coordinator_id")
            )
        )

        if role == "attendee":
            allowed = bool(
                client.table("event_registrations")
                .select("event_id")
                .eq("event_id", event["id"])
                .eq("attendee_id", user["id"])
                .execute()
                .data
            )

        if role == "venue staff":
            bookings = (
                client.table("Venue Booking Requests")
                .select("venue_staff_id")
                .eq("event_id", event["id"])
                .execute()
                .data
                or []
            )

            allowed = any(
                not b.get("venue_staff_id")
                or str(b["venue_staff_id"]) == uid
                for b in bookings
            )

        if role == "technical support staff":
            allowed = bool(
                client.table("Equipment Request")
                .select("request_id")
                .eq("event_id", event["id"])
                .execute()
                .data
            )

        if not allowed:
            raise HTTPException(403, "You no longer have access to this event.")

        return {
            "type": kind,
            "event": event_view(client, event),
            "equipment": reserved_equipment(client, event["id"]),
        }

    if kind not in {"venue_booking", "equipment_request"}:
        raise HTTPException(404, "Linked record not found.")

    table = "Venue Booking Requests" if kind == "venue_booking" else "Equipment Request"

    result = (
        client.table(table)
        .select("*")
        .eq("request_id", int(record_id))
        .maybe_single()
        .execute()
    )

    record = result.data if result else None

    if not record:
        raise HTTPException(404, "Linked record not found.")

    if kind == "venue_booking":
        allowed = (
            (
                role == "venue staff"
                and (
                    str(record.get("venue_staff_id")) == uid
                    or not record.get("venue_staff_id")
                )
            )
            or (
                role == "event coordinator"
                and str(record.get("coordinator_id")) == uid
            )
        )
    else:
        allowed = (
            role == "technical support staff"
            or (
                role == "event coordinator"
                and str(record.get("created_by")) == uid
            )
        )

    if not allowed:
        raise HTTPException(403, "You no longer have access to this record.")

    event = (
        client.table(EVENT_TABLE)
        .select("*")
        .eq("id", record["event_id"])
        .maybe_single()
        .execute()
    )

    details = {
        "type": kind,
        "record": record,
        "event": event_view(client, event.data) if event and event.data else None,
        "equipment": reserved_equipment(client, record["event_id"]),
    }

    if kind == "equipment_request":
        details["items"] = (
            client.table("Equipment Request Item")
            .select("equipment_id,requested_quantity,technical_requirements")
            .eq("request_id", record["request_id"])
            .execute()
            .data
            or []
        )
    else:
        venue = (
            client.table("Venues")
            .select("venue_id,name,location")
            .eq("venue_id", record["venue_id"])
            .maybe_single()
            .execute()
        )

        details["venue"] = venue.data if venue else None

        alternative_id = record.get("alternative_venue_id")

        if alternative_id is not None:
            alternative = (
                client.table("Venues")
                .select("venue_id,name,location")
                .eq("venue_id", alternative_id)
                .maybe_single()
                .execute()
            )

            details["alternative_venue_details"] = (
                alternative.data if alternative else None
            )

    return details
