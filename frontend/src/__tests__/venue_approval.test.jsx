import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';

const request = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ request }));

import VenueApproval from '../venue_approval';

const booking = (o = {}) => ({
  request_id: 1, status: 'Pending', event_id: 10, event_name: 'Gala', venue_name: 'Hall A', start_datetime: '2026-10-03T09:00:00+08:00', end_datetime: '2026-10-05T17:00:00+08:00',
  accessibility_required: true, layout_required: 'Theatre', facilities_required: ['Parking', 'AV'], event_type: 'Dinner', event_capacity: 100,
  coordinator_name: 'Cara', coordinator_email: 'c@x', event_description: 'A gala', ...o,
});
const open = async () => { fireEvent.click(await screen.findByRole('button', { name: 'View details' })); return screen.getByRole('region', { name: 'Venue booking request details' }); };

describe('VenueApproval', () => {
  tc('FE-VENUE-001', 'VenueApproval', 'Venue staff opens the page.', 'A loading row shows, then /venue-booking-requests is fetched and each request lists event, venue, SGT start/end and status.',
    { pre: 'API returns one booking.', steps: '1. Render. 2. Wait for the table.' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(await screen.findByText('Gala')).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith('/venue-booking-requests');
      expect(screen.getByText('2026-10-03 09:00 SGT')).toBeInTheDocument();
      expect(screen.getByText('2026-10-05 17:00 SGT')).toBeInTheDocument();
      expect(screen.getByText('Hall A')).toBeInTheDocument();
    });

  tc('FE-VENUE-002', 'VenueApproval', 'There are no requests.', '"No venue booking requests found." is displayed.', { kind: 'Edge', steps: '1. Return an empty list.' },
    async () => { request.mockResolvedValue([]); render(<VenueApproval />); expect(await screen.findByText('No venue booking requests found.')).toBeInTheDocument(); });

  tc('FE-VENUE-003', 'VenueApproval', 'Loading fails.', 'The message "Unable to load venue booking requests. (<error>)" is shown.', { kind: 'Negative', data: '"Missing bearer token."', steps: '1. Reject the request call.' },
    async () => { request.mockRejectedValue(new Error('Missing bearer token.')); render(<VenueApproval />); expect(await screen.findByText('Unable to load venue booking requests. (Missing bearer token.)')).toBeInTheDocument(); });

  tc('FE-VENUE-004', 'VenueApproval', 'A booking has no event name.', 'The row falls back to "Event #<id>".', { kind: 'Edge', steps: '1. Return a booking with event_name null.' },
    async () => { request.mockResolvedValue([booking({ event_name: null })]); render(<VenueApproval />); expect(await screen.findByText('Event #10')).toBeInTheDocument(); });

  tc('FE-VENUE-005', 'RequestDetail', 'Staff clicks "View details".', 'A details panel shows status, venue, times, accessibility, layout, facilities, type, capacity, coordinator (with email) and description.', { steps: '1. Render. 2. Click "View details".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      const panel = await open();
      const p = within(panel);
      expect(p.getByText('Yes')).toBeInTheDocument();
      expect(p.getByText('Theatre')).toBeInTheDocument();
      expect(p.getByText('Parking, AV')).toBeInTheDocument();
      expect(p.getByText('Cara (c@x)')).toBeInTheDocument();
      expect(p.getByText('A gala')).toBeInTheDocument();
      expect(p.getByText('100')).toBeInTheDocument();
    });

  tc('FE-VENUE-006', 'RequestDetail', 'Optional values are missing.', 'Blank fields show "—"; accessibility shows "No"; timestamps show "—".', { kind: 'Edge', steps: '1. Open a booking with empty optional fields.' },
    async () => {
      request.mockResolvedValue([booking({ accessibility_required: false, layout_required: null, facilities_required: [], coordinator_name: null, event_description: null, start_datetime: null })]);
      render(<VenueApproval />);
      const panel = await open();
      expect(within(panel).getByText('No')).toBeInTheDocument();
      expect(within(panel).getAllByText('—').length).toBeGreaterThanOrEqual(5);
    });

  tc('FE-VENUE-007', 'RequestDetail', 'Coordinator has a name but no email.', 'Only the name is shown, without brackets.', { kind: 'Edge', steps: '1. Open a booking whose coordinator_email is null.' },
    async () => { request.mockResolvedValue([booking({ coordinator_email: null })]); render(<VenueApproval />); expect(within(await open()).getByText('Cara')).toBeInTheDocument(); });

  tc('FE-VENUE-008', 'RequestDetail', 'A Pending request is opened.', 'Approve and "Reject…" buttons are shown.', { steps: '1. Open a pending booking.' },
    async () => { request.mockResolvedValue([booking()]); render(<VenueApproval />); const p = within(await open()); expect(p.getByRole('button', { name: 'Approve' })).toBeInTheDocument(); expect(p.getByRole('button', { name: 'Reject…' })).toBeInTheDocument(); });

  tc('FE-VENUE-009', 'RequestDetail', 'An already-decided request is opened.', 'No Approve/Reject buttons; a Rejected request shows its reason and alternative venue.', { kind: 'State', data: 'status Rejected, reason "Double booked", alternative "Hall B"', steps: '1. Open a rejected booking.' },
    async () => {
      request.mockResolvedValue([booking({ status: 'Rejected', rejection_reason: 'Double booked', alternative_venue: 'Hall B' })]);
      render(<VenueApproval />);
      const p = within(await open());
      expect(p.queryByRole('button', { name: 'Approve' })).toBeNull();
      expect(p.getByText('Double booked')).toBeInTheDocument();
      expect(p.getByText('Hall B')).toBeInTheDocument();
    });

  tc('FE-VENUE-010', 'VenueApproval (approve)', 'Staff approves a request.', 'POST /venue-booking-requests/<id>/approve is sent, the row status becomes Approved and the message "Request for Gala approved." appears.', { steps: '1. Open a pending booking. 2. Click "Approve".' },
    async () => {
      request.mockResolvedValueOnce([booking()]).mockResolvedValueOnce(booking({ status: 'Approved' }));
      render(<VenueApproval />);
      fireEvent.click(within(await open()).getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('Request for Gala approved.')).toBeInTheDocument();
      expect(request).toHaveBeenLastCalledWith('/venue-booking-requests/1/approve', { method: 'POST', body: '{}' });
      expect(within(screen.getByRole('table')).getByText('Approved')).toBeInTheDocument();
    });

  tc('FE-VENUE-011', 'VenueApproval (reject)', 'Staff clicks "Reject…".', 'A form with optional reason and alternative-venue fields appears and the decision buttons are replaced by "Confirm rejection" / "Cancel".', { steps: '1. Open a pending booking. 2. Click "Reject…".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      fireEvent.click(within(await open()).getByRole('button', { name: 'Reject…' }));
      expect(screen.getByLabelText(/Reason for rejection \(optional\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm rejection' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    });

  tc('FE-VENUE-012', 'VenueApproval (reject)', 'Staff cancels the rejection form.', 'The Approve / Reject… buttons return without sending a request.', { kind: 'State', steps: '1. Click "Reject…". 2. Click "Cancel".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      fireEvent.click(within(await open()).getByRole('button', { name: 'Reject…' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(request).toHaveBeenCalledTimes(1);
    });

  tc('FE-VENUE-013', 'VenueApproval (reject)', 'Staff confirms a rejection with reason and alternative.', 'POST /reject is sent with {reason, alternative_venue}; the row shows Rejected and the message "Request for Gala rejected.".', { data: 'reason "Double booked", alternative "Hall B"', steps: '1. Click "Reject…". 2. Fill both fields. 3. Click "Confirm rejection".' },
    async () => {
      request.mockResolvedValueOnce([booking()]).mockResolvedValueOnce(booking({ status: 'Rejected', rejection_reason: 'Double booked', alternative_venue: 'Hall B' }));
      render(<VenueApproval />);
      fireEvent.click(within(await open()).getByRole('button', { name: 'Reject…' }));
      fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: 'Double booked' } });
      fireEvent.change(screen.getByLabelText(/Alternative venue/), { target: { value: 'Hall B' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
      expect(await screen.findByText('Request for Gala rejected.')).toBeInTheDocument();
      const [path, options] = request.mock.calls.at(-1);
      expect(path).toBe('/venue-booking-requests/1/reject');
      expect(JSON.parse(options.body)).toEqual({ reason: 'Double booked', alternative_venue: 'Hall B' });
    });

  tc('FE-VENUE-014', 'VenueApproval (decide)', 'The decision fails (e.g. already decided by someone else).', 'The error message is displayed and stays on screen while the list is reloaded.', { kind: 'Negative', data: '409 "This request was just decided by someone else."', steps: '1. Reject the decision call. 2. Click "Approve".', kind: 'Regression' },
    async () => {
      request.mockResolvedValueOnce([booking()]).mockRejectedValueOnce(new Error('This request was just decided by someone else.')).mockResolvedValueOnce([booking({ status: 'Approved' })]);
      render(<VenueApproval />);
      fireEvent.click(within(await open()).getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('This request was just decided by someone else.')).toBeInTheDocument();
      await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(within(screen.getByRole('table')).getByText('Approved')).toBeInTheDocument());
      expect(screen.getByText('This request was just decided by someone else.')).toBeInTheDocument();
    });

  tc('FE-VENUE-015', 'VenueApproval (decide)', 'A decision is in flight.', 'Approve and Reject… are disabled until it completes.', { kind: 'State', pre: 'Decision call never resolves.', steps: '1. Click "Approve". 2. Inspect the buttons.' },
    async () => {
      request.mockResolvedValueOnce([booking()]).mockReturnValueOnce(new Promise(() => {}));
      render(<VenueApproval />);
      fireEvent.click(within(await open()).getByRole('button', { name: 'Approve' }));
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Reject…' })).toBeDisabled();
    });

  tc('FE-VENUE-016', 'VenueApproval', 'Staff clicks Close on the details panel.', 'The panel disappears.', { kind: 'State', steps: '1. Open a booking. 2. Click "Close".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('region', { name: 'Venue booking request details' })).toBeNull();
    });
});
