from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from equipment_request import db, calculate_availability, EVENT_TABLE, EQUIPMENT_TABLE, REQUEST_TABLE, REQUEST_ITEM_TABLE

USER_TABLE = "users"
router = APIRouter(prefix="/api/equipment-update", tags=["Equipment Update"])

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
    result = client.table(USER_TABLE).select("id,name,role,email").eq("id", staff_id).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Technical Support Staff user was not found.")
    user = rows[0]
    role = str(user.get("role", "")).strip().lower()
    if role != "technical support staff":
        raise HTTPException(status_code=403, detail="Only Technical Support Staff can access equipment updates.")
    return user

def get_event(client, event_id: int):
    rows = client.table(EVENT_TABLE).select("*").eq("id", event_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Event was not found.")
    return rows[0]

def get_request_header(client, request_id: int):
    rows = client.table(REQUEST_TABLE).select("*").eq("request_id", request_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail=f"Equipment request #{request_id} was not found.")
    return rows[0]

@router.get("/{staff_id}/requests/summary")
def equipment_request_summary(staff_id: str):
    client = db()
    require_technical_support(client, staff_id)

    headers = client.table(REQUEST_TABLE).select(
        "request_id,event_id,status,created_at,updated_at"
    ).order("created_at", desc=True).execute().data or []

    if not headers:
        return []

    event_ids = list({row["event_id"] for row in headers})
    event_rows = client.table(EVENT_TABLE).select(
        "id,event_name,event_date,start_time,end_time"
    ).in_("id", event_ids).execute().data or []
    event_map = {row["id"]: row for row in event_rows}

    request_ids = [row["request_id"] for row in headers]
    item_rows = client.table(REQUEST_ITEM_TABLE).select(
        "request_id,equipment_id,requested_quantity"
    ).in_("request_id", request_ids).execute().data or []

    equipment_ids = list({row["equipment_id"] for row in item_rows})
    equipment_map = {}

    if equipment_ids:
        equipment_rows = client.table(EQUIPMENT_TABLE).select(
            "equipment_id,equipment_name"
        ).in_("equipment_id", equipment_ids).execute().data or []
        equipment_map = {row["equipment_id"]: row["equipment_name"] for row in equipment_rows}

    results = []

    for header in headers:
        event = event_map.get(header["event_id"], {})
        descriptions = []

        for item in item_rows:
            if item["request_id"] != header["request_id"]:
                continue
            quantity = int(item.get("requested_quantity") or 0)
            if quantity <= 0:
                continue
            name = equipment_map.get(item["equipment_id"], item["equipment_id"])
            descriptions.append(f"{name} × {quantity}")

        results.append({
            "event_id": header["event_id"],
            "event_name": event.get("event_name", "Unknown event"),
            "event_date": event.get("event_date"),
            "start_time": event.get("start_time"),
            "end_time": event.get("end_time"),
            "request_id": header["request_id"],
            "request_count": 1,
            "equipment_description": ", ".join(descriptions) if descriptions else "No active equipment",
            "status": header.get("status", "Submitted")
        })

    results.sort(key=lambda row: row.get("event_date") or "")
    return results

@router.get("/{staff_id}/events/{event_id}/requests")
def event_equipment_requests(staff_id: str, event_id: int):
    client = db()
    require_technical_support(client, staff_id)
    event = get_event(client, event_id)

    headers = client.table(REQUEST_TABLE).select(
        "request_id,event_id,status,created_by,updated_by,created_at,updated_at,latest_update_summary"
    ).eq("event_id", event_id).order("request_id").execute().data or []

    equipment_rows = client.table(EQUIPMENT_TABLE).select(
        "equipment_id,equipment_name,total_quantity,under_maintenance_count"
    ).order("equipment_name").execute().data or []

    if not headers:
        return {"event": event, "equipment_catalogue": equipment_rows, "requests": []}

    request_ids = [header["request_id"] for header in headers]
    item_rows = client.table(REQUEST_ITEM_TABLE).select(
        "request_id,equipment_id,requested_quantity,technical_requirements,updated_by,created_at,updated_at"
    ).in_("request_id", request_ids).order("request_id").order("equipment_id").execute().data or []

    equipment_map = {row["equipment_id"]: row["equipment_name"] for row in equipment_rows}

    user_ids = set()
    for header in headers:
        if header.get("created_by"):
            user_ids.add(header["created_by"])
        if header.get("updated_by"):
            user_ids.add(header["updated_by"])

    for item in item_rows:
        if item.get("updated_by"):
            user_ids.add(item["updated_by"])

    user_map = {}
    if user_ids:
        user_rows = client.table(USER_TABLE).select(
            "id,name"
        ).in_("id", list(user_ids)).execute().data or []
        user_map = {row["id"]: row["name"] for row in user_rows}

    response_requests = []

    for header in headers:
        request_items = []

        for item in item_rows:
            if item["request_id"] != header["request_id"]:
                continue

            request_items.append({
                "equipment_id": item["equipment_id"],
                "equipment_name": equipment_map.get(item["equipment_id"], item["equipment_id"]),
                "requested_quantity": item["requested_quantity"],
                "technical_requirements": item.get("technical_requirements") or "",
                "updated_by": item.get("updated_by"),
                "updated_by_name": user_map.get(item.get("updated_by")) if item.get("updated_by") else None,
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at") or item.get("created_at")
            })

        updated_by = header.get("updated_by")

        response_requests.append({
            "request_id": header["request_id"],
            "status": header.get("status", "Submitted"),
            "created_by": header.get("created_by"),
            "created_by_name": user_map.get(header.get("created_by")),
            "updated_by": updated_by,
            "updated_by_name": user_map.get(updated_by) if updated_by else None,
            "created_at": header.get("created_at"),
            "updated_at": header.get("updated_at") or header.get("created_at"),
            "latest_update_summary": header.get("latest_update_summary"),
            "items": request_items
        })

    return {
        "event": event,
        "equipment_catalogue": equipment_rows,
        "requests": response_requests
    }

@router.put("/{staff_id}/events/{event_id}/requests")
def update_event_equipment_requests(staff_id: str, event_id: int, payload: EventEquipmentUpdateInput):
    client = db()
    staff = require_technical_support(client, staff_id)
    event = get_event(client, event_id)

    if not payload.requests:
        raise HTTPException(status_code=400, detail="There are no equipment request changes to save.")

    availability_rows = calculate_availability(client, event)
    availability_map = {row["equipment_id"]: row for row in availability_rows}
    validated_requests = []

    # Validate everything before saving
    for request_update in payload.requests:
        request_header = get_request_header(client, request_update.request_id)

        if request_header["event_id"] != event_id:
            raise HTTPException(
                status_code=400,
                detail=f"Request #{request_update.request_id} does not belong to this event."
            )

        if not request_update.items:
            raise HTTPException(
                status_code=400,
                detail=f"Request #{request_update.request_id} must contain at least one item."
            )

        existing_items = client.table(REQUEST_ITEM_TABLE).select(
            "request_id,equipment_id,requested_quantity,technical_requirements"
        ).eq("request_id", request_update.request_id).execute().data or []

        existing_item_map = {row["equipment_id"]: row for row in existing_items}
        existing_equipment_ids = set(existing_item_map.keys())
        submitted_equipment_ids = [item.equipment_id.strip() for item in request_update.items]

        if len(submitted_equipment_ids) != len(set(submitted_equipment_ids)):
            raise HTTPException(
                status_code=400,
                detail=f"Request #{request_update.request_id} contains the same equipment type more than once."
            )

        submitted_equipment_set = set(submitted_equipment_ids)
        missing_existing = existing_equipment_ids - submitted_equipment_set

        if missing_existing:
            raise HTTPException(
                status_code=400,
                detail="Existing equipment cannot be removed from a Technical Support update. Set its quantity to 0 to cancel it."
            )

        for item in request_update.items:
            equipment_id = item.equipment_id.strip()
            equipment_info = availability_map.get(equipment_id)

            if not equipment_info:
                raise HTTPException(status_code=400, detail=f"Equipment {equipment_id} does not exist.")

            is_new = equipment_id not in existing_equipment_ids

            if is_new and item.requested_quantity == 0:
                raise HTTPException(
                    status_code=400,
                    detail="New equipment must have a quantity greater than 0."
                )

            if item.requested_quantity > 0:
                available = int(equipment_info["available_quantity"])
                if item.requested_quantity > available:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{equipment_info['equipment_name']} has only {available} available for this event."
                    )

        validated_requests.append({
            "update": request_update,
            "existing_equipment_ids": existing_equipment_ids,
            "existing_item_map": existing_item_map
        })

    now = datetime.now(timezone.utc).isoformat()
    updated_request_ids = []

    # Save validated changes
    for validated in validated_requests:
        request_update = validated["update"]
        existing_equipment_ids = validated["existing_equipment_ids"]
        existing_item_map = validated["existing_item_map"]
        latest_changes = []

        for item in request_update.items:
            equipment_id = item.equipment_id.strip()
            new_quantity = int(item.requested_quantity)
            new_requirements = item.technical_requirements.strip() if item.technical_requirements else ""
            equipment_info = availability_map.get(equipment_id, {})
            equipment_name = equipment_info.get("equipment_name") or equipment_id

            if equipment_id in existing_equipment_ids:
                old_item = existing_item_map[equipment_id]
                old_quantity = int(old_item.get("requested_quantity") or 0)
                old_requirements = (old_item.get("technical_requirements") or "").strip()

                # Quantity 0 = cancel and remove item
                if new_quantity == 0:
                    latest_changes.append(f"{equipment_name}: {old_quantity} → 0 (Cancelled)")
                    client.table(REQUEST_ITEM_TABLE).delete().eq(
                        "request_id", request_update.request_id
                    ).eq("equipment_id", equipment_id).execute()
                    continue

                quantity_changed = old_quantity != new_quantity
                requirements_changed = old_requirements != new_requirements

                if quantity_changed:
                    latest_changes.append(
                        f"{equipment_name} quantity: {old_quantity} → {new_quantity}"
                    )

                if requirements_changed:
                    old_display = old_requirements if old_requirements else "None"
                    new_display = new_requirements if new_requirements else "None"
                    latest_changes.append(
                        f'{equipment_name} requirements: "{old_display}" → "{new_display}"'
                    )

                if quantity_changed or requirements_changed:
                    client.table(REQUEST_ITEM_TABLE).update({
                        "requested_quantity": new_quantity,
                        "technical_requirements": new_requirements,
                        "updated_by": staff_id,
                        "updated_at": now
                    }).eq(
                        "request_id", request_update.request_id
                    ).eq("equipment_id", equipment_id).execute()

            else:
                latest_changes.append(f"{equipment_name}: Added × {new_quantity}")

                client.table(REQUEST_ITEM_TABLE).insert({
                    "request_id": request_update.request_id,
                    "equipment_id": equipment_id,
                    "requested_quantity": new_quantity,
                    "technical_requirements": new_requirements,
                    "updated_by": staff_id,
                    "updated_at": now
                }).execute()

        if not latest_changes:
            continue

        latest_update_summary = "\n".join(latest_changes)

        client.table(REQUEST_TABLE).update({
            "status": "Updated",
            "updated_by": staff_id,
            "updated_at": now,
            "latest_update_summary": latest_update_summary
        }).eq("request_id", request_update.request_id).execute()

        updated_request_ids.append(request_update.request_id)

    return {
        "message": "Equipment requests updated successfully.",
        "event_id": event_id,
        "updated_requests": updated_request_ids,
        "updated_by": staff_id,
        "updated_by_name": staff.get("name"),
        "updated_at": now
    }