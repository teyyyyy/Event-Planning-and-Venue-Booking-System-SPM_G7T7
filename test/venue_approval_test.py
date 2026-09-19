"""Unit tests for venue approval logic (no database needed)."""

import sys
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import venue_approval  # noqa: E402

STAFF = {"id": "staff-1"}
BOOKING = {
    "request_id": 1, "venue_id": 1, "event_id": 10, "status": "Pending", "venue_staff_id": "staff-1",
    "coordinator_id": "c1", "start_datetime": "2026-10-03T08:00:00+00:00", "end_datetime": "2026-10-03T18:00:00+00:00",
    "accessibility_required": 1, "layout_required": "Theatre", "facilities_required": ["Parking"],
}


class FakeQuery:
    def __init__(self, rows):
        self.rows, self.patch = rows, None

    def select(self, *_): return self
    def eq(self, key, value): self.rows = [r for r in self.rows if r.get(key) == value]; return self
    def maybe_single(self): return self
    def update(self, patch): self.patch = patch; return self

    def execute(self):
        if self.patch is not None:
            for row in self.rows:
                row.update(self.patch)
            return mock.Mock(data=self.rows)
        return mock.Mock(data=self.rows[0] if self.rows else None)


class FakeClient:
    def __init__(self, bookings): self.bookings = bookings
    def table(self, name): return FakeQuery(self.bookings)


class ViewTests(unittest.TestCase):
    def test_falls_back_to_booking_values_when_event_has_none(self):
        result = venue_approval.view(BOOKING, {"event_name": "Gala"}, None, {})
        self.assertEqual(result["start_datetime"], "2026-10-03T16:00:00+08:00")  # 08:00 UTC -> SGT
        self.assertTrue(result["accessibility_required"])
        self.assertEqual(result["venue_name"], "Venue 1")

    def test_multi_day_event_uses_end_date(self):
        event = {"event_date": "2026-10-03", "event_end_date": "2026-10-05", "start_time": "09:00:00", "end_time": "17:00:00"}
        result = venue_approval.view(BOOKING, event, None, {})
        self.assertEqual(result["start_datetime"], "2026-10-03T09:00:00+08:00")
        self.assertEqual(result["end_datetime"], "2026-10-05T17:00:00+08:00")

    def test_event_details_take_priority(self):
        event = {"event_date": "2026-10-04", "start_time": "09:00:00", "end_time": "12:00:00", "accessibility_required": False}
        result = venue_approval.view(BOOKING, event, {"venue_name": "Hall A"}, {})
        self.assertEqual(result["start_datetime"], "2026-10-04T09:00:00+08:00")
        self.assertEqual(result["end_datetime"], "2026-10-04T12:00:00+08:00")
        self.assertFalse(result["accessibility_required"])
        self.assertEqual(result["venue_name"], "Hall A")


class DecisionTests(unittest.TestCase):
    def run_decide(self, booking, staff, changes):
        client = FakeClient([booking])
        with mock.patch.object(venue_approval, "db", return_value=client), mock.patch.object(venue_approval, "enrich", side_effect=lambda c, rows: rows):
            return venue_approval.decide(1, staff, changes)

    def test_approve_pending(self):
        result = self.run_decide(dict(BOOKING), STAFF, {"status": "Approved"})
        self.assertEqual(result["status"], "Approved")

    def test_reject_stores_optional_fields(self):
        with mock.patch.object(venue_approval, "decide") as decide:
            venue_approval.reject_request(1, venue_approval.RejectionDetails(reason="  Double booked ", alternative_venue=" "), STAFF)
        changes = decide.call_args.args[2]
        self.assertEqual(changes["rejection_reason"], "Double booked")
        self.assertIsNone(changes["alternative_venue"])

    def test_reject_without_body_is_allowed(self):
        with mock.patch.object(venue_approval, "decide") as decide:
            venue_approval.reject_request(1, None, STAFF)
        self.assertEqual(decide.call_args.args[2]["status"], "Rejected")

    def test_cannot_decide_twice(self):
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide({**BOOKING, "status": "Approved"}, STAFF, {"status": "Rejected"})
        self.assertEqual(ctx.exception.status_code, 409)

    def test_other_staff_forbidden(self):
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide(dict(BOOKING), {"id": "someone-else"}, {"status": "Approved"})
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
