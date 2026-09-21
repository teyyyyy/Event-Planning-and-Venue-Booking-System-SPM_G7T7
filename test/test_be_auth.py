"""Unit tests for backend/auth.py (bearer-token verification and role guards)."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import auth
from fake_supabase import FakeClient
from tc import tc

PROFILE = {"id": "u1", "name": "Ann", "role": "Event Coordinator", "email": "ann@x.com"}


def client(profile=PROFILE, user=SimpleNamespace(id="u1"), error=None):
    return FakeClient({"users": [profile] if profile else []}, auth_user=user, auth_error=error)


def status_of(fn, *args, **kwargs):
    with pytest.raises(HTTPException) as info:
        fn(*args, **kwargs)
    return info.value.status_code, info.value.detail


@tc("BE-AUTH-001", "current_user", "Request arrives with no Authorization header.",
    "HTTP 401 \"Missing bearer token.\"; the database is never queried.",
    steps="1. Call current_user(authorization=None).", kind="Negative")
def test_missing_header(use_db):
    use_db(client(), auth)
    assert status_of(auth.current_user, None) == (401, "Missing bearer token.")


@tc("BE-AUTH-002", "current_user", "Authorization header uses a scheme other than Bearer.",
    "HTTP 401 \"Missing bearer token.\"", data="Authorization = \"Basic abc123\"",
    steps="1. Call current_user with the Basic-scheme header.", kind="Negative")
def test_wrong_scheme(use_db):
    use_db(client(), auth)
    assert status_of(auth.current_user, "Basic abc123")[0] == 401


@tc("BE-AUTH-003", "current_user", "Bearer scheme is present but the token is empty.",
    "HTTP 401 \"Missing bearer token.\"", data="Authorization = \"Bearer\"",
    steps="1. Call current_user with header \"Bearer\".", kind="Edge")
def test_empty_token(use_db):
    use_db(client(), auth)
    assert status_of(auth.current_user, "Bearer")[0] == 401


@tc("BE-AUTH-004", "current_user", "Supabase rejects the token (raises while verifying it).",
    "HTTP 401 \"Invalid or expired token.\"", pre="Supabase auth.get_user raises an error.",
    data="Authorization = \"Bearer bad\"", steps="1. Call current_user with the bad token.", kind="Security")
def test_invalid_token(use_db):
    use_db(client(error=RuntimeError("jwt expired")), auth)
    assert status_of(auth.current_user, "Bearer bad") == (401, "Invalid or expired token.")


@tc("BE-AUTH-005", "current_user", "Supabase verifies the token but returns no user.",
    "HTTP 401 \"Invalid or expired token.\"", pre="auth.get_user returns user = None.",
    steps="1. Call current_user with any bearer token.", kind="Security")
def test_no_auth_user(use_db):
    use_db(client(user=None), auth)
    assert status_of(auth.current_user, "Bearer t") == (401, "Invalid or expired token.")


@tc("BE-AUTH-006", "current_user", "Token is valid but the user has no row in the users table.",
    "HTTP 403 \"User profile not found.\"", pre="users table is empty.",
    steps="1. Call current_user with a valid bearer token.", kind="Negative")
def test_missing_profile(use_db):
    use_db(client(profile=None), auth)
    assert status_of(auth.current_user, "Bearer t") == (403, "User profile not found.")


@tc("BE-AUTH-007", "current_user", "Valid token for a user that has a profile row.",
    "The caller's profile (id, name, role, email) is returned.",
    pre="users table holds the profile for id u1.", data="Authorization = \"Bearer good\"",
    steps="1. Call current_user with the good token.")
def test_valid_token(use_db):
    use_db(client(), auth)
    assert auth.current_user("Bearer good") == PROFILE


@tc("BE-AUTH-008", "current_user", "Scheme keyword is lower-case.",
    "The token is accepted (scheme comparison is case-insensitive).", data="Authorization = \"bearer good\"",
    pre="users table holds the profile for id u1.", steps="1. Call current_user with the lower-case scheme.", kind="Edge")
def test_scheme_case_insensitive(use_db):
    use_db(client(), auth)
    assert auth.current_user("bearer good")["id"] == "u1"


@tc("BE-AUTH-009", "require_coordinator", "Caller's role is \"Event Coordinator\" with different case/whitespace.",
    "The user is returned unchanged.", data="role = \"  EVENT coordinator \"",
    steps="1. Call require_coordinator with that user.", kind="Edge")
def test_coordinator_normalised():
    user = {"id": "1", "role": "  EVENT coordinator "}
    assert auth.require_coordinator(user) is user


@tc("BE-AUTH-010", "require_coordinator", "Caller has a different role.",
    "HTTP 403 \"Event coordinator access required.\"", data="role = \"venue staff\"",
    steps="1. Call require_coordinator with a venue staff user.", kind="Security")
def test_coordinator_rejects_other_role():
    assert status_of(auth.require_coordinator, {"id": "1", "role": "venue staff"}) == (403, "Event coordinator access required.")


@tc("BE-AUTH-011", "require_coordinator", "Caller's profile has no role field.",
    "HTTP 403 \"Event coordinator access required.\"", data="user = {\"id\": \"1\"}",
    steps="1. Call require_coordinator with a user lacking a role.", kind="Negative")
def test_coordinator_missing_role():
    assert status_of(auth.require_coordinator, {"id": "1"})[0] == 403


@tc("BE-AUTH-012", "require_venue_staff", "Caller's role is \"Venue Staff\".",
    "The user is returned unchanged.", data="role = \"Venue Staff\"",
    steps="1. Call require_venue_staff with a venue staff user.")
def test_venue_staff_allowed():
    user = {"id": "1", "role": "Venue Staff"}
    assert auth.require_venue_staff(user) is user


@tc("BE-AUTH-013", "require_venue_staff", "Caller is an event coordinator, not venue staff.",
    "HTTP 403 \"Venue staff access required.\"", data="role = \"event coordinator\"",
    steps="1. Call require_venue_staff with a coordinator user.", kind="Security")
def test_venue_staff_rejects_other_role():
    assert status_of(auth.require_venue_staff, {"id": "1", "role": "event coordinator"}) == (403, "Venue staff access required.")


@tc("BE-AUTH-014", "require_self", "Path organiser_id equals the caller's id (caller id is a non-string, e.g. UUID).",
    "The user is returned; ids are compared as strings.", data="user.id = 42 (int); organiser_id = \"42\"",
    steps="1. Call require_self(\"42\", {\"id\": 42}).", kind="Edge")
def test_require_self_match():
    user = {"id": 42}
    assert auth.require_self("42", user) is user


@tc("BE-AUTH-015", "require_self", "Path organiser_id belongs to a different user.",
    "HTTP 403 \"You can only access your own event requests.\"", data="user.id = \"a\"; organiser_id = \"b\"",
    steps="1. Call require_self(\"b\", {\"id\": \"a\"}).", kind="Security")
def test_require_self_mismatch():
    assert status_of(auth.require_self, "b", {"id": "a"}) == (403, "You can only access your own event requests.")


@tc("BE-AUTH-016", "COORDINATOR_ROLE / VENUE_STAFF_ROLE", "Role constants are inspected.",
    "Constants are the lower-case strings used for role comparison.",
    steps="1. Read auth.COORDINATOR_ROLE and auth.VENUE_STAFF_ROLE.", kind="Config")
def test_role_constants():
    assert (auth.COORDINATOR_ROLE, auth.VENUE_STAFF_ROLE) == ("event coordinator", "venue staff")
