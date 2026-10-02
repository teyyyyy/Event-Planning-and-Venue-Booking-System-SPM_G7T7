import React, { useEffect, useRef, useState } from 'react';
import { authenticatedFetch as fetch } from './api';
import { capacityOptions, eventTypes, timeOptions } from './event_organiser';

const API = 'http://127.0.0.1:8000/api';
const EVENT_STATUSES = ['Under review', 'Approved', 'Planning', 'Confirmed', 'Completed', 'Cancelled', 'Rejected'];
const EMPTY_PROPOSAL = { event_name: '', event_type: '', event_date: '', event_end_date: '', event_capacity: '', description: '', start_time: '', end_time: '' };

function EventRows({ events, onAssign, onStatusChange, onSubmit, onRequestChanges, coordinators, canManage = false }) {
  return events.length ? events.map((event) => <tr key={event.id}>
    <td>{event.event_title}</td><td>{event.event_end_date && event.event_end_date !== event.event_date ? `${event.event_date} to ${event.event_end_date}` : event.event_date}</td>
    <td>{canManage ? <select aria-label={`Status for ${event.event_title}`} value={event.event_status || ''} onChange={(e) => onStatusChange(event.id, e.target.value)}>{EVENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : <span className="pill">{event.event_status}</span>}</td>
    <td>{canManage ? <select aria-label={`Coordinator for ${event.event_title}`} value={event.assigned_coordinator_id || ''} onChange={(e) => onAssign(event.id, e.target.value)}>{coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select> : event.coordinator_name ? <span>{event.coordinator_name}<br /><small>{event.coordinator_email || 'Email unavailable'}</small></span> : <button className="assign" onClick={() => onAssign(event.id)}>Assign coordinator</button>}</td>
    {!canManage && <td>{String(event.event_status).trim().toLowerCase() === 'draft' && <button className="assign" onClick={() => onSubmit(event.id)}>Submit</button>}{!['draft', 'completed', 'cancelled', 'rejected'].includes(String(event.event_status).trim().toLowerCase()) && <button className="assign" onClick={() => onRequestChanges(event)}>Request changes</button>}</td>}
  </tr>) : <tr><td className="empty" colSpan={canManage ? 4 : 5}>No event requests found.</td></tr>;
}

export default function CoordinatorAssignment({ user }) {
  const [events, setEvents] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const isCoordinator = user.role.trim().toLowerCase().includes('coordinator');
  const isOrganiser = user.role.trim().toLowerCase() === 'event organiser';
  const [activeTab, setActiveTab] = useState(isCoordinator ? 'management' : 'status');
  const [message, setMessage] = useState('');
  const [changeRequestEvent, setChangeRequestEvent] = useState(null);
  const [changeProposal, setChangeProposal] = useState(EMPTY_PROPOSAL);
  const [changeRequestText, setChangeRequestText] = useState('');
  const [changeRequestMessage, setChangeRequestMessage] = useState('');
  const [isSubmittingChangeRequest, setIsSubmittingChangeRequest] = useState(false);
  const changeRequestFormRef = useRef(null);
  const changeCapacityOptions = capacityOptions.some(({ value }) => String(value) === String(changeProposal.event_capacity))
    ? capacityOptions
    : [{ label: `Current capacity (${changeProposal.event_capacity})`, value: changeProposal.event_capacity }, ...capacityOptions];

  // keepMessage: leave the caller's success/error message on screen after the reload.
  async function loadOrganiser(keepMessage = false) {
    try {
      const statusResponse = await fetch(`${API}/event-organisers/${user.id}/requests`);
      if (!statusResponse.ok) throw new Error(`Backend returned ${statusResponse.status}`);
      const requests = await statusResponse.json();
      setEvents(isOrganiser
        ? requests.filter((event) => String(event.event_status).trim().toLowerCase() !== 'draft')
        : requests);
      if (!keepMessage) setMessage('');
    } catch (error) {
      setMessage(`Unable to load event status. Start the backend at http://localhost:8000. (${error.message})`);
    }
  }

  useEffect(() => {
    if (isCoordinator) loadManagement();
    else loadOrganiser();
  }, [isCoordinator, user.id]);

  useEffect(() => {
    changeRequestFormRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [changeRequestEvent]);

  async function loadReassignment(keepMessage = false) {
    try {
      const [eventResponse, coordinatorResponse] = await Promise.all([fetch(`${API}/events`), fetch(`${API}/coordinators`)]);
      if (!eventResponse.ok || !coordinatorResponse.ok) throw new Error('Unable to load event tasks');
      const allEvents = await eventResponse.json();
      setEvents(allEvents.filter((event) => event.assigned_coordinator_id === user.id));
      setCoordinators(await coordinatorResponse.json());
      if (!keepMessage) setMessage('');
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

  function startChangeRequest(event) {
    setChangeRequestEvent(event);
    setChangeRequestMessage('');
    setChangeProposal({
      event_name: event.event_name ?? event.event_title ?? '',
      event_type: event.event_type ?? '',
      event_date: event.event_date ?? '',
      event_end_date: event.event_end_date ?? event.event_date ?? '',
      event_capacity: event.event_capacity ?? '',
      description: event.description ?? '',
      start_time: String(event.start_time ?? '').slice(0, 5),
      end_time: String(event.end_time ?? '').slice(0, 5),
    });
    setChangeRequestText('');
  }

  async function submitChangeRequest(submitEvent) {
    submitEvent.preventDefault();
    if (!changeRequestEvent || isSubmittingChangeRequest) return;
    setIsSubmittingChangeRequest(true);
    setChangeRequestMessage('');
    try {
      const response = await fetch(`${API}/event-organisers/${user.id}/requests/${changeRequestEvent.id}/change-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changeProposal, event_capacity: Number(changeProposal.event_capacity), request_text: changeRequestText }),
      });
      const result = await response.json();
      if (!response.ok) {
        setChangeRequestMessage(result.detail || 'Could not send the change request.');
        return;
      }
      setChangeRequestEvent(null);
      setChangeProposal(EMPTY_PROPOSAL);
      setChangeRequestText('');
      setMessage('Change request sent to the assigned event coordinator.');
    } catch (error) {
      setChangeRequestMessage(`Unable to send change request. (${error.message})`);
    } finally {
      setIsSubmittingChangeRequest(false);
    }
  }

  function cancelChangeRequest() {
    setChangeRequestEvent(null);
    setChangeProposal(EMPTY_PROPOSAL);
    setChangeRequestText('');
    setChangeRequestMessage('');
  }

  function updateProposal(event) {
    setChangeProposal((current) => ({ ...current, [event.target.name]: event.target.value }));
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
      <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Date</th><th>Event Status</th><th>Event Coordinator</th>{!isCoordinator && <th>Action</th>}</tr></thead><tbody><EventRows events={events} onAssign={activeTab === 'management' ? reassign : assign} onStatusChange={updateStatus} onSubmit={submitEvent} onRequestChanges={startChangeRequest} coordinators={coordinators} canManage={activeTab === 'management'} /></tbody></table></div>
      {isOrganiser && changeRequestEvent && <form ref={changeRequestFormRef} className="request-form" onSubmit={submitChangeRequest}>
        <div className="form-heading"><div><h2>Request changes: {changeRequestEvent.event_title}</h2><p>Proposed edits are sent to the assigned coordinator. Your event stays unchanged unless they approve.</p></div></div>
        {changeRequestMessage && <p className="message" role="alert">{changeRequestMessage}</p>}
        <div className="form-grid">
          <label>Event name<input name="event_name" value={changeProposal.event_name} onChange={updateProposal} required /></label>
          <label>Event type<select name="event_type" value={changeProposal.event_type} onChange={updateProposal} required><option value="">Select event type</option>{!eventTypes.includes(changeProposal.event_type) && changeProposal.event_type && <option value={changeProposal.event_type}>{changeProposal.event_type}</option>}{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label>Start date<input name="event_date" type="date" value={changeProposal.event_date} onChange={updateProposal} required /></label>
          <label>End date<input name="event_end_date" type="date" min={changeProposal.event_date} value={changeProposal.event_end_date} onChange={updateProposal} required /></label>
          <label>Capacity<select name="event_capacity" value={changeProposal.event_capacity} onChange={updateProposal} required><option value="">Select capacity</option>{changeCapacityOptions.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Start time<select name="start_time" value={changeProposal.start_time} onChange={updateProposal} required><option value="">Select start time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
          <label>End time<select name="end_time" value={changeProposal.end_time} onChange={updateProposal} required><option value="">Select end time</option>{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
          <label className="wide">Description and planning requirements<textarea name="description" value={changeProposal.description} onChange={updateProposal} required rows="5" /></label>
          <label className="wide">Summary for the event coordinator<textarea aria-label="Change summary for the event coordinator" value={changeRequestText} onChange={(event) => setChangeRequestText(event.target.value)} maxLength={5000} required rows="3" /></label>
        </div>
        <div className="form-actions"><button className="primary" type="submit" disabled={!changeRequestText.trim() || isSubmittingChangeRequest}>{isSubmittingChangeRequest ? 'Sending request...' : 'Send for coordinator approval'}</button><button className="secondary" type="button" onClick={cancelChangeRequest} disabled={isSubmittingChangeRequest}>Cancel</button></div>
      </form>}
    </section>
  </main>;
}
