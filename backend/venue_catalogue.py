"""Staff catalogue using the same Venues records as coordinator bookings."""
import re
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from auth import current_user, require_venue_staff
from coordinator_assignment import db

router = APIRouter(prefix="/api/venue-catalogue", tags=["Venue catalogue"])
DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
Day = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def require_reader(user=Depends(current_user)):
    if str(user.get("role", "")).strip().lower() not in {"venue staff", "technical support staff"}:
        raise HTTPException(403, "Venue Staff or Technical Support Staff access required.")
    return user


class Hours(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    closed: bool
    opens: str | None = None
    closes: str | None = None

    @model_validator(mode="after")
    def check_times(self):
        if self.closed:
            if self.opens is not None or self.closes is not None:
                raise ValueError("Closed days cannot have operating times.")
        else:
            if any(not value or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) for value in (self.opens, self.closes)):
                raise ValueError("Enter both times in HH:MM format.")
            if self.closes <= self.opens:
                raise ValueError("Closing time must be later than opening time on the same day.")
        return self


class VenueUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operating_hours: dict[Day, Hours]
    facilities: list[str] = Field(max_length=30)
    accessible: Literal[0, 1]
    accessibility_details: str = Field(max_length=1000)
    layouts: list[str] = Field(max_length=30)

    @field_validator("operating_hours")
    @classmethod
    def complete_week(cls, value):
        if set(value) != set(DAYS):
            raise ValueError("Specify all seven days.")
        return value

    @field_validator("facilities", "layouts")
    @classmethod
    def clean_list(cls, items):
        result, seen = [], set()
        for item in items:
            item = item.strip()
            if not item or len(item) > 100 or "\n" in item or "\r" in item:
                raise ValueError("Each item must be one line of 1–100 characters.")
            if item.casefold() not in seen:
                result.append(item)
                seen.add(item.casefold())
        return result

    @field_validator("accessibility_details")
    @classmethod
    def trim_details(cls, value):
        return value.strip()


def unavailable(error):
    return HTTPException(503, "Venue information could not be loaded or saved. Please try again.")


@router.get("")
def list_venues(user=Depends(require_reader)):
    try:
        return db().table("Venues").select("*").order("name").execute().data or []
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error


@router.get("/{venue_id}")
def venue_detail(venue_id: int, user=Depends(require_reader)):
    try:
        rows = db().table("Venues").select("*").eq("venue_id", venue_id).limit(1).execute().data or []
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error
    if not rows:
        raise HTTPException(404, "Venue not found.")
    return rows[0]


@router.put("/{venue_id}")
def update_venue(venue_id: int, update: VenueUpdate, user=Depends(require_venue_staff)):
    try:
        rows = db().table("Venues").update(update.model_dump()).eq("venue_id", venue_id).execute().data or []
    except (APIError, httpx.HTTPError) as error:
        raise unavailable(error) from error
    if not rows:
        raise HTTPException(404, "Venue not found. Changes were not saved.")
    return rows[0]
