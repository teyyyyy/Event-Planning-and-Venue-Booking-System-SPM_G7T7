from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError

from coordinator_assignment import router
from event_organiser import router as event_organiser_router
from venue_request import router as venue_request_router
from venue_approval import router as venue_approval_router
from equipment_request import router as equipment_request_router
from equipment_update import router as equipment_update_router
from equipment_availability import router as equipment_availability_router
from venue_catalogue import router as venue_catalogue_router


app = FastAPI(title="Event Coordinator Assignment API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(event_organiser_router)
app.include_router(venue_request_router)
app.include_router(venue_approval_router)
app.include_router(equipment_request_router)
app.include_router(equipment_update_router)
app.include_router(equipment_availability_router)
app.include_router(venue_catalogue_router)


from database import request_actor
from attendee_registration import router as attendee_router
from notifications import router as notifications_router
from event_changes import router as event_changes_router

@app.middleware("http")
async def actor_context(request, call_next):
    token = request_actor.set({})
    try:
        return await call_next(request)
    finally:
        request_actor.reset(token)

app.include_router(attendee_router)
app.include_router(notifications_router)
app.include_router(event_changes_router)

# Database objects created by migrations, mapped to the file that creates them.
MIGRATION_OBJECTS = {
    "event_change_log": "significant_event_changes.sql",
    "process_event_change_request": "significant_event_changes.sql",
    "event_registrations": "sprint2_registration_notifications.sql",
    "notifications": "sprint2_registration_notifications.sql",
    "register_for_event": "sprint2_registration_notifications.sql",
    "submit_equipment_request": "sprint2_registration_notifications.sql",
}


@app.exception_handler(APIError)
async def database_api_error(request, error):
    missing_object = error.code in {"PGRST205", "PGRST202", "42P01", "42883"}
    migration = next(
        (file for name, file in MIGRATION_OBJECTS.items() if missing_object and name in error.message), None
    )
    message = (
        f"Database setup is incomplete. Run {migration} in the Supabase SQL Editor, then refresh."
        if migration else "The database request could not be completed. Please try again."
    )
    # A handled response retains CORS headers, so the UI can show the actual
    # failure instead of the browser masking an unhandled 500 as Failed to fetch.
    return JSONResponse(status_code=503, content={"detail": message})
