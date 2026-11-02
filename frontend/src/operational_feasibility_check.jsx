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


const formatFacilities = (value) => {
  if (!value) return '—';

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed.join(', ');
    }
  } catch {
    // Continue with normal string formatting.
  }

  return String(value)
    .split(',')
    .map((facility) => facility.trim())
    .filter(Boolean)
    .join(', ');
};

const formatAffectedArrangements = (value) => {
  if (!value) return '—';

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed.join(', ');
    }
  } catch {
    // Continue with PostgreSQL/string formatting.
  }

  return String(value)
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .join(', ');
};


function Detail({ label, children, style }) {
  return (
    <div className="detail-item" style={style}>
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
  const [affectedArrangements, setAffectedArrangements] = useState([]);

  const event = details.event || {};
  const venueBookings = details.venue_bookings || [];
  const equipmentReservations = details.equipment_reservations || [];
  const existingCheck = details.safety_check;

  const commentsRequired =
    decision === 'Rejected' ||
    decision === 'Changes Requested';

  function changeDecision(eventObject) {
    const nextDecision = eventObject.target.value;
    setDecision(nextDecision);

    if (nextDecision !== 'Changes Requested') {
      setAffectedArrangements([]);
    }
  }

  function changeAffectedArrangement(eventObject) {
    const { value, checked } = eventObject.target;

    setAffectedArrangements((current) => {
      if (checked) {
        return current.includes(value)
          ? current
          : [...current, value];
      }

      return current.filter((item) => item !== value);
    });
  }

  function submitDecision(eventObject) {
    eventObject.preventDefault();

    if (!decision) return;

    if (
      decision === 'Changes Requested' &&
      affectedArrangements.length === 0
    ) {
      return;
    }

    onDecision({
      decision,
      comments: comments.trim() || null,
      affected_arrangements:
        decision === 'Changes Requested'
          ? affectedArrangements
          : null,
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

      <dl
        className="detail-grid"
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        }}
      >
        <Detail label="Event name">
          {event.event_name || '—'}
        </Detail>

        <Detail label="Event type">
          {event.event_type || '—'}
        </Detail>

        <Detail label="Layout required">
          {event.layout_required || '—'}
        </Detail>

        <Detail label="Expected attendance">
          {event.event_capacity ?? '—'}
        </Detail>

        <Detail label="Start date">
          {formatDate(event.event_date)}
        </Detail>

        <Detail label="Start time">
          {formatTime(event.start_time)}
        </Detail>

        <Detail label="End date">
          {formatDate(event.event_end_date)}
        </Detail>

        <Detail label="End time">
          {formatTime(event.end_time)}
        </Detail>

        <Detail
          label="Facilities required"
          style={{ gridColumn: 'span 2' }}
        >
          {formatFacilities(event.facilities_required)}
        </Detail>

        <Detail
          label="Accessibility required"
          style={{ gridColumn: 'span 2' }}
        >
          {event.accessibility_required ? 'Yes' : 'No'}
        </Detail>

        <Detail
          label="Description and planning requirements"
          style={{ gridColumn: '1 / -1' }}
        >
          {event.description || '—'}
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
                      {venue.name ||
                        venue.venue_name ||
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

      {equipmentReservations.some(
        (reservation) => reservation.items?.length
      ) ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Reserved quantity</th>
              </tr>
            </thead>

            <tbody>
              {equipmentReservations.flatMap(
                (reservation) =>
                  (reservation.items || []).map((item, index) => (
                    <tr
                      key={
                        item.reservation_item_id ??
                        `${reservation.reservation_id}-${item.equipment_id}-${index}`
                      }
                    >
                      <td>
                        {item.equipment_name ||
                          `Equipment #${item.equipment_id}`}
                      </td>

                      <td>
                        {item.reserved_quantity ?? '—'}
                      </td>
                    </tr>
                  ))
              )}
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

            {existingCheck.affected_arrangements && (
              <Detail label="Affected arrangements">
                {formatAffectedArrangements(
                  existingCheck.affected_arrangements
                )}
              </Detail>
            )}
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
            onChange={changeDecision}
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

        {decision === 'Changes Requested' && (
          <fieldset
            className="choice-group"
            style={{
              marginTop: '4px',
              padding: '16px',
            }}
          >
            <legend>
              Affected arrangements{' '}
              <span className="safety-required">*</span>
            </legend>

            <p style={{ margin: '4px 0 18px' }}>
              Select the arrangements affected by the requested safety changes.
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px auto',
                  alignItems: 'center',
                  columnGap: '10px',
                }}
              >
                <input
                  id="affected-venue"
                  type="checkbox"
                  value="Venue"
                  checked={affectedArrangements.includes('Venue')}
                  onChange={changeAffectedArrangement}
                  disabled={busy}
                  style={{
                    width: '16px',
                    height: '16px',
                    margin: 0,
                  }}
                />

                <label
                  htmlFor="affected-venue"
                  style={{
                    margin: 0,
                    padding: 0,
                    display: 'inline',
                    width: 'auto',
                    cursor: 'pointer',
                  }}
                >
                  Venue
                </label>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px auto',
                  alignItems: 'center',
                  columnGap: '10px',
                }}
              >
                <input
                  id="affected-equipment"
                  type="checkbox"
                  value="Equipment"
                  checked={affectedArrangements.includes('Equipment')}
                  onChange={changeAffectedArrangement}
                  disabled={busy}
                  style={{
                    width: '16px',
                    height: '16px',
                    margin: 0,
                  }}
                />

                <label
                  htmlFor="affected-equipment"
                  style={{
                    margin: 0,
                    padding: 0,
                    display: 'inline',
                    width: 'auto',
                    cursor: 'pointer',
                  }}
                >
                  Equipment
                </label>
              </div>
            </div>
          </fieldset>
        )}

        {decision === 'Rejected' && (
          <p className="message">
            Reject when the organiser-provided safety information is
            insufficient. Explain what needs to be improved in Equipment
            Placement and/or Crowd Movement. Existing approved venue and
            reserved equipment arrangements will remain unchanged.
          </p>
        )}

        {decision === 'Changes Requested' && (
          <p className="message">
            Request Changes when the event needs to be revised before it can
            pass the safety check. The event will return to Planning. Existing
            approved venue and reserved equipment arrangements remain unchanged;
            the organiser can submit an Event Change Request for the required
            revisions.
          </p>
        )}

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
              decision === 'Rejected'
                ? 'Explain what information needs to be improved in Equipment Placement and/or Crowd Movement.'
                : decision === 'Changes Requested'
                  ? 'Explain the safety issue and what the organiser should revise through an Event Change Request.'
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
            disabled={
              busy ||
              !decision ||
              (
                decision === 'Changes Requested' &&
                affectedArrangements.length === 0
              )
            }
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