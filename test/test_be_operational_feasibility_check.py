"""Unit tests for backend/operational_feasibility_check.py."""

import operational_feasibility_check as ofc

from eq_world import EVENT, err, world
from tc import tc


VENUE = {
    "venue_id": 1,
    "venue_name": "Seminar Room 1",
    "capacity": 100,
    "location": "School of Computing",
    "emergency_access": "Emergency exit beside the main entrance.",
    "venue_restrictions": "Keep emergency exits clear.",
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
        "Event Details": [{
            **EVENT,
            "equipment_placement": "Near the stage.",
            "crowd_movement": "Keep the center aisle clear.",
        }],
        "Venue Booking Requests": [dict(APPROVED_BOOKING)],
        "Venues": [dict(VENUE)],
        "Equipment Reservation": [dict(RESERVED_EQUIPMENT)],
        "event_change_log": [],
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
    "Returns False because only Reserved equipment is ready for safety review.",
    pre="Venue Approved; equipment Modified.",
    steps="1. Check whether event 1 is ready for safety review.",
    kind="State"
)
def test_modified_equipment_not_ready():
    client = safety_world(**{
        "Equipment Reservation": [
            {**RESERVED_EQUIPMENT, "status": "Modified"}
        ]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is False


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
    "Safety Officer opens an eligible event with safety information.",
    "Current safety information and venue safety details are returned.",
    pre="Event is eligible for safety review.",
    steps="1. Open event 1. 2. Inspect safety information."
)
def test_safety_fields_returned(use_db):
    use_db(safety_world(), ofc)

    out = ofc.get_event_for_safety_check(1)

    assert out["equipment_placement"] == "Near the stage."
    assert out["crowd_movement"] == "Keep the center aisle clear."
    assert out["emergency_access"] == ["Emergency exit beside the main entrance."]
    assert out["venue_restrictions"] == ["Keep emergency exits clear."]


@tc(
    "BE-SAFETY-010",
    "list_events_for_safety_check",
    "Eligible event has not been reviewed.",
    "Event appears in the Safety Officer review list.",
    pre="Venue Approved; equipment Reserved; no safety decision.",
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
    pre="Event has an Approved safety decision.",
    steps="1. List events requiring safety review.",
    kind="State"
)
def test_list_excludes_approved(use_db):
    client = safety_world(**{
        "Event Details": [{
            **EVENT,
            "equipment_placement": "Near the stage.",
            "crowd_movement": "Keep the center aisle clear.",
            "safety_decision_status": "Approved",
            "safety_officer_id": "s1",
            "safety_comments": "Safe.",
            "safety_decided_at": "2026-11-01T10:00:00+00:00",
        }]
    })
    use_db(client, ofc)

    assert ofc.list_events_for_safety_check() == []


@tc(
    "BE-SAFETY-012",
    "submit_safety_decision",
    "Safety Officer approves an eligible event.",
    "Safety decision is stored with the event and event moves to Confirmed.",
    pre="Event is eligible and has no existing safety decision.",
    data="decision = Approved",
    steps="1. Submit Approved. 2. Inspect safety decision and event status."
)
def test_approve_event(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Approved",
        comments="Arrangements are safe."
    )

    out = ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert out["decision"] == "Approved"
    assert out["event_status"] == "Confirmed"
    assert out["affected_arrangements"] == []

    event = client.tables["Event Details"][0]
    assert event["status"] == "Confirmed"
    assert event["safety_decision_status"] == "Approved"
    assert event["safety_officer_id"] == "s1"
    assert event["safety_comments"] == "Arrangements are safe."
    assert event["safety_affected_arrangements"] is None


@tc(
    "BE-SAFETY-013",
    "submit_safety_decision",
    "Safety Officer rejects an event with a reason.",
    "Safety decision is stored and event returns to Planning without changing venue or equipment arrangements.",
    data="decision = Rejected",
    steps="1. Submit Rejected with comments. 2. Inspect event and arrangement statuses.",
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
    assert out["affected_arrangements"] == []

    event = client.tables["Event Details"][0]
    assert event["status"] == "Planning"
    assert event["safety_decision_status"] == "Rejected"
    assert event["safety_comments"] == "Emergency access is insufficient."
    assert client.tables["Venue Booking Requests"][0]["status"] == "Approved"
    assert client.tables["Equipment Reservation"][0]["status"] == "Reserved"


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
    "Safety Officer requests venue changes with a reason.",
    "Safety decision is stored and event returns to Planning while existing arrangements remain unchanged.",
    data="decision = Changes Requested; affected_arrangements = Venue",
    steps="1. Submit Changes Requested. 2. Inspect event and arrangement statuses.",
    kind="State"
)
def test_request_changes(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Changes Requested",
        comments="Please revise the venue layout.",
        affected_arrangements=["Venue"]
    )

    out = ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert out["decision"] == "Changes Requested"
    assert out["event_status"] == "Planning"
    assert out["affected_arrangements"] == ["Venue"]

    event = client.tables["Event Details"][0]
    assert event["status"] == "Planning"
    assert event["safety_decision_status"] == "Changes Requested"
    assert event["safety_affected_arrangements"] == ["Venue"]
    assert client.tables["Venue Booking Requests"][0]["status"] == "Approved"
    assert client.tables["Equipment Reservation"][0]["status"] == "Reserved"


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
        decision="Changes Requested",
        affected_arrangements=["Venue"]
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
    "HTTP 400 and no safety decision is stored.",
    pre="Equipment reservation Needs Recheck.",
    steps="1. Submit Approved. 2. Confirm no safety decision was stored.",
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

    event = client.tables["Event Details"][0]
    assert event.get("safety_decision_status") is None


@tc(
    "BE-SAFETY-019",
    "event_is_ready_for_safety_check",
    "Event was rejected and the organiser has not revised the safety information.",
    "Returns False until safety information is changed after the rejection.",
    pre="Safety decision Rejected; no later safety-information change.",
    steps="1. Check whether the rejected event is ready for another safety review.",
    kind="State"
)
def test_rejected_event_requires_safety_revision():
    client = safety_world(**{
        "Event Details": [{
            **EVENT,
            "equipment_placement": "Near the stage.",
            "crowd_movement": "Keep the center aisle clear.",
            "safety_decision_status": "Rejected",
            "safety_officer_id": "s1",
            "safety_comments": "Revise the safety information.",
            "safety_decided_at": "2026-11-01T10:00:00+00:00",
        }]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is False


@tc(
    "BE-SAFETY-020",
    "event_is_ready_for_safety_check",
    "Event was rejected and the organiser revises safety information afterwards.",
    "Returns True because the event may be reviewed again.",
    pre="Safety decision Rejected; equipment_placement changed after rejection.",
    steps="1. Record a later safety-information change. 2. Check whether the event is ready again.",
    kind="State"
)
def test_rejected_event_ready_after_safety_revision():
    client = safety_world(**{
        "Event Details": [{
            **EVENT,
            "equipment_placement": "Near the stage.",
            "crowd_movement": "Keep the center aisle clear.",
            "safety_decision_status": "Rejected",
            "safety_officer_id": "s1",
            "safety_comments": "Revise the safety information.",
            "safety_decided_at": "2026-11-01T10:00:00+00:00",
        }],
        "event_change_log": [{
            "id": 1,
            "event_id": 1,
            "changed_fields": ["equipment_placement"],
            "created_at": "2026-11-01T11:00:00+00:00",
        }]
    })

    assert ofc.event_is_ready_for_safety_check(client, 1) is True


@tc(
    "BE-SAFETY-021",
    "submit_safety_decision",
    "Changes Requested has comments but no affected arrangement selected.",
    "HTTP 400 requiring Venue, Equipment, or both.",
    data="decision = Changes Requested; affected_arrangements omitted",
    steps="1. Submit Changes Requested without selecting an affected arrangement.",
    kind="Negative"
)
def test_request_changes_requires_affected_arrangement(use_db):
    use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Changes Requested",
        comments="Please revise the arrangements."
    )

    assert err(
        ofc.submit_safety_decision,
        1,
        request,
        SAFETY_OFFICER
    ) == (
        400,
        "Select whether the requested changes affect Venue, Equipment, or both."
    )


@tc(
    "BE-SAFETY-022",
    "submit_safety_decision",
    "Changes Requested selects both Venue and Equipment with a duplicate selection.",
    "Duplicate affected arrangements are removed and both arrangements are stored.",
    data="affected_arrangements = Venue, Equipment, Venue",
    steps="1. Submit Changes Requested with duplicate selections. 2. Inspect stored affected arrangements.",
    kind="Edge"
)
def test_request_changes_deduplicates_affected_arrangements(use_db):
    client = use_db(safety_world(), ofc)

    request = ofc.SafetyDecisionRequest(
        decision="Changes Requested",
        comments="Please revise both arrangements.",
        affected_arrangements=["Venue", "Equipment", "Venue"]
    )

    out = ofc.submit_safety_decision(1, request, SAFETY_OFFICER)

    assert out["affected_arrangements"] == ["Venue", "Equipment"]
    assert client.tables["Event Details"][0]["safety_affected_arrangements"] == ["Venue", "Equipment"]


@tc(
    "BE-SAFETY-023",
    "get_safety_check",
    "Event contains a stored safety decision.",
    "Safety decision details are returned from the event.",
    steps="1. Call get_safety_check with stored safety fields."
)
def test_get_safety_check_from_event():
    event = {
        **EVENT,
        "safety_decision_status": "Changes Requested",
        "safety_officer_id": "s1",
        "safety_comments": "Please revise the venue.",
        "safety_affected_arrangements": ["Venue"],
        "safety_decided_at": "2026-11-01T10:00:00+00:00",
    }

    assert ofc.get_safety_check(event) == {
        "event_id": 1,
        "safety_officer_id": "s1",
        "status": "Changes Requested",
        "comments": "Please revise the venue.",
        "affected_arrangements": ["Venue"],
        "decided_at": "2026-11-01T10:00:00+00:00",
    }


@tc(
    "BE-SAFETY-024",
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

    assert client.tables["Event Details"][0]["safety_comments"] is None