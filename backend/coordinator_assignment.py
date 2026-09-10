import os
from datetime import datetime, timezone
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

def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(500, "Backend Supabase credentials are not configured.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def coordinator_records(client: Client) -> list[dict[str, Any]]:
    users = client.table("users").select("id,name,role").execute().data or []
    return [user for user in users if str(user.get("role", "")).strip().lower() == "event coordinator"]

def view(request: dict[str, Any], assignment: dict[str, Any] | None, users: dict[str, dict[str, Any]]):
    coordinator = users.get(assignment["assigned_coordinator_id"]) if assignment else None
    return {"id": request["id"], "event_title": request["event_title"], "event_date": request["event_date"], "event_status": request["event_status"], "event_organiser_id": request["event_organiser_id"], "assigned_coordinator_id": assignment["assigned_coordinator_id"] if assignment else None, "coordinator_name": coordinator["name"] if coordinator else None}

def active_workloads(client: Client, coordinators: list[dict[str, Any]]) -> dict[str, int]:
    workloads = {item["id"]: 0 for item in coordinators}
    assignments = client.table("events").select("assigned_coordinator_id,event_status").not_.is_("assigned_coordinator_id", "null").execute().data or []
    inactive = {"Completed", "Cancelled"}
    for assignment in assignments:
        coordinator_id = assignment.get("assigned_coordinator_id")
        if coordinator_id in workloads and assignment.get("event_status") not in inactive:
            workloads[coordinator_id] += 1
    return workloads

@router.get("/api/health")
def health_check(): return {"status": "ok", "service": "event-coordinator-assignment"}

@router.post("/api/events/{event_id}/assign-coordinator")
def assign_coordinator_endpoint(event_id: str):
    return assign_event(event_id)

@router.patch("/api/events/{event_id}/coordinator")
def reassign_coordinator(event_id: str, assignment: CoordinatorAssignment):
    client = db()
    event = client.table("events").select("*").eq("id", event_id).maybe_single().execute().data
    if not event: raise HTTPException(404, "Event request not found.")
    coordinator = next((item for item in coordinator_records(client) if item["id"] == assignment.coordinator_id), None)
    if not coordinator: raise HTTPException(400, "Select an available event coordinator.")
    updated = client.table("events").update({"assigned_coordinator_id": coordinator["id"], "assigned_at": datetime.now(timezone.utc).isoformat(), "event_status": "Assigned"}).eq("id", event_id).select("*").execute().data[0]
    return view(updated, updated, {coordinator["id"]: coordinator})

def assign_event(event_id: str):
    client = db()
    request = client.table("events").select("*").eq("id", event_id).maybe_single().execute().data
    if not request: raise HTTPException(404, "Event request not found.")
    coordinators = coordinator_records(client)
    if len(coordinators) != 3: raise HTTPException(500, "Exactly 3 event coordinators are required.")
    workloads = active_workloads(client, coordinators)
    selected = min(coordinators, key=lambda item: (workloads[item["id"]], item["name"]))
    updated = client.table("events").update({"assigned_coordinator_id": selected["id"], "assigned_at": datetime.now(timezone.utc).isoformat(), "event_status": "Assigned"}).eq("id", event_id).select("*").execute().data[0]
    return view(updated, {"assigned_coordinator_id": selected["id"]}, {item["id"]: item for item in coordinators})

@router.get("/api/event-organisers/{organiser_id}/requests")
def organiser_events(organiser_id: str):
    client = db(); users = client.table("users").select("id,name,role").execute().data or []
    requests = client.table("events").select("*").eq("event_organiser_id", organiser_id).order("event_date").execute().data or []
    return [view(item, item if item.get("assigned_coordinator_id") else None, {user["id"]: user for user in users}) for item in requests]

@router.get("/api/events")
def all_events():
    client = db(); users = coordinator_records(client)
    events = client.table("events").select("*").order("event_date").execute().data or []
    return [view(item, item if item.get("assigned_coordinator_id") else None, {user["id"]: user for user in users}) for item in events]

@router.get("/api/coordinators")
def coordinators(): return sorted(coordinator_records(db()), key=lambda user: user.get("name", "").lower())

@router.get("/api/coordinator-workloads")
def coordinator_workloads():
    client = db()
    coordinators = coordinator_records(client)
    workloads = active_workloads(client, coordinators)
    return [{"id": item["id"], "name": item["name"], "role": item["role"], "active_event_count": workloads[item["id"]]} for item in coordinators]
