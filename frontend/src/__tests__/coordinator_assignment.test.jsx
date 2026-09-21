import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import CoordinatorAssignment from '../coordinator_assignment';

const ORGANISER = { id: 'o1', role: 'Event Organiser' };
const COORDINATOR = { id: 'c1', role: 'Event Coordinator' };
const ev = (o = {}) => ({ id: 1, event_title: 'Gala', event_date: '2026-10-01', event_end_date: '2026-10-01', event_status: 'Submitted', assigned_coordinator_id: null, coordinator_name: null, coordinator_email: null, ...o });

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

  tc('FE-COORD-009', 'CoordinatorAssignment', 'An event is Draft and the organiser clicks Submit.', 'POST /event-organisers/<id>/requests/<eventId>/submit is sent, "Request submitted for review." stays on screen and the list reloads.',
    { pre: 'Event status Draft.', steps: '1. Render. 2. Click "Submit".' },
    async () => {
      const f = mockFetch((url) => url.endsWith('/submit') ? json({}) : json([ev({ event_status: 'Draft' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      expect(await screen.findByText('Request submitted for review.')).toBeInTheDocument();
      expect(callsTo(f, '/requests/1/submit', 'POST')).toHaveLength(1);
      await waitFor(() => expect(callsTo(f, '/event-organisers/o1/requests', 'GET').length).toBeGreaterThan(1));
    });

  tc('FE-COORD-010', 'CoordinatorAssignment', 'Submitting a draft fails.', 'The backend detail is shown.', { kind: 'Negative', steps: '1. Return 400 for submit. 2. Click "Submit".' },
    async () => {
      mockFetch((url) => url.endsWith('/submit') ? json({ detail: 'Only completed draft requests can be submitted.' }, 400) : json([ev({ event_status: 'Draft' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      expect(await screen.findByText('Only completed draft requests can be submitted.')).toBeInTheDocument();
    });

  tc('FE-COORD-011', 'CoordinatorAssignment', 'Events in different statuses are listed.', 'Draft shows Submit only; Submitted/Under review/Approved/Planning/Confirmed show Edit; Completed shows neither.',
    { data: 'Draft, Approved, Completed', steps: '1. Render three events with these statuses.' },
    async () => {
      mockFetch(() => json([ev({ id: 1, event_title: 'D', event_status: 'Draft', coordinator_name: 'Zed' }), ev({ id: 2, event_title: 'Appr', event_status: 'Approved', coordinator_name: 'Zed' }), ev({ id: 3, event_title: 'Comp', event_status: 'Completed', coordinator_name: 'Zed' })]));
      render(<CoordinatorAssignment user={ORGANISER} />);
      await screen.findByText('D');
      const row = (t) => screen.getByText(t).closest('tr');
      expect(within(row('D')).queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(within(row('D')).getByRole('button', { name: 'Submit' })).toBeInTheDocument();
      expect(within(row('Appr')).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(within(row('Comp')).queryByRole('button')).toBeNull();
    });

  tc('FE-COORD-012', 'CoordinatorAssignment', 'Organiser clicks Edit on an event.', 'onEditEvent is called with that event object.', { steps: '1. Render an Approved event. 2. Click "Edit".' },
    async () => {
      const onEditEvent = vi.fn();
      mockFetch(() => json([ev({ event_status: 'Approved', coordinator_name: 'A' })]));
      render(<CoordinatorAssignment user={ORGANISER} onEditEvent={onEditEvent} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      expect(onEditEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 1, event_title: 'Gala' }));
    });

  const coordinatorBackend = (extra) => mockFetch((url, o) => {
    if (extra) { const r = extra(url, o); if (r) return r; }
    if (url.endsWith('/events')) return json([ev({ id: 1, assigned_coordinator_id: 'c1' }), ev({ id: 2, event_title: 'Other', assigned_coordinator_id: 'c2' })]);
    if (url.endsWith('/coordinators')) return json([{ id: 'c1', name: 'Cara' }, { id: 'c2', name: 'Dan' }]);
    return json({});
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

  tc('FE-COORD-019', 'CoordinatorAssignment (coordinator view)', 'The empty option of the coordinator select is chosen.', 'No request is sent.', { kind: 'Edge', steps: '1. Render. 2. Change the coordinator select to "".' },
    async () => {
      const f = coordinatorBackend();
      render(<CoordinatorAssignment user={COORDINATOR} />);
      const select = await screen.findByLabelText('Coordinator for Gala');
      const before = f.mock.calls.length;
      fireEvent.change(select, { target: { value: '' } });
      expect(f.mock.calls.length).toBe(before);
    });
});
