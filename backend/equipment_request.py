import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from supabase import Client

from database import create_client
from auth import require_coordinator, require_coordinator_path
from availability_service import AvailabilityService
from equipment_request_service import EquipmentRequestService

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / '.env')

SUPABASE_URL = (os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL', '')).rstrip('/').removesuffix('/rest/v1')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

router = APIRouter(prefix='/api', tags=['Equipment Requests'], dependencies=[Depends(require_coordinator)])


def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail='Backend Supabase credentials are not configured.')
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class EquipmentRequestItemInput(BaseModel):
    equipment_id: str = Field(min_length=1)
    requested_quantity: int = Field(gt=0)
    technical_requirements: str = ''


class EquipmentRequestInput(BaseModel):
    event_id: int
    items: List[EquipmentRequestItemInput]


class EquipmentRequestEditInput(BaseModel):
    items: List[EquipmentRequestItemInput]

def live_requests(headers: list) -> list:
    return EquipmentRequestService.live_requests(headers)

def require_live_request(header: dict):
    return EquipmentRequestService.require_live_request(header)

def get_coordinator_event(client: Client, coordinator_id: str, event_id: int):
    service = EquipmentRequestService(client)
    return service.get_coordinator_event(coordinator_id, event_id)

def event_datetimes(event: dict):
    return AvailabilityService.event_datetimes(event)

def calculate_availability(client: Client, event: dict):
    service = AvailabilityService(client)
    return service.calculate_availability(event)

def calculate_request_edit_availability(
    client: Client,
    event: dict,
    request_id: int,
):
    service = AvailabilityService(client)

    return service.calculate_request_edit_availability(
        event,
        request_id,
    )

def validate_request_items(
    request_items,
    availability_rows,
):
    return EquipmentRequestService.validate_request_items(
        request_items,
        availability_rows,
    )

def mark_reservation_for_recheck(
    client: Client,
    request_id: int,
    now: str,
):
    service = EquipmentRequestService(client)

    return service.mark_reservation_for_recheck(
        request_id,
        now,
    )

# Get events available for NEW equipment requests
@router.get(
    '/event-coordinators/{coordinator_id}/events',
    dependencies=[Depends(require_coordinator_path)]
)
def coordinator_events(coordinator_id: str):
    client = db()
    service = EquipmentRequestService(client)

    return service.get_available_events(coordinator_id)

@router.get('/equipment')
def equipment_catalogue():
    client = db()
    service = EquipmentRequestService(client)

    return service.get_equipment_catalogue()

@router.get(
    '/event-coordinators/{coordinator_id}/events/{event_id}/equipment-availability',
    dependencies=[Depends(require_coordinator_path)]
)
def equipment_availability(
    coordinator_id: str,
    event_id: int,
):
    client = db()
    service = EquipmentRequestService(client)

    return service.get_event_availability(
        coordinator_id,
        event_id,
    )

@router.post(
    '/event-coordinators/{coordinator_id}/equipment-requests',
    dependencies=[Depends(require_coordinator_path)]
)
def create_equipment_request(
    coordinator_id: str,
    request: EquipmentRequestInput,
):
    client = db()
    service = EquipmentRequestService(client)

    return service.create_request(
        coordinator_id,
        request,
    )

@router.put(
    '/event-coordinators/{coordinator_id}/equipment-requests/{request_id}',
    dependencies=[Depends(require_coordinator_path)]
)
def edit_equipment_request(
    coordinator_id: str,
    request_id: int,
    payload: EquipmentRequestEditInput,
):
    client = db()
    service = EquipmentRequestService(client)

    return service.edit_request(
        coordinator_id,
        request_id,
        payload,
    )

@router.get(
    '/event-coordinators/{coordinator_id}/equipment-requests',
    dependencies=[Depends(require_coordinator_path)]
)
def get_equipment_requests(coordinator_id: str):
    client = db()
    service = EquipmentRequestService(client)
    return service.get_requests(coordinator_id)