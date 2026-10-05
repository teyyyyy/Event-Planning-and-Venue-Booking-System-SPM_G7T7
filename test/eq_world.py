"""Shared fixture data for the equipment backend tests."""

import pytest
from fastapi import HTTPException

from fake_supabase import FakeClient

EVENT = {"id": 1, "event_name": "Gala", "event_date": "2026-10-01", "start_time": "09:00:00", "end_time": "17:00:00",
         "status": "Approved", "coordinator_id": "c1"}
EQUIPMENT = [
    {"equipment_id": "MIC", "equipment_name": "Microphone", "total_quantity": 10, "under_maintenance_count": 2},
    {"equipment_id": "PRJ", "equipment_name": "Projector", "total_quantity": 3, "under_maintenance_count": 0},
]
USERS = [
    {"id": "c1", "name": "Cara", "role": "Event Coordinator", "email": "c@x"},
    {"id": "t1", "name": "Tom", "role": "Technical Support Staff", "email": "t@x"},
    {"id": "v1", "name": "Vic", "role": "Venue Staff", "email": "v@x"},
]


def world(**tables):
    data = {
        "Event Details": [dict(EVENT)], "Equipment": [dict(e) for e in EQUIPMENT], "users": [dict(u) for u in USERS],
        "Equipment Request": [], "Equipment Request Item": [], "Equipment Reservation": [], "Equipment Reservation Item": [],
    }
    data.update(tables)
    return FakeClient(data)


def reservation(rid=1, eid="MIC", qty=3, start="2026-10-01T10:00:00", end="2026-10-01T12:00:00", status="Active", event_id=99):
    return {"Equipment Reservation": [{"reservation_id": rid, "status": status, "event_id": event_id}],
            "Equipment Reservation Item": [{"reservation_id": rid, "equipment_id": eid, "reserved_quantity": qty,
                                            "start_datetime": start, "end_datetime": end}]}


def err(fn, *a, **kw):
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    return info.value.status_code, info.value.detail
