import React, { useEffect, useState } from 'react';
import { request } from './api';

// The API returns SGT (+08:00) timestamps, so slicing the string keeps them in SGT.
const formatDateTime = (value) => (value ? `${value.replace('T', ' ').slice(0, 16)} SGT` : '—');

function Detail({ label, children }) {
  return <div className="detail-item"><dt>{label}</dt><dd>{children || '—'}</dd></div>;
}

function RequestDetail({ booking, busy, onApprove, onReject, onClose }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [alternativeVenue, setAlternativeVenue] = useState('');
  const pending = booking.status === 'Pending';

  return <section className="detail-panel" aria-label="Venue booking request details">
    <div className="detail-head">
      <h2>{booking.event_name || `Event #${booking.event_id}`}</h2>
      <button className="assign" onClick={onClose}>Close</button>
    </div>
    <dl className="detail-grid">
      <Detail label="Status"><span className={`pill status-${booking.status.toLowerCase()}`}>{booking.status}</span></Detail>
      <Detail label="Venue">{booking.venue_name}</Detail>
      <Detail label="Start">{formatDateTime(booking.start_datetime)}</Detail>
      <Detail label="End">{formatDateTime(booking.end_datetime)}</Detail>
      <Detail label="Accessibility required">{booking.accessibility_required ? 'Yes' : 'No'}</Detail>
      <Detail label="Layout">{booking.layout_required}</Detail>
      <Detail label="Facilities">{booking.facilities_required.join(', ')}</Detail>
      <Detail label="Event type">{booking.event_type}</Detail>
      <Detail label="Expected capacity">{booking.event_capacity}</Detail>
      <Detail label="Event coordinator">{booking.coordinator_name && `${booking.coordinator_name}${booking.coordinator_email ? ` (${booking.coordinator_email})` : ''}`}</Detail>
      <Detail label="Event description">{booking.event_description}</Detail>
      {booking.status === 'Rejected' && <>
        <Detail label="Reason for rejection">{booking.rejection_reason}</Detail>
        <Detail label="Alternative venue">{booking.alternative_venue}</Detail>
      </>}
    </dl>
    {pending && !rejecting && <div className="decision-actions">
      <button className="btn-approve" disabled={busy} onClick={onApprove}>Approve</button>
      <button className="btn-reject" disabled={busy} onClick={() => setRejecting(true)}>Reject…</button>
    </div>}
    {pending && rejecting && <form className="reject-form" onSubmit={(e) => { e.preventDefault(); onReject({ reason, alternative_venue: alternativeVenue }); }}>
      <label>Reason for rejection (optional)
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label>Alternative venue (optional)
        <input value={alternativeVenue} onChange={(e) => setAlternativeVenue(e.target.value)} />
      </label>
      <div className="decision-actions">
        <button type="submit" className="btn-reject" disabled={busy}>Confirm rejection</button>
        <button type="button" className="assign" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
      </div>
    </form>}
  </section>;
}

export default function VenueApproval() {
  const [bookings, setBookings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setBookings(await request('/venue-booking-requests'));
      setMessage('');
    } catch (error) {
      setMessage(`Unable to load venue booking requests. (${error.message})`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function decide(action, body) {
    setBusy(true);
    try {
      const updated = await request(`/venue-booking-requests/${selectedId}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) });
      setBookings((current) => current.map((item) => (item.request_id === updated.request_id ? updated : item)));
      setMessage(`Request for ${updated.event_name || `event #${updated.event_id}`} ${updated.status.toLowerCase()}.`);
    } catch (error) {
      setMessage(error.message);
      await load(); // status may have changed underneath us
    } finally {
      setBusy(false);
    }
  }

  const selected = bookings.find((item) => item.request_id === selectedId);

  return <main className="shell">
    <aside><div className="logo">G</div><div className="side-label">VENUE APPROVAL</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Venue desk</p><h1>Venue booking requests</h1></div></header>
      {message && <p className="message" role="status">{message}</p>}
      {selected && <RequestDetail
        key={selected.request_id}
        booking={selected}
        busy={busy}
        onApprove={() => decide('approve')}
        onReject={(details) => decide('reject', details)}
        onClose={() => setSelectedId(null)}
      />}
      <div className="table-wrap"><table>
        <thead><tr><th>Event</th><th>Venue</th><th>Start</th><th>End</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{bookings.length ? bookings.map((item) => <tr key={item.request_id}>
          <td>{item.event_name || `Event #${item.event_id}`}</td>
          <td>{item.venue_name}</td>
          <td>{formatDateTime(item.start_datetime)}</td>
          <td>{formatDateTime(item.end_datetime)}</td>
          <td><span className={`pill status-${item.status.toLowerCase()}`}>{item.status}</span></td>
          <td><button className="assign" onClick={() => setSelectedId(item.request_id)}>View details</button></td>
        </tr>) : <tr><td className="empty" colSpan={6}>{loading ? 'Loading…' : 'No venue booking requests found.'}</td></tr>}</tbody>
      </table></div>
    </section>
  </main>;
}
