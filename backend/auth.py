import base64
import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException

# auth is imported before the other modules load .env, so load it here for REQUIRE_MFA.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")



def db():
    from coordinator_assignment import db as coordinator_db

    return coordinator_db()

COORDINATOR_ROLE = "event coordinator"
ORGANISER_ROLE = "event organiser"
VENUE_STAFF_ROLE = "venue staff"
TECHNICAL_SUPPORT_ROLE = "technical support staff"
ATTENDEE_ROLE = "attendee"

# Set REQUIRE_MFA=false to accept password-only (aal1) sessions, e.g. for local development.
MFA_REQUIRED = os.getenv("REQUIRE_MFA", "true").strip().lower() != "false"


def token_aal(token: str) -> str | None:
    """Authenticator assurance level ("aal1"/"aal2") claim of a Supabase JWT.

    Only call this on a token that auth.get_user has already verified; the payload is read, not re-verified.
    """
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return claims.get("aal")
    except (IndexError, ValueError, AttributeError):
        return None


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
    if MFA_REQUIRED and token_aal(token) != "aal2":
        raise HTTPException(403, "Multi-factor authentication required.")
    profile = (
        client.table("users")
        .select("id,name,role,email")
        .eq("id", auth_user.id)
        .maybe_single()
        .execute()
    )
    if not profile or not profile.data:
        raise HTTPException(403, "User profile not found.")
    from database import request_actor
    context = request_actor.get()
    if context is not None:
        context["id"] = str(profile.data["id"])
    return profile.data


def require_coordinator(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != COORDINATOR_ROLE:
        raise HTTPException(403, "Event coordinator access required.")
    return user


def require_organiser(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != ORGANISER_ROLE:
        raise HTTPException(403, "Event organiser access required.")
    return user


def require_venue_staff(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != VENUE_STAFF_ROLE:
        raise HTTPException(403, "Venue staff access required.")
    return user


def require_technical_support(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != TECHNICAL_SUPPORT_ROLE:
        raise HTTPException(403, "Technical support access required.")
    return user


def require_attendee(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role", "")).strip().lower() != ATTENDEE_ROLE:
        raise HTTPException(403, "Attendee access required.")
    return user


def require_path_user(user_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user["id"]) != user_id:
        raise HTTPException(403, "You can only access your own account.")
    return user


def require_coordinator_path(coordinator_id: str, user: dict[str, Any] = Depends(require_coordinator)) -> dict[str, Any]:
    if str(user["id"]) != coordinator_id:
        raise HTTPException(403, "You can only access your own coordinator requests.")
    return user


def require_technical_support_path(staff_id: str, user: dict[str, Any] = Depends(require_technical_support)) -> dict[str, Any]:
    if str(user["id"]) != staff_id:
        raise HTTPException(403, "You can only access your own technical support workspace.")
    return user


def require_self(organiser_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    """For /event-organisers/{organiser_id}/... routes: caller must be that organiser."""
    if str(user["id"]) != organiser_id:
        raise HTTPException(403, "You can only access your own event requests.")
    return user
