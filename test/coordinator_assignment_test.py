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

ORGANISER_ID = "3962522c-b370-4614-9422-22ee15e66f96"
ORGANISER_2_ID = "f45d6f0b-8341-4f5a-b16e-f3f373bb3d4b"
COORDINATOR_IDS = {
    "3d88ed4c-5155-4c62-ade9-34d670430721",  # Coordinator 3
    "9c68a543-226c-4887-a7ce-067f19358015",  # Coordinator 1
    "9f9fb6a6-aec2-4fd8-801b-18e04f79fe09",  # Coordinator 2
}


def main():
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/").removesuffix("/rest/v1")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the root .env")

    client = create_client(url, key)
    organiser_id = ORGANISER_ID
    coordinators = (
        client.table("users")
        .select("id,name,role")
        .in_("id", list(COORDINATOR_IDS))
        .order("name")
        .execute()
        .data
        or []
    )
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

    organiser_2_event = client.table("Event Details").insert({
        "event_name": "Organiser 2 Assignment Test",
        "event_date": (date.today() + timedelta(days=8)).isoformat(),
        "status": "Pending assignment",
        "organiser_id": ORGANISER_2_ID,
    }).select("id,event_name").execute().data[0]
    organiser_2_result = assign_event(organiser_2_event["id"])
    print(
        f"PASS Organiser 2: {organiser_2_event['event_name']} -> "
        f"{organiser_2_result['coordinator_name']}"
    )


if __name__ == "__main__":
    main()
