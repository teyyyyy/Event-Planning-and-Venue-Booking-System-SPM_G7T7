import React from 'react';
import { describe, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import EquipmentRequest from '../EquipmentRequest';

const USER = { id: 'c1' };
const EVENTS = [{ id: 1, event_name: 'Gala', event_date: '2026-10-01' }];
const CATALOGUE = [{ equipment_id: 'MIC', equipment_name: 'Microphone' }, { equipment_id: 'PRJ', equipment_name: 'Projector' }];
const AVAIL = [{ equipment_id: 'MIC', available_quantity: 8 }, { equipment_id: 'PRJ', available_quantity: 3 }];
const REQUEST = {
  request_id: 7, event_id: 1, event_name: 'Gala', event_date: '2026-10-01', status: 'Updated', updated_by: 't1', updated_by_name: 'Tom',
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-02T10:00:00Z', latest_update_summary: 'Microphone quantity: 2 → 4\nProjector: Added × 1',
  items: [{ equipment_id: 'MIC', equipment_name: 'Microphone', requested_quantity: 2, technical_requirements: 'wireless' }],
};

function backend(o = {}) {
  const d = { events: EVENTS, catalogue: CATALOGUE, avail: AVAIL, requests: [REQUEST], post: () => json({ request_id: 12 }), put: () => json({ message: 'ok' }), ...o };
  return mockFetch((url, opts) => {
    const method = opts.method || 'GET';
    if (method === 'POST') return d.post(url, opts);
    if (method === 'PUT') return d.put(url, opts);
    if (url.endsWith('/equipment-availability')) return d.avail instanceof Function ? d.avail() : json(d.avail);
    if (url.endsWith('/equipment-requests')) return d.requests instanceof Function ? d.requests() : json(d.requests);
    if (url.endsWith('/equipment')) return d.catalogue instanceof Function ? d.catalogue() : json(d.catalogue);
    if (url.endsWith('/events')) return d.events instanceof Function ? d.events() : json(d.events);
    return json({}, 404);
  });
}
const selects = () => Array.from(document.querySelectorAll('select'));
const qty = () => document.querySelector('input[type=number]');
const ready = async () => { render(<EquipmentRequest user={USER} />); await screen.findByText('Submit equipment request'); };
const pickEventAndEquipment = async (equipment = 'MIC', quantity = '2') => {
  fireEvent.change(selects()[0], { target: { value: '1' } });
  await waitFor(() => expect(callsTo(fetch, 'equipment-availability')).toHaveLength(1));
  fireEvent.change(selects()[1], { target: { value: equipment } });
  fireEvent.change(qty(), { target: { value: quantity } });
};
const openViewTab = async () => { fireEvent.click(screen.getByRole('button', { name: 'Equipment Request View' })); };

describe('EquipmentRequest', () => {
  tc('FE-EQREQ-001', 'EquipmentRequest', 'The coordinator opens the page.', 'A loading message shows, then the submission form lists the coordinator\'s events as "<name> — <date>".',
    { steps: '1. Render. 2. Wait for the form.' },
    async () => {
      const f = backend();
      render(<EquipmentRequest user={USER} />);
      expect(screen.getByText('Loading equipment request page…')).toBeInTheDocument();
      expect(await screen.findByText('Submit equipment request')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Gala — 2026-10-01' })).toBeInTheDocument();
      expect(callsTo(f, '/event-coordinators/c1/events')[0][0]).toMatch(/events$/);
    });

  tc('FE-EQREQ-002', 'EquipmentRequest', 'The coordinator has no events without a request.', 'A warning says no assigned events are available.', { kind: 'Edge', steps: '1. Return an empty events list.' },
    async () => { backend({ events: [] }); await ready(); expect(screen.getByText(/No assigned events are available for a new equipment request/)).toBeInTheDocument(); });

  tc('FE-EQREQ-003', 'EquipmentRequest', 'Loading events fails.', 'The backend detail is shown in a page error banner.', { kind: 'Negative', data: '500 "Backend down"', steps: '1. Return 500 for the events call.' },
    async () => { backend({ events: () => json({ detail: 'Backend down' }, 500) }); await ready(); expect(screen.getByText('Backend down')).toBeInTheDocument(); });

  tc('FE-EQREQ-004', 'EquipmentRequest', 'Only the equipment catalogue fails to load.', 'The banner shows the catalogue error message.', { kind: 'Negative', steps: '1. Return 500 with no detail for /equipment.' },
    async () => { backend({ catalogue: () => json({}, 500) }); await ready(); expect(screen.getByText('Unable to load equipment catalogue.')).toBeInTheDocument(); });

  tc('FE-EQREQ-005', 'EquipmentRequest (availability)', 'The coordinator selects an event and an equipment type.', 'Availability for that event is fetched and "Available for this event: 8" is shown beside the quantity.', { steps: '1. Select the event. 2. Select Microphone.' },
    async () => {
      backend();
      await ready();
      await pickEventAndEquipment('MIC', '');
      expect(await screen.findByText('Available for this event: 8')).toBeInTheDocument();
    });

  tc('FE-EQREQ-006', 'EquipmentRequest (availability)', 'Checking availability fails.', 'An error dialog "Something went wrong" shows the backend message.', { kind: 'Negative', data: '404 "Event not found or is not assigned to this coordinator."', steps: '1. Return 404 for availability. 2. Select an event.' },
    async () => {
      backend({ avail: () => json({ detail: 'Event not found or is not assigned to this coordinator.' }, 404) });
      await ready();
      fireEvent.change(selects()[0], { target: { value: '1' } });
      expect(await screen.findByText('Event not found or is not assigned to this coordinator.')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

  tc('FE-EQREQ-007', 'EquipmentRequest (validation)', 'Requested quantity exceeds the available quantity.', 'The message "Maximum currently available: 8." shows and "Submit request" is disabled.', { kind: 'Negative', data: 'MIC x9 (8 available)', steps: '1. Select event and Microphone. 2. Enter 9.' },
    async () => {
      backend();
      await ready();
      await pickEventAndEquipment('MIC', '9');
      expect(await screen.findByText('Maximum currently available: 8.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    });

  tc('FE-EQREQ-008', 'EquipmentRequest (validation)', 'Quantity is zero or a decimal.', 'The message "Quantity must be a positive whole number." is shown.', { kind: 'Negative', data: '0 and 1.5', steps: '1. Enter 0. 2. Enter 1.5.' },
    async () => {
      backend();
      await ready();
      await pickEventAndEquipment('MIC', '0');
      expect(await screen.findByText('Quantity must be a positive whole number.')).toBeInTheDocument();
      fireEvent.change(qty(), { target: { value: '1.5' } });
      expect(screen.getByText('Quantity must be a positive whole number.')).toBeInTheDocument();
    });

  tc('FE-EQREQ-009', 'EquipmentRequest (validation)', 'The form is untouched.', '"Submit request" is disabled until an event, equipment and valid quantity are chosen, then enabled.', { kind: 'State', steps: '1. Inspect the button. 2. Complete the form.' },
    async () => {
      backend();
      await ready();
      const button = screen.getByRole('button', { name: 'Submit request' });
      expect(button).toBeDisabled();
      await pickEventAndEquipment('MIC', '2');
      await waitFor(() => expect(button).toBeEnabled());
    });

  tc('FE-EQREQ-010', 'EquipmentRequest (rows)', 'Microphone is chosen in one row and a second row is added.', 'Microphone is disabled in the second row\'s equipment list.', { steps: '1. Choose Microphone. 2. Click "+ Add equipment". 3. Inspect the second select.' },
    async () => {
      backend();
      await ready();
      fireEvent.change(selects()[1], { target: { value: 'MIC' } });
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      const second = within(selects()[2]);
      expect(second.getByRole('option', { name: 'Microphone' })).toBeDisabled();
      expect(second.getByRole('option', { name: 'Projector' })).toBeEnabled();
    });

  tc('FE-EQREQ-011', 'EquipmentRequest (rows)', 'A second row is added and then removed.', 'The "Remove equipment" button exists only when there is more than one row; removing returns to one row.', { steps: '1. Add a row. 2. Click "Remove equipment".' },
    async () => {
      backend();
      await ready();
      expect(screen.queryByRole('button', { name: 'Remove equipment' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      expect(screen.getByText('Equipment 2')).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove equipment' })[1]);
      expect(screen.queryByText('Equipment 2')).toBeNull();
    });

  tc('FE-EQREQ-012', 'EquipmentRequest (submit)', 'A valid request is submitted.', 'POST /equipment-requests is sent with numeric ids/quantities and trimmed requirements; a success dialog names the new request id; the form resets and events reload.',
    { data: 'event 1, MIC x2, requirements "  wireless  "', steps: '1. Complete the form. 2. Click "Submit request".' },
    async () => {
      const f = backend();
      await ready();
      await pickEventAndEquipment('MIC', '2');
      fireEvent.change(document.querySelector('textarea'), { target: { value: '  wireless  ' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      expect(await screen.findByText('Equipment request #12 was submitted successfully.')).toBeInTheDocument();
      const [url, options] = callsTo(f, '/equipment-requests', 'POST')[0];
      expect(url).toMatch(/event-coordinators\/c1\/equipment-requests$/);
      expect(JSON.parse(options.body)).toEqual({ event_id: 1, items: [{ equipment_id: 'MIC', requested_quantity: 2, technical_requirements: 'wireless' }] });
      expect(selects()[0]).toHaveValue('');
      expect(callsTo(f, '/event-coordinators/c1/events').filter(([u]) => u.endsWith('/events')).length).toBeGreaterThanOrEqual(2);
    });

  tc('FE-EQREQ-013', 'EquipmentRequest (submit)', 'The backend rejects the request.', 'An error dialog shows the backend message.', { kind: 'Negative', data: '409 "An equipment request has already been submitted for this event…"', steps: '1. Return 409 on POST. 2. Submit.' },
    async () => {
      backend({ post: () => json({ detail: 'An equipment request has already been submitted for this event.' }, 409) });
      await ready();
      await pickEventAndEquipment('MIC', '2');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      expect(await screen.findByText('An equipment request has already been submitted for this event.')).toBeInTheDocument();
    });

  tc('FE-EQREQ-014', 'EquipmentRequest (view)', 'Coordinator opens "Equipment Request View".', 'Their submitted requests are fetched and shown with id, event, equipment × quantity, requirements, latest update lines, status and updater name.',
    { steps: '1. Render. 2. Click the "Equipment Request View" tab.' },
    async () => {
      backend();
      await ready();
      await openViewTab();
      expect(await screen.findByText('#7')).toBeInTheDocument();
      expect(screen.getByText('× 2')).toBeInTheDocument();
      expect(screen.getByText('wireless')).toBeInTheDocument();
      expect(screen.getByText('Microphone quantity: 2 → 4')).toBeInTheDocument();
      expect(screen.getByText('Projector: Added × 1')).toBeInTheDocument();
      expect(screen.getByText('Tom')).toBeInTheDocument();
      expect(screen.getByText('Updated', { selector: '.request-status' })).toBeInTheDocument();
    });

  tc('FE-EQREQ-015', 'EquipmentRequest (view)', 'Coordinator has submitted no requests.', '"No equipment requests have been submitted yet." is shown.', { kind: 'Edge', steps: '1. Return an empty list. 2. Open the view tab.' },
    async () => { backend({ requests: [] }); await ready(); await openViewTab(); expect(await screen.findByText('No equipment requests have been submitted yet.')).toBeInTheDocument(); });

  tc('FE-EQREQ-016', 'EquipmentRequest (view)', 'Loading requests fails.', 'An error dialog shows the backend message.', { kind: 'Negative', steps: '1. Return 500 for requests. 2. Open the view tab.' },
    async () => { backend({ requests: () => json({ detail: 'Unable to load equipment requests.' }, 500) }); await ready(); await openViewTab(); expect(await screen.findByText('Unable to load equipment requests.')).toBeInTheDocument(); });

  tc('FE-EQREQ-017', 'EquipmentRequest (view)', 'A request was never touched by technical support and has no updates or timestamps.', 'The latest-update cell says "No Technical Support updates yet", Updated By and Last Updated show "—".', { kind: 'Edge', steps: '1. Return a bare request. 2. Open the view tab.' },
    async () => {
      backend({ requests: [{ ...REQUEST, status: 'Submitted', updated_by: null, updated_by_name: null, updated_at: null, created_at: null, latest_update_summary: '', items: [] }] });
      await ready();
      await openViewTab();
      expect(await screen.findByText('No Technical Support updates yet')).toBeInTheDocument();
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Submitted', { selector: '.request-time-note' })).toBeInTheDocument();
    });

  tc('FE-EQREQ-018', 'EquipmentRequest (view)', 'Updater has an id but no name.', 'The label falls back to "Technical Support Staff".', { kind: 'Edge', steps: '1. Return a request with updated_by set and updated_by_name null.' },
    async () => { backend({ requests: [{ ...REQUEST, updated_by_name: null }] }); await ready(); await openViewTab(); expect(await screen.findByText('Technical Support Staff')).toBeInTheDocument(); });

  tc('FE-EQREQ-019', 'EquipmentRequest (edit)', 'Coordinator clicks "Edit Request".', 'Availability for the event is fetched and an edit form opens with the existing equipment shown read-only with its quantity.', { steps: '1. Open the view tab. 2. Click "Edit Request".' },
    async () => {
      const f = backend();
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      expect(await screen.findByRole('heading', { name: 'Edit equipment request #7' })).toBeInTheDocument();
      expect(callsTo(f, 'equipment-availability')).toHaveLength(1);
      expect(screen.getByDisplayValue('Microphone')).toHaveAttribute('readonly');
      expect(qty()).toHaveValue(2);
    });

  tc('FE-EQREQ-020', 'EquipmentRequest (edit)', 'Preparing the edit form fails (availability error).', 'An error dialog is shown and the request list remains.', { kind: 'Negative', steps: '1. Return 500 for availability. 2. Click "Edit Request".' },
    async () => {
      backend({ avail: () => json({ detail: 'Unable to check equipment availability.' }, 500) });
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      expect(await screen.findByText('Unable to check equipment availability.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Edit equipment request/ })).toBeNull();
    });

  tc('FE-EQREQ-021', 'EquipmentRequest (edit)', 'The only equipment item is removed.', 'An error dialog says a request must contain at least one equipment item; the item stays.', { kind: 'Negative', steps: '1. Open an edit form with one item. 2. Click "Remove equipment".' },
    async () => {
      backend();
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Remove equipment' }));
      expect(await screen.findByText('An equipment request must contain at least one equipment item.')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Microphone')).toBeInTheDocument();
    });

  tc('FE-EQREQ-022', 'EquipmentRequest (edit)', 'A new equipment row is added in the edit form.', 'The row is labelled "— New" with an editable equipment select that disables equipment already in the request.', { steps: '1. Open the edit form. 2. Click "+ Add equipment".' },
    async () => {
      backend();
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      fireEvent.click(await screen.findByRole('button', { name: '+ Add equipment' }));
      expect(screen.getByText('Equipment 2 — New')).toBeInTheDocument();
      expect(within(selects()[0]).getByRole('option', { name: 'Microphone' })).toBeDisabled();
    });

  tc('FE-EQREQ-023', 'EquipmentRequest (edit)', 'Coordinator changes the quantity and saves.', 'PUT /equipment-requests/<id> is sent with the items; the success dialog "Equipment request #7 was updated successfully." shows and the list reloads.', { data: 'MIC 2 -> 4', steps: '1. Open the edit form. 2. Set 4. 3. Click "Save Changes".' },
    async () => {
      const f = backend();
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      await screen.findByRole('heading', { name: 'Edit equipment request #7' });
      fireEvent.change(qty(), { target: { value: '4' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      expect(await screen.findByText('Equipment request #7 was updated successfully.')).toBeInTheDocument();
      const [url, options] = callsTo(f, '/equipment-requests/7', 'PUT')[0];
      expect(url).toMatch(/c1\/equipment-requests\/7$/);
      expect(JSON.parse(options.body)).toEqual({ items: [{ equipment_id: 'MIC', requested_quantity: 4, technical_requirements: 'wireless' }] });
      expect(screen.queryByRole('heading', { name: /Edit equipment request/ })).toBeNull();
    });

  tc('FE-EQREQ-024', 'EquipmentRequest (edit)', 'Edited quantity exceeds availability.', 'The maximum message shows and "Save Changes" is disabled.', { kind: 'Negative', data: 'MIC x9 (8 available)', steps: '1. Open the edit form. 2. Enter 9.' },
    async () => {
      backend();
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      await screen.findByRole('heading', { name: 'Edit equipment request #7' });
      fireEvent.change(qty(), { target: { value: '9' } });
      expect(screen.getByText('Maximum currently available: 8.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    });

  tc('FE-EQREQ-025', 'EquipmentRequest (edit)', 'The backend rejects the edit.', 'An error dialog shows the backend message and the form stays open.', { kind: 'Negative', steps: '1. Return 400 on PUT. 2. Save.' },
    async () => {
      backend({ put: () => json({ detail: 'Microphone has only 1 available.' }, 400) });
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      await screen.findByRole('heading', { name: 'Edit equipment request #7' });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      expect(await screen.findByText('Microphone has only 1 available.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Edit equipment request #7' })).toBeInTheDocument();
    });

  tc('FE-EQREQ-026', 'EquipmentRequest (edit)', 'Coordinator clicks Cancel in the edit form.', 'The edit form closes and the request table returns without a PUT.', { kind: 'State', steps: '1. Open the edit form. 2. Click "Cancel".' },
    async () => {
      const f = backend();
      await ready();
      await openViewTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Request' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('Equipment request submissions')).toBeInTheDocument();
      expect(callsTo(f, '/equipment-requests', 'PUT')).toHaveLength(0);
    });

  tc('FE-EQREQ-027', 'EquipmentRequest (tabs)', 'Coordinator returns to the submission tab from the view tab.', 'The submission form is shown again.', { kind: 'State', steps: '1. Open the view tab. 2. Click "Equipment Request Submission".' },
    async () => {
      backend();
      await ready();
      await openViewTab();
      await screen.findByText('Equipment request submissions');
      fireEvent.click(screen.getByRole('button', { name: 'Equipment Request Submission' }));
      expect(screen.getByText('Submit equipment request')).toBeInTheDocument();
    });
});
