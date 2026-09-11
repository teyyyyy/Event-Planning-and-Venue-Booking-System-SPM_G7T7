import os
from datetime import date, time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import Client, create_client
from coordinator_assignment import assign_event

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

router = APIRouter()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/").removesuffix("/rest/v1")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
EVENT_TABLE = "Event Details"
EDITABLE_ORGANISER_STATUSES = {"submitted"}


class EventRequest(BaseModel):
    event_name: str
    event_type: str
    event_date: str
    event_capacity: int
    description: str
    start_time: str
    end_time: str


class EventRequestUpdate(EventRequest):
    pass


def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(500, "Backend Supabase credentials are not configured.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def request_data(request: EventRequest) -> dict[str, Any]:
    return request.model_dump()


def organiser_can_edit(event: dict[str, Any], organiser_id: str) -> bool:
    return (
        str(event.get("organiser_id")) == organiser_id
        and str(event.get("status", "")).strip().lower() in EDITABLE_ORGANISER_STATUSES
    )


def organiser_owns_event(event: dict[str, Any], organiser_id: str) -> bool:
    return str(event.get("organiser_id")) == organiser_id


def validate_request(request: EventRequest) -> None:
    try:
        event_date = date.fromisoformat(request.event_date)
        start_time = time.fromisoformat(request.start_time)
        end_time = time.fromisoformat(request.end_time)
    except ValueError as error:
        raise HTTPException(400, "Use a valid event date and time.") from error
    if event_date < date.today():
        raise HTTPException(400, "Event date cannot be in the past.")
    if start_time.minute or start_time.second or end_time.minute or end_time.second:
        raise HTTPException(400, "Event times must use one-hour blocks.")
    if end_time <= start_time:
        raise HTTPException(400, "End time must be later than the start time.")


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
    return assign_event(created[0]["id"])


@router.put("/api/event-organisers/{organiser_id}/requests/{event_id}")
def update_event_request(organiser_id: str, event_id: str, request: EventRequestUpdate):
    validate_request(request)
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event:
        raise HTTPException(404, "Event request not found.")
    if not organiser_can_edit(event, organiser_id):
        raise HTTPException(403, "This event request cannot be updated during its current status.")
    updated = client.table(EVENT_TABLE).update(request_data(request)).eq("id", event_id).select("*").execute().data
    if not updated:
        raise HTTPException(500, "Event request could not be updated.")
    return updated[0]


@router.post("/api/event-organisers/{organiser_id}/requests/{event_id}/submit")
def submit_event_request(organiser_id: str, event_id: str):
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event:
        raise HTTPException(404, "Event request not found.")
    if not organiser_owns_event(event, organiser_id) or str(event.get("status", "")).strip().lower() != "draft":
        raise HTTPException(400, "Only completed draft requests can be submitted.")
    updated = client.table(EVENT_TABLE).update({"status": "Submitted"}).eq("id", event_id).select("*").execute().data
    if not updated:
        raise HTTPException(500, "Event request could not be submitted.")
    return assign_event(event_id)
