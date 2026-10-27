import React, { useEffect, useState } from "react";
import { request } from "./api";
import EventChangeHistory from "./EventChangeHistory";

// The API returns SGT (+08:00) timestamps, so slicing the string keeps them in SGT.
const formatDateTime = (value) =>
  typeof value === "string"
    ? `${value.replace("T", " ").slice(0, 16)} SGT`
    : "—";

// Helper to format timestamps to 12-hour time (e.g., 10:30 AM)
const formatTime = (ms) => {
  const d = new Date(ms);
  let hours = d.getHours();
  let minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
};

// "On Hold" -> "on-hold", for the status pill classes.
const statusClass = (status) => status.toLowerCase().replace(/\s+/g, "-");

// The current SGT time as a datetime-local value, the earliest a hold may expire.
const sgtNowInput = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);

const eventLabel = (booking) => booking.event_name || `event #${booking.event_id}`;

function Detail({ label, children }) {
  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}

function RequestDetail({
  booking,
  busy,
  overlapInfo,
  onApprove,
  onReject,
  onPlaceHold,
  onRemoveHold,
  onClose,
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [alternativeVenue, setAlternativeVenue] = useState("");
  const [placingHold, setPlacingHold] = useState(false);
  const [holdUntil, setHoldUntil] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const pending = booking.status === "Pending";
  const held = booking.status === "On Hold";
  const expired = booking.status === "Expired";
  // A held request is still awaiting a decision: approval confirms it, rejection releases it.
  const decidable = pending || held;

  // We can approve if there is no overlap, OR if the only overlap is with another pending request
  const canApprove =
    (overlapInfo?.type === "none" || overlapInfo?.type === "pending") &&
    !overlapInfo?.loading && !booking.replacement_required && booking.is_available !== false;

  let bannerStyle = {
    marginTop: "16px",
    marginBottom: "16px",
    padding: "12px",
    borderRadius: "6px",
    border: "1px solid",
  };

  if (overlapInfo?.loading) {
    bannerStyle = {
      ...bannerStyle,
      backgroundColor: "#f8f9fa",
      color: "#6c757d",
      borderColor: "#dee2e6",
    };
  } else if (overlapInfo?.type === "none") {
    bannerStyle = {
      ...bannerStyle,
      backgroundColor: "#d4edda",
      color: "#155724",
      borderColor: "#c3e6cb",
    };
  } else if (overlapInfo?.type === "pending") {
    bannerStyle = {
      ...bannerStyle,
      backgroundColor: "#fff3cd",
      color: "#856404",
      borderColor: "#ffeeba",
    };
  } else {
    bannerStyle = {
      ...bannerStyle,
      backgroundColor: "#f8d7da",
      color: "#721c24",
      borderColor: "#f5c6cb",
    };
  }

  return (
    <section
      className="detail-panel"
      aria-label="Venue booking request details"
    >
      <div className="detail-head">
        <h2>{booking.event_name || `Event #${booking.event_id}`}</h2>
        <button className="assign" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="detail-grid">
        <Detail label="Status">
          <span className={`pill status-${statusClass(booking.status)}`}>
            {booking.status}{booking.replacement_required ? " — replacement venue required" : ""}
          </span>
        </Detail>
        {(held || expired) && (
          <Detail label={held ? "Hold expires" : "Hold expired"}>
            {formatDateTime(booking.hold_expires_at)}
          </Detail>
        )}
        {booking.change_request_id && (
          <Detail label="Event change">
            New request for approved change request #{booking.change_request_id}
          </Detail>
        )}
        <Detail label="Venue">{booking.venue_name}</Detail>
        <Detail label="Start">{formatDateTime(booking.start_datetime)}</Detail>
        <Detail label="End">{formatDateTime(booking.end_datetime)}</Detail>
        <Detail label="Accessibility required">
          {booking.accessibility_required ? "Yes" : "No"}
        </Detail>
        <Detail label="Layout">{booking.layout_required}</Detail>
        <Detail label="Facilities">
          {booking.facilities_required?.join(", ")}
        </Detail>
        <Detail label="Event type">{booking.event_type}</Detail>
        <Detail label="Expected capacity">{booking.event_capacity}</Detail>
        <Detail label="Event coordinator">
          {booking.coordinator_name &&
            `${booking.coordinator_name}${booking.coordinator_email ? ` (${booking.coordinator_email})` : ""}`}
        </Detail>
        <Detail label="Event description">{booking.event_description}</Detail>
        {booking.status === "Rejected" && (
          <>
            <Detail label="Reason for rejection">
              {booking.rejection_reason}
            </Detail>
            <Detail label="Alternative venue">
              {booking.alternative_venue}
            </Detail>
          </>
        )}
      </dl>
      <button
        className="assign"
        type="button"
        aria-expanded={showHistory}
        onClick={() => setShowHistory(!showHistory)}
      >
        {showHistory
          ? "Hide event change history"
          : "Show event change history"}
      </button>
      {showHistory && <EventChangeHistory eventId={booking.event_id} />}

      {expired && (
        <p className="message" role="note">
          This hold expired before a decision was made. The event coordinator
          must submit a new venue request.
        </p>
      )}

      {decidable && overlapInfo && (
        <div style={bannerStyle}>
          <strong>Availability: </strong>{" "}
          {overlapInfo.loading ? "Checking..." : overlapInfo.message}
        </div>
      )}

      {decidable && !rejecting && !placingHold && (
        <div className="decision-actions">
          <button
            className="btn-approve"
            disabled={busy || !canApprove}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            className="btn-reject"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Reject…
          </button>
          {pending && (
            <button
              className="assign"
              disabled={busy || !canApprove}
              onClick={() => setPlacingHold(true)}
            >
              Place hold…
            </button>
          )}
          {held && (
            <button className="assign" disabled={busy} onClick={onRemoveHold}>
              Remove hold
            </button>
          )}
        </div>
      )}

      {pending && placingHold && (
        <form
          className="reject-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onPlaceHold(holdUntil)) setPlacingHold(false);
          }}
        >
          <label>
            Hold until (SGT)
            <input
              type="datetime-local"
              required
              min={sgtNowInput()}
              value={holdUntil}
              onChange={(e) => setHoldUntil(e.target.value)}
            />
          </label>
          <p className="hint">
            The venue stays unavailable to other requests until the hold
            expires. The event coordinator is reminded 24 hours before it
            expires.
          </p>
          <div className="decision-actions">
            <button
              type="submit"
              className="btn-approve"
              disabled={busy || !holdUntil}
            >
              Confirm hold
            </button>
            <button
              type="button"
              className="assign"
              disabled={busy}
              onClick={() => setPlacingHold(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {decidable && rejecting && (
        <form
          className="reject-form"
          onSubmit={(e) => {
            e.preventDefault();
            onReject({ reason, alternative_venue: alternativeVenue });
          }}
        >
          <label>
            Reason for rejection (optional)
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            Alternative venue (optional)
            <input
              value={alternativeVenue}
              onChange={(e) => setAlternativeVenue(e.target.value)}
            />
          </label>
          <div className="decision-actions">
            <button type="submit" className="btn-reject" disabled={busy}>
              Confirm rejection
            </button>
            <button
              type="button"
              className="assign"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function VenueApproval() {
  const [bookings, setBookings] = useState([]);
  const [venues, setVenues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [overlapInfo, setOverlapInfo] = useState({
    loading: false,
    type: "none",
    message: "",
  });

  // keepMessage: leave the caller's message on screen after the reload.
  async function load(keepMessage = false) {
    try {
      const [bookingsData, venuesData] = await Promise.all([
        request("/venue-booking-requests"),
        request("/venues"),
      ]);
      setBookings(bookingsData);
      setVenues(venuesData);
      if (!keepMessage) setMessage("");
    } catch (error) {
      setMessage(`Unable to load venue booking requests. (${error.message})`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selected = bookings.find((item) => item.request_id === selectedId);

  // Check for overlaps immediately when a request is opened using local state
  useEffect(() => {
    let isMounted = true;

    async function checkOverlap() {
      if (!selected || !["Pending", "On Hold"].includes(selected.status)) {
        if (isMounted)
          setOverlapInfo({ loading: false, type: "none", message: "" });
        return;
      }

      setOverlapInfo({
        loading: true,
        type: "none",
        message: "Checking availability...",
      });

      try {
        const venueDetails = venues.find(
          (v) => v.venue_id === selected.venue_id,
        );
        const setupMinutes = parseInt(
          venueDetails?.setup_time || venueDetails?.setup_minutes || 0,
          10,
        );
        const teardownMinutes = parseInt(
          venueDetails?.teardown_time ||
            venueDetails?.turnaround_time ||
            venueDetails?.teardown_minutes ||
            0,
          10,
        );

        // Safe Date Extraction Helper to prevent undefined replace errors
        const getEventDates = (item) => {
          const startStr = item.start_datetime || item['Event Details']?.start_datetime;
          const endStr = item.end_datetime || item['Event Details']?.end_datetime;
          
          if (!startStr || typeof startStr !== 'string' || !endStr || typeof endStr !== 'string') {
            return null;
          }
          return {
            // Replaced .substring(0, 16) with just .replace(' ', 'T')
            // to preserve :00 seconds and +08:00 timezone for accurate parsing
            start: new Date(startStr.replace(' ', 'T')).getTime(),
            end: new Date(endStr.replace(' ', 'T')).getTime()
          };
        };

        const reqTimes = getEventDates(selected);

        if (!reqTimes) {
          if (isMounted)
            setOverlapInfo({
              loading: false,
              type: "error",
              message:
                "Cannot approve: This event has invalid or missing start/end times.",
            });
          return;
        }

        const reqEventStart = reqTimes.start;
        const reqEventEnd = reqTimes.end;
        const reqEffectiveStart = reqEventStart - setupMinutes * 60000;
        const reqEffectiveEnd = reqEventEnd + teardownMinutes * 60000;

        let overlapType = "none";
        let approvedConflictMessage = "";
        const competingEvents = [];

        // Iterate through locally loaded bookings
        for (const booking of bookings) {
          if (booking.request_id === selected.request_id) continue;
          if (booking.venue_id !== selected.venue_id) continue;
          // Only Approved bookings, active holds and Pending requests compete for the venue.
          if (["Rejected", "Expired"].includes(booking.status)) continue;

          const exTimes = getEventDates(booking);
          if (!exTimes) continue;

          const exEventStart = exTimes.start;
          const exEventEnd = exTimes.end;
          const exEffectiveStart = exEventStart - setupMinutes * 60000;
          const exEffectiveEnd = exEventEnd + teardownMinutes * 60000;

          // Check if ANY overlapping time occurs (including buffers)
          if (reqEffectiveStart < exEffectiveEnd && reqEffectiveEnd > exEffectiveStart) {
            const compName = booking.event_name || `Event #${booking.event_id}`;
            
            // Core overlap: the ACTUAL event times overlap directly
            const overlapsCore = reqEventStart < exEventEnd && reqEventEnd > exEventStart;
            
            let detailStr = '';
            if (overlapsCore) {
              detailStr = `${formatTime(exEventStart)}-${formatTime(exEventEnd)} - overlaps in event time`;
            } else if (exEventEnd <= reqEventStart) {
              // The existing event finishes before the requested one starts -> its Teardown overlaps with requested Setup
              detailStr = `teardown ${formatTime(exEventEnd)}-${formatTime(exEffectiveEnd)}) overlapping with event setup (${formatTime(reqEffectiveStart)}-${formatTime(reqEventStart)}`;
            } else if (exEventStart >= reqEventEnd) {
              // The existing event starts after the requested one finishes -> its Setup overlaps with requested Teardown
              detailStr = `setup ${formatTime(exEffectiveStart)}-${formatTime(exEventStart)}) overlapping with event teardown (${formatTime(reqEventEnd)}-${formatTime(reqEffectiveEnd)}`;
            } else {
              // Fallback
              detailStr = `overlaps between ${formatTime(Math.max(reqEffectiveStart, exEffectiveStart))} and ${formatTime(Math.min(reqEffectiveEnd, exEffectiveEnd))}`;
            }

            if (booking.status === "Approved") {
              overlapType = overlapsCore ? "core" : "buffer";
              approvedConflictMessage = `Unavailable. Venue is already booked by '${compName}' (${detailStr}).`;
              break; // Hard core collision found, stop checking
            } else if (booking.status === "On Hold") {
              overlapType = overlapsCore ? "core" : "buffer";
              approvedConflictMessage = `Unavailable. Venue is on hold for '${compName}' until ${formatDateTime(booking.hold_expires_at)} (${detailStr}).`;
              break; // An active hold blocks the venue like a booking
            } else if (booking.status === "Pending") {
              if (!competingEvents.some((c) => c.name === compName)) {
                competingEvents.push({
                  name: compName,
                  detailStr: ` (${detailStr})`,
                });
              }
            }
          }
        }

        if (isMounted) {
          if (overlapType === "core" || overlapType === "buffer") {
            setOverlapInfo({
              loading: false,
              type: overlapType,
              message: approvedConflictMessage,
            });
          } else if (competingEvents.length > 0) {
            // Format competing names and precise overlap locations nicely
            const namesFormatted = competingEvents
              .map((c) => `'${c.name}'${c.detailStr}`)
              .join(" and ");
            const verb = competingEvents.length === 1 ? "is" : "are";
            setOverlapInfo({
              loading: false,
              type: "pending",
              message: `Venue is available, but ${namesFormatted} ${verb} also requesting for this time slot.`,
            });
          } else {
            setOverlapInfo({
              loading: false,
              type: "none",
              message: "Venue is available for this time slot.",
            });
          }
        }
      } catch (error) {
        if (isMounted)
          setOverlapInfo({
            loading: false,
            type: "error",
            message: `Availability check failed: ${error.message}`,
          });
      }
    }

    checkOverlap();
    return () => {
      isMounted = false;
    };
  }, [selected, venues, bookings]);

  async function decide(action, body) {
    // Prevent submission if overlap check flagged an un-approvable issue
    if (
      action === "approve" &&
      (overlapInfo.type === "core" ||
        overlapInfo.type === "buffer" ||
        overlapInfo.type === "error")
    ) {
      setMessage(`Cannot approve: ${overlapInfo.message}`);
      return;
    }

    return act(
      action,
      { method: "POST", body: JSON.stringify(body || {}) },
      (updated) => `Request for ${eventLabel(updated)} ${updated.status.toLowerCase()}.`,
    );
  }

  // Runs a venue staff action on the selected request; resolves to whether it succeeded.
  async function act(path, options, describe) {
    setBusy(true);
    try {
      const updated = await request(
        `/venue-booking-requests/${selectedId}/${path}`,
        options,
      );
      setBookings((current) =>
        current.map((item) =>
          item.request_id === updated.request_id ? updated : item,
        ),
      );
      setMessage(describe(updated));
      setOverlapInfo({ loading: false, type: "none", message: "" });
      return true;
    } catch (error) {
      setMessage(error.message);
      await load(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const placeHold = (until) =>
    act(
      "hold",
      // The input is SGT wall-clock time; send the offset so the backend stores the right instant.
      { method: "POST", body: JSON.stringify({ expires_at: `${until}:00+08:00` }) },
      (updated) => `Venue held for ${eventLabel(updated)} until ${formatDateTime(updated.hold_expires_at)}.`,
    );

  const removeHold = () =>
    act(
      "hold",
      { method: "DELETE" },
      (updated) => `Hold removed for ${eventLabel(updated)}. The request is pending again.`,
    );

  return (
    <main className="shell">
      <section className="content">
        <header>
          <div>
            <p className="kicker">Gather / Venue desk</p>
            <h1>Venue booking requests</h1>
          </div>
        </header>
        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
        {selected && (
          <RequestDetail
            key={selected.request_id}
            booking={selected}
            busy={busy}
            overlapInfo={overlapInfo}
            onApprove={() => decide("approve")}
            onReject={(details) => decide("reject", details)}
            onPlaceHold={placeHold}
            onRemoveHold={removeHold}
            onClose={() => setSelectedId(null)}
          />
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Venue</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length ? (
                bookings.map((item) => (
                  <tr key={item.request_id}>
                    <td>{item.event_name || `Event #${item.event_id}`}</td>
                    <td>{item.venue_name}</td>
                    <td>{formatDateTime(item.start_datetime)}</td>
                    <td>{formatDateTime(item.end_datetime)}</td>
                    <td>
                      <span
                        className={`pill status-${statusClass(item.status)}`}
                      >
                        {item.status}
                      </span>
                      {item.status === "On Hold" && (
                        <small className="hold-expiry">
                          until {formatDateTime(item.hold_expires_at)}
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className="assign"
                        onClick={() => setSelectedId(item.request_id)}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty" colSpan={6}>
                    {loading ? "Loading…" : "No venue booking requests found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
