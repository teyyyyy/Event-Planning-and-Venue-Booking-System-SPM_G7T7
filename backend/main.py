from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from coordinator_assignment import router
from event_organiser import router as event_organiser_router

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
