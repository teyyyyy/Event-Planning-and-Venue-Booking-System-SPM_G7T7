import React, { useEffect, useState } from 'react';
import { authenticatedFetch as fetch } from './api';

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
const emptyRequest = { event_name: '', event_type: '', event_date: '', event_end_date: '', event_capacity: '', description: '', start_time: '', end_time: '' };
const eventTypes = ['Conference', 'Workshop', 'Seminar', 'Training', 'Meeting', 'Networking', 'Exhibition', 'Social event', 'Other'];
const capacityOptions = [{ label: '1-25 attendees', value: 25 }, { label: '26-50 attendees', value: 50 }, { label: '51-100 attendees', value: 100 }, { label: '101-250 attendees', value: 250 }, { label: '251-500 attendees', value: 500 }, { label: '501-1000 attendees', value: 1000 }, { label: 'More than 1000 attendees', value: 1001 }];
const timeOptions = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const editableStatuses = ['Submitted'];
const today = new Date().toISOString().split('T')[0];

function formTime(value) { return String(value ?? '').slice(0, 5); }
function dateRange(start, end) { return end && end !== start ? `${start} to ${end}` : start; }
function coordinatorComments(value) {
  if (Array.isArray(value)) return value.map((comment) => String(comment).trim()).filter(Boolean);
  if (value && typeof value === 'object') return Object.entries(value).map(([field, comment]) => `${field}: ${comment}`);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((comment) => String(comment).trim()).filter(Boolean);
    if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([field, comment]) => `${field}: ${comment}`);
  } catch {
    return value.split(/\r?\n/).map((comment) => comment.trim()).filter(Boolean);
  }
  return [value];
}
// Single-day events store the same end date; older rows may have none.
function scheduleError(form) {
  const endDate = form.event_end_date || form.event_date;
  if (endDate < form.event_date) return 'End date cannot be before the start date.';
  if (endDate === form.event_date && form.end_time <= form.start_time) return 'End time must be later than the start time.';
  return null;
}

export default function EventOrganiser({ user, editingEvent, onEditComplete }) {
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(emptyRequest);
  const [editingId, setEditingId] = useState(null);
  const [viewingRequest, setViewingRequest] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState(null);
  const [loadingAction, setLoadingAction] = useState(null);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const isSubmitting = loadingAction !== null;
  const organiserId = user?.id || '';
  const editingRequest = requests.find((request) => String(request.id) === String(editingId));
  const currentClarifications = coordinatorComments(editingRequest?.coordinator_comments ?? editingEvent?.coordinator_comments);

  async function loadRequests() {
    setIsLoadingRequests(true);
    try {
      const response = await fetch(`${API}/event-organisers/${organiserId}/submitted-requests`);
      if (!response.ok) throw new Error('Unable to load event requests.');
      setRequests(await response.json());
    } finally {
      setIsLoadingRequests(false);
    }
  }

  useEffect(() => { loadRequests().catch((error) => setMessage(error.message)); }, []);

  useEffect(() => {
    if (!editingEvent) return;
    setEditingId(editingEvent.id);
    setForm(Object.fromEntries(Object.keys(emptyRequest).map((key) => [
      key,
      key === 'event_name'
        ? (editingEvent.event_name ?? editingEvent.event_title ?? '')
        : key === 'event_end_date'
          ? (editingEvent.event_end_date ?? editingEvent.event_date ?? '')
          : (editingEvent[key] ?? ''),
    ])));
    onEditComplete?.();
  }, [editingEvent, onEditComplete]);

  function change(event) { setForm({ ...form, [event.target.name]: event.target.value }); }

  function editRequest(request) {
    setViewingRequest(false);
    setEditingId(request.id);
    setForm(Object.fromEntries(Object.keys(emptyRequest).map((key) => [key, key.endsWith('_time') ? formTime(request[key]) : key === 'event_end_date' ? (request[key] ?? request.event_date ?? '') : request[key] ?? ''])));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function viewRequest(request) {
    setViewingRequest(true);
    setEditingId(request.id);
    setForm(Object.fromEntries(Object.keys(emptyRequest).map((key) => [key, key.endsWith('_time') ? formTime(request[key]) : key === 'event_end_date' ? (request[key] ?? request.event_date ?? '') : request[key] ?? ''])));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveChanges(event) {
    event.preventDefault();
    if (isSubmitting) return;
    const scheduleProblem = scheduleError(form);
    if (scheduleProblem) return setNotice({ type: 'error', text: scheduleProblem });
    setLoadingAction('edit');
    let response;
    try {
      response = await fetch(`${API}/event-organisers/${organiserId}/requests/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, event_capacity: Number(form.event_capacity) }) });
    } catch (error) {
      setNotice({ type: 'error', text: `Cannot reach the backend at ${API}. Start FastAPI and try again.` });
      setLoadingAction(null);
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      setNotice({ type: 'error', text: result.detail || 'Could not update request.' });
      setLoadingAction(null);
      return;
    }
    try {
      await loadRequests();
    } catch (error) {
      setNotice({ type: 'error', text: 'Event was updated, but the refreshed event list could not be loaded.' });
      setLoadingAction(null);
      return;
    }
    setForm(emptyRequest); setEditingId(null); setNotice({ type: 'success', text: 'Event request updated successfully.' }); setLoadingAction(null);
  }

  async function submitForm(event) {
    event.preventDefault();
    if (isSubmitting) return;
    const scheduleProblem = scheduleError(form);
    if (scheduleProblem) return setNotice({ type: 'error', text: scheduleProblem });
    setLoadingAction('submit');
    let response;
    try {
      response = await fetch(`${API}/event-organisers/${organiserId}/requests/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, event_capacity: Number(form.event_capacity) }) });
    } catch (error) {
      setNotice({ type: 'error', text: `Cannot reach the backend at ${API}. Start FastAPI and try again.` });
      setLoadingAction(null);
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      setNotice({ type: 'error', text: result.detail || 'Event request was not submitted.' });
      setLoadingAction(null);
      return;
    }
    try {
      await loadRequests();
    } catch (error) {
      setNotice({ type: 'error', text: 'Event was submitted, but the refreshed event list could not be loaded.' });
      setLoadingAction(null);
      return;
    }
    setForm(emptyRequest); setEditingId(null); setNotice({ type: 'success', text: 'Event request submitted successfully and added to the table.' }); setLoadingAction(null);
  }

  async function saveDraft() {
    if (isSubmitting) return;
    setLoadingAction('draft');
    let response;
    try {
      response = await fetch(`${API}/event-organisers/${organiserId}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, event_capacity: Number(form.event_capacity) }) });
    } catch (error) {
      setNotice({ type: 'error', text: `Cannot reach the backend at ${API}. Start FastAPI and try again.` });
      setLoadingAction(null);
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      setNotice({ type: 'error', text: result.detail || 'Event draft could not be saved.' });
      setLoadingAction(null);
      return;
    }
    try {
      await loadRequests();
    } catch (error) {
      setNotice({ type: 'error', text: 'Draft was saved, but the refreshed event list could not be loaded.' });
      setLoadingAction(null);
      return;
    }
    setForm(emptyRequest); setNotice({ type: 'success', title: 'Draft saved', text: 'Event draft saved successfully and added to the table.' }); setLoadingAction(null);
  }

  async function submitRequest(id) {
    if (isSubmitting) return;
    setLoadingAction('row-submit');
    try {
      const response = await fetch(`${API}/event-organisers/${organiserId}/requests/${id}/submit`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) { setNotice({ type: 'error', text: result.detail || 'Could not submit request.' }); return; }
      await loadRequests();
      setNotice({ type: 'success', text: 'Event request submitted successfully.' });
    } catch (error) {
      setNotice({ type: 'error', text: `Cannot reach the backend at ${API}. Start FastAPI and try again.` });
    } finally {
      setLoadingAction(null);
    }
  }

  return <main className="shell organiser-shell">
    <aside><div className="logo">G</div><div className="side-label">EVENT ORGANISER</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Planning desk</p><h1>Event requests</h1></div><span className="live">● Supabase connected</span></header>
      <form className="request-form" onSubmit={viewingRequest ? (event) => event.preventDefault() : editingId ? saveChanges : submitForm}>
        <div className="form-heading"><div><h2>{viewingRequest ? 'View event request' : editingId ? 'Update event request' : 'Create event request'}</h2><p>{viewingRequest ? 'Submitted event details and coordinator comments.' : 'Capture the details ConnectSphere needs to plan your event.'}</p></div><div className="form-actions">{viewingRequest ? <button className="secondary" type="button" onClick={() => { setViewingRequest(false); setEditingId(null); }}>Close details</button> : <>{!editingId && <button className="secondary" type="button" onClick={saveDraft} disabled={isSubmitting}>{loadingAction === 'draft' ? <span className="spinner" aria-label="Saving draft" /> : 'Save draft'}</button>}<button className="primary" type="submit" disabled={isSubmitting}>{loadingAction === 'submit' || loadingAction === 'edit' ? <span className="spinner" aria-label={editingId ? 'Saving changes' : 'Submitting request'} /> : (editingId ? 'Save changes' : 'Submit request')}</button></>}</div></div>
        <fieldset className="request-fields" disabled={viewingRequest}>
          <div className="form-grid"><label>Event name<input name="event_name" value={form.event_name} onChange={change} required /></label><label>Event type<select name="event_type" value={form.event_type} onChange={change} required><option value="">Select event type</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Start date<input name="event_date" type="date" min={today} value={form.event_date} onChange={change} required /></label><label>End date<input name="event_end_date" type="date" min={form.event_date || today} value={form.event_end_date} onChange={change} required /></label><label>Capacity<select name="event_capacity" value={form.event_capacity} onChange={change} required><option value="">Select capacity</option>{capacityOptions.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}</select></label><label>Start time<select name="start_time" value={form.start_time} onChange={change} required><option value="">Select start time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label><label>End time<select name="end_time" value={form.end_time} onChange={change} required><option value="">Select end time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label><div className="wide"><label className="description-field">Description and planning requirements<textarea name="description" value={form.description} onChange={change} required rows="6" placeholder="Include the purpose, venue requirements, accessibility needs, equipment requirements, and registration needs." /></label>{editingId && <section className="clarification-readonly" aria-labelledby="clarification-heading"><h3 id="clarification-heading">Clarification comments</h3>{currentClarifications.length ? <ol>{currentClarifications.map((comment, index) => <li key={`${index}-${comment}`}>{comment}</li>)}</ol> : <p>No clarification comments for this event.</p>}</section>}</div></div>
        </fieldset>
      </form>
      {message && <p className="message">{message}</p>}
      <div className="table-wrap"><table><thead><tr><th>Event</th><th>Type</th><th>Date and time</th><th>Status</th><th>Actions</th></tr></thead><tbody>{isLoadingRequests ? <tr><td className="empty" colSpan="5">Loading events for this organiser...</td></tr> : requests.length ? requests.map((request) => <tr key={request.id}><td><strong>{request.event_name}</strong><br /><small>{request.event_capacity} attendee capacity</small></td><td>{request.event_type}</td><td>{dateRange(request.event_date, request.event_end_date)}<br />{request.start_time} - {request.end_time}</td><td><span className="pill">{request.status}</span></td><td>{String(request.status).toLowerCase() === 'submitted' && <button className="assign" onClick={() => editRequest(request)}>Edit</button>}{String(request.status).toLowerCase() === 'draft' && <><button className="assign" onClick={() => submitRequest(request.id)}>Submit</button><button className="assign" onClick={() => editRequest(request)}>Edit</button></>}{!['submitted', 'draft'].includes(String(request.status).toLowerCase()) && <div className="organiser-view-action"><button className="assign" onClick={() => viewRequest(request)}>View</button>{coordinatorComments(request.coordinator_comments).length > 0 && <span className="clarification-count" title={`${coordinatorComments(request.coordinator_comments).length} coordinator clarification comment${coordinatorComments(request.coordinator_comments).length === 1 ? '' : 's'}`} aria-label={`${coordinatorComments(request.coordinator_comments).length} coordinator clarification comment${coordinatorComments(request.coordinator_comments).length === 1 ? '' : 's'}`}>{coordinatorComments(request.coordinator_comments).length}</span>}</div>}</td></tr>) : <tr><td className="empty" colSpan="5">No submitted event requests found for this organiser.</td></tr>}</tbody></table></div>
      {isSubmitting && <div className="loading-backdrop" role="status" aria-live="polite"><span className="loading-spinner" /> <span>{loadingAction === 'draft' ? 'Saving draft...' : loadingAction === 'row-submit' ? 'Submitting event...' : loadingAction === 'edit' ? 'Saving changes...' : 'Submitting event...'}</span></div>}
      {notice && <><div className="notice-backdrop" /> <div className={`notice ${notice.type}`} role="alertdialog" aria-modal="true" aria-labelledby="notice-title"><div className="notice-icon">{notice.type === 'success' ? '✓' : '!'}</div><div><h2 id="notice-title">{notice.title || (notice.type === 'success' ? 'Submission successful' : 'Submission unsuccessful')}</h2><p>{notice.text}</p><button className="primary" onClick={() => setNotice(null)}>Close</button></div></div></>}
    </section>
  </main>;
}
