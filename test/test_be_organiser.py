"""Unit tests for backend/event_organiser.py."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError
from pydantic import ValidationError

import event_organiser as eo
from fake_supabase import FakeClient
from tc import tc

D1, D2, D3 = [(date.today() + timedelta(days=n)).isoformat() for n in (1, 2, 3)]
PAST = (date.today() - timedelta(days=1)).isoformat()


def make(**kw):
    base = dict(event_name="Gala", event_type="Workshop", event_date=D1, event_capacity=10,
                description="d", start_time="09:00", end_time="17:00",
                layout_required="Banquet", equipment_required=["Microphone"],
                accessibility_required=0, equipment_placement="Near the stage.",
                crowd_movement="Keep the center aisle clear.", facilities_required=["Aircon"])
    return eo.EventRequest(**{**base, **kw})

def make_change_request(request_text, **kw):
    return eo.EventChangeRequest(**{**make().model_dump(), **kw, "request_text": request_text})


def row(**kw):
    return {"id": 1, "event_name": "Gala", "organiser_id": "o1", "coordinator_id": "c1",
            "status": "Draft", "event_date": D1, "event_capacity": 10, **kw}


def err(fn, *a, **kw):
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    return info.value.status_code, info.value.detail


def setup(use_db, events=(), change_requests=()):
    return use_db(FakeClient({"Event Details": list(events), "event_change_requests": list(change_requests)}), eo)


@tc("BE-ORG-001", "db", "Supabase credentials are missing.", "HTTP 500 \"Backend Supabase credentials are not configured.\"",
    pre="Service-role key is empty.", steps="1. Blank the key. 2. Call db().", kind="Config")
def test_db_missing(monkeypatch):
    monkeypatch.setattr(eo, "SUPABASE_URL", "")
    assert err(eo.db)[0] == 500


@tc("BE-ORG-002", "db", "Credentials are present.", "A Supabase client is created with them.", pre="URL and key set.",
    steps="1. Stub create_client. 2. Call db().")
def test_db_ok(monkeypatch):
    monkeypatch.setattr(eo, "SUPABASE_URL", "u")
    monkeypatch.setattr(eo, "SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(eo, "create_client", lambda *a: a)
    assert eo.db() == ("u", "k")


@tc("BE-ORG-003", "request_data", "Single-day request has a blank end date.", "event_end_date defaults to the start date.",
    data="event_end_date = None", steps="1. Call request_data(make()).", kind="Edge")
def test_request_data_defaults_end():
    assert eo.request_data(make())["event_end_date"] == D1


@tc("BE-ORG-004", "request_data", "Multi-day request has an explicit end date.", "The supplied end date is preserved and other fields pass through.",
    data=f"event_end_date = {D3}", steps="1. Call request_data(make(event_end_date=D3)).")
def test_request_data_keeps_end():
    out = eo.request_data(make(event_end_date=D3))
    assert out["event_end_date"] == D3 and out["event_name"] == "Gala"


@tc("BE-ORG-005", "organiser_can_edit", "Owner edits a Draft event.", "True.", data="status = Draft", steps="1. Call organiser_can_edit(event, \"o1\").")
def test_can_edit_draft():
    assert eo.organiser_can_edit(row(status="Draft"), "o1")


@tc("BE-ORG-006", "organiser_can_edit", "Owner edits a Submitted event with odd case/whitespace.", "True.", data="status = \" SUBMITTED \"",
    steps="1. Call organiser_can_edit.", kind="Edge")
def test_can_edit_submitted_normalised():
    assert eo.organiser_can_edit(row(status=" SUBMITTED "), "o1")


@tc("BE-ORG-007", "organiser_can_edit", "Owner edits an Approved event.", "False (only draft/submitted are editable).", data="status = Approved",
    steps="1. Call organiser_can_edit.", kind="Negative")
def test_cannot_edit_approved():
    assert not eo.organiser_can_edit(row(status="Approved"), "o1")


@tc("BE-ORG-008", "organiser_can_edit", "A different organiser tries to edit.", "False.", data="organiser o2 vs owner o1",
    steps="1. Call organiser_can_edit(event, \"o2\").", kind="Security")
def test_cannot_edit_others():
    assert not eo.organiser_can_edit(row(), "o2")


@tc("BE-ORG-009", "organiser_owns_event", "Ownership check with matching and non-matching organiser ids.", "True for the owner, False otherwise.",
    steps="1. Call organiser_owns_event with o1 and o2.")
def test_owns_event():
    assert eo.organiser_owns_event(row(), "o1") and not eo.organiser_owns_event(row(), "o2")


@tc("BE-ORG-010", "validate_request", "Valid single-day request in the future on the hour.", "No exception is raised.",
    data=f"date {D1}, 09:00-17:00", steps="1. Call validate_request(make()).")
def test_validate_ok():
    eo.validate_request(make())


@tc("BE-ORG-011", "validate_request", "Date is not a valid ISO date.", "HTTP 400 \"Use a valid event date and time.\"", data="event_date = \"31/12/2030\"",
    steps="1. Call validate_request with the bad date.", kind="Negative")
def test_validate_bad_date():
    assert err(eo.validate_request, make(event_date="31/12/2030")) == (400, "Use a valid event date and time.")


@tc("BE-ORG-012", "validate_request", "Time is not a valid time.", "HTTP 400 \"Use a valid event date and time.\"", data="start_time = \"9am\"",
    steps="1. Call validate_request with the bad time.", kind="Negative")
def test_validate_bad_time():
    assert err(eo.validate_request, make(start_time="9am"))[0] == 400


@tc("BE-ORG-013", "validate_request", "Event date is yesterday.", "HTTP 400 \"Event date cannot be in the past.\"", data=f"event_date = {PAST}",
    steps="1. Call validate_request with a past date.", kind="Negative")
def test_validate_past():
    assert err(eo.validate_request, make(event_date=PAST)) == (400, "Event date cannot be in the past.")

@tc("BE-ORG-051", "validate_request", "An existing event change proposal keeps its already-past date.",
    "The proposal schedule is accepted because the existing event date is preserved.",
    data=f"event_date = {PAST}; allow_past_date = true",
    steps="1. Validate a proposal preserving an event's existing past schedule.", kind="Regression")
def test_validate_change_request_allows_preserved_past_date():
    eo.validate_request(make(event_date=PAST), allow_past_date=True)


@tc("BE-ORG-014", "validate_request", "Event date is today.", "Accepted (only strictly past dates are rejected).", data="event_date = today",
    steps="1. Call validate_request with today's date.", kind="Edge")
def test_validate_today():
    eo.validate_request(make(event_date=date.today().isoformat()))


@tc("BE-ORG-015", "validate_request", "Start time is not on the hour.", "HTTP 400 \"Event times must use one-hour blocks.\"", data="start_time = 09:30",
    steps="1. Call validate_request with 09:30.", kind="Negative")
def test_validate_half_hour():
    assert err(eo.validate_request, make(start_time="09:30")) == (400, "Event times must use one-hour blocks.")


@tc("BE-ORG-016", "validate_request", "End time has non-zero seconds.", "HTTP 400 \"Event times must use one-hour blocks.\"", data="end_time = 17:00:30",
    steps="1. Call validate_request with 17:00:30.", kind="Edge")
def test_validate_seconds():
    assert err(eo.validate_request, make(end_time="17:00:30"))[0] == 400


@tc("BE-ORG-017", "validate_request", "End date is before the start date.", "HTTP 400 \"End date cannot be before the start date.\"", data=f"start {D2}, end {D1}",
    steps="1. Call validate_request with the reversed range.", kind="Negative")
def test_validate_end_before_start():
    assert err(eo.validate_request, make(event_date=D2, event_end_date=D1)) == (400, "End date cannot be before the start date.")


@tc("BE-ORG-018", "validate_request", "Single-day event ends at or before its start time.", "HTTP 400 \"End time must be later than the start time.\"", data="09:00-09:00",
    steps="1. Call validate_request with equal times.", kind="Negative")
def test_validate_single_day_end_time():
    assert err(eo.validate_request, make(end_time="09:00")) == (400, "End time must be later than the start time.")


@tc("BE-ORG-019", "validate_request", "Multi-day event ends earlier in the day than it starts.", "Accepted (time ordering only matters on a single day).",
    data=f"{D1} 09:00 to {D3} 12:00", steps="1. Call validate_request with a multi-day range.", kind="Edge")
def test_validate_multi_day_earlier_end_time():
    eo.validate_request(make(event_end_date=D3, end_time="12:00"))


@tc("BE-ORG-062", "validate_request", "A request includes an unsupported layout.", "HTTP 400 and the unsupported value is not accepted.",
    data="layout_required = Cabaret", steps="1. Validate a request with an unsupported layout.", kind="Negative")
def test_validate_rejects_unknown_layout():
    assert err(eo.validate_request, make(layout_required="Cabaret")) == (400, "Select a valid event layout.")


@tc("BE-ORG-063", "EventRequest", "Accessibility is outside the 0/1 range.", "Request validation rejects the value.",
    data="accessibility_required = 2", steps="1. Construct an event request with accessibility set to 2.", kind="Negative")
def test_accessibility_must_be_binary():
    with pytest.raises(ValidationError):
        make(accessibility_required=2)


@tc("BE-ORG-065", "EventRequest", "A planning requirement is omitted or has an empty selection list.", "Request validation rejects both incomplete payloads.",
    steps="1. Construct requests without a layout or with no selected equipment.", kind="Negative")
def test_planning_requirements_are_required():
    payload = make().model_dump()
    payload.pop("layout_required")
    with pytest.raises(ValidationError):
        eo.EventRequest(**payload)
    with pytest.raises(ValidationError):
        make(equipment_required=[])


@tc("BE-ORG-064", "validate_request", "A request includes equipment or facilities outside the supplied options.", "HTTP 400.",
    steps="1. Validate requests with unsupported equipment and facilities.", kind="Negative")
def test_validate_rejects_unknown_equipment_and_facilities():
    assert err(eo.validate_request, make(equipment_required=["Forklift"])) == (
        400, "Select valid required equipment."
    )
    assert err(eo.validate_request, make(facilities_required=["Private office"])) == (
        400, "Select valid required facilities."
    )


@tc("BE-ORG-020", "create_event_request", "Valid draft is saved.", "A Draft row is inserted for the organiser and returned.",
    steps="1. Call create_event_request(\"o1\", make()).")
def test_create_draft(use_db):
    client = setup(use_db)
    planning = {
        "layout_required": "Banquet",
        "equipment_required": ["Microphone", "Projector"],
        "accessibility_required": 1,
        "equipment_placement": "Projector at the stage.",
        "crowd_movement": "Keep the center aisle clear.",
        "facilities_required": ["Aircon", "Stage"],
    }
    out = eo.create_event_request("o1", make(**planning))
    assert out["status"] == "Draft" and out["organiser_id"] == "o1" and client.tables["Event Details"][0]["event_end_date"] == D1
    assert {key: out[key] for key in planning} == planning


@tc("BE-ORG-021", "create_event_request", "Draft with invalid schedule.", "HTTP 400 and nothing is inserted.", data="end before start",
    steps="1. Call create_event_request with a reversed range.", kind="Negative")
def test_create_draft_invalid(use_db):
    client = setup(use_db)
    assert err(eo.create_event_request, "o1", make(event_date=D2, event_end_date=D1))[0] == 400
    assert client.tables["Event Details"] == []


@tc("BE-ORG-022", "create_event_request", "Insert returns no row.", "HTTP 500 \"Event request could not be created.\"", pre="Insert returns empty data.",
    steps="1. Simulate empty insert. 2. Call create_event_request.", kind="Negative")
def test_create_draft_insert_fails(use_db):
    setup(use_db).empty_inserts = True
    assert err(eo.create_event_request, "o1", make()) == (500, "Event request could not be created.")


@tc("BE-ORG-023", "create_submitted_event_request", "Valid request is submitted.", "Row is inserted as Submitted without automatic coordinator assignment.",
    steps="1. Call create_submitted_event_request(\"o1\", make()).")
def test_create_submitted(use_db):
    client = setup(use_db)
    out = eo.create_submitted_event_request("o1", make())
    assert client.tables["Event Details"][0]["status"] == "Submitted" and out["status"] == "Submitted" and out.get("coordinator_id") is None


@tc("BE-ORG-024", "create_submitted_event_request", "Submitted request has a past date.", "HTTP 400 and no row is inserted.", data=f"event_date = {PAST}",
    steps="1. Call create_submitted_event_request with a past date.", kind="Negative")
def test_create_submitted_invalid(use_db):
    client = setup(use_db)
    assert err(eo.create_submitted_event_request, "o1", make(event_date=PAST))[0] == 400 and not client.tables["Event Details"]


@tc("BE-ORG-025", "create_submitted_event_request", "Insert returns no row.", "HTTP 500 \"Event request could not be submitted.\"", pre="Insert returns empty data.",
    steps="1. Simulate empty insert. 2. Call the route.", kind="Negative")
def test_create_submitted_insert_fails(use_db):
    setup(use_db).empty_inserts = True
    assert err(eo.create_submitted_event_request, "o1", make())[1] == "Event request could not be submitted."


@tc("BE-ORG-026", "update_event_request", "Owner updates their Draft event.", "Row is updated and returned; end date defaulted.", pre="Draft event 1 owned by o1.",
    data="event_name = \"New name\"", steps="1. Call update_event_request(\"o1\", 1, make(event_name=\"New name\")).")
def test_update_ok(use_db):
    setup(use_db, [row()])
    out = eo.update_event_request("o1", 1, make(event_name="New name"))
    assert out["event_name"] == "New name" and out["event_end_date"] == D1


@tc("BE-ORG-027", "update_event_request", "Event id does not exist.", "HTTP 404 \"Event request not found.\"", steps="1. Call update_event_request(\"o1\", 99, ...).", kind="Negative")
def test_update_missing(use_db):
    setup(use_db, [row()])
    assert err(eo.update_event_request, "o1", 99, make()) == (404, "Event request not found.")


@tc("BE-ORG-028", "update_event_request", "Event is already Approved.", "HTTP 403 \"This event request cannot be updated during its current status.\"", pre="Event status = Approved.",
    steps="1. Call update_event_request on the approved event.", kind="Security")
def test_update_locked_status(use_db):
    setup(use_db, [row(status="Approved")])
    assert err(eo.update_event_request, "o1", 1, make())[0] == 403


@tc("BE-ORG-029", "update_event_request", "A different organiser tries to update the event.", "HTTP 403.", pre="Event owned by o1.",
    steps="1. Call update_event_request(\"o2\", 1, ...).", kind="Security")
def test_update_wrong_owner(use_db):
    setup(use_db, [row()])
    assert err(eo.update_event_request, "o2", 1, make())[0] == 403


@tc("BE-ORG-030", "update_event_request", "Invalid schedule is submitted.", "HTTP 400 before any database lookup.", data="09:30 start time",
    steps="1. Call update_event_request with a half-hour start.", kind="Negative")
def test_update_invalid(use_db):
    client = setup(use_db, [row()])
    assert err(eo.update_event_request, "o1", 1, make(start_time="09:30"))[0] == 400 and not client.log


@tc("BE-ORG-031", "update_event_request", "Update returns no row.", "HTTP 500 \"Event request could not be updated.\"", pre="Update returns empty data.",
    steps="1. Simulate empty update. 2. Call update_event_request.", kind="Negative")
def test_update_returns_nothing(use_db):
    setup(use_db, [row()]).empty_updates = True
    assert err(eo.update_event_request, "o1", 1, make())[0] == 500


@tc("BE-ORG-032", "submit_event_request", "Owner submits their Draft.", "Status becomes Submitted and the row is returned.", pre="Draft event 1 owned by o1.",
    steps="1. Call submit_event_request(\"o1\", 1).")
def test_submit_draft(use_db):
    setup(use_db, [row()])
    assert eo.submit_event_request("o1", 1)["status"] == "Submitted"


@tc("BE-ORG-033", "submit_event_request", "Event id does not exist.", "HTTP 404 \"Event request not found.\"", steps="1. Call submit_event_request(\"o1\", 99).", kind="Negative")
def test_submit_missing(use_db):
    setup(use_db, [row()])
    assert err(eo.submit_event_request, "o1", 99)[0] == 404


@tc("BE-ORG-034", "submit_event_request", "Event is not a Draft (already Submitted).", "HTTP 400 \"Only completed draft requests can be submitted.\"", pre="Event status = Submitted.",
    steps="1. Call submit_event_request.", kind="Negative")
def test_submit_not_draft(use_db):
    setup(use_db, [row(status="Submitted")])
    assert err(eo.submit_event_request, "o1", 1) == (400, "Only completed draft requests can be submitted.")


@tc("BE-ORG-035", "submit_event_request", "A different organiser submits someone else's draft.", "HTTP 400 and the status stays Draft.", steps="1. Call submit_event_request(\"o2\", 1).", kind="Security")
def test_submit_wrong_owner(use_db):
    client = setup(use_db, [row()])
    assert err(eo.submit_event_request, "o2", 1)[0] == 400 and client.tables["Event Details"][0]["status"] == "Draft"


@tc("BE-ORG-057", "submit_event_request", "Update returns no row (e.g. the event changed concurrently).", "HTTP 500 \"Event request could not be submitted.\" instead of an unhandled error.",
    pre="Draft event 1 owned by o1; update returns empty data.", steps="1. Simulate empty update. 2. Call submit_event_request.", kind="Negative")
def test_submit_returns_nothing(use_db):
    setup(use_db, [row()]).empty_updates = True
    assert err(eo.submit_event_request, "o1", 1) == (500, "Event request could not be submitted.")


@tc("BE-ORG-058", "discard_event_request", "Owner discards their Draft.", "The draft is removed and a success message is returned.",
    pre="Draft event 1 is owned by o1.", steps="1. Call discard_event_request(\"o1\", 1).")
def test_discard_draft(use_db):
    client = setup(use_db, [row(id="1")])
    assert eo.discard_event_request("o1", "1") == {"message": "Event draft discarded successfully."}
    assert client.tables["Event Details"] == []


@tc("BE-ORG-059", "discard_event_request", "Event id does not exist.", "HTTP 404 \"Event request not found.\".",
    steps="1. Call discard_event_request(\"o1\", \"99\").", kind="Negative")
def test_discard_missing_draft(use_db):
    setup(use_db, [row()])
    assert err(eo.discard_event_request, "o1", "99") == (404, "Event request not found.")


@tc("BE-ORG-060", "discard_event_request", "A different organiser tries to discard the draft.",
    "HTTP 403 and the draft remains.", pre="Draft event 1 is owned by o1.",
    steps="1. Call discard_event_request(\"o2\", \"1\").", kind="Security")
def test_discard_wrong_owner(use_db):
    client = setup(use_db, [row(id="1")])
    assert err(eo.discard_event_request, "o2", "1")[0] == 403
    assert client.tables["Event Details"] == [row(id="1")]


@tc("BE-ORG-061", "discard_event_request", "Owner tries to discard an event that is not a Draft.",
    "HTTP 400 and the event remains.", pre="Event 1 is Submitted and owned by o1.",
    steps="1. Call discard_event_request(\"o1\", \"1\").", kind="Negative")
def test_discard_non_draft(use_db):
    client = setup(use_db, [row(id="1", status="Submitted")])
    assert err(eo.discard_event_request, "o1", "1") == (400, "Only draft event requests can be discarded.")
    assert client.tables["Event Details"] == [row(id="1", status="Submitted")]


@tc("BE-ORG-039", "create_event_change_request", "Owner requests changes to a confirmed event assigned to a coordinator.",
    "The request is stored with its organiser, event and assigned coordinator; that coordinator receives an event notification.",
    pre="Confirmed event 1 belongs to o1 and is assigned to c1.",
    data="request_text = Add wheelchair-accessible seating; proposed capacity = 25",
    steps="1. Submit a change request for event 1.")
def test_create_event_change_request_saves_and_notifies(use_db):
    client = setup(use_db, [row(status="Confirmed")])
    result = eo.create_event_change_request(
        "o1", 1, make_change_request("  Add wheelchair-accessible seating  ", event_capacity=25)
    )
    saved = client.tables["event_change_requests"][0]
    notification = client.tables["notifications"][0]
    assert result == saved
    assert saved["event_id"] == 1
    assert saved["organiser_id"] == "o1"
    assert saved["coordinator_id"] == "c1"
    assert saved["request_text"] == "Add wheelchair-accessible seating"
    assert saved["proposed_event_capacity"] == 25
    assert client.tables["Event Details"][0]["event_capacity"] == 10
    assert notification["recipient_id"] == "c1"
    assert notification["record_type"] == "event" and notification["record_id"] == "1"
    assert "Add wheelchair-accessible seating" in notification["description"]


@tc("BE-ORG-040", "create_event_change_request", "Owner submits a second request while one is pending for the same event.",
    "HTTP 400 and only the first pending request remains stored.", kind="Negative",
    steps="1. Submit a change request for event 1. 2. Submit another before review.")
def test_change_requests_reject_second_pending(use_db):
    client = setup(use_db, [row(status="Under review")])
    eo.create_event_change_request("o1", 1, make_change_request("Change the schedule"))
    assert err(eo.create_event_change_request, "o1", 1, make_change_request("Add more seating")) == (
        400,
        "This event already has a pending change request.",
    )
    assert [item["request_text"] for item in client.tables["event_change_requests"]] == [
        "Change the schedule",
    ]


@tc("BE-ORG-049", "create_event_change_request", "The same event only has reviewed change-request history.",
    "A new Pending request can be submitted after an earlier request is Approved or Rejected.",
    pre="Event 1 has Approved and Rejected historical requests, but no Pending request.",
    steps="1. Seed reviewed requests. 2. Submit a new change request.", kind="State")
def test_change_request_allowed_after_review(use_db):
    client = setup(use_db, [row(status="Confirmed")], [
        {"id": 7, "event_id": 1, "organiser_id": "o1", "coordinator_id": "c1", "request_text": "Old approved", "review_status": "Approved"},
        {"id": 8, "event_id": 1, "organiser_id": "o1", "coordinator_id": "c1", "request_text": "Old rejected", "review_status": "Rejected"},
    ])
    eo.create_event_change_request("o1", 1, make_change_request("New request"))
    assert [item["review_status"] for item in client.tables["event_change_requests"]] == ["Approved", "Rejected", "Pending"]


@tc("BE-ORG-041", "create_event_change_request", "Another organiser submits a request for the event.",
    "HTTP 403 and no request is recorded.", kind="Security",
    steps="1. Submit a change request as organiser o2 for event 1.")
def test_change_request_wrong_owner(use_db):
    client = setup(use_db, [row(status="Confirmed")])
    assert err(eo.create_event_change_request, "o2", 1, make_change_request("Change the schedule"))[0] == 403
    assert client.tables.get("event_change_requests", []) == []


@tc("BE-ORG-042", "create_event_change_request", "Requested event does not exist.",
    "HTTP 404 and nothing is stored.", kind="Negative",
    steps="1. Submit a change request for missing event 99.")
def test_change_request_missing_event(use_db):
    client = setup(use_db)
    assert err(eo.create_event_change_request, "o1", 99, make_change_request("Change the schedule")) == (404, "Event request not found.")
    assert client.tables.get("event_change_requests", []) == []


@tc("BE-ORG-043", "create_event_change_request", "Event is a Draft, Completed, Cancelled or Rejected.",
    "HTTP 400 and nothing is stored.", kind="Negative",
    steps="1. Submit a change request for each unavailable status.")
def test_change_request_unavailable_statuses(use_db):
    for status in ("Draft", "Completed", "Cancelled", "Rejected"):
        client = setup(use_db, [row(status=status)])
        assert err(eo.create_event_change_request, "o1", 1, make_change_request("Change the schedule"))[0] == 400
        assert client.tables.get("event_change_requests", []) == []


@tc("BE-ORG-044", "create_event_change_request", "An active event has no assigned coordinator.",
    "HTTP 400 and no request is stored.", kind="Negative",
    steps="1. Submit a change request before coordinator assignment.")
def test_change_request_requires_assigned_coordinator(use_db):
    client = setup(use_db, [row(status="Submitted", coordinator_id=None)])
    assert err(eo.create_event_change_request, "o1", 1, make_change_request("Change the schedule"))[0] == 400
    assert client.tables.get("event_change_requests", []) == []


@tc("BE-ORG-045", "create_event_change_request", "The request contains only whitespace.",
    "HTTP 400 before any database access.", kind="Negative",
    steps="1. Submit a whitespace-only request.")
def test_change_request_rejects_blank_text(use_db):
    client = setup(use_db, [row(status="Confirmed")])
    assert err(eo.create_event_change_request, "o1", 1, make_change_request("   "))[0] == 400
    assert client.log == []


@tc("BE-ORG-036", "organiser_events (submitted-requests)", "Organiser lists their requests.", "Only their rows, ordered by event_date.",
    pre="Rows for o1 (two dates) and o2.", steps="1. Call organiser_events(\"o1\").")
def test_organiser_events(use_db):
    setup(use_db, [row(id=1, event_date="2026-12-01"), row(id=2, event_date="2026-10-01"), row(id=3, organiser_id="o2")])
    assert [r["id"] for r in eo.organiser_events("o1")] == [2, 1]


@tc("BE-ORG-037", "EventRequest model", "Model is built without event_end_date.", "event_end_date is None (blank = single-day).", steps="1. Instantiate EventRequest without an end date.", kind="Edge")
def test_model_default_end():
    assert make().event_end_date is None


@tc("BE-ORG-038", "EventRequest model", "Capacity is not an integer.", "Pydantic raises a validation error.", data="event_capacity = \"lots\"",
    steps="1. Instantiate EventRequest with a non-numeric capacity.", kind="Negative")
def test_model_bad_capacity():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        make(event_capacity="lots")


@tc("BE-ORG-046", "create_event_change_request", "Request text exceeds 5,000 characters.",
    "HTTP 400 before database access.", kind="Negative",
    steps="1. Submit a change request with more than 5,000 characters.")
def test_change_request_rejects_oversized_text(use_db):
    client = setup(use_db, [row(status="Confirmed")])
    assert err(eo.create_event_change_request, "o1", 1, make_change_request("x" * 5001)) == (400, "Change requests must be 5,000 characters or fewer.")
    assert client.log == []


@tc("BE-ORG-047", "create_event_change_request", "Database RPC returns no saved row.",
    "HTTP 500 with an explicit save failure.", kind="Negative",
    steps="1. Stub the database RPC to return no data. 2. Submit a change request.")
def test_change_request_empty_rpc_result(use_db, monkeypatch):
    client = setup(use_db, [row(status="Confirmed")])
    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(
        execute=lambda: SimpleNamespace(data=None),
    ))
    assert err(eo.create_event_change_request, "o1", 1, make_change_request("Change the schedule")) == (500, "Event change request could not be saved.")


@tc("BE-ORG-048", "create_event_change_request", "Database RPC returns a one-row list.",
    "The first saved row is returned.", kind="Edge",
    steps="1. Stub the database RPC to return a list containing a saved row.")
def test_change_request_list_rpc_result(use_db, monkeypatch):
    client = setup(use_db, [row(status="Confirmed")])
    saved = {"id": 7, "event_id": 1, "request_text": "Change the schedule"}
    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(
        execute=lambda: SimpleNamespace(data=[saved]),
    ))
    assert eo.create_event_change_request("o1", 1, make_change_request("Change the schedule")) == saved


@tc("BE-ORG-052", "create_event_change_request", "Database RPC fails with an unmapped error.",
    "The database error propagates instead of becoming a success-shaped response.", kind="Negative",
    steps="1. Stub the database RPC to raise an unknown APIError. 2. Submit a change request.")
def test_change_request_unmapped_database_error(use_db, monkeypatch):
    client = setup(use_db, [row(status="Confirmed")])
    error = APIError({"message": "Database unavailable.", "code": "XX000", "details": None, "hint": None})

    def raise_database_error():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(
        execute=raise_database_error,
    ))
    with pytest.raises(APIError, match="Database unavailable"):
        eo.create_event_change_request("o1", 1, make_change_request("Change the schedule"))


@tc("BE-ORG-053", "create_event_change_request", "A change request is submitted while another one is pending.",
    "HTTP 400 explains that only one pending request is allowed.", kind="State",
    steps="1. Make the submission RPC return a 23505 APIError. 2. Submit a change request.")
def test_change_request_pending_conflict(use_db, monkeypatch):
    client = setup(use_db, [row(status="Confirmed")])
    error = APIError({
        "message": "A pending change request already exists.",
        "code": "23505",
        "details": None,
        "hint": None,
    })

    def raise_database_error():
        raise error

    monkeypatch.setattr(client, "rpc", lambda *_: SimpleNamespace(
        execute=raise_database_error,
    ))
    assert err(
        eo.create_event_change_request,
        "o1",
        1,
        make_change_request("Change the schedule"),
    ) == (400, "This event already has a pending change request.")


@tc("BE-ORG-050", "create_event_change_request", "Notification insert fails after request insert.",
    "The test database double rolls back the request, matching the SQL function transaction.", kind="Negative",
    steps="1. Make notification inserts fail. 2. Submit a change request. 3. Confirm no request remains.")
def test_change_request_notification_failure_rolls_back(use_db):
    client = setup(use_db, [row(status="Confirmed")])
    client.fail_tables.add(("notifications", "insert"))
    with pytest.raises(RuntimeError, match="simulated failure on notifications"):
        eo.create_event_change_request("o1", 1, make_change_request("Change the schedule"))
    assert client.tables.get("event_change_requests", []) == []


@tc("BE-ORG-054", "update_event_change_request", "An organiser edits a pending request.",
   "The update RPC receives the organiser and request details and its result is returned.", kind="State", steps="1. Call the update endpoint.")
def test_change_request_update_pending(monkeypatch):
    captured = {}
    updated = {"id": 11, "review_status": "Pending", "request_text": "Updated"}
    monkeypatch.setattr(eo, "db", lambda: SimpleNamespace(rpc=lambda name, params: SimpleNamespace(
        execute=lambda: (captured.update(name=name, params=params) or SimpleNamespace(data=updated)))))
    result = eo.update_event_change_request("o1", 11, make_change_request("Updated", event_name="Updated Gala"))
    assert result == updated
    assert captured["name"] == "update_event_change_request"
    assert captured["params"]["p_organiser_id"] == "o1"


@tc("BE-ORG-055", "cancel_event_change_request", "An organiser cancels a pending request.",
   "The cancellation RPC is called with the request and organiser IDs.", kind="State", steps="1. Call the cancellation endpoint.")
def test_change_request_cancel_pending(monkeypatch):
    captured = {}
    monkeypatch.setattr(eo, "db", lambda: SimpleNamespace(rpc=lambda name, params: SimpleNamespace(
        execute=lambda: (captured.update(name=name, params=params) or SimpleNamespace(data={"id": 11, "review_status": "Cancelled"})))))
    assert eo.cancel_event_change_request("o1", 11)["review_status"] == "Cancelled"
    assert captured == {"name": "cancel_event_change_request", "params": {"p_request_id": 11, "p_organiser_id": "o1"}}


@tc("BE-ORG-056", "update_event_change_request", "An already reviewed request is edited.",
   "HTTP 409 is returned and the database error is preserved.", kind="Negative", steps="1. Return the reviewed-state database error. 2. Call the update endpoint.")
def test_change_request_update_reviewed_rejected(monkeypatch):
    error = APIError({"message": "Only pending change requests can be edited.", "code": "55000", "details": None, "hint": None})
    monkeypatch.setattr(eo, "db", lambda: SimpleNamespace(rpc=lambda *_: SimpleNamespace(execute=lambda: (_ for _ in ()).throw(error))))
    assert err(eo.update_event_change_request, "o1", 11, make_change_request("Updated")) == (409, str(error.message))
