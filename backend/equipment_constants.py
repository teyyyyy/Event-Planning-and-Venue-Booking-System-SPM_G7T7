"""Shared constants for the equipment domain."""

# Database tables
EVENT_TABLE = "Event Details"
EQUIPMENT_TABLE = "Equipment"

REQUEST_TABLE = "Equipment Request"
REQUEST_ITEM_TABLE = "Equipment Request Item"

RESERVATION_TABLE = "Equipment Reservation"
RESERVATION_ITEM_TABLE = "Equipment Reservation Item"

USER_TABLE = "users"


# Reservation statuses that should count as active when checking
# whether equipment is already reserved.
ACTIVE_RESERVATION_STATUSES = {
    "reserved",
    "modified",
    "needs recheck",
}