"""Shared constants for venue booking requests.

These statuses are the only values the venue_booking_requests_status_check constraint
(backend/sql/venue_booking_statuses.sql) accepts, in this exact case.
"""

PENDING, ON_HOLD, APPROVED, EXPIRED = "Pending", "On Hold", "Approved", "Expired"
REJECTED, ALTERNATIVE_OFFERED, SUPERSEDED = "Rejected", "Alternative Offered", "Superseded"
CANCELLED = "Cancelled"  # set by the database when the request's event is cancelled

VENUE_BOOKING_STATUSES = {
    PENDING, ON_HOLD, APPROVED, EXPIRED, REJECTED, ALTERNATIVE_OFFERED, SUPERSEDED, CANCELLED,
}
# History: a closed request is never reopened, replaced or counted as using its venue.
CLOSED_VENUE_STATUSES = {REJECTED, SUPERSEDED, EXPIRED, CANCELLED}

STATUS_CHECK_CONSTRAINT = "venue_booking_requests_status_check"
