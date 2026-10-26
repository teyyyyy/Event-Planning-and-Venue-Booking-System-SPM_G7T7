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
        self.rows = [r.copy() for r in rows] if rows else []
        self.patch = None
        self.single = False

    def select(self, *_): return self
    def eq(self, key, value): self.rows = [r for r in self.rows if r.get(key) == value]; return self
    def neq(self, key, value): self.rows = [r for r in self.rows if r.get(key) != value]; return self
    def in_(self, key, values): self.rows = [r for r in self.rows if r.get(key) in values]; return self
    def maybe_single(self): self.single = True; return self
    def update(self, patch): self.patch = patch; return self

    def execute(self):
        if self.patch is not None:
            for row in self.rows:
                row.update(self.patch)
            return mock.Mock(data=self.rows[0] if (self.single and self.rows) else self.rows)
        if self.single:
            return mock.Mock(data=self.rows[0] if self.rows else None)
        return mock.Mock(data=self.rows)


class FakeClient:
    def __init__(self, bookings=None, venues=None, events=None): 
        self.bookings = bookings or []
        self.venues = venues or []
        self.events = events or []
        
    def table(self, name): 
        # Case-insensitive match to handle both "venues" and "Venues"
        if name.lower() == "venues":
            return FakeQuery(self.venues)
        if name == "Event Details":
            return FakeQuery(self.events)
            
        # Otherwise, fall back to returning bookings.
        return FakeQuery(self.bookings)


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

    def test_includes_setup_and_teardown_hours_from_venue(self):
        venue = {"setup_time": 2, "teardown_time": 1}
        result = venue_approval.view(BOOKING, {}, venue, {})
        self.assertEqual(result["setup_time"], 2)
        self.assertEqual(result["teardown_time"], 1)

    def test_missing_setup_and_teardown_hours_remain_unset(self):
        result = venue_approval.view(BOOKING, {}, {}, {})
        self.assertIsNone(result["setup_time"])
        self.assertIsNone(result["teardown_time"])


class DecisionTests(unittest.TestCase):
    def run_decide(self, booking, staff, changes, existing_bookings=None, venues=None, events=None):
        existing = existing_bookings or []
        v = venues or [{"venue_id": booking.get("venue_id", 1), "setup_time": 0, "teardown_time": 0}]
        
        client = FakeClient(bookings=[booking] + existing, venues=v, events=events)
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

    # --- Overlap Buffer AC Tests ---

    def test_approve_fails_on_core_overlap(self):
        existing = {**BOOKING, "request_id": 2, "status": "Approved", 
                    "start_datetime": "2026-10-03T11:00:00+00:00", "end_datetime": "2026-10-03T13:00:00+00:00"}
        target = {**BOOKING, "request_id": 1, "start_datetime": "2026-10-03T10:00:00+00:00", "end_datetime": "2026-10-03T12:00:00+00:00"}
        
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide(target, STAFF, {"status": "Approved"}, existing_bookings=[existing])
        self.assertEqual(ctx.exception.status_code, 409)

    def test_approve_fails_on_setup_buffer_overlap(self):
        # Target: 10:00 to 12:00.
        # Existing: 12:30 to 14:00, but has 60 mins setup time -> effective start 11:30. Overlaps target's end (12:00).
        existing = {**BOOKING, "request_id": 2, "status": "Approved",
                    "start_datetime": "2026-10-03T12:30:00+00:00", "end_datetime": "2026-10-03T14:00:00+00:00"}
        target = {**BOOKING, "request_id": 1, "start_datetime": "2026-10-03T10:00:00+00:00", "end_datetime": "2026-10-03T12:00:00+00:00"}
        venues = [{"venue_id": 1, "setup_time": 60, "teardown_time": 0}]
        
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide(target, STAFF, {"status": "Approved"}, existing_bookings=[existing], venues=venues)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_approve_fails_on_teardown_buffer_overlap(self):
        # Target: 10:00 to 12:00.
        # Existing: 08:00 to 09:30, but has 60 mins teardown time -> effective end 10:30. Overlaps target's start (10:00).
        existing = {**BOOKING, "request_id": 2, "status": "Approved",
                    "start_datetime": "2026-10-03T08:00:00+00:00", "end_datetime": "2026-10-03T09:30:00+00:00"}
        target = {**BOOKING, "request_id": 1, "start_datetime": "2026-10-03T10:00:00+00:00", "end_datetime": "2026-10-03T12:00:00+00:00"}
        venues = [{"venue_id": 1, "setup_time": 0, "teardown_time": 60}]
        
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide(target, STAFF, {"status": "Approved"}, existing_bookings=[existing], venues=venues)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_reject_ignores_overlaps(self):
        # Target: 10:00 to 12:00. Existing: 11:00 to 13:00. Exact same overlap as core overlap test.
        existing = {**BOOKING, "request_id": 2, "status": "Approved", 
                    "start_datetime": "2026-10-03T11:00:00+00:00", "end_datetime": "2026-10-03T13:00:00+00:00"}
        target = {**BOOKING, "request_id": 1, "start_datetime": "2026-10-03T10:00:00+00:00", "end_datetime": "2026-10-03T12:00:00+00:00"}
        
        # Should not raise 409, because overlap checking is skipped on rejection
        result = self.run_decide(target, STAFF, {"status": "Rejected"}, existing_bookings=[existing])
        self.assertEqual(result["status"], "Rejected")

    # --- Times from Event Details (the live booking table has no start/end columns) ---

    @staticmethod
    def event_booking(request_id, event_id, status):
        return {"request_id": request_id, "venue_id": 1, "event_id": event_id, "status": status,
                "venue_staff_id": "staff-1", "coordinator_id": "c1"}

    @staticmethod
    def event(event_id, day, start, end, end_day=None):
        return {"id": event_id, "event_date": day, "event_end_date": end_day, "start_time": start, "end_time": end}

    def test_approve_fails_on_overlap_from_event_times(self):
        target = self.event_booking(1, 10, "Pending")
        existing = self.event_booking(2, 20, "Approved")
        events = [self.event(10, "2026-10-03", "10:00:00", "12:00:00"), self.event(20, "2026-10-03", "11:00:00", "13:00:00")]
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide(target, STAFF, {"status": "Approved"}, existing_bookings=[existing], events=events)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_approve_fails_on_second_day_of_multi_day_event(self):
        target = self.event_booking(1, 10, "Pending")
        existing = self.event_booking(2, 20, "Approved")
        events = [self.event(10, "2026-10-04", "10:00:00", "12:00:00"),
                  self.event(20, "2026-10-03", "09:00:00", "17:00:00", end_day="2026-10-05")]
        with self.assertRaises(HTTPException) as ctx:
            self.run_decide(target, STAFF, {"status": "Approved"}, existing_bookings=[existing], events=events)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_approve_allows_separate_event_times(self):
        target = self.event_booking(1, 10, "Pending")
        existing = self.event_booking(2, 20, "Approved")
        events = [self.event(10, "2026-10-03", "10:00:00", "12:00:00"), self.event(20, "2026-10-03", "13:00:00", "15:00:00")]
        result = self.run_decide(target, STAFF, {"status": "Approved"}, existing_bookings=[existing], events=events)
        self.assertEqual(result["status"], "Approved")


if __name__ == "__main__":
    unittest.main()