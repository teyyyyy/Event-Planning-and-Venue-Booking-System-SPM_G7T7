import os
from typing import Any
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import Client, create_client
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

router = APIRouter()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/").removesuffix("/rest/v1")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

class CoordinatorAssignment(BaseModel):
    coordinator_id: str

class EventStatusUpdate(BaseModel):
    event_status: str

EVENT_STATUSES = {"Under review", "Approved", "Planning", "Confirmed", "Completed", "Cancelled", "Rejected"}
EVENT_TABLE = "Event Details"
INACTIVE_STATUSES = {"draft", "complete", "completed", "cancelled", "rejected"}

def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(500, "Backend Supabase credentials are not configured.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def coordinator_records(client: Client) -> list[dict[str, Any]]:
    users = client.table("users").select("id,name,role,email,active_event_count").execute().data or []
    return [user for user in users if str(user.get("role", "")).strip().lower() == "event coordinator"]

def view(request: dict[str, Any], assignment: dict[str, Any] | None, users: dict[str, dict[str, Any]]):
    coordinator_id = assignment.get("coordinator_id") if assignment else None
    coordinator = users.get(str(coordinator_id)) if coordinator_id else None
    return {"id": request["id"], "event_title": request.get("event_name"), "event_date": request.get("event_date"), "event_status": request.get("status"), "event_organiser_id": request.get("organiser_id"), "assigned_coordinator_id": assignment.get("coordinator_id") if assignment else None, "coordinator_name": coordinator["name"] if coordinator else None, "coordinator_email": coordinator.get("email") if coordinator else None}

def active_workloads(client: Client, coordinators: list[dict[str, Any]]) -> dict[str, int]:
    current = {item["id"]: item for item in coordinator_records(client)}
    return {item["id"]: int(current.get(item["id"], {}).get("active_event_count") or 0) for item in coordinators}

def adjust_workload(client: Client, coordinator_id: str, amount: int):
    user = client.table("users").select("active_event_count").eq("id", coordinator_id).maybe_single().execute().data
    if not user:
        raise HTTPException(400, "Coordinator not found.")
    current = int(user.get("active_event_count") or 0)
    client.table("users").update({"active_event_count": max(0, current + amount)}).eq("id", coordinator_id).execute()

def is_active_status(status: Any) -> bool:
    return str(status or "").strip().lower() not in INACTIVE_STATUSES

@router.get("/api/health")
def health_check(): return {"status": "ok", "service": "event-coordinator-assignment"}

@router.post("/api/events/{event_id}/assign-coordinator")
def assign_coordinator_endpoint(event_id: str):
    return assign_event(event_id)

@router.patch("/api/events/{event_id}/coordinator")
def reassign_coordinator(event_id: str, assignment: CoordinatorAssignment):
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event: raise HTTPException(404, "Event request not found.")
    coordinator = next((item for item in coordinator_records(client) if item["id"] == assignment.coordinator_id), None)
    if not coordinator: raise HTTPException(400, "Select an available event coordinator.")
    previous_id = event.get("coordinator_id")
    if previous_id != coordinator["id"] and is_active_status(event.get("status")):
        if previous_id: adjust_workload(client, previous_id, -1)
        adjust_workload(client, coordinator["id"], 1)
    updated = client.table(EVENT_TABLE).update({"coordinator_id": coordinator["id"]}).eq("id", event_id).select("*").execute().data[0]
    return view(updated, updated, {str(coordinator["id"]): coordinator})

@router.patch("/api/events/{event_id}/status")
def update_event_status(event_id: str, status_update: EventStatusUpdate):
    if status_update.event_status not in EVENT_STATUSES:
        raise HTTPException(400, "Invalid event status.")
    client = db()
    event = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not event: raise HTTPException(404, "Event request not found.")
    old_active = is_active_status(event.get("status"))
    new_active = is_active_status(status_update.event_status)
    coordinator_id = event.get("coordinator_id")
    if coordinator_id and old_active != new_active:
        adjust_workload(client, coordinator_id, 1 if new_active else -1)
    updated = client.table(EVENT_TABLE).update({"status": status_update.event_status}).eq("id", event_id).select("*").execute().data[0]
    users = client.table("users").select("id,name,role,email,active_event_count").execute().data or []
    return view(updated, updated if updated.get("coordinator_id") else None, {str(user["id"]): user for user in users})

def assign_event(event_id: str):
    client = db()
    request = client.table(EVENT_TABLE).select("*").eq("id", event_id).maybe_single().execute().data
    if not request: raise HTTPException(404, "Event request not found.")
    coordinators = coordinator_records(client)
    if len(coordinators) != 3: raise HTTPException(500, "Exactly 3 event coordinators are required.")
    workloads = active_workloads(client, coordinators)
    selected = min(coordinators, key=lambda item: (workloads[item["id"]], item["name"]))
    updated = client.table(EVENT_TABLE).update({"coordinator_id": selected["id"], "status": "Under review"}).eq("id", event_id).select("*").execute().data[0]
    if not request.get("coordinator_id") and is_active_status("Under review"):
        adjust_workload(client, selected["id"], 1)
    return view(updated, {"coordinator_id": selected["id"]}, {str(item["id"]): item for item in coordinators})

@router.get("/api/event-organisers/{organiser_id}/requests")
def organiser_events(organiser_id: str):
    client = db(); users = client.table("users").select("id,name,role,email").execute().data or []
    requests = client.table(EVENT_TABLE).select("*").eq("organiser_id", organiser_id).order("event_date").execute().data or []
    return [view(item, item if item.get("coordinator_id") else None, {str(user["id"]): user for user in users}) for item in requests]

@router.get("/api/events")
def all_events():
    client = db(); users = coordinator_records(client)
    events = client.table(EVENT_TABLE).select("*").order("event_date").execute().data or []
    return [view(item, item if item.get("coordinator_id") else None, {str(user["id"]): user for user in users}) for item in events]

@router.get("/api/coordinators")
def coordinators(): return sorted(coordinator_records(db()), key=lambda user: user.get("name", "").lower())

@router.get("/api/coordinator-workloads")
def coordinator_workloads():
    client = db()
    coordinators = coordinator_records(client)
    workloads = active_workloads(client, coordinators)
    return [{"id": item["id"], "name": item["name"], "role": item["role"], "active_event_count": workloads[item["id"]]} for item in coordinators]
