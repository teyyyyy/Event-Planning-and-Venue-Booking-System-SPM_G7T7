import React, { useEffect, useState } from 'react';
import { authenticatedFetch as fetch } from './api';

const API = 'http://127.0.0.1:8000/api';
const EVENT_STATUSES = ['Under review', 'Approved', 'Planning', 'Confirmed', 'Completed', 'Cancelled', 'Rejected'];

function EventRows({ events, onAssign, onStatusChange, onSubmit, onEdit, onViewRequest, coordinators, canManage = false }) {
  return events.length ? events.map((event) => <tr key={event.id}>
    <td>{event.event_title}</td><td>{event.event_end_date && event.event_end_date !== event.event_date ? `${event.event_date} to ${event.event_end_date}` : event.event_date}</td>
    <td>{canManage ? <select aria-label={`Status for ${event.event_title}`} value={event.event_status || ''} onChange={(e) => onStatusChange(event.id, e.target.value)}>{EVENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : <span className="pill">{event.event_status}</span>}</td>
    <td>{canManage ? <select aria-label={`Coordinator for ${event.event_title}`} value={event.assigned_coordinator_id || ''} onChange={(e) => onAssign(event.id, e.target.value)}>{coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select> : event.coordinator_name ? <span>{event.coordinator_name}<br /><small>{event.coordinator_email || 'Email unavailable'}</small></span> : <button className="assign" onClick={() => onAssign(event.id)}>Assign coordinator</button>}</td>
    {canManage && <td><button className="assign" onClick={() => onViewRequest(event)}>View event request</button></td>}
    {!canManage && <td>{String(event.event_status).toLowerCase() === 'draft' && <button className="assign" onClick={() => onSubmit(event.id)}>Submit</button>}{['submitted', 'under review', 'approved', 'planning', 'confirmed'].includes(String(event.event_status).toLowerCase()) && <button className="assign" onClick={() => onEdit(event.id)}>Edit</button>}</td>}
  </tr>) : <tr><td className="empty" colSpan={5}>No event requests found.</td></tr>;
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : 'Not provided';
}

function RequestDetailsDialog({ event, onClose, onSubmitClarifications }) {
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const details = [
    ['Event ID', event.id],
    ['Coordinator ID', event.assigned_coordinator_id],
    ['Event name', event.event_name || event.event_title],
    ['Event type', event.event_type],
    ['Start date', event.event_date],
    ['End date', event.event_end_date || event.event_date],
    ['Capacity', event.event_capacity ? `${event.event_capacity} attendees` : null],
    ['Start time', formatTime(event.start_time)],
    ['End time', formatTime(event.end_time)],
    ['Description and planning requirements', event.description],
  ];

  async function submit(eventSubmit) {
    eventSubmit.preventDefault();
    setIsSubmitting(true);
    setSubmitMessage('');
    try {
      await onSubmitClarifications(event.id, comment);
      setSubmitMessage('Clarification request sent to the Event Organiser.');
      setComment('');
    } catch (error) {
      setSubmitMessage(error.message || 'Clarification request could not be sent.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <div className="request-dialog-backdrop" onClick={(click) => { if (click.target === click.currentTarget) onClose(); }}>
    <section className="request-dialog" role="dialog" aria-modal="true" aria-labelledby="request-dialog-title">
      <header className="request-dialog-header">
        <div><p className="kicker">Submitted event request</p><h2 id="request-dialog-title">{event.event_name || event.event_title}</h2></div>
        <button className="request-dialog-close" type="button" onClick={onClose} aria-label="Close request details">×</button>
      </header>
      <dl className="request-dialog-fields">
        {details.map(([label, value]) => <div className="request-dialog-field" key={label}>
          <dt>{label}</dt><dd>{value || 'Not provided'}</dd>
        </div>)}
      </dl>
      <form className="request-clarifications" onSubmit={submit}>
        <h3>Request clarification</h3>
        <label htmlFor="coordinator-clarification">Clarification request</label>
        <textarea id="coordinator-clarification" aria-label="Clarification request" rows="4" maxLength="2000" value={comment} onChange={(change) => setComment(change.target.value)} />
        {submitMessage && <p className="request-clarification-message" role="status">{submitMessage}</p>}
        <button className="primary" type="submit" disabled={isSubmitting || !comment.trim()}>{isSubmitting ? 'Submitting…' : 'Submit clarification request'}</button>
      </form>
    </section>
  </div>;
}

export default function CoordinatorAssignment({ user, onEditEvent }) {
  const [events, setEvents] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const isCoordinator = user.role.trim().toLowerCase().includes('coordinator');
  const [activeTab, setActiveTab] = useState(isCoordinator ? 'management' : 'status');
  const [message, setMessage] = useState('');

  // keepMessage: leave the caller's success/error message on screen after the reload.
  async function loadOrganiser(keepMessage = false) {
    try {
      const statusResponse = await fetch(`${API}/event-organisers/${user.id}/requests`);
      if (!statusResponse.ok) throw new Error(`Backend returned ${statusResponse.status}`);
      setEvents(await statusResponse.json());
      if (!keepMessage) setMessage('');
    } catch (error) {
      setMessage(`Unable to load event status. Start the backend at http://localhost:8000. (${error.message})`);
    }
  }

  useEffect(() => {
    if (isCoordinator) loadManagement();
    else loadOrganiser();
  }, [isCoordinator, user.id]);

  async function loadReassignment(keepMessage = false) {
    try {
      const [eventResponse, coordinatorResponse] = await Promise.all([fetch(`${API}/events`), fetch(`${API}/coordinators`)]);
      if (!eventResponse.ok || !coordinatorResponse.ok) throw new Error('Unable to load event tasks');
      const allEvents = await eventResponse.json();
      setEvents(allEvents.filter((event) => event.assigned_coordinator_id === user.id));
      setCoordinators(await coordinatorResponse.json()); if (!keepMessage) setMessage('');
    } catch (error) { setMessage(`Unable to load event tasks. (${error.message})`); }
  }

  async function assign(eventId) {
    setMessage('Assigning…');
    const response = await fetch(`${API}/events/${eventId}/assign-coordinator`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Assignment failed.');
    setMessage(`${result.event_title} assigned to ${result.coordinator_name}.`);
    await loadOrganiser(true);
  }

  async function reassign(eventId, coordinatorId) {
    if (!coordinatorId) return;
    const response = await fetch(`${API}/events/${eventId}/coordinator`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinator_id: coordinatorId }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Reassignment failed.');
    setMessage(`${result.event_title} reassigned to ${result.coordinator_name}.`); await loadReassignment(true);
  }

  async function updateStatus(eventId, eventStatus) {
    const response = await fetch(`${API}/events/${eventId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_status: eventStatus }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Status update failed.');
    setEvents((currentEvents) => currentEvents.map((event) => event.id === result.id ? result : event));
    setMessage(`${result.event_title} status updated to ${result.event_status}.`);
  }

  async function submitEvent(eventId) {
    const response = await fetch(`${API}/event-organisers/${user.id}/requests/${eventId}/submit`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Could not submit request.');
    setMessage('Request submitted for review.');
    await loadOrganiser(true);
  }

  function editEvent(eventId) {
    const event = events.find((item) => item.id === eventId);
    onEditEvent?.(event);
  }

  async function loadManagement() {
    await loadReassignment();
  }

  async function submitClarifications(eventId, comment) {
    const response = await fetch(`${API}/events/${eventId}/clarifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Clarification request could not be sent.');
    const updateClarifications = (event) => String(event.id) === String(eventId)
      ? { ...event, coordinator_comments: result.coordinator_comments }
      : event;
    setEvents((currentEvents) => currentEvents.map(updateClarifications));
    setSelectedRequest((current) => current ? updateClarifications(current) : current);
  }

  return <main className="shell">
    <aside><div className="logo">G</div><div className="side-label">{isCoordinator ? 'EVENT MANAGEMENT' : 'EVENT STATUS'}</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Assignment desk</p><h1>{isCoordinator ? 'Event management' : 'Event status'}</h1></div><span className="live">● Supabase connected</span></header>
      <nav aria-label="Event coordinator views">
        {!isCoordinator && <button className={activeTab === 'status' ? 'active' : ''} onClick={() => { setActiveTab('status'); loadOrganiser(); }}>Event status</button>}
        {isCoordinator && <button className={activeTab === 'management' ? 'active' : ''} onClick={() => { setActiveTab('management'); loadManagement(); }}>Event management</button>}
      </nav>
      {message && <p className="message">{message}</p>}
      <h2>Event status</h2>
      <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Date</th><th>Event Status</th><th>Event Coordinator</th>{isCoordinator ? <th>View event request</th> : <th>Action</th>}</tr></thead><tbody><EventRows events={events} onAssign={activeTab === 'management' ? reassign : assign} onStatusChange={updateStatus} onSubmit={submitEvent} onEdit={editEvent} onViewRequest={setSelectedRequest} coordinators={coordinators} canManage={activeTab === 'management'} /></tbody></table></div>
      {selectedRequest && <RequestDetailsDialog event={selectedRequest} onClose={() => setSelectedRequest(null)} onSubmitClarifications={submitClarifications} />}
    </section>
  </main>;
}
