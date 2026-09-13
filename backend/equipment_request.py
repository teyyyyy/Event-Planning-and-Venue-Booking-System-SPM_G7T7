import os
from datetime import datetime
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from supabase import Client, create_client


# ================================================================
# Setup
# ================================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("VITE_SUPABASE_URL", "")
).rstrip("/").removesuffix("/rest/v1")


SUPABASE_SERVICE_ROLE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY"
)


EVENT_TABLE = "Event Details"
EQUIPMENT_TABLE = "Equipment"
REQUEST_TABLE = "Equipment Request"
REQUEST_ITEM_TABLE = "Equipment Request Item"


router = APIRouter(
    prefix="/api",
    tags=["Equipment Requests"]
)


def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            500,
            "Backend Supabase credentials are not configured."
        )

    return create_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
    )


# ================================================================
# Models
# ================================================================

class EquipmentRequestItemInput(BaseModel):
    equipment_id: str = Field(min_length=1)
    requested_quantity: int = Field(gt=0)
    technical_requirements: str = ""


class EquipmentRequestInput(BaseModel):
    event_id: int
    items: List[EquipmentRequestItemInput]


# ================================================================
# Helpers
# ================================================================

def get_coordinator_event(
    client: Client,
    coordinator_id: str,
    event_id: int
):
    result = (
        client
        .table(EVENT_TABLE)
        .select("*")
        .eq("id", event_id)
        .eq("coordinator_id", coordinator_id)
        .execute()
    )

    rows = result.data or []

    print("\n[DEBUG] get_coordinator_event")
    print("Coordinator ID:", coordinator_id)
    print("Event ID:", event_id)
    print("Matching rows:", rows)

    if not rows:
        raise HTTPException(
            404,
            "Event not found or is not assigned to this coordinator."
        )

    return rows[0]


def event_datetimes(event: dict):
    event_date = event.get("event_date")
    start_time = event.get("start_time")
    end_time = event.get("end_time")

    print("\n[DEBUG] event_datetimes")
    print("Event ID:", event.get("id"))
    print("Event date:", event_date)
    print("Start time:", start_time)
    print("End time:", end_time)

    if not event_date:
        raise HTTPException(
            400,
            "This event does not have an event date."
        )

    if not start_time or not end_time:
        raise HTTPException(
            400,
            (
                "This event does not have a complete start and end time. "
                "Equipment availability cannot be checked until the event "
                "time is set."
            )
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

    return start_datetime, end_datetime


def calculate_availability(
    client: Client,
    event: dict
):
    start_datetime, end_datetime = event_datetimes(event)

    equipment_rows = (
        client
        .table(EQUIPMENT_TABLE)
        .select(
            "equipment_id,"
            "equipment_name,"
            "total_quantity,"
            "under_maintenance_count"
        )
        .order("equipment_name")
        .execute()
        .data
        or []
    )

    print("\n[DEBUG] calculate_availability")
    print("Equipment rows:", equipment_rows)

    reserved_by_equipment = {}

    try:
        overlapping_items = (
            client
            .table("equipment_reservation_item")
            .select(
                "reservation_id,"
                "equipment_id,"
                "reserved_quantity,"
                "start_datetime,"
                "end_datetime"
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
            .data
            or []
        )

        print(
            "Overlapping reservation items:",
            overlapping_items
        )

        reservation_ids = list({
            row["reservation_id"]
            for row in overlapping_items
        })

        active_reservation_ids = set()

        if reservation_ids:
            headers = (
                client
                .table("equipment_reservation")
                .select("reservation_id,status")
                .in_(
                    "reservation_id",
                    reservation_ids
                )
                .execute()
                .data
                or []
            )

            print(
                "Reservation headers:",
                headers
            )

            active_reservation_ids = {
                row["reservation_id"]
                for row in headers
                if str(
                    row.get("status", "")
                ).strip().lower() != "cancelled"
            }

        for row in overlapping_items:
            if row["reservation_id"] not in active_reservation_ids:
                continue

            equipment_id = row["equipment_id"]

            reserved_by_equipment[equipment_id] = (
                reserved_by_equipment.get(
                    equipment_id,
                    0
                )
                + int(row["reserved_quantity"])
            )

    except Exception as error:
        print(
            "[DEBUG] Reservation availability query skipped/error:",
            repr(error)
        )

        reserved_by_equipment = {}

    availability = []

    for equipment in equipment_rows:
        equipment_id = equipment["equipment_id"]

        total_quantity = int(
            equipment.get("total_quantity") or 0
        )

        maintenance = int(
            equipment.get(
                "under_maintenance_count"
            ) or 0
        )

        reserved = reserved_by_equipment.get(
            equipment_id,
            0
        )

        available = max(
            total_quantity
            - maintenance
            - reserved,
            0
        )

        availability.append({
            "equipment_id": equipment_id,
            "equipment_name": equipment["equipment_name"],
            "total_quantity": total_quantity,
            "under_maintenance_count": maintenance,
            "reserved_quantity": reserved,
            "available_quantity": available,
        })

    print(
        "Final availability:",
        availability
    )

    return availability


# ================================================================
# GET assigned events
# ================================================================

@router.get(
    "/event-coordinators/{coordinator_id}/events"
)
def coordinator_events(
    coordinator_id: str
):
    client = db()

    print("\n======================================")
    print("[DEBUG] GET COORDINATOR EVENTS")
    print("Coordinator ID received:", coordinator_id)
    print("======================================")

    all_events_result = (
        client
        .table(EVENT_TABLE)
        .select(
            "id,"
            "event_name,"
            "event_date,"
            "start_time,"
            "end_time,"
            "status,"
            "coordinator_id"
        )
        .execute()
    )

    all_events = all_events_result.data or []

    print("All Event Details rows:")

    for event in all_events:
        print(
            "ID:",
            event.get("id"),
            "| Name:",
            event.get("event_name"),
            "| Coordinator:",
            event.get("coordinator_id")
        )

    result = (
        client
        .table(EVENT_TABLE)
        .select(
            "id,"
            "event_name,"
            "event_date,"
            "start_time,"
            "end_time,"
            "status,"
            "coordinator_id"
        )
        .eq(
            "coordinator_id",
            coordinator_id
        )
        .order("event_date")
        .execute()
    )

    rows = result.data or []

    print("\nAssigned events returned:")
    print(rows)
    print("Number of assigned events:", len(rows))
    print("======================================\n")

    return rows


# ================================================================
# GET equipment catalogue
# ================================================================

@router.get("/equipment")
def equipment_catalogue():
    client = db()

    print("\n======================================")
    print("[DEBUG] GET EQUIPMENT")
    print("======================================")

    result = (
        client
        .table(EQUIPMENT_TABLE)
        .select(
            "equipment_id,"
            "equipment_name,"
            "total_quantity,"
            "under_maintenance_count"
        )
        .order("equipment_name")
        .execute()
    )

    rows = result.data or []

    print("Equipment returned:")
    print(rows)
    print("Number of equipment rows:", len(rows))
    print("======================================\n")

    return rows


# ================================================================
# GET availability
# ================================================================

@router.get(
    "/event-coordinators/{coordinator_id}"
    "/events/{event_id}/equipment-availability"
)
def equipment_availability(
    coordinator_id: str,
    event_id: int
):
    client = db()

    print("\n======================================")
    print("[DEBUG] GET EQUIPMENT AVAILABILITY")
    print("Coordinator ID:", coordinator_id)
    print("Event ID:", event_id)
    print("======================================")

    event = get_coordinator_event(
        client,
        coordinator_id,
        event_id
    )

    return calculate_availability(
        client,
        event
    )


# ================================================================
# CREATE request
# ================================================================

@router.post(
    "/event-coordinators/{coordinator_id}/equipment-requests"
)
def create_equipment_request(
    coordinator_id: str,
    request: EquipmentRequestInput
):
    client = db()

    print("\n======================================")
    print("[DEBUG] CREATE EQUIPMENT REQUEST")
    print("Coordinator:", coordinator_id)
    print("Event ID:", request.event_id)
    print("Items:", request.items)
    print("======================================")

    event = get_coordinator_event(
        client,
        coordinator_id,
        request.event_id
    )

    if not request.items:
        raise HTTPException(
            400,
            "At least one equipment item is required."
        )

    equipment_ids = [
        item.equipment_id.strip()
        for item in request.items
    ]

    if len(equipment_ids) != len(set(equipment_ids)):
        raise HTTPException(
            400,
            "The same equipment type cannot be added twice."
        )

    availability_rows = calculate_availability(
        client,
        event
    )

    availability_map = {
        item["equipment_id"]: item
        for item in availability_rows
    }

    for item in request.items:
        equipment_id = item.equipment_id.strip()

        if not equipment_id:
            raise HTTPException(
                400,
                "Equipment is required."
            )

        equipment_info = availability_map.get(
            equipment_id
        )

        if not equipment_info:
            raise HTTPException(
                400,
                "Selected equipment does not exist."
            )

        available = equipment_info[
            "available_quantity"
        ]

        if item.requested_quantity > available:
            raise HTTPException(
                400,
                (
                    f"{equipment_info['equipment_name']} "
                    f"has only {available} available."
                )
            )

    header = (
        client
        .table(REQUEST_TABLE)
        .insert({
            "event_id": request.event_id,
            "status": "Submitted",
            "created_by": coordinator_id,
        })
        .execute()
        .data
    )

    if not header:
        raise HTTPException(
            500,
            "Equipment request could not be created."
        )

    request_id = header[0]["request_id"]

    item_rows = []

    for item in request.items:
        item_rows.append({
            "request_id": request_id,
            "equipment_id": item.equipment_id.strip(),
            "requested_quantity": item.requested_quantity,
            "technical_requirements":
                item.technical_requirements.strip()
                if item.technical_requirements
                else "",
        })

    try:
        created_items = (
            client
            .table(REQUEST_ITEM_TABLE)
            .insert(item_rows)
            .execute()
            .data
        )

    except Exception as error:
        client.table(
            REQUEST_TABLE
        ).delete().eq(
            "request_id",
            request_id
        ).execute()

        raise HTTPException(
            500,
            "Equipment request items could not be saved."
        ) from error

    print(
        "[DEBUG] Created request:",
        request_id
    )

    return {
        "message":
            "Equipment request submitted successfully.",
        "request_id": request_id,
        "event_id": request.event_id,
        "items": created_items,
    }


# ================================================================
# GET previous requests
# ================================================================

@router.get(
    "/event-coordinators/{coordinator_id}/equipment-requests"
)
def get_equipment_requests(
    coordinator_id: str
):
    client = db()

    print("\n======================================")
    print("[DEBUG] GET EQUIPMENT REQUESTS")
    print("Coordinator:", coordinator_id)
    print("======================================")

    headers = (
        client
        .table(REQUEST_TABLE)
        .select("*")
        .eq(
            "created_by",
            coordinator_id
        )
        .order(
            "request_id",
            desc=True
        )
        .execute()
        .data
        or []
    )

    print(
        "Request headers:",
        headers
    )

    if not headers:
        return []

    event_ids = list({
        row["event_id"]
        for row in headers
    })

    event_rows = (
        client
        .table(EVENT_TABLE)
        .select(
            "id,event_name,event_date"
        )
        .in_(
            "id",
            event_ids
        )
        .execute()
        .data
        or []
    )

    event_map = {
        row["id"]: row
        for row in event_rows
    }

    request_ids = [
        row["request_id"]
        for row in headers
    ]

    item_rows = (
        client
        .table(REQUEST_ITEM_TABLE)
        .select("*")
        .in_(
            "request_id",
            request_ids
        )
        .execute()
        .data
        or []
    )

    equipment_ids = list({
        row["equipment_id"]
        for row in item_rows
    })

    equipment_map = {}

    if equipment_ids:
        equipment_rows = (
            client
            .table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,equipment_name"
            )
            .in_(
                "equipment_id",
                equipment_ids
            )
            .execute()
            .data
            or []
        )

        equipment_map = {
            row["equipment_id"]:
                row["equipment_name"]
            for row in equipment_rows
        }

    results = []

    for header in headers:
        event = event_map.get(
            header["event_id"],
            {}
        )

        items = []

        for item in item_rows:
            if (
                item["request_id"]
                != header["request_id"]
            ):
                continue

            items.append({
                "request_item_id":
                    item["request_item_id"],
                "equipment_id":
                    item["equipment_id"],
                "equipment_name":
                    equipment_map.get(
                        item["equipment_id"],
                        item["equipment_id"]
                    ),
                "requested_quantity":
                    item["requested_quantity"],
                "technical_requirements":
                    item.get(
                        "technical_requirements",
                        ""
                    ),
            })

        results.append({
            "request_id":
                header["request_id"],
            "event_id":
                header["event_id"],
            "event_name":
                event.get(
                    "event_name",
                    "Unknown event"
                ),
            "event_date":
                event.get(
                    "event_date",
                    ""
                ),
            "status":
                header.get(
                    "status",
                    ""
                ),
            "created_at":
                header.get(
                    "created_at"
                ),
            "items":
                items,
        })

    print(
        "Final requests returned:",
        results
    )

    return results