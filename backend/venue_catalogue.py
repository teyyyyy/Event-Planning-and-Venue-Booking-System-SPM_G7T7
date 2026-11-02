"""Staff catalogue using the same Venues records as coordinator bookings."""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from auth import COORDINATOR_LEAD_ROLE, COORDINATOR_ROLE, current_user, require_venue_staff
from coordinator_assignment import db

router = APIRouter(prefix="/api/venue-catalogue", tags=["Venue catalogue"])


def require_reader(user=Depends(current_user)):
    if str(user.get("role", "")).strip().lower() not in {
        "venue staff",
        "technical support staff",
        COORDINATOR_ROLE,
        COORDINATOR_LEAD_ROLE,
    }:
        raise HTTPException(
            403,
            "Event Coordinator, Venue Staff or Technical Support Staff access required.",
        )
    return user


class VenueUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    accessible: int
    accessibility_details: str = Field(default="", max_length=1000)
    emergency_access: str = Field(default="", max_length=1000)
    venue_restrictions: str = Field(default="", max_length=1000)
    setup_time: int | None = Field(
        default=None,
        ge=0,
        le=2_147_483_647,
        strict=True,
    )
    teardown_time: int | None = Field(
        default=None,
        ge=0,
        le=2_147_483_647,
        strict=True,
    )

    @field_validator("accessible")
    @classmethod
    def valid_accessibility(cls, value):
        if value not in (0, 1):
            raise ValueError("Accessibility must be either 0 or 1.")
        return value

    @field_validator(
        "accessibility_details",
        "emergency_access",
        "venue_restrictions",
    )
    @classmethod
    def trim_text(cls, value):
        return value.strip()


def unavailable(error):
    return HTTPException(
        503,
        "Venue information could not be loaded or saved. Please try again.",
    )


@router.get("")
def list_venues(user=Depends(require_reader)):
    try:
        return (
            db()
            .table("Venues")
            .select("*")
            .order("name")
            .execute()
            .data
            or []
        )
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error


@router.get("/{venue_id}")
def venue_detail(venue_id: int, user=Depends(require_reader)):
    try:
        rows = (
            db()
            .table("Venues")
            .select("*")
            .eq("venue_id", venue_id)
            .limit(1)
            .execute()
            .data
            or []
        )
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error

    if not rows:
        raise HTTPException(404, "Venue not found.")

    return rows[0]


@router.put("/{venue_id}")
def update_venue(
    venue_id: int,
    update: VenueUpdate,
    user=Depends(require_venue_staff),
):
    try:
        rows = (
            db()
            .table("Venues")
            .update(update.model_dump(exclude_unset=True))
            .eq("venue_id", venue_id)
            .execute()
            .data
            or []
        )
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error

    if not rows:
        raise HTTPException(
            404,
            "Venue not found. Changes were not saved.",
        )

    return rows[0]


class VenueAvailability(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    is_available: bool
    unavailability_reason: str = Field(
        default="",
        max_length=1000,
    )

    @model_validator(mode="after")
    def validate_reason(self):
        self.unavailability_reason = self.unavailability_reason.strip()

        if not self.is_available and not self.unavailability_reason:
            raise ValueError(
                "Enter a reason for venue unavailability."
            )

        if self.is_available:
            self.unavailability_reason = ""

        return self


@router.patch("/{venue_id}/availability")
def update_availability(
    venue_id: int,
    update: VenueAvailability,
    user=Depends(require_venue_staff),
):
    # The database trigger resets affected bookings and emits notifications in
    # this same transaction, so a failure cannot leave a partially blocked venue.
    try:
        rows = (
            db()
            .table("Venues")
            .update(update.model_dump())
            .eq("venue_id", venue_id)
            .execute()
            .data
            or []
        )
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error

    if not rows:
        raise HTTPException(
            404,
            "Venue not found. Changes were not saved.",
        )

    return rows[0]
