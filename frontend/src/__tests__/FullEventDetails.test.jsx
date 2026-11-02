import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { tc } from '../test/tc';

import FullEventDetails from '../components/FullEventDetails';

const DETAILS = {
  event: {
    id: 10,
    event_name: 'Annual Gala',
    event_type: 'Corporate',
    event_date: '2026-11-10',
    event_end_date: '2026-11-11',
    event_capacity: 120,
    start_time: '09:30:00',
    end_time: '17:45:00',
    layout_required: 'Theatre',
    equipment_required: ['Projector', 'Microphone'],
    facilities_required: ['Wi-Fi', 'Stage'],
    accessibility_required: true,
    equipment_placement: 'Projector at front of hall',
    crowd_movement: 'Guests enter through the main entrance',
    description: 'Annual company event',
  },
  venue_bookings: [
    {
      request_id: 5,
      venue_id: 1,
      status: 'Approved',
      Venues: {
        venue_name: 'Grand Hall',
      },
    },
  ],
  equipment_items: [
    {
      equipment_id: 20,
      equipment_name: 'Projector',
      reserved_quantity: 2,
    },
  ],
  safety_check: {
    status: 'Approved',
    comments: 'All safety requirements satisfied.',
    decided_at: '2026-11-01T10:00:00+08:00',
    affected_arrangements: ['Venue', 'Equipment'],
  },
};

const input = (label) => screen.getByLabelText(label);

describe('FullEventDetails', () => {
  tc('FE-EDETAIL-001', 'FullEventDetails', 'No event details, loading state or error is provided.', 'The component renders nothing.', {
    kind: 'Edge',
    pre: 'details is null, loading is false and error is empty.',
    data: 'details = null',
    steps: '1. Render FullEventDetails without event details.',
  }, () => {
    const { container } = render(<FullEventDetails details={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  tc('FE-EDETAIL-002', 'FullEventDetails', 'Event details are still loading.', 'The dialog displays the loading message without rendering the event information.', {
    kind: 'State',
    pre: 'loading is true.',
    data: 'loading = true',
    steps: '1. Render FullEventDetails in the loading state.',
  }, () => {
    render(<FullEventDetails details={null} loading />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Loading event details...')).toBeInTheDocument();
    expect(screen.queryByText('Event information')).toBeNull();
  });

  tc('FE-EDETAIL-003', 'FullEventDetails', 'Loading the full event details fails.', 'The dialog displays the supplied error as an alert without rendering the event information.', {
    kind: 'Negative',
    pre: 'An error message is supplied.',
    data: 'error = "Unable to load event details."',
    steps: '1. Render FullEventDetails with an error.',
  }, () => {
    render(<FullEventDetails details={null} error="Unable to load event details." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load event details.');
    expect(screen.queryByText('Event information')).toBeNull();
  });

  tc('FE-EDETAIL-004', 'FullEventDetails', 'Complete event details are provided.', 'The dialog displays the event heading and all event information in read-only fields.', {
    kind: 'Positive',
    pre: 'Complete event information is available.',
    data: 'Annual Gala, 10-11 Nov 2026, capacity 120',
    steps: '1. Render complete event details. 2. Inspect the event information fields.',
  }, () => {
    render(<FullEventDetails details={DETAILS} />);

    expect(screen.getByText('Event #10')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Full event details' })).toBeInTheDocument();
    expect(screen.getByText('Annual Gala')).toBeInTheDocument();

    expect(input('Event name')).toHaveValue('Annual Gala');
    expect(input('Event type')).toHaveValue('Corporate');
    expect(input('Start date')).toHaveValue('2026-11-10');
    expect(input('End date')).toHaveValue('2026-11-11');
    expect(input('Capacity')).toHaveValue('120');
    expect(input('Start time')).toHaveValue('09:30');
    expect(input('End time')).toHaveValue('17:45');
    expect(input('Layout required')).toHaveValue('Theatre');
    expect(input('Equipment required')).toHaveValue('Projector, Microphone');
    expect(input('Facilities required')).toHaveValue('Wi-Fi, Stage');
    expect(input('Accessibility required')).toHaveValue('Yes');
    expect(input('Equipment placement')).toHaveValue('Projector at front of hall');
    expect(input('Crowd movement')).toHaveValue('Guests enter through the main entrance');
    expect(screen.getByLabelText('Description and planning requirements')).toHaveValue('Annual company event');

    screen.getAllByRole('textbox').forEach((field) => {
      expect(field).toHaveAttribute('readonly');
    });
  });

  tc('FE-EDETAIL-005', 'FullEventDetails', 'Optional event information is missing.', 'Missing values display "Not provided", the end date falls back to the start date, false accessibility displays "No", and missing times display "Not provided".', {
    kind: 'Edge',
    pre: 'Several optional event fields are null, empty or false.',
    data: 'event_end_date = null, accessibility_required = false, times = null',
    steps: '1. Render an event with missing optional information. 2. Inspect the fallback values.',
  }, () => {
    const details = {
      event: {
        event_name: 'Simple Event',
        event_date: '2026-11-20',
        event_end_date: null,
        event_type: null,
        event_capacity: null,
        start_time: null,
        end_time: null,
        layout_required: '',
        equipment_required: [],
        facilities_required: [],
        accessibility_required: false,
        equipment_placement: null,
        crowd_movement: null,
        description: '',
      },
      venue_bookings: [],
      equipment_items: [],
      safety_check: null,
    };

    render(<FullEventDetails details={details} />);

    expect(screen.getByText('Event details')).toBeInTheDocument();
    expect(input('End date')).toHaveValue('2026-11-20');
    expect(input('Event type')).toHaveValue('Not provided');
    expect(input('Capacity')).toHaveValue('Not provided');
    expect(input('Start time')).toHaveValue('Not provided');
    expect(input('End time')).toHaveValue('Not provided');
    expect(input('Layout required')).toHaveValue('Not provided');
    expect(input('Equipment required')).toHaveValue('Not provided');
    expect(input('Facilities required')).toHaveValue('Not provided');
    expect(input('Accessibility required')).toHaveValue('No');
    expect(input('Equipment placement')).toHaveValue('Not provided');
    expect(input('Crowd movement')).toHaveValue('Not provided');
    expect(screen.getByLabelText('Description and planning requirements')).toHaveValue('Not provided');
  });

  tc('FE-EDETAIL-006', 'FullEventDetails', 'Approved venue information is available.', 'The approved venue table displays the venue name and booking status.', {
    kind: 'Positive',
    pre: 'One approved venue booking exists.',
    data: 'Grand Hall, Approved',
    steps: '1. Render event details. 2. Inspect the approved venue table.',
  }, () => {
    render(<FullEventDetails details={DETAILS} />);

    const heading = screen.getByRole('heading', { name: 'Approved venue(s)' });
    const table = heading.nextElementSibling.querySelector('table');

    expect(within(table).getByText('Grand Hall')).toBeInTheDocument();
    expect(within(table).getByText('Approved')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-007', 'FullEventDetails', 'Venue bookings use different available venue-name fields.', 'The component falls back from venue_name to name, then booking venue_name, then the venue id.', {
    kind: 'Edge',
    pre: 'Venue bookings contain different combinations of venue-name information.',
    data: 'Venues.name, booking.venue_name and venue_id fallbacks',
    steps: '1. Render venue bookings with different name fields. 2. Inspect the displayed venue names.',
  }, () => {
    const details = {
      ...DETAILS,
      venue_bookings: [
        { request_id: 1, venue_id: 11, status: 'Approved', Venues: { name: 'Function Room' } },
        { request_id: 2, venue_id: 12, status: 'Approved', Venues: {}, venue_name: 'Seminar Room' },
        { request_id: 3, venue_id: 13, status: 'Approved' },
      ],
    };

    render(<FullEventDetails details={details} />);

    expect(screen.getByText('Function Room')).toBeInTheDocument();
    expect(screen.getByText('Seminar Room')).toBeInTheDocument();
    expect(screen.getByText('Venue #13')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-008', 'FullEventDetails', 'No approved venue exists.', 'The component displays "No venue approved yet." instead of a venue table.', {
    kind: 'Edge',
    pre: 'venue_bookings is empty.',
    data: 'venue_bookings = []',
    steps: '1. Render event details without venue bookings.',
  }, () => {
    render(<FullEventDetails details={{ ...DETAILS, venue_bookings: [] }} />);
    expect(screen.getByText('No venue approved yet.')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-009', 'FullEventDetails', 'Reserved equipment information is available.', 'The reserved equipment table displays the equipment name and reserved quantity.', {
    kind: 'Positive',
    pre: 'Reserved equipment exists.',
    data: 'Projector, quantity 2',
    steps: '1. Render event details. 2. Inspect the reserved equipment table.',
  }, () => {
    render(<FullEventDetails details={DETAILS} />);

    const heading = screen.getByRole('heading', { name: 'Reserved equipment' });
    const table = heading.nextElementSibling.querySelector('table');

    expect(within(table).getByText('Projector')).toBeInTheDocument();
    expect(within(table).getByText('2')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-010', 'FullEventDetails', 'Reserved equipment has no equipment name.', 'The equipment id is displayed as the fallback name.', {
    kind: 'Edge',
    pre: 'equipment_name is missing.',
    data: 'equipment_id = 44',
    steps: '1. Render an equipment item without a name.',
  }, () => {
    render(<FullEventDetails details={{
      ...DETAILS,
      equipment_items: [{ equipment_id: 44, reserved_quantity: 3 }],
    }} />);

    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-011', 'FullEventDetails', 'No equipment has been reserved.', 'The component displays "No equipment reserved yet." instead of an equipment table.', {
    kind: 'Edge',
    pre: 'equipment_items is empty.',
    data: 'equipment_items = []',
    steps: '1. Render event details without reserved equipment.',
  }, () => {
    render(<FullEventDetails details={{ ...DETAILS, equipment_items: [] }} />);
    expect(screen.getByText('No equipment reserved yet.')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-012', 'FullEventDetails', 'An operational safety check has been completed.', 'The decision, comments, decision time and affected arrangements are displayed.', {
    kind: 'Positive',
    pre: 'An approved safety check exists.',
    data: 'Approved; affected arrangements = Venue, Equipment',
    steps: '1. Render event details with a safety check. 2. Inspect the safety information.',
  }, () => {
    render(<FullEventDetails details={DETAILS} />);

    expect(input('Decision')).toHaveValue('Approved');
    expect(input('Comments')).toHaveValue('All safety requirements satisfied.');
    expect(input('Decided at')).not.toHaveValue('Not provided');
    expect(input('Affected arrangements')).toHaveValue('Venue, Equipment');
  });

  tc('FE-EDETAIL-013', 'FullEventDetails', 'A safety check has no decision time or affected arrangements.', 'The decision time displays "Not provided" and the affected-arrangements field is omitted.', {
    kind: 'Edge',
    pre: 'Safety check exists without decided_at or affected arrangements.',
    data: 'decided_at = null, affected_arrangements = []',
    steps: '1. Render the safety check. 2. Inspect its optional fields.',
  }, () => {
    render(<FullEventDetails details={{
      ...DETAILS,
      safety_check: {
        status: 'Rejected',
        comments: 'More information required.',
        decided_at: null,
        affected_arrangements: [],
      },
    }} />);

    expect(input('Decision')).toHaveValue('Rejected');
    expect(input('Decided at')).toHaveValue('Not provided');
    expect(screen.queryByLabelText('Affected arrangements')).toBeNull();
  });

  tc('FE-EDETAIL-014', 'FullEventDetails', 'No operational safety check has been completed.', 'The component displays "No safety check done yet.".', {
    kind: 'Edge',
    pre: 'safety_check is null.',
    data: 'safety_check = null',
    steps: '1. Render event details without a safety check.',
  }, () => {
    render(<FullEventDetails details={{ ...DETAILS, safety_check: null }} />);
    expect(screen.getByText('No safety check done yet.')).toBeInTheDocument();
  });

  tc('FE-EDETAIL-015', 'FullEventDetails', 'The user closes the full event details dialog.', 'The supplied onClose callback is called once.', {
    kind: 'Positive',
    pre: 'An onClose callback is supplied.',
    data: 'onClose = mock function',
    steps: '1. Render the dialog. 2. Click Close.',
  }, () => {
    const onClose = vi.fn();
    render(<FullEventDetails details={DETAILS} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  tc('FE-EDETAIL-016', 'FullEventDetails', 'Numeric accessibility values are supplied by the backend.', 'A value of 1 displays "Yes" and a value of 0 displays "No".', {
    kind: 'Edge',
    pre: 'Accessibility is represented numerically.',
    data: 'accessibility_required = 1 then 0',
    steps: '1. Render accessibility value 1. 2. Rerender with value 0.',
  }, () => {
    const { rerender } = render(<FullEventDetails details={{
      ...DETAILS,
      event: { ...DETAILS.event, accessibility_required: 1 },
    }} />);

    expect(input('Accessibility required')).toHaveValue('Yes');

    rerender(<FullEventDetails details={{
      ...DETAILS,
      event: { ...DETAILS.event, accessibility_required: 0 },
    }} />);

    expect(input('Accessibility required')).toHaveValue('No');
  });
});