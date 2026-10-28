from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from supabase import Client

import os
from auth import require_technical_support_path
from database import create_client
from reservation_service import ReservationService

def db() -> Client:
    SUPABASE_URL = (os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL', '')).rstrip('/').removesuffix('/rest/v1')
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail='Backend Supabase credentials are not configured.')
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

router = APIRouter(
    prefix="/api/equipment-reservation",
    tags=["Equipment Reservation"],
    dependencies=[Depends(require_technical_support_path)]
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

def require_technical_support(
    client: Client,
    staff_id: str,
):
    service = ReservationService(client)

    return service.require_technical_support(
        staff_id,
    )

def get_event(
    client: Client,
    event_id: int,
):
    service = ReservationService(client)

    return service.get_event(
        event_id,
    )

def get_request(
    client: Client,
    event_id: int,
):
    service = ReservationService(client)

    return service.get_request(
        event_id,
    )

def get_request_items(
    client: Client,
    request_id: int,
):
    service = ReservationService(client)

    return service.get_request_items(
        request_id,
    )

def event_datetimes(
    event: dict,
):
    return ReservationService.event_datetimes(
        event,
    )

def get_equipment_map(
    client: Client,
    equipment_ids: list[str],
):
    service = ReservationService(client)

    return service.get_equipment_map(
        equipment_ids,
    )

def overlapping_reserved_quantities(
    client: Client,
    event: dict,
    exclude_reservation_id: int | None = None,
):
    service = ReservationService(client)

    return service.overlapping_reserved_quantities(
        event,
        exclude_reservation_id,
    )

def availability_for_items(
    client: Client,
    event: dict,
    items: list[ReservationItemInput],
    exclude_reservation_id: int | None = None,
):
    service = ReservationService(client)

    return service.availability_for_items(
        event,
        items,
        exclude_reservation_id,
    )

def validate_no_duplicates(
    items: list[ReservationItemInput],
):
    return ReservationService.validate_no_duplicates(
        items
    )

def validate_request_items(
    client: Client,
    request_id: int,
    items: list[ReservationItemInput],
):
    service = ReservationService(client)

    return service.validate_request_items(
        request_id,
        items,
    )

def reservation_response(
    client: Client,
    reservation: dict,
):
    service = ReservationService(client)

    return service.reservation_response(
        reservation,
    )

@router.get("/{staff_id}/reservations")
def reservation_list(
    staff_id: str,
):
    client = db()
    service = ReservationService(client)

    return service.get_reservations(
        staff_id,
    )

@router.get("/{staff_id}/events/{event_id}")
def reservation_for_event(
    staff_id: str,
    event_id: int,
):
    client = db()
    service = ReservationService(client)

    return service.get_reservation_for_event(
        staff_id,
        event_id,
    )

@router.post("/{staff_id}")
def create_reservation(
    staff_id: str,
    payload: ReservationCreateInput,
):
    client = db()
    service = ReservationService(client)

    return service.create_reservation(
        staff_id,
        payload,
    )

@router.put("/{staff_id}/{reservation_id}")
def update_reservation(
    staff_id: str,
    reservation_id: int,
    payload: ReservationUpdateInput,
):
    client = db()
    service = ReservationService(client)

    return service.update_reservation(
        staff_id,
        reservation_id,
        payload,
    )


@router.put("/{staff_id}/{reservation_id}/confirm")
def confirm_reservation(
    staff_id: str,
    reservation_id: int,
):
    client = db()
    service = ReservationService(client)

    return service.confirm_reservation(
        staff_id,
        reservation_id,
    )


@router.delete("/{staff_id}/{reservation_id}")
def cancel_reservation(
    staff_id: str,
    reservation_id: int,
):
    client = db()
    service = ReservationService(client)

    return service.cancel_reservation(
        staff_id,
        reservation_id,
    )