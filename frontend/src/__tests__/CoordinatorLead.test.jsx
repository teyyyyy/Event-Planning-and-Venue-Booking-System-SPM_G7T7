import React from 'react';
import { expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CoordinatorAssignment from '../coordinator_assignment';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

const lead = { id: 'lead', role: 'Event Coordinator Lead' };
const coordinators = [{ id: 'c1', name: 'Bob' }, { id: 'c2', name: 'Amy' }, { id: 'c3', name: 'Cat' }];
const event = (overrides = {}) => ({ id: 1, event_title: 'Gala', event_status: 'Confirmed', assigned_coordinator_id: 'c1', coordinator_name: 'Bob', ...overrides });
const workloads = [{ ...coordinators[0], active_event_count: 1 }, { ...coordinators[1], active_event_count: 0 }, { ...coordinators[2], active_event_count: 0 }];

function backend(patch = null) {
  let events = [event(), event({ id: 2, event_title: 'Workshop', assigned_coordinator_id: 'c2', coordinator_name: 'Amy' }), event({ id: 3, event_title: 'Unassigned gala', event_status: 'Submitted', assigned_coordinator_id: null, coordinator_name: null })];
  return mockFetch((url, options = {}) => {
    if (options.method === 'PATCH') {
      if (patch) return patch(url, options);
      const body = JSON.parse(options.body);
      const result = event({ assigned_coordinator_id: body.coordinator_id, coordinator_name: coordinators.find(c => c.id === body.coordinator_id).name });
      events = events.map(e => e.id === 1 ? result : e);
      return json(result);
    }
    if (url.includes('unassigned-queue')) return json(events.filter(e => !e.assigned_coordinator_id));
    if (url.endsWith('event-coordinator-lead/events')) return json(events);
    if (url.includes('coordinator-workloads')) return json(workloads);
    return json(coordinators);
  });
}

async function openActive() {
  render(<CoordinatorAssignment user={lead} />);
  await screen.findByText('Unassigned gala');
  fireEvent.click(screen.getByRole('button', { name: 'Active events', exact: true }));
  await screen.findByText('Gala', { exact: true });
}

async function review(target = 'c2') {
  const row = screen.getByText('Gala', { exact: true }).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: 'View details' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: target } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Review reassignment' }));
  return dialog;
}

tc('FE-COORD-071', 'Lead coordinator filter', 'Active events include multiple coordinators and an unassigned event.',
  'The Lead can view all events, each coordinator, zero results and unassigned events, alongside workloads.',
  { steps: '1. Open Active events. 2. Choose each filter. 3. Return to Unassigned events.' }, async () => {
    backend();
    await openActive();
    const filter = screen.getByRole('combobox', { name: 'View events by coordinator' });
    fireEvent.change(filter, { target: { value: 'c1' } });
    expect(screen.getByText('Gala')).toBeInTheDocument();
    expect(screen.queryByText('Workshop')).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'c2' } });
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    expect(screen.queryByText('Gala')).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'c3' } });
    expect(screen.getByText('No event requests found.')).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'unassigned' } });
    expect(screen.getByText('Unassigned gala')).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: '' } });
    expect(screen.getByText('Gala')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned events', exact: true }));
    expect(await screen.findByText('Unassigned gala')).toBeInTheDocument();
    expect(screen.queryByText('Gala')).not.toBeInTheDocument();
  });

tc('FE-COORD-072', 'Confirmed repeated reassignment', 'The Lead reviews an assigned event.',
  'No write occurs before confirmation; confirmation sends the expected owner, reports success and allows further reassignments.',
  { steps: '1. Reassign Bob to Amy. 2. Verify workloads in dropdown. 3. Reassign Amy to Cat. 4. Inspect requests.' }, async () => {
    const fetch = backend();
    await openActive();
    let dialog = await review();
    expect(within(dialog).getByRole('option', { name: 'Bob — 1 active event' })).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Amy — 0 active events' })).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Reassign Gala from Bob to Amy?');
    expect(callsTo(fetch, '/coordinator', 'PATCH')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    expect(await screen.findByText('Gala reassigned to Amy.')).toBeInTheDocument();
    await screen.findByText('Gala', { exact: true });
    expect(within(screen.getByText('Gala').closest('tr')).getByText('Confirmed')).toBeInTheDocument();
    dialog = await review('c3');
    expect(within(dialog).getByRole('status')).toHaveTextContent('from Amy to Cat');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    expect(await screen.findByText('Gala reassigned to Cat.')).toBeInTheDocument();
    const writes = callsTo(fetch, '/coordinator', 'PATCH');
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0][1].body)).toEqual({ coordinator_id: 'c2', expected_coordinator_id: 'c1' });
    expect(JSON.parse(writes[1][1].body)).toEqual({ coordinator_id: 'c3', expected_coordinator_id: 'c2' });
    expect(callsTo(fetch, 'coordinator-workloads')).toHaveLength(4);
  });

tc('FE-COORD-073', 'Reassignment cancellation', 'The Lead selects the current coordinator or cancels a reviewed change.',
  'Same-coordinator selection cannot be saved and cancellation makes no write; changing selection requires fresh review.',
  { steps: '1. Open details. 2. Inspect disabled save. 3. Review then change coordinator. 4. Review and cancel.' }, async () => {
    const fetch = backend();
    await openActive();
    fireEvent.click(within(screen.getByText('Gala').closest('tr')).getByRole('button', { name: 'View details' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Review reassignment' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    dialog = await review();
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'c3' } });
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review reassignment' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo(fetch, '/coordinator', 'PATCH')).toHaveLength(0);
  });

tc('FE-COORD-074', 'Assignment failures and retry', 'The server rejects a stale change and a later network request fails.',
  'The dialog retains the selection and shows the error; no success is reported; refresh is available after closing.',
  { kind: 'Negative', steps: '1. Return 409. 2. Fail retry at network. 3. Return empty 400. 4. Close and refresh.' }, async () => {
    const patch = vi.fn().mockResolvedValueOnce(json({ detail: 'The coordinator has changed. Refresh.' }, 409))
      .mockRejectedValueOnce(new Error('Network offline')).mockResolvedValueOnce(json({}, 400));
    backend(patch);
    await openActive();
    const dialog = await review();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The coordinator has changed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Network offline'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Assignment failed.'));
    expect(screen.queryByText('Gala reassigned to Amy.')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
    await screen.findByText('Gala', { exact: true });
  });

tc('FE-COORD-075', 'Pending reassignment', 'The server is still saving the reassignment.',
  'Save, coordinator choice, close, cancel and navigation are disabled to prevent duplicate or conflicting submissions.',
  { steps: '1. Hold PATCH response. 2. Confirm twice. 3. Resolve the request.' }, async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const patch = vi.fn(() => pending);
    backend(patch);
    await openActive();
    const dialog = await review();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    expect(within(dialog).getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(within(dialog).getByRole('combobox')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Active events', exact: true })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Saving...' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    finish(json(event({ assigned_coordinator_id: 'c2', coordinator_name: 'Amy' })));
    await screen.findByText('Gala reassigned to Amy.');
  });

tc('FE-COORD-076', 'Lead load failure', 'Workload loading fails.',
  'An error is shown and stale events cannot be assigned; refresh recovers.',
  { kind: 'Negative', steps: '1. Reject initial load. 2. Restore backend. 3. Refresh.' }, async () => {
    mockFetch(() => json({}, 503));
    render(<CoordinatorAssignment user={lead} />);
    expect(await screen.findByText(/Unable to load event assignments/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();
    backend();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
    await screen.findByText('Unassigned gala');
    expect(screen.queryByText(/Unable to load event assignments/)).not.toBeInTheDocument();
  });

tc('FE-COORD-077', 'Late list response', 'The Lead switches views before the initial load completes.',
  'A late queue response cannot replace the selected active-event list.',
  { kind: 'Regression', steps: '1. Delay queue response. 2. Switch to active events. 3. Resolve old response.' }, async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    mockFetch(url => {
      if (url.includes('unassigned-queue')) return pending;
      if (url.endsWith('event-coordinator-lead/events')) return json([event()]);
      if (url.includes('coordinator-workloads')) return json(workloads);
      return json(coordinators);
    });
    render(<CoordinatorAssignment user={lead} />);
    fireEvent.click(screen.getByRole('button', { name: 'Active events', exact: true }));
    await screen.findByText('Gala');
    finish(json([event({ event_title: 'Stale queue', event_status: 'Submitted', assigned_coordinator_id: null })]));
    await waitFor(() => expect(screen.queryByText('Loading events and workloads...')).not.toBeInTheDocument());
    expect(screen.queryByText('Stale queue')).not.toBeInTheDocument();
    expect(screen.getByText('Gala')).toBeInTheDocument();
  });

tc('FE-COORD-078', 'Saved assignment with refresh failure', 'Reassignment succeeds but the subsequent list reload fails.',
  'The success message remains visible with the refresh error, and stale events are cleared.',
  { kind: 'Regression', steps: '1. Confirm reassignment. 2. Fail subsequent reads. 3. Check success and reload error.' }, async () => {
    backend(() => {
      mockFetch(() => json({}, 503));
      return json(event({ assigned_coordinator_id: 'c2', coordinator_name: 'Amy' }));
    });
    await openActive();
    const dialog = await review();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reassignment' }));
    expect(await screen.findByText(/Gala reassigned to Amy\. Unable to load event assignments/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();
  });
