import React from 'react';
import { describe, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import EquipmentAvailability from '../EquipmentAvailability';

const USER = { id: 't1' };
const listEvent = (o = {}) => ({ event_id: 1, event_name: 'Gala', event_date: '2026-10-01', start_time: '09:00:00', end_time: '17:00:00', requested_equipment_count: 2, equipment_description: 'Microphone × 2, Projector × 1', request_status: 'Submitted', ...o });
const line = (o = {}) => ({ equipment_id: 'MIC', equipment_name: 'Microphone', requested_quantity: 2, total_quantity: 10, under_maintenance_count: 2, reserved_quantity: 3, available_quantity: 5, shortage_quantity: 0, availability_status: 'Available', ...o });
const detail = (o = {}) => ({ event: { id: 1, event_name: 'Gala', event_date: '2026-10-01', start_time: '09:00:00', end_time: '17:00:00' }, request_id: 7, request_status: 'Submitted', all_equipment_available: true, unavailable_equipment_count: 0, availability: [line()], ...o });

const backend = ({ list = [listEvent()], det = detail(), cat = [], extra } = {}) => mockFetch((url, o) => {
  if (extra) { const r = extra(url, o); if (r) return r; }
  if (url.endsWith('/catalogue')) return json(cat);
  if (/\/events\/\d+$/.test(url)) return json(det);
  return json(list);
});

describe('EquipmentAvailability', () => {
  tc('FE-EQAVAIL-001', 'EquipmentAvailability', 'The page opens.', 'A loading message shows, then /equipment-availability/<staff>/events is fetched and each event lists name, date, time range, equipment summary and request status.',
    { steps: '1. Render. 2. Wait for the table.' },
    async () => {
      const f = backend();
      render(<EquipmentAvailability user={USER} />);
      expect(screen.getByText('Loading equipment availability…')).toBeInTheDocument();
      expect(await screen.findByText('Gala')).toBeInTheDocument();
      expect(f.mock.calls[0][0]).toMatch(/equipment-availability\/t1\/events$/);
      expect(screen.getByText('2 equipment types')).toBeInTheDocument();
      expect(screen.getByText('Microphone × 2, Projector × 1')).toBeInTheDocument();
      expect(screen.getByText('Submitted')).toBeInTheDocument();
    });

  tc('FE-EQAVAIL-002', 'EquipmentAvailability', 'An event requests exactly one equipment type.', 'The label is singular: "1 equipment type".', { kind: 'Edge', steps: '1. Return a request with count 1.' },
    async () => { backend({ list: [listEvent({ requested_equipment_count: 1 })] }); render(<EquipmentAvailability user={USER} />); expect(await screen.findByText('1 equipment type')).toBeInTheDocument(); });

  tc('FE-EQAVAIL-003', 'EquipmentAvailability', 'There are no equipment requests.', '"There are currently no equipment requests to check." is shown.', { kind: 'Edge', steps: '1. Return an empty list.' },
    async () => { backend({ list: [] }); render(<EquipmentAvailability user={USER} />); expect(await screen.findByText('There are currently no equipment requests to check.')).toBeInTheDocument(); });

  tc('FE-EQAVAIL-004', 'EquipmentAvailability', 'Loading events fails.', 'The backend detail is shown in an error banner.', { kind: 'Negative', data: '403 "Only Technical Support Staff can check equipment availability."', steps: '1. Return 403.' },
    async () => { mockFetch(() => json({ detail: 'Only Technical Support Staff can check equipment availability.' }, 403)); render(<EquipmentAvailability user={USER} />); expect(await screen.findByText('Only Technical Support Staff can check equipment availability.')).toBeInTheDocument(); });

  tc('FE-EQAVAIL-005', 'EquipmentAvailability', 'The API returns something other than a list.', 'The page shows the empty state instead of crashing.', { kind: 'Edge', data: '{"unexpected": true}', steps: '1. Return an object.' },
    async () => { mockFetch(() => json({ unexpected: true })); render(<EquipmentAvailability user={USER} />); expect(await screen.findByText('There are currently no equipment requests to check.')).toBeInTheDocument(); });

  tc('FE-EQAVAIL-006', 'EquipmentAvailability (check)', 'Staff clicks "Check Availability" and everything is available.', 'GET /events/<id> is called; the detail screen shows the event title, request number, the "All requested equipment is available" banner and the equipment row.', { steps: '1. Render. 2. Click "Check Availability".' },
    async () => {
      const f = backend();
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      expect(await screen.findByText('All requested equipment is available')).toBeInTheDocument();
      expect(callsTo(f, '/events/1')[0][0]).toMatch(/equipment-availability\/t1\/events\/1$/);
      expect(screen.getByText('Request #7')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Gala', level: 1 })).toBeInTheDocument();
      expect(document.querySelector('.availability-detail-table .availability-result-pill')).toHaveTextContent('Available');
    });

  tc('FE-EQAVAIL-007', 'EquipmentAvailability (check)', 'Some requested equipment is short.', 'The banner reads "Some requested equipment cannot be fully fulfilled", counts the affected types and the row shows "Short by <n>".',
    { data: 'Projector short by 2', steps: '1. Return a detail with an Insufficient line. 2. Click "Check Availability".' },
    async () => {
      backend({ det: detail({ all_equipment_available: false, unavailable_equipment_count: 1, availability: [line(), line({ equipment_id: 'PRJ', equipment_name: 'Projector', availability_status: 'Insufficient', shortage_quantity: 2, available_quantity: 1 })] }) });
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      expect(await screen.findByText('Some requested equipment cannot be fully fulfilled')).toBeInTheDocument();
      expect(screen.getByText('1 requested equipment type currently have insufficient availability.')).toBeInTheDocument();
      expect(screen.getByText('Short by 2')).toBeInTheDocument();
      expect(screen.getByText('Attention Required')).toBeInTheDocument();
    });

  tc('FE-EQAVAIL-008', 'EquipmentAvailability (check)', 'The availability check fails.', 'The user stays on the events list and the backend detail is shown.', { kind: 'Negative', data: '404 "This event does not have an equipment request."', steps: '1. Return 404 for the detail call. 2. Click "Check Availability".' },
    async () => {
      backend({ extra: (url) => (/\/events\/\d+$/.test(url) ? json({ detail: 'This event does not have an equipment request.' }, 404) : null) });
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      expect(await screen.findByText('This event does not have an equipment request.')).toBeInTheDocument();
      expect(screen.getByText('Availability by event')).toBeInTheDocument();
    });

  tc('FE-EQAVAIL-009', 'EquipmentAvailability (check)', 'The request has no active equipment items.', '"This request does not contain any active equipment items." is shown.', { kind: 'Edge', steps: '1. Return a detail with availability [].' },
    async () => {
      backend({ det: detail({ availability: [], all_equipment_available: false }) });
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      expect(await screen.findByText('This request does not contain any active equipment items.')).toBeInTheDocument();
    });

  tc('FE-EQAVAIL-010', 'EquipmentAvailability (catalogue)', 'Staff clicks "View Full Catalogue".', 'GET /events/<id>/catalogue is called and the catalogue table appears; the button becomes "Hide Catalogue".',
    { steps: '1. Open an event. 2. Click "View Full Catalogue".' },
    async () => {
      const f = backend({ cat: [{ equipment_id: 'CAM', equipment_name: 'Camera', total_quantity: 4, under_maintenance_count: 1, reserved_quantity: 0, available_quantity: 3 }] });
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View Full Catalogue' }));
      expect(await screen.findByText('Camera')).toBeInTheDocument();
      expect(callsTo(f, '/catalogue')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Hide Catalogue' })).toBeInTheDocument();
    });

  tc('FE-EQAVAIL-011', 'EquipmentAvailability (catalogue)', 'Staff hides then re-opens the catalogue.', 'It is hidden, then shown again without a second network request (cached).', { kind: 'Performance', steps: '1. Show catalogue. 2. Hide it. 3. Show it again.' },
    async () => {
      const f = backend({ cat: [{ equipment_id: 'CAM', equipment_name: 'Camera', total_quantity: 4, under_maintenance_count: 1, reserved_quantity: 0, available_quantity: 3 }] });
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View Full Catalogue' }));
      await screen.findByText('Camera');
      fireEvent.click(screen.getByRole('button', { name: 'Hide Catalogue' }));
      expect(screen.queryByText('Camera')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'View Full Catalogue' }));
      expect(await screen.findByText('Camera')).toBeInTheDocument();
      expect(callsTo(f, '/catalogue')).toHaveLength(1);
    });

  tc('FE-EQAVAIL-012', 'EquipmentAvailability (catalogue)', 'Loading the catalogue fails.', 'The backend detail is shown and no catalogue is displayed.', { kind: 'Negative', steps: '1. Return 500 for /catalogue. 2. Click "View Full Catalogue".' },
    async () => {
      backend({ extra: (url) => (url.endsWith('/catalogue') ? json({ detail: 'Catalogue down' }, 500) : null) });
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      fireEvent.click(await screen.findByRole('button', { name: 'View Full Catalogue' }));
      expect(await screen.findByText('Catalogue down')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Hide Catalogue' })).toBeNull();
    });

  tc('FE-EQAVAIL-013', 'EquipmentAvailability (navigation)', 'Staff clicks "← Back to all events".', 'The events list is shown again and reloaded from the backend.', { kind: 'State', steps: '1. Open an event. 2. Click the back button.' },
    async () => {
      const f = backend();
      render(<EquipmentAvailability user={USER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Check Availability' }));
      fireEvent.click(await screen.findByRole('button', { name: '← Back to all events' }));
      expect(await screen.findByText('Availability by event')).toBeInTheDocument();
      await waitFor(() => expect(f.mock.calls.filter(([u]) => u.endsWith('/events')).length).toBe(2));
    });

  tc('FE-EQAVAIL-014', 'EquipmentAvailability', 'An event has missing times.', 'The time cell shows "—" for each missing value.', { kind: 'Edge', data: 'start_time = null', steps: '1. Return an event without start time.' },
    async () => { backend({ list: [listEvent({ start_time: null })] }); render(<EquipmentAvailability user={USER} />); const cell = (await screen.findByText('Gala')).closest('tr'); expect(within(cell).getByText(/^—/)).toBeInTheDocument(); });
});
