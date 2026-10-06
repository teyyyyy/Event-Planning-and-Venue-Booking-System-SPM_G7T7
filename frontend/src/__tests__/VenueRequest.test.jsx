import React from 'react';
import { describe, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { tc } from '../test/tc';
import { json, mockFetch, callsTo } from '../test/helpers';

import VenueRequest from '../VenueRequest';

const USER = { id: 'c1' };
const HALL_A = { venue_id: 1, name: 'Hall A', location: 'Singapore', capacity: 100, layouts: ['Theatre', 'Banquet'], facilities: ['Wi-Fi', 'Projector'], accessible: 1 };
const HALL_B = { venue_id: 2, name: 'Hall B', location: 'Jurong', capacity: 30, layouts: ['Classroom'], facilities: ['Wi-Fi'], accessible: 0 };
const GALA = { id: 1, event_name: 'Gala', event_date: '2026-10-01', start_datetime: '2026-10-01T09:00:00+08:00', end_datetime: '2026-10-01T17:00:00+08:00', event_capacity: 50, layout_required: 'Theatre', facilities_required: ['Wi-Fi'], accessibility_required: 1 };
const WORKSHOP = { id: 2, event_name: 'Workshop', event_date: '2026-10-02', start_datetime: '2026-10-02T10:00:00+08:00', end_datetime: '2026-10-02T12:00:00+08:00', event_capacity: null, layout_required: null, facilities_required: [], accessibility_required: 0 };
const SUBMISSION = { request_id: 5, event_id: 1, venue_id: 1, status: 'Approved', 'Event Details': { start_datetime: '2026-10-01T09:30:00+08:00', end_datetime: '2026-10-01T17:00:00+08:00' } };

function backend(o = {}) {
  const d = { venues: [HALL_A, HALL_B], events: [GALA, WORKSHOP], submitted: [], booked: [], post: () => json({ request_id: 9 }), ...o };
  const pick = (v) => (v instanceof Function ? v() : json(v));
  return mockFetch((url, opts) => {
    if ((opts.method || 'GET') === 'POST') return d.post(url, opts);
    if (url.includes('/venue-booking-requests/venues/')) return pick(d.booked);
    if (url.includes('/venue-booking-requests/coordinators/')) return pick(d.submitted);
    if (url.includes('/event-coordinators/')) return pick(d.events);
    if (url.endsWith('/venues')) return pick(d.venues);
    return json({}, 404);
  });
}
const ready = async (props = { user: USER }) => { render(<VenueRequest {...props} />); await screen.findByText('Submit venue request'); };
const eventSelect = () => document.querySelector('select');
const pickEvent = (id) => fireEvent.change(eventSelect(), { target: { value: String(id) } });
const submitBtn = () => screen.getByRole('button', { name: /Submit Request|Submitting…/ });
const chooseVenue = async (name = 'Hall A') => fireEvent.click(within((await screen.findByText(name)).closest('tr')).getByRole('button', { name: 'Select Venue' }));

describe('VenueRequest', () => {
  tc('FE-VREQ-001', 'VenueRequest', 'A coordinator opens the page.', 'A loading message shows, then the venue catalogue, the coordinator\'s events and their submissions are all fetched.', { steps: '1. Render. 2. Wait for the form.' },
    async () => {
      const f = backend();
      render(<VenueRequest user={USER} />);
      expect(screen.getByText('Loading venue request page…')).toBeInTheDocument();
      expect(await screen.findByText('Submit venue request')).toBeInTheDocument();
      expect(callsTo(f, '/venues')[0][0]).toMatch(/\/venues$/);
      expect(callsTo(f, '/event-coordinators/c1/events')).toHaveLength(1);
      expect(callsTo(f, '/venue-booking-requests/coordinators/c1')).toHaveLength(1);
      expect(screen.getByRole('option', { name: 'Gala — 2026-10-01' })).toBeInTheDocument();
    });

  tc('FE-VREQ-002', 'VenueRequest', 'The user object has no id.', 'Only the venue catalogue is requested; events and submissions are not.', { kind: 'Edge', data: 'user = {}', steps: '1. Render with user = {}.' },
    async () => {
      const f = backend();
      await ready({ user: {} });
      expect(callsTo(f, '/event-coordinators')).toHaveLength(0);
      expect(callsTo(f, '/venue-booking-requests/coordinators')).toHaveLength(0);
    });

  tc('FE-VREQ-003', 'VenueRequest', 'The venue catalogue fails to load.', 'A page error "Unable to load venue catalogue." is shown when the backend gives no detail.', { kind: 'Negative', steps: '1. Return 500 for /venues.' },
    async () => { backend({ venues: () => json({}, 500) }); await ready(); expect(screen.getByText('Unable to load venue catalogue.')).toBeInTheDocument(); });

  tc('FE-VREQ-004', 'VenueRequest', 'Loading the coordinator\'s events fails.', 'The backend detail is shown as a page error.', { kind: 'Negative', data: '500 "Assigned events unavailable"', steps: '1. Return 500 with a detail for events.' },
    async () => { backend({ events: () => json({ detail: 'Assigned events unavailable' }, 500) }); await ready(); expect(screen.getByText('Assigned events unavailable')).toBeInTheDocument(); });

  tc('FE-VREQ-005', 'VenueRequest (event details)', 'The coordinator selects an event.', 'An Event Details table shows name, date, 12-hour timing, capacity, layout, facilities and accessibility.', { steps: '1. Select "Gala".' },
    async () => {
      backend();
      await ready();
      pickEvent(1);
      const row = (await screen.findByText('Event Details')).closest('.equipment-request-items').querySelector('tbody tr');
      expect(within(row).getByText('Gala')).toBeInTheDocument();
      expect(row).toHaveTextContent('9:00 AM - 5:00 PM');
      expect(row).toHaveTextContent('50');
      expect(row).toHaveTextContent('Theatre');
      expect(row).toHaveTextContent('Wi-Fi');
      expect(row).toHaveTextContent('Yes');
    });

  tc('FE-VREQ-006', 'VenueRequest (auto-filter)', 'An event with requirements is selected and venues each miss exactly one requirement.', 'Only the venue meeting every requirement (capacity, layout, accessibility and facilities) is listed.',
    { pre: 'Gala needs capacity 50, Theatre, accessible, Wi-Fi. Five venues: one fits; four each fail a single criterion.', steps: '1. Select "Gala".' },
    async () => {
      const ok = { venue_id: 1, name: 'Fits', location: 'x', capacity: 100, layouts: ['Theatre'], facilities: ['Wi-Fi'], accessible: 1 };
      backend({ venues: [ok,
        { ...ok, venue_id: 2, name: 'TooSmall', capacity: 30 }, { ...ok, venue_id: 3, name: 'WrongLayout', layouts: ['Banquet'] },
        { ...ok, venue_id: 4, name: 'NotAccessible', accessible: 0 }, { ...ok, venue_id: 5, name: 'NoWifi', facilities: ['Projector'] }] });
      await ready();
      pickEvent(1);
      expect(await screen.findByText('Fits')).toBeInTheDocument();
      ['TooSmall', 'WrongLayout', 'NotAccessible', 'NoWifi'].forEach((name) => expect(screen.queryByText(name)).toBeNull());
      expect(screen.getByText('Venues auto-filtered by event requirements')).toBeInTheDocument();
    });

  tc('FE-VREQ-007', 'VenueRequest (auto-filter)', 'An event with no requirements is selected.', 'All venues are listed.', { kind: 'Edge', steps: '1. Select "Workshop".' },
    async () => { backend(); await ready(); pickEvent(2); expect(await screen.findByText('Hall A')).toBeInTheDocument(); expect(screen.getByText('Hall B')).toBeInTheDocument(); });

  tc('FE-VREQ-008', 'VenueRequest (manual filters)', 'The coordinator opens Manual Filtering and sets a minimum capacity above every venue.', '"No venues match your current filters." appears; "Clear Filters" restores the list.', { data: 'minimum capacity 200', steps: '1. Select "Workshop". 2. Click "Manual Filtering". 3. Enter 200. 4. Click "Clear Filters".' },
    async () => {
      backend();
      await ready();
      pickEvent(2);
      fireEvent.click(await screen.findByRole('button', { name: 'Manual Filtering' }));
      fireEvent.change(document.querySelector('input[type=number]'), { target: { value: '200' } });
      expect(await screen.findByText('No venues match your current filters.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
      expect(await screen.findByText('Hall A')).toBeInTheDocument();
      expect(document.querySelector('input[type=number]')).toHaveValue(null);
    });

  tc('FE-VREQ-009', 'VenueRequest (manual filters)', 'The coordinator filters by layout, by facility and by accessibility in turn.', 'Layout "Classroom" leaves Hall B; facility "Projector" leaves Hall A; "Requires Accessibility" leaves Hall A.', { steps: '1. Select "Workshop", open Manual Filtering. 2. Apply each filter separately.' },
    async () => {
      backend();
      await ready();
      pickEvent(2);
      fireEvent.click(await screen.findByRole('button', { name: 'Manual Filtering' }));
      const layout = screen.getAllByRole('combobox')[1];
      fireEvent.change(layout, { target: { value: 'Classroom' } });
      expect(screen.queryByText('Hall A')).toBeNull();
      expect(screen.getByText('Hall B')).toBeInTheDocument();
      fireEvent.change(layout, { target: { value: '' } });
      fireEvent.click(screen.getByLabelText('Projector'));
      expect(screen.getByText('Hall A')).toBeInTheDocument();
      expect(screen.queryByText('Hall B')).toBeNull();
      fireEvent.click(screen.getByLabelText('Projector'));
      fireEvent.click(screen.getByLabelText('Requires Accessibility'));
      expect(screen.getByText('Hall A')).toBeInTheDocument();
      expect(screen.queryByText('Hall B')).toBeNull();
    });

  tc('FE-VREQ-010', 'VenueRequest (select venue)', 'The coordinator picks a venue for an event.', 'Venue details show with a read-only timing summary taken from the event (no editable times); "Select Different Venue" returns to the catalogue.', { steps: '1. Select "Gala". 2. Click "Select Venue" for Hall A. 3. Click "Select Different Venue".' },
    async () => {
      backend();
      await ready();
      pickEvent(1);
      await chooseVenue();
      expect(await screen.findByText('Venue Booking Details')).toBeInTheDocument();
      const summary = screen.getByText('Event Timing Summary').closest('.equipment-item-card');
      expect(summary).toHaveTextContent('Date: 2026-10-01');
      expect(summary).toHaveTextContent('Time: 9:00 AM - 5:00 PM');
      expect(document.querySelector('input[type=datetime-local]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Select Different Venue' }));
      expect(await screen.findByText('Venue Catalogue')).toBeInTheDocument();
    });

  tc('FE-VREQ-011', 'VenueRequest (validation)', 'No event or venue is chosen yet, then both are.', '"Submit Request" is disabled until both an event and a venue are chosen.', { kind: 'State', steps: '1. Inspect the button. 2. Choose an event and venue.' },
    async () => {
      backend();
      await ready();
      expect(submitBtn()).toBeDisabled();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
    });

  tc('FE-VREQ-012', 'VenueRequest (validation)', 'The form is submitted (e.g. with Enter) before a venue is chosen.', 'An error dialog "Please ensure an event and venue are selected." shows and nothing is sent.', { kind: 'Negative', data: 'event chosen, no venue', steps: '1. Select "Gala". 2. Submit the form.' },
    async () => {
      const f = backend();
      await ready();
      pickEvent(1);
      fireEvent.submit(document.querySelector('form.request-form'));
      expect(await screen.findByText('Please ensure an event and venue are selected.')).toBeInTheDocument();
      expect(callsTo(f, '/venue-booking-requests/venues/')).toHaveLength(0);
      expect(callsTo(f, '/venue-bookings', 'POST')).toHaveLength(0);
    });

  tc('FE-VREQ-013', 'VenueRequest (submit)', 'A valid request for a free venue is submitted.', 'The venue\'s approved bookings are checked, then POST /venue-bookings sends event, venue and coordinator (times come from the event); a success dialog names the request id, the form resets and submissions are reloaded.',
    { pre: 'Hall A has no approved bookings.', data: 'event 1, venue 1, 09:00-17:00', steps: '1. Choose event and venue. 2. Click "Submit Request".' },
    async () => {
      const f = backend();
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText('Venue request #9 was submitted successfully.')).toBeInTheDocument();
      expect(callsTo(f, '/venue-booking-requests/venues/1', 'GET')).toHaveLength(1);
      const [url, options] = callsTo(f, '/venue-bookings', 'POST')[0];
      expect(url).toMatch(/\/venue-bookings$/);
      expect(JSON.parse(options.body)).toEqual({ event_id: 1, venue_id: 1, coordinator_id: 'c1' });
      await waitFor(() => expect(callsTo(f, '/venue-booking-requests/coordinators/c1')).toHaveLength(2));
      expect(await screen.findByText('Submit venue request')).toBeInTheDocument();
      expect(eventSelect()).toHaveValue('');
    });

  tc('FE-VREQ-014', 'VenueRequest (submit)', 'The venue already has an approved booking overlapping the requested time.', 'An error dialog says the venue is already booked and no POST is sent.', { kind: 'Negative', pre: 'Approved booking 08:00-10:00 on the same day.', steps: '1. Choose event and venue. 2. Click "Submit Request".' },
    async () => {
      const f = backend({ booked: [{ start_datetime: '2026-10-01 08:00:00+00', end_datetime: '2026-10-01 10:00:00+00' }] });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText(/already booked for the selected time period/)).toBeInTheDocument();
      expect(callsTo(f, '/venue-bookings', 'POST')).toHaveLength(0);
    });

  tc('FE-VREQ-015', 'VenueRequest (submit)', 'An approved booking ends exactly when the requested slot starts (back-to-back).', 'It is not treated as an overlap and the request is submitted.', { kind: 'Edge', pre: 'Approved booking ends 09:00; request starts 09:00.', steps: '1. Choose event and venue. 2. Submit.' },
    async () => {
      const f = backend({ booked: [{ start_datetime: '2026-10-01 07:00:00+00', end_datetime: '2026-10-01 09:00:00+00' }] });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText(/was submitted successfully/)).toBeInTheDocument();
      expect(callsTo(f, '/venue-bookings', 'POST')).toHaveLength(1);
    });

  tc('FE-VREQ-016', 'VenueRequest (submit)', 'The availability check itself fails.', 'An error dialog "Unable to verify venue availability." shows and no POST is sent.', { kind: 'Negative', steps: '1. Return 500 for the availability call. 2. Submit.' },
    async () => {
      const f = backend({ booked: () => json({}, 500) });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText('Unable to verify venue availability.')).toBeInTheDocument();
      expect(callsTo(f, '/venue-bookings', 'POST')).toHaveLength(0);
    });

  tc('FE-VREQ-017', 'VenueRequest (submit)', 'The backend rejects the booking with a message.', 'An error dialog shows the backend message.', { kind: 'Negative', data: '400 "Venue is closed on Sundays."', steps: '1. Return 400 for the POST. 2. Submit.' },
    async () => {
      backend({ post: () => json({ detail: 'Venue is closed on Sundays.' }, 400) });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText('Venue is closed on Sundays.')).toBeInTheDocument();
    });

  tc('FE-VREQ-018', 'VenueRequest (submit)', 'The database reports a duplicate booking for the event (unique-constraint error 23505).', 'A friendly message "A venue booking request has already been submitted for this event." replaces the raw database text.', { kind: 'Negative', data: '"duplicate key … 23505"', steps: '1. Return a 23505 error for the POST. 2. Submit.' },
    async () => {
      backend({ post: () => json({ detail: 'duplicate key value violates unique constraint 23505' }, 500) });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText('A venue booking request has already been submitted for this event.')).toBeInTheDocument();
    });

  tc('FE-VREQ-019', 'VenueRequest (submit)', 'A submission is in flight.', 'The button reads "Submitting…" and is disabled.', { kind: 'State', pre: 'POST never resolves.', steps: '1. Submit. 2. Inspect the button.' },
    async () => {
      backend({ post: () => new Promise(() => {}) });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByRole('button', { name: 'Submitting…' })).toBeDisabled();
    });

  tc('FE-VREQ-020', 'VenueRequest (submissions)', 'The coordinator opens "My Submissions".', 'Each request shows its event id, event and venue names (mapped from ids), the event\'s date and 12-hour times, and status.', { pre: 'One Approved request for Gala at Hall A; the event runs 09:30-17:00.', steps: '1. Click "My Submissions".' },
    async () => {
      backend({ submitted: [SUBMISSION] });
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'My Submissions' }));
      const row = (await screen.findByText('Gala')).closest('tr');
      expect(row).toHaveTextContent('5');
      expect(row).toHaveTextContent('Hall A');
      expect(row).toHaveTextContent('2026-10-01');
      expect(row).toHaveTextContent('9:30 AM');
      expect(row).toHaveTextContent('5:00 PM');
      expect(within(row).getByText('Approved')).toBeInTheDocument();
    });

  tc('FE-VREQ-021', 'VenueRequest (submissions)', 'A request refers to an event and venue that are not in the loaded lists, and has no status.', 'The raw ids are shown as names and the status defaults to "Pending".', { kind: 'Edge', data: 'event_id 999, venue_id 998, no status', steps: '1. Open "My Submissions" with such a request.' },
    async () => {
      backend({ submitted: [{ request_id: 6, event_id: 999, venue_id: 998, 'Event Details': null }] });
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'My Submissions' }));
      const row = (await screen.findByText('999')).closest('tr');
      expect(row).toHaveTextContent('998');
      expect(within(row).getByText('Pending')).toBeInTheDocument();
    });

  tc('FE-VREQ-022', 'VenueRequest (submissions)', 'Requests start just after midnight and just after noon.', 'Times render as "12:30 AM" and "12:05 PM".', { kind: 'Edge', data: '00:30 and 12:05', steps: '1. Open "My Submissions" with such times.' },
    async () => {
      backend({ submitted: [{ ...SUBMISSION, 'Event Details': { start_datetime: '2026-10-01T00:30:00', end_datetime: '2026-10-01T12:05:00' } }] });
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'My Submissions' }));
      const row = (await screen.findByText('Gala')).closest('tr');
      expect(row).toHaveTextContent('12:30 AM');
      expect(row).toHaveTextContent('12:05 PM');
    });

  tc('FE-VREQ-023', 'VenueRequest (submissions)', 'The coordinator has no submissions.', '"No venue requests have been submitted yet." is shown.', { kind: 'Edge', steps: '1. Open "My Submissions" with an empty list.' },
    async () => { backend(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'My Submissions' })); expect(await screen.findByText('No venue requests have been submitted yet.')).toBeInTheDocument(); });

  tc('FE-VREQ-024', 'VenueRequest (tabs)', 'The coordinator picks a venue, then switches to My Submissions and back.', 'The venue selection is cleared and the catalogue is shown again.', { kind: 'State', steps: '1. Select event and venue. 2. Click "My Submissions". 3. Click "Request Venue".' },
    async () => {
      backend();
      await ready();
      pickEvent(1);
      await chooseVenue();
      await screen.findByText('Venue Booking Details');
      fireEvent.click(screen.getByRole('button', { name: 'My Submissions' }));
      fireEvent.click(screen.getByRole('button', { name: 'Request Venue' }));
      expect(screen.queryByText('Venue Booking Details')).toBeNull();
    });

  tc('FE-VREQ-025', 'VenueRequest (notice)', 'The user closes the result dialog.', 'The dialog disappears.', { kind: 'State', steps: '1. Trigger an error dialog. 2. Click "Close".' },
    async () => {
      backend({ post: () => json({ detail: 'Nope' }, 400) });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      await screen.findByRole('alertdialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

  tc('FE-VREQ-026', 'VenueRequest (submit)', 'An existing booking only has its times on the linked event, and another booking has no times at all.',
    'Nested "Event Details" times are used for the overlap check; a booking without times is ignored.', { kind: 'Edge', pre: 'Pending booking whose event runs 16:00-18:00; a booking with no times.', steps: '1. Choose Gala (09:00-17:00) and Hall A. 2. Submit.' },
    async () => {
      const f = backend({ booked: [{ 'Event Details': null }, { 'Event Details': { start_datetime: '2026-10-01 16:00:00+00', end_datetime: '2026-10-01 18:00:00+00' } }] });
      await ready();
      pickEvent(1);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText(/already booked for the selected time period/)).toBeInTheDocument();
      expect(callsTo(f, '/venue-bookings', 'POST')).toHaveLength(0);
    });

  tc('FE-VREQ-027', 'VenueRequest (submissions)', 'The coordinator clicks a rejected submission.', 'A "Booking Request Details" dialog shows the status, rejection reason and decision time; "Close" dismisses it.',
    { pre: 'Request 5 Rejected with reason "Double booked".', steps: '1. Open "My Submissions". 2. Click the row. 3. Click "Close".' },
    async () => {
      backend({ submitted: [{ ...SUBMISSION, status: 'Rejected', rejection_reason: 'Double booked', decided_at: '2026-09-20T10:00:00Z' }] });
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'My Submissions' }));
      fireEvent.click((await screen.findByText('Gala')).closest('tr'));
      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByText('Booking Request Details')).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Status: Rejected');
      expect(dialog).toHaveTextContent('Rejection Reason: Double booked');
      expect(dialog).toHaveTextContent(`Decided At: ${new Date('2026-09-20T10:00:00Z').toLocaleString()}`);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

  tc('FE-VREQ-028', 'VenueRequest (submissions)', 'The coordinator clicks a pending submission, then clicks outside the dialog.', 'Only the status is shown (no reason or decision time); clicking the backdrop closes the dialog.',
    { kind: 'Edge', pre: 'Request 5 Pending, undecided.', steps: '1. Open "My Submissions". 2. Click the row. 3. Click the backdrop.' },
    async () => {
      backend({ submitted: [{ ...SUBMISSION, status: 'Pending', rejection_reason: 'stale' }] });
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'My Submissions' }));
      fireEvent.click((await screen.findByText('Gala')).closest('tr'));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent('Status: Pending');
      expect(dialog).not.toHaveTextContent('Rejection Reason');
      expect(dialog).not.toHaveTextContent('Decided At');
      fireEvent.click(document.querySelector('.notice-backdrop'));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

  tc('FE-VREQ-029', 'VenueRequest (tabs)', 'The coordinator opens the "Venue Calendar" tab.', 'The availability calendar is shown with the loaded venues to choose from.', { steps: '1. Click "Venue Calendar".' },
    async () => {
      backend();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Venue Calendar' }));
      expect(screen.getByRole('heading', { name: 'Venue Availability Calendar' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Hall B' })).toBeInTheDocument();
      expect(screen.getByText('Please select a venue to view its schedule.')).toBeInTheDocument();
    });

  tc('FE-VREQ-030', 'VenueRequest', 'Loading the coordinator\'s submissions fails without a detail.', 'A page error "Unable to load submitted requests." is shown.', { kind: 'Negative', steps: '1. Return 500 for the submissions list.' },
    async () => { backend({ submitted: () => json({}, 500) }); await ready(); expect(screen.getByText('Unable to load submitted requests.')).toBeInTheDocument(); });

  tc('FE-VREQ-031', 'VenueRequest (event details)', 'The coordinator selects an event that has no start or end time, picks a venue and submits.', 'The Event Details table renders with "—" as the timing; submitting shows an error that the event has no times, and neither the availability check nor the POST is sent.',
    { kind: 'Edge', data: 'start_datetime = null, end_datetime = null', steps: '1. Select "Offsite". 2. Click "Select Venue" for Hall A. 3. Click "Submit Request".' },
    async () => {
      const f = backend({ events: [{ ...WORKSHOP, id: 3, event_name: 'Offsite', start_datetime: null, end_datetime: null }] });
      await ready();
      pickEvent(3);
      const row = (await screen.findByText('Event Details')).closest('.equipment-request-items').querySelector('tbody tr');
      expect(within(row).getByText('Offsite')).toBeInTheDocument();
      expect(within(row).getAllByRole('cell')[2]).toHaveTextContent(/^—$/);
      await chooseVenue();
      await waitFor(() => expect(submitBtn()).toBeEnabled());
      fireEvent.click(submitBtn());
      expect(await screen.findByText(/This event has no start or end time/)).toBeInTheDocument();
      expect(callsTo(f, '/venue-booking-requests/venues/')).toHaveLength(0);
      expect(callsTo(f, '/venue-bookings', 'POST')).toHaveLength(0);
    });
});
