import React, { useState, useEffect, useMemo, useRef } from "react";

function format12HourTime(time24) {
  if (!time24) return "";
  let [hours, minutes] = time24.split(":");
  hours = parseInt(hours, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

export default function VenueCalendar({ venues, apiBaseUrl }) {
  const [calendarVenueId, setCalendarVenueId] = useState("");
  const [calendarBookings, setCalendarBookings] = useState([]);
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
          const res = await fetch(
            `${apiBaseUrl}/venue-booking-requests/venues/${calendarVenueId}?include_pending=true`,
          );
          if (res.ok) {
            const data = await res.json();
            setCalendarBookings(data);
          }
        } catch (error) {
          console.error("Failed to load calendar bookings", error);
        }
      };
      fetchCalendarData();
    } else {
      setCalendarBookings([]); // Clear if no venue is selected
    }
  }, [calendarVenueId, apiBaseUrl]);

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
    <div className="request-form">
      {/* Calendar Controls */}
      <div className="equipment-items-heading" style={{ marginTop: "18px" }}>
        {/* Left Side: Venue Dropdown */}
        <div className="selector" style={{ margin: 0 }}>
          <select
            value={calendarVenueId}
            onChange={(e) => setCalendarVenueId(e.target.value)}
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

                    // Find bookings that START in this specific hour on this specific day
                    const startingBookings = calendarBookings.filter((b) => {
                      const startStr =
                        b.start_datetime || b["Event Details"]?.start_datetime;
                      const endStr =
                        b.end_datetime || b["Event Details"]?.end_datetime;
                      if (!startStr || !endStr) return false;

                      const actualStart = new Date(
                        startStr.substring(0, 16).replace(" ", "T"),
                      );
                      const actualEnd = new Date(
                        endStr.substring(0, 16).replace(" ", "T"),
                      );

                      // Ignore if the event doesn't overlap this day at all
                      if (actualEnd <= dayStart || actualStart >= dayEnd)
                        return false;

                      // If an event spans multiple days, clamp its start time to midnight of THIS day
                      const effectiveStart = new Date(
                        Math.max(actualStart, dayStart),
                      );

                      // Only render the block in the table cell matching its start hour
                      return effectiveStart.getHours() === hour;
                    });

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
                        {startingBookings.map((booking, bIdx) => {
                          // Extract data directly from your nested JSON structure
                          const eventDetails = booking["Event Details"] || {};
                          const startStr =
                            booking.start_datetime ||
                            eventDetails.start_datetime;
                          const endStr =
                            booking.end_datetime || eventDetails.end_datetime;
                          const eventName =
                            eventDetails.event_name || "Unknown Event";

                          const actualStart = new Date(
                            startStr.substring(0, 16).replace(" ", "T"),
                          );
                          const actualEnd = new Date(
                            endStr.substring(0, 16).replace(" ", "T"),
                          );

                          const effectiveStart = new Date(
                            Math.max(actualStart, dayStart),
                          );
                          const effectiveEnd = new Date(
                            Math.min(actualEnd, dayEnd),
                          );

                          const startMinute = effectiveStart.getMinutes();
                          const durationMinutes =
                            (effectiveEnd - effectiveStart) / (1000 * 60);

                          // This variable triggers the shaded styling
                          const isPending = booking.status === "Pending";

                          return (
                            <div
                              key={bIdx}
                              style={{
                                position: "absolute",
                                top: `${startMinute}px`,
                                left: "4px",
                                right: "4px",
                                height: `${durationMinutes}px`,
                                // --- Conditional Styling for Shaded vs Solid ---
                                background: isPending
                                  ? "repeating-linear-gradient(45deg, #f5f7fb, #f5f7fb 8px, #ffffff 8px, #ffffff 16px)"
                                  : "#192541",
                                border: isPending
                                  ? "1px dashed #8b98ab"
                                  : "1px solid #0d1424",
                                color: isPending ? "#53647d" : "white",
                                // -----------------------------------------------
                                fontSize: "11px",
                                padding: "4px 6px",
                                borderRadius: "4px",
                                zIndex: 5,
                                overflow: "hidden",
                                boxShadow: isPending
                                  ? "none"
                                  : "0 2px 5px rgba(25, 37, 65, 0.2)",
                              }}
                              title={`${eventName} (Req ID: ${booking.request_id}) - ${booking.status}`}
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
                                {eventName} {isPending ? "(Pending)" : ""}
                              </strong>
                              <span
                                style={{
                                  opacity: 0.8,
                                  fontSize: "9px",
                                  display: "block",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  color: isPending ? "#68758a" : "inherit",
                                }}
                              >
                                {format12HourTime(
                                  effectiveStart.toTimeString().slice(0, 5),
                                )}{" "}
                                -{" "}
                                {format12HourTime(
                                  effectiveEnd.toTimeString().slice(0, 5),
                                )}
                              </span>
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
