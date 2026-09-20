import React, { useEffect, useState, useMemo } from "react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";

function format12HourTime(time24) {
  if (!time24) return "";
  let [hours, minutes] = time24.split(":");
  hours = parseInt(hours, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12; // Converts 0 to 12 for midnight
  return `${hours}:${minutes} ${ampm}`;
}

function VenueDetail({ venue, onClose }) {
  return (
    <div className="equipment-item-card" style={{ marginBottom: "24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0 }}>{venue.name}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Select Different Venue
        </button>
      </div>
      <div className="form-grid">
        <div>
          <strong>Location:</strong> {venue.location}
        </div>
        <div>
          <strong>Capacity:</strong> {venue.capacity}
        </div>
        <div>
          <strong>Accessibility:</strong>{" "}
          {venue.accessible === 1 ? "Yes" : "No"}
        </div>
        <div className="wide">
          <strong>Facilities:</strong> {venue.facilities?.join(", ") || "None"}
        </div>
      </div>
    </div>
  );
}

export default function VenueRequest({ user }) {
  // 1. Core State
  const [activeTab, setActiveTab] = useState("request");
  const [venues, setVenues] = useState([]);
  const [events, setEvents] = useState([]);

  // 2. Form State
  const [eventId, setEventId] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState(null);
  const [startDatetime, setStartDatetime] = useState("");
  const [endDatetime, setEndDatetime] = useState("");

  // --- Filter State & Logic ---
  const [showManualFilters, setShowManualFilters] = useState(false);
  const [filterCapacity, setFilterCapacity] = useState("");
  const [filterLayout, setFilterLayout] = useState("");
  const [filterFacilities, setFilterFacilities] = useState([]);
  const [filterAccessible, setFilterAccessible] = useState(false);

  // Derive selected event and venue directly from state

  const selectedEvent = events.find(
    (item) => String(item.id) === String(eventId),
  );
  const selectedVenue = venues.find(
    (item) => item.venue_id === selectedVenueId,
  );

  // Automatically apply event details to filters and forms when an event is selected
  useEffect(() => {
    if (selectedEvent) {
      setFilterCapacity(selectedEvent.event_capacity || "");
      setFilterLayout(selectedEvent.layout_required || "");
      setFilterAccessible(Number(selectedEvent.accessibility_required) === 1);
      setFilterFacilities(selectedEvent.facilities_required || []);

      if (selectedEvent.start_datetime) {
        setStartDatetime(selectedEvent.start_datetime.slice(0, 16));
      }
      if (selectedEvent.end_datetime) {
        setEndDatetime(selectedEvent.end_datetime.slice(0, 16));
      }
    } else {
      // Clear everything if no event is selected
      setFilterCapacity("");
      setFilterLayout("");
      setFilterAccessible(false);
      setFilterFacilities([]);
      setStartDatetime("");
      setEndDatetime("");
    }
  }, [selectedEvent]);

  // Extract unique layouts and facilities from venues for the dropdowns
  const availableLayouts = useMemo(() => {
    const layouts = new Set();
    venues.forEach((v) => v.layouts?.forEach((l) => layouts.add(l)));
    return Array.from(layouts).sort();
  }, [venues]);

  const availableFacilities = useMemo(() => {
    const facilities = new Set();
    venues.forEach((v) => v.facilities?.forEach((f) => facilities.add(f)));
    return Array.from(facilities).sort();
  }, [venues]);

  // Apply filters to the venue list
  const filteredVenues = useMemo(() => {
    return venues.filter((venue) => {
      if (filterCapacity && venue.capacity < Number(filterCapacity))
        return false;
      if (filterLayout && !venue.layouts?.includes(filterLayout)) return false;
      if (filterAccessible && venue.accessible !== 1) return false;
      if (filterFacilities.length > 0) {
        const venueFacilities = venue.facilities || [];
        if (!filterFacilities.every((f) => venueFacilities.includes(f)))
          return false;
      }
      return true;
    });
  }, [
    venues,
    filterCapacity,
    filterLayout,
    filterAccessible,
    filterFacilities,
  ]);

  const toggleFacilityFilter = (facility) => {
    setFilterFacilities((prev) =>
      prev.includes(facility)
        ? prev.filter((f) => f !== facility)
        : [...prev, facility],
    );
  };

  // 3. UI State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);

  async function loadInitialData() {
    setLoading(true);
    setPageError("");
    try {
      const venueRes = await fetch(`${API}/venues`);
      const venueData = await venueRes.json();
      if (!venueRes.ok)
        throw new Error(venueData.detail || "Unable to load venue catalogue.");
      setVenues(Array.isArray(venueData) ? venueData : []);

      if (user?.id) {
        const eventRes = await fetch(
          `${API}/event-coordinators/${user.id}/events`,
        );
        const eventData = await eventRes.json();
        if (!eventRes.ok)
          throw new Error(
            eventData.detail || "Unable to load assigned events.",
          );
        setEvents(Array.isArray(eventData) ? eventData : []);
      }
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, [user?.id]);

  function formIsValid() {
    return (
      eventId &&
      selectedVenueId &&
      startDatetime &&
      endDatetime &&
      new Date(startDatetime) < new Date(endDatetime)
    );
  }

  async function submitRequest(e) {
    e.preventDefault();
    if (!formIsValid()) {
      setNotice({
        type: "error",
        text: "Please ensure all fields are filled and the start time is before the end time.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        event_id: Number(eventId),
        venue_id: selectedVenueId,
        coordinator_id: user.id,
        start_datetime: startDatetime,
        end_datetime: endDatetime,
      };

      const response = await fetch(`${API}/venue-bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.detail || "Venue request could not be submitted.",
        );

      setNotice({
        type: "success",
        text: `Venue request #${result.request_id || ""} was submitted successfully.`,
      });

      setEventId("");
      setSelectedVenueId(null);
      setStartDatetime("");
      setEndDatetime("");
    } catch (error) {
      setNotice({
        type: "error",
        text: error.message || "Venue request could not be submitted.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="equipment-page">
        <p>Loading venue request page…</p>
      </section>
    );
  }

  return (
    <section className="equipment-page">
      <header className="equipment-page-header">
        <div>
          <p className="kicker">Gather / Venues</p>
          <h1>Venue requests</h1>
        </div>
      </header>

      <div className="equipment-sub-tabs">
        <button
          type="button"
          className={activeTab === "request" ? "active" : ""}
          onClick={() => {
            setSelectedVenueId(null);
            setActiveTab("request");
          }}
        >
          Request Venue
        </button>
        <button
          type="button"
          className={activeTab === "submissions" ? "active" : ""}
          onClick={() => {
            setSelectedVenueId(null);
            setActiveTab("submissions");
          }}
        >
          My Submissions
        </button>
      </div>

      {pageError && <div className="page-error">{pageError}</div>}

      {activeTab === "request" && (
        <form className="request-form" onSubmit={submitRequest}>
          <div className="form-heading">
            <div>
              <h2>Submit venue request</h2>
              <p>
                Select an event to browse the catalogue and request a venue.
              </p>
            </div>
            <div className="form-actions">
              <button
                className="primary"
                type="submit"
                disabled={submitting || !formIsValid()}
              >
                {submitting ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </div>

          {/* 1. Event Selection Dropdown */}
          <div className="form-grid" style={{ marginBottom: "24px" }}>
            <label className="wide">
              Event
              <select
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setSelectedVenueId(null);
                }}
                required
              >
                <option value="">Select assigned event</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.event_name} — {event.event_date}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 2. Selected Event Details Table */}
          {eventId && selectedEvent && (
            <div
              className="equipment-request-items"
              style={{ marginBottom: "24px" }}
            >
              <div className="equipment-items-heading">
                <div>
                  <h3>Event Details</h3>
                  <p>Information for the selected event.</p>
                </div>
              </div>
              <div
                className="request-table-wrapper"
                style={{ width: "100%", overflowX: "auto" }}
              >
                <table className="request-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Event Name</th>
                      <th style={{ textAlign: "left" }}>Date</th>
                      <th style={{ textAlign: "left" }}>Timing</th>
                      <th style={{ textAlign: "left" }}>Capacity</th>
                      <th style={{ textAlign: "left" }}>Layout</th>
                      <th style={{ textAlign: "left" }}>Facilities</th>
                      <th style={{ textAlign: "left" }}>Accessibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>{selectedEvent.event_name}</strong>
                      </td>
                      <td>{selectedEvent.event_date}</td>
                      <td>
                        {format12HourTime(
                          selectedEvent.start_datetime.slice(11, 16),
                        )}{" "}
                        -{" "}
                        {format12HourTime(
                          selectedEvent.end_datetime.slice(11, 16),
                        )}
                      </td>
                      <td>
                        {selectedEvent.event_capacity ||
                          selectedEvent.event_capacity ||
                          "—"}
                      </td>
                      <td>{selectedEvent.layout_required}</td>
                      <td>
                        {selectedEvent.facilities_required?.map(
                          (facility, index) => (
                            <li key={index}>{facility}</li>
                          ),
                        )}
                      </td>
                      <td>
                        {Number(selectedEvent.accessibility_required) === 1
                          ? "Yes"
                          : "No"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. Venue Selected: Show Detail and Booking Fields */}
          {eventId && selectedVenue && (
            <div className="equipment-request-items">
              <div className="equipment-items-heading">
                <div>
                  <h3>Venue Booking Details</h3>
                  <p>Specify the start and end times for this venue request.</p>
                </div>
              </div>

              <VenueDetail
                venue={selectedVenue}
                onClose={() => setSelectedVenueId(null)}
              />

              <div className="equipment-item-card">
                <div className="form-grid">
                  <label>
                    Start Date & Time
                    <input
                      type="datetime-local"
                      value={startDatetime}
                      onChange={(e) => setStartDatetime(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    End Date & Time
                    <input
                      type="datetime-local"
                      value={endDatetime}
                      onChange={(e) => setEndDatetime(e.target.value)}
                      required
                    />
                  </label>
                </div>
                {startDatetime &&
                  endDatetime &&
                  new Date(startDatetime) >= new Date(endDatetime) && (
                    <p className="field-error" style={{ marginTop: "8px" }}>
                      Start time must be before end time.
                    </p>
                  )}
              </div>
            </div>
          )}

          {/* 4. Event Selected BUT No Venue Selected: Show Catalogue */}
          {eventId && !selectedVenue && (
            <div className="equipment-request-items">
              <div className="equipment-items-heading">
                <div>
                  <h3>Venue Catalogue</h3>
                  <p>Filter and select a suitable venue for this event.</p>
                </div>
              </div>

              {/* --- Filter Controls --- */}
              <div
                className="equipment-item-card"
                style={{ marginBottom: "16px" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: showManualFilters ? "12px" : "0",
                  }}
                >
                  <h4 style={{ margin: 0 }}>
                    {showManualFilters
                      ? "Manual Filters"
                      : "Venues auto-filtered by event requirements"}
                  </h4>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowManualFilters(!showManualFilters)}
                  >
                    {showManualFilters
                      ? "Hide Manual Filtering"
                      : "Manual Filtering"}
                  </button>
                </div>

                {showManualFilters && (
                  <>
                    <div className="form-grid">
                      <label>
                        Minimum Capacity
                        <input
                          type="number"
                          min="1"
                          value={filterCapacity}
                          onChange={(e) => setFilterCapacity(e.target.value)}
                          placeholder="e.g. 50"
                        />
                      </label>

                      <label>
                        Supported Layout
                        <select
                          value={filterLayout}
                          onChange={(e) => setFilterLayout(e.target.value)}
                        >
                          <option value="">Any Layout</option>
                          {availableLayouts.map((layout) => (
                            <option key={layout} value={layout}>
                              {layout}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: "8px",
                          cursor: "pointer",
                          height: "100%",
                        }}
                      >
                        <input
                          type="checkbox"
                          style={{ width: "auto", margin: 0 }}
                          checked={filterAccessible}
                          onChange={(e) =>
                            setFilterAccessible(e.target.checked)
                          }
                        />
                        Requires Accessibility
                      </label>

                      <label className="wide">
                        Facilities Required
                        <details
                          style={{
                            border: "1px solid var(--border-color, #ccc)",
                            padding: "8px",
                            borderRadius: "4px",
                            background: "var(--input-bg, #fff)",
                          }}
                        >
                          <summary style={{ cursor: "pointer" }}>
                            {filterFacilities.length === 0
                              ? "Select Facilities..."
                              : `${filterFacilities.length} selected`}
                          </summary>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "12px",
                              marginTop: "12px",
                            }}
                          >
                            {availableFacilities.map((facility) => (
                              <label
                                key={facility}
                                style={{
                                  display: "flex",
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontWeight: "normal",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  style={{ width: "auto", margin: 0 }}
                                  checked={filterFacilities.includes(facility)}
                                  onChange={() =>
                                    toggleFacilityFilter(facility)
                                  }
                                />
                                {facility}
                              </label>
                            ))}
                          </div>
                        </details>
                      </label>
                    </div>

                    {(filterCapacity ||
                      filterLayout ||
                      filterFacilities.length > 0 ||
                      filterAccessible) && (
                      <div style={{ marginTop: "16px" }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setFilterCapacity("");
                            setFilterLayout("");
                            setFilterFacilities([]);
                            setFilterAccessible(false);
                          }}
                        >
                          Clear Filters
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* --- Venue Table --- */}
              <div
                className="request-table-wrapper"
                style={{ width: "100%", overflowX: "auto" }}
              >
                <table className="request-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Venue</th>
                      <th style={{ textAlign: "left" }}>Location</th>
                      <th style={{ textAlign: "left" }}>Capacity</th>
                      <th style={{ textAlign: "left" }}>Supported Layouts</th>
                      <th style={{ textAlign: "left" }}>Facilities</th>
                      <th style={{ textAlign: "left" }}>Accessibility</th>
                      <th style={{ textAlign: "left" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVenues.length ? (
                      filteredVenues.map((item) => (
                        <tr key={item.venue_id}>
                          <td>
                            <strong>{item.name}</strong>
                          </td>
                          <td>{item.location}</td>
                          <td>{item.capacity}</td>
                          <td>
                            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                              {item.layouts?.map((layout, index) => (
                                <li key={index}>{layout}</li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                              {item.facilities?.map((facility, index) => (
                                <li key={index}>{facility}</li>
                              ))}
                            </ul>
                          </td>
                          <td>{item.accessible === 1 ? "Yes" : "No"}</td>
                          <td>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setSelectedVenueId(item.venue_id)}
                            >
                              Select Venue
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          className="empty"
                          colSpan={7}
                          style={{ textAlign: "center" }}
                        >
                          No venues match your current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </form>
      )}

      {activeTab === "submissions" && (
        <div className="request-form">
          <div className="form-heading">
            <div>
              <h2>Venue request submissions</h2>
              <p>View the status of your submitted venue requests.</p>
            </div>
          </div>
          <p className="empty-state">
            No venue requests have been submitted yet.
          </p>
        </div>
      )}

      {notice && (
        <>
          <div className="notice-backdrop" />
          <div
            className={`notice ${notice.type}`}
            role="alertdialog"
            aria-modal="true"
          >
            <div className="notice-icon">
              {notice.type === "success" ? "✓" : "!"}
            </div>
            <div>
              <h2>
                {notice.type === "success" ? "Success" : "Something went wrong"}
              </h2>
              <p>{notice.text}</p>
              <button
                className="primary"
                type="button"
                onClick={() => setNotice(null)}
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
