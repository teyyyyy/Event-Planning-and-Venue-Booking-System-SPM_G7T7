import React, { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:8000/api';
const DEFAULT_ORGANISER = '00000000-0000-0000-0000-000000000001';
const EVENT_STATUSES = ['Under review', 'Approved', 'Planning', 'Confirmed', 'Completed', 'Cancelled', 'Rejected'];

function EventRows({ events, onAssign, onStatusChange, coordinators, canManage = false }) {
  return events.length ? events.map((event) => <tr key={event.id}>
    <td>{event.event_title}</td><td>{event.event_date}</td>
    <td>{canManage ? <select aria-label={`Status for ${event.event_title}`} value={event.event_status || ''} onChange={(e) => onStatusChange(event.id, e.target.value)}>{EVENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : <span className="pill">{event.event_status}</span>}</td>
    <td>{canManage ? <select aria-label={`Coordinator for ${event.event_title}`} value={event.assigned_coordinator_id || ''} onChange={(e) => onAssign(event.id, e.target.value)}>{coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select> : event.coordinator_name ? <span>{event.coordinator_name}<br /><small>{event.coordinator_email || 'Email unavailable'}</small></span> : <button className="assign" onClick={() => onAssign(event.id)}>Assign coordinator</button>}</td>
  </tr>) : <tr><td className="empty" colSpan={4}>No event requests found.</td></tr>;
}

export default function CoordinatorAssignment() {
  const [events, setEvents] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [activeTab, setActiveTab] = useState('status');
  const [coordinatorFilter, setCoordinatorFilter] = useState('all');
  const [message, setMessage] = useState('');

  async function loadOrganiser() {
    try {
      const response = await fetch(`${API}/event-organisers/${DEFAULT_ORGANISER}/requests`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      setEvents(await response.json());
      setMessage('');
    } catch (error) {
      setMessage(`Unable to load event status. Start the backend at http://localhost:8000. (${error.message})`);
    }
  }

  useEffect(() => { loadOrganiser(); }, []);

  async function loadReassignment() {
    try {
      const [eventResponse, coordinatorResponse] = await Promise.all([fetch(`${API}/events`), fetch(`${API}/coordinators`)]);
      if (!eventResponse.ok || !coordinatorResponse.ok) throw new Error('Unable to load event tasks');
      setEvents(await eventResponse.json()); setCoordinators(await coordinatorResponse.json()); setMessage('');
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

  async function loadManagement() {
    await loadReassignment();
  }

  const visibleEvents = activeTab === 'management' && coordinatorFilter !== 'all' ? events.filter((event) => event.assigned_coordinator_id === coordinatorFilter) : events;

  return <main className="shell">
    <aside><div className="logo">G</div><div className="side-label">EVENT STATUS</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Assignment desk</p><h1>Event status</h1></div><span className="live">● Supabase connected</span></header>
      <nav aria-label="Event coordinator views"><button className={activeTab === 'status' ? 'active' : ''} onClick={() => { setActiveTab('status'); loadOrganiser(); }}>Event status</button><button className={activeTab === 'management' ? 'active' : ''} onClick={() => { setActiveTab('management'); loadManagement(); }}>Event management</button></nav>
      {activeTab === 'status' && <div className="default-user"><span>Account:</span><strong>Organiser 1</strong></div>}
      {activeTab === 'management' && <div className="selector"><label htmlFor="coordinator-filter">Filter by coordinator</label><select id="coordinator-filter" value={coordinatorFilter} onChange={(e) => setCoordinatorFilter(e.target.value)}><option value="all">All coordinators</option>{coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select></div>}
      {message && <p className="message">{message}</p>}
      <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Date</th><th>Event Status</th><th>Event Coordinator</th></tr></thead><tbody><EventRows events={visibleEvents} onAssign={reassign} onStatusChange={updateStatus} coordinators={coordinators} canManage={activeTab === 'management'} /></tbody></table></div>
    </section>
  </main>;
}
