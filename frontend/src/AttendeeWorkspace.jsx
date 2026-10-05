import React, { useEffect, useState } from 'react';
import { request } from './api';
import SecurityButton from './SecuritySettings';

export function EventDetails({ event }) {
  if (!event) return null;
  return <div className="sprint-event-details">
    <h3>{event.event_name}</h3>
    <p><strong>Status:</strong> <span className={event.status === 'Cancelled' ? 'sprint-cancelled' : ''}>{event.status}</span></p>
    <p>{event.description || 'No description provided.'}</p>
    <p><strong>Date:</strong> {event.event_date}{event.event_end_date && event.event_end_date !== event.event_date ? ` to ${event.event_end_date}` : ''}</p>
    <p><strong>Time:</strong> {event.start_time?.slice(0, 5)}–{event.end_time?.slice(0, 5)} (Singapore time)</p>
    <p><strong>Venue:</strong> {event.venues?.length ? event.venues.map(v => `${v.name}${v.location ? ` (${v.location})` : ''}`).join(', ') : 'Venue to be announced'}</p>
  </div>;
}

export default function AttendeeWorkspace({ user, logout }) {
  const [section, setSection] = useState('events');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setEvents([]);
    request(`/attendee/${section}`).then(rows => { if (active) setEvents(rows); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [section, revision]);
  async function register(id) {
    setBusy(id); setError(''); setMessage('');
    try {
      const result = await request(`/attendee/events/${id}/register`, { method: 'POST' });
      setMessage(result.message);
      setEvents(rows => rows.map(e => e.id === id ? { ...e, registered: true } : e));
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  return <div className="coordinator-workspace">
    <aside className="coordinator-sidebar">
      <div><div className="logo">G</div><div className="side-label">ATTENDEE</div>
        <nav className="coordinator-side-nav" aria-label="Attendee navigation">
          {[['events', 'Browse events'], ['registrations', 'My registered events']].map(([key, title]) =>
            <button key={key} className={`coordinator-nav-button ${section === key ? 'active' : ''}`} disabled={busy !== null}
              onClick={() => { setSection(key); setMessage(''); }}>{title}</button>)}
        </nav>
      </div>
      <div className="coordinator-side-footer"><SecurityButton /><button className="coordinator-logout" onClick={logout} title={user.email}>Log out</button></div>
    </aside>
    <main className="coordinator-main sprint-page">
      <h1>{section === 'events' ? 'Browse events' : 'My registered events'}</h1>
      <p>{section === 'events' ? 'Find a confirmed event and secure your place.' : 'Your registrations and the latest event details.'}</p>
      <button disabled={loading || busy !== null} onClick={() => setRevision(r => r + 1)}>Refresh events</button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">Loading events…</p> : !error && events.length === 0 ? <p>{section === 'events' ? 'No upcoming confirmed events are available.' : 'You have no registered events.'}</p> : null}
      <div className="sprint-event-grid">{events.map(event => <article className="sprint-card" key={event.id}>
        <EventDetails event={event} />
        {event.registered_at && <p>Registered: {new Date(event.registered_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} (SGT)</p>}
        {section === 'events' && <button className="primary" disabled={event.registered || busy !== null} onClick={() => register(event.id)}>
          {event.registered ? 'Registered' : busy === event.id ? 'Registering…' : 'Register'}
        </button>}
      </article>)}</div>
    </main>
  </div>;
}
