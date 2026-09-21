import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import EquipmentUpdate from '../EquipmentUpdate';

const USER = { id: 't1' };
const SUMMARY = [{ event_id: 1, event_name: 'Gala', event_date: '2026-10-01', request_count: 1, equipment_description: 'Microphone × 2', status: 'Submitted' }];
const CATALOGUE = [{ equipment_id: 'MIC', equipment_name: 'Microphone' }, { equipment_id: 'PRJ', equipment_name: 'Projector' }];
const REQ = (o = {}) => ({
  request_id: 7, status: 'Submitted', created_by: 'c1', created_by_name: 'Cara', created_at: '2026-09-01T09:00:00Z', updated_by: null,
  items: [{ equipment_id: 'MIC', equipment_name: 'Microphone', requested_quantity: 2, technical_requirements: 'wireless' }], ...o,
});
const DETAIL = (requests = [REQ()]) => ({ event: { id: 1, event_name: 'Gala', event_date: '2026-10-01' }, equipment_catalogue: CATALOGUE, requests });

function backend(o = {}) {
  const d = { summary: SUMMARY, detail: DETAIL(), put: () => json({ updated_requests: [7] }), ...o };
  return mockFetch((url, opts) => {
    if ((opts.method || 'GET') === 'PUT') return d.put(url, opts);
    if (url.endsWith('/requests/summary')) return d.summary instanceof Function ? d.summary() : json(d.summary);
    if (url.endsWith('/requests')) return d.detail instanceof Function ? d.detail() : json(d.detail);
    return json({}, 404);
  });
}
const openDetail = async () => {
  render(<EquipmentUpdate user={USER} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View full details' }));
  await screen.findByText('Request #7');
};
const qty = () => document.querySelector('input[type=number]');
const confirm = () => screen.getByRole('button', { name: /Confirm All Updates|Updating…/ });
const lastNotice = () => within(screen.getByRole('alertdialog'));

describe('EquipmentUpdate', () => {
  tc('FE-EQUPD-001', 'EquipmentUpdate', 'Technical support opens the page.', 'A loading message shows, then /equipment-update/<staff>/requests/summary is fetched and requests are listed by event with equipment description and status.', { steps: '1. Render. 2. Wait for the table.' },
    async () => {
      const f = backend();
      render(<EquipmentUpdate user={USER} />);
      expect(screen.getByText('Loading equipment requests…')).toBeInTheDocument();
      expect(await screen.findByText('Gala')).toBeInTheDocument();
      expect(f.mock.calls[0][0]).toMatch(/equipment-update\/t1\/requests\/summary$/);
      expect(screen.getByText('Microphone × 2')).toBeInTheDocument();
      expect(screen.getByText('Submitted', { selector: '.request-status' })).toBeInTheDocument();
    });

  tc('FE-EQUPD-002', 'EquipmentUpdate', 'There are no equipment requests.', '"There are currently no equipment requests." is shown.', { kind: 'Edge', steps: '1. Return an empty list.' },
    async () => { backend({ summary: [] }); render(<EquipmentUpdate user={USER} />); expect(await screen.findByText('There are currently no equipment requests.')).toBeInTheDocument(); });

  tc('FE-EQUPD-003', 'EquipmentUpdate', 'Loading the summary fails.', 'The backend detail is shown in an error banner.', { kind: 'Negative', data: '403 "Only Technical Support Staff can access equipment updates."', steps: '1. Return 403.' },
    async () => { backend({ summary: () => json({ detail: 'Only Technical Support Staff can access equipment updates.' }, 403) }); render(<EquipmentUpdate user={USER} />); expect(await screen.findByText('Only Technical Support Staff can access equipment updates.')).toBeInTheDocument(); });

  tc('FE-EQUPD-004', 'EquipmentUpdate (details)', 'Staff clicks "View full details".', 'GET /events/<id>/requests is called; each request shows as a card with submitter, existing equipment read-only, and quantity and requirement fields.', { steps: '1. Render. 2. Click "View full details".' },
    async () => {
      const f = backend();
      await openDetail();
      expect(callsTo(f, '/events/1/requests')[0][0]).toMatch(/equipment-update\/t1\/events\/1\/requests$/);
      expect(screen.getByText('Cara')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Microphone')).toHaveAttribute('readonly');
      expect(qty()).toHaveValue(2);
      expect(screen.getByDisplayValue('wireless')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Gala', level: 1 })).toBeInTheDocument();
    });

  tc('FE-EQUPD-005', 'EquipmentUpdate (details)', 'Loading the details fails.', 'The backend detail is shown and the summary list remains.', { kind: 'Negative', steps: '1. Return 404 for the detail call. 2. Click "View full details".' },
    async () => {
      backend({ detail: () => json({ detail: 'Event was not found.' }, 404) });
      render(<EquipmentUpdate user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'View full details' }));
      expect(await screen.findByText('Event was not found.')).toBeInTheDocument();
      expect(screen.getByText('Requests by event')).toBeInTheDocument();
    });

  tc('FE-EQUPD-006', 'EquipmentUpdate (details)', 'An event has no equipment requests.', '"No equipment requests exist for this event." is shown and there is no Confirm button.', { kind: 'Edge', steps: '1. Return a detail with no requests. 2. Open it.' },
    async () => {
      backend({ detail: DETAIL([]) });
      render(<EquipmentUpdate user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'View full details' }));
      expect(await screen.findByText('No equipment requests exist for this event.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Confirm All Updates' })).toBeNull();
    });

  tc('FE-EQUPD-007', 'EquipmentUpdate (details)', 'Staff clicks "← Back to all events".', 'The summary list is shown and reloaded.', { kind: 'State', steps: '1. Open a detail. 2. Click back.' },
    async () => {
      const f = backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '← Back to all events' }));
      expect(await screen.findByText('Requests by event')).toBeInTheDocument();
      await waitFor(() => expect(callsTo(f, '/requests/summary')).toHaveLength(2));
    });

  tc('FE-EQUPD-008', 'EquipmentUpdate (changes)', 'Nothing has been edited.', '"No equipment requests have been changed." is shown and "Confirm All Updates" is disabled.', { kind: 'State', steps: '1. Open a detail without editing.' },
    async () => {
      backend();
      await openDetail();
      expect(screen.getByText('No equipment requests have been changed.')).toBeInTheDocument();
      expect(confirm()).toBeDisabled();
      expect(screen.getByText('No changes to this equipment item.')).toBeInTheDocument();
    });

  tc('FE-EQUPD-009', 'EquipmentUpdate (changes)', 'Staff changes a quantity from 2 to 4.', 'The item lists "Quantity: 2 → 4", the footer counts one changed request and Confirm is enabled.', { data: '2 -> 4', steps: '1. Open a detail. 2. Set quantity 4.' },
    async () => {
      backend();
      await openDetail();
      fireEvent.change(qty(), { target: { value: '4' } });
      expect(screen.getByText('Quantity: 2 → 4')).toBeInTheDocument();
      expect(screen.getByText('1 request contain changes.')).toBeInTheDocument();
      expect(confirm()).toBeEnabled();
    });

  tc('FE-EQUPD-010', 'EquipmentUpdate (changes)', 'Staff sets an existing quantity to 0.', 'The change reads "Quantity: 2 → 0 (Cancelled)".', { data: '0', steps: '1. Set quantity 0.' },
    async () => { backend(); await openDetail(); fireEvent.change(qty(), { target: { value: '0' } }); expect(screen.getByText('Quantity: 2 → 0 (Cancelled)')).toBeInTheDocument(); });

  tc('FE-EQUPD-011', 'EquipmentUpdate (changes)', 'Staff edits technical requirements.', 'The change reads Technical requirements: "wireless" → "HDMI".', { data: '"wireless" -> "HDMI"', steps: '1. Edit the requirements textarea.' },
    async () => { backend(); await openDetail(); fireEvent.change(screen.getByDisplayValue('wireless'), { target: { value: 'HDMI' } }); expect(screen.getByText('Technical requirements: "wireless" → "HDMI"')).toBeInTheDocument(); });

  tc('FE-EQUPD-012', 'EquipmentUpdate (add)', 'Staff clicks "+ Add equipment".', 'A "New" row appears summarised as "New equipment item added" and can be removed again.', { steps: '1. Click "+ Add equipment". 2. Click "Remove".' },
    async () => {
      backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      expect(screen.getByText('New')).toBeInTheDocument();
      expect(screen.getByText('New equipment item added')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(screen.queryByText('New')).toBeNull();
    });

  tc('FE-EQUPD-013', 'EquipmentUpdate (add)', 'Staff chooses Projector for the new row and enters 1.', 'The change reads "Added Projector × 1"; Microphone is disabled in the select because it is already in the request.', { steps: '1. Add a row. 2. Choose Projector. 3. Enter 1.' },
    async () => {
      backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      const select = document.querySelector('select');
      expect(within(select).getByRole('option', { name: 'Microphone' })).toBeDisabled();
      fireEvent.change(select, { target: { value: 'PRJ' } });
      fireEvent.change(document.querySelectorAll('input[type=number]')[1], { target: { value: '1' } });
      expect(screen.getByText('Added Projector × 1')).toBeInTheDocument();
    });

  tc('FE-EQUPD-014', 'EquipmentUpdate (validation)', 'Staff confirms with a new row that has no equipment chosen.', 'Error dialog: "Request #7 contains an equipment row without an equipment type." and no PUT is sent.', { kind: 'Negative', steps: '1. Add a row. 2. Click Confirm.' },
    async () => {
      const f = backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      fireEvent.click(confirm());
      expect(await screen.findByText('Request #7 contains an equipment row without an equipment type.')).toBeInTheDocument();
      expect(callsTo(f, '/requests', 'PUT')).toHaveLength(0);
    });

  tc('FE-EQUPD-015', 'EquipmentUpdate (validation)', 'A new row has equipment but no quantity.', 'Error dialog: "Please enter a quantity for every equipment item in request #7."', { kind: 'Negative', steps: '1. Add a row. 2. Choose Projector. 3. Click Confirm.' },
    async () => {
      backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      fireEvent.change(document.querySelector('select'), { target: { value: 'PRJ' } });
      fireEvent.click(confirm());
      expect(await screen.findByText('Please enter a quantity for every equipment item in request #7.')).toBeInTheDocument();
    });

  tc('FE-EQUPD-016', 'EquipmentUpdate (validation)', 'A new row has quantity 0.', 'Error dialog: "New equipment must have a quantity greater than 0."', { kind: 'Negative', data: 'Projector x0', steps: '1. Add a row. 2. Choose Projector, quantity 0. 3. Click Confirm.' },
    async () => {
      backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '+ Add equipment' }));
      fireEvent.change(document.querySelector('select'), { target: { value: 'PRJ' } });
      fireEvent.change(document.querySelectorAll('input[type=number]')[1], { target: { value: '0' } });
      fireEvent.click(confirm());
      expect(await screen.findByText('New equipment must have a quantity greater than 0.')).toBeInTheDocument();
    });

  tc('FE-EQUPD-017', 'EquipmentUpdate (validation)', 'Quantity is a decimal.', 'Error dialog: "Quantity must be a whole number of 0 or more."', { kind: 'Negative', data: '2.5', steps: '1. Enter 2.5. 2. Click Confirm.' },
    async () => {
      backend();
      await openDetail();
      fireEvent.change(qty(), { target: { value: '2.5' } });
      fireEvent.click(confirm());
      expect(await screen.findByText('Quantity must be a whole number of 0 or more.')).toBeInTheDocument();
    });

  tc('FE-EQUPD-018', 'EquipmentUpdate (save)', 'Staff confirms one changed request among two.', 'PUT /events/<id>/requests contains only the changed request; success dialog "1 equipment request updated successfully." shows and the details reload.',
    { data: 'request 7 changed (2 -> 4), request 8 unchanged', steps: '1. Open a detail with two requests. 2. Change request 7. 3. Click Confirm.' },
    async () => {
      const two = DETAIL([REQ(), REQ({ request_id: 8, items: [{ equipment_id: 'PRJ', equipment_name: 'Projector', requested_quantity: 1, technical_requirements: '' }] })]);
      const f = backend({ detail: two });
      render(<EquipmentUpdate user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'View full details' }));
      await screen.findByText('Request #8');
      fireEvent.change(document.querySelectorAll('input[type=number]')[0], { target: { value: '4' } });
      fireEvent.click(confirm());
      expect(await screen.findByText('1 equipment request updated successfully.')).toBeInTheDocument();
      const [url, options] = callsTo(f, '/events/1/requests', 'PUT')[0];
      expect(url).toMatch(/equipment-update\/t1\/events\/1\/requests$/);
      expect(JSON.parse(options.body)).toEqual({ requests: [{ request_id: 7, items: [{ equipment_id: 'MIC', requested_quantity: 4, technical_requirements: 'wireless' }] }] });
      await waitFor(() => expect(callsTo(f, '/events/1/requests', 'GET').length).toBeGreaterThanOrEqual(2));
    });

  tc('FE-EQUPD-019', 'EquipmentUpdate (save)', 'The backend rejects the update.', 'An error dialog shows the backend message and the edits remain.', { kind: 'Negative', data: '400 "Microphone has only 3 available for this event."', steps: '1. Return 400 on PUT. 2. Change a quantity and Confirm.' },
    async () => {
      backend({ put: () => json({ detail: 'Microphone has only 3 available for this event.' }, 400) });
      await openDetail();
      fireEvent.change(qty(), { target: { value: '9' } });
      fireEvent.click(confirm());
      expect(await screen.findByText('Microphone has only 3 available for this event.')).toBeInTheDocument();
      expect(qty()).toHaveValue(9);
    });

  tc('FE-EQUPD-020', 'EquipmentUpdate (save)', 'A save is in progress.', 'The button reads "Updating…" and is disabled.', { kind: 'State', pre: 'PUT never resolves.', steps: '1. Change a quantity. 2. Click Confirm.' },
    async () => {
      backend({ put: () => new Promise(() => {}) });
      await openDetail();
      fireEvent.change(qty(), { target: { value: '4' } });
      fireEvent.click(confirm());
      expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled();
    });

  tc('FE-EQUPD-021', 'EquipmentUpdate (details)', 'A request was previously updated by technical support.', 'A "Last updated by <name> · <date>" line is shown.', { steps: '1. Open a detail whose request has updated_by.' },
    async () => {
      backend({ detail: DETAIL([REQ({ updated_by: 't1', updated_by_name: 'Tom', updated_at: '2026-09-02T10:00:00Z', status: 'Updated' })]) });
      await openDetail();
      expect(screen.getByText(/Last updated by/)).toHaveTextContent('Tom');
      expect(screen.getByText('Updated', { selector: '.request-status' })).toBeInTheDocument();
    });

  tc('FE-EQUPD-022', 'EquipmentUpdate (details)', 'Created-at timestamp is missing.', 'The submitted line shows "—" instead of a date.', { kind: 'Edge', steps: '1. Open a detail with created_at null.' },
    async () => {
      backend({ detail: DETAIL([REQ({ created_at: null })]) });
      await openDetail();
      expect(screen.getByText(/Submitted by/)).toHaveTextContent('—');
    });
});
