"""Create and verify seven sequential coordinator assignments."""

import os
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from coordinator_assignment import active_workloads, assign_event  # noqa: E402


def main():
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/").removesuffix("/rest/v1")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the root .env")

    client = create_client(url, key)
    organiser_id = "00000000-0000-0000-0000-000000000001"
    coordinators = client.table("users").select("id,name,role").eq("role", "Event Coordinator").order("name").execute().data or []
    if len(coordinators) != 3:
        raise AssertionError(f"Expected 3 coordinators, found {len(coordinators)}")

    for number in range(1, 8):
        event = client.table("Event Details").insert({
            "event_name": f"Sequential Assignment Test {number}",
            "event_date": (date.today() + timedelta(days=number)).isoformat(),
            "status": "Pending assignment",
            "organiser_id": organiser_id,
        }).select("id,event_name").execute().data[0]

        before = active_workloads(client, coordinators)
        expected = min(coordinators, key=lambda item: (before[item["id"]], item["name"]))
        result = assign_event(event["id"])

        if result["assigned_coordinator_id"] != expected["id"]:
            raise AssertionError(
                f"{event['event_name']}: expected {expected['name']} based on {before}, "
                f"got {result['coordinator_name']}"
            )
        print(f"PASS {number}/7: {event['event_name']} -> {result['coordinator_name']} | before: {before}")

    print("All 7 assignments selected the coordinator with the lowest active workload.")


if __name__ == "__main__":
    main()
