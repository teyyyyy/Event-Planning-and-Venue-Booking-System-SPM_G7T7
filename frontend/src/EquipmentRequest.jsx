import React, { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

function newEquipmentRow() {
  return { equipment_id: '', requested_quantity: '', technical_requirements: '', isNew: true };
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EquipmentRequest({ user }) {
  const [activeTab, setActiveTab] = useState('submission');
  const [events, setEvents] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [eventId, setEventId] = useState('');
  const [items, setItems] = useState([newEquipmentRow()]);
  const [availability, setAvailability] = useState({});
  const [requests, setRequests] = useState([]);
  const [editingRequest, setEditingRequest] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editAvailability, setEditAvailability] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [checkingEditAvailability, setCheckingEditAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState(null);

  async function loadAvailableEvents() {
    const response = await fetch(`${API}/event-coordinators/${user.id}/events`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Unable to load assigned events.');
    setEvents(Array.isArray(result) ? result : []);
  }

  async function loadEquipmentCatalogue() {
    const response = await fetch(`${API}/equipment`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Unable to load equipment catalogue.');
    setEquipment(Array.isArray(result) ? result : []);
  }

  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      setPageError('');
      const results = await Promise.allSettled([loadAvailableEvents(), loadEquipmentCatalogue()]);
      const [eventResult, equipmentResult] = results;

      if (eventResult.status === 'rejected') {
        setEvents([]);
        setPageError(eventResult.reason?.message || 'Unable to load assigned events.');
      }

      if (equipmentResult.status === 'rejected') {
        setEquipment([]);
        if (eventResult.status !== 'rejected') {
          setPageError(equipmentResult.reason?.message || 'Unable to load equipment catalogue.');
        }
      }
      setLoading(false);
    }
    loadInitialData();
  }, [user.id]);

  async function getAvailabilityForEvent(selectedEventId) {
    const response = await fetch(`${API}/event-coordinators/${user.id}/events/${selectedEventId}/equipment-availability`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Unable to check equipment availability.');

    const availabilityMap = {};
    result.forEach((item) => { availabilityMap[item.equipment_id] = item; });
    return availabilityMap;
  }

  useEffect(() => {
    if (!eventId) {
      setAvailability({});
      return;
    }

    async function loadAvailability() {
      setCheckingAvailability(true);
      try {
        setAvailability(await getAvailabilityForEvent(eventId));
      } catch (error) {
        setAvailability({});
        setNotice({ type: 'error', text: error.message || 'Unable to check equipment availability.' });
      } finally {
        setCheckingAvailability(false);
      }
    }
    loadAvailability();
  }, [eventId, user.id]);

  async function loadRequests() {
    setLoadingRequests(true);
    try {
      const response = await fetch(`${API}/event-coordinators/${user.id}/equipment-requests`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to load equipment requests.');
      setRequests(Array.isArray(result) ? result : []);
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Unable to load equipment requests.' });
    } finally {
      setLoadingRequests(false);
    }
  }

  function openRequestView() {
    setEditingRequest(null);
    setEditItems([]);
    setEditAvailability({});
    setActiveTab('view');
    loadRequests();
  }

  const selectedEquipmentIds = useMemo(() => items.map((item) => item.equipment_id).filter(Boolean), [items]);

  function changeItem(index, field, value) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function addEquipmentRow() {
    setItems((current) => [...current, newEquipmentRow()]);
  }

  function removeEquipmentRow(index) {
    if (items.length === 1) return;
    setItems((current) => current.filter((_, i) => i !== index));
  }

  function quantityError(item, availabilityMap) {
    if (item.requested_quantity === '') return '';
    const quantity = Number(item.requested_quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return 'Quantity must be a positive whole number.';
    if (!item.equipment_id) return '';

    const equipmentAvailability = availabilityMap[item.equipment_id];
    if (!equipmentAvailability) return '';

    const maximum = Number(equipmentAvailability.available_quantity);
    return quantity > maximum ? `Maximum currently available: ${maximum}.` : '';
  }

  function formIsValid() {
    if (!eventId || !items.length) return false;
    return items.every((item) =>
      item.equipment_id &&
      item.requested_quantity !== '' &&
      !quantityError(item, availability)
    );
  }

  async function submitRequest(event) {
    event.preventDefault();

    if (!formIsValid()) {
      setNotice({ type: 'error', text: 'Please complete all equipment fields with valid quantities.' });
      return;
    }

    const payload = {
      event_id: Number(eventId),
      items: items.map((item) => ({
        equipment_id: item.equipment_id,
        requested_quantity: Number(item.requested_quantity),
        technical_requirements: (item.technical_requirements || '').trim(),
      })),
    };

    setSubmitting(true);
    try {
      const response = await fetch(`${API}/event-coordinators/${user.id}/equipment-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Equipment request could not be submitted.');

      setNotice({ type: 'success', text: `Equipment request #${result.request_id} was submitted successfully.` });
      setEventId('');
      setItems([newEquipmentRow()]);
      setAvailability({});
      await loadAvailableEvents();
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Equipment request could not be submitted.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function startEditingRequest(request) {
    setCheckingEditAvailability(true);
    try {
      setEditAvailability(await getAvailabilityForEvent(request.event_id));
      setEditingRequest(request);
      setEditItems((request.items || []).map((item) => ({
        equipment_id: item.equipment_id,
        requested_quantity: String(item.requested_quantity),
        technical_requirements: item.technical_requirements || '',
        isNew: false,
      })));
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Unable to prepare this request for editing.' });
    } finally {
      setCheckingEditAvailability(false);
    }
  }

  function cancelEditingRequest() {
    setEditingRequest(null);
    setEditItems([]);
    setEditAvailability({});
  }

  const editSelectedEquipmentIds = useMemo(
    () => editItems.map((item) => item.equipment_id).filter(Boolean),
    [editItems],
  );

  function changeEditItem(index, field, value) {
    setEditItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function addEditEquipmentRow() {
    setEditItems((current) => [...current, newEquipmentRow()]);
  }

  function removeEditEquipmentRow(index) {
    if (editItems.length === 1) {
      setNotice({ type: 'error', text: 'An equipment request must contain at least one equipment item.' });
      return;
    }
    setEditItems((current) => current.filter((_, i) => i !== index));
  }

  function editFormIsValid() {
    if (!editingRequest || !editItems.length) return false;
    const equipmentIds = editItems.map((item) => item.equipment_id).filter(Boolean);
    if (equipmentIds.length !== new Set(equipmentIds).size) return false;

    return editItems.every((item) =>
      item.equipment_id &&
      item.requested_quantity !== '' &&
      !quantityError(item, editAvailability)
    );
  }

  async function saveEditedRequest(event) {
    event.preventDefault();

    if (!editFormIsValid()) {
      setNotice({ type: 'error', text: 'Please complete all equipment fields with valid quantities.' });
      return;
    }

    const payload = {
      items: editItems.map((item) => ({
        equipment_id: item.equipment_id,
        requested_quantity: Number(item.requested_quantity),
        technical_requirements: (item.technical_requirements || '').trim(),
      })),
    };

    setSavingEdit(true);
    try {
      const response = await fetch(`${API}/event-coordinators/${user.id}/equipment-requests/${editingRequest.request_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Equipment request could not be updated.');

      const requestId = editingRequest.request_id;
      setEditingRequest(null);
      setEditItems([]);
      setEditAvailability({});
      await Promise.all([loadRequests(), loadAvailableEvents()]);
      setNotice({ type: 'success', text: `Equipment request #${requestId} was updated successfully.` });
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Equipment request could not be updated.' });
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) {
    return (
      <section className="equipment-page">
        <p>Loading equipment request page…</p>
      </section>
    );
  }

  return (
    <section className="equipment-page">
      <header className="equipment-page-header">
        <div>
          <p className="kicker">Gather / Equipment planning</p>
          <h1>Equipment request</h1>
        </div>
        <span className="live">● Supabase connected</span>
      </header>

      <div className="equipment-sub-tabs">
        <button
          type="button"
          className={activeTab === 'submission' ? 'active' : ''}
          onClick={() => {
            cancelEditingRequest();
            setActiveTab('submission');
          }}
        >
          Equipment Request Submission
        </button>
        <button type="button" className={activeTab === 'view' ? 'active' : ''} onClick={openRequestView}>
          Equipment Request View
        </button>
      </div>

      {pageError && <div className="page-error">{pageError}</div>}

      {activeTab === 'submission' && (
        <form className="request-form" onSubmit={submitRequest}>
          <div className="form-heading">
            <div>
              <h2>Submit equipment request</h2>
              <p>Select one of your assigned events and specify the equipment required. Events that already have an equipment request are not shown.</p>
            </div>
            <div className="form-actions">
              <button className="primary" type="submit" disabled={submitting || checkingAvailability || !formIsValid()}>
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </div>

          <div className="form-grid">
            <label className="wide">
              Event
              <select value={eventId} onChange={(event) => setEventId(event.target.value)} required>
                <option value="">Select assigned event</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>{event.event_name} — {event.event_date}</option>
                ))}
              </select>
            </label>
          </div>

          {events.length === 0 && (
            <p className="field-warning">
              No assigned events are available for a new equipment request. Events that already have a request are excluded.
            </p>
          )}

          <div className="equipment-request-items">
            <div className="equipment-items-heading">
              <div>
                <h3>Equipment required</h3>
                <p>Add each type of equipment required for this event.</p>
              </div>
              <button type="button" className="secondary" onClick={addEquipmentRow}>+ Add equipment</button>
            </div>

            {items.map((item, index) => {
              const currentAvailability = item.equipment_id ? availability[item.equipment_id] : null;
              const error = quantityError(item, availability);

              return (
                <div className="equipment-item-card" key={index}>
                  <h4>Equipment {index + 1}</h4>
                  <div className="form-grid">
                    <label>
                      Equipment type
                      <select value={item.equipment_id} onChange={(event) => changeItem(index, 'equipment_id', event.target.value)} required>
                        <option value="">Select equipment</option>
                        {equipment.map((equipmentItem) => {
                          const alreadySelected =
                            selectedEquipmentIds.includes(equipmentItem.equipment_id) &&
                            item.equipment_id !== equipmentItem.equipment_id;

                          return (
                            <option key={equipmentItem.equipment_id} value={equipmentItem.equipment_id} disabled={alreadySelected}>
                              {equipmentItem.equipment_name}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label>
                      Requested quantity
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={item.requested_quantity}
                        onChange={(event) => changeItem(index, 'requested_quantity', event.target.value)}
                        placeholder="Enter quantity"
                        required
                      />
                      {currentAvailability && (
                        <span className="availability-hint">Available for this event: {currentAvailability.available_quantity}</span>
                      )}
                      {error && <span className="field-error">{error}</span>}
                    </label>

                    <label className="wide">
                      Technical requirements <span className="optional-label">(Optional)</span>
                      <textarea
                        rows="4"
                        value={item.technical_requirements}
                        onChange={(event) => changeItem(index, 'technical_requirements', event.target.value)}
                        placeholder="Example: Wireless microphones, HDMI connection, floor-standing speakers."
                      />
                    </label>
                  </div>

                  {items.length > 1 && (
                    <button type="button" className="remove-equipment" onClick={() => removeEquipmentRow(index)}>
                      Remove equipment
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </form>
      )}

      {activeTab === 'view' && !editingRequest && (
        <div className="request-form">
          <div className="form-heading">
            <div>
              <h2>Equipment request submissions</h2>
              <p>View or edit your submitted equipment requests.</p>
            </div>
          </div>

          {loadingRequests ? (
            <p>Loading requests…</p>
          ) : requests.length === 0 ? (
            <p className="empty-state">No equipment requests have been submitted yet.</p>
          ) : (
            <div className="request-table-wrapper">
              <table className="request-table">
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>Event</th>
                    <th>Event Date</th>
                    <th>Equipment Details</th>
                    <th>Latest Technical Support Update</th>
                    <th>Status</th>
                    <th>Updated By</th>
                    <th>Last Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {requests.map((request) => (
                    <tr key={request.request_id}>
                      <td>#{request.request_id}</td>
                      <td><strong>{request.event_name}</strong></td>
                      <td>{request.event_date}</td>

                      <td>
                        <div className="request-equipment-list">
                          {request.items?.map((item) => (
                            <div className="request-equipment-item" key={`${request.request_id}-${item.equipment_id}`}>
                              <div className="request-equipment-name">
                                {item.equipment_name} <span className="request-quantity">× {item.requested_quantity}</span>
                              </div>
                              <div className="request-requirement">
                                <span>Technical requirements</span>
                                {item.technical_requirements?.trim() ? item.technical_requirements : <em>None</em>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>

                      <td>
                        {request.latest_update_summary?.trim() ? (
                          <div className="request-latest-update">
                            <strong>Latest update</strong>
                            <div className="request-latest-update-text">
                              {request.latest_update_summary
                                .split('\n')
                                .filter((line) => line.trim())
                                .map((line, index) => (
                                  <div key={`${request.request_id}-latest-update-${index}`}>{line}</div>
                                ))}
                            </div>
                          </div>
                        ) : (
                          <span className="request-time-note">No Technical Support updates yet</span>
                        )}
                      </td>

                      <td>
                        <span className={`request-status request-status-${request.status?.toLowerCase().replaceAll(' ', '-')}`}>
                          {request.status}
                        </span>
                      </td>

                      <td>
                        {request.updated_by ? (
                          <div className="request-updated-by">
                            <strong>{request.updated_by_name || 'Technical Support Staff'}</strong>
                            <div className="request-time-note">{request.updated_by}</div>
                          </div>
                        ) : (
                          <span className="request-time-note">—</span>
                        )}
                      </td>

                      <td>
                        <div className="request-update-time">{formatDateTime(request.updated_at || request.created_at)}</div>
                        <div className="request-time-note">{request.status === 'Updated' ? 'Updated' : 'Submitted'}</div>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="secondary"
                          disabled={checkingEditAvailability}
                          onClick={() => startEditingRequest(request)}
                        >
                          Edit Request
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'view' && editingRequest && (
        <form className="request-form" onSubmit={saveEditedRequest}>
          <div className="form-heading">
            <div>
              <h2>Edit equipment request #{editingRequest.request_id}</h2>
              <p>{editingRequest.event_name} — {editingRequest.event_date}</p>
            </div>

            <div className="form-actions">
              <button type="button" className="secondary" onClick={cancelEditingRequest} disabled={savingEdit}>Cancel</button>
              <button type="submit" className="primary" disabled={savingEdit || checkingEditAvailability || !editFormIsValid()}>
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>

          <p className="field-warning">
            Existing equipment types cannot be changed directly because request ID and equipment ID form the primary key.
            To replace an equipment type, remove it and add the new equipment.
          </p>

          <div className="equipment-request-items">
            <div className="equipment-items-heading">
              <div>
                <h3>Equipment required</h3>
                <p>Update quantities or requirements, remove equipment, or add new equipment.</p>
              </div>
              <button type="button" className="secondary" onClick={addEditEquipmentRow}>+ Add equipment</button>
            </div>

            {editItems.map((item, index) => {
              const currentAvailability = item.equipment_id ? editAvailability[item.equipment_id] : null;
              const error = quantityError(item, editAvailability);

              return (
                <div
                  className="equipment-item-card"
                  key={item.isNew ? `new-${index}` : `${editingRequest.request_id}-${item.equipment_id}`}
                >
                  <h4>Equipment {index + 1}{item.isNew ? ' — New' : ''}</h4>

                  <div className="form-grid">
                    <label>
                      Equipment type
                      {item.isNew ? (
                        <select
                          value={item.equipment_id}
                          onChange={(event) => changeEditItem(index, 'equipment_id', event.target.value)}
                          required
                        >
                          <option value="">Select equipment</option>

                          {equipment.map((equipmentItem) => {
                            const alreadySelected =
                              editSelectedEquipmentIds.includes(equipmentItem.equipment_id) &&
                              item.equipment_id !== equipmentItem.equipment_id;

                            return (
                              <option key={equipmentItem.equipment_id} value={equipmentItem.equipment_id} disabled={alreadySelected}>
                                {equipmentItem.equipment_name}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={
                            equipment.find((equipmentItem) => equipmentItem.equipment_id === item.equipment_id)?.equipment_name ||
                            item.equipment_id
                          }
                          readOnly
                        />
                      )}
                    </label>

                    <label>
                      Requested quantity
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={item.requested_quantity}
                        onChange={(event) => changeEditItem(index, 'requested_quantity', event.target.value)}
                        required
                      />
                      {currentAvailability && (
                        <span className="availability-hint">Available for this event: {currentAvailability.available_quantity}</span>
                      )}
                      {error && <span className="field-error">{error}</span>}
                    </label>

                    <label className="wide">
                      Technical requirements <span className="optional-label">(Optional)</span>
                      <textarea
                        rows="4"
                        value={item.technical_requirements}
                        onChange={(event) => changeEditItem(index, 'technical_requirements', event.target.value)}
                      />
                    </label>
                  </div>

                  <button type="button" className="remove-equipment" onClick={() => removeEditEquipmentRow(index)}>
                    Remove equipment
                  </button>
                </div>
              );
            })}
          </div>
        </form>
      )}

      {notice && (
        <>
          <div className="notice-backdrop" />
          <div className={`notice ${notice.type}`} role="alertdialog" aria-modal="true">
            <div className="notice-icon">{notice.type === 'success' ? '✓' : '!'}</div>
            <div>
              <h2>{notice.type === 'success' ? 'Success' : 'Something went wrong'}</h2>
              <p>{notice.text}</p>
              <button className="primary" type="button" onClick={() => setNotice(null)}>Close</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}