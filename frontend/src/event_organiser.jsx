import React, { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:8000/api';
const ORGANISER_ID = '00000000-0000-0000-0000-000000000001';
const emptyRequest = { event_name: '', event_type: '', event_date: '', event_capacity: '', description: '', start_time: '', end_time: '' };
const eventTypes = ['Conference', 'Workshop', 'Seminar', 'Training', 'Meeting', 'Networking', 'Exhibition', 'Social event', 'Other'];
const capacityOptions = [{ label: '1-25 attendees', value: 25 }, { label: '26-50 attendees', value: 50 }, { label: '51-100 attendees', value: 100 }, { label: '101-250 attendees', value: 250 }, { label: '251-500 attendees', value: 500 }, { label: '501-1000 attendees', value: 1000 }, { label: 'More than 1000 attendees', value: 1001 }];
const timeOptions = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const editableStatuses = ['Submitted'];
const today = new Date().toISOString().split('T')[0];

export default function EventOrganiser() {
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(emptyRequest);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState(null);

  async function loadRequests() {
    const response = await fetch(`${API}/event-organisers/${ORGANISER_ID}/submitted-requests`);
    if (!response.ok) throw new Error('Unable to load event requests.');
    setRequests(await response.json());
  }

  useEffect(() => { loadRequests().catch((error) => setMessage(error.message)); }, []);

  function change(event) { setForm({ ...form, [event.target.name]: event.target.value }); }

  function editRequest(request) {
    setEditingId(request.id);
    setForm(Object.fromEntries(Object.keys(emptyRequest).map((key) => [key, request[key] ?? ''])));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveChanges(event) {
    event.preventDefault();
    if (form.end_time <= form.start_time) return setNotice({ type: 'error', text: 'End time must be later than the start time.' });
    try {
      const response = await fetch(`${API}/event-organisers/${ORGANISER_ID}/requests/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, event_capacity: Number(form.event_capacity) }) });
      const result = await response.json();
      if (!response.ok) return setNotice({ type: 'error', text: result.detail || 'Could not update request.' });
      setForm(emptyRequest); setEditingId(null); setNotice({ type: 'success', text: 'Event request updated successfully.' }); await loadRequests();
    } catch (error) { setNotice({ type: 'error', text: `Cannot reach the backend at ${API}. Start FastAPI and try again.` }); }
  }

  async function submitForm(event) {
    event.preventDefault();
    if (form.end_time <= form.start_time) return setNotice({ type: 'error', text: 'End time must be later than the start time.' });
    try {
      const response = await fetch(`${API}/event-organisers/${ORGANISER_ID}/requests/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, event_capacity: Number(form.event_capacity) }) });
      const result = await response.json();
      if (!response.ok) return setNotice({ type: 'error', text: result.detail || 'Event request was not submitted.' });
      setForm(emptyRequest); setEditingId(null); await loadRequests();
      setNotice({ type: 'success', text: 'Event request submitted successfully and added to the table.' });
    } catch (error) { setNotice({ type: 'error', text: `Cannot reach the backend at ${API}. Start FastAPI and try again.` }); }
  }

  async function submitRequest(id) {
    const response = await fetch(`${API}/event-organisers/${ORGANISER_ID}/requests/${id}/submit`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Could not submit request.');
    setMessage('Request submitted for review.'); await loadRequests();
  }

  return <main className="shell organiser-shell">
    <aside><div className="logo">G</div><div className="side-label">EVENT ORGANISER</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Planning desk</p><h1>Event requests</h1></div><span className="live">● Supabase connected</span></header>
      <form className="request-form" onSubmit={editingId ? saveChanges : submitForm}>
        <div className="form-heading"><div><h2>{editingId ? 'Update event request' : 'Create event request'}</h2><p>Capture the details ConnectSphere needs to plan your event.</p></div><div className="form-actions">{!editingId && <button className="secondary" type="button" disabled>Save draft</button>}<button className="primary" type="submit">{editingId ? 'Save changes' : 'Submit request'}</button></div></div>
        <div className="form-grid"><label>Event name<input name="event_name" value={form.event_name} onChange={change} required /></label><label>Event type<select name="event_type" value={form.event_type} onChange={change} required><option value="">Select event type</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Proposed date<input name="event_date" type="date" min={today} value={form.event_date} onChange={change} required /></label><label>Capacity<select name="event_capacity" value={form.event_capacity} onChange={change} required><option value="">Select capacity</option>{capacityOptions.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}</select></label><label>Start time<select name="start_time" value={form.start_time} onChange={change} required><option value="">Select start time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label><label>End time<select name="end_time" value={form.end_time} onChange={change} required><option value="">Select end time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label><label className="wide">Description and planning requirements<textarea name="description" value={form.description} onChange={change} required rows="6" placeholder="Include the purpose, venue requirements, accessibility needs, equipment requirements, and registration needs." /></label></div>
      </form>
      {message && <p className="message">{message}</p>}
      <div className="table-wrap"><table><thead><tr><th>Event</th><th>Type</th><th>Date and time</th><th>Status</th><th>Actions</th></tr></thead><tbody>{requests.length ? requests.map((request) => <tr key={request.id}><td><strong>{request.event_name}</strong><br /><small>{request.event_capacity} attendee capacity</small></td><td>{request.event_type}</td><td>{request.event_date}<br />{request.start_time} - {request.end_time}</td><td><span className="pill">{request.status}</span></td><td>{String(request.status).toLowerCase() === 'submitted' && <button className="assign" onClick={() => editRequest(request)}>Edit</button>}{request.status === 'Draft' && <button className="assign" onClick={() => submitRequest(request.id)}>Submit</button>}</td></tr>) : <tr><td className="empty" colSpan="5">No submitted event requests found for this organiser.</td></tr>}</tbody></table></div>
      {notice && <><div className="notice-backdrop" /> <div className={`notice ${notice.type}`} role="alertdialog" aria-modal="true" aria-labelledby="notice-title"><div className="notice-icon">{notice.type === 'success' ? '✓' : '!'}</div><div><h2 id="notice-title">{notice.type === 'success' ? 'Submission successful' : 'Submission unsuccessful'}</h2><p>{notice.text}</p><button className="primary" onClick={() => setNotice(null)}>Close</button></div></div></>}
    </section>
  </main>;
}
