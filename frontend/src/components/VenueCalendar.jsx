import React, { useState, useEffect, useMemo, useRef } from "react";
import { request } from "../api";
import { eventWindow } from "../eventTimes";

function format12HourTime(time24) {
  if (!time24) return "";
  let [hours, minutes] = time24.split(":");
  hours = parseInt(hours, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

function formatCalendarDateTime(value) {
  if (!value) return "";

  return `${value.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })}, ${format12HourTime(value.toTimeString().slice(0, 5))}`;
}

export default function VenueCalendar({ venues }) {
  const [calendarVenueId, setCalendarVenueId] = useState("");
  const [calendarBookings, setCalendarBookings] = useState([]);
  const [expandedOverlapKey, setExpandedOverlapKey] = useState(null);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    // Default to the Monday of the current week
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(now.setDate(diff));
  });

  // Fetch bookings when a venue is selected
  useEffect(() => {
    if (calendarVenueId) {
      const fetchCalendarData = async () => {
        try {
          const data = await request(
            `/venue-booking-requests/venues/${calendarVenueId}?include_pending=true`,
          );
          setCalendarBookings(data);
        } catch (error) {
          console.error("Failed to load calendar bookings", error);
        }
      };
      fetchCalendarData();
    } else {
      setCalendarBookings([]);
    }
  }, [calendarVenueId]);

  const selectedVenue = useMemo(() => {
    return (
      venues.find((v) => String(v.venue_id) === String(calendarVenueId)) || {}
    );
  }, [venues, calendarVenueId]);

  const setupMinutes = parseInt(selectedVenue.setup_time || 0, 10);
  const teardownMinutes = parseInt(selectedVenue.teardown_time || 0, 10);
  // Helper to generate the 7 days of the currently selected week
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const date = new Date(currentWeekStart);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [currentWeekStart]);

  // Helper to shift weeks
  const changeWeek = (offset) => {
    setCurrentWeekStart((prev) => {
      const nextDate = new Date(prev);
      nextDate.setDate(prev.getDate() + offset * 7);
      return nextDate;
    });
  };

  // Reference for the scrollable calendar container
  const scrollContainerRef = useRef(null);

  // Automatically scroll to 8 AM (480px) when a venue is selected and the grid renders
  useEffect(() => {
    if (calendarVenueId && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 480;
    }
  }, [calendarVenueId, currentWeekStart]); // Re-trigger if they change the venue or week

  return (
    <div>
      {/* Calendar Controls */}
      <div className="equipment-items-heading" style={{ marginTop: "18px" }}>
        {/* Left Side: Venue Dropdown */}
        <div className="selector" style={{ margin: 0 }}>
          <select
            value={calendarVenueId}
            onChange={(e) => {
              setCalendarVenueId(e.target.value);
              setExpandedOverlapKey(null);
            }}
          >
            <option value="">Select a venue to view...</option>
            {venues.map((v) => (
              <option key={v.venue_id} value={v.venue_id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        {/* Right Side: Date Range Controls */}
        <div className="form-actions" style={{ alignItems: "center" }}>
          <button
            type="button"
            className="secondary"
            onClick={() => changeWeek(-1)}
          >
            ← Prev Week
          </button>
          <span
            style={{
              minWidth: "150px",
              textAlign: "center",
              color: "#1c2940",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            {weekDays[0].toLocaleDateString()} -{" "}
            {weekDays[6].toLocaleDateString()}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => changeWeek(1)}
          >
            Next Week →
          </button>
        </div>
      </div>

      {calendarVenueId && (
        <p className="calendar-legend">
          <span className="legend-confirmed">Confirmed</span>
          <span className="legend-on-hold">On Hold (until expiry)</span>
          <span className="legend-pending">Pending</span>
          <span className="legend-expired">Expired hold</span>
          <span>Empty slots are available.</span>
        </p>
      )}

      {/* Calendar Grid */}
      {calendarVenueId ? (
        <div
          className="request-table-wrapper"
          ref={scrollContainerRef}
          style={{ maxHeight: "600px", overflowY: "auto" }}
        >
          <table
            className="request-table calendar-table"
            style={{ width: "100%", minWidth: 0, tableLayout: "fixed" }}
          >
            <thead
              style={{
                position: "sticky",
                top: 0,
                backgroundColor: "#f8faff",
                zIndex: 10,
              }}
            >
              <tr>
                <th
                  style={{
                    width: "50px",
                    padding: "8px 4px",
                    textAlign: "center",
                    fontSize: "10px",
                  }}
                >
                  Time
                </th>
                {weekDays.map((day, idx) => (
                  <th
                    key={idx}
                    style={{
                      textAlign: "center",
                      padding: "8px 2px",
                      fontSize: "11px",
                      wordWrap: "break-word",
                    }}
                  >
                    {day.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Generate rows for 24 hours (0-23) */}
              {Array.from({ length: 24 }).map((_, hour) => (
                <tr key={hour}>
                  <td
                    style={{
                      fontWeight: "bold",
                      fontSize: "11px",
                      color: "#8390a3",
                    }}
                  >
                    {hour === 0
                      ? "12 AM"
                      : hour < 12
                        ? `${hour} AM`
                        : hour === 12
                          ? "12 PM"
                          : `${hour - 12} PM`}
                  </td>

                  {weekDays.map((day, dayIdx) => {
                    // Define the absolute bounds of THIS specific day
                    const dayStart = new Date(day);
                    dayStart.setHours(0, 0, 0, 0);
                    const dayEnd = new Date(day);
                    dayEnd.setHours(24, 0, 0, 0); // Midnight of the next day

                    // Build every booking that overlaps this day, then assign it a lane.
                    // This lets bookings that start in different hours still display side by side
                    // when their visible time periods overlap.
                    const dayBookings = calendarBookings
                      .map((booking) => {
                        const times = eventWindow(booking["Event Details"]);
                        if (!times) return null;

                        const { start: eventStart, end: eventEnd } = times;
                        const overallStart = new Date(
                          eventStart.getTime() - setupMinutes * 60000,
                        );
                        const overallEnd = new Date(
                          eventEnd.getTime() + teardownMinutes * 60000,
                        );

                        if (overallEnd <= dayStart || overallStart >= dayEnd)
                          return null;

                        return {
                          booking, eventStart, eventEnd, overallStart, overallEnd,
                          effectiveStart: new Date(Math.max(overallStart, dayStart)),
                          effectiveEnd: new Date(Math.min(overallEnd, dayEnd)),
                        };
                      })
                      .filter(Boolean)
                      .sort((a, b) => a.effectiveStart - b.effectiveStart || a.effectiveEnd - b.effectiveEnd);

                    const activeLanes = [];
                    const laidOutBookings = dayBookings.map((item) => {
                      let lane = activeLanes.findIndex((laneEnd) => laneEnd <= item.effectiveStart);
                      if (lane === -1) lane = activeLanes.length;
                      activeLanes[lane] = item.effectiveEnd;
                      return { ...item, lane };
                    });

                    const overlapCountFor = (item) =>
                      laidOutBookings.filter(
                        (other) => item.effectiveStart < other.effectiveEnd && item.effectiveEnd > other.effectiveStart,
                      ).length;

                    const startingBookings = laidOutBookings.filter(
                      (item) => item.effectiveStart.getHours() === hour,
                    );

                    return (
                      <td
                        key={dayIdx}
                        style={{
                          position: "relative",
                          border: "1px solid #edf0f5",
                          height: "60px",
                          padding: 0,
                          verticalAlign: "top",
                        }}
                      >
                        {startingBookings.map((item, bIdx) => {
                          const { booking, eventStart, eventEnd, overallStart, overallEnd, effectiveStart, lane } = item;
                          const eventDetails = booking["Event Details"];
                          const eventName = eventDetails.event_name || "Unknown Event";
                          const overlapCount = overlapCountFor(item);
                          const displayLaneCount = Math.min(overlapCount, 2);
                          const overlapKey = `${dayStart.toISOString()}-${hour}-${booking.request_id || bIdx}`;
                          const isExpanded = expandedOverlapKey === overlapKey;
                          const startMinute = effectiveStart.getMinutes();

                          // Format inclusive times for tooltip
                          const overallStartStr = format12HourTime(
                            overallStart.toTimeString().slice(0, 5),
                          );
                          const overallEndStr = format12HourTime(
                            overallEnd.toTimeString().slice(0, 5),
                          );

                          // Calculate exact visible pixel heights for the current day
                          const visibleSetup = Math.max(
                            0,
                            (Math.min(eventStart, dayEnd) -
                              Math.max(overallStart, dayStart)) /
                              60000,
                          );
                          const visibleEvent = Math.max(
                            0,
                            (Math.min(eventEnd, dayEnd) -
                              Math.max(eventStart, dayStart)) /
                              60000,
                          );
                          const visibleTeardown = Math.max(
                            0,
                            (Math.min(overallEnd, dayEnd) -
                              Math.max(eventEnd, dayStart)) /
                              60000,
                          );

                          const isPending = booking.status === "Pending";
                          const isHeld = booking.status === "On Hold";
                          const isExpired = booking.status === "Expired";
                          // Pending requests and expired holds do not occupy the venue, so both are drawn as outlines.
                          const tentative = isPending || isExpired;
                          const holdTime = booking.hold_expires_at
                            ? `${booking.hold_expires_at.replace("T", " ").slice(0, 16)} SGT`
                            : "";
                          const label = isPending
                            ? "(Pending)"
                            : isHeld
                              ? `(On Hold until ${holdTime})`
                              : isExpired
                                ? "(Expired hold)"
                                : "";

                          return (
                            <div
                              key={bIdx}
                              style={{
                                position: "absolute",
                                top: `${startMinute}px`,
                                left: overlapCount <= 2 ? `calc(${(lane / displayLaneCount) * 100}% + 4px)` : "4px",
                                width: overlapCount <= 2 ? `calc(${100 / displayLaneCount}% - 8px)` : "calc(100% - 8px)",
                                display: overlapCount > 2 && lane > 0 && !isExpanded ? "none" : "flex",
                                flexDirection: "column",
                                zIndex: isExpanded ? 20 : 5 + lane,
                              }}
                              title={`${eventName} (Req ID: ${booking.request_id}) - ${booking.status}${isHeld ? ` until ${holdTime}` : isExpired ? `, expired ${holdTime}` : ""}\nBooking (incl. setup & teardown): ${overallStartStr} - ${overallEndStr}`}
                            >
                              {overlapCount > 2 && lane === 0 && (
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setExpandedOverlapKey(isExpanded ? null : overlapKey)}
                                  style={{ marginBottom: "4px", padding: "4px 6px", fontSize: "10px", textAlign: "left", width: "100%", cursor: "pointer" }}
                                >
                                  {overlapCount} overlapping events — {isExpanded ? "collapse" : "expand to see all"}
                                </button>
                              )}
                              {overlapCount > 2 && isExpanded && lane === 0 && (() => {
                                const overlappingItems = laidOutBookings.filter(
                                  (other) =>
                                    item.effectiveStart < other.effectiveEnd &&
                                    item.effectiveEnd > other.effectiveStart,
                                );

                                const sharedOverlapStart = new Date(
                                  Math.max(
                                    ...overlappingItems.map((other) =>
                                      other.effectiveStart.getTime(),
                                    ),
                                  ),
                                );
                                const sharedOverlapEnd = new Date(
                                  Math.min(
                                    ...overlappingItems.map((other) =>
                                      other.effectiveEnd.getTime(),
                                    ),
                                  ),
                                );
                                const hasSharedOverlap =
                                  sharedOverlapStart < sharedOverlapEnd;

                                return (
                                  <div style={{ marginBottom: "4px", padding: "6px", background: "#ffffff", border: "1px solid #dce6f3", borderRadius: "4px", fontSize: "10px", lineHeight: 1.4 }}>
                                    {hasSharedOverlap && (
                                      <div style={{ marginBottom: "6px", paddingBottom: "6px", borderBottom: "1px solid #edf0f5" }}>
                                        <strong>Shared overlap:</strong>{" "}
                                        {formatCalendarDateTime(sharedOverlapStart)}
                                        {" – "}
                                        {formatCalendarDateTime(sharedOverlapEnd)}
                                      </div>
                                    )}

                                    {overlappingItems.map((other) => {
                                      const otherDetails = other.booking["Event Details"];
                                      return (
                                        <div key={other.booking.request_id || `${otherDetails?.event_name}-${other.lane}`} style={{ marginBottom: "6px" }}>
                                          <strong>{otherDetails?.event_name || "Unknown Event"}</strong> ({other.booking.status})
                                          <div style={{ color: "#68758a", marginTop: "1px" }}>
                                            {formatCalendarDateTime(other.eventStart)}
                                            {" – "}
                                            {formatCalendarDateTime(other.eventEnd)}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {/* --- Setup Block --- */}
                              {visibleSetup > 0 && (
                                <div
                                  style={{
                                    height: `${visibleSetup}px`,
                                    background: tentative
                                      ? "repeating-linear-gradient(45deg, #f8faff, #f8faff 4px, #ffffff 4px, #ffffff 8px)"
                                      : "#f1f5f9",
                                    color: "#64748b",
                                    fontSize: "9px",
                                    fontWeight: 600,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: tentative
                                      ? "1px dashed #cbd5e1"
                                      : "1px solid #e2e8f0",
                                    borderBottom:
                                      visibleEvent > 0 || visibleTeardown > 0
                                        ? "none"
                                        : undefined,
                                    borderRadius:
                                      visibleEvent === 0 &&
                                      visibleTeardown === 0
                                        ? "4px"
                                        : "4px 4px 0 0",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  {visibleSetup >= 15 ? "Setup" : ""}
                                </div>
                              )}

                              {/* --- Event Block --- */}
                              {visibleEvent > 0 && (
                                <div
                                  style={{
                                    height: `${visibleEvent}px`,
                                    background: isHeld
                                      ? "#ede7f6"
                                      : tentative
                                        ? "repeating-linear-gradient(45deg, #f5f7fb, #f5f7fb 8px, #ffffff 8px, #ffffff 16px)"
                                        : "#192541",
                                    border: isHeld
                                      ? "1px solid #8e6ccf"
                                      : tentative
                                        ? "1px dashed #8b98ab"
                                        : "1px solid #0d1424",
                                    opacity: isExpired ? 0.6 : 1,
                                    borderRadius:
                                      visibleSetup === 0 &&
                                      visibleTeardown === 0
                                        ? "4px"
                                        : visibleSetup === 0
                                          ? "4px 4px 0 0"
                                          : visibleTeardown === 0
                                            ? "0 0 4px 4px"
                                            : "0",
                                    boxShadow: tentative || isHeld
                                      ? "none"
                                      : "0 2px 5px rgba(25, 37, 65, 0.2)",
                                    color: isHeld ? "#5b3f99" : tentative ? "#53647d" : "white",
                                    fontSize: "11px",
                                    padding: "4px 6px",
                                    boxSizing: "border-box",
                                    overflow: "hidden",
                                  }}
                                >
                                  <strong
                                    style={{
                                      display: "block",
                                      marginBottom: "2px",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {eventName} {label}
                                  </strong>
                                  <span
                                    style={{
                                      opacity: 0.8,
                                      fontSize: "9px",
                                      display: "block",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      color: tentative ? "#68758a" : "inherit",
                                    }}
                                  >
                                    {format12HourTime(
                                      eventStart.toTimeString().slice(0, 5),
                                    )}{" "}
                                    -{" "}
                                    {format12HourTime(
                                      eventEnd.toTimeString().slice(0, 5),
                                    )}
                                  </span>
                                </div>
                              )}

                              {/* --- Teardown Block --- */}
                              {visibleTeardown > 0 && (
                                <div
                                  style={{
                                    height: `${visibleTeardown}px`,
                                    background: tentative
                                      ? "repeating-linear-gradient(45deg, #f8faff, #f8faff 4px, #ffffff 4px, #ffffff 8px)"
                                      : "#f1f5f9",
                                    color: "#64748b",
                                    fontSize: "9px",
                                    fontWeight: 600,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: tentative
                                      ? "1px dashed #cbd5e1"
                                      : "1px solid #e2e8f0",
                                    borderTop:
                                      visibleEvent > 0 || visibleSetup > 0
                                        ? "none"
                                        : undefined,
                                    borderRadius:
                                      visibleEvent === 0 && visibleSetup === 0
                                        ? "4px"
                                        : "0 0 4px 4px",
                                    boxSizing: "border-box",
                                  }}
                                >
                                  {visibleTeardown >= 15 ? "Teardown" : ""}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">
          Please select a venue to view its schedule.
        </p>
      )}
    </div>
  );
}

