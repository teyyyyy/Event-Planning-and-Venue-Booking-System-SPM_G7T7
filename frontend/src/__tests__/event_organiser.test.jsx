import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import EventOrganiser from '../event_organiser';

const row = (o = {}) => ({ id: 1, event_name: 'Gala', event_type: 'Workshop', event_date: '2026-10-01', event_end_date: '2026-10-01', event_capacity: 50, description: 'd', start_time: '09:00:00', end_time: '17:00:00', status: 'Submitted', ...o });
const field = (name) => document.querySelector(`[name=${name}]`);
const form = () => document.querySelector('form.request-form');

function fillForm(o = {}) {
  const values = { event_name: 'Gala', event_type: 'Workshop', event_date: '2026-10-01', event_end_date: '2026-10-01', event_capacity: '50', start_time: '09:00', end_time: '17:00', description: 'desc', ...o };
  Object.entries(values).forEach(([name, value]) => fireEvent.change(field(name), { target: { value } }));
}

// GET /submitted-requests returns `list`; every other call is handled by `other`.
const backend = (list = [], other = () => json({})) =>
  mockFetch((url, o) => (url.endsWith('/submitted-requests') ? json(list) : other(url, o)));

describe('EventOrganiser', () => {
  tc('FE-ORG-001', 'EventOrganiser', 'The organiser page opens.', 'A loading row shows first, then the organiser\'s requests with name, capacity, type, dates and status.',
    { pre: 'Backend returns one request.', steps: '1. Render. 2. Wait for the table.' },
    async () => {
      backend([row()]);
      render(<EventOrganiser />);
      expect(screen.getByText('Loading events for this organiser...')).toBeInTheDocument();
      expect(await screen.findByText('Gala')).toBeInTheDocument();
      expect(screen.getByText('50 attendee capacity')).toBeInTheDocument();
      expect(screen.getByText('Submitted')).toBeInTheDocument();
    });

  tc('FE-ORG-002', 'EventOrganiser', 'No requests exist for the organiser.', '"No submitted event requests found for this organiser." is shown.', { kind: 'Edge', steps: '1. Render with an empty list.' },
    async () => { backend([]); render(<EventOrganiser />); expect(await screen.findByText('No submitted event requests found for this organiser.')).toBeInTheDocument(); });

  tc('FE-ORG-003', 'EventOrganiser', 'Loading the requests fails.', 'The message "Unable to load event requests." is shown.', { kind: 'Negative', steps: '1. Return 500. 2. Render.' },
    async () => { mockFetch(() => json({}, 500)); render(<EventOrganiser />); expect(await screen.findByText('Unable to load event requests.')).toBeInTheDocument(); });

  tc('FE-ORG-004', 'EventOrganiser', 'A multi-day request is listed.', 'The date column shows "<start> to <end>" followed by the time range.', { data: '2026-10-01 to 2026-10-03', steps: '1. Render with a multi-day request.' },
    async () => { backend([row({ event_end_date: '2026-10-03' })]); render(<EventOrganiser />); expect(await screen.findByText(/2026-10-01 to 2026-10-03/)).toBeInTheDocument(); });

  tc('FE-ORG-005', 'EventOrganiser (form)', 'The form renders in create mode.', 'Heading "Create event request", "Submit request" and "Save draft" buttons are shown.', { steps: '1. Render.' },
    async () => {
      backend([]);
      render(<EventOrganiser />);
      expect(await screen.findByRole('heading', { name: 'Create event request' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit request' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    });

  tc('FE-ORG-006', 'EventOrganiser (submit)', 'A valid request is submitted.', 'POST /requests/submit is sent with capacity as a number, the success dialog appears and the form is cleared.',
    { data: 'Gala, Workshop, 2026-10-01 09:00-17:00, capacity 50', steps: '1. Fill in all fields. 2. Submit the form.' },
    async () => {
      const f = backend([], () => json({ id: 9 }));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.submit(form());
      expect(await screen.findByText('Event request submitted successfully and added to the table.')).toBeInTheDocument();
      const [, options] = callsTo(f, '/requests/submit', 'POST')[0];
      expect(JSON.parse(options.body)).toMatchObject({ event_name: 'Gala', event_capacity: 50, start_time: '09:00' });
      expect(field('event_name')).toHaveValue('');
    });

  tc('FE-ORG-007', 'EventOrganiser (submit)', 'End date is before the start date.', 'An error dialog "End date cannot be before the start date." appears and no request is sent.', { kind: 'Negative', data: 'start 2026-10-05, end 2026-10-01', steps: '1. Fill in reversed dates. 2. Submit.' },
    async () => {
      const f = backend([]);
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm({ event_date: '2026-10-05', event_end_date: '2026-10-01' });
      fireEvent.submit(form());
      expect(await screen.findByText('End date cannot be before the start date.')).toBeInTheDocument();
      expect(callsTo(f, '/requests/submit')).toHaveLength(0);
    });

  tc('FE-ORG-008', 'EventOrganiser (submit)', 'A single-day event ends at or before its start time.', 'Error "End time must be later than the start time." and no request.', { kind: 'Negative', data: '09:00-09:00', steps: '1. Fill in equal times. 2. Submit.' },
    async () => {
      const f = backend([]);
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm({ start_time: '09:00', end_time: '09:00' });
      fireEvent.submit(form());
      expect(await screen.findByText('End time must be later than the start time.')).toBeInTheDocument();
      expect(callsTo(f, '/requests/submit')).toHaveLength(0);
    });

  tc('FE-ORG-009', 'EventOrganiser (submit)', 'Multi-day event ends earlier in the day than it starts.', 'The schedule check passes and the request is sent.', { kind: 'Edge', data: '10-01 09:00 to 10-03 08:00', steps: '1. Fill in a multi-day range with an earlier end time. 2. Submit.' },
    async () => {
      const f = backend([], () => json({ id: 1 }));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm({ event_end_date: '2026-10-03', end_time: '08:00' });
      fireEvent.submit(form());
      await waitFor(() => expect(callsTo(f, '/requests/submit', 'POST')).toHaveLength(1));
    });

  tc('FE-ORG-010', 'EventOrganiser (submit)', 'The backend rejects the submission.', 'An error dialog "Submission unsuccessful" shows the backend detail and the form keeps its values.',
    { kind: 'Negative', data: '400 "Event date cannot be in the past."', steps: '1. Return 400. 2. Submit a filled form.' },
    async () => {
      backend([], () => json({ detail: 'Event date cannot be in the past.' }, 400));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.submit(form());
      expect(await screen.findByText('Submission unsuccessful')).toBeInTheDocument();
      expect(screen.getByText('Event date cannot be in the past.')).toBeInTheDocument();
      expect(field('event_name')).toHaveValue('Gala');
    });

  tc('FE-ORG-011', 'EventOrganiser (submit)', 'The backend cannot be reached.', 'The dialog says "Cannot reach the backend at <url>. Start FastAPI and try again."', { kind: 'Negative', steps: '1. Make the POST reject. 2. Submit.' },
    async () => {
      backend([], () => { throw new TypeError('Failed to fetch'); });
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.submit(form());
      expect(await screen.findByText(/Cannot reach the backend at/)).toBeInTheDocument();
    });

  tc('FE-ORG-012', 'EventOrganiser (submit)', 'The submission succeeds but refreshing the list fails.', 'Dialog: "Event was submitted, but the refreshed event list could not be loaded."', { kind: 'Negative', steps: '1. Let the POST succeed but the second list load return 500. 2. Submit.' },
    async () => {
      let lists = 0;
      mockFetch((url) => { if (url.endsWith('/submitted-requests')) { lists += 1; return lists === 1 ? json([]) : json({}, 500); } return json({ id: 1 }); });
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.submit(form());
      expect(await screen.findByText('Event was submitted, but the refreshed event list could not be loaded.')).toBeInTheDocument();
    });

  tc('FE-ORG-013', 'EventOrganiser (draft)', 'Organiser clicks "Save draft".', 'POST /requests (not /submit) is sent and a "Draft saved" dialog appears.', { steps: '1. Fill in the form. 2. Click "Save draft".' },
    async () => {
      const f = backend([], () => json({ id: 3 }));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(await screen.findByText('Draft saved')).toBeInTheDocument();
      expect(callsTo(f, '/requests', 'POST').filter(([u]) => !u.endsWith('/submit'))).toHaveLength(1);
    });

  tc('FE-ORG-014', 'EventOrganiser (draft)', 'The backend rejects the draft.', 'Error dialog with the backend detail.', { kind: 'Negative', data: '400 "Use a valid event date and time."', steps: '1. Return 400. 2. Click "Save draft".' },
    async () => {
      backend([], () => json({ detail: 'Use a valid event date and time.' }, 400));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(await screen.findByText('Use a valid event date and time.')).toBeInTheDocument();
    });

  tc('FE-ORG-015', 'EventOrganiser (row actions)', 'Rows in Submitted and Draft status are listed.', 'Submitted rows show only Edit; Draft rows show Submit and Edit.', { data: 'Submitted, Draft, Approved', steps: '1. Render three requests.' },
    async () => {
      backend([row({ id: 1, event_name: 'Sub', status: 'Submitted' }), row({ id: 2, event_name: 'Dra', status: 'Draft' }), row({ id: 3, event_name: 'App', status: 'Approved' })]);
      render(<EventOrganiser />);
      await screen.findByText('Sub');
      const buttons = (n) => Array.from(screen.getByText(n).closest('tr').querySelectorAll('button')).map((b) => b.textContent);
      expect(buttons('Sub')).toEqual(['Edit']);
      expect(buttons('Dra')).toEqual(['Submit', 'Edit']);
      expect(buttons('App')).toEqual([]);
    });

  tc('FE-ORG-016', 'EventOrganiser (row actions)', 'Organiser clicks Submit on a Draft row.', 'POST /requests/<id>/submit is sent and "Event request submitted successfully." is shown.', { steps: '1. Render a draft. 2. Click its "Submit".' },
    async () => {
      const f = backend([row({ status: 'Draft' })], () => json({ id: 1 }));
      render(<EventOrganiser />);
      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      expect(await screen.findByText('Event request submitted successfully.')).toBeInTheDocument();
      expect(callsTo(f, '/requests/1/submit', 'POST')).toHaveLength(1);
    });

  tc('FE-ORG-017', 'EventOrganiser (row actions)', 'The row Submit call is rejected.', 'Error dialog with the backend detail.', { kind: 'Negative', steps: '1. Return 400 for the submit. 2. Click "Submit" on a draft.' },
    async () => {
      backend([row({ status: 'Draft' })], () => json({ detail: 'Only completed draft requests can be submitted.' }, 400));
      render(<EventOrganiser />);
      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
      expect(await screen.findByText('Only completed draft requests can be submitted.')).toBeInTheDocument();
    });

  tc('FE-ORG-018', 'EventOrganiser (edit)', 'Organiser clicks Edit on a Submitted row.', 'The form switches to "Update event request", loads the row values (times as HH:MM) and hides "Save draft".', { steps: '1. Render a submitted request. 2. Click "Edit".' },
    async () => {
      window.scrollTo = vi.fn();
      backend([row()]);
      render(<EventOrganiser />);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      expect(screen.getByRole('heading', { name: 'Update event request' })).toBeInTheDocument();
      expect(field('event_name')).toHaveValue('Gala');
      expect(field('start_time')).toHaveValue('09:00');
      expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    });

  tc('FE-ORG-019', 'EventOrganiser (edit)', 'Organiser saves changes to an existing request.', 'PUT /requests/<id> is sent with the edited values and "Event request updated successfully." is shown.', { data: 'event_name = "Gala 2"', steps: '1. Click "Edit". 2. Change the name. 3. Click "Save changes".' },
    async () => {
      window.scrollTo = vi.fn();
      const f = backend([row()], () => json({ id: 1 }));
      render(<EventOrganiser />);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      fireEvent.change(field('event_name'), { target: { value: 'Gala 2' } });
      fireEvent.submit(form());
      expect(await screen.findByText('Event request updated successfully.')).toBeInTheDocument();
      const [, options] = callsTo(f, '/requests/1', 'PUT')[0];
      expect(JSON.parse(options.body)).toMatchObject({ event_name: 'Gala 2', event_capacity: 50 });
    });

  tc('FE-ORG-020', 'EventOrganiser (edit)', 'Saving changes is rejected.', 'Error dialog with the backend detail; still in edit mode.', { kind: 'Negative', data: '403 "This event request cannot be updated during its current status."', steps: '1. Click "Edit". 2. Return 403 on PUT. 3. Save.' },
    async () => {
      window.scrollTo = vi.fn();
      backend([row()], () => json({ detail: 'This event request cannot be updated during its current status.' }, 403));
      render(<EventOrganiser />);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      fireEvent.submit(form());
      expect(await screen.findByText('This event request cannot be updated during its current status.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Update event request' })).toBeInTheDocument();
    });

  tc('FE-ORG-021', 'EventOrganiser (editingEvent prop)', 'A coordinator opens an event for editing (event from the status view).', 'The form is pre-filled (event_title used as name, end date defaults to start date) and onEditComplete is called.',
    { data: 'editingEvent = {id: 4, event_title: "Gala", event_date: "2026-10-01"}', steps: '1. Render with editingEvent.' },
    async () => {
      const onEditComplete = vi.fn();
      backend([]);
      render(<EventOrganiser editingEvent={{ id: 4, event_title: 'Gala', event_date: '2026-10-01', event_capacity: 25 }} onEditComplete={onEditComplete} />);
      await waitFor(() => expect(field('event_name')).toHaveValue('Gala'));
      expect(field('event_end_date')).toHaveValue('2026-10-01');
      expect(screen.getByRole('heading', { name: 'Update event request' })).toBeInTheDocument();
      expect(onEditComplete).toHaveBeenCalled();
    });

  tc('FE-ORG-022', 'EventOrganiser (notice)', 'The user closes the result dialog.', 'The dialog and backdrop disappear.', { kind: 'State', steps: '1. Trigger an error dialog. 2. Click "Close".' },
    async () => {
      backend([], () => json({ detail: 'Nope' }, 400));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.submit(form());
      await screen.findByRole('alertdialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

  tc('FE-ORG-023', 'EventOrganiser (in-flight)', 'A submission is in progress.', 'The status overlay reads "Submitting event..." and the form buttons are disabled.', { kind: 'State', pre: 'POST never resolves.', steps: '1. Submit. 2. Inspect the UI.' },
    async () => {
      mockFetch((url) => (url.endsWith('/submitted-requests') ? json([]) : new Promise(() => {})));
      render(<EventOrganiser />);
      await screen.findByText('No submitted event requests found for this organiser.');
      fillForm();
      fireEvent.submit(form());
      expect(await screen.findByText('Submitting event...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    });
});
