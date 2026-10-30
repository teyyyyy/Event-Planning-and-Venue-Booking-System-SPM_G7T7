import os
from datetime import date, time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from postgrest.exceptions import APIError
from supabase import Client
from database import create_client
from auth import require_organiser, require_self

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

def require_organiser_path(organiser_id: str, user=Depends(require_organiser)):
    return require_self(organiser_id, user)


router = APIRouter(dependencies=[Depends(require_organiser_path)])
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/").removesuffix("/rest/v1")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
EVENT_TABLE = "Event Details"
EDITABLE_ORGANISER_STATUSES = {"draft", "submitted"}
LAYOUT_OPTIONS = {"Banquet", "Boardroom", "U-shape", "Theatre", "Classroom"}
EQUIPMENT_OPTIONS = {
    "Microphone", "Speaker", "Spotlight", "Projector", "Laptop",
    "Extension cord", "Mixing console", "Video camera", "Tripod", "LED display",
}
FACILITY_OPTIONS = {
    "Aircon", "Breakout Room", "Catering Area", "Dance Floor", "Dining Area",
    "Restrooms", "Green Room", "Stage", "Dressing Room", "Loading Bay",
    "Parking", "Registration Desk", "Reception Area",
}


class EventRequest(BaseModel):
    event_name: str
    event_type: str
    event_date: str
    event_end_date: str | None = None  # blank = single-day event
    event_capacity: int
    description: str
    start_time: str
    end_time: str
    layout_required: str = Field(min_length=1)
    equipment_required: list[str] = Field(min_length=1)
    accessibility_required: int = Field(ge=0, le=1)
    equipment_placement: str = Field(min_length=1)
    crowd_movement: str = Field(min_length=1)
    facilities_required: list[str] = Field(min_length=1)


class EventRequestUpdate(EventRequest):
    pass


class EventChangeRequest(EventRequest):
    request_text: str
    layout_required: str = ""
    equipment_required: list[str] = Field(default_factory=list)
    accessibility_required: int = Field(default=0, ge=0, le=1)
    equipment_placement: str = ""
    crowd_movement: str = ""
    facilities_required: list[str] = Field(default_factory=list)


def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(500, "Backend Supabase credentials are not configured.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def request_data(request: EventRequest) -> dict[str, Any]:
    data = request.model_dump()
    data["event_end_date"] = request.event_end_date or request.event_date
    return data


def organiser_can_edit(event: dict[str, Any], organiser_id: str) -> bool:
    return (
        str(event.get("organiser_id")) == organiser_id
        and str(event.get("status", "")).strip().lower() in EDITABLE_ORGANISER_STATUSES
    )


def organiser_owns_event(event: dict[str, Any], organiser_id: str) -> bool:
    return str(event.get("organiser_id")) == organiser_id


def validate_request(
    request: EventRequest,
    allow_past_date: bool = False,
    require_planning_details: bool = True,
) -> None:
    try:
        event_date = date.fromisoformat(request.event_date)
        event_end_date = date.fromisoformat(request.event_end_date or request.event_date)
        start_time = time.fromisoformat(request.start_time)
        end_time = time.fromisoformat(request.end_time)
    except ValueError as error:
        raise HTTPException(400, "Use a valid event date and time.") from error
    if not allow_past_date and event_date < date.today():
        raise HTTPException(400, "Event date cannot be in the past.")
    if start_time.minute or start_time.second or end_time.minute or end_time.second:
        raise HTTPException(400, "Event times must use one-hour blocks.")
    if event_end_date < event_date:
        raise HTTPException(400, "End date cannot be before the start date.")
    if event_end_date == event_date and end_time <= start_time:
        raise HTTPException(400, "End time must be later than the start time.")
    if require_planning_details:
        if not request.layout_required.strip():
            raise HTTPException(400, "Select a layout.")
        if not request.equipment_required:
            raise HTTPException(400, "Select at least one required equipment item.")
        if not request.equipment_placement.strip():
            raise HTTPException(400, "Enter the equipment placement.")
        if not request.crowd_movement.strip():
            raise HTTPException(400, "Enter the crowd movement plan.")
        if not request.facilities_required:
            raise HTTPException(400, "Select at least one required facility.")
    if request.layout_required and request.layout_required not in LAYOUT_OPTIONS:
        raise HTTPException(400, "Select a valid event layout.")
    if not set(request.equipment_required).issubset(EQUIPMENT_OPTIONS):
        raise HTTPException(400, "Select valid required equipment.")
    if not set(request.facilities_required).issubset(FACILITY_OPTIONS):
        raise HTTPException(400, "Select valid required facilities.")


@router.get("/api/event-organisers/{organiser_id}/submitted-requests")
def organiser_events(organiser_id: str):
    client = db()
    return client.table(EVENT_TABLE).select("*").eq("organiser_id", organiser_id).order("event_date").execute().data or []


@router.post("/api/event-organisers/{organiser_id}/requests")
def create_event_request(organiser_id: str, request: EventRequest):
    validate_request(request)
    client = db()
    payload = {**request_data(request), "organiser_id": organiser_id, "status": "Draft"}
    created = client.table(EVENT_TABLE).insert(payload).execute().data
    if not created:
        raise HTTPException(500, "Event request could not be created.")
    return created[0]


@router.post("/api/event-organisers/{organiser_id}/requests/submit")
def create_submitted_event_request(organiser_id: str, request: EventRequest):
    validate_request(request)
    client = db()
    payload = {**request_data(request), "organiser_id": organiser_id, "status": "Submitted"}
    created = client.table(EVENT_TABLE).insert(payload).execute().data
    if not created:
        raise HTTPException(500, "Event request could not be submitted.")
    return created[0]


@router.put("/api/event-organisers/{organiser_id}/requests/{event_id}")
def update_event_request(organiser_id: str, event_id: str, request: EventRequestUpdate):
    validate_request(request)
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event:
        raise HTTPException(404, "Event request not found.")
    if not organiser_can_edit(event, organiser_id):
        raise HTTPException(403, "This event request cannot be updated during its current status.")
    response = (
        client.table(EVENT_TABLE)
        .update(request_data(request))
        .eq("id", event_id)
        .execute()
    )
    updated = response.data
    if not updated:
        raise HTTPException(500, "Event request could not be updated.")
    return updated[0]


@router.delete("/api/event-organisers/{organiser_id}/requests/{event_id}")
def discard_event_request(organiser_id: str, event_id: str):
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event:
        raise HTTPException(404, "Event request not found.")
    if not organiser_owns_event(event, organiser_id):
        raise HTTPException(403, "You can only discard your own event request.")
    if str(event.get("status", "")).strip().lower() != "draft":
        raise HTTPException(400, "Only draft event requests can be discarded.")

    discarded = (
        client.table(EVENT_TABLE)
        .delete()
        .eq("id", event_id)
        .eq("organiser_id", organiser_id)
        .eq("status", event["status"])
        .select("id")
        .execute()
        .data
    )
    if not discarded:
        raise HTTPException(409, "Event draft changed before it could be discarded.")
    return {"message": "Event draft discarded successfully."}


@router.post("/api/event-organisers/{organiser_id}/requests/{event_id}/submit")
def submit_event_request(organiser_id: str, event_id: str):
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event:
        raise HTTPException(404, "Event request not found.")
    if not organiser_owns_event(event, organiser_id) or str(event.get("status", "")).strip().lower() != "draft":
        raise HTTPException(400, "Only completed draft requests can be submitted.")
    response = (
        client.table(EVENT_TABLE)
        .update({"status": "Submitted"})
        .eq("id", event_id)
        .execute()
    )
    updated = response.data
    if not updated:
        raise HTTPException(500, "Event request could not be submitted.")
    return updated[0]


@router.post("/api/event-organisers/{organiser_id}/requests/{event_id}/change-requests")
def create_event_change_request(organiser_id: str, event_id: int, request: EventChangeRequest):
    request_text = request.request_text.strip()
    if not request_text:
        raise HTTPException(400, "Describe the changes you are requesting.")
    if len(request_text) > 5000:
        raise HTTPException(400, "Change requests must be 5,000 characters or fewer.")
    validate_request(request, allow_past_date=True, require_planning_details=False)
    proposal = request_data(request)

    try:
        result = db().rpc(
            "submit_event_change_request",
            {
                "p_event_id": event_id,
                "p_organiser_id": organiser_id,
                "p_request_text": request_text,
                "p_event_name": proposal["event_name"],
                "p_event_type": proposal["event_type"],
                "p_event_date": proposal["event_date"],
                "p_event_end_date": proposal["event_end_date"],
                "p_event_capacity": proposal["event_capacity"],
                "p_description": proposal["description"],
                "p_start_time": proposal["start_time"],
                "p_end_time": proposal["end_time"],
            },
        ).execute()
    except APIError as error:
        if error.code == "P0002":
            raise HTTPException(404, "Event request not found.") from error
        if error.code == "42501":
            raise HTTPException(403, "You can only request changes to your own event.") from error
        if error.code == "22023":
            raise HTTPException(400, error.message) from error
        if error.code == "23505":
            raise HTTPException(400, "This event already has a pending change request.") from error
        raise

    if not result.data:
        raise HTTPException(500, "Event change request could not be saved.")
    return result.data[0] if isinstance(result.data, list) else result.data

@router.patch("/api/event-organisers/{organiser_id}/change-requests/{request_id}")
def update_event_change_request(organiser_id: str, request_id: int, request: EventChangeRequest):
    request_text = request.request_text.strip()
    validate_request(request, allow_past_date=True, require_planning_details=False)
    try:
        result = db().rpc("update_event_change_request", {
            "p_request_id": request_id, "p_organiser_id": organiser_id, "p_request_text": request_text,
            "p_event_name": request.event_name, "p_event_type": request.event_type,
            "p_event_date": request.event_date, "p_event_end_date": request.event_end_date or request.event_date,
            "p_event_capacity": request.event_capacity, "p_description": request.description,
            "p_start_time": request.start_time, "p_end_time": request.end_time,
        }).execute()
    except APIError as error:
        code = {"P0002": 404, "42501": 403, "22023": 400, "55000": 409}.get(error.code)
        if code: raise HTTPException(code, error.message) from error
        raise
    if not result.data: raise HTTPException(500, "Event change request could not be updated.")
    return result.data[0] if isinstance(result.data, list) else result.data

@router.post("/api/event-organisers/{organiser_id}/change-requests/{request_id}/cancel")
def cancel_event_change_request(organiser_id: str, request_id: int):
    try:
        result = db().rpc("cancel_event_change_request", {"p_request_id": request_id, "p_organiser_id": organiser_id}).execute()
    except APIError as error:
        code = {"P0002": 404, "42501": 403, "55000": 409}.get(error.code)
        if code: raise HTTPException(code, error.message) from error
        raise
    if not result.data: raise HTTPException(500, "Event change request could not be cancelled.")
    return result.data[0] if isinstance(result.data, list) else result.data
