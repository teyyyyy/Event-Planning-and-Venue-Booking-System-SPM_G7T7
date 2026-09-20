import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / '.env')
SUPABASE_URL = (os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL', '')).rstrip('/').removesuffix('/rest/v1')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

EVENT_TABLE = 'Event Details'
EQUIPMENT_TABLE = 'Equipment'
REQUEST_TABLE = 'Equipment Request'
REQUEST_ITEM_TABLE = 'Equipment Request Item'
RESERVATION_TABLE = 'Equipment Reservation'
RESERVATION_ITEM_TABLE = 'Equipment Reservation Item'
USER_TABLE = 'users'

router = APIRouter(prefix='/api', tags=['Equipment Requests'])

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

def get_coordinator_event(client: Client, coordinator_id: str, event_id: int):
    result = client.table(EVENT_TABLE).select('*').eq('id', event_id).eq('coordinator_id', coordinator_id).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail='Event not found or is not assigned to this coordinator.')
    return rows[0]

def event_datetimes(event: dict):
    event_date = event.get('event_date')
    start_time = event.get('start_time')
    end_time = event.get('end_time')

    if not event_date:
        raise HTTPException(status_code=400, detail='This event does not have an event date.')
    if not start_time or not end_time:
        raise HTTPException(status_code=400, detail='This event does not have a complete start and end time. Equipment availability cannot be checked until the event time is set.')

    try:
        start_datetime = datetime.fromisoformat(f'{event_date}T{start_time}')
        end_datetime = datetime.fromisoformat(f'{event_date}T{end_time}')
    except ValueError as error:
        raise HTTPException(status_code=400, detail='The event has an invalid date or time.') from error

    if end_datetime <= start_datetime:
        raise HTTPException(status_code=400, detail='The event end time must be after the start time.')

    return (start_datetime, end_datetime)

def calculate_availability(client: Client, event: dict):
    start_datetime, end_datetime = event_datetimes(event)

    equipment_rows = client.table(EQUIPMENT_TABLE).select(
        'equipment_id,equipment_name,total_quantity,under_maintenance_count'
    ).order('equipment_name').execute().data or []

    reserved_by_equipment = {}

    try:
        overlapping_items = client.table(RESERVATION_ITEM_TABLE).select(
            'reservation_id,equipment_id,reserved_quantity,start_datetime,end_datetime'
        ).lt('start_datetime', end_datetime.isoformat()).gt(
            'end_datetime', start_datetime.isoformat()
        ).execute().data or []

        reservation_ids = list({row['reservation_id'] for row in overlapping_items})
        active_reservation_ids = set()

        if reservation_ids:
            reservation_headers = client.table(RESERVATION_TABLE).select(
                'reservation_id,status'
            ).in_('reservation_id', reservation_ids).execute().data or []

            active_reservation_ids = {
                row['reservation_id']
                for row in reservation_headers
                if str(row.get('status', '')).strip().lower() != 'cancelled'
            }

        for row in overlapping_items:
            if row['reservation_id'] not in active_reservation_ids:
                continue

            equipment_id = row['equipment_id']
            reserved_by_equipment[equipment_id] = (
                reserved_by_equipment.get(equipment_id, 0)
                + int(row['reserved_quantity'])
            )

    except Exception:
        reserved_by_equipment = {}

    availability = []

    for equipment in equipment_rows:
        equipment_id = equipment['equipment_id']
        total_quantity = int(equipment.get('total_quantity') or 0)
        maintenance_quantity = int(equipment.get('under_maintenance_count') or 0)
        reserved_quantity = reserved_by_equipment.get(equipment_id, 0)
        available_quantity = max(total_quantity - maintenance_quantity - reserved_quantity, 0)

        availability.append({
            'equipment_id': equipment_id,
            'equipment_name': equipment['equipment_name'],
            'total_quantity': total_quantity,
            'under_maintenance_count': maintenance_quantity,
            'reserved_quantity': reserved_quantity,
            'available_quantity': available_quantity
        })

    return availability

def validate_request_items(request_items, availability_rows):
    if not request_items:
        raise HTTPException(status_code=400, detail='At least one equipment item is required.')

    equipment_ids = [item.equipment_id.strip() for item in request_items]

    if len(equipment_ids) != len(set(equipment_ids)):
        raise HTTPException(status_code=400, detail='The same equipment type cannot be added twice.')

    availability_map = {row['equipment_id']: row for row in availability_rows}

    for item in request_items:
        equipment_id = item.equipment_id.strip()

        if not equipment_id:
            raise HTTPException(status_code=400, detail='Equipment is required.')

        equipment_info = availability_map.get(equipment_id)

        if not equipment_info:
            raise HTTPException(status_code=400, detail='Selected equipment does not exist.')

        available = int(equipment_info['available_quantity'])

        if item.requested_quantity > available:
            raise HTTPException(
                status_code=400,
                detail=f"{equipment_info['equipment_name']} has only {available} available."
            )

# Get events available for NEW equipment requests
@router.get('/event-coordinators/{coordinator_id}/events')
def coordinator_events(coordinator_id: str):
    client = db()

    assigned_events = client.table(EVENT_TABLE).select(
        '*'
    ).eq('coordinator_id', coordinator_id).order('event_date').execute().data or []

    if not assigned_events:
        return []

    event_ids = [event['id'] for event in assigned_events]

    existing_requests = client.table(REQUEST_TABLE).select(
        'event_id'
    ).in_('event_id', event_ids).execute().data or []

    requested_event_ids = {row['event_id'] for row in existing_requests}

    return [
        event for event in assigned_events
        if event['id'] not in requested_event_ids
    ]

@router.get('/equipment')
def equipment_catalogue():
    client = db()
    result = client.table(EQUIPMENT_TABLE).select(
        'equipment_id,equipment_name,total_quantity,under_maintenance_count'
    ).order('equipment_name').execute()
    return result.data or []

@router.get('/event-coordinators/{coordinator_id}/events/{event_id}/equipment-availability')
def equipment_availability(coordinator_id: str, event_id: int):
    client = db()
    event = get_coordinator_event(client, coordinator_id, event_id)
    return calculate_availability(client, event)

@router.post('/event-coordinators/{coordinator_id}/equipment-requests')
def create_equipment_request(coordinator_id: str, request: EquipmentRequestInput):
    client = db()
    event = get_coordinator_event(client, coordinator_id, request.event_id)

    existing = client.table(REQUEST_TABLE).select(
        'request_id'
    ).eq('event_id', request.event_id).execute().data or []

    if existing:
        raise HTTPException(
            status_code=409,
            detail='An equipment request has already been submitted for this event. Edit the existing request instead.'
        )

    availability_rows = calculate_availability(client, event)
    validate_request_items(request.items, availability_rows)

    header = client.table(REQUEST_TABLE).insert({
        'event_id': request.event_id,
        'status': 'Submitted',
        'created_by': coordinator_id
    }).execute().data

    if not header:
        raise HTTPException(status_code=500, detail='Equipment request could not be created.')

    request_id = header[0]['request_id']
    item_rows = []

    for item in request.items:
        item_rows.append({
            'request_id': request_id,
            'equipment_id': item.equipment_id.strip(),
            'requested_quantity': item.requested_quantity,
            'technical_requirements': item.technical_requirements.strip() if item.technical_requirements else ''
        })

    try:
        created_items = client.table(REQUEST_ITEM_TABLE).insert(item_rows).execute().data
    except Exception as error:
        client.table(REQUEST_TABLE).delete().eq('request_id', request_id).execute()
        raise HTTPException(status_code=500, detail='Equipment request items could not be saved.') from error

    return {
        'message': 'Equipment request submitted successfully.',
        'request_id': request_id,
        'event_id': request.event_id,
        'items': created_items
    }

@router.put('/event-coordinators/{coordinator_id}/equipment-requests/{request_id}')
def edit_equipment_request(coordinator_id: str, request_id: int, payload: EquipmentRequestEditInput):
    client = db()

    header_rows = client.table(REQUEST_TABLE).select(
        'request_id,event_id,created_by'
    ).eq('request_id', request_id).eq(
        'created_by', coordinator_id
    ).execute().data or []

    if not header_rows:
        raise HTTPException(
            status_code=404,
            detail='Equipment request not found or does not belong to this coordinator.'
        )

    header = header_rows[0]
    event = get_coordinator_event(client, coordinator_id, header['event_id'])
    availability_rows = calculate_availability(client, event)
    validate_request_items(payload.items, availability_rows)

    existing_items = client.table(REQUEST_ITEM_TABLE).select(
        'request_id,equipment_id'
    ).eq('request_id', request_id).execute().data or []

    existing_equipment_ids = {row['equipment_id'] for row in existing_items}
    submitted_equipment_ids = {item.equipment_id.strip() for item in payload.items}
    now = datetime.now(timezone.utc).isoformat()

    removed_equipment_ids = existing_equipment_ids - submitted_equipment_ids

    for equipment_id in removed_equipment_ids:
        client.table(REQUEST_ITEM_TABLE).delete().eq(
            'request_id', request_id
        ).eq('equipment_id', equipment_id).execute()

    for item in payload.items:
        equipment_id = item.equipment_id.strip()

        item_data = {
            'requested_quantity': item.requested_quantity,
            'technical_requirements': item.technical_requirements.strip() if item.technical_requirements else '',
            'updated_at': now
        }

        if equipment_id in existing_equipment_ids:
            client.table(REQUEST_ITEM_TABLE).update(item_data).eq(
                'request_id', request_id
            ).eq('equipment_id', equipment_id).execute()
        else:
            client.table(REQUEST_ITEM_TABLE).insert({
                'request_id': request_id,
                'equipment_id': equipment_id,
                **item_data
            }).execute()

    client.table(REQUEST_TABLE).update({
        'status': 'Submitted',
        'updated_by': None,
        'updated_at': now,
        'latest_update_summary': None
    }).eq('request_id', request_id).execute()

    return {
        'message': 'Equipment request updated successfully.',
        'request_id': request_id,
        'event_id': header['event_id']
    }

@router.get('/event-coordinators/{coordinator_id}/equipment-requests')
def get_equipment_requests(coordinator_id: str):
    client = db()

    headers = client.table(REQUEST_TABLE).select(
        'request_id,event_id,status,created_by,updated_by,created_at,updated_at,latest_update_summary'
    ).eq('created_by', coordinator_id).order(
        'request_id', desc=True
    ).execute().data or []

    if not headers:
        return []

    event_ids = list({row['event_id'] for row in headers})

    event_rows = client.table(EVENT_TABLE).select(
        'id,event_name,event_date,start_time,end_time'
    ).in_('id', event_ids).execute().data or []

    event_map = {row['id']: row for row in event_rows}
    request_ids = [row['request_id'] for row in headers]

    item_rows = client.table(REQUEST_ITEM_TABLE).select(
        'request_id,equipment_id,requested_quantity,technical_requirements,updated_by,created_at,updated_at'
    ).in_('request_id', request_ids).order(
        'request_id'
    ).order('equipment_id').execute().data or []

    equipment_ids = list({row['equipment_id'] for row in item_rows})
    equipment_map = {}

    if equipment_ids:
        equipment_rows = client.table(EQUIPMENT_TABLE).select(
            'equipment_id,equipment_name'
        ).in_('equipment_id', equipment_ids).execute().data or []

        equipment_map = {
            row['equipment_id']: row['equipment_name']
            for row in equipment_rows
        }

    updater_ids = set()

    for header in headers:
        if header.get('updated_by'):
            updater_ids.add(header['updated_by'])

    for item in item_rows:
        if item.get('updated_by'):
            updater_ids.add(item['updated_by'])

    user_map = {}

    if updater_ids:
        user_rows = client.table(USER_TABLE).select(
            'id,name'
        ).in_('id', list(updater_ids)).execute().data or []

        user_map = {
            row['id']: row['name']
            for row in user_rows
        }

    results = []

    for header in headers:
        event = event_map.get(header['event_id'], {})
        request_items = []

        for item in item_rows:
            if item['request_id'] != header['request_id']:
                continue

            item_updated_by = item.get('updated_by')

            request_items.append({
                'equipment_id': item['equipment_id'],
                'equipment_name': equipment_map.get(
                    item['equipment_id'],
                    item['equipment_id']
                ),
                'requested_quantity': item['requested_quantity'],
                'technical_requirements': item.get('technical_requirements') or '',
                'updated_by': item_updated_by,
                'updated_by_name': user_map.get(item_updated_by) if item_updated_by else None,
                'created_at': item.get('created_at'),
                'updated_at': item.get('updated_at') or item.get('created_at')
            })

        header_updated_by = header.get('updated_by')

        results.append({
            'request_id': header['request_id'],
            'event_id': header['event_id'],
            'event_name': event.get('event_name', 'Unknown event'),
            'event_date': event.get('event_date', ''),
            'start_time': event.get('start_time'),
            'end_time': event.get('end_time'),
            'status': header.get('status', 'Submitted'),
            'created_by': header.get('created_by'),
            'created_at': header.get('created_at'),
            'updated_by': header_updated_by,
            'updated_by_name': user_map.get(header_updated_by) if header_updated_by else None,
            'updated_at': header.get('updated_at') or header.get('created_at'),
            'latest_update_summary': header.get('latest_update_summary') or '',
            'items': request_items
        })

    return results