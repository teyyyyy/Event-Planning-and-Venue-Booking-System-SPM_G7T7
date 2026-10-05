import os
from typing import Any, Literal
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from postgrest.exceptions import APIError
from supabase import Client
from database import create_client
from dotenv import load_dotenv
from auth import require_coordinator, require_organiser, require_path_user, require_self
from event_changes import change_impact, live_arrangements

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

router = APIRouter()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/").removesuffix("/rest/v1")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

class CoordinatorAssignment(BaseModel):
    coordinator_id: str

class EventStatusUpdate(BaseModel):
    event_status: str

class EventChangeRequestReview(BaseModel):
    decision: Literal["Approved", "Rejected"]
    review_comments: str | None = None

EVENT_STATUSES = {"Under review", "Approved", "Planning", "Confirmed", "Completed", "Cancelled", "Rejected"}
EVENT_TABLE = "Event Details"
INACTIVE_STATUSES = {"draft", "complete", "completed", "cancelled", "rejected"}

def db() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(500, "Backend Supabase credentials are not configured.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def fetch_one(query) -> dict[str, Any] | None:
    result = query.maybe_single().execute()
    return result.data if result else None

def coordinator_records(client: Client) -> list[dict[str, Any]]:
    users = client.table("users").select("id,name,role,email,active_event_count").execute().data or []
    return [user for user in users if str(user.get("role", "")).strip().lower() == "event coordinator"]

def view(request: dict[str, Any], assignment: dict[str, Any] | None, users: dict[str, dict[str, Any]]):
    coordinator_id = assignment.get("coordinator_id") if assignment else None
    coordinator = users.get(str(coordinator_id)) if coordinator_id else None
    return {"id": request["id"], "event_title": request.get("event_name"), "event_name": request.get("event_name"), "event_type": request.get("event_type"), "event_capacity": request.get("event_capacity"), "description": request.get("description"), "start_time": request.get("start_time"), "end_time": request.get("end_time"), "event_date": request.get("event_date"), "event_end_date": request.get("event_end_date") or request.get("event_date"), "event_status": request.get("status"), "event_organiser_id": request.get("organiser_id"), "assigned_coordinator_id": assignment.get("coordinator_id") if assignment else None, "coordinator_name": coordinator["name"] if coordinator else None, "coordinator_email": coordinator.get("email") if coordinator else None, "has_pending_change_request": bool(request.get("has_pending_change_request")), "latest_change_request": request.get("latest_change_request")}

def change_request_view(
    change_request: dict[str, Any],
    events: dict[str, dict[str, Any]],
    users: dict[str, dict[str, Any]],
    arrangements: dict[str, Any] | None = None,
):
    event = events.get(str(change_request.get("event_id")))
    organiser = users.get(str(change_request.get("organiser_id")))
    coordinator = users.get(str(change_request.get("coordinator_id")))
    return {
        "id": change_request["id"],
        "event_id": change_request.get("event_id"),
        "organiser_id": change_request.get("organiser_id"),
        "coordinator_id": change_request.get("coordinator_id"),
        "request_text": change_request.get("request_text"),
        "review_status": change_request.get("review_status"),
        "reviewed_by": change_request.get("reviewed_by"),
        "reviewed_at": change_request.get("reviewed_at"),
        "review_comments": change_request.get("review_comments"),
        "created_at": change_request.get("created_at"),
        "organiser_name": organiser.get("name") if organiser else None,
        "organiser_email": organiser.get("email") if organiser else None,
        "coordinator_name": coordinator.get("name") if coordinator else None,
        "coordinator_email": coordinator.get("email") if coordinator else None,
        "processing_status": change_request.get("processing_status"),
        "processed_at": change_request.get("processed_at"),
        "processing_summary": change_request.get("processing_summary"),
        "impact": change_impact(change_request, event, arrangements or {}),
        "event": view(event, event if event and event.get("coordinator_id") else None, users) if event else None,
        "proposal": {
            "event_name": change_request.get("proposed_event_name"),
            "event_type": change_request.get("proposed_event_type"),
            "event_date": change_request.get("proposed_event_date"),
            "event_end_date": change_request.get("proposed_event_end_date"),
            "event_capacity": change_request.get("proposed_event_capacity"),
            "description": change_request.get("proposed_description"),
            "start_time": change_request.get("proposed_start_time"),
            "end_time": change_request.get("proposed_end_time"),
        },
    }

def with_pending_change_request_flags(client: Client, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    event_ids = [event["id"] for event in events]
    if not event_ids:
        return events
    # "*" also returns the processing columns once significant_event_changes.sql is applied.
    change_requests = (
        client.table("event_change_requests")
        .select("*")
        .in_("event_id", event_ids)
        .order("created_at", desc=True)
        .order("id", desc=True)
        .execute()
        .data
        or []
    )
    latest_by_event = {}
    for change_request in change_requests:
        latest_by_event.setdefault(str(change_request["event_id"]), change_request)
    return [
        {
            **event,
            "has_pending_change_request": latest_by_event.get(str(event["id"]), {}).get("review_status") == "Pending",
            "latest_change_request": latest_by_event.get(str(event["id"])),
        }
        for event in events
    ]

def active_workloads(client: Client, coordinators: list[dict[str, Any]]) -> dict[str, int]:
    current = {item["id"]: item for item in coordinator_records(client)}
    return {item["id"]: int(current.get(item["id"], {}).get("active_event_count") or 0) for item in coordinators}

def adjust_workload(client: Client, coordinator_id: str, amount: int):
    user = fetch_one(client.table("users").select("active_event_count").eq("id", coordinator_id))
    if not user:
        raise HTTPException(400, "Coordinator not found.")
    current = int(user.get("active_event_count") or 0)
    client.table("users").update({"active_event_count": max(0, current + amount)}).eq("id", coordinator_id).execute()

def is_active_status(status: Any) -> bool:
    return str(status or "").strip().lower() not in INACTIVE_STATUSES


def require_organiser_path(organiser_id: str, user=Depends(require_organiser)):
    return require_self(organiser_id, user)


def require_organiser_event(event_id: str, user=Depends(require_organiser)):
    event = fetch_one(db().table(EVENT_TABLE).select("organiser_id").eq("id", event_id))
    if not event:
        raise HTTPException(404, "Event request not found.")
    if str(event.get("organiser_id")) != str(user["id"]):
        raise HTTPException(403, "You can only access your own event requests.")
    return user


def require_assigned_coordinator_event(event_id: str, user=Depends(require_coordinator)):
    event = fetch_one(db().table(EVENT_TABLE).select("coordinator_id").eq("id", event_id))
    if not event:
        raise HTTPException(404, "Event request not found.")
    if str(event.get("coordinator_id")) != str(user["id"]):
        raise HTTPException(403, "You can only manage events assigned to you.")
    return user


@router.get("/api/health")
def health_check(): return {"status": "ok", "service": "event-coordinator-assignment"}

@router.get("/api/users/{user_id}/role")
def user_role(user_id: str, user: dict[str, Any] = Depends(require_path_user)):
    return user

@router.post("/api/events/{event_id}/assign-coordinator", dependencies=[Depends(require_organiser_event)])
def assign_coordinator_endpoint(event_id: str):
    return assign_event(event_id)

@router.patch("/api/events/{event_id}/coordinator", dependencies=[Depends(require_assigned_coordinator_event)])
def reassign_coordinator(event_id: str, assignment: CoordinatorAssignment):
    client = db()
    event = fetch_one(client.table(EVENT_TABLE).select("*").eq("id", event_id))
    if not event: raise HTTPException(404, "Event request not found.")
    coordinator = next((item for item in coordinator_records(client) if item["id"] == assignment.coordinator_id), None)
    if not coordinator: raise HTTPException(400, "Select an available event coordinator.")
    previous_id = event.get("coordinator_id")
    if previous_id != coordinator["id"] and is_active_status(event.get("status")):
        if previous_id: adjust_workload(client, previous_id, -1)
        adjust_workload(client, coordinator["id"], 1)
    response = (
        client.table(EVENT_TABLE)
        .update({"coordinator_id": coordinator["id"]})
        .eq("id", event_id)
        .execute()
    )
    updated = response.data[0]
    return view(updated, updated, {str(coordinator["id"]): coordinator})

@router.patch("/api/events/{event_id}/status", dependencies=[Depends(require_assigned_coordinator_event)])
def update_event_status(event_id: str, status_update: EventStatusUpdate):
    if status_update.event_status not in EVENT_STATUSES:
        raise HTTPException(400, "Invalid event status.")
    client = db()
    event = fetch_one(client.table(EVENT_TABLE).select("*").eq("id", event_id))
    if not event: raise HTTPException(404, "Event request not found.")
    old_active = is_active_status(event.get("status"))
    new_active = is_active_status(status_update.event_status)
    coordinator_id = event.get("coordinator_id")
    if coordinator_id and old_active != new_active:
        adjust_workload(client, coordinator_id, 1 if new_active else -1)
    response = (
        client.table(EVENT_TABLE)
        .update({"status": status_update.event_status})
        .eq("id", event_id)
        .execute()
    )
    updated = response.data[0]
    users = client.table("users").select("id,name,role,email,active_event_count").execute().data or []
    return view(updated, updated if updated.get("coordinator_id") else None, {str(user["id"]): user for user in users})

def assign_event(event_id: str):
    client = db()
    request = fetch_one(client.table(EVENT_TABLE).select("*").eq("id", event_id))
    if not request: raise HTTPException(404, "Event request not found.")
    coordinators = coordinator_records(client)
    if len(coordinators) != 3: raise HTTPException(500, "Exactly 3 event coordinators are required.")
    workloads = active_workloads(client, coordinators)
    selected = min(coordinators, key=lambda item: (workloads[item["id"]], item["name"]))
    response = (
        client.table(EVENT_TABLE)
        .update({"coordinator_id": selected["id"], "status": "Under review"})
        .eq("id", event_id)
        .execute()
    )
    updated = response.data[0]
    if not request.get("coordinator_id") and is_active_status("Under review"):
        adjust_workload(client, selected["id"], 1)
    return view(updated, {"coordinator_id": selected["id"]}, {str(item["id"]): item for item in coordinators})

@router.get("/api/event-organisers/{organiser_id}/requests", dependencies=[Depends(require_organiser_path)])
def organiser_events(organiser_id: str):
    client = db(); users = client.table("users").select("id,name,role,email").execute().data or []
    requests = client.table(EVENT_TABLE).select("*").eq("organiser_id", organiser_id).order("event_date").execute().data or []
    return [view(item, item if item.get("coordinator_id") else None, {str(user["id"]): user for user in users}) for item in with_pending_change_request_flags(client, requests)]

@router.get("/api/events")
def all_events(user: dict[str, Any] = Depends(require_coordinator)):
    client = db(); users = coordinator_records(client)
    events = client.table(EVENT_TABLE).select("*").eq("coordinator_id", user["id"]).order("event_date").execute().data or []
    return [view(item, item if item.get("coordinator_id") else None, {str(user["id"]): user for user in users}) for item in events]

@router.get("/api/event-change-requests")
def event_change_requests(user: dict[str, Any] = Depends(require_coordinator)):
    client = db()
    rows = (
        client.table("event_change_requests")
        .select("*")
        .eq("coordinator_id", user["id"])
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    event_ids = [row.get("event_id") for row in rows if row.get("event_id") is not None]
    events = client.table(EVENT_TABLE).select("*").in_("id", event_ids).execute().data if event_ids else []
    user_ids = {
        str(value)
        for row in rows
        for value in (row.get("organiser_id"), row.get("coordinator_id"))
        if value is not None
    }
    user_ids.update(str(event["coordinator_id"]) for event in (events or []) if event.get("coordinator_id") is not None)
    users = client.table("users").select("id,name,role,email").in_("id", list(user_ids)).execute().data if user_ids else []
    event_map = {str(event["id"]): event for event in (events or [])}
    user_map = {str(user["id"]): user for user in (users or [])}
    arrangements = live_arrangements(client, event_ids)
    return [change_request_view(row, event_map, user_map, arrangements) for row in rows]

@router.patch("/api/event-change-requests/{request_id}/review")
def review_event_change_request(
    request_id: int,
    review: EventChangeRequestReview,
    user: dict[str, Any] = Depends(require_coordinator),
):
    review_comments = (review.review_comments or "").strip()
    if review.decision == "Rejected" and not review_comments:
        raise HTTPException(400, "A reason is required when rejecting a change request.")

    client = db()
    try:
        result = client.rpc(
            "review_event_change_request",
            {
                "p_request_id": request_id,
                "p_coordinator_id": user["id"],
                "p_decision": review.decision,
                "p_review_comments": review_comments or None,
            },
        ).execute()
    except APIError as error:
        if error.code == "P0002":
            raise HTTPException(404, error.message) from error
        if error.code == "42501":
            raise HTTPException(403, error.message) from error
        if error.code == "22023":
            raise HTTPException(400, error.message) from error
        if error.code == "55000":
            raise HTTPException(409, error.message) from error
        raise

    if not result.data:
        raise HTTPException(500, "Event change request could not be reviewed.")
    return result.data[0] if isinstance(result.data, list) else result.data

@router.get("/api/coordinators", dependencies=[Depends(require_coordinator)])
def coordinators(): return sorted(coordinator_records(db()), key=lambda user: user.get("name", "").lower())

@router.get("/api/coordinator-workloads", dependencies=[Depends(require_coordinator)])
def coordinator_workloads():
    client = db()
    coordinators = coordinator_records(client)
    workloads = active_workloads(client, coordinators)
    return [{"id": item["id"], "name": item["name"], "role": item["role"], "active_event_count": workloads[item["id"]]} for item in coordinators]
