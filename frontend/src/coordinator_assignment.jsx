import React, { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:8000/api';
const DEFAULT_ORGANISER = '00000000-0000-0000-0000-000000000001';

function EventRows({ events, onAssign }) {
  return events.length ? events.map((event) => <tr key={event.id}>
    <td>{event.event_title}</td><td>{event.event_date}</td>
    <td><span className="pill">{event.event_status}</span></td>
    <td>{event.coordinator_name || <button className="assign" onClick={() => onAssign(event.id)}>Assign coordinator</button>}</td>
  </tr>) : <tr><td className="empty" colSpan={4}>No event requests found.</td></tr>;
}

export default function CoordinatorAssignment() {
  const [events, setEvents] = useState([]);
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

  async function assign(eventId) {
    setMessage('Assigning…');
    const response = await fetch(`${API}/events/${eventId}/assign-coordinator`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return setMessage(result.detail || 'Assignment failed.');
    setMessage(`${result.event_title} assigned to ${result.coordinator_name}.`);
    await loadOrganiser();
  }

  return <main className="shell">
    <aside><div className="logo">G</div><div className="side-label">EVENT STATUS</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Assignment desk</p><h1>Event status</h1></div><span className="live">● Supabase connected</span></header>
      <div className="default-user"><span>Account:</span><strong>Organiser 1</strong></div>
      {message && <p className="message">{message}</p>}
      <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Date</th><th>Event Status</th><th>Event Coordinator</th></tr></thead><tbody><EventRows events={events} onAssign={assign} /></tbody></table></div>
    </section>
  </main>;
}
