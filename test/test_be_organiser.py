"""Unit tests for backend/event_organiser.py."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

import coordinator_assignment as ca
import event_organiser as eo
from fake_supabase import FakeClient
from tc import tc

D1, D2, D3 = [(date.today() + timedelta(days=n)).isoformat() for n in (1, 2, 3)]
PAST = (date.today() - timedelta(days=1)).isoformat()


def make(**kw):
    base = dict(event_name="Gala", event_type="Workshop", event_date=D1, event_capacity=10,
                description="d", start_time="09:00", end_time="17:00")
    return eo.EventRequest(**{**base, **kw})


def row(**kw):
    return {"id": 1, "organiser_id": "o1", "status": "Draft", "event_date": D1, **kw}


def err(fn, *a, **kw):
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    return info.value.status_code, info.value.detail


def setup(use_db, events=()):
    return use_db(FakeClient({"Event Details": list(events)}), eo)


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


@tc("BE-ORG-020", "create_event_request", "Valid draft is saved.", "A Draft row is inserted for the organiser and returned.",
    steps="1. Call create_event_request(\"o1\", make()).")
def test_create_draft(use_db):
    client = setup(use_db)
    out = eo.create_event_request("o1", make())
    assert out["status"] == "Draft" and out["organiser_id"] == "o1" and client.tables["Event Details"][0]["event_end_date"] == D1


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


@tc("BE-ORG-023", "create_submitted_event_request", "Valid request is submitted.", "Row inserted as Submitted then handed to assign_event; its view is returned.",
    pre="assign_event is stubbed.", steps="1. Call create_submitted_event_request(\"o1\", make()).")
def test_create_submitted(use_db, monkeypatch):
    client = setup(use_db)
    monkeypatch.setattr(eo, "assign_event", lambda event_id: {"assigned": event_id})
    out = eo.create_submitted_event_request("o1", make())
    assert client.tables["Event Details"][0]["status"] == "Submitted" and out == {"assigned": client.tables["Event Details"][0]["id"]}


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
