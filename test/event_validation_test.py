"""Unit tests for event schedule validation (no database needed)."""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import event_organiser as eo  # noqa: E402

D = [(date.today() + timedelta(days=n)).isoformat() for n in (1, 2, 3)]


def make(**overrides):
    fields = dict(event_name="x", event_type="Workshop", event_date=D[0], event_capacity=10, description="x", start_time="09:00", end_time="17:00")
    return eo.EventRequest(**{**fields, **overrides})


class ValidationTests(unittest.TestCase):
    def fails(self, **overrides):
        with self.assertRaises(HTTPException):
            eo.validate_request(make(**overrides))

    def test_single_day_unchanged(self):
        eo.validate_request(make())
        self.fails(end_time="09:00")

    def test_multi_day_allows_earlier_end_time(self):
        eo.validate_request(make(event_end_date=D[2], end_time="12:00"))

    def test_end_date_before_start_rejected(self):
        self.fails(event_date=D[1], event_end_date=D[0])

    def test_end_date_defaults_to_start(self):
        self.assertEqual(eo.request_data(make())["event_end_date"], D[0])
        self.assertEqual(eo.request_data(make(event_end_date=""))["event_end_date"], D[0])


if __name__ == "__main__":
    unittest.main()
