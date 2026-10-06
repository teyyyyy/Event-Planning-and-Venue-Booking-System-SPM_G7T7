import React from 'react';
import { describe, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const request = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ request }));

import VenueCalendar from '../components/VenueCalendar';
import VenueStaffCalendar from '../VenueStaffCalendar';

const VENUES = [{ venue_id: 1, name: 'Hall A' }, { venue_id: 2, name: 'Hall B' }];
// Wednesday 7 Oct 2026, so the calendar opens on the week of Monday 5 Oct.
const WEDNESDAY = new Date(2026, 9, 7, 10, 0);

const weekLabel = (monday) => {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;
};
const pickVenue = (id) => fireEvent.change(screen.getByRole('combobox'), { target: { value: String(id) } });
// Cell for an hour row (0-23) and a weekday column (0 = Monday).
const cell = (hour, day) => document.querySelectorAll('tbody tr')[hour].querySelectorAll('td')[day + 1];
const blocks = () => [...document.querySelectorAll('tbody td div[title]')];

describe('VenueCalendar', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(WEDNESDAY); });
  afterEach(() => { vi.useRealTimers(); });

  tc('FE-VCAL-001', 'VenueCalendar', 'The calendar opens before a venue is chosen.', 'The venue picker lists every venue, the current Monday-Sunday week is shown and the schedule asks for a venue; nothing is fetched.',
    { pre: 'Today is Wednesday 7 Oct 2026.', steps: '1. Render with two venues.' },
    () => {
      render(<VenueCalendar venues={VENUES} />);
      expect(screen.getByRole('option', { name: 'Select a venue to view...' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Hall B' })).toBeInTheDocument();
      expect(screen.getByText(weekLabel(new Date(2026, 9, 5)))).toBeInTheDocument();
      expect(screen.getByText('Please select a venue to view its schedule.')).toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    });

  tc('FE-VCAL-002', 'VenueCalendar', 'The calendar is opened on a Sunday.', 'The week shown is the one that started on the previous Monday.', { kind: 'Edge', pre: 'Today is Sunday 11 Oct 2026.', steps: '1. Render on a Sunday.' },
    () => {
      vi.setSystemTime(new Date(2026, 9, 11, 10, 0));
      render(<VenueCalendar venues={VENUES} />);
      expect(screen.getByText(weekLabel(new Date(2026, 9, 5)))).toBeInTheDocument();
    });

  tc('FE-VCAL-003', 'VenueCalendar', 'A venue is chosen.',
    'Approved and Pending bookings for that venue are requested; a 7-day grid with 24 hourly rows (12 AM … 11 PM) is shown and scrolled to 8 AM.',
    { steps: '1. Choose "Hall A".' },
    async () => {
      request.mockResolvedValue([]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(request).toHaveBeenCalledWith('/venue-booking-requests/venues/1?include_pending=true'));
      const hours = [...document.querySelectorAll('tbody tr')].map((row) => row.querySelector('td').textContent);
      expect(hours).toHaveLength(24);
      expect([hours[0], hours[1], hours[12], hours[13], hours[23]]).toEqual(['12 AM', '1 AM', '12 PM', '1 PM', '11 PM']);
      expect(document.querySelectorAll('thead th')).toHaveLength(8);
      expect(document.querySelector('.request-table-wrapper').scrollTop).toBe(480);
    });

  tc('FE-VCAL-004', 'VenueCalendar', 'The venue has an approved booking, a pending booking and two incomplete records this week.',
    'Each booking is drawn in its day column at its start hour, offset by its start minute and as tall as its duration; pending ones are labelled "(Pending)" and dashed; records without times are skipped and a missing event name shows "Unknown Event".',
    { pre: 'Approved Gala Wed 09:30-11:00 (times on the booking); Pending Talk Thu 14:00-15:00 (times on the event); one booking with no times; one approved booking Fri 08:00-09:00 with no event details.',
      steps: '1. Choose "Hall A".' },
    async () => {
      request.mockResolvedValue([
        { request_id: 1, status: 'Approved', start_datetime: '2026-10-07 09:30:00+00', end_datetime: '2026-10-07 11:00:00+00', 'Event Details': { event_name: 'Gala' } },
        { request_id: 2, status: 'Pending', 'Event Details': { event_name: 'Talk', start_datetime: '2026-10-08 14:00:00', end_datetime: '2026-10-08 15:00:00' } },
        { request_id: 3, status: 'Approved', 'Event Details': { event_name: 'No times' } },
        { request_id: 4, status: 'Approved', start_datetime: '2026-10-09 08:00:00', end_datetime: '2026-10-09 09:00:00' },
      ]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(blocks()).toHaveLength(3));
      const gala = cell(9, 2).querySelector('div');
      expect(gala).toHaveTextContent('Gala');
      expect(gala).toHaveTextContent('9:30 AM - 11:00 AM');
      expect(gala).toHaveAttribute('title', 'Gala (Req ID: 1) - Approved');
      expect(gala.style.top).toBe('30px');
      expect(gala.style.height).toBe('90px');
      expect(gala.style.border).toContain('solid');
      const talk = cell(14, 3).querySelector('div');
      expect(talk).toHaveTextContent('Talk (Pending)');
      expect(talk).toHaveTextContent('2:00 PM - 3:00 PM');
      expect(talk.style.border).toContain('dashed');
      expect(cell(8, 4).querySelector('div')).toHaveTextContent('Unknown Event');
      expect(screen.queryByText(/No times/)).toBeNull();
    });

  tc('FE-VCAL-005', 'VenueCalendar', 'A booking runs past midnight.', 'It is split per day: until midnight on the first day, and from 12 AM to its end on the next day.',
    { kind: 'Edge', data: 'Wed 22:00 - Thu 02:00', steps: '1. Choose "Hall A" with an overnight booking.' },
    async () => {
      request.mockResolvedValue([{ request_id: 5, status: 'Approved', start_datetime: '2026-10-07 22:00:00', end_datetime: '2026-10-08 02:00:00', 'Event Details': { event_name: 'Night run' } }]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(blocks()).toHaveLength(2));
      expect(cell(22, 2).querySelector('div')).toHaveTextContent('10:00 PM - 12:00 AM');
      expect(cell(22, 2).querySelector('div').style.height).toBe('120px');
      expect(cell(0, 3).querySelector('div')).toHaveTextContent('12:00 AM - 2:00 AM');
    });

  tc('FE-VCAL-006', 'VenueCalendar', 'The user moves to the next week and back.', 'The week label changes by seven days each time and only bookings in the visible week are drawn.',
    { kind: 'State', pre: 'One booking on Wed 14 Oct.', steps: '1. Choose "Hall A". 2. Click "Next Week →". 3. Click "← Prev Week".' },
    async () => {
      request.mockResolvedValue([{ request_id: 6, status: 'Approved', start_datetime: '2026-10-14 10:00:00', end_datetime: '2026-10-14 11:00:00', 'Event Details': { event_name: 'Next week' } }]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(request).toHaveBeenCalled());
      expect(blocks()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Next Week →' }));
      expect(screen.getByText(weekLabel(new Date(2026, 9, 12)))).toBeInTheDocument();
      expect(await screen.findByText('Next week')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '← Prev Week' }));
      expect(screen.getByText(weekLabel(new Date(2026, 9, 5)))).toBeInTheDocument();
      expect(blocks()).toHaveLength(0);
    });

  tc('FE-VCAL-007', 'VenueCalendar', 'Loading bookings fails, then the venue is cleared.', 'The error is logged and an empty grid is shown; clearing the venue returns to the "select a venue" message.',
    { kind: 'Negative', data: 'request rejects "Network down"', steps: '1. Choose "Hall A" while the request fails. 2. Choose the placeholder option.' },
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      request.mockRejectedValue(new Error('Network down'));
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(log).toHaveBeenCalledWith('Failed to load calendar bookings', expect.any(Error)));
      expect(blocks()).toHaveLength(0);
      pickVenue('');
      expect(screen.getByText('Please select a venue to view its schedule.')).toBeInTheDocument();
      log.mockRestore();
    });
});

describe('VenueStaffCalendar', () => {
  tc('FE-VCAL-008', 'VenueStaffCalendar', 'Venue staff opens the availability calendar.', 'A loading message shows, then the venue list is fetched and offered in the calendar.',
    { steps: '1. Render. 2. Wait for the calendar.' },
    async () => {
      request.mockResolvedValue(VENUES);
      render(<VenueStaffCalendar />);
      expect(screen.getByText('Loading calendar data...')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Venue Availability Calendar' })).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith('/venues');
      expect(screen.getByRole('option', { name: 'Hall A' })).toBeInTheDocument();
    });

  tc('FE-VCAL-009', 'VenueStaffCalendar', 'The venue list cannot be loaded.', 'The error is logged and the calendar still opens with no venues to choose.',
    { kind: 'Negative', data: 'request rejects', steps: '1. Make /venues fail. 2. Render.' },
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      request.mockRejectedValue(new Error('Forbidden'));
      render(<VenueStaffCalendar />);
      expect(await screen.findByRole('heading', { name: 'Venue Availability Calendar' })).toBeInTheDocument();
      expect(log).toHaveBeenCalledWith('Failed to fetch calendar data:', expect.any(Error));
      expect(screen.getAllByRole('option')).toHaveLength(1);
      log.mockRestore();
    });
});
