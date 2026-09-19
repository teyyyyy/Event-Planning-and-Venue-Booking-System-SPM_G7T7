import React, { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

function formatTime(value) {
  if (!value) return '—';
  const [hour, minute] = value.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute));
  return date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

function statusClass(status) {
  return String(status || '').toLowerCase().replaceAll(' ', '-');
}

export default function EquipmentAvailability({ user }) {
  const [screen, setScreen] = useState('events');
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadEvents() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API}/equipment-availability/${user.id}/events`);
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || 'Unable to load equipment requests.');
      setEvents(Array.isArray(result) ? result : []);
    } catch (loadError) {
      setEvents([]);
      setError(loadError.message || 'Unable to load equipment requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, [user.id]);

  async function checkAvailability(eventId) {
    setChecking(true);
    setError('');
    setShowCatalogue(false);
    setCatalogue([]);

    try {
      const response = await fetch(`${API}/equipment-availability/${user.id}/events/${eventId}`);
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || 'Unable to check equipment availability.');

      setSelectedEvent(result.event);
      setAvailability(result.availability || []);
      setSummary({
        request_id: result.request_id,
        request_status: result.request_status,
        all_equipment_available: result.all_equipment_available,
        unavailable_equipment_count: result.unavailable_equipment_count,
      });
      setScreen('details');
    } catch (checkError) {
      setError(checkError.message || 'Unable to check equipment availability.');
    } finally {
      setChecking(false);
    }
  }

  async function loadCatalogue() {
    if (!selectedEvent) return;

    if (showCatalogue) {
      setShowCatalogue(false);
      return;
    }

    if (catalogue.length > 0) {
      setShowCatalogue(true);
      return;
    }

    setCatalogueLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${API}/equipment-availability/${user.id}/events/${selectedEvent.id}/catalogue`,
      );
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || 'Unable to load equipment catalogue.');

      setCatalogue(Array.isArray(result) ? result : []);
      setShowCatalogue(true);
    } catch (catalogueError) {
      setError(catalogueError.message || 'Unable to load equipment catalogue.');
    } finally {
      setCatalogueLoading(false);
    }
  }

  async function backToEvents() {
    setScreen('events');
    setSelectedEvent(null);
    setAvailability([]);
    setCatalogue([]);
    setSummary(null);
    setShowCatalogue(false);
    await loadEvents();
  }

  if (loading && screen === 'events') {
    return (
      <section className="equipment-page">
        <p>Loading equipment availability…</p>
      </section>
    );
  }

  if (screen === 'events') {
    return (
      <section className="equipment-page">
        <header className="equipment-page-header">
          <div>
            <p className="kicker">Gather / Equipment availability</p>
            <h1>Equipment availability</h1>
          </div>
          <span className="live">● Supabase connected</span>
        </header>

        {error && <div className="page-error">{error}</div>}

        <div className="request-form">
          <div className="form-heading">
            <div>
              <h2>Availability by event</h2>
              <p>Check whether the equipment requested for each event can be fulfilled.</p>
            </div>
          </div>

          {events.length === 0 ? (
            <p className="empty-state">There are currently no equipment requests to check.</p>
          ) : (
            <div className="request-table-wrapper">
              <table className="availability-event-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Event Date</th>
                    <th>Event Time</th>
                    <th>Requested Equipment</th>
                    <th>Request Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {events.map((event) => (
                    <tr key={event.event_id}>
                      <td><strong>{event.event_name}</strong></td>
                      <td>{event.event_date}</td>
                      <td>{formatTime(event.start_time)} – {formatTime(event.end_time)}</td>
                      <td>
                        <div className="availability-equipment-summary">
                          <strong>{event.requested_equipment_count} equipment type{event.requested_equipment_count === 1 ? '' : 's'}</strong>
                          <span>{event.equipment_description}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`request-status request-status-${statusClass(event.request_status)}`}>
                          {event.request_status}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="assign"
                          disabled={checking}
                          onClick={() => checkAvailability(event.event_id)}
                        >
                          {checking ? 'Checking…' : 'Check Availability'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="equipment-page">
      <header className="equipment-page-header">
        <div>
          <p className="kicker">Gather / Equipment availability</p>
          <h1>{selectedEvent?.event_name}</h1>
        </div>
        <span className="live">● Supabase connected</span>
      </header>

      <div className="technical-detail-toolbar">
        <button type="button" className="secondary" onClick={backToEvents}>
          ← Back to all events
        </button>

        <div className="technical-event-date">
          {selectedEvent?.event_date} · {formatTime(selectedEvent?.start_time)} – {formatTime(selectedEvent?.end_time)}
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className={`availability-overview ${summary?.all_equipment_available ? 'available' : 'insufficient'}`}>
        <div>
          <span className="availability-overview-label">Request #{summary?.request_id}</span>
          <h2>{summary?.all_equipment_available ? 'All requested equipment is available' : 'Some requested equipment cannot be fully fulfilled'}</h2>
          <p>
            {summary?.all_equipment_available
              ? 'Current catalogue quantities, maintenance and overlapping allocations allow this request to be fulfilled.'
              : `${summary?.unavailable_equipment_count || 0} requested equipment type${summary?.unavailable_equipment_count === 1 ? '' : 's'} currently have insufficient availability.`}
          </p>
        </div>

        <span className={`availability-result-pill ${summary?.all_equipment_available ? 'available' : 'insufficient'}`}>
          {summary?.all_equipment_available ? 'Available' : 'Attention Required'}
        </span>
      </div>

      <div className="request-form availability-details-card">
        <div className="form-heading">
          <div>
            <h2>Requested equipment availability</h2>
            <p>Availability is calculated for this event's date and time.</p>
          </div>
        </div>

        <div className="availability-formula">
          Available quantity = Total quantity − Under maintenance − Reserved for overlapping events
        </div>

        <div className="request-table-wrapper">
          <table className="availability-detail-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Requested</th>
                <th>Total</th>
                <th>Maintenance</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Result</th>
              </tr>
            </thead>

            <tbody>
              {availability.map((item) => (
                <tr key={item.equipment_id}>
                  <td>
                    <strong>{item.equipment_name}</strong>
                    <span className="availability-equipment-id">{item.equipment_id}</span>
                  </td>
                  <td>{item.requested_quantity}</td>
                  <td>{item.total_quantity}</td>
                  <td>{item.under_maintenance_count}</td>
                  <td>{item.reserved_quantity}</td>
                  <td><strong className="available-number">{item.available_quantity}</strong></td>
                  <td>
                    <span className={`availability-result-pill ${statusClass(item.availability_status)}`}>
                      {item.availability_status}
                    </span>

                    {item.shortage_quantity > 0 && (
                      <span className="availability-shortage">Short by {item.shortage_quantity}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {availability.length === 0 && (
          <p className="empty-state">This request does not contain any active equipment items.</p>
        )}
      </div>

      <div className="request-form catalogue-section">
        <div className="form-heading">
          <div>
            <h2>Full equipment catalogue</h2>
            <p>View current quantities across the full catalogue for this event's date and time.</p>
          </div>

          <button type="button" className="secondary" onClick={loadCatalogue} disabled={catalogueLoading}>
            {catalogueLoading ? 'Loading…' : showCatalogue ? 'Hide Catalogue' : 'View Full Catalogue'}
          </button>
        </div>

        {showCatalogue && (
          <div className="request-table-wrapper">
            <table className="availability-catalogue-table">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Total</th>
                  <th>Maintenance</th>
                  <th>Reserved</th>
                  <th>Available</th>
                </tr>
              </thead>

              <tbody>
                {catalogue.map((item) => (
                  <tr key={item.equipment_id}>
                    <td>
                      <strong>{item.equipment_name}</strong>
                      <span className="availability-equipment-id">{item.equipment_id}</span>
                    </td>
                    <td>{item.total_quantity}</td>
                    <td>{item.under_maintenance_count}</td>
                    <td>{item.reserved_quantity}</td>
                    <td><strong>{item.available_quantity}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}