import React from 'react';

function display(value) {
  if (Array.isArray(value)) return value.join(', ') || 'Not provided';
  if (value === true || value === 1) return 'Yes';
  if (value === false || value === 0) return 'No';
  return value == null || value === '' ? 'Not provided' : String(value);
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : 'Not provided';
}

function Detail({ label, children }) {
  return <label>{label}<input value={display(children)} readOnly /></label>;
}

export default function FullEventDetails({ details, loading = false, error = '', onClose }) {
  if (!details && !loading && !error) return null;

  const event = details?.event || {};
  const venues = details?.venue_bookings || [];
  const equipment = details?.equipment_items || [];
  const safety = details?.safety_check;

  return <div className="feedback-backdrop">
    <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="full-event-details-title">
      <div className="feedback-heading">
        <div>
          <p>{event.id ? `Event #${event.id}` : 'Event details'}</p>
          <h2 id="full-event-details-title">Full event details</h2>
          {event.event_name && <span>{event.event_name}</span>}
        </div>
        <button className="feedback-close" type="button" aria-label="Close" onClick={onClose}>X</button>
      </div>

      {loading && <p className="message">Loading event details...</p>}
      {error && <p className="message" role="alert">{error}</p>}

      {!loading && !error && details && <>
        <h3>Event information</h3>
        <div className="feedback-details">
          <Detail label="Event name">{event.event_name}</Detail>
          <Detail label="Event type">{event.event_type}</Detail>
          <Detail label="Start date">{event.event_date}</Detail>
          <Detail label="End date">{event.event_end_date || event.event_date}</Detail>
          <Detail label="Capacity">{event.event_capacity}</Detail>
          <Detail label="Start time">{formatTime(event.start_time)}</Detail>
          <Detail label="End time">{formatTime(event.end_time)}</Detail>
          <Detail label="Layout required">{event.layout_required}</Detail>
          <Detail label="Equipment required">{event.equipment_required}</Detail>
          <Detail label="Facilities required">{event.facilities_required}</Detail>
          <Detail label="Accessibility required">{event.accessibility_required}</Detail>
          <Detail label="Equipment placement">{event.equipment_placement}</Detail>
          <Detail label="Crowd movement">{event.crowd_movement}</Detail>
          <label className="wide">Description and planning requirements<textarea value={display(event.description)} readOnly rows="4" /></label>
        </div>

        <h3>Approved venue(s)</h3>
        {venues.length ? <div className="table-wrap">
          <table>
            <thead><tr><th>Venue</th><th>Status</th></tr></thead>
            <tbody>
              {venues.map((booking, index) => {
                const venue = booking.Venues || {};
                return <tr key={booking.request_id ?? index}>
                  <td>{venue.venue_name || venue.name || booking.venue_name || `Venue #${booking.venue_id}`}</td>
                  <td><span className="pill">{booking.status}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div> : <p className="message">No venue approved yet.</p>}

        <h3>Reserved equipment</h3>
        {equipment.length ? <div className="table-wrap">
          <table>
            <thead><tr><th>Equipment</th><th>Reserved quantity</th></tr></thead>
            <tbody>
              {equipment.map((item, index) => <tr key={`${item.equipment_id}-${index}`}>
                <td>{item.equipment_name || item.equipment_id}</td>
                <td>{item.reserved_quantity}</td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p className="message">No equipment reserved yet.</p>}

        <h3>Operational Safety Check</h3>
        {safety ? <div className="feedback-details">
          <Detail label="Decision">{safety.status}</Detail>
          <Detail label="Comments">{safety.comments}</Detail>
          <Detail label="Decided at">{safety.decided_at ? new Date(safety.decided_at).toLocaleString('en-SG') : null}</Detail>
          {safety.affected_arrangements?.length > 0 &&
            <Detail label="Affected arrangements">{safety.affected_arrangements}</Detail>}
        </div> : <p className="message">No safety check done yet.</p>}
      </>}
    </section>
  </div>;
}