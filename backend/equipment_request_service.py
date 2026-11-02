from fastapi import HTTPException
from supabase import Client
from postgrest.exceptions import APIError
from datetime import datetime, timezone
import json

from availability_service import AvailabilityService
from equipment_constants import (
    EVENT_TABLE,
    EQUIPMENT_TABLE,
    REQUEST_TABLE,
    REQUEST_ITEM_TABLE,
    RESERVATION_TABLE,
    RESERVATION_ITEM_TABLE,
    USER_TABLE,
)


class EquipmentRequestService:
    """Handles the equipment request lifecycle for event coordinators."""

    def __init__(self, client: Client):
        self.client = client

    @staticmethod
    def parse_equipment_required(value):
        """Normalise Event Details.equipment_required into a list of names."""
        if not value:
            return []

        if isinstance(value, (list, tuple, set)):
            return [
                str(item).strip()
                for item in value
                if str(item).strip()
            ]

        if isinstance(value, str):
            value = value.strip()

            if not value:
                return []

            # JSON array format, e.g.
            # ["Laptop", "Video camera", "Extension cord"]
            try:
                parsed = json.loads(value)

                if isinstance(parsed, list):
                    return [
                        str(item).strip()
                        for item in parsed
                        if str(item).strip()
                    ]
            except json.JSONDecodeError:
                pass

            # PostgreSQL array format, e.g.
            # {Laptop,"Video camera","Extension cord"}
            if value.startswith("{") and value.endswith("}"):
                value = value[1:-1]

            return [
                item.strip().strip('"').strip("'")
                for item in value.split(",")
                if item.strip().strip('"').strip("'")
            ]

        return [str(value).strip()]

    def get_coordinator_event(
        self,
        coordinator_id: str,
        event_id: int,
    ):
        result = (
            self.client.table(EVENT_TABLE)
            .select("*")
            .eq("id", event_id)
            .eq("coordinator_id", coordinator_id)
            .execute()
        )

        rows = result.data or []

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Event not found or is not assigned "
                    "to this coordinator."
                ),
            )

        return rows[0]

    @staticmethod
    def validate_request_items(
        request_items,
        availability_rows,
        event=None,
    ):
        if not request_items:
            raise HTTPException(
                status_code=400,
                detail="At least one equipment item is required.",
            )

        equipment_ids = []

        for item in request_items:
            equipment_id = item.equipment_id.strip()

            if not equipment_id:
                raise HTTPException(
                    status_code=400,
                    detail="Equipment is required.",
                )

            equipment_ids.append(equipment_id)

        if len(equipment_ids) != len(set(equipment_ids)):
            raise HTTPException(
                status_code=400,
                detail="The same equipment type cannot be added twice.",
            )

        availability_map = {
            row["equipment_id"]: row
            for row in availability_rows
        }

        equipment_required = (
            EquipmentRequestService.parse_equipment_required(
                event.get("equipment_required")
            )
            if event
            else []
        )

        organiser_equipment = {
            str(item).strip().lower()
            for item in equipment_required
        }

        invalid_equipment = []

        requested_equipment = set()

        for item in request_items:
            equipment_id = item.equipment_id

            if equipment_id in availability_map:
                equipment_name = (
                    availability_map[equipment_id].get("equipment_name")
                    or equipment_id
                )

                normalised_name = equipment_name.strip().lower()
                requested_equipment.add(normalised_name)

                if (
                    event is not None
                    and normalised_name not in organiser_equipment
                ):
                    invalid_equipment.append(equipment_name)

        missing_equipment = [
            equipment_name
            for equipment_name in equipment_required
            if str(equipment_name).strip().lower() not in requested_equipment
        ]

        if invalid_equipment or missing_equipment:
            messages = []

            if invalid_equipment:
                messages.append(
                    f"{', '.join(invalid_equipment)} were not included in the "
                    "Event Organiser's equipment requirements. Remove these "
                    "equipment rows."
                )

            if missing_equipment:
                messages.append(
                    f"{', '.join(missing_equipment)} were required by the "
                    "Event Organiser but are missing from the equipment request. "
                    "Add these equipment rows."
                )

            raise HTTPException(
                status_code=400,
                detail=" ".join(messages),
            )

        for item in request_items:
            equipment_id = item.equipment_id.strip()

            if equipment_id not in availability_map:
                raise HTTPException(
                    status_code=400,
                    detail="Selected equipment does not exist.",
                )

            equipment = availability_map[equipment_id]
            equipment_name = equipment.get("equipment_name") or equipment_id

            available_quantity = int(
                equipment.get("available_quantity") or 0
            )

            if item.requested_quantity > available_quantity:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{equipment['equipment_name']} has only "
                        f"{available_quantity} available for this event."
                    ),
                )
    def create_request(
        self,
        coordinator_id: str,
        request,
    ):
        event = self.get_coordinator_event(
            coordinator_id,
            request.event_id,
        )

        if event.get("status") != "Planning":
            raise HTTPException(
                status_code=409,
                detail="Equipment requests can only be submitted for events in Planning status.",
            )

        existing = (
            self.client.table(REQUEST_TABLE)
            .select("request_id,status")
            .eq("event_id", request.event_id)
            .execute()
            .data or []
        )

        existing = self.live_requests(existing)

        if existing:
            raise HTTPException(
                status_code=409,
                detail=(
                    "An active equipment request already exists "
                    "for this event. Edit the existing request instead."
                ),
            )

        availability_service = AvailabilityService(self.client)

        availability_rows = (
            availability_service.calculate_availability(event)
        )

        self.validate_request_items(
            request.items,
            availability_rows,
            event,
        )

        items = [
            {
                "equipment_id": item.equipment_id.strip(),
                "requested_quantity": item.requested_quantity,
                "technical_requirements": (
                    item.technical_requirements or ""
                ).strip(),
            }
            for item in request.items
        ]

        try:
            saved = self.client.rpc(
                "submit_equipment_request",
                {
                    "p_event_id": request.event_id,
                    "p_coordinator_id": coordinator_id,
                    "p_items": items,
                },
            ).execute().data

        except APIError as error:
            if error.code == "23505":
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "An equipment request has already been "
                        "submitted for this event."
                    ),
                ) from error

            raise HTTPException(
                status_code=500,
                detail="Equipment request could not be created.",
            ) from error

        if not saved:
            raise HTTPException(
                status_code=500,
                detail="Equipment request could not be created.",
            )

        return {
            "message": "Equipment request submitted successfully.",
            **saved,
        }

    @staticmethod
    def live_requests(headers: list) -> list:
        """Return only current active equipment requests."""
        inactive_statuses = {
            "superseded",
            "cancelled",
            "rejected",
        }

        return [
            header
            for header in headers
            if str(
                header.get("status") or ""
            ).strip().lower() not in inactive_statuses
        ]

    @staticmethod
    def require_live_request(header: dict):
        if not EquipmentRequestService.live_requests([header]):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Equipment request #{header['request_id']} was "
                    "replaced by a newer request after an approved "
                    "event change."
                ),
            )

    def mark_reservation_for_recheck(
        self,
        request_id: int,
        now: str,
    ):
        reservations = (
            self.client.table(RESERVATION_TABLE)
            .select("reservation_id,status")
            .eq("request_id", request_id)
            .execute()
            .data or []
        )

        for reservation in reservations:
            status = str(
                reservation.get("status", "")
            ).strip().lower()

            if status not in {"reserved", "modified"}:
                continue

            (
                self.client.table(RESERVATION_TABLE)
                .update({
                    "status": "Needs Recheck",
                    "updated_at": now,
                })
                .eq(
                    "reservation_id",
                    reservation["reservation_id"],
                )
                .execute()
            )

    def edit_request(
        self,
        coordinator_id: str,
        request_id: int,
        payload,
    ):
        header_rows = (
            self.client.table(REQUEST_TABLE)
            .select("request_id,event_id,created_by,status")
            .eq("request_id", request_id)
            .eq("created_by", coordinator_id)
            .execute()
            .data or []
        )

        if not header_rows:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Equipment request not found or does not belong "
                    "to this coordinator."
                ),
            )

        header = header_rows[0]

        self.require_live_request(header)

        event = self.get_coordinator_event(
            coordinator_id,
            header["event_id"],
        )

        availability_service = AvailabilityService(self.client)

        availability_rows = (
            availability_service.calculate_availability(event)
        )

        self.validate_request_items(
            payload.items,
            availability_rows,
            event,
        )

        existing_items = (
            self.client.table(REQUEST_ITEM_TABLE)
            .select(
                "request_id,equipment_id,requested_quantity,"
                "technical_requirements"
            )
            .eq("request_id", request_id)
            .execute()
            .data or []
        )

        existing_map = {
            row["equipment_id"]: {
                "requested_quantity": int(
                    row.get("requested_quantity") or 0
                ),
                "technical_requirements": (
                    row.get("technical_requirements") or ""
                ).strip(),
            }
            for row in existing_items
        }

        existing_equipment_ids = set(existing_map)

        submitted_equipment_ids = {
            item.equipment_id.strip()
            for item in payload.items
        }

        now = datetime.now(timezone.utc).isoformat()

        reservation_recheck_required = (
            existing_equipment_ids
            != submitted_equipment_ids
        )

        if not reservation_recheck_required:
            for item in payload.items:
                equipment_id = item.equipment_id.strip()
                existing = existing_map[equipment_id]

                if (
                    existing["requested_quantity"]
                    != item.requested_quantity
                ):
                    reservation_recheck_required = True
                    break

        removed_equipment_ids = (
            existing_equipment_ids
            - submitted_equipment_ids
        )

        for equipment_id in removed_equipment_ids:
            (
                self.client.table(REQUEST_ITEM_TABLE)
                .delete()
                .eq("request_id", request_id)
                .eq("equipment_id", equipment_id)
                .execute()
            )

        for item in payload.items:
            equipment_id = item.equipment_id.strip()

            item_data = {
                "requested_quantity": item.requested_quantity,
                "technical_requirements": (
                    item.technical_requirements.strip()
                    if item.technical_requirements
                    else ""
                ),
                "updated_at": now,
            }

            if equipment_id in existing_equipment_ids:
                (
                    self.client.table(REQUEST_ITEM_TABLE)
                    .update(item_data)
                    .eq("request_id", request_id)
                    .eq("equipment_id", equipment_id)
                    .execute()
                )
            else:
                self.client.table(REQUEST_ITEM_TABLE).insert({
                    "request_id": request_id,
                    "equipment_id": equipment_id,
                    **item_data,
                }).execute()

        (
            self.client.table(REQUEST_TABLE)
            .update({
                "status": "Submitted",
                "updated_by": None,
                "updated_at": now,
                "latest_update_summary": None,
            })
            .eq("request_id", request_id)
            .execute()
        )

        if reservation_recheck_required:
            self.mark_reservation_for_recheck(
                request_id,
                now,
            )

        return {
            "message": "Equipment request updated successfully.",
            "request_id": request_id,
            "event_id": header["event_id"],
            "reservation_recheck_required": reservation_recheck_required,
        }

    def get_requests(self, coordinator_id: str):
        headers = (
            self.client.table(REQUEST_TABLE)
            .select(
                "request_id,event_id,status,created_by,updated_by,"
                "created_at,updated_at,latest_update_summary"
            )
            .eq("created_by", coordinator_id)
            .order("request_id", desc=True)
            .execute()
            .data or []
        )

        headers = self.live_requests(headers)

        if not headers:
            return []

        event_ids = list({
            row["event_id"]
            for row in headers
        })

        event_rows = (
            self.client.table(EVENT_TABLE)
            .select(
                "id,event_name,event_date,event_end_date,start_time,end_time"
            )
            .in_("id", event_ids)
            .execute()
            .data or []
        )

        event_map = {
            row["id"]: row
            for row in event_rows
        }

        request_ids = [
            row["request_id"]
            for row in headers
        ]

        item_rows = (
            self.client.table(REQUEST_ITEM_TABLE)
            .select(
                "request_id,equipment_id,requested_quantity,"
                "technical_requirements,updated_by,"
                "created_at,updated_at"
            )
            .in_("request_id", request_ids)
            .order("request_id")
            .order("equipment_id")
            .execute()
            .data or []
        )

        equipment_ids = list({
            row["equipment_id"]
            for row in item_rows
        })

        equipment_map = {}

        if equipment_ids:
            equipment_rows = (
                self.client.table(EQUIPMENT_TABLE)
                .select("equipment_id,equipment_name")
                .in_("equipment_id", equipment_ids)
                .execute()
                .data or []
            )

            equipment_map = {
                row["equipment_id"]: row["equipment_name"]
                for row in equipment_rows
            }

        updater_ids = set()

        for header in headers:
            if header.get("updated_by"):
                updater_ids.add(header["updated_by"])

        for item in item_rows:
            if item.get("updated_by"):
                updater_ids.add(item["updated_by"])

        user_map = {}

        if updater_ids:
            user_rows = (
                self.client.table(USER_TABLE)
                .select("id,name")
                .in_("id", list(updater_ids))
                .execute()
                .data or []
            )

            user_map = {
                row["id"]: row["name"]
                for row in user_rows
            }

        results = []

        for header in headers:
            event = event_map.get(
                header["event_id"],
                {},
            )

            request_items = []

            for item in item_rows:
                if item["request_id"] != header["request_id"]:
                    continue

                item_updated_by = item.get("updated_by")

                request_items.append({
                    "equipment_id": item["equipment_id"],
                    "equipment_name": equipment_map.get(
                        item["equipment_id"],
                        item["equipment_id"],
                    ),
                    "requested_quantity": (
                        item["requested_quantity"]
                    ),
                    "technical_requirements": (
                        item.get("technical_requirements") or ""
                    ),
                    "updated_by": item_updated_by,
                    "updated_by_name": (
                        user_map.get(item_updated_by)
                        if item_updated_by
                        else None
                    ),
                    "created_at": item.get("created_at"),
                    "updated_at": (
                        item.get("updated_at")
                        or item.get("created_at")
                    ),
                })

            header_updated_by = header.get("updated_by")

            results.append({
                "request_id": header["request_id"],
                "event_id": header["event_id"],
                "event_name": event.get(
                    "event_name",
                    "Unknown event",
                ),
                "event_date": event.get(
                    "event_date",
                    "",
                ),
                "event_end_date": event.get(
                    "event_end_date",
                    "",
                ),
                "start_time": event.get("start_time"),
                "end_time": event.get("end_time"),
                "status": header.get(
                    "status",
                    "Submitted",
                ),
                "created_by": header.get("created_by"),
                "created_at": header.get("created_at"),
                "updated_by": header_updated_by,
                "updated_by_name": (
                    user_map.get(header_updated_by)
                    if header_updated_by
                    else None
                ),
                "updated_at": (
                    header.get("updated_at")
                    or header.get("created_at")
                ),
                "latest_update_summary": (
                    header.get("latest_update_summary") or ""
                ),
                "items": request_items,
            })

        return results

    def get_available_events(
        self,
        coordinator_id: str,
    ):
        assigned_events = (
            self.client.table(EVENT_TABLE)
            .select("*")
            .eq("coordinator_id", coordinator_id)
            .eq("status", "Planning")
            .order("event_date")
            .execute()
            .data or []
        )

        if not assigned_events:
            return []

        event_ids = [
            event["id"]
            for event in assigned_events
        ]

        existing_requests = (
            self.client.table(REQUEST_TABLE)
            .select("event_id,status")
            .in_("event_id", event_ids)
            .execute()
            .data or []
        )

        existing_requests = self.live_requests(
            existing_requests
        )

        requested_event_ids = {
            row["event_id"]
            for row in existing_requests
        }

        return [
            event
            for event in assigned_events
            if event["id"] not in requested_event_ids
        ]

    def get_equipment_catalogue(self):
        result = (
            self.client.table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,equipment_name,total_quantity,"
                "under_maintenance_count"
            )
            .order("equipment_name")
            .execute()
        )

        return result.data or []

    def get_event_availability(
        self,
        coordinator_id: str,
        event_id: int,
    ):
        event = self.get_coordinator_event(
            coordinator_id,
            event_id,
        )

        availability_service = AvailabilityService(
            self.client
        )

        return availability_service.calculate_availability(
            event
        )

    def require_technical_support(
        self,
        staff_id: str,
    ):
        rows = (
            self.client.table(USER_TABLE)
            .select("id,name,role,email")
            .eq("id", staff_id)
            .execute()
            .data or []
        )

        if not rows:
            raise HTTPException(
                status_code=404,
                detail="Technical Support Staff user was not found.",
            )

        user = rows[0]

        role = str(
            user.get("role", "")
        ).strip().lower()

        if role != "technical support staff":
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only Technical Support Staff can access "
                    "equipment updates."
                ),
            )

        return user

    def get_event(
        self,
        event_id: int,
    ):
        rows = (
            self.client.table(EVENT_TABLE)
            .select("*")
            .eq("id", event_id)
            .execute()
            .data or []
        )

        if not rows:
            raise HTTPException(
                status_code=404,
                detail="Event was not found.",
            )

        return rows[0]

    def get_request_header(
        self,
        request_id: int,
    ):
        rows = (
            self.client.table(REQUEST_TABLE)
            .select("*")
            .eq("request_id", request_id)
            .execute()
            .data or []
        )

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Equipment request #{request_id} "
                    "was not found."
                ),
            )

        return rows[0]

    def get_request_summary(
        self,
        staff_id: str,
    ):
        self.require_technical_support(staff_id)

        headers = self.live_requests(
            self.client.table(REQUEST_TABLE)
            .select(
                "request_id,event_id,status,"
                "created_at,updated_at"
            )
            .order("created_at", desc=True)
            .execute()
            .data or []
        )

        if not headers:
            return []

        event_ids = list({
            row["event_id"]
            for row in headers
        })

        event_rows = (
            self.client.table(EVENT_TABLE)
            .select(
                "id,event_name,event_date,event_end_date,"
                "start_time,end_time"
            )
            .in_("id", event_ids)
            .execute()
            .data or []
        )

        event_map = {
            row["id"]: row
            for row in event_rows
        }

        request_ids = [
            row["request_id"]
            for row in headers
        ]

        item_rows = (
            self.client.table(REQUEST_ITEM_TABLE)
            .select(
                "request_id,equipment_id,"
                "requested_quantity"
            )
            .in_("request_id", request_ids)
            .execute()
            .data or []
        )

        equipment_ids = list({
            row["equipment_id"]
            for row in item_rows
        })

        equipment_map = {}

        if equipment_ids:
            equipment_rows = (
                self.client.table(EQUIPMENT_TABLE)
                .select(
                    "equipment_id,equipment_name"
                )
                .in_("equipment_id", equipment_ids)
                .execute()
                .data or []
            )

            equipment_map = {
                row["equipment_id"]: row["equipment_name"]
                for row in equipment_rows
            }

        results = []

        for header in headers:
            event = event_map.get(
                header["event_id"],
                {},
            )

            descriptions = []

            for item in item_rows:
                if (
                    item["request_id"]
                    != header["request_id"]
                ):
                    continue

                quantity = int(
                    item.get("requested_quantity") or 0
                )

                if quantity <= 0:
                    continue

                name = equipment_map.get(
                    item["equipment_id"],
                    item["equipment_id"],
                )

                descriptions.append(
                    f"{name} × {quantity}"
                )

            results.append({
                "event_id": header["event_id"],
                "event_name": event.get(
                    "event_name",
                    "Unknown event",
                ),
                "event_date": event.get("event_date"),
                "start_time": event.get("start_time"),
                "event_end_date": event.get("event_end_date"),
                "end_time": event.get("end_time"),
                "request_id": header["request_id"],
                "request_count": 1,
                "equipment_description": (
                    ", ".join(descriptions)
                    if descriptions
                    else "No active equipment"
                ),
                "status": header.get(
                    "status",
                    "Submitted",
                ),
            })

        results.sort(
            key=lambda row: row.get("event_date") or ""
        )

        return results

    def get_event_requests(
        self,
        staff_id: str,
        event_id: int,
    ):
        self.require_technical_support(staff_id)

        event = self.get_event(event_id)

        headers = self.live_requests(
            self.client.table(REQUEST_TABLE)
            .select(
                "request_id,event_id,status,created_by,"
                "updated_by,created_at,updated_at,"
                "latest_update_summary"
            )
            .eq("event_id", event_id)
            .order("request_id")
            .execute()
            .data or []
        )

        equipment_rows = (
            self.client.table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,equipment_name,total_quantity,"
                "under_maintenance_count"
            )
            .order("equipment_name")
            .execute()
            .data or []
        )

        if not headers:
            return {
                "event": event,
                "equipment_catalogue": equipment_rows,
                "requests": [],
            }

        request_ids = [
            header["request_id"]
            for header in headers
        ]

        item_rows = (
            self.client.table(REQUEST_ITEM_TABLE)
            .select(
                "request_id,equipment_id,requested_quantity,"
                "technical_requirements,updated_by,"
                "created_at,updated_at"
            )
            .in_("request_id", request_ids)
            .order("request_id")
            .order("equipment_id")
            .execute()
            .data or []
        )

        equipment_map = {
            row["equipment_id"]: row["equipment_name"]
            for row in equipment_rows
        }

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
            user_rows = (
                self.client.table(USER_TABLE)
                .select("id,name")
                .in_("id", list(user_ids))
                .execute()
                .data or []
            )

            user_map = {
                row["id"]: row["name"]
                for row in user_rows
            }

        response_requests = []

        for header in headers:
            request_items = []

            for item in item_rows:
                if (
                    item["request_id"]
                    != header["request_id"]
                ):
                    continue

                item_updated_by = item.get("updated_by")

                request_items.append({
                    "equipment_id": item["equipment_id"],
                    "equipment_name": equipment_map.get(
                        item["equipment_id"],
                        item["equipment_id"],
                    ),
                    "requested_quantity": (
                        item["requested_quantity"]
                    ),
                    "technical_requirements": (
                        item.get("technical_requirements")
                        or ""
                    ),
                    "updated_by": item_updated_by,
                    "updated_by_name": (
                        user_map.get(item_updated_by)
                        if item_updated_by
                        else None
                    ),
                    "created_at": item.get("created_at"),
                    "updated_at": (
                        item.get("updated_at")
                        or item.get("created_at")
                    ),
                })

            updated_by = header.get("updated_by")

            availability_service = AvailabilityService(self.client)
            request_availability = (
                availability_service.calculate_request_edit_availability(
                    event,
                    header["request_id"],
                )
            )

            response_requests.append({
                "request_id": header["request_id"],
                "availability": request_availability,
                "status": header.get(
                    "status",
                    "Submitted",
                ),
                "created_by": header.get("created_by"),
                "created_by_name": user_map.get(
                    header.get("created_by")
                ),
                "updated_by": updated_by,
                "updated_by_name": (
                    user_map.get(updated_by)
                    if updated_by
                    else None
                ),
                "created_at": header.get("created_at"),
                "updated_at": (
                    header.get("updated_at")
                    or header.get("created_at")
                ),
                "latest_update_summary": header.get(
                    "latest_update_summary"
                ),
                "items": request_items,
            })

        return {
            "event": event,
            "equipment_catalogue": equipment_rows,
            "requests": response_requests,
        }

    def update_event_requests(
        self,
        staff_id: str,
        event_id: int,
        payload,
    ):
        staff = self.require_technical_support(staff_id)
        event = self.get_event(event_id)

        equipment_required = self.parse_equipment_required(
            event.get("equipment_required")
        )

        organiser_equipment = {
            str(item).strip().lower()
            for item in equipment_required
        }

        if not payload.requests:
            raise HTTPException(
                status_code=400,
                detail=(
                    "There are no equipment request "
                    "changes to save."
                ),
            )

        validated_requests = []

        # Validate all changed requests before writing anything.
        for request_update in payload.requests:
            request_header = self.get_request_header(
                request_update.request_id
            )

            self.require_live_request(request_header)

            if request_header["event_id"] != event_id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Request #{request_update.request_id} "
                        "does not belong to this event."
                    ),
                )

            if not request_update.items:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Request #{request_update.request_id} "
                        "must contain at least one item."
                    ),
                )

            # Exclude this request's own active reservation
            # from availability validation. Reservations
            # belonging to other overlapping events still
            # reduce availability.
            availability_service = AvailabilityService(
                self.client
            )

            availability_rows = (
                availability_service
                .calculate_request_edit_availability(
                    event,
                    request_update.request_id,
                )
            )

            availability_map = {
                row["equipment_id"]: row
                for row in availability_rows
            }

            existing_items = (
                self.client.table(REQUEST_ITEM_TABLE)
                .select(
                    "request_id,equipment_id,"
                    "requested_quantity,"
                    "technical_requirements"
                )
                .eq(
                    "request_id",
                    request_update.request_id,
                )
                .execute()
                .data or []
            )

            existing_item_map = {
                row["equipment_id"]: row
                for row in existing_items
            }

            existing_equipment_ids = set(
                existing_item_map.keys()
            )

            submitted_equipment_ids = [
                item.equipment_id.strip()
                for item in request_update.items
            ]

            if (
                len(submitted_equipment_ids)
                != len(set(submitted_equipment_ids))
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Request #{request_update.request_id} "
                        "contains the same equipment type "
                        "more than once."
                    ),
                )

            submitted_equipment_set = set(
                submitted_equipment_ids
            )

            invalid_equipment = []
            final_requested_equipment = set()

            for item in request_update.items:
                equipment_id = item.equipment_id.strip()
                equipment_info = availability_map.get(equipment_id)

                if not equipment_info:
                    continue

                equipment_name = (
                    equipment_info.get("equipment_name")
                    or equipment_id
                )
                normalised_name = equipment_name.strip().lower()

                if item.requested_quantity > 0:
                    final_requested_equipment.add(normalised_name)

                    if normalised_name not in organiser_equipment:
                        invalid_equipment.append(equipment_name)

            missing_equipment = [
                equipment_name
                for equipment_name in equipment_required
                if str(equipment_name).strip().lower()
                not in final_requested_equipment
            ]

            if invalid_equipment or missing_equipment:
                messages = []

                if invalid_equipment:
                    messages.append(
                        f"{', '.join(invalid_equipment)} were not included in the "
                        "Event Organiser's equipment requirements. Remove these "
                        "equipment rows."
                    )

                if missing_equipment:
                    messages.append(
                        f"{', '.join(missing_equipment)} were required by the "
                        "Event Organiser but are missing from the final equipment "
                        "request. Add these equipment rows with a quantity greater "
                        "than 0."
                    )

                raise HTTPException(
                    status_code=400,
                    detail=" ".join(messages),
                )

            # Technical Support may change quantity and
            # technical requirements, but may not add or remove
            # equipment types from the Coordinator's request.
            if submitted_equipment_set != existing_equipment_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Technical Support cannot add or remove "
                        "equipment types. Only the quantity and "
                        "technical requirements may be changed."
                    ),
                )

            for item in request_update.items:
                equipment_id = item.equipment_id.strip()

                equipment_info = availability_map.get(
                    equipment_id
                )

                if not equipment_info:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Equipment {equipment_id} "
                            "does not exist."
                        ),
                    )

                if item.requested_quantity < 1:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Equipment quantity must be a whole "
                            "number greater than 0."
                        ),
                    )

                available = int(
                    equipment_info[
                        "available_quantity"
                    ]
                )

                if (
                    item.requested_quantity
                    > available
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"{equipment_info['equipment_name']} "
                            f"has only {available} available "
                            "for this event."
                        ),
                    )

            validated_requests.append({
                "update": request_update,
                "existing_equipment_ids": (
                    existing_equipment_ids
                ),
                "existing_item_map": existing_item_map,
                "availability_map": availability_map,
            })

        now = datetime.now(
            timezone.utc
        ).isoformat()

        updated_request_ids = []

        for validated in validated_requests:
            request_update = validated["update"]

            existing_equipment_ids = validated[
                "existing_equipment_ids"
            ]

            existing_item_map = validated[
                "existing_item_map"
            ]

            availability_map = validated[
                "availability_map"
            ]

            latest_changes = []
            quantity_changed_any = False

            for item in request_update.items:
                equipment_id = item.equipment_id.strip()

                new_quantity = int(
                    item.requested_quantity
                )

                new_requirements = (
                    item.technical_requirements.strip()
                    if item.technical_requirements
                    else ""
                )

                equipment_info = availability_map.get(
                    equipment_id,
                    {},
                )

                equipment_name = (
                    equipment_info.get("equipment_name")
                    or equipment_id
                )

                old_item = existing_item_map[
                    equipment_id
                ]

                old_quantity = int(
                    old_item.get("requested_quantity")
                    or 0
                )

                old_requirements = (
                    old_item.get(
                        "technical_requirements"
                    )
                    or ""
                ).strip()

                quantity_changed = (
                    old_quantity != new_quantity
                )

                requirements_changed = (
                    old_requirements
                    != new_requirements
                )

                if quantity_changed:
                    quantity_changed_any = True
                    latest_changes.append(
                        f"{equipment_name} quantity: "
                        f"{old_quantity} → {new_quantity}"
                    )

                if requirements_changed:
                    old_display = (
                        old_requirements
                        if old_requirements
                        else "None"
                    )

                    new_display = (
                        new_requirements
                        if new_requirements
                        else "None"
                    )

                    latest_changes.append(
                        f'{equipment_name} requirements: '
                        f'"{old_display}" → '
                        f'"{new_display}"'
                    )

                if (
                    quantity_changed
                    or requirements_changed
                ):
                    (
                        self.client
                        .table(REQUEST_ITEM_TABLE)
                        .update({
                            "requested_quantity": (
                                new_quantity
                            ),
                            "technical_requirements": (
                                new_requirements
                            ),
                            "updated_by": staff_id,
                            "updated_at": now,
                        })
                        .eq(
                            "request_id",
                            request_update.request_id,
                        )
                        .eq(
                            "equipment_id",
                            equipment_id,
                        )
                        .execute()
                    )

            # Frontend should only send changed requests.
            if not latest_changes:
                continue

            latest_update_summary = "\n".join(
                latest_changes
            )

            (
                self.client
                .table(REQUEST_TABLE)
                .update({
                    "status": "Updated",
                    "updated_by": staff_id,
                    "updated_at": now,
                    "latest_update_summary": (
                        latest_update_summary
                    ),
                })
                .eq(
                    "request_id",
                    request_update.request_id,
                )
                .execute()
            )

            # A TSS quantity change immediately updates the
            # event's active reservation to the same quantity.
            # Technical-requirement-only changes do not affect
            # the reservation.
            if quantity_changed_any:
                reservations = (
                    self.client.table(RESERVATION_TABLE)
                    .select("*")
                    .eq("event_id", event_id)
                    .neq("status", "Cancelled")
                    .order("reservation_id", desc=True)
                    .execute()
                    .data or []
                )

                if reservations:
                    reservation = reservations[0]
                    reservation_id = reservation[
                        "reservation_id"
                    ]

                    start_datetime = datetime.fromisoformat(
                        f"{event['event_date']}T{event['start_time']}"
                    )
                    event_end_date = (
                        event.get("event_end_date")
                        or event["event_date"]
                    )
                    end_datetime = datetime.fromisoformat(
                        f"{event_end_date}T{event['end_time']}"
                    )

                    current_reservation_items = (
                        self.client
                        .table(RESERVATION_ITEM_TABLE)
                        .select("*")
                        .eq(
                            "reservation_id",
                            reservation_id,
                        )
                        .execute()
                        .data or []
                    )

                    current_reservation_map = {
                        row["equipment_id"]: row
                        for row in current_reservation_items
                    }

                    request_equipment_ids = {
                        item.equipment_id.strip()
                        for item in request_update.items
                    }

                    for row in current_reservation_items:
                        if (
                            row["equipment_id"]
                            not in request_equipment_ids
                        ):
                            (
                                self.client
                                .table(RESERVATION_ITEM_TABLE)
                                .delete()
                                .eq(
                                    "reservation_item_id",
                                    row["reservation_item_id"],
                                )
                                .execute()
                            )

                    for item in request_update.items:
                        equipment_id = item.equipment_id.strip()
                        existing_reservation_item = (
                            current_reservation_map.get(
                                equipment_id
                            )
                        )

                        item_data = {
                            "reserved_quantity":
                                int(item.requested_quantity),
                            "start_datetime":
                                start_datetime.isoformat(),
                            "end_datetime":
                                end_datetime.isoformat(),
                            "updated_at": now,
                        }

                        if existing_reservation_item:
                            (
                                self.client
                                .table(RESERVATION_ITEM_TABLE)
                                .update(item_data)
                                .eq(
                                    "reservation_item_id",
                                    existing_reservation_item[
                                        "reservation_item_id"
                                    ],
                                )
                                .execute()
                            )
                        else:
                            (
                                self.client
                                .table(RESERVATION_ITEM_TABLE)
                                .insert({
                                    "reservation_id":
                                        reservation_id,
                                    "equipment_id":
                                        equipment_id,
                                    **item_data,
                                })
                                .execute()
                            )

                    (
                        self.client
                        .table(RESERVATION_TABLE)
                        .update({
                            "request_id":
                                request_update.request_id,
                            "status": "Reserved",
                            "updated_at": now,
                        })
                        .eq(
                            "reservation_id",
                            reservation_id,
                        )
                        .execute()
                    )

            updated_request_ids.append(
                request_update.request_id
            )

        return {
            "message": (
                "Equipment requests updated successfully."
            ),
            "event_id": event_id,
            "updated_requests": updated_request_ids,
            "updated_by": staff_id,
            "updated_by_name": staff.get("name"),
            "updated_at": now,
        }