import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import CoordinatorAssignment from '../coordinator_assignment';

const ORGANISER = { id: 'o1', role: 'Event Organiser' };
const COORDINATOR = { id: 'c1', role: 'Event Coordinator' };
const ev = (o = {}) => ({ id: 1, event_title: 'Gala', event_name: 'Gala', event_type: 'Workshop', event_date: '2026-10-01', event_end_date: '2026-10-01', event_capacity: 10, description: 'Initial plan', start_time: '09:00:00', end_time: '17:00:00', event_status: 'Submitted', assigned_coordinator_id: null, coordinator_name: null, coordinator_email: null, ...o });
const changeReq = (o = {}) => ({
  id: 11,
  event_id: 1,
  organiser_name: 'Olly',
  organiser_email: 'o@x',
  request_text: 'Move the event to the morning',
  review_status: 'Pending',
  created_at: '2026-04-01T00:00:00Z',
  event: ev({ assigned_coordinator_id: 'c1', event_status: 'Approved' }),
  proposal: {
    event_name: 'Morning Gala',
    event_type: 'Workshop',
    event_date: '2026-10-02',
    event_end_date: '2026-10-02',
    event_capacity: 50,
    description: 'Updated morning programme',
    start_time: '08:00:00',
    end_time: '12:00:00',
  },
  ...o,
});

describe('CoordinatorAssignment', () => {
  tc('FE-COORD-001', 'CoordinatorAssignment (organiser view)', 'An organiser opens the page.', 'Their events are fetched from /event-organisers/<id>/requests and shown with title, date and status; the heading is "Event status".',
    { pre: 'Backend returns one event.', steps: '1. Render as organiser.' },
    async () => {
      const f = mockFetch(() => json([ev({ event_status: 'Approved' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText('Gala')).toBeInTheDocument();
      expect(f.mock.calls[0][0]).toMatch(/event-organisers\/o1\/requests$/);
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Event status', level: 1 })).toBeInTheDocument();
    });

  tc('FE-COORD-002', 'CoordinatorAssignment', 'A multi-day event is listed.', 'The date column reads "<start> to <end>"; single-day events show one date.',
    { data: '2026-10-01 to 2026-10-03', steps: '1. Render with a multi-day and a single-day event.' },
    async () => {
      mockFetch(() => json([ev({ id: 1, event_end_date: '2026-10-03' }), ev({ id: 2, event_title: 'One day', event_date: '2026-11-01', event_end_date: '2026-11-01' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText('2026-10-01 to 2026-10-03')).toBeInTheDocument();
      expect(screen.getByText('2026-11-01')).toBeInTheDocument();
    });

  tc('FE-COORD-003', 'CoordinatorAssignment', 'The organiser has no events.', '"No event requests found." is shown.', { kind: 'Edge', steps: '1. Render with an empty list.' },
    async () => {
      mockFetch(() => json([]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
    });

  tc('FE-COORD-004', 'CoordinatorAssignment', 'The backend is unreachable when loading.', 'A message tells the user to start the backend and includes the error.',
    { kind: 'Negative', steps: '1. Make fetch reject. 2. Render as organiser.' },
    async () => {
      mockFetch(() => { throw new Error('Failed to fetch'); });
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText(/Unable to load event status.*Failed to fetch/)).toBeInTheDocument();
    });

  tc('FE-COORD-005', 'CoordinatorAssignment', 'Backend returns a non-OK status on load.', 'The message includes "Backend returned 500".', { kind: 'Negative', steps: '1. Return 500. 2. Render.' },
    async () => {
      mockFetch(() => json({}, 500));
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText(/Backend returned 500/)).toBeInTheDocument();
    });

  tc('FE-COORD-006', 'CoordinatorAssignment', 'An event has no coordinator and the organiser clicks "Assign coordinator".', 'POST /events/<id>/assign-coordinator is sent, "<event> assigned to <coordinator>." stays on screen and the list reloads showing the assigned coordinator.',
    { pre: 'Event unassigned.', steps: '1. Render. 2. Click "Assign coordinator".', kind: 'Regression' },
    async () => {
      let assigned = false;
      const f = mockFetch((url) => {
        if (url.includes('assign-coordinator')) { assigned = true; return json({ event_title: 'Gala', coordinator_name: 'Amy' }); }
        return json([ev(assigned ? { coordinator_name: 'Amy', coordinator_email: 'a@x' } : {})]);
      });
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Assign coordinator' }));
      await waitFor(() => expect(callsTo(f, 'assign-coordinator', 'POST')).toHaveLength(1));
      expect(await screen.findByText('a@x')).toBeInTheDocument();
      expect(screen.getByText('Gala assigned to Amy.')).toBeInTheDocument();
    });

  tc('FE-COORD-007', 'CoordinatorAssignment', 'The organiser clicks the "Event status" tab.', 'The organiser\'s requests are fetched again.',
    { kind: 'State', steps: '1. Render as organiser. 2. Click the "Event status" tab.' },
    async () => {
      const f = mockFetch(() => json([ev()]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      await screen.findByText('Gala');
      fireEvent.click(screen.getByRole('button', { name: 'Event status' }));
      await waitFor(() => expect(callsTo(f, '/event-organisers/o1/requests')).toHaveLength(2));
    });

  tc('FE-COORD-020', 'CoordinatorAssignment', 'Assignment is rejected by the backend after clicking "Assign coordinator".', 'The backend\'s detail message is displayed and stays on screen.',
    { kind: 'Negative', data: '500 "Exactly 3 event coordinators are required."', steps: '1. Return 500 with a detail for assign-coordinator. 2. Click "Assign coordinator".' },
    async () => {
      mockFetch((url) => url.includes('assign-coordinator') ? json({ detail: 'Exactly 3 event coordinators are required.' }, 500) : json([ev()]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Assign coordinator' }));
      expect(await screen.findByText('Exactly 3 event coordinators are required.')).toBeInTheDocument();
    });

  tc('FE-COORD-008', 'CoordinatorAssignment', 'Assigned coordinator without an email.', 'The name is shown with "Email unavailable".', { kind: 'Edge', steps: '1. Render an event whose coordinator has no email.' },
    async () => {
      mockFetch(() => json([ev({ coordinator_name: 'Amy' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText('Email unavailable')).toBeInTheDocument();
    });

  tc('FE-COORD-009', 'CoordinatorAssignment (organiser status)', 'The organiser has only Draft events.',
    'The Event status table excludes Draft events and displays its empty state.',
    { pre: 'The organiser has one Draft event.', steps: '1. Render the Event status tab.' },
    async () => {
      mockFetch(() => json([ev({ event_status: 'Draft' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
    });

  tc('FE-COORD-011', 'CoordinatorAssignment (organiser status)', 'Events in different statuses are listed.',
    'Draft is omitted; active events show Request changes unless one is already pending; Completed, Cancelled and Rejected have no action besides their change history.',
    { data: 'Draft, Submitted, Approved, Planning with pending change, Completed, Cancelled, Rejected', steps: '1. Render events in these statuses. 2. Inspect rows and actions.' },
    async () => {
      mockFetch(() => json([
        ev({ id: 1, event_title: 'D', event_status: 'Draft', coordinator_name: 'Zed' }),
        ev({ id: 2, event_title: 'Sub', event_status: 'Submitted', coordinator_name: 'Zed' }),
        ev({ id: 3, event_title: 'Appr', event_status: 'Approved', coordinator_name: 'Zed' }),
        ev({ id: 7, event_title: 'Plan', event_status: 'Planning', coordinator_name: 'Zed', has_pending_change_request: true }),
        ev({ id: 4, event_title: 'Comp', event_status: 'Completed', coordinator_name: 'Zed' }),
        ev({ id: 5, event_title: 'Can', event_status: 'Cancelled', coordinator_name: 'Zed' }),
        ev({ id: 6, event_title: 'Rej', event_status: 'Rejected', coordinator_name: 'Zed', latest_change_request: { review_status: 'Rejected', review_comments: 'Please revise the event details.' } }),
      ]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      await screen.findByText('Sub');
      const row = (t) => screen.getByText(t).closest('tr');
      expect(screen.queryByText('D')).not.toBeInTheDocument();
      expect(within(row('Sub')).getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
      expect(within(row('Appr')).getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
      expect(within(row('Plan')).getByText('Pending change request')).toBeInTheDocument();
      expect(within(row('Plan')).queryByRole('button', { name: 'Request changes' })).toBeNull();
      expect(within(row('Rej')).getByText(/Reason: Please revise the event details\./)).toBeInTheDocument();
      for (const name of ['Comp', 'Can', 'Rej']) {
        expect(within(row(name)).getAllByRole('button').map((button) => button.textContent)).toEqual(['History']);
      }
    });

  tc('FE-COORD-012', 'CoordinatorAssignment (organiser status)', 'Organiser requests changes to an active event.',
    'The existing event values populate an editable form and the complete proposal plus summary are posted for coordinator approval.',
    { steps: '1. Render an Approved event. 2. Open Request changes. 3. Edit a field and enter the summary. 4. Send for approval.' },
    async () => {
      let submitted = false;
      const f = mockFetch((url) => {
        if (url.endsWith('/change-requests')) {
          submitted = true;
          return json({ id: 42, event_id: 1 });
        }
        return json([ev({ event_status: 'Approved', coordinator_name: 'A', has_pending_change_request: submitted })]);
      });
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      expect(screen.getByLabelText('Event name')).toHaveValue('Gala');
      expect(screen.getByLabelText('Description and planning requirements')).toHaveValue('Initial plan');
      fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Updated Gala' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Change summary for the event coordinator' }), {
        target: { value: 'Add wheelchair-accessible seating' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send for coordinator approval' }));
      expect(await screen.findByText('Change request sent to the assigned event coordinator.')).toBeInTheDocument();
      expect(screen.getByText('Pending change request')).toBeInTheDocument();
      const [url, options] = callsTo(f, '/requests/1/change-requests', 'POST')[0];
      expect(url).toContain('/event-organisers/o1/');
      expect(JSON.parse(options.body)).toEqual({
        event_name: 'Updated Gala',
        event_type: 'Workshop',
        event_date: '2026-10-01',
        event_end_date: '2026-10-01',
        event_capacity: 10,
        description: 'Initial plan',
        start_time: '09:00',
        end_time: '17:00',
        request_text: 'Add wheelchair-accessible seating',
      });
    });

  tc('FE-COORD-021', 'CoordinatorAssignment (organiser status)', 'Sending a change request fails validation.',
    'The error is displayed inside the open proposal form and the typed request remains available for correction.',
    { kind: 'Negative', steps: '1. Enter change details. 2. Return HTTP 400. 3. Verify the text remains.' },
    async () => {
      mockFetch((url) => url.endsWith('/change-requests')
        ? json({ detail: 'An event coordinator must be assigned before requesting changes.' }, 400)
        : json([ev({ event_status: 'Under review' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      const input = screen.getByRole('textbox', { name: 'Change summary for the event coordinator' });
      fireEvent.change(input, { target: { value: 'Move the start time' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send for coordinator approval' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('An event coordinator must be assigned before requesting changes.');
      expect(input).toHaveValue('Move the start time');
    });

  tc('FE-COORD-022', 'CoordinatorAssignment (organiser status)', 'The organiser cancels a change request.',
    'The proposal form closes, and reopening it restores the original event values with an empty summary.',
    { kind: 'State', steps: '1. Open Request changes. 2. Enter a summary. 3. Cancel. 4. Reopen the form.' },
    async () => {
      mockFetch(() => json([ev({ event_status: 'Approved' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      const summary = screen.getByRole('textbox', { name: 'Change summary for the event coordinator' });
      fireEvent.change(summary, { target: { value: 'Update the room layout' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('heading', { name: 'Request changes: Gala' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
      expect(screen.getByLabelText('Event name')).toHaveValue('Gala');
      expect(screen.getByRole('textbox', { name: 'Change summary for the event coordinator' })).toHaveValue('');
    });

  tc('FE-COORD-023', 'CoordinatorAssignment (organiser status)', 'An event with legacy or missing details opens a change request.',
    'Fallback event title, dates, and time values populate correctly, and custom event type and capacity remain selectable.',
    { kind: 'Edge', steps: '1. Render an event with legacy title and custom type/capacity. 2. Open Request changes.' },
    async () => {
      const legacyEvent = ev({
        event_name: null,
        event_title: 'Legacy Gala',
        event_type: 'Retreat',
        event_date: '2026-11-01',
        event_end_date: null,
        event_capacity: 42,
        start_time: null,
        end_time: null,
        event_status: 'Under review',
      });
      mockFetch(() => json([legacyEvent]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      expect(screen.getByLabelText('Event name')).toHaveValue('Legacy Gala');
      expect(screen.getByLabelText('Event type')).toHaveValue('Retreat');
      expect(screen.getByLabelText('Start date')).toHaveValue('2026-11-01');
      expect(screen.getByLabelText('End date')).toHaveValue('2026-11-01');
      expect(screen.getByLabelText('Capacity')).toHaveValue('42');
      expect(screen.getByLabelText('Start time')).toHaveValue('');
      expect(screen.getByLabelText('End time')).toHaveValue('');
    });

  tc('FE-COORD-030', 'CoordinatorAssignment (organiser status)', 'A change request uses one of the standard event capacities.',
    'The standard capacity options are available without adding a custom current-capacity option.',
    { kind: 'State', data: 'event_capacity = 50', steps: '1. Render an event with capacity 50. 2. Open Request changes. 3. Inspect capacity options.' },
    async () => {
      mockFetch(() => json([ev({ event_capacity: 50, event_status: 'Approved' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      expect(screen.getByLabelText('Capacity')).toHaveValue('50');
      expect(screen.getByRole('option', { name: '26-50 attendees' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Current capacity (50)' })).not.toBeInTheDocument();
    });

  tc('FE-COORD-024', 'CoordinatorAssignment (organiser status)', 'The change-request endpoint rejects a request without a detail message.',
    'A default failure message is shown in the proposal form.',
    { kind: 'Negative', steps: '1. Open Request changes. 2. Enter a summary. 3. Return HTTP 500 without detail.' },
    async () => {
      mockFetch((url) => url.endsWith('/change-requests')
        ? json({}, 500)
        : json([ev({ event_status: 'Approved' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Change summary for the event coordinator' }), {
        target: { value: 'Change the room setup' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send for coordinator approval' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the change request.');
    });

  tc('FE-COORD-025', 'CoordinatorAssignment (organiser status)', 'The change-request endpoint cannot be reached.',
    'A network error is shown and the user can try sending the request again.',
    { kind: 'Negative', steps: '1. Open Request changes. 2. Enter a summary. 3. Reject the request.' },
    async () => {
      mockFetch((url) => {
        if (url.endsWith('/change-requests')) throw new Error('Failed to fetch');
        return json([ev({ event_status: 'Approved' })]);
      });
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Change summary for the event coordinator' }), {
        target: { value: 'Change the room setup' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send for coordinator approval' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to send change request. (Failed to fetch)');
      expect(screen.getByRole('button', { name: 'Send for coordinator approval' })).toBeEnabled();
    });

  tc('FE-COORD-027', 'CoordinatorAssignment (organiser status)', 'A change request is being submitted.',
    'The form prevents empty summaries and duplicate submissions, disables Cancel while sending, then reports success.',
    { kind: 'State', steps: '1. Open Request changes. 2. Try empty and whitespace summaries. 3. Submit a valid summary. 4. Submit again before the response.' },
    async () => {
      let resolveResponse;
      const pendingResponse = new Promise((resolve) => { resolveResponse = resolve; });
      const f = mockFetch((url) => url.endsWith('/change-requests')
        ? pendingResponse
        : json([ev({ event_status: 'Approved' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      const form = document.querySelector('form.request-form');
      const summary = screen.getByRole('textbox', { name: 'Change summary for the event coordinator' });
      const sendButton = screen.getByRole('button', { name: 'Send for coordinator approval' });
      expect(sendButton).toBeDisabled();
      fireEvent.change(summary, { target: { value: '   ' } });
      expect(sendButton).toBeDisabled();
      fireEvent.change(summary, { target: { value: 'Change the seating' } });
      expect(sendButton).toBeEnabled();
      fireEvent.click(sendButton);
      expect(screen.getByRole('button', { name: 'Sending request...' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      await waitFor(() => expect(callsTo(f, '/change-requests', 'POST')).toHaveLength(1));
      fireEvent.submit(form);
      expect(callsTo(f, '/change-requests', 'POST')).toHaveLength(1);
      resolveResponse(json({ id: 10 }));
      expect(await screen.findByText('Change request sent to the assigned event coordinator.')).toBeInTheDocument();
    });

  const coordinatorBackend = (extra) => mockFetch((url, o) => {
    if (extra) { const r = extra(url, o); if (r) return r; }
    if (url.endsWith('/events')) return json([ev({ id: 1, assigned_coordinator_id: 'c1' }), ev({ id: 2, event_title: 'Other', assigned_coordinator_id: 'c2' })]);
    if (url.endsWith('/coordinators')) return json([{ id: 'c1', name: 'Cara' }, { id: 'c2', name: 'Dan' }]);
    return json({});
  });

  tc('FE-COORD-032', 'CoordinatorAssignment (coordinator view)', 'A coordinator submits clarification and amendment requests for a submitted event.',
    'A popup shows the submitted event details as read-only, accepts separate clarification and amendment messages, and submits both against the event ID.',
    { pre: 'Gala is assigned to c1 and is under review.', steps: '1. Click Request clarification/amendments. 2. Enter both messages. 3. Submit.' },
    async () => {
      const f = coordinatorBackend((url) => url.endsWith('/clarification-requests')
        ? json(ev({ assigned_coordinator_id: 'c1', coordinator_comments: 'Clarify the schedule.', amendments: 'Update the capacity.', coordinator_comments_count: 1, amendments_count: 1 }))
        : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request clarification/amendments' }));
      const dialog = await screen.findByRole('dialog', { name: 'Request clarification/amendments' });
      expect(within(dialog).getByLabelText('0 clarification requests already sent')).toHaveTextContent('0');
      expect(within(dialog).getByLabelText('0 amendment requests already sent')).toHaveTextContent('0');
      expect(within(dialog).getByLabelText('Event name')).toHaveAttribute('readonly');
      expect(within(dialog).getByLabelText('Event name')).toHaveValue('Gala');
      expect(within(dialog).getByLabelText('Description and planning requirements')).toHaveAttribute('readonly');
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Clarification request' }), { target: { value: 'Clarify the schedule.' } });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amendment request' }), { target: { value: 'Update the capacity.' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Send request to organiser' }));
      await waitFor(() => expect(callsTo(f, '/clarification-requests', 'POST')).toHaveLength(1));
      const call = callsTo(f, '/clarification-requests', 'POST')[0];
      expect(call[0]).toContain('/events/1/clarification-requests');
      expect(JSON.parse(call[1].body)).toEqual({ coordinator_comments: 'Clarify the schedule.', amendments: 'Update the capacity.' });
      expect(await screen.findByText('Clarification/amendment request sent to the event organiser.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Request clarification/amendments' }));
      const reopenedDialog = await screen.findByRole('dialog', { name: 'Request clarification/amendments' });
      expect(screen.getByLabelText('1 clarification requests already sent')).toHaveTextContent('1');
      expect(screen.getByLabelText('1 amendment requests already sent')).toHaveTextContent('1');
      expect(reopenedDialog).toBeInTheDocument();
    });

  tc('FE-COORD-033', 'CoordinatorAssignment (organiser status)', 'The organiser views coordinator clarification and amendment requests.',
    'The Clarification/amendments from coordinator column opens a read-only popup showing the event details and coordinator messages.',
    { pre: 'The event has coordinator_comments and amendments.', steps: '1. Render Event Status as the organiser. 2. Click View clarification/amendments.' },
    async () => {
      mockFetch(() => json([ev({ event_status: 'Under review', coordinator_comments: 'Please clarify the schedule.', amendments: 'Update the venue setup.', coordinator_comments_count: 3, amendments_count: 2 })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'View clarification/amendments' }));
      const dialog = await screen.findByRole('dialog', { name: 'Coordinator request log' });
      expect(within(dialog).getByLabelText('Event name')).toHaveValue('Gala');
      expect(within(dialog).getByLabelText('Coordinator clarification requested')).toHaveValue('Please clarify the schedule.');
      expect(within(dialog).getByLabelText('Coordinator amendments requested')).toHaveValue('Update the venue setup.');
      expect(within(dialog).getByLabelText('Coordinator clarification requested')).toHaveAttribute('readonly');
      expect(within(dialog).getByLabelText('Coordinator amendments requested')).toHaveAttribute('readonly');
      expect(screen.queryByLabelText(/clarification requests sent/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/amendment requests sent/)).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close logs' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

  tc('FE-COORD-034', 'CoordinatorAssignment (coordinator view)', 'The clarification request is rejected by the backend.',
    'The error is shown in the popup and the coordinator can close it.',
    { kind: 'Negative', steps: '1. Open the clarification popup. 2. Enter clarification. 3. Return 409. 4. Close the popup.' },
    async () => {
      coordinatorBackend((url) => url.endsWith('/clarification-requests')
        ? json({ detail: 'Event is no longer under review.' }, 409)
        : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request clarification/amendments' }));
      const dialog = await screen.findByRole('dialog', { name: 'Request clarification/amendments' });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Clarification request' }), { target: { value: 'Clarify the schedule.' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Send request to organiser' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Event is no longer under review.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

  tc('FE-COORD-013', 'CoordinatorAssignment (coordinator view)', 'A coordinator opens the page.', 'Only events assigned to them are listed, each with editable status and coordinator selects; the heading is "Event management".',
    { pre: 'Two events, one assigned to c1.', steps: '1. Render as coordinator c1.' },
    async () => {
      coordinatorBackend();
      render(<CoordinatorAssignment user={COORDINATOR} />);
      expect(await screen.findByText('Gala')).toBeInTheDocument();
      expect(screen.queryByText('Other')).toBeNull();
      expect(screen.getByLabelText('Coordinator for Gala')).toHaveValue('c1');
      expect(screen.getByRole('heading', { name: 'Event management', level: 1 })).toBeInTheDocument();
    });

  tc('FE-COORD-014', 'CoordinatorAssignment (coordinator view)', 'Loading tasks fails.', '"Unable to load event tasks." message is shown.', { kind: 'Negative', steps: '1. Return 500 for the lists. 2. Render as coordinator.' },
    async () => {
      mockFetch(() => json({}, 500));
      render(<CoordinatorAssignment user={COORDINATOR} />);
      expect(await screen.findByText(/Unable to load event tasks/)).toBeInTheDocument();
    });

  tc('FE-COORD-026', 'CoordinatorAssignment (coordinator view)', 'The coordinator list fails while event tasks load successfully.',
    '"Unable to load event tasks." is shown when coordinator data cannot be loaded.',
    { kind: 'Negative', steps: '1. Return events successfully. 2. Return 500 for the coordinator list.' },
    async () => {
      mockFetch((url) => url.endsWith('/events') ? json([ev({ assigned_coordinator_id: 'c1' })]) : json({}, 500));
      render(<CoordinatorAssignment user={COORDINATOR} />);
      expect(await screen.findByText(/Unable to load event tasks/)).toBeInTheDocument();
    });

  tc('FE-COORD-015', 'CoordinatorAssignment (coordinator view)', 'Coordinator changes an event\'s status to Approved.', 'PATCH /events/<id>/status is sent with {event_status}; the row and a success message update.',
    { data: 'event_status = Approved', steps: '1. Render. 2. Choose "Approved" in the status select.' },
    async () => {
      const f = coordinatorBackend((url, o) => o.method === 'PATCH' ? json(ev({ assigned_coordinator_id: 'c1', event_status: 'Approved' })) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.change(await screen.findByLabelText('Status for Gala'), { target: { value: 'Approved' } });
      expect(await screen.findByText('Gala status updated to Approved.')).toBeInTheDocument();
      const [, options] = callsTo(f, '/events/1/status', 'PATCH')[0];
      expect(JSON.parse(options.body)).toEqual({ event_status: 'Approved' });
      expect(screen.getByLabelText('Status for Gala')).toHaveValue('Approved');
    });

  tc('FE-COORD-016', 'CoordinatorAssignment (coordinator view)', 'Status update is rejected.', 'The backend detail is shown and the row is unchanged.', { kind: 'Negative', steps: '1. Return 400 for the PATCH. 2. Change the status.' },
    async () => {
      coordinatorBackend((url, o) => o.method === 'PATCH' ? json({ detail: 'Invalid event status.' }, 400) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.change(await screen.findByLabelText('Status for Gala'), { target: { value: 'Approved' } });
      expect(await screen.findByText('Invalid event status.')).toBeInTheDocument();
    });

  tc('FE-COORD-028', 'CoordinatorAssignment (coordinator view)', 'A successful status update returns a different event.',
    'The success message uses the response while the listed event row remains unchanged.',
    { kind: 'Edge', steps: '1. Render Gala as Submitted. 2. Change its status. 3. Return a successful update for another event.' },
    async () => {
      coordinatorBackend((url, o) => o.method === 'PATCH' ? json(ev({ id: 99, event_title: 'Other', assigned_coordinator_id: 'c1', event_status: 'Approved' })) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.change(await screen.findByLabelText('Status for Gala'), { target: { value: 'Approved' } });
      expect(await screen.findByText('Other status updated to Approved.')).toBeInTheDocument();
      expect(screen.getByLabelText('Status for Gala')).toHaveValue('Under review');
    });

  tc('FE-COORD-017', 'CoordinatorAssignment (coordinator view)', 'Coordinator reassigns an event to Dan.', 'PATCH /events/<id>/coordinator is sent with {coordinator_id}, "<event> reassigned to <coordinator>." stays on screen and the task list reloads.',
    { data: 'coordinator_id = c2', steps: '1. Render. 2. Choose "Dan" in the coordinator select.' },
    async () => {
      const f = coordinatorBackend((url, o) => o.method === 'PATCH' ? json({ event_title: 'Gala', coordinator_name: 'Dan' }) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.change(await screen.findByLabelText('Coordinator for Gala'), { target: { value: 'c2' } });
      expect(await screen.findByText('Gala reassigned to Dan.')).toBeInTheDocument();
      expect(callsTo(f, '/events/1/coordinator', 'PATCH')).toHaveLength(1);
      expect(JSON.parse(callsTo(f, '/events/1/coordinator', 'PATCH')[0][1].body)).toEqual({ coordinator_id: 'c2' });
      await waitFor(() => expect(callsTo(f, '/api/events', 'GET').length).toBeGreaterThan(1));
    });

  tc('FE-COORD-018', 'CoordinatorAssignment (coordinator view)', 'Reassignment fails.', 'The backend detail message is shown.', { kind: 'Negative', steps: '1. Return 400 for the PATCH. 2. Reassign.' },
    async () => {
      coordinatorBackend((url, o) => o.method === 'PATCH' ? json({ detail: 'Select an available event coordinator.' }, 400) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.change(await screen.findByLabelText('Coordinator for Gala'), { target: { value: 'c2' } });
      expect(await screen.findByText('Select an available event coordinator.')).toBeInTheDocument();
    });

  tc('FE-COORD-029', 'CoordinatorAssignment (coordinator view)', 'Reassignment fails without a backend detail message.',
    'The fallback message "Reassignment failed." is shown.',
    { kind: 'Negative', steps: '1. Return 400 without a detail field for the reassignment PATCH. 2. Choose another coordinator.' },
    async () => {
      coordinatorBackend((url, o) => o.method === 'PATCH' ? json({}, 400) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.change(await screen.findByLabelText('Coordinator for Gala'), { target: { value: 'c2' } });
      expect(await screen.findByText('Reassignment failed.')).toBeInTheDocument();
    });

  tc('FE-COORD-019', 'CoordinatorAssignment (coordinator view)', 'The empty option of the coordinator select is chosen.', 'No request is sent.', { kind: 'Edge', steps: '1. Render. 2. Change the coordinator select to "".' },
    async () => {
      const f = coordinatorBackend();
      render(<CoordinatorAssignment user={COORDINATOR} />);
      const select = await screen.findByLabelText('Coordinator for Gala');
      const before = f.mock.calls.length;
      fireEvent.change(select, { target: { value: '' } });
      expect(f.mock.calls.length).toBe(before);
    });

  tc('FE-COORD-031', 'CoordinatorAssignment (event change request tab)', 'A coordinator opens Event Change Request.',
    'Assigned event change requests are fetched and listed with title, organiser, status, submitted date and a View action.',
    { pre: 'Backend returns one change request assigned to c1.', steps: '1. Render as coordinator. 2. Click Event Change Request.' },
    async () => {
      const f = coordinatorBackend((url) => url.endsWith('/event-change-requests') ? json([changeReq()]) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      expect(await screen.findByRole('heading', { name: 'Event change request', level: 1 })).toBeInTheDocument();
      const requestRow = screen.getByRole('row', { name: /Morning Gala/ });
      expect(within(requestRow).getByRole('button', { name: 'View' })).toBeInTheDocument();
      expect(within(requestRow).queryByRole('button', { name: 'Morning Gala' })).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Event change request details' })).not.toBeInTheDocument();
      expect(screen.getByText('Olly')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('2026-04-01')).toBeInTheDocument();
      expect(callsTo(f, '/event-change-requests')).toHaveLength(1);
    });

  tc('FE-COORD-032', 'CoordinatorAssignment (event change request detail)', 'A coordinator selects a change request.',
    'View expands the read-only event details form below its row while keeping the request list visible; Hide collapses it.',
    { steps: '1. Open Event Change Request. 2. Click View. 3. Inspect the expanded details. 4. Click Hide.' },
    async () => {
      coordinatorBackend((url) => url.endsWith('/event-change-requests') ? json([changeReq()]) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      expect(screen.getByRole('form', { name: 'Event change request details' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Submitted change requests' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByLabelText('Event name')).toHaveValue('Morning Gala');
      expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-02');
      expect(screen.getByLabelText('Capacity')).toHaveValue('50');
      expect(screen.getByLabelText('Start time')).toHaveValue('08:00');
      expect(screen.getByLabelText('Description and planning requirements')).toHaveValue('Updated morning programme');
      expect(screen.getByLabelText('Reason for change')).toHaveValue('Move the event to the morning');
      expect(screen.queryByText('Current event details')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Event name').closest('label')).toHaveClass('changed');
      expect(screen.getByLabelText('Event name').closest('label')).toHaveTextContent('Original: Gala');
      expect(screen.getByLabelText('Capacity').closest('label')).toHaveClass('changed');
      expect(screen.getByLabelText('Capacity').closest('label')).toHaveTextContent('Original: 10');
      expect(screen.getByLabelText('Start date').closest('label')).toHaveTextContent('Original: 2026-10-01');
      expect(screen.getByLabelText('Start time').closest('label')).toHaveTextContent('Original: 09:00');
      expect(screen.getByLabelText('Event type').closest('label')).not.toHaveClass('changed');
      expect(screen.getByLabelText('Event type').closest('label')).not.toHaveTextContent('Original:');
      expect(within(screen.getByRole('form', { name: 'Event change request details' })).getByText('Pending')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
      expect(screen.queryByRole('form', { name: 'Event change request details' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View' })).toHaveAttribute('aria-expanded', 'false');
    });

  tc('FE-COORD-033', 'CoordinatorAssignment (event change request tab)', 'The coordinator has no assigned change requests.',
    '"No event change requests found." is shown.', { kind: 'Edge', steps: '1. Open Event Change Request with an empty response.' },
    async () => {
      coordinatorBackend((url) => url.endsWith('/event-change-requests') ? json([]) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      expect(await screen.findByText('No event change requests found.')).toBeInTheDocument();
    });

  tc('FE-COORD-036', 'CoordinatorAssignment (event change request ordering)', 'Requests have mixed review statuses.',
    'Pending requests appear first, followed by Approved and then Rejected requests.',
    { pre: 'The backend returns Rejected, Approved and Pending requests in that order.', steps: '1. Open Event Change Request. 2. Inspect the request list order.' },
    async () => {
      const requests = [
        changeReq({ id: 13, review_status: 'Rejected', proposal: { event_name: 'Rejected request' } }),
        changeReq({ id: 12, review_status: 'Approved', proposal: { event_name: 'Approved request' } }),
        changeReq({ id: 11, review_status: 'Pending', proposal: { event_name: 'Pending request' } }),
      ];
      coordinatorBackend((url) => url.endsWith('/event-change-requests') ? json(requests) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      await screen.findByText('Pending request');
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
        'Pending request',
        'Approved request',
        'Rejected request',
      ]);
    });

  tc('FE-COORD-034', 'CoordinatorAssignment (event change request review)', 'The assigned coordinator approves a pending change request.',
    'The approved decision is saved, shown in the list, and the proposed event values are reflected in the expanded form.',
    { steps: '1. Open Event Change Request. 2. Expand a pending request. 3. Click Approve.' },
    async () => {
      const f = coordinatorBackend((url, options) => url.endsWith('/event-change-requests')
        ? json([changeReq()])
        : url.endsWith('/review') && options.method === 'PATCH'
          ? json({
            id: 11, event_id: 1, organiser_id: 'o1', coordinator_id: 'c1',
            review_status: 'Approved', reviewed_by: 'c1', reviewed_at: '2026-10-04T00:00:00Z',
            review_comments: null, event: ev({ event_title: 'Morning Gala', event_name: 'Morning Gala', event_status: 'Approved' }),
            proposal: changeReq().proposal,
          })
          : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('Change request approved and event details updated.')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Morning Gala Olly Approved/ })).toBeInTheDocument();
      expect(screen.getByLabelText('Event name')).toHaveValue('Morning Gala');
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      const [url, options] = callsTo(f, '/event-change-requests/11/review', 'PATCH')[0];
      expect(url).toContain('/api/event-change-requests/11/review');
      expect(JSON.parse(options.body)).toEqual({ decision: 'Approved', review_comments: null });
    });

  tc('FE-COORD-035', 'CoordinatorAssignment (event change request review)', 'The assigned coordinator rejects a request with a reason.',
    'Reject is unavailable until a reason is entered; the decision and reason are saved and displayed.',
    { steps: '1. Open and expand a pending request. 2. Enter a rejection reason. 3. Click Reject.' },
    async () => {
      const f = coordinatorBackend((url, options) => url.endsWith('/event-change-requests')
        ? json([changeReq()])
        : url.endsWith('/review') && options.method === 'PATCH'
          ? json({
            id: 11, event_id: 1, organiser_id: 'o1', coordinator_id: 'c1',
            review_status: 'Rejected', reviewed_by: 'c1', reviewed_at: '2026-10-04T00:00:00Z',
            review_comments: 'Please revise the timeline.',
          })
          : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
      fireEvent.change(screen.getByRole('textbox', { name: 'Reason for rejection' }), {
        target: { value: 'Please revise the timeline.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      expect(await screen.findByText('Change request rejected.')).toBeInTheDocument();
      expect(screen.getByText('Decision reason:')).toBeInTheDocument();
      expect(screen.getByText('Please revise the timeline.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
      const [, options] = callsTo(f, '/event-change-requests/11/review', 'PATCH')[0];
      expect(JSON.parse(options.body)).toEqual({
        decision: 'Rejected',
        review_comments: 'Please revise the timeline.',
      });
    });

  tc('FE-COORD-037', 'CoordinatorAssignment (event change request review)', 'The review endpoint fails without a detail message.',
    'A fallback error is shown and the pending request remains available for review.',
    { kind: 'Negative', steps: '1. Open and expand a pending request. 2. Click Approve. 3. Return HTTP 500 without detail.' },
    async () => {
      coordinatorBackend((url, options) => url.endsWith('/event-change-requests')
        ? json([changeReq()])
        : url.endsWith('/review') && options.method === 'PATCH'
          ? json({}, 500)
          : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the change request decision.');
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    });

  tc('FE-COORD-038', 'CoordinatorAssignment (event change request review)', 'The review endpoint cannot be reached.',
    'A network error is shown and the pending request remains available for review.',
    { kind: 'Negative', steps: '1. Open and expand a pending request. 2. Click Approve. 3. Reject the network request.' },
    async () => {
      coordinatorBackend((url, options) => {
        if (url.endsWith('/event-change-requests')) return json([changeReq()]);
        if (url.endsWith('/review') && options.method === 'PATCH') throw new Error('Failed to fetch');
        return null;
      });
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Unable to save the change request decision. (Failed to fetch)',
      );
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    });
  // ---- Stories 10.2 and 44.4: significant changes and change-request processing ----
  const significantImpact = (o = {}) => ({
    change_type: 'Significant', significant_fields: ['start_time', 'end_time'], affects_venue: true, affects_equipment: true,
    venue_requests: [{ request_id: 5, status: 'Approved' }], equipment_requests: [{ request_id: 9, status: 'Approved' }], ...o,
  });
  const ordinaryImpact = { change_type: 'Ordinary', significant_fields: [], affects_venue: false, affects_equipment: false, venue_requests: [], equipment_requests: [] };
  const openChangeRequests = async (requests, extra) => {
    const f = coordinatorBackend((url, options) => (extra && extra(url, options)) || (url.endsWith('/event-change-requests') ? json(requests) : null));
    render(<CoordinatorAssignment user={COORDINATOR} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
    return f;
  };
  const viewRequest = async (name) => {
    fireEvent.click(within(await screen.findByRole('row', { name: new RegExp(name) })).getByRole('button', { name: 'View' }));
    return screen.getByRole('form', { name: 'Event change request details' });
  };

  tc('FE-COORD-039', 'CoordinatorAssignment (change request significance)', 'An organiser edits a change request proposal.',
    'An ordinary-edit note shows until a schedule or capacity field changes; a Significant change note then names the fields and the arrangements that would return to Pending.',
    { data: 'name edit; start time 09:00 → 10:00; capacity 10 → 100', steps: '1. Open Request changes. 2. Edit the name. 3. Edit the start time. 4. Restore it and edit the capacity.' },
    async () => {
      mockFetch(() => json([ev({ event_status: 'Confirmed', coordinator_name: 'Zed' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
      expect(screen.getByText('Ordinary edit: venue and equipment arrangements are not affected.')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Gala Night' } });
      expect(screen.getByText('Ordinary edit: venue and equipment arrangements are not affected.')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
      expect(screen.getByText(/\(Start time\)\. If approved, any venue booking and equipment requests for this event will return to Pending for re-review\./)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
      fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '100' } });
      expect(screen.getByText(/\(Capacity\)\. If approved, any venue booking for this event will return to Pending for re-review\./)).toBeInTheDocument();
    });

  tc('FE-COORD-040', 'CoordinatorAssignment (organiser status)', 'Approved change requests carry a significant-change classification.',
    'The decision column shows the change type with its processing state; an unknown processing state shows the type only.',
    { data: 'Significant/Awaiting processing; Ordinary/Not required; Significant/Processed; Significant/none', steps: '1. Render events whose latest change requests have each classification.' },
    async () => {
      const approved = (title, change_type, processing_status) => ev({
        id: title, event_title: title, event_status: 'Confirmed', coordinator_name: 'Zed',
        latest_change_request: { review_status: 'Approved', change_type, processing_status },
      });
      mockFetch(() => json([
        approved('Awaiting gala', 'Significant', 'Awaiting processing'), approved('Ordinary gala', 'Ordinary', 'Not required'),
        approved('Processed gala', 'Significant', 'Processed'), approved('Legacy gala', 'Significant', null),
      ]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      await screen.findByText('Awaiting gala');
      const row = (title) => screen.getByText(title).closest('tr');
      expect(within(row('Awaiting gala')).getByText('Significant change · awaiting coordinator processing')).toBeInTheDocument();
      expect(within(row('Ordinary gala')).getByText('Ordinary change · no processing needed')).toBeInTheDocument();
      expect(within(row('Processed gala')).getByText('Significant change · processed')).toBeInTheDocument();
      expect(within(row('Legacy gala')).getByText('Significant change')).toBeInTheDocument();
    });

  tc('FE-COORD-041', 'CoordinatorAssignment (change history)', "A user opens an event's change history from the status table.",
    'History loads /events/<id>/change-log into a row under the event and becomes Hide history; clicking again closes it.',
    { steps: '1. Click History for an event. 2. Wait for the history. 3. Click Hide history.' },
    async () => {
      const f = mockFetch((url) => url.includes('/change-log')
        ? json([{ id: 1, change_type: 'Significant', created_at: '2026-10-05T00:00:00Z', changed_fields: ['start_time'], significant_fields: ['start_time'],
          previous_values: { start_time: '09:00:00' }, new_values: { start_time: '10:00:00' } }])
        : json([ev({ event_status: 'Confirmed', coordinator_name: 'Zed' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      const button = await screen.findByRole('button', { name: 'Change history for Gala' });
      expect(button).toHaveTextContent('History');
      fireEvent.click(button);
      expect(await screen.findByRole('list', { name: 'Event change history' })).toBeInTheDocument();
      expect(callsTo(f, '/events/1/change-log')).toHaveLength(1);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveTextContent('Hide history');
      fireEvent.click(button);
      expect(screen.queryByRole('list', { name: 'Event change history' })).toBeNull();
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

  tc('FE-COORD-042', 'CoordinatorAssignment (event change request tab)', 'Change requests have different impacts and processing states.',
    'The Impact column shows a Significant or Ordinary badge (— when unknown) and the Processing column shows the processing state (— when none).',
    { steps: '1. Open Event Change Request with a significant pending, an ordinary approved and a legacy approved request.' },
    async () => {
      await openChangeRequests([
        changeReq({ id: 11, impact: significantImpact(), proposal: { event_name: 'Moved gala' } }),
        changeReq({ id: 12, review_status: 'Approved', processing_status: 'Not required', impact: ordinaryImpact, proposal: { event_name: 'Renamed gala' } }),
        changeReq({ id: 13, review_status: 'Approved', proposal: { event_name: 'Legacy gala' } }),
      ]);
      const cells = (name) => within(screen.getByRole('row', { name: new RegExp(name) })).getAllByRole('cell').map((cell) => cell.textContent);
      await screen.findByText('Moved gala');
      expect(cells('Moved gala').slice(3, 5)).toEqual(['Significant', '—']);
      expect(cells('Renamed gala').slice(3, 5)).toEqual(['Ordinary', 'Not required']);
      expect(cells('Legacy gala').slice(3, 5)).toEqual(['—', '—']);
      expect(screen.getByText('Significant')).toHaveClass('change-badge', 'significant');
      expect(screen.getByText('Ordinary')).toHaveClass('change-badge', 'ordinary');
    });

  tc('FE-COORD-043', 'CoordinatorAssignment (event change request detail)', 'A coordinator reviews pending requests with different impacts.',
    'A significant request names its fields and the live venue booking and equipment request that approval returns to Pending; one with no live requests says nothing will be reopened; an ordinary request says arrangements are unaffected.',
    { steps: '1. Expand each pending request and read its impact note.' },
    async () => {
      await openChangeRequests([
        changeReq({ id: 11, impact: significantImpact(), proposal: { event_name: 'Moved gala' } }),
        changeReq({ id: 12, impact: significantImpact({ significant_fields: ['event_capacity'], affects_equipment: false, venue_requests: [], equipment_requests: [] }), proposal: { event_name: 'Bigger gala' } }),
        changeReq({ id: 13, impact: ordinaryImpact, proposal: { event_name: 'Renamed gala' } }),
      ]);
      expect(within(await viewRequest('Moved gala')).getByText(/\(Start time, End time\)\. Approving returns venue booking #5, equipment request #9 to Pending for re-review\./)).toBeInTheDocument();
      expect(within(await viewRequest('Bigger gala')).getByText(/\(Capacity\)\. This event has no live venue or equipment requests for it to reopen yet\./)).toBeInTheDocument();
      expect(within(await viewRequest('Renamed gala')).getByText('Ordinary edit: venue and equipment arrangements are not affected.')).toBeInTheDocument();
    });

  tc('FE-COORD-044', 'CoordinatorAssignment (event change request review)', 'The coordinator approves a significant change request.',
    'The message says affected requests are back to Pending and need processing; the row shows Awaiting processing and the detail offers Process change, naming the requests it replaces.',
    { steps: '1. Expand a significant pending request. 2. Click Approve.' },
    async () => {
      await openChangeRequests([changeReq({ impact: significantImpact() }), changeReq({ id: 12, proposal: { event_name: 'Other gala' } })], (url, options) => url.endsWith('/review') && options.method === 'PATCH'
        ? json({ id: 11, review_status: 'Approved', change_type: 'Significant', significant_fields: ['start_time', 'end_time'], affects_venue: true, affects_equipment: true, processing_status: 'Awaiting processing' })
        : null);
      await viewRequest('Morning Gala');
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText(/Affected venue and equipment requests are back to Pending; process the change to re-initiate them\./)).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Other gala Olly Pending/ })).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Morning Gala Olly Approved Significant Awaiting processing/ })).toBeInTheDocument();
      expect(screen.getByText(/Processing replaces venue booking #5, equipment request #9 with new Pending requests linked to this change request/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Process change' })).toBeEnabled();
    });

  tc('FE-COORD-045', 'CoordinatorAssignment (event change request review)', 'The coordinator approves an ordinary change request that had no impact preview.',
    'The standard approval message is shown and the detail says no processing is needed.',
    { kind: 'Edge', data: 'response change_type Ordinary, processing_status Not required, no field list', steps: '1. Expand a pending request without impact. 2. Click Approve.' },
    async () => {
      await openChangeRequests([changeReq()], (url, options) => url.endsWith('/review') && options.method === 'PATCH'
        ? json({ id: 11, review_status: 'Approved', change_type: 'Ordinary', processing_status: 'Not required' })
        : null);
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('Change request approved and event details updated.')).toBeInTheDocument();
      expect(screen.getByText('Ordinary edit: venue and equipment arrangements are not affected, so no processing is needed.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Process change' })).toBeNull();
    });

  tc('FE-COORD-046', 'CoordinatorAssignment (event change request processing)', 'The coordinator processes an approved significant change request.',
    'POST /event-change-requests/<id>/process is sent; the request shows Processed with its date and the summary of the new linked requests, and a success message is shown.',
    { steps: '1. Expand an approved request awaiting processing. 2. Click Process change.' },
    async () => {
      const summary = 'Venue booking #5 replaced by #31. Equipment request #9 replaced by #32.';
      const f = await openChangeRequests(
        [changeReq({ review_status: 'Approved', processing_status: 'Awaiting processing', impact: significantImpact() }), changeReq({ id: 12, proposal: { event_name: 'Other gala' } })],
        (url, options) => url.endsWith('/process') && options.method === 'POST'
          ? json({ change_request: { id: 11, processing_status: 'Processed', processed_at: '2026-10-05T10:00:00Z', processing_summary: summary },
            venue_requests: [{ request_id: 31, previous_request_id: 5 }], equipment_requests: [{ request_id: 32, previous_request_id: 9 }] })
          : null,
      );
      await viewRequest('Morning Gala');
      fireEvent.click(screen.getByRole('button', { name: 'Process change' }));
      expect(await screen.findByText(`Change request processed. ${summary}`)).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Other gala Olly Pending/ })).toBeInTheDocument();
      expect(screen.getByText('Change processed on 2026-10-05.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Process change' })).toBeNull();
      expect(screen.getByRole('row', { name: /Morning Gala Olly Approved Significant Processed/ })).toBeInTheDocument();
      expect(callsTo(f, '/event-change-requests/11/process', 'POST')).toHaveLength(1);
    });

  tc('FE-COORD-047', 'CoordinatorAssignment (event change request processing)', 'Processing fails.',
    'While in flight the button reads Processing... and is disabled; then the backend detail, a fallback message or the network error is shown and the request stays Awaiting processing.',
    { kind: 'Negative', data: '409 "This change request has already been processed."; 500 without detail; network failure', steps: '1. Click Process change once for each failure.' },
    async () => {
      let respond;
      const responses = [
        () => new Promise((resolve) => { respond = resolve; }),
        () => json({}, 500),
        () => { throw new Error('Failed to fetch'); },
      ];
      await openChangeRequests(
        [changeReq({ review_status: 'Approved', processing_status: 'Awaiting processing', impact: significantImpact({ venue_requests: [], equipment_requests: [] }) })],
        (url, options) => url.endsWith('/process') && options.method === 'POST' ? responses.shift()() : null,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'View' }));
      expect(screen.getByText(/None of the affected venue or equipment requests are live, so processing only records the change as handled\./)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Process change' }));
      expect(await screen.findByRole('button', { name: 'Processing...' })).toBeDisabled();
      respond(json({ detail: 'This change request has already been processed.' }, 409));
      expect(await screen.findByRole('alert')).toHaveTextContent('This change request has already been processed.');
      fireEvent.click(screen.getByRole('button', { name: 'Process change' }));
      expect(await screen.findByText('Could not process the change request.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Process change' }));
      expect(await screen.findByText('Unable to process the change request. (Failed to fetch)')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Awaiting processing/ })).toBeInTheDocument();
    });

  tc('FE-COORD-048', 'CoordinatorAssignment (event change request detail)', 'A processed request has no recorded processing time.',
    '"Change processed." is shown with its summary.', { kind: 'Edge', steps: '1. Expand a processed request without processed_at.' },
    async () => {
      await openChangeRequests([changeReq({ review_status: 'Approved', processing_status: 'Processed', processing_summary: 'No active venue booking needed a new request.' })]);
      const detail = await viewRequest('Morning Gala');
      expect(within(detail).getByText('Change processed.')).toBeInTheDocument();
      expect(within(detail).getByText(/No active venue booking needed a new request\./)).toBeInTheDocument();
    });

  tc('FE-COORD-049', 'CoordinatorAssignment (coordinator view)', 'Loading change requests fails, then the coordinator returns to Event management.',
    "The load error is shown; Event management reloads the coordinator's events and clears the error.",
    { kind: 'Negative', steps: '1. Return HTTP 500 for /event-change-requests. 2. Open Event Change Request. 3. Click Event management.' },
    async () => {
      const f = coordinatorBackend((url) => url.endsWith('/event-change-requests') ? json({}, 500) : null);
      render(<CoordinatorAssignment user={COORDINATOR} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Event Change Request' }));
      expect(await screen.findByText('Unable to load event change requests. (Backend returned 500)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Event management' }));
      expect(await screen.findByRole('heading', { name: 'Event management', level: 1 })).toBeInTheDocument();
      await waitFor(() => expect(callsTo(f, '/api/events')).toHaveLength(2));
      await waitFor(() => expect(screen.queryByText(/Unable to load event change requests/)).toBeNull());
    });

  tc('FE-COORD-050', 'CoordinatorAssignment (event change request tab)', 'Change requests arrive with missing details.',
    'Fallbacks are shown: the event title or "Request #<id>", the organiser email or "Unknown organiser", Pending for a missing status, "Not recorded" for a missing date; unknown statuses sort last and the detail form opens with empty fields.',
    { kind: 'Edge', data: 'no proposal, organiser name, status or date; an unknown status "Withdrawn" with no event', steps: '1. Open Event Change Request. 2. Inspect the rows. 3. Expand the request without an event.' },
    async () => {
      await openChangeRequests([
        { id: 22, review_status: 'Withdrawn' },
        { id: 21, organiser_email: 'o@x', event: ev({ event_title: 'Fallback gala', event_name: undefined, event_end_date: undefined }) },
      ]);
      await screen.findByText('Fallback gala');
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
        ['Fallback gala', 'o@x', 'Pending', '—', '—', 'Not recorded', 'View'],
        ['Request #22', 'Unknown organiser', 'Withdrawn', '—', '—', 'Not recorded', 'View'],
      ]);
      const detail = await viewRequest('Request #22');
      expect(within(detail).getByText('Submitted by the event organiser for coordinator review.')).toBeInTheDocument();
      expect(within(detail).getByLabelText('Event name')).toHaveValue('');
      expect(within(detail).getByLabelText('Reason for change')).toHaveValue('');
      expect(within(detail).queryByRole('button', { name: 'Approve' })).toBeNull();
      const fallback = await viewRequest('Fallback gala');
      expect(within(fallback).getByRole('heading', { level: 2 })).toHaveTextContent('Event change request: Fallback gala');
      expect(within(fallback).getByLabelText('Event name').closest('label')).toHaveTextContent('Original: Fallback gala');
    });

});
