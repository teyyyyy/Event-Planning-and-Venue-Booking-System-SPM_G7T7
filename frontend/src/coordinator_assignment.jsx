import React, { useEffect, useRef, useState } from 'react';
import { authenticatedFetch as fetch } from './api';
import { capacityOptions, eventTypes, timeOptions } from './event_organiser';
import EventChangeHistory from './EventChangeHistory';
import { arrangementLabel, classifyChange, fieldLabels } from './eventChanges';

const API = 'http://127.0.0.1:8000/api';
const EVENT_STATUSES = ['Under review', 'Approved', 'Planning', 'Confirmed', 'Completed', 'Cancelled', 'Rejected'];
const EMPTY_PROPOSAL = { event_name: '', event_type: '', event_date: '', event_end_date: '', event_capacity: '', description: '', start_time: '', end_time: '' };

const formatTime = (value) => String(value ?? '').slice(0, 5);
const PROCESSING_LABELS = { 'Awaiting processing': 'awaiting coordinator processing', Processed: 'processed', 'Not required': 'no processing needed' };

function requestList({ venue_requests: venue = [], equipment_requests: equipment = [] }) {
  return [...venue.map(({ request_id: id }) => `venue booking #${id}`), ...equipment.map(({ request_id: id }) => `equipment request #${id}`)].join(', ');
}

// Story 10.2: tells the organiser, while editing, whether the proposal is a significant change.
function ChangeSignificance({ event, proposal }) {
  const { significant, significantFields, affectsVenue, affectsEquipment } = classifyChange(event, proposal);
  return significant
    ? <p className="change-impact significant" aria-live="polite"><strong>Significant change</strong> ({fieldLabels(significantFields)}). If approved, any {arrangementLabel(affectsVenue, affectsEquipment)} for this event will return to Pending for re-review.</p>
    : <p className="change-impact ordinary" aria-live="polite">Ordinary edit: venue and equipment arrangements are not affected.</p>;
}

// Stories 10.2 and 44.4: what the change does to confirmed arrangements, and processing once approved.
function ChangeImpact({ request, onProcess, isProcessing, error }) {
  const { impact, processing_status: status } = request;
  if (status === 'Processed') {
    return <div className="change-impact processed"><strong>Change processed{request.processed_at ? ` on ${String(request.processed_at).slice(0, 10)}` : ''}.</strong> {request.processing_summary}</div>;
  }
  if (!impact) return null;
  if (impact.change_type !== 'Significant') {
    return <div className="change-impact ordinary">Ordinary edit: venue and equipment arrangements are not affected{status === 'Not required' ? ', so no processing is needed' : ''}.</div>;
  }
  const affected = requestList(impact);
  if (status === 'Awaiting processing') {
    return <div className="change-impact significant">
      <p><strong>Significant change approved</strong> ({fieldLabels(impact.significant_fields)}). {affected
        ? `Processing replaces ${affected} with new Pending requests linked to this change request and notifies venue staff and technical support.`
        : 'None of the affected venue or equipment requests are live, so processing only records the change as handled.'}</p>
      {error && <p className="message" role="alert">{error}</p>}
      <button className="primary" type="button" onClick={() => onProcess(request)} disabled={isProcessing}>{isProcessing ? 'Processing...' : 'Process change'}</button>
    </div>;
  }
  return <div className="change-impact significant"><strong>Significant change</strong> ({fieldLabels(impact.significant_fields)}). {affected
    ? `Approving returns ${affected} to Pending for re-review.`
    : 'This event has no live venue or equipment requests for it to reopen yet.'}</div>;
}

function ChangeRequestField({ label, originalValue, proposedValue, wide = false, children }) {
  const isChanged = String(originalValue ?? '') !== String(proposedValue ?? '');
  const originalDisplay = originalValue == null || originalValue === '' ? 'Not provided' : String(originalValue);
  return <label className={`change-request-field${wide ? ' wide' : ''}${isChanged ? ' changed' : ''}`}>
    <span>{label}</span>
    {children}
    {isChanged && <small className="change-comparison">Original: {originalDisplay}</small>}
  </label>;
}

function displayEventDetail(value) {
  if (Array.isArray(value)) return value.join(', ') || 'Not provided';
  return value == null || value === '' ? 'Not provided' : String(value);
}

function FeedbackCount({ count, label }) {
  return <span className="feedback-count" aria-label={`${count || 0} ${label}`}>{count || 0}</span>;
}

function CoordinatorFeedbackDialog({ event, clarification, amendments, error, isSubmitting, onChange, onClose, onSubmit }) {
  const details = [
    ['Event name', event.event_title],
    ['Event type', event.event_type],
    ['Start date', event.event_date],
    ['End date', event.event_end_date || event.event_date],
    ['Capacity', event.event_capacity],
    ['Start time', formatTime(event.start_time)],
    ['End time', formatTime(event.end_time)],
    ['Required layout', event.layout_required],
    ['Required facilities', event.facilities_required],
    ['Accessibility requirements', event.accessibility_required],
  ];
  return <div className="feedback-backdrop">
    <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title">
      <div className="feedback-heading">
        <div><p>Event #{event.id}</p><h2 id="feedback-dialog-title">Request clarification/amendments</h2><span>{event.event_title}</span></div>
        <button className="feedback-close" type="button" aria-label="Close" onClick={onClose} disabled={isSubmitting}>X</button>
      </div>
      <form onSubmit={onSubmit}>
        <h3>Submitted event details</h3>
        <div className="feedback-details">
          {details.map(([label, value]) => <label key={label}>{label}<input value={displayEventDetail(value)} readOnly /></label>)}
          <label className="wide">Description and planning requirements<textarea value={displayEventDetail(event.description)} readOnly rows="4" /></label>
        </div>
        <div className="feedback-inputs">
          <label><span>Clarification requested <FeedbackCount count={event.coordinator_comments_count} label="clarification requests already sent" /></span><textarea aria-label="Clarification request" value={clarification} onChange={(input) => onChange('coordinator_comments', input.target.value)} maxLength={5000} rows="4" /></label>
          <label><span>Amendments requested <FeedbackCount count={event.amendments_count} label="amendment requests already sent" /></span><textarea aria-label="Amendment request" value={amendments} onChange={(input) => onChange('amendments', input.target.value)} maxLength={5000} rows="4" /></label>
        </div>
        {error && <p className="message" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="primary" type="submit" disabled={isSubmitting || (!clarification.trim() && !amendments.trim())}>{isSubmitting ? 'Sending request...' : 'Send request to organiser'}</button>
          <button className="secondary" type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
        </div>
      </form>
    </section>
  </div>;
}

function CoordinatorFeedbackLogDialog({ event, onClose }) {
  const details = [
    ['Event name', event.event_title],
    ['Event type', event.event_type],
    ['Start date', event.event_date],
    ['End date', event.event_end_date || event.event_date],
    ['Capacity', event.event_capacity],
    ['Start time', formatTime(event.start_time)],
    ['End time', formatTime(event.end_time)],
    ['Required layout', event.layout_required],
    ['Required facilities', event.facilities_required],
    ['Accessibility requirements', event.accessibility_required],
  ];
  return <div className="feedback-backdrop">
    <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-log-title">
      <div className="feedback-heading">
        <div><p>Event #{event.id}</p><h2 id="feedback-log-title">Coordinator request log</h2><span>{event.event_title}</span></div>
        <button className="feedback-close" type="button" aria-label="Close logs" onClick={onClose}>X</button>
      </div>
      <h3>Submitted event details</h3>
      <div className="feedback-details">
        {details.map(([label, value]) => <label key={label}>{label}<input value={displayEventDetail(value)} readOnly /></label>)}
        <label className="wide">Description and planning requirements<textarea value={displayEventDetail(event.description)} readOnly rows="4" /></label>
        <label>Clarification requested<textarea aria-label="Coordinator clarification requested" value={event.coordinator_comments || 'No clarification request.'} readOnly rows="4" /></label>
        <label>Amendments requested<textarea aria-label="Coordinator amendments requested" value={event.amendments || 'No amendment request.'} readOnly rows="4" /></label>
      </div>
    </section>
  </div>;
}

function EventRows({ events, onAssign, onStatusChange, onSubmit, onRequestChanges, onRequestClarification, onViewFeedbackLog, coordinators, canManage = false, showChangeDecision = false, showCoordinatorFeedback = false, historyEventId = null, onToggleHistory }) {
  const columnCount = 6 + (showChangeDecision ? 1 : 0);
  return events.length ? events.map((event) => <React.Fragment key={event.id}><tr>
    <td>{event.event_title}</td><td>{event.event_end_date && event.event_end_date !== event.event_date ? `${event.event_date} to ${event.event_end_date}` : event.event_date}</td>
    <td>{canManage ? <select aria-label={`Status for ${event.event_title}`} value={event.event_status || ''} onChange={(e) => onStatusChange(event.id, e.target.value)}>{EVENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : <span className="pill">{event.event_status}</span>}</td>
    <td>{canManage ? <select aria-label={`Coordinator for ${event.event_title}`} value={event.assigned_coordinator_id || ''} onChange={(e) => onAssign(event.id, e.target.value)}>{coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select> : event.coordinator_name ? <span>{event.coordinator_name}<br /><small>{event.coordinator_email || 'Email unavailable'}</small></span> : <button className="assign" onClick={() => onAssign(event.id)}>Assign coordinator</button>}</td>
    {showChangeDecision && <td>{event.latest_change_request ? <><span className="pill">{event.latest_change_request.review_status}</span>{event.latest_change_request.review_status === 'Rejected' && event.latest_change_request.review_comments && <small className="change-request-reason">Reason: {event.latest_change_request.review_comments}</small>}{event.latest_change_request.change_type && <small className="change-request-reason">{event.latest_change_request.change_type} change{PROCESSING_LABELS[event.latest_change_request.processing_status] ? ` · ${PROCESSING_LABELS[event.latest_change_request.processing_status]}` : ''}</small>}</> : '—'}</td>}
    {showCoordinatorFeedback && <td>{event.coordinator_comments || event.amendments
      ? <button className="assign" type="button" onClick={() => onViewFeedbackLog(event)}>View clarification/amendments</button>
      : '—'}</td>}
    {!canManage && <td>{String(event.event_status).trim().toLowerCase() === 'draft' && <button className="assign" onClick={() => onSubmit(event.id)}>Submit</button>}{!['draft', 'completed', 'cancelled', 'rejected'].includes(String(event.event_status).trim().toLowerCase()) && (event.has_pending_change_request ? <span className="pill">Pending change request</span> : <button className="assign" onClick={() => onRequestChanges(event)}>Request changes</button>)}</td>}
    {canManage && <td>{['submitted', 'under review'].includes(String(event.event_status || '').trim().toLowerCase()) && <button className="assign" type="button" onClick={() => onRequestClarification(event)}>Request clarification/amendments</button>}</td>}
    <td><button className="assign" type="button" aria-label={`Change history for ${event.event_title}`} aria-expanded={historyEventId === event.id} onClick={() => onToggleHistory(event.id)}>{historyEventId === event.id ? 'Hide history' : 'History'}</button></td>
  </tr>
  {historyEventId === event.id && <tr><td className="change-history-cell" colSpan={columnCount}><EventChangeHistory eventId={event.id} /></td></tr>}
  </React.Fragment>) : <tr><td className="empty" colSpan={columnCount}>No event requests found.</td></tr>;
}

function ChangeRequestRows({ requests, onSelect, selectedRequest, onReview, reviewingChangeRequestId, reviewError, onProcess, processingChangeRequestId }) {
  const statusPriority = { pending: 0, approved: 1, rejected: 2 };
  const sortedRequests = [...requests].sort((first, second) => {
    const firstPriority = statusPriority[String(first.review_status || 'Pending').trim().toLowerCase()] ?? 3;
    const secondPriority = statusPriority[String(second.review_status || 'Pending').trim().toLowerCase()] ?? 3;
    return firstPriority - secondPriority;
  });
  return sortedRequests.length ? sortedRequests.map((request) => {
    const proposal = request.proposal || {};
    const eventName = proposal.event_name || request.event?.event_title || `Request #${request.id}`;
    const isExpanded = selectedRequest?.id === request.id;
    return <React.Fragment key={request.id}>
      <tr>
        <td>{eventName}</td>
        <td>{request.organiser_name || request.organiser_email || 'Unknown organiser'}</td>
        <td>{request.review_status || 'Pending'}</td>
        <td>{request.impact ? <span className={`change-badge ${request.impact.change_type === 'Significant' ? 'significant' : 'ordinary'}`}>{request.impact.change_type}</span> : '—'}</td>
        <td>{request.processing_status || '—'}</td>
        <td>{request.created_at ? String(request.created_at).slice(0, 10) : 'Not recorded'}</td>
        <td><button className="assign" type="button" onClick={() => onSelect(isExpanded ? null : request)} aria-expanded={isExpanded} aria-controls={`change-request-detail-${request.id}`}>{isExpanded ? 'Hide' : 'View'}</button></td>
      </tr>
      {isExpanded && <tr id={`change-request-detail-${request.id}`}><td className="change-request-detail-cell" colSpan="7"><ChangeRequestDetail request={request} onReview={onReview} isReviewing={reviewingChangeRequestId === request.id} reviewError={reviewError} onProcess={onProcess} isProcessing={processingChangeRequestId === request.id} /></td></tr>}
    </React.Fragment>;
  }) : <tr><td className="empty" colSpan="7">No event change requests found.</td></tr>;
}

function ChangeRequestDetail({ request, onReview, isReviewing, reviewError, onProcess, isProcessing }) {
  const [reviewComments, setReviewComments] = useState('');
  if (!request) return null;
  const proposal = request.proposal || EMPTY_PROPOSAL;
  const current = request.event || {};
  const isPending = (request.review_status || 'Pending') === 'Pending';
  return <form className="request-form" aria-label="Event change request details">
    <div className="form-heading"><div><h2>Event change request: {proposal.event_name || current.event_title}</h2><p>Submitted by {request.organiser_name || request.organiser_email || 'the event organiser'} for coordinator review.</p></div><span className="pill">{request.review_status || 'Pending'}</span></div>
    <ChangeImpact request={request} onProcess={onProcess} isProcessing={isProcessing} error={isPending ? '' : reviewError} />
    <div className="form-grid">
      <ChangeRequestField label="Event name" originalValue={current.event_name || current.event_title} proposedValue={proposal.event_name}>
        <input aria-label="Event name" value={proposal.event_name || ''} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="Event type" originalValue={current.event_type} proposedValue={proposal.event_type}>
        <input aria-label="Event type" value={proposal.event_type || ''} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="Start date" originalValue={current.event_date} proposedValue={proposal.event_date}>
        <input aria-label="Start date" type="date" value={proposal.event_date || ''} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="End date" originalValue={current.event_end_date || current.event_date} proposedValue={proposal.event_end_date || proposal.event_date}>
        <input aria-label="End date" type="date" value={proposal.event_end_date || proposal.event_date || ''} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="Capacity" originalValue={current.event_capacity} proposedValue={proposal.event_capacity}>
        <input aria-label="Capacity" value={proposal.event_capacity ?? ''} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="Start time" originalValue={formatTime(current.start_time)} proposedValue={formatTime(proposal.start_time)}>
        <input aria-label="Start time" value={formatTime(proposal.start_time)} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="End time" originalValue={formatTime(current.end_time)} proposedValue={formatTime(proposal.end_time)}>
        <input aria-label="End time" value={formatTime(proposal.end_time)} readOnly />
      </ChangeRequestField>
      <ChangeRequestField label="Description and planning requirements" originalValue={current.description} proposedValue={proposal.description} wide>
        <textarea aria-label="Description and planning requirements" value={proposal.description || ''} readOnly rows="5" />
      </ChangeRequestField>
      <label className="wide">Reason for change<textarea value={request.request_text || ''} readOnly rows="3" /></label>
    </div>
    {request.review_comments && !isPending && <p className="message"><strong>Decision reason:</strong> {request.review_comments}</p>}
    {isPending && <>
      <label className="review-reason">Reason for rejection<textarea aria-label="Reason for rejection" value={reviewComments} onChange={(event) => setReviewComments(event.target.value)} maxLength={5000} rows="3" required /></label>
      {reviewError && <p className="message" role="alert">{reviewError}</p>}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => onReview(request, 'Approved', '')} disabled={isReviewing}>{isReviewing ? 'Saving decision...' : 'Approve'}</button>
        <button className="secondary review-reject" type="button" onClick={() => onReview(request, 'Rejected', reviewComments)} disabled={isReviewing || !reviewComments.trim()}>{isReviewing ? 'Saving decision...' : 'Reject'}</button>
      </div>
    </>}
  </form>;
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
  const [coordinatorChangeRequests, setCoordinatorChangeRequests] = useState([]);
  const [selectedChangeRequest, setSelectedChangeRequest] = useState(null);
  const [reviewingChangeRequestId, setReviewingChangeRequestId] = useState(null);
  const [changeRequestReviewError, setChangeRequestReviewError] = useState('');
  const [processingChangeRequestId, setProcessingChangeRequestId] = useState(null);
  const [historyEventId, setHistoryEventId] = useState(null);
  const [feedbackEvent, setFeedbackEvent] = useState(null);
  const [feedbackClarification, setFeedbackClarification] = useState('');
  const [feedbackAmendments, setFeedbackAmendments] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackLogEvent, setFeedbackLogEvent] = useState(null);
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

  async function loadCoordinatorChangeRequests(keepMessage = false) {
    try {
      const response = await fetch(`${API}/event-change-requests`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const requests = await response.json();
      setCoordinatorChangeRequests(requests);
      setSelectedChangeRequest((current) => current && requests.find((request) => request.id === current.id) || null);
      if (!keepMessage) setMessage('');
    } catch (error) {
      setMessage(`Unable to load event change requests. (${error.message})`);
    }
  }

  async function reviewChangeRequest(request, decision, reviewComments) {
    if (reviewingChangeRequestId !== null) return;
    setReviewingChangeRequestId(request.id);
    setChangeRequestReviewError('');
    try {
      const response = await fetch(`${API}/event-change-requests/${request.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, review_comments: reviewComments.trim() || null }),
      });
      const result = await response.json();
      if (!response.ok) {
        setChangeRequestReviewError(result.detail || 'Could not save the change request decision.');
        return;
      }
      const updatedRequest = {
        ...request,
        ...result,
        // The database classifies the applied change; rejected requests have no impact.
        impact: result.change_type ? {
          venue_requests: [],
          equipment_requests: [],
          ...request.impact,
          change_type: result.change_type,
          significant_fields: result.significant_fields || [],
          affects_venue: Boolean(result.affects_venue),
          affects_equipment: Boolean(result.affects_equipment),
        } : null,
        event: decision === 'Approved' && request.event
          ? {
            ...request.event,
            event_title: request.proposal?.event_name,
            event_name: request.proposal?.event_name,
            event_type: request.proposal?.event_type,
            event_date: request.proposal?.event_date,
            event_end_date: request.proposal?.event_end_date,
            event_capacity: request.proposal?.event_capacity,
            description: request.proposal?.description,
            start_time: request.proposal?.start_time,
            end_time: request.proposal?.end_time,
          }
          : request.event,
      };
      setCoordinatorChangeRequests((current) => current.map((item) => item.id === request.id ? updatedRequest : item));
      setSelectedChangeRequest(updatedRequest);
      setMessage(decision !== 'Approved'
        ? 'Change request rejected.'
        : result.processing_status === 'Awaiting processing'
          ? 'Change request approved and event details updated. Affected venue and equipment requests are back to Pending; process the change to re-initiate them.'
          : 'Change request approved and event details updated.');
    } catch (error) {
      setChangeRequestReviewError(`Unable to save the change request decision. (${error.message})`);
    } finally {
      setReviewingChangeRequestId(null);
    }
  }

  async function processChangeRequest(request) {
    if (processingChangeRequestId !== null) return;
    setProcessingChangeRequestId(request.id);
    setChangeRequestReviewError('');
    try {
      const response = await fetch(`${API}/event-change-requests/${request.id}/process`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) {
        setChangeRequestReviewError(result.detail || 'Could not process the change request.');
        return;
      }
      const { processing_status, processed_at, processing_summary } = result.change_request;
      const updatedRequest = { ...request, processing_status, processed_at, processing_summary };
      setCoordinatorChangeRequests((current) => current.map((item) => item.id === request.id ? updatedRequest : item));
      setSelectedChangeRequest(updatedRequest);
      setMessage(`Change request processed. ${processing_summary || ''}`.trim());
    } catch (error) {
      setChangeRequestReviewError(`Unable to process the change request. (${error.message})`);
    } finally {
      setProcessingChangeRequestId(null);
    }
  }

  function toggleHistory(eventId) {
    setHistoryEventId((current) => current === eventId ? null : eventId);
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

  function startCoordinatorFeedback(event) {
    setFeedbackEvent(event);
    setFeedbackClarification('');
    setFeedbackAmendments('');
    setFeedbackError('');
  }

  function closeCoordinatorFeedback() {
    if (isSubmittingFeedback) return;
    setFeedbackEvent(null);
    setFeedbackError('');
  }

  function changeCoordinatorFeedback(field, value) {
    if (field === 'coordinator_comments') setFeedbackClarification(value);
    else setFeedbackAmendments(value);
  }

  async function submitCoordinatorFeedback(submitEvent) {
    submitEvent.preventDefault();
    if (!feedbackEvent || isSubmittingFeedback) return;
    setIsSubmittingFeedback(true);
    setFeedbackError('');
    try {
      const response = await fetch(`${API}/events/${feedbackEvent.id}/clarification-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinator_comments: feedbackClarification, amendments: feedbackAmendments }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFeedbackError(result.detail || 'Could not send the clarification/amendment request.');
        return;
      }
      setEvents((current) => current.map((event) => event.id === result.id ? { ...event, ...result } : event));
      setFeedbackEvent(null);
      setFeedbackClarification('');
      setFeedbackAmendments('');
      setMessage('Clarification/amendment request sent to the event organiser.');
    } catch (error) {
      setFeedbackError(`Unable to send the clarification/amendment request. (${error.message})`);
    } finally {
      setIsSubmittingFeedback(false);
    }
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
      await loadOrganiser(true);
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

  async function showManagement() {
    setActiveTab('management');
    setSelectedChangeRequest(null);
    await loadManagement();
  }

  async function showChangeRequests() {
    setActiveTab('change-requests');
    await loadCoordinatorChangeRequests();
  }

  return <main className="shell">
    <aside><div className="logo">G</div><div className="side-label">{isCoordinator ? activeTab === 'change-requests' ? 'EVENT CHANGE REQUEST' : 'EVENT MANAGEMENT' : 'EVENT STATUS'}</div></aside>
    <section className="content">
      <header><div><p className="kicker">Gather / Assignment desk</p><h1>{isCoordinator ? activeTab === 'change-requests' ? 'Event change request' : 'Event management' : 'Event status'}</h1></div><span className="live">● Supabase connected</span></header>
      <nav aria-label="Event coordinator views">
        {!isCoordinator && <button className={activeTab === 'status' ? 'active' : ''} onClick={() => { setActiveTab('status'); loadOrganiser(); }}>Event status</button>}
        {isCoordinator && <button className={activeTab === 'management' ? 'active' : ''} onClick={showManagement}>Event management</button>}
        {isCoordinator && <button className={activeTab === 'change-requests' ? 'active' : ''} onClick={showChangeRequests}>Event Change Request</button>}
      </nav>
      {message && <p className="message">{message}</p>}
      {activeTab !== 'change-requests' && <>
        <h2>Event status</h2>
        <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Date</th><th>Event Status</th><th>Event Coordinator</th>{isOrganiser && <th>Change request decision</th>}{isOrganiser && <th>Clarification/amendments from coordinator</th>}{isCoordinator && <th>Actions</th>}{!isCoordinator && <th>Action</th>}<th>Changes</th></tr></thead><tbody><EventRows events={events} onAssign={activeTab === 'management' ? reassign : assign} onStatusChange={updateStatus} onSubmit={submitEvent} onRequestChanges={startChangeRequest} onRequestClarification={startCoordinatorFeedback} onViewFeedbackLog={setFeedbackLogEvent} coordinators={coordinators} canManage={activeTab === 'management'} showChangeDecision={isOrganiser} showCoordinatorFeedback={isOrganiser} historyEventId={historyEventId} onToggleHistory={toggleHistory} /></tbody></table></div>
      </>}
      {isCoordinator && activeTab === 'change-requests' && <>
        <h2>Submitted change requests</h2>
        <div className="table-wrap"><table><thead><tr><th>Event Title</th><th>Event Organiser</th><th>Status</th><th>Impact</th><th>Processing</th><th>Submitted</th><th>Action</th></tr></thead><tbody><ChangeRequestRows requests={coordinatorChangeRequests} onSelect={(request) => { setSelectedChangeRequest(request); setChangeRequestReviewError(''); }} selectedRequest={selectedChangeRequest} onReview={reviewChangeRequest} reviewingChangeRequestId={reviewingChangeRequestId} reviewError={changeRequestReviewError} onProcess={processChangeRequest} processingChangeRequestId={processingChangeRequestId} /></tbody></table></div>
      </>}
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
        <ChangeSignificance event={changeRequestEvent} proposal={changeProposal} />
        <div className="form-actions"><button className="primary" type="submit" disabled={!changeRequestText.trim() || isSubmittingChangeRequest}>{isSubmittingChangeRequest ? 'Sending request...' : 'Send for coordinator approval'}</button><button className="secondary" type="button" onClick={cancelChangeRequest} disabled={isSubmittingChangeRequest}>Cancel</button></div>
      </form>}
      {isCoordinator && feedbackEvent && <CoordinatorFeedbackDialog event={feedbackEvent} clarification={feedbackClarification} amendments={feedbackAmendments} error={feedbackError} isSubmitting={isSubmittingFeedback} onChange={changeCoordinatorFeedback} onClose={closeCoordinatorFeedback} onSubmit={submitCoordinatorFeedback} />}
      {isOrganiser && feedbackLogEvent && <CoordinatorFeedbackLogDialog event={feedbackLogEvent} onClose={() => setFeedbackLogEvent(null)} />}
    </section>
  </main>;
}
