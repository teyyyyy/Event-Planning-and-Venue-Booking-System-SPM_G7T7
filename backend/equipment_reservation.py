from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from supabase import Client

import os
from database import create_client

def db() -> Client:
    SUPABASE_URL = (os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL', '')).rstrip('/').removesuffix('/rest/v1')
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

router = APIRouter(
    prefix="/api/equipment-reservation",
    tags=["Equipment Reservation"]
)

USER_TABLE = "users"
EVENT_TABLE = "Event Details"
EQUIPMENT_TABLE = "Equipment"
REQUEST_TABLE = "Equipment Request"
REQUEST_ITEM_TABLE = "Equipment Request Item"
RESERVATION_TABLE = "Equipment Reservation"
RESERVATION_ITEM_TABLE = "Equipment Reservation Item"

ACTIVE_RESERVATION_STATUSES = {
    "reserved",
    "modified",
    "needs recheck",
}


class ReservationItemInput(BaseModel):
    equipment_id: str = Field(min_length=1)
    reserved_quantity: int = Field(ge=0)


class ReservationCreateInput(BaseModel):
    event_id: int
    request_id: int
    items: list[ReservationItemInput] = []


class ReservationUpdateInput(BaseModel):
    items: list[ReservationItemInput]


def require_technical_support(client: Client, staff_id: str):
    rows = client.table(USER_TABLE).select(
        "id,name,role,email"
    ).eq(
        "id", staff_id
    ).execute().data or []

    if not rows:
        raise HTTPException(
            404,
            "Technical Support Staff user was not found."
        )

    user = rows[0]

    if str(user.get("role", "")).strip().lower() != "technical support staff":
        raise HTTPException(
            403,
            "Only Technical Support Staff can manage equipment reservations."
        )

    return user


def get_event(client: Client, event_id: int):
    rows = client.table(EVENT_TABLE).select(
        "*"
    ).eq(
        "id", event_id
    ).execute().data or []

    if not rows:
        raise HTTPException(
            404,
            "Event was not found."
        )

    return rows[0]


def get_request(client: Client, event_id: int):
    rows = client.table(REQUEST_TABLE).select(
        "*"
    ).eq(
        "event_id", event_id
    ).execute().data or []

    if not rows:
        raise HTTPException(
            404,
            "This event does not have an equipment request."
        )

    return rows[0]


def get_request_items(client: Client, request_id: int):
    return client.table(REQUEST_ITEM_TABLE).select(
        "equipment_id,requested_quantity,technical_requirements"
    ).eq(
        "request_id", request_id
    ).execute().data or []


def event_datetimes(event: dict):
    event_date = event.get("event_date")
    start_time = event.get("start_time")
    end_time = event.get("end_time")

    if not event_date or not start_time or not end_time:
        raise HTTPException(
            400,
            "The event must have a date, start time and end time."
        )

    try:
        start_datetime = datetime.fromisoformat(
            f"{event_date}T{start_time}"
        )

        end_datetime = datetime.fromisoformat(
            f"{event_date}T{end_time}"
        )

    except ValueError as error:
        raise HTTPException(
            400,
            "The event has an invalid date or time."
        ) from error

    if end_datetime <= start_datetime:
        raise HTTPException(
            400,
            "The event end time must be after the start time."
        )

    return start_datetime, end_datetime


def get_equipment_map(
    client: Client,
    equipment_ids: list[str]
):
    if not equipment_ids:
        return {}

    rows = (
        client.table(EQUIPMENT_TABLE)
        .select(
            "equipment_id,equipment_name,total_quantity,"
            "under_maintenance_count"
        )
        .in_(
            "equipment_id",
            equipment_ids
        )
        .execute()
        .data or []
    )

    return {
        row["equipment_id"]: row
        for row in rows
    }


def overlapping_reserved_quantities(
    client: Client,
    event: dict,
    exclude_reservation_id: int | None = None,
):
    start_datetime, end_datetime = event_datetimes(
        event
    )

    items = (
        client.table(RESERVATION_ITEM_TABLE)
        .select(
            "reservation_id,equipment_id,reserved_quantity,"
            "start_datetime,end_datetime"
        )
        .lt(
            "start_datetime",
            end_datetime.isoformat()
        )
        .gt(
            "end_datetime",
            start_datetime.isoformat()
        )
        .execute()
        .data or []
    )

    if exclude_reservation_id is not None:
        items = [
            item
            for item in items
            if item["reservation_id"] != exclude_reservation_id
        ]

    if not items:
        return {}

    reservation_ids = list({
        item["reservation_id"]
        for item in items
    })

    headers = (
        client.table(RESERVATION_TABLE)
        .select(
            "reservation_id,event_id,status"
        )
        .in_(
            "reservation_id",
            reservation_ids
        )
        .execute()
        .data or []
    )

    active_ids = {
        row["reservation_id"]
        for row in headers
        if str(
            row.get("status", "")
        ).strip().lower() in ACTIVE_RESERVATION_STATUSES
    }

    reserved = {}

    for item in items:
        if item["reservation_id"] not in active_ids:
            continue

        equipment_id = item["equipment_id"]

        reserved[equipment_id] = (
            reserved.get(equipment_id, 0)
            + int(
                item.get("reserved_quantity") or 0
            )
        )

    return reserved


def availability_for_items(
    client: Client,
    event: dict,
    items: list[ReservationItemInput],
    exclude_reservation_id: int | None = None,
):
    equipment_ids = list({
        item.equipment_id
        for item in items
    })

    equipment_map = get_equipment_map(
        client,
        equipment_ids
    )

    overlapping = overlapping_reserved_quantities(
        client,
        event,
        exclude_reservation_id
    )

    results = []

    for item in items:
        equipment = equipment_map.get(
            item.equipment_id
        )

        if not equipment:
            raise HTTPException(
                400,
                f"Equipment {item.equipment_id} was not found."
            )

        total = int(
            equipment.get("total_quantity") or 0
        )

        maintenance = int(
            equipment.get("under_maintenance_count") or 0
        )

        reserved_elsewhere = int(
            overlapping.get(
                item.equipment_id,
                0
            )
        )

        available = max(
            total
            - maintenance
            - reserved_elsewhere,
            0
        )

        results.append({
            "equipment_id": item.equipment_id,
            "equipment_name": equipment.get(
                "equipment_name"
            ),
            "requested_reservation_quantity":
                item.reserved_quantity,
            "total_quantity": total,
            "under_maintenance_count": maintenance,
            "reserved_elsewhere": reserved_elsewhere,
            "available_quantity": available,
        })

    return results


def validate_no_duplicates(
    items: list[ReservationItemInput]
):
    equipment_ids = [
        item.equipment_id.strip()
        for item in items
    ]

    if len(equipment_ids) != len(
        set(equipment_ids)
    ):
        raise HTTPException(
            400,
            "The same equipment cannot appear more than once."
        )


def validate_request_items(
    client: Client,
    request_id: int,
    items: list[ReservationItemInput],
):
    requested_rows = get_request_items(
        client,
        request_id
    )

    requested_map = {
        row["equipment_id"]:
            int(
                row.get("requested_quantity") or 0
            )
        for row in requested_rows
    }

    for item in items:
        if item.equipment_id not in requested_map:
            raise HTTPException(
                400,
                f"{item.equipment_id} is not part of this equipment request."
            )

        if (
            item.reserved_quantity
            > requested_map[item.equipment_id]
        ):
            raise HTTPException(
                400,
                f"Reserved quantity for {item.equipment_id} "
                f"cannot exceed the requested quantity of "
                f"{requested_map[item.equipment_id]}."
            )


def reservation_response(
    client: Client,
    reservation: dict
):
    event = get_event(
        client,
        reservation["event_id"]
    )

    start_datetime, end_datetime = event_datetimes(
        event
    )

    reservation_items = (
        client.table(RESERVATION_ITEM_TABLE)
        .select("*")
        .eq(
            "reservation_id",
            reservation["reservation_id"]
        )
        .execute()
        .data or []
    )

    request_items = get_request_items(
        client,
        reservation["request_id"]
    )

    reservation_item_map = {
        item["equipment_id"]: item
        for item in reservation_items
    }

    request_item_map = {
        item["equipment_id"]: item
        for item in request_items
    }

    all_equipment_ids = sorted(
        set(reservation_item_map)
        | set(request_item_map)
    )

    equipment_map = get_equipment_map(
        client,
        all_equipment_ids
    )

    response_items = []

    for equipment_id in all_equipment_ids:
        reservation_item = (
            reservation_item_map.get(
                equipment_id,
                {}
            )
        )

        request_item = (
            request_item_map.get(
                equipment_id,
                {}
            )
        )

        reserved_quantity = int(
            reservation_item.get(
                "reserved_quantity"
            )
            or 0
        )

        requested_quantity = int(
            request_item.get(
                "requested_quantity"
            )
            or 0
        )

        response_items.append({
            "reservation_item_id":
                reservation_item.get(
                    "reservation_item_id"
                ),
            "reservation_id":
                reservation["reservation_id"],
            "equipment_id":
                equipment_id,
            "equipment_name":
                equipment_map.get(
                    equipment_id,
                    {}
                ).get(
                    "equipment_name",
                    equipment_id
                ),
            "reserved_quantity":
                reserved_quantity,
            "requested_quantity":
                requested_quantity,
            "technical_requirements":
                request_item.get(
                    "technical_requirements"
                )
                or "",
            "start_datetime":
                reservation_item.get(
                    "start_datetime"
                ),
            "end_datetime":
                reservation_item.get(
                    "end_datetime"
                ),
            "created_at":
                reservation_item.get(
                    "created_at"
                ),
            "updated_at":
                reservation_item.get(
                    "updated_at"
                ),
            "currently_requested":
                equipment_id
                in request_item_map,
            "currently_reserved":
                equipment_id
                in reservation_item_map,
        })

    return {
        "reservation_id":
            reservation["reservation_id"],
        "event_id":
            reservation["event_id"],
        "request_id":
            reservation["request_id"],
        "status":
            reservation.get("status"),
        "reserved_by":
            reservation.get("reserved_by"),
        "created_at":
            reservation.get("created_at"),
        "updated_at":
            reservation.get("updated_at"),
        "event": {
            "id":
                event["id"],
            "event_name":
                event.get("event_name"),
            "event_date":
                event.get("event_date"),
            "start_time":
                event.get("start_time"),
            "end_time":
                event.get("end_time"),
        },
        "start_datetime":
            start_datetime.isoformat(),
        "end_datetime":
            end_datetime.isoformat(),
        "items":
            response_items,
    }


@router.get("/{staff_id}/reservations")
def reservation_list(staff_id: str):
    client = db()

    require_technical_support(
        client,
        staff_id
    )

    reservations = (
        client.table(RESERVATION_TABLE)
        .select("*")
        .neq(
            "status",
            "Cancelled"
        )
        .order(
            "updated_at",
            desc=True
        )
        .execute()
        .data or []
    )

    if not reservations:
        return []

    event_ids = list({
        reservation["event_id"]
        for reservation in reservations
    })

    event_rows = (
        client.table(EVENT_TABLE)
        .select(
            "id,event_name,event_date,"
            "start_time,end_time"
        )
        .in_(
            "id",
            event_ids
        )
        .execute()
        .data or []
    )

    event_map = {
        event["id"]: event
        for event in event_rows
    }

    reservation_ids = [
        reservation["reservation_id"]
        for reservation in reservations
    ]

    item_rows = (
        client.table(RESERVATION_ITEM_TABLE)
        .select(
            "reservation_id,equipment_id,"
            "reserved_quantity"
        )
        .in_(
            "reservation_id",
            reservation_ids
        )
        .execute()
        .data or []
    )

    equipment_ids = list({
        item["equipment_id"]
        for item in item_rows
    })

    equipment_map = get_equipment_map(
        client,
        equipment_ids
    )

    items_by_reservation = {}

    for item in item_rows:
        reservation_id = (
            item["reservation_id"]
        )

        items_by_reservation.setdefault(
            reservation_id,
            []
        ).append({
            "equipment_id":
                item["equipment_id"],
            "equipment_name":
                equipment_map.get(
                    item["equipment_id"],
                    {}
                ).get(
                    "equipment_name",
                    item["equipment_id"]
                ),
            "reserved_quantity":
                int(
                    item.get(
                        "reserved_quantity"
                    )
                    or 0
                ),
        })

    results = []

    for reservation in reservations:
        event = event_map.get(
            reservation["event_id"],
            {}
        )

        reservation_items = (
            items_by_reservation.get(
                reservation["reservation_id"],
                []
            )
        )

        results.append({
            "reservation_id":
                reservation["reservation_id"],
            "event_id":
                reservation["event_id"],
            "request_id":
                reservation["request_id"],
            "status":
                reservation.get("status"),
            "reserved_by":
                reservation.get("reserved_by"),
            "created_at":
                reservation.get("created_at"),
            "updated_at":
                reservation.get("updated_at"),
            "event_name":
                event.get(
                    "event_name",
                    "Unknown event"
                ),
            "event_date":
                event.get("event_date"),
            "start_time":
                event.get("start_time"),
            "end_time":
                event.get("end_time"),
            "equipment_count":
                len(reservation_items),
            "equipment_description":
                ", ".join(
                    f'{item["equipment_name"]} '
                    f'× {item["reserved_quantity"]}'
                    for item in reservation_items
                ),
        })

    results.sort(
        key=lambda row: (
            row.get("event_date") or "",
            row.get("start_time") or ""
        )
    )

    return results


@router.get("/{staff_id}/events/{event_id}")
def reservation_for_event(
    staff_id: str,
    event_id: int
):
    client = db()

    require_technical_support(
        client,
        staff_id
    )

    event = get_event(
        client,
        event_id
    )

    request = get_request(
        client,
        event_id
    )

    start_datetime, end_datetime = event_datetimes(
        event
    )

    existing = (
        client.table(RESERVATION_TABLE)
        .select("*")
        .eq(
            "event_id",
            event_id
        )
        .neq(
            "status",
            "Cancelled"
        )
        .order(
            "reservation_id",
            desc=True
        )
        .execute()
        .data or []
    )

    if existing:
        return {
            "mode": "existing",
            **reservation_response(
                client,
                existing[0]
            ),
        }

    request_items = get_request_items(
        client,
        request["request_id"]
    )

    if not request_items:
        raise HTTPException(
            400,
            "This equipment request does not "
            "contain any equipment."
        )

    equipment_map = get_equipment_map(
        client,
        [
            item["equipment_id"]
            for item in request_items
        ]
    )

    check_items = [
        ReservationItemInput(
            equipment_id=
                item["equipment_id"],
            reserved_quantity=
                int(
                    item.get(
                        "requested_quantity"
                    )
                    or 0
                ),
        )
        for item in request_items
    ]

    availability = availability_for_items(
        client,
        event,
        check_items
    )

    availability_map = {
        row["equipment_id"]: row
        for row in availability
    }

    return {
        "mode":
            "new",
        "event_id":
            event_id,
        "request_id":
            request["request_id"],
        "event": {
            "id":
                event["id"],
            "event_name":
                event.get("event_name"),
            "event_date":
                event.get("event_date"),
            "start_time":
                event.get("start_time"),
            "end_time":
                event.get("end_time"),
        },
        "start_datetime":
            start_datetime.isoformat(),
        "end_datetime":
            end_datetime.isoformat(),
        "items": [
            {
                "equipment_id":
                    item["equipment_id"],
                "equipment_name":
                    equipment_map.get(
                        item["equipment_id"],
                        {}
                    ).get(
                        "equipment_name",
                        item["equipment_id"]
                    ),
                "requested_quantity":
                    int(
                        item.get(
                            "requested_quantity"
                        )
                        or 0
                    ),
                "reserved_quantity":
                    int(
                        item.get(
                            "requested_quantity"
                        )
                        or 0
                    ),
                "technical_requirements":
                    item.get(
                        "technical_requirements"
                    )
                    or "",
                "available_quantity":
                    availability_map.get(
                        item["equipment_id"],
                        {}
                    ).get(
                        "available_quantity",
                        0
                    ),
            }
            for item in request_items
        ],
    }


@router.post("/{staff_id}")
def create_reservation(
    staff_id: str,
    payload: ReservationCreateInput
):
    client = db()

    require_technical_support(
        client,
        staff_id
    )

    event = get_event(
        client,
        payload.event_id
    )

    request = get_request(
        client,
        payload.event_id
    )

    if (
        request["request_id"]
        != payload.request_id
    ):
        raise HTTPException(
            400,
            "The equipment request does not "
            "belong to this event."
        )

    existing = (
        client.table(RESERVATION_TABLE)
        .select(
            "reservation_id,status"
        )
        .eq(
            "event_id",
            payload.event_id
        )
        .neq(
            "status",
            "Cancelled"
        )
        .execute()
        .data or []
    )

    if existing:
        raise HTTPException(
            409,
            "This event already has an active "
            "equipment reservation."
        )

    # Initial reservation quantities are always
    # taken directly from the current request.
    # Quantities supplied by the frontend are
    # deliberately not trusted here.
    request_items = get_request_items(
        client,
        payload.request_id
    )

    if not request_items:
        raise HTTPException(
            400,
            "This equipment request does not "
            "contain any equipment."
        )

    reservation_items = [
        ReservationItemInput(
            equipment_id=
                item["equipment_id"],
            reserved_quantity=
                int(
                    item.get(
                        "requested_quantity"
                    )
                    or 0
                ),
        )
        for item in request_items
        if int(
            item.get(
                "requested_quantity"
            )
            or 0
        ) > 0
    ]

    if not reservation_items:
        raise HTTPException(
            400,
            "At least one equipment item must "
            "be requested."
        )

    validate_no_duplicates(
        reservation_items
    )

    availability = availability_for_items(
        client,
        event,
        reservation_items
    )

    for item in availability:
        if (
            item[
                "requested_reservation_quantity"
            ]
            > item["available_quantity"]
        ):
            raise HTTPException(
                409,
                f'{item["equipment_name"]} only has '
                f'{item["available_quantity"]} '
                f'available during this event period.'
            )

    header = (
        client.table(RESERVATION_TABLE)
        .insert({
            "event_id":
                payload.event_id,
            "request_id":
                payload.request_id,
            "status":
                "Reserved",
            "reserved_by":
                staff_id,
        })
        .execute()
        .data
    )

    if not header:
        raise HTTPException(
            500,
            "Equipment reservation could not "
            "be created."
        )

    reservation = header[0]

    reservation_id = (
        reservation["reservation_id"]
    )

    start_datetime, end_datetime = (
        event_datetimes(event)
    )

    try:
        rows = [
            {
                "reservation_id":
                    reservation_id,
                "equipment_id":
                    item.equipment_id,
                "reserved_quantity":
                    item.reserved_quantity,
                "start_datetime":
                    start_datetime.isoformat(),
                "end_datetime":
                    end_datetime.isoformat(),
            }
            for item in reservation_items
        ]

        inserted = (
            client.table(
                RESERVATION_ITEM_TABLE
            )
            .insert(rows)
            .execute()
            .data
        )

        if not inserted:
            raise Exception(
                "Reservation items were not created."
            )

    except Exception as error:
        client.table(
            RESERVATION_TABLE
        ).delete().eq(
            "reservation_id",
            reservation_id
        ).execute()

        raise HTTPException(
            500,
            "Reservation items could not be created. "
            "The reservation was cancelled."
        ) from error

    return {
        "message":
            "Equipment reserved successfully.",
        **reservation_response(
            client,
            reservation
        ),
    }


@router.put("/{staff_id}/{reservation_id}")
def update_reservation(
    staff_id: str,
    reservation_id: int,
    payload: ReservationUpdateInput,
):
    client = db()

    require_technical_support(
        client,
        staff_id
    )

    validate_no_duplicates(
        payload.items
    )

    rows = (
        client.table(RESERVATION_TABLE)
        .select("*")
        .eq(
            "reservation_id",
            reservation_id
        )
        .execute()
        .data or []
    )

    if not rows:
        raise HTTPException(
            404,
            "Equipment reservation was not found."
        )

    reservation = rows[0]

    status = str(
        reservation.get("status", "")
    ).strip().lower()

    if status == "cancelled":
        raise HTTPException(
            400,
            "A cancelled reservation cannot "
            "be modified."
        )

    if status == "completed":
        raise HTTPException(
            400,
            "A completed reservation cannot "
            "be modified."
        )

    event = get_event(
        client,
        reservation["event_id"]
    )

    positive_items = [
        item
        for item in payload.items
        if item.reserved_quantity > 0
    ]

    if not positive_items:
        raise HTTPException(
            400,
            "At least one item must remain reserved. "
            "Cancel the reservation instead."
        )

    validate_request_items(
        client,
        reservation["request_id"],
        positive_items
    )

    availability = availability_for_items(
        client,
        event,
        positive_items,
        exclude_reservation_id=
            reservation_id
    )

    for item in availability:
        if (
            item[
                "requested_reservation_quantity"
            ]
            > item["available_quantity"]
        ):
            raise HTTPException(
                409,
                f'{item["equipment_name"]} only has '
                f'{item["available_quantity"]} '
                f'available during this event period.'
            )

    current_items = (
        client.table(RESERVATION_ITEM_TABLE)
        .select("*")
        .eq(
            "reservation_id",
            reservation_id
        )
        .execute()
        .data or []
    )

    current_map = {
        item["equipment_id"]: item
        for item in current_items
    }

    submitted_ids = {
        item.equipment_id
        for item in payload.items
    }

    for current in current_items:
        if (
            current["equipment_id"]
            not in submitted_ids
        ):
            client.table(
                RESERVATION_ITEM_TABLE
            ).delete().eq(
                "reservation_item_id",
                current["reservation_item_id"]
            ).execute()

    start_datetime, end_datetime = (
        event_datetimes(event)
    )

    now = datetime.now(
        timezone.utc
    ).isoformat()

    for item in payload.items:
        existing = current_map.get(
            item.equipment_id
        )

        if item.reserved_quantity == 0:
            if existing:
                client.table(
                    RESERVATION_ITEM_TABLE
                ).delete().eq(
                    "reservation_item_id",
                    existing[
                        "reservation_item_id"
                    ]
                ).execute()

            continue

        if existing:
            client.table(
                RESERVATION_ITEM_TABLE
            ).update({
                "reserved_quantity":
                    item.reserved_quantity,
                "start_datetime":
                    start_datetime.isoformat(),
                "end_datetime":
                    end_datetime.isoformat(),
                "updated_at":
                    now,
            }).eq(
                "reservation_item_id",
                existing[
                    "reservation_item_id"
                ]
            ).execute()

        else:
            client.table(
                RESERVATION_ITEM_TABLE
            ).insert({
                "reservation_id":
                    reservation_id,
                "equipment_id":
                    item.equipment_id,
                "reserved_quantity":
                    item.reserved_quantity,
                "start_datetime":
                    start_datetime.isoformat(),
                "end_datetime":
                    end_datetime.isoformat(),
            }).execute()

    updated = (
        client.table(RESERVATION_TABLE)
        .update({
            "status":
                "Modified",
            "updated_at":
                now,
        })
        .eq(
            "reservation_id",
            reservation_id
        )
        .execute()
        .data
    )

    if not updated:
        raise HTTPException(
            500,
            "Equipment reservation could not "
            "be updated."
        )

    return {
        "message":
            "Equipment reservation updated successfully.",
        **reservation_response(
            client,
            updated[0]
        ),
    }


@router.delete("/{staff_id}/{reservation_id}")
def cancel_reservation(
    staff_id: str,
    reservation_id: int
):
    client = db()

    require_technical_support(
        client,
        staff_id
    )

    rows = (
        client.table(RESERVATION_TABLE)
        .select("*")
        .eq(
            "reservation_id",
            reservation_id
        )
        .execute()
        .data or []
    )

    if not rows:
        raise HTTPException(
            404,
            "Equipment reservation was not found."
        )

    reservation = rows[0]

    status = str(
        reservation.get("status", "")
    ).strip().lower()

    if status == "cancelled":
        raise HTTPException(
            400,
            "This reservation has already "
            "been cancelled."
        )

    if status == "completed":
        raise HTTPException(
            400,
            "A completed reservation cannot "
            "be cancelled."
        )

    updated = (
        client.table(RESERVATION_TABLE)
        .update({
            "status":
                "Cancelled",
            "updated_at":
                datetime.now(
                    timezone.utc
                ).isoformat(),
        })
        .eq(
            "reservation_id",
            reservation_id
        )
        .execute()
        .data
    )

    if not updated:
        raise HTTPException(
            500,
            "Equipment reservation could not "
            "be cancelled."
        )

    return {
        "message":
            "Equipment reservation cancelled successfully.",
        "reservation_id":
            reservation_id,
        "status":
            "Cancelled",
    }