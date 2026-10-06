import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import EquipmentReservation from '../EquipmentReservation';

const USER = { id: 't1' };
const EVENT = { id: 1, event_name: 'Gala', event_date: '2026-10-01', start_time: '09:00:00', end_time: '17:00:00' };
const listRow = (o = {}) => ({ reservation_id: 50, event_id: 1, request_id: 7, status: 'Reserved', event_name: 'Gala', event_date: '2026-10-01', start_time: '09:00:00', end_time: '17:00:00', equipment_count: 2, equipment_description: 'Microphone × 2, Projector × 1', ...o });
const newLine = (o = {}) => ({ equipment_id: 'MIC', equipment_name: 'Microphone', requested_quantity: 2, reserved_quantity: 2, available_quantity: 8, technical_requirements: 'wireless', ...o });
const fresh = (items = [newLine(), newLine({ equipment_id: 'PRJ', equipment_name: 'Projector', requested_quantity: 1, reserved_quantity: 1, available_quantity: 3, technical_requirements: '' })]) =>
  ({ mode: 'new', event_id: 1, request_id: 7, event: EVENT, items });
const reservedLine = (o = {}) => ({ equipment_id: 'MIC', equipment_name: 'Microphone', reserved_quantity: 2, requested_quantity: 2, currently_requested: true, currently_reserved: true, ...o });
const existing = (o = {}) => ({ mode: 'existing', reservation_id: 50, event_id: 1, request_id: 7, status: 'Reserved', event: EVENT,
  items: [reservedLine(), reservedLine({ equipment_id: 'PRJ', equipment_name: 'Projector', reserved_quantity: 1, requested_quantity: 1 })], ...o });

// Mirror the page's en-SG formatting so the assertions do not depend on the machine's ICU data.
const time = (h, m) => { const d = new Date(); d.setHours(h, m); return d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }); };
const date = (v) => new Date(`${v}T00:00:00`).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });

// detail: a value or a list of values returned by successive GET /events/<id> calls.
function backend({ list = [listRow()], detail = fresh(), write = () => json({ message: 'Saved.' }) } = {}) {
  const details = Array.isArray(detail) ? [...detail] : [detail];
  return mockFetch((url, o) => {
    if ((o.method || 'GET') !== 'GET') return write(url, o);
    if (url.endsWith('/reservations')) return list instanceof Function ? list() : json(list);
    const next = details.length > 1 ? details.shift() : details[0];
    return next instanceof Function ? next() : json(next);
  });
}
const openList = async (props = {}) => { render(<EquipmentReservation user={USER} {...props} />); await waitFor(() => expect(screen.queryByText('Loading equipment reservations…')).toBeNull()); };
const openEvent = async (props = {}) => { render(<EquipmentReservation user={USER} eventId={1} {...props} />); await waitFor(() => expect(screen.queryByText('Loading equipment reservation…')).toBeNull()); };
const qty = () => [...document.querySelectorAll('input.reservation-quantity-input')];
const confirmBtn = () => document.querySelector('.reservation-actions .primary');

describe('EquipmentReservation (list)', () => {
  tc('FE-EQRES-001', 'EquipmentReservation (list)', 'Technical support opens Equipment Reservation.',
    'A loading message shows, then GET /equipment-reservation/<staff>/reservations lists each reservation with event, number, date, time range, request, equipment summary, status and a "View" action.',
    { steps: '1. Render without an event id. 2. Wait for the table.' },
    async () => {
      const f = backend();
      render(<EquipmentReservation user={USER} />);
      expect(screen.getByText('Loading equipment reservations…')).toBeInTheDocument();
      const row = (await screen.findByText('Reservation #50')).closest('tr');
      expect(f.mock.calls[0][0]).toMatch(/equipment-reservation\/t1\/reservations$/);
      expect(row).toHaveTextContent('Gala');
      expect(row).toHaveTextContent(date('2026-10-01'));
      expect(row).toHaveTextContent(`${time(9, 0)} – ${time(17, 0)}`);
      expect(row).toHaveTextContent('#7');
      expect(row).toHaveTextContent('2 equipment types');
      expect(row).toHaveTextContent('Microphone × 2, Projector × 1');
      expect(within(row).getByText('Reserved')).toHaveClass('reservation-status', 'reserved');
      expect(within(row).getByRole('button', { name: 'View' })).toHaveClass('secondary');
    });

  tc('FE-EQRES-002', 'EquipmentReservation (list)', 'Reservations in every status are listed, one needing a recheck and one without schedule or summary.',
    'Each status gets its colour class (unknown statuses none); "Needs Recheck" shows a primary "Review" action that opens the event; missing values show "—" and the singular label is used.',
    { kind: 'Edge', data: 'Needs Recheck, Modified, Completed, Cancelled, On Hold', steps: '1. Render the list. 2. Click "Review".' },
    async () => {
      backend({ list: [
        listRow({ reservation_id: 1, event_id: 11, status: 'Needs Recheck' }),
        listRow({ reservation_id: 2, status: 'Modified' }), listRow({ reservation_id: 3, status: 'Completed' }), listRow({ reservation_id: 4, status: 'Cancelled' }),
        listRow({ reservation_id: 5, status: 'On Hold', event_date: null, start_time: null, end_time: null, equipment_count: 1, equipment_description: '' }),
      ] });
      const onOpenEvent = vi.fn();
      await openList({ onOpenEvent });
      const pill = (status) => screen.getByText(status, { selector: '.reservation-status' });
      expect(pill('Needs Recheck')).toHaveClass('needs-recheck');
      expect(pill('Modified')).toHaveClass('modified');
      expect(pill('Completed')).toHaveClass('completed');
      expect(pill('Cancelled')).toHaveClass('cancelled');
      expect(pill('On Hold').className.trim()).toBe('reservation-status');
      const odd = screen.getByText('Reservation #5').closest('tr');
      expect(odd).toHaveTextContent('1 equipment type');
      expect(odd).toHaveTextContent('— – —');
      expect(odd.querySelector('.reservation-equipment-description')).toBeNull();
      const review = screen.getByRole('button', { name: 'Review' });
      expect(review).toHaveClass('primary');
      fireEvent.click(review);
      expect(onOpenEvent).toHaveBeenCalledWith(11);
    });

  tc('FE-EQRES-003', 'EquipmentReservation (list)', 'There are no reservations yet.', '"No equipment reservations yet" is shown and both "Check Equipment Availability" buttons go to the availability check.',
    { kind: 'Edge', data: 'response body null', steps: '1. Return null. 2. Click each "Check Equipment Availability" button.' },
    async () => {
      backend({ list: null });
      const onBack = vi.fn();
      await openList({ onBack });
      expect(screen.getByText('No equipment reservations yet')).toBeInTheDocument();
      screen.getAllByRole('button', { name: 'Check Equipment Availability' }).forEach((b) => fireEvent.click(b));
      expect(onBack).toHaveBeenCalledTimes(2);
    });

  tc('FE-EQRES-004', 'EquipmentReservation (list)', 'Loading the reservations fails, with and without a backend message.', 'The backend detail is shown; otherwise "Unable to load equipment reservations."; the empty state is shown underneath.',
    { kind: 'Negative', data: '403 "Only Technical Support Staff can manage equipment reservations."; 500 {}', steps: '1. Return 403 with a detail. 2. Return 500 without one.' },
    async () => {
      backend({ list: () => json({ detail: 'Only Technical Support Staff can manage equipment reservations.' }, 403) });
      const { unmount } = render(<EquipmentReservation user={USER} />);
      expect(await screen.findByText('Only Technical Support Staff can manage equipment reservations.')).toBeInTheDocument();
      unmount();
      backend({ list: () => json({}, 500) });
      await openList();
      expect(screen.getByText('Unable to load equipment reservations.')).toBeInTheDocument();
      expect(screen.getByText('No equipment reservations yet')).toBeInTheDocument();
    });
});

describe('EquipmentReservation (new reservation)', () => {
  tc('FE-EQRES-005', 'EquipmentReservation (details)', 'Technical support opens an event that has no reservation yet.',
    'GET /equipment-reservation/<staff>/events/<id> loads it; "Reserve equipment" shows the event card and each item\'s requested, available and fixed reserve quantity with requirements ("—" when blank).',
    { steps: '1. Render with eventId 1.' },
    async () => {
      const f = backend();
      render(<EquipmentReservation user={USER} eventId={1} />);
      expect(screen.getByText('Loading equipment reservation…')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Reserve equipment' })).toBeInTheDocument();
      expect(f.mock.calls[0][0]).toMatch(/equipment-reservation\/t1\/events\/1$/);
      const card = document.querySelector('.reservation-event-card');
      expect(card).toHaveTextContent('Gala');
      expect(card).toHaveTextContent(date('2026-10-01'));
      expect(card).toHaveTextContent('Request #7');
      const mic = screen.getByText('Microphone').closest('tr');
      expect(mic.querySelector('.reservation-fixed-quantity')).toHaveTextContent('2');
      expect(mic).toHaveTextContent('8');
      expect(mic).toHaveTextContent('wireless');
      expect(screen.getByText('Projector').closest('tr')).toHaveTextContent('—');
      expect(qty()).toHaveLength(0);
      expect(screen.queryByText(/Reservation #/)).toBeNull();
      expect(confirmBtn()).toHaveTextContent('Confirm Reservation');
    });

  tc('FE-EQRES-006', 'EquipmentReservation (details)', 'Technical support confirms a new reservation.',
    'POST /equipment-reservation/<staff> sends event, request and each item\'s quantity; the success message shows and the page reloads as the managed reservation.',
    { steps: '1. Open event 1. 2. Click "Confirm Reservation".' },
    async () => {
      const f = backend({ detail: [fresh(), existing()], write: () => json({ message: 'Equipment reserved successfully.' }) });
      await openEvent();
      fireEvent.click(confirmBtn());
      expect(await screen.findByText('Equipment reserved successfully.')).toBeInTheDocument();
      const [url, options] = callsTo(f, '/equipment-reservation/t1', 'POST')[0];
      expect(url).toMatch(/equipment-reservation\/t1$/);
      expect(JSON.parse(options.body)).toEqual({ event_id: 1, request_id: 7, items: [{ equipment_id: 'MIC', reserved_quantity: 2 }, { equipment_id: 'PRJ', reserved_quantity: 1 }] });
      expect(await screen.findByRole('heading', { name: 'Manage equipment reservation' })).toBeInTheDocument();
    });

  tc('FE-EQRES-007', 'EquipmentReservation (validation)', 'A new reservation would reserve less than requested, more than is free, or nothing at all.',
    'Nothing is sent and the matching message is shown: full requested quantity required; "only has <n> available"; "There is no equipment to reserve."',
    { kind: 'Negative', data: 'reserved 1 of 2; requested 2 with 1 available; no items', steps: '1. Confirm each of the three reservations.' },
    async () => {
      const cases = [
        [fresh([newLine({ reserved_quantity: 1 })]), 'Microphone must initially reserve the full requested quantity of 2.'],
        [fresh([newLine({ available_quantity: 1 })]), 'Microphone only has 1 available.'],
        [fresh([]), 'There is no equipment to reserve.'],
      ];
      for (const [detail, message] of cases) {
        const f = backend({ detail });
        const { unmount } = render(<EquipmentReservation user={USER} eventId={1} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm Reservation' }));
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(callsTo(f, '/equipment-reservation/t1', 'POST')).toHaveLength(0);
        unmount();
      }
    });

  tc('FE-EQRES-008', 'EquipmentReservation (details)', 'The backend refuses the reservation, with and without a message.', 'The backend detail is shown; otherwise "Reservation could not be saved."',
    { kind: 'Negative', data: '409 "Projector only has 0 available during this event period."; 500 {}', steps: '1. Confirm with a 409. 2. Confirm with a bare 500.' },
    async () => {
      let reply = json({ detail: 'Projector only has 0 available during this event period.' }, 409);
      backend({ write: () => reply });
      await openEvent();
      fireEvent.click(confirmBtn());
      expect(await screen.findByText('Projector only has 0 available during this event period.')).toBeInTheDocument();
      reply = json({}, 500);
      fireEvent.click(confirmBtn());
      expect(await screen.findByText('Reservation could not be saved.')).toBeInTheDocument();
    });

  tc('FE-EQRES-009', 'EquipmentReservation (details)', 'A save is in flight.', 'The confirm button reads "Checking availability…" and is disabled.', { kind: 'State', pre: 'POST never resolves.', steps: '1. Click "Confirm Reservation".' },
    async () => {
      backend({ write: () => new Promise(() => {}) });
      await openEvent();
      fireEvent.click(confirmBtn());
      expect(await screen.findByRole('button', { name: 'Checking availability…' })).toBeDisabled();
    });

  tc('FE-EQRES-010', 'EquipmentReservation (details)', 'The event cannot be loaded, with and without a way back.',
    'The backend detail (or "Unable to load reservation.") is shown with a "← Back" button that calls onBack; without onBack no button is shown.',
    { kind: 'Negative', data: '404 "This event does not have an equipment request."; 500 {}', steps: '1. Return 404 with onBack. 2. Return a bare 500 without onBack.' },
    async () => {
      backend({ detail: () => json({ detail: 'This event does not have an equipment request.' }, 404) });
      const onBack = vi.fn();
      const { unmount } = render(<EquipmentReservation user={USER} eventId={1} onBack={onBack} />);
      expect(await screen.findByText('This event does not have an equipment request.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '← Back' }));
      expect(onBack).toHaveBeenCalled();
      unmount();
      backend({ detail: () => json({}, 500) });
      await openEvent();
      expect(screen.getByText('Unable to load reservation.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '← Back' })).toBeNull();
    });
});

describe('EquipmentReservation (existing reservation)', () => {
  tc('FE-EQRES-011', 'EquipmentReservation (manage)', 'Technical support lowers a reserved quantity and confirms.',
    '"Manage equipment reservation" shows the status pill and editable quantities; PUT /equipment-reservation/<staff>/<reservation> sends the new quantities and the page reloads.',
    { pre: 'Reservation 50 holds MIC x2 and PRJ x1.', data: 'MIC 2 -> 1', steps: '1. Open event 1. 2. Set MIC to 1. 3. Click "Confirm Reservation Changes".' },
    async () => {
      const onBack = vi.fn();
      const f = backend({ detail: existing(), write: () => json({ message: 'Equipment reservation updated successfully.' }) });
      await openEvent({ onBack });
      expect(screen.getByRole('heading', { name: 'Manage equipment reservation' })).toBeInTheDocument();
      expect(screen.getByText(/Reservation #50 ·/)).toHaveClass('reserved');
      expect(qty().map((i) => i.value)).toEqual(['2', '1']);
      fireEvent.change(qty()[0], { target: { value: '1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Reservation Changes' }));
      expect(await screen.findByText('Equipment reservation updated successfully.')).toBeInTheDocument();
      const [url, options] = callsTo(f, '/equipment-reservation/t1/50', 'PUT')[0];
      expect(url).toMatch(/equipment-reservation\/t1\/50$/);
      expect(JSON.parse(options.body)).toEqual({ items: [{ equipment_id: 'MIC', reserved_quantity: 1 }, { equipment_id: 'PRJ', reserved_quantity: 1 }] });
      await waitFor(() => expect(callsTo(f, '/events/1')).toHaveLength(2));
      fireEvent.click(screen.getByRole('button', { name: '← Back to Reservations' }));
      expect(onBack).toHaveBeenCalled();
    });

  tc('FE-EQRES-012', 'EquipmentReservation (validation)', 'Edited quantities are fractional, above the request, or all zero.',
    'Nothing is sent and the matching message is shown: whole number of 0 or more; cannot exceed the requested quantity; at least one item must remain reserved.',
    { kind: 'Negative', data: 'MIC 1.5; MIC 3 (requested 2); MIC 0 and PRJ 0', steps: '1. Enter each value. 2. Click confirm after each.' },
    async () => {
      const f = backend({ detail: existing() });
      await openEvent();
      const tryValues = (mic, prj, message) => {
        fireEvent.change(qty()[0], { target: { value: mic } });
        fireEvent.change(qty()[1], { target: { value: prj } });
        fireEvent.click(confirmBtn());
        expect(screen.getByText(message)).toBeInTheDocument();
      };
      tryValues('1.5', '1', 'Microphone must have a whole-number quantity of 0 or more.');
      tryValues('3', '1', 'Microphone cannot exceed the requested quantity of 2.');
      tryValues('0', '0', 'At least one equipment item must remain reserved. Cancel the reservation instead.');
      expect(callsTo(f, '/equipment-reservation/t1/50', 'PUT')).toHaveLength(0);
    });

  tc('FE-EQRES-013', 'EquipmentReservation (recheck)', 'The equipment request changed after the reservation was made.',
    '"Review equipment reservation" warns about the change, shows the current request, flags changed, removed and newly added items, and offers "Use Requested" per item and for all items.',
    { kind: 'State', pre: 'Status Needs Recheck. MIC reserved 2, requested 3; PRJ reserved 1 but removed from the request; CAM newly requested x1 (no reserved quantity yet); SPK matches.',
      steps: '1. Open event 1. 2. Click "Use Requested" on MIC. 3. Click "Use Current Requested Quantities". 4. Confirm.' },
    async () => {
      const f = backend({ detail: existing({ status: 'Needs Recheck', items: [
        reservedLine({ requested_quantity: 3 }),
        reservedLine({ equipment_id: 'PRJ', equipment_name: 'Projector', reserved_quantity: 1, requested_quantity: 0, currently_requested: false }),
        reservedLine({ equipment_id: 'CAM', equipment_name: 'Camera', reserved_quantity: null, requested_quantity: 1, currently_reserved: false }),
        reservedLine({ equipment_id: 'SPK', equipment_name: 'Speaker', reserved_quantity: 1, requested_quantity: 1 }),
      ] }) });
      await openEvent();
      expect(screen.getByRole('heading', { name: 'Review equipment reservation' })).toBeInTheDocument();
      expect(screen.getByText('Equipment request changed — reservation needs review')).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Current Request' })).toBeInTheDocument();
      const row = (name) => screen.getByText(name, { selector: 'strong' }).closest('tr');
      expect(row('Microphone')).toHaveClass('reservation-changed-row');
      expect(row('Microphone')).toHaveTextContent('Request changed');
      expect(row('Projector')).toHaveTextContent('Removed from current request');
      expect(row('Camera')).toHaveTextContent('Newly added to request');
      expect(within(row('Speaker')).getByText('✓ Matches')).toBeInTheDocument();
      expect(qty()[2]).toHaveValue(1);
      fireEvent.click(within(row('Microphone')).getByRole('button', { name: 'Use Requested' }));
      expect(qty()[0]).toHaveValue(3);
      fireEvent.change(qty()[2], { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use Current Requested Quantities' }));
      expect(qty().map((i) => i.value)).toEqual(['3', '0', '1', '1']);
      expect(screen.queryByRole('button', { name: 'Use Current Requested Quantities' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Reviewed Reservation' }));
      await waitFor(() => expect(callsTo(f, '/equipment-reservation/t1/50', 'PUT')).toHaveLength(1));
    });

  tc('FE-EQRES-014', 'EquipmentReservation (recheck)', 'An item has neither a reserved nor a requested quantity.', 'Its quantity input starts at 0 and matches the request.',
    { kind: 'Edge', data: 'reserved_quantity and requested_quantity missing', steps: '1. Open a Needs Recheck reservation with such an item.' },
    async () => {
      backend({ detail: existing({ status: 'needs recheck', items: [reservedLine(), reservedLine({ equipment_id: 'CAM', equipment_name: 'Camera', reserved_quantity: undefined, requested_quantity: undefined })] }) });
      await openEvent();
      expect(qty()[1]).toHaveValue(0);
      expect(within(screen.getByText('Camera', { selector: 'strong' }).closest('tr')).getByText('✓ Matches')).toBeInTheDocument();
    });

  tc('FE-EQRES-015', 'EquipmentReservation (cancel)', 'Technical support clicks "Cancel Reservation", declines, then confirms.',
    'Declining sends nothing; confirming sends DELETE /equipment-reservation/<staff>/<reservation> and returns to the reservation list.',
    { kind: 'State', steps: '1. Click "Cancel Reservation" and decline. 2. Click it again and confirm.' },
    async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      const onBack = vi.fn();
      const f = backend({ detail: existing() });
      await openEvent({ onBack });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Reservation' }));
      expect(callsTo(f, '/equipment-reservation/t1/50', 'DELETE')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Reservation' }));
      await waitFor(() => expect(onBack).toHaveBeenCalled());
      expect(callsTo(f, '/equipment-reservation/t1/50', 'DELETE')).toHaveLength(1);
      expect(confirm).toHaveBeenCalledTimes(2);
      confirm.mockRestore();
    });

  tc('FE-EQRES-016', 'EquipmentReservation (cancel)', 'The reservation is cancelled where there is no page to go back to.', 'The default "Equipment reservation cancelled successfully." message is shown and the page reloads.',
    { kind: 'Edge', data: 'no onBack; response without message', steps: '1. Render without onBack. 2. Cancel and confirm.' },
    async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const f = backend({ detail: existing(), write: () => json({}) });
      await openEvent();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Reservation' }));
      expect(await screen.findByText('Equipment reservation cancelled successfully.')).toBeInTheDocument();
      expect(callsTo(f, '/events/1')).toHaveLength(2);
      confirm.mockRestore();
    });

  tc('FE-EQRES-017', 'EquipmentReservation (cancel)', 'Cancelling fails, with and without a backend message.', 'The backend detail is shown; otherwise "Reservation could not be cancelled."',
    { kind: 'Negative', data: '400 "A completed reservation cannot be cancelled."; 500 {}', steps: '1. Cancel with a 400. 2. Cancel with a bare 500.' },
    async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      let reply = json({ detail: 'A completed reservation cannot be cancelled.' }, 400);
      backend({ detail: existing(), write: () => reply });
      await openEvent({ onBack: vi.fn() });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Reservation' }));
      expect(await screen.findByText('A completed reservation cannot be cancelled.')).toBeInTheDocument();
      reply = json({}, 500);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Reservation' }));
      expect(await screen.findByText('Reservation could not be cancelled.')).toBeInTheDocument();
      confirm.mockRestore();
    });

  tc('FE-EQRES-018', 'EquipmentReservation (manage)', 'A save succeeds without a message from the backend.', 'The default "Equipment reservation saved successfully." message is shown.',
    { kind: 'Edge', data: 'response {}', steps: '1. Open an existing reservation. 2. Confirm without changes.' },
    async () => {
      backend({ detail: existing(), write: () => json({}) });
      await openEvent();
      fireEvent.click(confirmBtn());
      expect(await screen.findByText('Equipment reservation saved successfully.')).toBeInTheDocument();
    });
});
