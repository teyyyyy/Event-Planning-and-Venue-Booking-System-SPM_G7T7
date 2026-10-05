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


@tc("BE-AUTH-017", "require_organiser", "Caller is an Event Organiser.", "The user is returned; other roles are rejected.",
    steps="1. Check organiser and attendee profiles.", kind="Security")
def test_organiser_role_guard():
    user = {"id": "o1", "role": " Event Organiser "}
    assert auth.require_organiser(user) is user
    assert status_of(auth.require_organiser, {"id": "a1", "role": "Attendee"})[0] == 403


@tc("BE-AUTH-018", "require_technical_support", "Caller is Technical Support Staff.", "The user is returned; other roles are rejected.",
    steps="1. Check technical-support and coordinator profiles.", kind="Security")
def test_technical_support_role_guard():
    user = {"id": "t1", "role": "Technical Support Staff"}
    assert auth.require_technical_support(user) is user
    assert status_of(auth.require_technical_support, {"id": "c1", "role": "Event Coordinator"})[0] == 403


@tc("BE-AUTH-025", "require_attendee", "Caller is an Attendee.", "The user is returned; staff roles are rejected.",
    steps="1. Check attendee and venue-staff profiles.", kind="Security")
def test_attendee_role_guard():
    user = {"id": "a1", "role": " Attendee "}
    assert auth.require_attendee(user) is user
    assert status_of(auth.require_attendee, {"id": "v1", "role": "Venue Staff"})[0] == 403


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


def jwt(aal):
    import base64, json
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{part({'alg': 'HS256'})}.{part({'aal': aal} if aal else {})}.sig"


@tc("BE-AUTH-019", "current_user (MFA)", "MFA is required and the token is password-only (aal1).",
    "HTTP 403 \"Multi-factor authentication required.\"; the profile is never loaded.",
    pre="auth.MFA_REQUIRED is True; token carries aal = aal1.", steps="1. Call current_user with an aal1 token.", kind="Security")
def test_mfa_rejects_aal1(use_db, monkeypatch):
    monkeypatch.setattr(auth, "MFA_REQUIRED", True)
    use_db(client(), auth)
    assert status_of(auth.current_user, f"Bearer {jwt('aal1')}") == (403, "Multi-factor authentication required.")


@tc("BE-AUTH-020", "current_user (MFA)", "MFA is required and the token has completed a second factor (aal2).",
    "The caller's profile is returned.", pre="auth.MFA_REQUIRED is True; token carries aal = aal2.",
    steps="1. Call current_user with an aal2 token.", kind="Security")
def test_mfa_accepts_aal2(use_db, monkeypatch):
    monkeypatch.setattr(auth, "MFA_REQUIRED", True)
    use_db(client(), auth)
    assert auth.current_user(f"Bearer {jwt('aal2')}") == PROFILE


@tc("BE-AUTH-021", "current_user (MFA)", "MFA is required and the token payload is malformed or has no aal claim.",
    "HTTP 403 \"Multi-factor authentication required.\"", pre="auth.MFA_REQUIRED is True.",
    data="tokens: \"opaque\", payload without aal", steps="1. Call current_user with each token.", kind="Negative")
def test_mfa_rejects_unreadable_token(use_db, monkeypatch):
    monkeypatch.setattr(auth, "MFA_REQUIRED", True)
    use_db(client(), auth)
    assert status_of(auth.current_user, "Bearer opaque")[0] == 403
    assert status_of(auth.current_user, f"Bearer {jwt(None)}")[0] == 403


@tc("BE-AUTH-022", "current_user (MFA)", "MFA is switched off (REQUIRE_MFA=false) and the token is aal1.",
    "The caller's profile is returned.", pre="auth.MFA_REQUIRED is False.",
    steps="1. Call current_user with an aal1 token.", kind="Edge")
def test_mfa_can_be_disabled(use_db, monkeypatch):
    monkeypatch.setattr(auth, "MFA_REQUIRED", False)
    use_db(client(), auth)
    assert auth.current_user(f"Bearer {jwt('aal1')}") == PROFILE


@tc("BE-AUTH-023", "db", "A guard needs the database client.", "auth.db() returns the shared client built by coordinator_assignment.db().",
    pre="coordinator_assignment.db is stubbed.", steps="1. Stub coordinator_assignment.db. 2. Call auth.db().", kind="Config")
def test_db_delegates(monkeypatch):
    import coordinator_assignment
    monkeypatch.setattr(coordinator_assignment, "db", lambda: "shared-client")
    assert auth.db() == "shared-client"


@tc("BE-AUTH-024", "require_technical_support_path", "Technical support staff open their own workspace, then another staff member's.", "Own id passes; a different id is HTTP 403.",
    data="path id t1 vs t2, caller t1", steps="1. Call the guard with the caller's own id. 2. Call it with another id.", kind="Security")
def test_technical_support_path_identity():
    user = {"id": "t1", "role": "Technical Support Staff"}
    assert auth.require_technical_support_path("t1", user) is user
    assert status_of(auth.require_technical_support_path, "t2", user)[0] == 403
