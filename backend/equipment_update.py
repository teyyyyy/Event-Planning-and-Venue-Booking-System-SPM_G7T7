from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from equipment_request import (
    db,
    calculate_availability,
    EVENT_TABLE,
    EQUIPMENT_TABLE,
    REQUEST_TABLE,
    REQUEST_ITEM_TABLE,
)


USER_TABLE = "users"


router = APIRouter(
    prefix="/api/equipment-update",
    tags=["Equipment Update"]
)


# ================================================================
# Models
# ================================================================

class EquipmentUpdateItemInput(BaseModel):

    # Existing item:
    #   request_item_id contains its database ID.
    #
    # Newly added item:
    #   request_item_id is None.
    request_item_id: Optional[int] = None

    equipment_id: str = Field(
        min_length=1
    )

    requested_quantity: int = Field(
        ge=0
    )

    technical_requirements: str = ""


class EquipmentRequestUpdateInput(BaseModel):

    request_id: int

    items: List[
        EquipmentUpdateItemInput
    ]


class EventEquipmentUpdateInput(BaseModel):

    requests: List[
        EquipmentRequestUpdateInput
    ]


# ================================================================
# Helpers
# ================================================================

def require_technical_support(
    client,
    staff_id: str
):

    result = (
        client
        .table(USER_TABLE)
        .select(
            "id,"
            "name,"
            "role,"
            "email"
        )
        .eq(
            "id",
            staff_id
        )
        .execute()
    )

    rows = result.data or []

    if not rows:

        raise HTTPException(
            status_code=404,
            detail=(
                "Technical Support Staff "
                "user was not found."
            )
        )


    user = rows[0]


    role = str(
        user.get(
            "role",
            ""
        )
    ).strip().lower()


    if role != "technical support staff":

        raise HTTPException(
            status_code=403,
            detail=(
                "Only Technical Support Staff "
                "can access equipment updates."
            )
        )


    return user


def get_event(
    client,
    event_id: int
):

    result = (
        client
        .table(EVENT_TABLE)
        .select("*")
        .eq(
            "id",
            event_id
        )
        .execute()
    )

    rows = result.data or []

    if not rows:

        raise HTTPException(
            status_code=404,
            detail="Event was not found."
        )

    return rows[0]


def get_request_header(
    client,
    request_id: int
):

    result = (
        client
        .table(REQUEST_TABLE)
        .select("*")
        .eq(
            "request_id",
            request_id
        )
        .execute()
    )

    rows = result.data or []

    if not rows:

        raise HTTPException(
            status_code=404,
            detail=(
                f"Equipment request #{request_id} "
                "was not found."
            )
        )

    return rows[0]


# ================================================================
# GET SUMMARY
# One row per event
# ================================================================

@router.get(
    "/{staff_id}/requests/summary"
)
def equipment_request_summary(
    staff_id: str
):

    client = db()

    require_technical_support(
        client,
        staff_id
    )


    headers = (
        client
        .table(REQUEST_TABLE)
        .select(
            "request_id,"
            "event_id,"
            "status,"
            "created_at,"
            "updated_at"
        )
        .order(
            "created_at",
            desc=True
        )
        .execute()
        .data
        or []
    )


    if not headers:
        return []


    # ------------------------------------------------------------
    # Events
    # ------------------------------------------------------------

    event_ids = list({
        row["event_id"]
        for row in headers
    })


    event_rows = (
        client
        .table(EVENT_TABLE)
        .select(
            "id,"
            "event_name,"
            "event_date,"
            "start_time,"
            "end_time"
        )
        .in_(
            "id",
            event_ids
        )
        .execute()
        .data
        or []
    )


    event_map = {
        row["id"]: row
        for row in event_rows
    }


    # ------------------------------------------------------------
    # Request items
    # ------------------------------------------------------------

    request_ids = [
        row["request_id"]
        for row in headers
    ]


    item_rows = (
        client
        .table(REQUEST_ITEM_TABLE)
        .select(
            "request_id,"
            "equipment_id,"
            "requested_quantity"
        )
        .in_(
            "request_id",
            request_ids
        )
        .execute()
        .data
        or []
    )


    # ------------------------------------------------------------
    # Equipment names
    # ------------------------------------------------------------

    equipment_ids = list({
        row["equipment_id"]
        for row in item_rows
    })


    equipment_map = {}


    if equipment_ids:

        equipment_rows = (
            client
            .table(EQUIPMENT_TABLE)
            .select(
                "equipment_id,"
                "equipment_name"
            )
            .in_(
                "equipment_id",
                equipment_ids
            )
            .execute()
            .data
            or []
        )


        equipment_map = {
            row["equipment_id"]:
                row["equipment_name"]
            for row in equipment_rows
        }


    # ------------------------------------------------------------
    # Group by event
    # ------------------------------------------------------------

    grouped = {}


    for header in headers:

        event_id = (
            header["event_id"]
        )


        if event_id not in grouped:

            event = event_map.get(
                event_id,
                {}
            )


            grouped[event_id] = {

                "event_id":
                    event_id,

                "event_name":
                    event.get(
                        "event_name",
                        "Unknown event"
                    ),

                "event_date":
                    event.get(
                        "event_date"
                    ),

                "start_time":
                    event.get(
                        "start_time"
                    ),

                "end_time":
                    event.get(
                        "end_time"
                    ),

                "request_count":
                    0,

                "equipment_totals":
                    {},

                "has_updates":
                    False,
            }


        grouped[
            event_id
        ][
            "request_count"
        ] += 1


        if (
            str(
                header.get(
                    "status",
                    ""
                )
            ).strip().lower()
            == "updated"
        ):

            grouped[
                event_id
            ][
                "has_updates"
            ] = True


        request_items = [

            item

            for item in item_rows

            if (
                item["request_id"]
                == header["request_id"]
            )
        ]


        for item in request_items:

            quantity = int(
                item[
                    "requested_quantity"
                ]
            )


            # Quantity 0 means cancelled.
            if quantity <= 0:
                continue


            equipment_id = (
                item[
                    "equipment_id"
                ]
            )


            current_total = (
                grouped[
                    event_id
                ][
                    "equipment_totals"
                ].get(
                    equipment_id,
                    0
                )
            )


            grouped[
                event_id
            ][
                "equipment_totals"
            ][
                equipment_id
            ] = (
                current_total
                + quantity
            )


    # ------------------------------------------------------------
    # Response
    # ------------------------------------------------------------

    results = []


    for summary in grouped.values():

        equipment_description = []


        for (
            equipment_id,
            quantity
        ) in summary[
            "equipment_totals"
        ].items():

            equipment_name = (
                equipment_map.get(
                    equipment_id,
                    equipment_id
                )
            )


            equipment_description.append(
                f"{equipment_name} × {quantity}"
            )


        results.append({

            "event_id":
                summary["event_id"],

            "event_name":
                summary["event_name"],

            "event_date":
                summary["event_date"],

            "start_time":
                summary["start_time"],

            "end_time":
                summary["end_time"],

            "request_count":
                summary["request_count"],

            "equipment_description":
                (
                    ", ".join(
                        equipment_description
                    )
                    if equipment_description
                    else "No active equipment"
                ),

            "status":
                (
                    "Updated"
                    if summary["has_updates"]
                    else "Submitted"
                ),
        })


    results.sort(
        key=lambda row: (
            row.get(
                "event_date"
            )
            or ""
        )
    )


    return results


# ================================================================
# GET all equipment requests for one event
# ================================================================

@router.get(
    "/{staff_id}/events/{event_id}/requests"
)
def event_equipment_requests(
    staff_id: str,
    event_id: int
):

    client = db()


    require_technical_support(
        client,
        staff_id
    )


    # ------------------------------------------------------------
    # Event
    # ------------------------------------------------------------

    event = get_event(
        client,
        event_id
    )


    # ------------------------------------------------------------
    # Request headers
    # ------------------------------------------------------------

    headers = (
        client
        .table(REQUEST_TABLE)
        .select(
            "request_id,"
            "event_id,"
            "status,"
            "created_by,"
            "updated_by,"
            "created_at,"
            "updated_at"
        )
        .eq(
            "event_id",
            event_id
        )
        .order(
            "request_id"
        )
        .execute()
        .data
        or []
    )


    # ------------------------------------------------------------
    # Full equipment catalogue
    # ------------------------------------------------------------

    equipment_rows = (
        client
        .table(EQUIPMENT_TABLE)
        .select(
            "equipment_id,"
            "equipment_name,"
            "total_quantity,"
            "under_maintenance_count"
        )
        .order(
            "equipment_name"
        )
        .execute()
        .data
        or []
    )


    if not headers:

        return {

            "event":
                event,

            "equipment_catalogue":
                equipment_rows,

            "requests":
                [],
        }


    # ------------------------------------------------------------
    # Request items
    # ------------------------------------------------------------

    request_ids = [
        header["request_id"]
        for header in headers
    ]


    item_rows = (
        client
        .table(REQUEST_ITEM_TABLE)
        .select(
            "request_item_id,"
            "request_id,"
            "equipment_id,"
            "requested_quantity,"
            "technical_requirements,"
            "updated_by,"
            "created_at,"
            "updated_at"
        )
        .in_(
            "request_id",
            request_ids
        )
        .order(
            "request_item_id"
        )
        .execute()
        .data
        or []
    )


    equipment_map = {

        row["equipment_id"]:
            row["equipment_name"]

        for row in equipment_rows
    }


    # ------------------------------------------------------------
    # User names
    # ------------------------------------------------------------

    user_ids = set()


    for header in headers:

        if header.get(
            "created_by"
        ):

            user_ids.add(
                header[
                    "created_by"
                ]
            )


        if header.get(
            "updated_by"
        ):

            user_ids.add(
                header[
                    "updated_by"
                ]
            )


    user_map = {}


    if user_ids:

        user_rows = (
            client
            .table(USER_TABLE)
            .select(
                "id,name"
            )
            .in_(
                "id",
                list(user_ids)
            )
            .execute()
            .data
            or []
        )


        user_map = {

            row["id"]:
                row["name"]

            for row in user_rows
        }


    # ------------------------------------------------------------
    # Build response
    # ------------------------------------------------------------

    response_requests = []


    for header in headers:

        request_items = []


        for item in item_rows:

            if (
                item["request_id"]
                != header["request_id"]
            ):
                continue


            request_items.append({

                "request_item_id":
                    item[
                        "request_item_id"
                    ],

                "equipment_id":
                    item[
                        "equipment_id"
                    ],

                "equipment_name":
                    equipment_map.get(
                        item[
                            "equipment_id"
                        ],
                        item[
                            "equipment_id"
                        ]
                    ),

                "requested_quantity":
                    item[
                        "requested_quantity"
                    ],

                "technical_requirements":
                    (
                        item.get(
                            "technical_requirements"
                        )
                        or ""
                    ),

                "updated_by":
                    item.get(
                        "updated_by"
                    ),

                "updated_at":
                    item.get(
                        "updated_at"
                    ),
            })


        updated_by = (
            header.get(
                "updated_by"
            )
        )


        response_requests.append({

            "request_id":
                header[
                    "request_id"
                ],

            "status":
                header.get(
                    "status",
                    "Submitted"
                ),

            "created_by":
                header.get(
                    "created_by"
                ),

            "created_by_name":
                user_map.get(
                    header.get(
                        "created_by"
                    )
                ),

            "updated_by":
                updated_by,

            "updated_by_name":
                (
                    user_map.get(
                        updated_by
                    )
                    if updated_by
                    else None
                ),

            "created_at":
                header.get(
                    "created_at"
                ),

            "updated_at":
                (
                    header.get(
                        "updated_at"
                    )
                    or header.get(
                        "created_at"
                    )
                ),

            "items":
                request_items,
        })


    return {

        "event":
            event,

        "equipment_catalogue":
            equipment_rows,

        "requests":
            response_requests,
    }


# ================================================================
# UPDATE all changed requests for one event
#
# Existing item:
#   request_item_id has a value -> UPDATE
#
# New item:
#   request_item_id is None -> INSERT
#
# One API call can update multiple requests.
# ================================================================

@router.put(
    "/{staff_id}/events/{event_id}/requests"
)
def update_event_equipment_requests(
    staff_id: str,
    event_id: int,
    payload: EventEquipmentUpdateInput
):

    client = db()


    staff = require_technical_support(
        client,
        staff_id
    )


    event = get_event(
        client,
        event_id
    )


    if not payload.requests:

        raise HTTPException(
            status_code=400,
            detail=(
                "There are no equipment "
                "request changes to save."
            )
        )


    # ------------------------------------------------------------
    # Equipment availability
    # ------------------------------------------------------------

    availability_rows = (
        calculate_availability(
            client,
            event
        )
    )


    availability_map = {

        row["equipment_id"]:
            row

        for row in availability_rows
    }


    # ------------------------------------------------------------
    # Validate every request before making any changes
    # ------------------------------------------------------------

    validated_requests = []


    for request_update in payload.requests:

        request_header = get_request_header(
            client,
            request_update.request_id
        )


        # Request must belong to this event.
        if (
            request_header[
                "event_id"
            ]
            != event_id
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Request #{request_update.request_id} "
                    "does not belong to this event."
                )
            )


        existing_items = (
            client
            .table(
                REQUEST_ITEM_TABLE
            )
            .select(
                "request_item_id,"
                "request_id,"
                "equipment_id,"
                "requested_quantity"
            )
            .eq(
                "request_id",
                request_update.request_id
            )
            .execute()
            .data
            or []
        )


        existing_item_ids = {

            row[
                "request_item_id"
            ]

            for row in existing_items
        }


        submitted_existing_ids = {

            item.request_item_id

            for item
            in request_update.items

            if item.request_item_id
            is not None
        }


        # Existing items cannot silently disappear.
        # To cancel one, quantity should be set to 0.
        if (
            existing_item_ids
            != submitted_existing_ids
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    f"All existing items from request "
                    f"#{request_update.request_id} must be "
                    "included. Set quantity to 0 to cancel "
                    "an existing equipment item."
                )
            )


        # --------------------------------------------------------
        # Prevent duplicate active equipment types
        # within the same request.
        # --------------------------------------------------------

        active_equipment_ids = [

            item
            .equipment_id
            .strip()

            for item
            in request_update.items

            if (
                item.requested_quantity
                > 0
            )
        ]


        if (
            len(
                active_equipment_ids
            )
            != len(
                set(
                    active_equipment_ids
                )
            )
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Request #{request_update.request_id} "
                    "contains the same active equipment "
                    "type more than once."
                )
            )


        # --------------------------------------------------------
        # Validate values
        # --------------------------------------------------------

        for item in request_update.items:

            equipment_id = (
                item
                .equipment_id
                .strip()
            )


            equipment_info = (
                availability_map.get(
                    equipment_id
                )
            )


            if not equipment_info:

                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Equipment {equipment_id} "
                        "does not exist."
                    )
                )


            # Newly added item with quantity 0 makes no sense.
            if (
                item.request_item_id
                is None
                and item.requested_quantity == 0
            ):

                raise HTTPException(
                    status_code=400,
                    detail=(
                        "New equipment must have "
                        "a quantity greater than 0."
                    )
                )


            # Existing quantity 0 = cancelled.
            if (
                item.requested_quantity
                > 0
            ):

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
                        )
                    )


        validated_requests.append(
            request_update
        )


    # ------------------------------------------------------------
    # All requests passed validation.
    # Save changes.
    # ------------------------------------------------------------

    now = datetime.now(
        timezone.utc
    ).isoformat()


    updated_request_ids = []


    for request_update in validated_requests:

        for item in request_update.items:

            item_data = {

                "equipment_id":
                    item
                    .equipment_id
                    .strip(),

                "requested_quantity":
                    item.requested_quantity,

                "technical_requirements":
                    (
                        item
                        .technical_requirements
                        .strip()
                    ),

                "updated_by":
                    staff_id,

                "updated_at":
                    now,
            }


            # ----------------------------------------------------
            # Existing item
            # ----------------------------------------------------

            if (
                item.request_item_id
                is not None
            ):

                (
                    client
                    .table(
                        REQUEST_ITEM_TABLE
                    )
                    .update(
                        item_data
                    )
                    .eq(
                        "request_item_id",
                        item.request_item_id
                    )
                    .eq(
                        "request_id",
                        request_update.request_id
                    )
                    .execute()
                )


            # ----------------------------------------------------
            # Newly added equipment
            # ----------------------------------------------------

            else:

                insert_data = {

                    "request_id":
                        request_update.request_id,

                    **item_data,
                }


                (
                    client
                    .table(
                        REQUEST_ITEM_TABLE
                    )
                    .insert(
                        insert_data
                    )
                    .execute()
                )


        # --------------------------------------------------------
        # Update request header
        # --------------------------------------------------------

        (
            client
            .table(
                REQUEST_TABLE
            )
            .update({

                "status":
                    "Updated",

                "updated_by":
                    staff_id,

                "updated_at":
                    now,

            })
            .eq(
                "request_id",
                request_update.request_id
            )
            .execute()
        )


        updated_request_ids.append(
            request_update.request_id
        )


    return {

        "message":
            (
                "Equipment requests updated "
                "successfully."
            ),

        "event_id":
            event_id,

        "updated_requests":
            updated_request_ids,

        "updated_by":
            staff_id,

        "updated_by_name":
            staff.get(
                "name"
            ),

        "updated_at":
            now,
    }