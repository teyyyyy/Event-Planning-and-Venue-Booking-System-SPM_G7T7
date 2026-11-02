import React, { useEffect, useState } from 'react';
import { authenticatedFetch as fetch } from './api';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatEventDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatEventTime(value) {
  if (!value) return '—';
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEventPeriod(event) {
  if (!event?.event_date) return '—';

  const startDate = formatEventDate(event.event_date);
  const endDate = formatEventDate(event.event_end_date || event.event_date);
  const startTime = formatEventTime(event.start_time);
  const endTime = formatEventTime(event.end_time);

  if (!event.event_end_date || event.event_end_date === event.event_date) {
    return `${startDate}, ${startTime} – ${endTime}`;
  }

  return `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

// Existing rows use request_id + equipment_id as their identity.
function makeEditableRequests(requests) {
  return requests.map((request) => ({
    ...request,
    items: (request.items || []).map((item) => ({
      ...item,
      requested_quantity: String(item.requested_quantity),
      _originalEquipmentId: item.equipment_id,
      _localId: `existing-${request.request_id}-${item.equipment_id}`,
    })),
  }));
}

export default function EquipmentUpdate({ user }) {
  const [screen, setScreen] = useState('summary');
  const [summaries, setSummaries] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [requests, setRequests] = useState([]);
  const [originalRequests, setOriginalRequests] = useState([]);
  const [equipmentCatalogue, setEquipmentCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);

  async function loadSummary() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/equipment-update/${user.id}/requests/summary`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to load equipment requests.');
      setSummaries(Array.isArray(result) ? result : []);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load equipment requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, [user.id]);

  async function openEvent(eventId) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/equipment-update/${user.id}/events/${eventId}/requests`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to load request details.');

      setSelectedEvent(result.event);
      setEquipmentCatalogue(result.equipment_catalogue || []);

      const editableRequests = makeEditableRequests(result.requests || []);
      setRequests(editableRequests);
      setOriginalRequests(deepCopy(editableRequests));
      setScreen('details');
    } catch (loadError) {
      setError(loadError.message || 'Unable to load request details.');
    } finally {
      setLoading(false);
    }
  }

  function findOriginalRequest(requestId) {
    return originalRequests.find((request) => request.request_id === requestId);
  }

  function findOriginalItem(requestId, equipmentId) {
    const originalRequest = findOriginalRequest(requestId);
    return originalRequest?.items?.find((item) => item.equipment_id === equipmentId);
  }

  function equipmentName(equipmentId) {
    return equipmentCatalogue.find((equipment) => equipment.equipment_id === equipmentId)?.equipment_name || equipmentId || 'Equipment';
  }

  function buildItemChanges(requestId, item) {
    const original = findOriginalItem(requestId, item._originalEquipmentId);
    if (!original) return [];

    const changes = [];
    const oldQuantity = Number(original.requested_quantity);
    const newQuantity = Number(item.requested_quantity);

    if (oldQuantity !== newQuantity) {
      if (newQuantity === 0) changes.push(`Quantity: ${oldQuantity} → 0 (Cancelled)`);
      else changes.push(`Quantity: ${oldQuantity} → ${newQuantity}`);
    }

    const oldRequirements = (original.technical_requirements || '').trim();
    const newRequirements = (item.technical_requirements || '').trim();

    if (oldRequirements !== newRequirements) {
      changes.push(`Technical requirements: "${oldRequirements || 'None'}" → "${newRequirements || 'None'}"`);
    }

    return changes;
  }

  function requestHasChanges(request) {
    return request.items.some((item) => buildItemChanges(request.request_id, item).length > 0);
  }

  function changedRequestCount() {
    return requests.filter((request) => requestHasChanges(request)).length;
  }

  function changeItem(requestId, localId, field, value) {
    setRequests((currentRequests) =>
      currentRequests.map((request) => {
        if (request.request_id !== requestId) return request;
        return {
          ...request,
          items: request.items.map((item) => item._localId !== localId ? item : { ...item, [field]: value }),
        };
      }),
    );
  }


  function validateChanges() {
    const changedRequests = requests.filter((request) => requestHasChanges(request));
    if (changedRequests.length === 0) return { valid: false, message: 'There are no changes to confirm.' };

    for (const request of changedRequests) {
      for (const item of request.items) {
        if (item.requested_quantity === '') {
          return {
            valid: false,
            message: `Please enter a quantity for every equipment item in request #${request.request_id}.`,
          };
        }

        const quantity = Number(item.requested_quantity);

        if (!Number.isInteger(quantity) || quantity < 0) {
          return { valid: false, message: 'Quantity must be a whole number of 0 or more.' };
        }

      }
    }

    return { valid: true, changedRequests };
  }

  async function confirmAllUpdates() {
    const validation = validateChanges();

    if (!validation.valid) {
      setNotice({ type: 'error', text: validation.message });
      return;
    }

    setSaving(true);

    try {
      const payload = {
        requests: validation.changedRequests.map((request) => ({
          request_id: request.request_id,
          items: request.items.map((item) => ({
            equipment_id: item.equipment_id,
            requested_quantity: Number(item.requested_quantity),
            technical_requirements: (item.technical_requirements || '').trim(),
          })),
        })),
      };

      const response = await fetch(`${API}/equipment-update/${user.id}/events/${selectedEvent.id}/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to update equipment requests.');

      const updatedCount =
        result.updated_requests?.length ??
        result.updated_request_ids?.length ??
        validation.changedRequests.length;

      setNotice({
        type: 'success',
        text: `${updatedCount} equipment request${updatedCount === 1 ? '' : 's'} updated successfully.`,
      });

      await openEvent(selectedEvent.id);
    } catch (saveError) {
      setNotice({ type: 'error', text: saveError.message || 'Unable to update equipment requests.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading && screen === 'summary') {
    return (
      <section className="equipment-page">
        <p>Loading equipment requests…</p>
      </section>
    );
  }

  if (screen === 'summary') {
    return (
      <section className="equipment-page">
        <header className="equipment-page-header">
          <div>
            <p className="kicker">Gather / Equipment update</p>
            <h1>Equipment requests</h1>
          </div>
          <span className="live">● Supabase connected</span>
        </header>

        {error && <div className="page-error">{error}</div>}

        <div className="request-form">
          <div className="form-heading">
            <div>
              <h2>Requests by event</h2>
              <p>Review all equipment requests grouped by event.</p>
            </div>
          </div>

          {summaries.length === 0 ? (
            <p className="empty-state">There are currently no equipment requests.</p>
          ) : (
            <div className="request-table-wrapper">
              <table className="request-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Event Period</th>
                    <th>Requests</th>
                    <th>Combined Equipment</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((summary) => (
                    <tr key={summary.event_id}>
                      <td><strong>{summary.event_name}</strong></td>
                      <td>{formatEventPeriod(summary)}</td>
                      <td>{summary.request_count}</td>
                      <td>{summary.equipment_description}</td>
                      <td>
                        <span className={`request-status request-status-${summary.status.toLowerCase().replaceAll(' ', '-')}`}>
                          {summary.status}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="assign" onClick={() => openEvent(summary.event_id)}>
                          View full details
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
          <p className="kicker">Gather / Equipment update</p>
          <h1>{selectedEvent?.event_name}</h1>
        </div>
        <span className="live">● Supabase connected</span>
      </header>

      <div className="technical-detail-toolbar">
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            setScreen('summary');
            await loadSummary();
          }}
        >
          ← Back to all events
        </button>

        <div className="technical-event-date">
          Event period: <strong>{formatEventPeriod(selectedEvent)}</strong>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}
      {loading && <p>Loading request details…</p>}
      {!loading && requests.length === 0 && <p className="empty-state">No equipment requests exist for this event.</p>}

      {!loading && requests.map((request) => (
        <div className="technical-request-card" key={request.request_id}>
          <div className="technical-request-header">
            <div>
              <h2>Request #{request.request_id}</h2>
              <p>
                Submitted by <strong>{request.created_by_name || request.created_by}</strong>
                {' · '}
                {formatDateTime(request.created_at)}
              </p>
            </div>

            <span className={`request-status request-status-${request.status.toLowerCase().replaceAll(' ', '-')}`}>
              {request.status}
            </span>
          </div>

          {request.items.map((item, index) => {
            const changes = buildItemChanges(request.request_id, item);

            return (
              <div className="technical-edit-item" key={item._localId}>
                <div className="equipment-update-item-heading">
                  <h3>
                    Equipment {index + 1}
                  </h3>
                </div>

                <div className="form-grid">
                  <label>
                    Equipment

                    <input type="text" value={equipmentName(item.equipment_id)} readOnly />
                  </label>

                  <label>
                    Final quantity
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={item.requested_quantity}
                      onChange={(event) =>
                        changeItem(request.request_id, item._localId, 'requested_quantity', event.target.value)
                      }
                    />
                    <span className="availability-hint">
                      Set quantity to 0 to cancel it. It will be removed after confirmation.
                    </span>
                  </label>

                  <label className="wide">
                    Technical requirements
                    <textarea
                      rows="4"
                      value={item.technical_requirements}
                      onChange={(event) =>
                        changeItem(request.request_id, item._localId, 'technical_requirements', event.target.value)
                      }
                    />
                  </label>
                </div>

                <div className="technical-change-summary">
                  <strong>Changes before confirmation</strong>

                  {changes.length === 0 ? (
                    <p>No changes to this equipment item.</p>
                  ) : (
                    <ul>
                      {changes.map((change, changeIndex) => (
                        <li key={changeIndex}>{change}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}

          {request.updated_by && (
            <div className="equipment-update-last-updated">
              Last updated by <strong>{request.updated_by_name || request.updated_by}</strong>
              {' · '}
              {formatDateTime(request.updated_at)}
            </div>
          )}
        </div>
      ))}

      {!loading && requests.length > 0 && (
        <div className="equipment-update-final-actions">
          <div>
            <strong>Final event changes</strong>
            <p>
              {changedRequestCount() === 0
                ? 'No equipment requests have been changed.'
                : `${changedRequestCount()} request${changedRequestCount() === 1 ? '' : 's'} contain changes.`}
            </p>
          </div>

          <button
            type="button"
            className="primary"
            disabled={saving || changedRequestCount() === 0}
            onClick={confirmAllUpdates}
          >
            {saving ? 'Updating…' : 'Confirm All Updates'}
          </button>
        </div>
      )}

      {notice && (
        <>
          <div className="notice-backdrop" />
          <div className={`notice ${notice.type}`} role="alertdialog" aria-modal="true">
            <div className="notice-icon">{notice.type === 'success' ? '✓' : '!'}</div>
            <div>
              <h2>{notice.type === 'success' ? 'Update successful' : 'Something went wrong'}</h2>
              <p>{notice.text}</p>
              <button type="button" className="primary" onClick={() => setNotice(null)}>Close</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}