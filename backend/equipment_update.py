from typing import List
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from equipment_request import db

from auth import require_technical_support_path
from equipment_request_service import EquipmentRequestService


router = APIRouter(prefix="/api/equipment-update", tags=["Equipment Update"], dependencies=[Depends(require_technical_support_path)])

class EquipmentUpdateItemInput(BaseModel):
    equipment_id: str = Field(min_length=1)
    requested_quantity: int = Field(ge=0)
    technical_requirements: str = ""

class EquipmentRequestUpdateInput(BaseModel):
    request_id: int
    items: List[EquipmentUpdateItemInput]

class EventEquipmentUpdateInput(BaseModel):
    requests: List[EquipmentRequestUpdateInput]

def require_technical_support(client, staff_id: str):
    service = EquipmentRequestService(client)
    return service.require_technical_support(staff_id)

def get_event(client, event_id: int):
    service = EquipmentRequestService(client)
    return service.get_event(event_id)

def get_request_header(client, request_id: int):
    service = EquipmentRequestService(client)
    return service.get_request_header(request_id)

def mark_reservation_for_recheck(
    client,
    request_id: int,
    now: str,
):
    service = EquipmentRequestService(client)

    return service.mark_reservation_for_recheck(
        request_id,
        now,
    )

@router.get("/{staff_id}/requests/summary")
def equipment_request_summary(staff_id: str):
    client = db()
    service = EquipmentRequestService(client)

    return service.get_request_summary(staff_id)

@router.get("/{staff_id}/events/{event_id}/requests")
def event_equipment_requests(
    staff_id: str,
    event_id: int,
):
    client = db()
    service = EquipmentRequestService(client)

    return service.get_event_requests(
        staff_id,
        event_id,
    )

@router.put("/{staff_id}/events/{event_id}/requests")
def update_event_equipment_requests(
    staff_id: str,
    event_id: int,
    payload: EventEquipmentUpdateInput,
):
    client = db()
    service = EquipmentRequestService(client)

    return service.update_event_requests(
        staff_id,
        event_id,
        payload,
    )