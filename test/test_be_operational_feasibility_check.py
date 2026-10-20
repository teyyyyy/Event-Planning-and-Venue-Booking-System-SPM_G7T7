"""Unit tests for backend/operational_feasibility_check.py."""

import operational_feasibility_check as ofc

from eq_world import EVENT, err, world
from tc import tc


VENUE = {
    "venue_id": 1,
    "venue_name": "Seminar Room 1",
    "capacity": 100,
    "location": "School of Computing",
}

APPROVED_BOOKING = {
    "request_id": 1,
    "event_id": 1,
    "venue_id": 1,
    "status": "Approved",
}

RESERVED_EQUIPMENT = {
    "reservation_id": 1,
    "event_id": 1,
    "status": "Reserved",
}

SAFETY_OFFICER = {
    "id": "s1",
    "name": "Sam",
    "role": "Safety Officer",
    "email": "s@x",
}


def safety_world(**tables):
    data = {
        "Event Details": [dict(EVENT)],
        "Venue Booking Requests": [dict(APPROVED_BOOKING)],
        "Venues": [dict(VENUE)],
        "Equipment Reservation": [dict(RESERVED_EQUIPMENT)],
        "Operational Safety Check": [],
        "users": [dict(SAFETY_OFFICER)],
    }
    data.update(tables)
    return world(**data)


@tc(
    "BE-SAFETY-001",
    "event_is_ready_for_safety_check",
    "Venue and equipment arrangements are confirmed.",
    "Returns True.",
    pre="Venue Approved; equipment Reserved.",
    steps="1. Check whether event 1 is ready for safety review."
)
def test_event_ready():
    assert ofc.event_is_ready_for_safety_check(safety_world(), 1) is True


@tc(
    "BE-SAFETY-002",
    "event_is_ready_for_safety_check",
    "Venue booking is Pending.",
    "Returns False.",
    pre="Venue Pending; equipment Reserved.",
    steps="1. Check whether event 1 is ready for safety review.",
    kind="State"
)
def test_event_pending_venue():
    client = safety_world(**{
        "Venue Booking Requests": [
            {**APPROVED_BOOKING, "status": "Pending"}
        ]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is False


@tc(
    "BE-SAFETY-003",
    "event_is_ready_for_safety_check",
    "Equipment reservation requires recheck.",
    "Returns False.",
    pre="Venue Approved; equipment Needs Recheck.",
    steps="1. Check whether event 1 is ready for safety review.",
    kind="State"
)
def test_equipment_needs_recheck():
    client = safety_world(**{
        "Equipment Reservation": [
            {**RESERVED_EQUIPMENT, "status": "Needs Recheck"}
        ]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is False


@tc(
    "BE-SAFETY-004",
    "event_is_ready_for_safety_check",
    "Equipment reservation has been Modified.",
    "Returns True.",
    pre="Venue Approved; equipment Modified.",
    steps="1. Check whether event 1 is ready for safety review.",
    kind="State"
)
def test_modified_equipment_ready():
    client = safety_world(**{
        "Equipment Reservation": [
            {**RESERVED_EQUIPMENT, "status": "Modified"}
        ]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is True


@tc(
    "BE-SAFETY-005",
    "event_is_ready_for_safety_check",
    "Equipment reservation is Cancelled.",
    "Returns False.",
    pre="Venue Approved; equipment Cancelled.",
    steps="1. Check whether event 1 is ready for safety review.",
    kind="State"
)
def test_cancelled_equipment_not_ready():
    client = safety_world(**{
        "Equipment Reservation": [
            {**RESERVED_EQUIPMENT, "status": "Cancelled"}
        ]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is False


@tc(
    "BE-SAFETY-006",
    "get_event_for_safety_check",
    "Safety Officer opens an eligible event.",
    "Event, venue and equipment arrangements are returned.",
    pre="Venue Approved; equipment Reserved.",
    steps="1. Open event 1 for safety review."
)
def test_get_event_details(use_db):
    use_db(safety_world(), ofc)

    out = ofc.get_event_for_safety_check(1)

    assert out["event"]["id"] == 1
    assert out["event"]["event_name"] == "Gala"
    assert len(out["venue_bookings"]) == 1
    assert len(out["equipment_reservations"]) == 1


@tc(
    "BE-SAFETY-007",
    "get_event_for_safety_check",
    "Requested event does not exist.",
    "HTTP 404 Event not found.",
    data="event_id = 999",
    steps="1. Open event 999 for safety review.",
    kind="Negative"
)
def test_get_event_not_found(use_db):
    use_db(safety_world(), ofc)

    assert err(ofc.get_event_for_safety_check, 999) == (
        404,
        "Event not found."
    )


@tc(
    "BE-SAFETY-008",
    "get_event_for_safety_check",
    "Event arrangements are not confirmed.",
    "HTTP 400 saying the event is not ready.",
    pre="Venue Pending.",
    steps="1. Open event 1 for safety review.",
    kind="State"
)
def test_get_event_not_ready(use_db):
    client = safety_world(**{
        "Venue Booking Requests": [
            {**APPROVED_BOOKING, "status": "Pending"}
        ]
    })
    use_db(client, ofc)

    assert err(ofc.get_event_for_safety_check, 1) == (
        400,
        "Event is not ready for an Operational Safety Check."
    )


@tc(
    "BE-SAFETY-009",
    "get_event_for_safety_check",
    "Safety information not yet stored in the current schema.",
    "Unavailable safety fields are returned as None.",
    pre="Event is eligible for safety review.",
    steps="1. Open event 1. 2. Inspect unavailable safety fields.",
    kind="Edge"
)
def test_missing_safety_fields(use_db):
    use_db(safety_world(), ofc)

    out = ofc.get_event_for_safety_check(1)

    assert out["equipment_placement"] is None
    assert out["crowd_movement"] is None
    assert out["emergency_access"] is None
    assert out["venue_restrictions"] is None


@tc(
    "BE-SAFETY-010",
    "list_events_for_safety_check",
    "Eligible event has not been reviewed.",
    "Event appears in the Safety Officer review list.",
    pre="Venue Approved; equipment Reserved; no safety check.",
    steps="1. List events requiring safety review."
)
def test_list_eligible_event(use_db):
    use_db(safety_world(), ofc)

    out = ofc.list_events_for_safety_check()

    assert len(out) == 1
    assert out[0]["id"] == 1


@tc(
    "BE-SAFETY-011",
    "list_events_for_safety_check",
    "Event already has Safety Officer approval.",
    "Event is excluded from the review list.",
    pre="Event has an Approved Operational Safety Check.",
    steps="1. List events requiring safety review.",
    kind="State"
)
def test_list_excludes_approved(use_db):
    client = safety_world(**{
        "Operational Safety Check": [{
            "check_id": 1,
            "event_id": 1,
            "safety_officer_id": "s1",
            "status": "Approved",
            "comments": None,
        }]
    })
    use_db(client, ofc)

    assert ofc.list_events_for_safety_check() == []


@tc(
    "BE-SAFETY-012",
    "submit_safety_decision",
    "Safety Officer approves an eligible event.",
    "Safety check is stored and event moves to Preparation.",
    pre="Event is eligible and has no existing safety check.",
    data="decision = Approved",
    steps="1. Submit Approved. 2. Inspect safety check and event status."
)
def test_approve_event(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Approved",
        comments="Arrangements are safe."
    )

    out = ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert out["decision"] == "Approved"
    assert out["event_status"] == "Preparation"

    check = client.tables["Operational Safety Check"][0]
    assert check["event_id"] == 1
    assert check["safety_officer_id"] == "s1"
    assert check["status"] == "Approved"

    assert client.tables["Event Details"][0]["status"] == "Preparation"


@tc(
    "BE-SAFETY-013",
    "submit_safety_decision",
    "Safety Officer rejects an event with a reason.",
    "Safety check is stored and event returns to Planning.",
    data="decision = Rejected",
    steps="1. Submit Rejected with comments. 2. Inspect event status.",
    kind="State"
)
def test_reject_event(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Rejected",
        comments="Emergency access is insufficient."
    )

    out = ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert out["decision"] == "Rejected"
    assert out["event_status"] == "Planning"
    assert client.tables["Operational Safety Check"][0]["status"] == "Rejected"
    assert client.tables["Event Details"][0]["status"] == "Planning"


@tc(
    "BE-SAFETY-014",
    "submit_safety_decision",
    "Rejected decision has no comments.",
    "HTTP 400 requiring comments.",
    data="decision = Rejected, comments blank",
    steps="1. Submit Rejected without comments.",
    kind="Negative"
)
def test_reject_requires_comments(use_db):
    use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Rejected",
        comments="   "
    )

    assert err(
        ofc.submit_safety_decision,
        1,
        request,
        SAFETY_OFFICER
    ) == (
        400,
        "Comments are required when rejecting or requesting changes."
    )


@tc(
    "BE-SAFETY-015",
    "submit_safety_decision",
    "Safety Officer requests changes with a reason.",
    "Safety check is stored and event returns to Planning.",
    data="decision = Changes Requested",
    steps="1. Submit Changes Requested. 2. Inspect event status.",
    kind="State"
)
def test_request_changes(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Changes Requested",
        comments="Please revise the venue layout."
    )

    out = ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert out["decision"] == "Changes Requested"
    assert out["event_status"] == "Planning"
    assert client.tables["Operational Safety Check"][0]["status"] == "Changes Requested"


@tc(
    "BE-SAFETY-016",
    "submit_safety_decision",
    "Changes Requested has no comments.",
    "HTTP 400 requiring comments.",
    data="decision = Changes Requested, comments omitted",
    steps="1. Submit Changes Requested without comments.",
    kind="Negative"
)
def test_request_changes_requires_comments(use_db):
    use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Changes Requested"
    )

    assert err(
        ofc.submit_safety_decision,
        1,
        request,
        SAFETY_OFFICER
    )[0] == 400


@tc(
    "BE-SAFETY-017",
    "submit_safety_decision",
    "Decision is submitted for a missing event.",
    "HTTP 404 Event not found.",
    data="event_id = 999",
    steps="1. Submit a decision for event 999.",
    kind="Negative"
)
def test_decision_event_not_found(use_db):
    use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Approved"
    )

    assert err(
        ofc.submit_safety_decision,
        999,
        request,
        SAFETY_OFFICER
    ) == (
        404,
        "Event not found."
    )


@tc(
    "BE-SAFETY-018",
    "submit_safety_decision",
    "Decision is submitted before arrangements are confirmed.",
    "HTTP 400 and no safety check is created.",
    pre="Equipment reservation Needs Recheck.",
    steps="1. Submit Approved. 2. Confirm no safety check was stored.",
    kind="State"
)
def test_decision_not_ready(use_db):
    client = safety_world(**{
        "Equipment Reservation": [
            {**RESERVED_EQUIPMENT, "status": "Needs Recheck"}
        ]
    })
    use_db(client, ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Approved"
    )

    assert err(
        ofc.submit_safety_decision,
        1,
        request,
        SAFETY_OFFICER
    )[0] == 400

    assert client.tables["Operational Safety Check"] == []


@tc(
    "BE-SAFETY-019",
    "submit_safety_decision",
    "Event has an existing safety check and is reviewed again.",
    "Existing row is updated instead of creating a duplicate.",
    pre="Existing Changes Requested safety check.",
    data="new decision = Approved",
    steps="1. Submit Approved. 2. Confirm the existing row is updated.",
    kind="State"
)
def test_existing_check_updated(use_db):
    client = safety_world(**{
        "Operational Safety Check": [{
            "check_id": 5,
            "event_id": 1,
            "safety_officer_id": "s1",
            "status": "Changes Requested",
            "comments": "Old comment",
        }]
    })
    use_db(client, ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Approved",
        comments="Updated arrangements are safe."
    )

    ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    checks = client.tables["Operational Safety Check"]

    assert len(checks) == 1
    assert checks[0]["check_id"] == 5
    assert checks[0]["status"] == "Approved"
    assert checks[0]["comments"] == "Updated arrangements are safe."


@tc(
    "BE-SAFETY-020",
    "submit_safety_decision",
    "Approved decision omits comments.",
    "Approval is accepted and comments are stored as None.",
    data="decision = Approved, comments omitted",
    steps="1. Submit Approved without comments.",
    kind="Edge"
)
def test_approve_without_comments(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Approved"
    )

    ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert client.tables["Operational Safety Check"][0]["comments"] is None