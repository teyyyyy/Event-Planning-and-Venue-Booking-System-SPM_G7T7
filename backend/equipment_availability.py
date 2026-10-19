from fastapi import APIRouter, Depends

from equipment_request import db
from availability_service import AvailabilityService
from auth import require_technical_support_path


router = APIRouter(
    prefix="/api/equipment-availability",
    tags=["Equipment Availability"],
    dependencies=[
        Depends(require_technical_support_path)
    ],
)


# Compatibility wrappers

def require_technical_support(
    client,
    staff_id: str,
):
    service = AvailabilityService(client)

    return service.require_technical_support(
        staff_id
    )


def get_event(
    client,
    event_id: int,
):
    service = AvailabilityService(client)

    return service.get_event(
        event_id
    )


def event_datetimes(
    event: dict,
):
    return AvailabilityService.event_datetimes(
        event
    )


def get_overlapping_reservations(
    client,
    event: dict,
):
    service = AvailabilityService(client)

    return service.get_overlapping_reservations(
        event
    )


def calculate_event_availability(
    client,
    event: dict,
    request_items: list,
):
    service = AvailabilityService(client)

    return service.calculate_event_availability(
        event,
        request_items,
    )


# Routes

@router.get("/{staff_id}/events")
def availability_events(
    staff_id: str,
):
    client = db()
    service = AvailabilityService(client)

    return service.get_availability_events(
        staff_id
    )


@router.get("/{staff_id}/events/{event_id}")
def event_availability(
    staff_id: str,
    event_id: int,
):
    client = db()
    service = AvailabilityService(client)

    return service.get_event_availability(
        staff_id,
        event_id,
    )


@router.get(
    "/{staff_id}/events/{event_id}/catalogue"
)
def event_catalogue_availability(
    staff_id: str,
    event_id: int,
):
    client = db()
    service = AvailabilityService(client)

    return service.get_event_catalogue_availability(
        staff_id,
        event_id,
    )