import React, { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:8000/api';
const EVENT_STATUSES = ['Under review', 'Approved', 'Planning', 'Confirmed', 'Completed', 'Cancelled', 'Rejected'];

function EventRows({ events, onAssign, onStatusChange, onSubmit, onEdit, coordinators, canManage = false }) {
  return events.length ? events.map((event) => <tr key={event.id}>
    <td>{event.event_title}</td><td>{event.event_date}</td>
    <td>{canManage ? <select aria-label={`Status for ${event.event_title}`} value={event.event_status || ''} onChange={(e) => onStatusChange(event.id, e.target.value)}>{EVENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : <span className="pill">{event.event_status}</span>}</td>
    <td>{canManage ? <select aria-label={`Coordinator for ${event.event_title}`} value={event.assigned_coordinator_id || ''} onChange={(e) => onAssign(event.id, e.target.value)}>{coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select> : event.coordinator_name ? <span>{event.coordinator_name}<br /><small>{event.coordinator_email || 'Email unavailable'}</small></span> : <button className="assign" onClick={() => onAssign(event.id)}>Assign coordinator</button>}</td>
    {!canManage && <td>{String(event.event_status).toLowerCase() === 'draft' && <button className="assign" onClick={() => onSubmit(event.id)}>Submit</button>}{['submitted', 'under review', 'approved', 'planning', 'confirmed'].includes(String(event.event_status).toLowerCase()) && <button className="assign" onClick={() => onEdit(event.id)}>Edit</button>}</td>}
  </tr>) : <tr><td className="empty" colSpan={canManage ? 4 : 5}>No event requests found.</td></tr>;
}

export default function CoordinatorAssignment({ user, onEditEvent }) {
  const [events, setEvents] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const isCoordinator = user.role.trim().toLowerCase().includes('coordinator');
  const [activeTab, setActiveTab] = useState(isCoordinator ? 'management' : 'status');
  const [message, setMessage] = useState('');

  async function loadOrganiser() {
    try {
      const statusResponse = await fetch(`${API}/event-organisers/${user.id}/requests`);
      if (!statusResponse.ok) throw new Error(`Backend returned ${statusResponse.status}`);
      setEvents(await statusResponse.json());
      setMessage('');
    } catch (error) {
      setMessage(`Unable to load event status. Start the backend at http://localhost:8000. (${error.message})`);
    }
  }

  useEffect(() => {
    if (isCoordinator) loadManagement();
    else loadOrganiser();
  }, [isCoordinator, user.id]);

  async function loadReassignment() {
    try {
      const [eventResponse, coordinatorResponse] = await Promise.all([fetch(`${API}/events`), fetch(`${API}/coordinators`)]);
      if (!eventResponse.ok || !coordinatorResponse.ok) throw new Error('Unable to load event tasks');
      const allEvents = await eventResponse.json();
      setEvents(allEvents.filter((event) => event.assigned_coordinator_id === user.id));
      setCoordinators(await coordinatorResponse.json()); setMessage('');
    } catch (error) { setMessage(`Unable to load event tasks. (${error.message})`); }
  }

  async function assign(eventId) {
    setMessage('Assigning…');
    const response = await fetch(`${API}/events/${eventId}/assign-coordinator`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Assignment failed.');
    setMessage(`${result.event_title} assigned to ${result.coordinator_name}.`);
    await loadOrganiser();
  }

  async function reassign(eventId, coordinatorId) {
    if (!coordinatorId) return;
    const response = await fetch(`${API}/events/${eventId}/coordinator`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinator_id: coordinatorId }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Reassignment failed.');
    setMessage(`${result.event_title} reassigned to ${result.coordinator_name}.`); await loadReassignment();
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
    await loadOrganiser();
  }

  function editEvent(eventId) {
    const event = events.find((item) => item.id === eventId);
    onEditEvent?.(event);
  }

  async function loadManagement() {
    await loadReassignment();
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
      <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Date</th><th>Event Status</th><th>Event Coordinator</th>{!isCoordinator && <th>Action</th>}</tr></thead><tbody><EventRows events={events} onAssign={reassign} onStatusChange={updateStatus} onSubmit={submitEvent} onEdit={editEvent} coordinators={coordinators} canManage={activeTab === 'management'} /></tbody></table></div>
    </section>
  </main>;
}
