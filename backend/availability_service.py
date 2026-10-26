from datetime import datetime

from fastapi import HTTPException
from supabase import Client

from equipment_constants import (
    EVENT_TABLE,
    EQUIPMENT_TABLE,
    REQUEST_TABLE,
    REQUEST_ITEM_TABLE,
    RESERVATION_TABLE,
    RESERVATION_ITEM_TABLE,
    USER_TABLE,
)


class AvailabilityService:
    """Handles equipment availability calculations."""

    def __init__(self, client: Client):
        self.client = client

    @staticmethod
    def event_datetimes(event: dict):
        event_date = event.get("event_date")
        start_time = event.get("start_time")
        end_time = event.get("end_time")

        if not event_date:
            raise HTTPException(
                status_code=400,
                detail="This event does not have an event date.",
            )

        if not start_time or not end_time:
            raise HTTPException(
                status_code=400,
                detail=(
                    "This event does not have a complete start and end time. "
                    "Equipment availability cannot be checked until the event time is set."
                ),
            )

        # A blank event_end_date means a single-day event.
        event_end_date = event.get("event_end_date") or event_date

        try:
            start_datetime = datetime.fromisoformat(
                f"{event_date}T{start_time}"
            )
            end_datetime = datetime.fromisoformat(
                f"{event_end_date}T{end_time}"
            )
        except ValueError as error:
            raise HTTPException(
                status_code=400,
                detail="The event has an invalid date or time.",
            ) from error

        if end_datetime <= start_datetime:
            raise HTTPException(
                status_code=400,
                detail="The event end time must be after the start time.",
            )

        return start_datetime, end_datetime

    def calculate_availability(self, event: dict):
        start_datetime, end_datetime = self.event_datetimes(event)

        equipment_rows = (
            self.client.table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,equipment_name,"
                "total_quantity,under_maintenance_count"
            )
            .order("equipment_name")
            .execute()
            .data or []
        )

        reserved_by_equipment = {}

        try:
            overlapping_items = (
                self.client.table(RESERVATION_ITEM_TABLE)
                .select(
                    "reservation_id,equipment_id,reserved_quantity,"
                    "start_datetime,end_datetime"
                )
                .lt(
                    "start_datetime",
                    end_datetime.isoformat(),
                )
                .gt(
                    "end_datetime",
                    start_datetime.isoformat(),
                )
                .execute()
                .data or []
            )

            reservation_ids = list({
                row["reservation_id"]
                for row in overlapping_items
            })

            active_reservation_ids = set()

            if reservation_ids:
                reservation_headers = (
                    self.client.table(RESERVATION_TABLE)
                    .select("reservation_id,status")
                    .in_(
                        "reservation_id",
                        reservation_ids,
                    )
                    .execute()
                    .data or []
                )

                active_reservation_ids = {
                    row["reservation_id"]
                    for row in reservation_headers
                    if str(
                        row.get("status", "")
                    ).strip().lower()
                    in {
                        "reserved",
                        "modified",
                        "needs recheck",
                    }
                }

            for row in overlapping_items:
                if (
                    row["reservation_id"]
                    not in active_reservation_ids
                ):
                    continue

                equipment_id = row["equipment_id"]

                reserved_by_equipment[equipment_id] = (
                    reserved_by_equipment.get(
                        equipment_id,
                        0,
                    )
                    + int(
                        row.get("reserved_quantity") or 0
                    )
                )

        except Exception:
            reserved_by_equipment = {}

        availability = []

        for equipment in equipment_rows:
            equipment_id = equipment["equipment_id"]

            total_quantity = int(
                equipment.get("total_quantity") or 0
            )

            maintenance_quantity = int(
                equipment.get("under_maintenance_count") or 0
            )

            reserved_quantity = reserved_by_equipment.get(
                equipment_id,
                0,
            )

            available_quantity = max(
                total_quantity
                - maintenance_quantity
                - reserved_quantity,
                0,
            )

            availability.append({
                "equipment_id": equipment_id,
                "equipment_name": equipment["equipment_name"],
                "total_quantity": total_quantity,
                "under_maintenance_count": maintenance_quantity,
                "reserved_quantity": reserved_quantity,
                "available_quantity": available_quantity,
            })

        return availability

    def calculate_request_edit_availability(
        self,
        event: dict,
        request_id: int,
    ):
        availability_rows = self.calculate_availability(
            event
        )

        reservations = (
            self.client.table(RESERVATION_TABLE)
            .select("reservation_id,status")
            .eq("request_id", request_id)
            .execute()
            .data or []
        )

        active_reservation_ids = {
            reservation["reservation_id"]
            for reservation in reservations
            if str(
                reservation.get("status", "")
            ).strip().lower()
            in {
                "reserved",
                "modified",
                "needs recheck",
            }
        }

        if not active_reservation_ids:
            return availability_rows

        reservation_items = (
            self.client.table(RESERVATION_ITEM_TABLE)
            .select(
                "reservation_id,equipment_id,"
                "reserved_quantity"
            )
            .in_(
                "reservation_id",
                list(active_reservation_ids),
            )
            .execute()
            .data or []
        )

        own_reserved_by_equipment = {}

        for item in reservation_items:
            equipment_id = item["equipment_id"]

            own_reserved_by_equipment[equipment_id] = (
                own_reserved_by_equipment.get(
                    equipment_id,
                    0,
                )
                + int(
                    item.get("reserved_quantity") or 0
                )
            )

        adjusted_rows = []

        for row in availability_rows:
            equipment_id = row["equipment_id"]

            own_reserved_quantity = (
                own_reserved_by_equipment.get(
                    equipment_id,
                    0,
                )
            )

            adjusted_rows.append({
                **row,
                "available_quantity": min(
                    int(
                        row.get("total_quantity") or 0
                    )
                    - int(
                        row.get(
                            "under_maintenance_count"
                        ) or 0
                    ),
                    int(
                        row.get(
                            "available_quantity"
                        ) or 0
                    )
                    + own_reserved_quantity,
                ),
            })

        return adjusted_rows

    def get_overlapping_reservations(
        self,
        event: dict,
    ):
        start_datetime, end_datetime = (
            self.event_datetimes(event)
        )

        try:
            reservation_items = (
                self.client.table(RESERVATION_ITEM_TABLE)
                .select(
                    "reservation_id,equipment_id,reserved_quantity,"
                    "start_datetime,end_datetime"
                )
                .lt(
                    "start_datetime",
                    end_datetime.isoformat(),
                )
                .gt(
                    "end_datetime",
                    start_datetime.isoformat(),
                )
                .execute()
                .data or []
            )
        except Exception:
            return {}

        if not reservation_items:
            return {}

        reservation_ids = list({
            row["reservation_id"]
            for row in reservation_items
        })

        try:
            reservation_headers = (
                self.client.table(RESERVATION_TABLE)
                .select(
                    "reservation_id,event_id,status"
                )
                .in_(
                    "reservation_id",
                    reservation_ids,
                )
                .execute()
                .data or []
            )
        except Exception:
            return {}

        active_reservations = {
            row["reservation_id"]: row
            for row in reservation_headers
            if str(
                row.get("status", "")
            ).strip().lower()
            != "cancelled"
        }

        reserved_by_equipment = {}

        for item in reservation_items:
            reservation = active_reservations.get(
                item["reservation_id"]
            )

            if not reservation:
                continue

            # Do not count reservations belonging to the
            # event whose availability is being checked.
            if (
                reservation.get("event_id")
                == event.get("id")
            ):
                continue

            equipment_id = item["equipment_id"]

            reserved_by_equipment[equipment_id] = (
                reserved_by_equipment.get(
                    equipment_id,
                    0,
                )
                + int(
                    item.get("reserved_quantity") or 0
                )
            )

        return reserved_by_equipment

    def calculate_event_availability(
        self,
        event: dict,
        request_items: list,
    ):
        equipment_ids = list({
            item["equipment_id"]
            for item in request_items
        })

        if not equipment_ids:
            return []

        equipment_rows = (
            self.client.table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,equipment_name,"
                "total_quantity,under_maintenance_count"
            )
            .in_(
                "equipment_id",
                equipment_ids,
            )
            .execute()
            .data or []
        )

        equipment_map = {
            row["equipment_id"]: row
            for row in equipment_rows
        }

        reserved_by_equipment = (
            self.get_overlapping_reservations(
                event
            )
        )

        results = []

        for item in request_items:
            equipment_id = item["equipment_id"]
            equipment = equipment_map.get(
                equipment_id
            )

            if not equipment:
                requested_quantity = int(
                    item.get("requested_quantity") or 0
                )

                results.append({
                    "equipment_id": equipment_id,
                    "equipment_name": equipment_id,
                    "requested_quantity":
                        requested_quantity,
                    "total_quantity": 0,
                    "under_maintenance_count": 0,
                    "reserved_quantity": 0,
                    "available_quantity": 0,
                    "shortage_quantity":
                        requested_quantity,
                    "availability_status":
                        "Unavailable",
                })

                continue

            requested_quantity = int(
                item.get("requested_quantity") or 0
            )

            total_quantity = int(
                equipment.get("total_quantity") or 0
            )

            maintenance_quantity = int(
                equipment.get(
                    "under_maintenance_count"
                ) or 0
            )

            reserved_quantity = (
                reserved_by_equipment.get(
                    equipment_id,
                    0,
                )
            )

            available_quantity = max(
                total_quantity
                - maintenance_quantity
                - reserved_quantity,
                0,
            )

            shortage_quantity = max(
                requested_quantity
                - available_quantity,
                0,
            )

            if (
                available_quantity
                >= requested_quantity
            ):
                status = "Available"
            elif available_quantity == 0:
                status = "Unavailable"
            else:
                status = "Insufficient"

            results.append({
                "equipment_id": equipment_id,
                "equipment_name":
                    equipment["equipment_name"],
                "requested_quantity":
                    requested_quantity,
                "total_quantity":
                    total_quantity,
                "under_maintenance_count":
                    maintenance_quantity,
                "reserved_quantity":
                    reserved_quantity,
                "available_quantity":
                    available_quantity,
                "shortage_quantity":
                    shortage_quantity,
                "availability_status":
                    status,
            })

        return results

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
                detail=(
                    "Technical Support Staff user "
                    "was not found."
                ),
            )

        user = rows[0]

        if (
            str(user.get("role", ""))
            .strip()
            .lower()
            != "technical support staff"
        ):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only Technical Support Staff can "
                    "check equipment availability."
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

    @staticmethod
    def live_requests(
        headers: list,
    ) -> list:
        """Drop requests replaced after an approved event change."""
        return [
            header
            for header in headers
            if str(
                header.get("status") or ""
            ).strip().lower()
            != "superseded"
        ]

    def get_availability_events(
        self,
        staff_id: str,
    ):
        self.require_technical_support(
            staff_id
        )

        request_headers = self.live_requests(
            self.client.table(REQUEST_TABLE)
            .select(
                "request_id,event_id,status"
            )
            .order(
                "request_id",
                desc=True,
            )
            .execute()
            .data or []
        )

        if not request_headers:
            return []

        event_ids = list({
            row["event_id"]
            for row in request_headers
        })

        event_rows = (
            self.client.table(EVENT_TABLE)
            .select(
                "id,event_name,event_date,"
                "start_time,end_time,status"
            )
            .in_(
                "id",
                event_ids,
            )
            .execute()
            .data or []
        )

        event_map = {
            row["id"]: row
            for row in event_rows
        }

        request_ids = [
            row["request_id"]
            for row in request_headers
        ]

        item_rows = (
            self.client.table(REQUEST_ITEM_TABLE)
            .select(
                "request_id,equipment_id,"
                "requested_quantity"
            )
            .in_(
                "request_id",
                request_ids,
            )
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
                .in_(
                    "equipment_id",
                    equipment_ids,
                )
                .execute()
                .data or []
            )

            equipment_map = {
                row["equipment_id"]:
                    row["equipment_name"]
                for row in equipment_rows
            }

        results = []

        for header in request_headers:
            event = event_map.get(
                header["event_id"]
            )

            if not event:
                continue

            request_items = [
                item
                for item in item_rows
                if (
                    item["request_id"]
                    == header["request_id"]
                    and int(
                        item.get(
                            "requested_quantity"
                        ) or 0
                    ) > 0
                )
            ]

            equipment_description = ", ".join(
                f'{equipment_map.get(item["equipment_id"], item["equipment_id"])} × {item["requested_quantity"]}'
                for item in request_items
            )

            results.append({
                "event_id":
                    event["id"],
                "event_name":
                    event.get("event_name"),
                "event_date":
                    event.get("event_date"),
                "start_time":
                    event.get("start_time"),
                "end_time":
                    event.get("end_time"),
                "request_id":
                    header["request_id"],
                "request_status":
                    header.get("status"),
                "requested_equipment_count":
                    len(request_items),
                "equipment_description":
                    equipment_description
                    or "No active equipment",
            })

        results.sort(
            key=lambda row:
                row.get("event_date") or ""
        )

        return results

    def get_event_availability(
        self,
        staff_id: str,
        event_id: int,
    ):
        self.require_technical_support(
            staff_id
        )

        event = self.get_event(
            event_id
        )

        request_headers = self.live_requests(
            self.client.table(REQUEST_TABLE)
            .select(
                "request_id,event_id,status"
            )
            .eq(
                "event_id",
                event_id,
            )
            .execute()
            .data or []
        )

        if not request_headers:
            raise HTTPException(
                status_code=404,
                detail=(
                    "This event does not have "
                    "an equipment request."
                ),
            )

        request = request_headers[0]

        request_items = (
            self.client.table(REQUEST_ITEM_TABLE)
            .select(
                "request_id,equipment_id,"
                "requested_quantity,"
                "technical_requirements"
            )
            .eq(
                "request_id",
                request["request_id"],
            )
            .execute()
            .data or []
        )

        request_items = [
            item
            for item in request_items
            if int(
                item.get(
                    "requested_quantity"
                ) or 0
            ) > 0
        ]

        availability = (
            self.calculate_event_availability(
                event,
                request_items,
            )
        )

        all_available = (
            bool(availability)
            and all(
                item["availability_status"]
                == "Available"
                for item in availability
            )
        )

        unavailable_count = sum(
            1
            for item in availability
            if (
                item["availability_status"]
                != "Available"
            )
        )

        return {
            "event": {
                "id":
                    event["id"],
                "event_name":
                    event.get("event_name"),
                "event_date":
                    event.get("event_date"),
                "start_time":
                    event.get("start_time"),
                "end_time":
                    event.get("end_time"),
                "status":
                    event.get("status"),
            },
            "request_id":
                request["request_id"],
            "request_status":
                request.get("status"),
            "all_equipment_available":
                all_available,
            "unavailable_equipment_count":
                unavailable_count,
            "availability":
                availability,
        }

    def get_event_catalogue_availability(
        self,
        staff_id: str,
        event_id: int,
    ):
        self.require_technical_support(
            staff_id
        )

        event = self.get_event(
            event_id
        )

        equipment_rows = (
            self.client.table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,equipment_name,"
                "total_quantity,"
                "under_maintenance_count"
            )
            .order("equipment_name")
            .execute()
            .data or []
        )

        reserved_by_equipment = (
            self.get_overlapping_reservations(
                event
            )
        )

        results = []

        for equipment in equipment_rows:
            equipment_id = (
                equipment["equipment_id"]
            )

            total_quantity = int(
                equipment.get(
                    "total_quantity"
                ) or 0
            )

            maintenance_quantity = int(
                equipment.get(
                    "under_maintenance_count"
                ) or 0
            )

            reserved_quantity = (
                reserved_by_equipment.get(
                    equipment_id,
                    0,
                )
            )

            available_quantity = max(
                total_quantity
                - maintenance_quantity
                - reserved_quantity,
                0,
            )

            results.append({
                "equipment_id":
                    equipment_id,
                "equipment_name":
                    equipment["equipment_name"],
                "total_quantity":
                    total_quantity,
                "under_maintenance_count":
                    maintenance_quantity,
                "reserved_quantity":
                    reserved_quantity,
                "available_quantity":
                    available_quantity,
            })

        return results