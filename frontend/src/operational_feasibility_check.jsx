import React, { useEffect, useState } from 'react';
import { request } from './api';


const formatDate = (value) => {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};


const formatTime = (value) => {
  if (!value) return '—';

  return value.slice(0, 5);
};


function Detail({ label, children }) {
  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  );
}


function SafetyDetail({
  details,
  busy,
  onDecision,
  onClose,
}) {
  const [decision, setDecision] = useState('');
  const [comments, setComments] = useState('');

  const event = details.event || {};
  const venueBookings = details.venue_bookings || [];
  const equipmentReservations = details.equipment_reservations || [];
  const existingCheck = details.safety_check;

  const commentsRequired =
    decision === 'Rejected' ||
    decision === 'Changes Requested';

  function submitDecision(eventObject) {
    eventObject.preventDefault();

    if (!decision) return;

    onDecision({
      decision,
      comments: comments.trim() || null,
    });
  }

  return (
    <section
      className="detail-panel"
      aria-label="Operational Safety Check details"
    >
      <div className="detail-head">
        <div>
          <p className="kicker">Operational Safety Check</p>
          <h2>{event.event_name || `Event #${event.id}`}</h2>
        </div>

        <button
          type="button"
          className="assign"
          onClick={onClose}
          disabled={busy}
        >
          Close
        </button>
      </div>

      <h3 className="safety-section-title">Event information</h3>

      <dl className="detail-grid">
        <Detail label="Event ID">
          {event.id}
        </Detail>

        <Detail label="Event type">
          {event.event_type}
        </Detail>

        <Detail label="Event date">
          {formatDate(event.event_date)}
        </Detail>

        <Detail label="Start time">
          {formatTime(event.start_time)}
        </Detail>

        <Detail label="End time">
          {formatTime(event.end_time)}
        </Detail>

        <Detail label="Expected attendance">
          {event.event_capacity}
        </Detail>

        <Detail label="Layout required">
          {event.layout_required}
        </Detail>

        <Detail label="Accessibility required">
          {event.accessibility_required ? 'Yes' : 'No'}
        </Detail>

        <Detail label="Event description">
          {event.description}
        </Detail>
      </dl>

      <h3 className="safety-section-title">
        Venue arrangements
      </h3>

      {venueBookings.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Venue</th>
                <th>Booking status</th>
              </tr>
            </thead>

            <tbody>
              {venueBookings.map((booking, index) => {
                const venue = booking.Venues || {};

                return (
                  <tr
                    key={
                      booking.request_id ??
                      `${booking.venue_id}-${index}`
                    }
                  >
                    <td>
                      {venue.venue_name ||
                        booking.venue_name ||
                        `Venue #${booking.venue_id}`}
                    </td>

                    <td>
                      <span className="pill status-approved">
                        {booking.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="message">
          No approved venue arrangements found.
        </p>
      )}

      <h3 className="safety-section-title">
        Equipment arrangements
      </h3>

      {equipmentReservations.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {equipmentReservations.map((reservation, index) => (
                <tr
                  key={
                    reservation.reservation_id ??
                    index
                  }
                >
                  <td>
                    Reservation #
                    {reservation.reservation_id ?? '—'}
                  </td>

                  <td>
                    <span className="pill status-approved">
                      {reservation.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="message">
          No confirmed equipment arrangements found.
        </p>
      )}

      <h3 className="safety-section-title">
        Safety considerations
      </h3>

      <dl className="detail-grid">
        <Detail label="Emergency access">
          {details.emergency_access || 'Not available yet'}
        </Detail>

        <Detail label="Equipment placement">
          {details.equipment_placement || 'Not available yet'}
        </Detail>

        <Detail label="Crowd movement">
          {details.crowd_movement || 'Not available yet'}
        </Detail>

        <Detail label="Known venue restrictions">
          {details.venue_restrictions || 'Not available yet'}
        </Detail>
      </dl>

      {existingCheck && (
        <>
          <h3 className="safety-section-title">
            Previous safety decision
          </h3>

          <dl className="detail-grid">
            <Detail label="Decision">
              {existingCheck.status}
            </Detail>

            <Detail label="Comments">
              {existingCheck.comments}
            </Detail>
          </dl>
        </>
      )}

      <h3 className="safety-section-title">
        Safety decision
      </h3>

      <form
        className="safety-decision-form"
        onSubmit={submitDecision}
      >
        <label>
          Decision

          <select
            value={decision}
            onChange={(eventObject) =>
              setDecision(eventObject.target.value)
            }
            disabled={busy}
            required
          >
            <option value="">Select a decision</option>
            <option value="Approved">Approve</option>
            <option value="Changes Requested">
              Request Changes
            </option>
            <option value="Rejected">Reject</option>
          </select>
        </label>

        <label>
          Comments
          {commentsRequired && (
            <span className="safety-required">
              {' '}*
            </span>
          )}

          <textarea
            rows={4}
            value={comments}
            onChange={(eventObject) =>
              setComments(eventObject.target.value)
            }
            placeholder={
              commentsRequired
                ? 'Explain the safety issue and required changes.'
                : 'Optional comments'
            }
            required={commentsRequired}
            disabled={busy}
          />
        </label>

        <div className="decision-actions">
          <button
            type="submit"
            className={
              decision === 'Approved'
                ? 'btn-approve'
                : 'btn-reject'
            }
            disabled={busy || !decision}
          >
            {busy ? 'Submitting…' : 'Submit decision'}
          </button>
        </div>
      </form>
    </section>
  );
}


export default function OperationalFeasibilityCheck() {
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);


  async function loadEvents(keepMessage = false) {
    setLoading(true);

    try {
      const data = await request('/safety-check/events');

      setEvents(data || []);

      if (!keepMessage) {
        setMessage('');
      }
    } catch (error) {
      setMessage(
        `Unable to load events requiring a safety check. (${error.message})`
      );
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    loadEvents();
  }, []);


  async function openEvent(eventId) {
    setSelectedId(eventId);
    setDetails(null);
    setDetailLoading(true);
    setMessage('');

    try {
      const data = await request(
        `/safety-check/events/${eventId}`
      );

      setDetails(data);
    } catch (error) {
      setSelectedId(null);
      setMessage(error.message);
    } finally {
      setDetailLoading(false);
    }
  }


  function closeEvent() {
    setSelectedId(null);
    setDetails(null);
  }


  async function submitDecision(body) {
    if (!selectedId) return;

    setBusy(true);
    setMessage('');

    try {
      const result = await request(
        `/safety-check/events/${selectedId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      const eventName =
        details?.event?.event_name ||
        `Event #${selectedId}`;

      setMessage(
        `${eventName}: ${result.decision}. Event status is now ${result.event_status}.`
      );

      setSelectedId(null);
      setDetails(null);

      await loadEvents(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <main className="shell">
      <section className="content">
        <header>
          <div>
            <p className="kicker">
              Gather / Safety Officer
            </p>

            <h1>Operational Safety Checks</h1>
          </div>
        </header>

        <p className="safety-intro">
          Review events after their venue and technical
          arrangements have been confirmed.
        </p>

        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}

        {detailLoading && (
          <p className="message">
            Loading event details…
          </p>
        )}

        {details && (
          <SafetyDetail
            key={details.event?.id}
            details={details}
            busy={busy}
            onDecision={submitDecision}
            onClose={closeEvent}
          />
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Expected attendance</th>
                <th>Current status</th>
                <th>Safety check</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {events.length ? (
                events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      {event.event_name ||
                        `Event #${event.id}`}
                    </td>

                    <td>
                      {formatDate(event.event_date)}
                    </td>

                    <td>
                      {event.event_capacity ?? '—'}
                    </td>

                    <td>
                      {event.status || '—'}
                    </td>

                    <td>
                      {event.safety_check ? (
                        <span
                          className={`pill status-${event.safety_check.status
                            .toLowerCase()
                            .replaceAll(' ', '-')}`}
                        >
                          {event.safety_check.status}
                        </span>
                      ) : (
                        <span className="pill status-pending">
                          Pending
                        </span>
                      )}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="assign"
                        onClick={() => openEvent(event.id)}
                        disabled={
                          detailLoading &&
                          selectedId === event.id
                        }
                      >
                        {detailLoading &&
                        selectedId === event.id
                          ? 'Loading…'
                          : 'View details'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="empty"
                    colSpan={6}
                  >
                    {loading
                      ? 'Loading…'
                      : 'No events currently require an Operational Safety Check.'}
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