from typing import Any

from fastapi import Depends, Header, HTTPException

from coordinator_assignment import db

COORDINATOR_ROLE = "event coordinator"
VENUE_STAFF_ROLE = "venue staff"


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Verify the Supabase access token and return the caller's profile row."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Missing bearer token.")
    client = db()
    try:
        auth_user = client.auth.get_user(token).user
    except Exception as error:
        raise HTTPException(401, "Invalid or expired token.") from error
    if not auth_user:
        raise HTTPException(401, "Invalid or expired token.")
    profile = (
        client.table("users")
        .select("id,name,role,email")
        .eq("id", auth_user.id)
        .maybe_single()
        .execute()
    )
    if not profile or not profile.data:
        raise HTTPException(403, "User profile not found.")
    return profile.data


def require_coordinator(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != COORDINATOR_ROLE:
        raise HTTPException(403, "Event coordinator access required.")
    return user


def require_venue_staff(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != VENUE_STAFF_ROLE:
        raise HTTPException(403, "Venue staff access required.")
    return user


def require_self(organiser_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    """For /event-organisers/{organiser_id}/... routes: caller must be that organiser."""
    if str(user["id"]) != organiser_id:
        raise HTTPException(403, "You can only access your own event requests.")
    return user
