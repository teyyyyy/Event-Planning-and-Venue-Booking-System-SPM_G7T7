import React, { useEffect, useState } from 'react';
import { request } from './api';
import { EventDetails } from './AttendeeWorkspace';
import './sprint2.css';

function linkedId() {
  const match = window.location.hash.match(/^#notification\/(\d+)$/);
  return match ? match[1] : null;
}

export default function Notifications() {
  const [open, setOpen] = useState(Boolean(linkedId()));
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState(linkedId());
  const [record, setRecord] = useState(null);
  const [recordError, setRecordError] = useState('');
  const [busy, setBusy] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => { setTarget(linkedId()); if (linkedId()) setOpen(true); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try { const data = await request('/notifications'); if (active) { setRows(data); setError(''); } }
      catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setRecord(null); setRecordError('');
    if (target) request(`/notifications/${target}/record`)
      .then(data => { if (active) setRecord(data); })
      .catch(e => { if (active) setRecordError(e.message); });
    return () => { active = false; };
  }, [target, revision]);
  async function markRead(id) {
    setBusy(id);
    try {
      await request(`/notifications/${id}/read`, { method: 'PATCH' });
      setRows(items => items.map(n => n.id === id ? { ...n, is_read: true } : n));
      setError('');
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  function close() { setOpen(false); setTarget(null); if (linkedId()) window.history.replaceState(null, '', window.location.pathname + window.location.search); }
  const unread = rows.filter(n => !n.is_read).length;
  return <>
    <button className="sprint-notification-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="notifications-panel">Notifications{unread ? ` (${unread})` : ''}</button>
    {open && <section id="notifications-panel" className="sprint-notifications" aria-label="Notifications">
      <header><h2>Notifications</h2><button onClick={close}>Close notifications</button></header>
      <button disabled={loading} onClick={() => setRevision(r => r + 1)}>Refresh notifications</button>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading notifications…</p>}
      {!loading && !error && rows.length === 0 && <p>No notifications yet.</p>}
      {target && <section className="sprint-card" aria-label="Linked record">
        <button onClick={() => { window.location.hash = ''; setTarget(null); }}>Back to notifications</button>
        {recordError ? <p role="alert">{recordError}</p> : !record ? <p role="status">Loading record…</p> : <>
          <EventDetails event={record.event} />
          {record.record && <><h3>{record.type === 'venue_booking' ? 'Venue booking' : 'Equipment request'} #{record.record.request_id}</h3>
            <p>Status: {record.record.status}</p>
            {record.venue && <p>Requested venue: {record.venue.name} — {record.venue.location}</p>}
            {record.record.rejection_reason && <p>Reason: {record.record.rejection_reason}</p>}
            {record.record.alternative_venue && <p>Alternative venue: {record.record.alternative_venue}</p>}
            {record.items?.map(item => <p key={item.equipment_id}>{item.equipment_id} × {item.requested_quantity} {item.technical_requirements}</p>)}
          </>}
        </>}
      </section>}
      <ul>{rows.map(n => <li key={n.id} className={n.is_read ? '' : 'sprint-unread'}>
        <p>{n.description}</p>
        <p><small>{new Date(n.created_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} (SGT) · {n.is_read ? 'Read' : 'Unread'}</small></p>
        <a href={`#notification/${n.id}`} onClick={() => { setTarget(String(n.id)); setRevision(r => r + 1); }}>View record</a>
        {!n.is_read && <button disabled={busy !== null} onClick={() => markRead(n.id)}>{busy === n.id ? 'Saving…' : 'Mark as read'}</button>}
      </li>)}</ul>
    </section>}
  </>;
}
