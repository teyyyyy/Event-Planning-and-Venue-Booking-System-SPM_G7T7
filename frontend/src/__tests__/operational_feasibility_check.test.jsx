import React from 'react';

import { describe, expect } from 'vitest';

import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';

import { tc } from '../test/tc';

import {
  json,
  mockFetch,
  callsTo,
} from '../test/helpers';

import OperationalFeasibilityCheck from '../operational_feasibility_check';


const EVENTS = [
  {
    id: 1,
    event_name: 'Gala',
    event_type: 'Workshop',
    event_date: '2026-10-01',
    event_capacity: 50,
    status: 'Confirmed',
    safety_check: null,
  },
];


const DETAILS = {
  event: {
    id: 1,
    event_name: 'Gala',
    event_type: 'Workshop',
    event_date: '2026-10-01',
    start_time: '10:00:00',
    end_time: '12:00:00',
    event_capacity: 50,
    status: 'Confirmed',
    description: 'Annual student gala.',
    layout_required: 'Theatre',
    accessibility_required: 1,
  },

  venue_bookings: [
    {
      request_id: 1,
      event_id: 1,
      venue_id: 10,
      venue_name: 'Seminar Room 1',
      status: 'Approved',
    },
  ],

  equipment_reservations: [
    {
      reservation_id: 5,
      event_id: 1,
      status: 'Reserved',
    },
  ],

  safety_check: null,

  equipment_placement: null,
  crowd_movement: null,
  emergency_access: null,
  venue_restrictions: null,
};


function backend(o = {}) {
  const d = {
    events: EVENTS,
    details: DETAILS,
    post: () =>
      json({
        message: 'Operational Safety Check submitted successfully.',
        event_id: 1,
        decision: 'Approved',
        event_status: 'Preparation',
      }),
    ...o,
  };

  return mockFetch((url, opts) => {
    const method = opts.method || 'GET';

    if (
      method === 'POST' &&
      url.endsWith('/safety-check/events/1/decision')
    ) {
      return d.post(url, opts);
    }

    if (
      method === 'GET' &&
      url.endsWith('/safety-check/events/1')
    ) {
      return d.details instanceof Function
        ? d.details()
        : json(d.details);
    }

    if (
      method === 'GET' &&
      url.endsWith('/safety-check/events')
    ) {
      return d.events instanceof Function
        ? d.events()
        : json(d.events);
    }

    return json({}, 404);
  });
}


const ready = async () => {
  render(<OperationalFeasibilityCheck />);

  await screen.findByText('Gala');
};


const openDetails = async () => {
  fireEvent.click(
    screen.getByRole('button', {
      name: 'View details',
    })
  );

  await screen.findByRole('heading', {
    name: 'Gala',
  });
};


describe('OperationalFeasibilityCheck', () => {
  tc(
    'FE-SAFETY-001',
    'OperationalFeasibilityCheck',
    'The Safety Officer opens the page with an event ready for review.',
    'A loading message shows, then the event is shown with its date, expected attendance, current status and pending safety check.',
    {
        steps:
            '1. Render the page. 2. Wait for eligible events to load.',
    },
    async () => {
        const f = backend();

        render(<OperationalFeasibilityCheck />);

        expect(
            screen.getByText('Loading…')
        ).toBeInTheDocument();

        expect(
            await screen.findByText('Gala')
        ).toBeInTheDocument();

        expect(screen.getByText('50')).toBeInTheDocument();
        expect(screen.getByText('Confirmed')).toBeInTheDocument();
        expect(screen.getByText('Pending')).toBeInTheDocument();

        expect(
            callsTo(f, '/safety-check/events')
        ).toHaveLength(1);
    }
    );


  tc(
    'FE-SAFETY-002',
    'OperationalFeasibilityCheck',
    'No events currently require an Operational Safety Check.',
    'The empty-state message is shown.',
    {
      kind: 'Edge',
      steps: '1. Return an empty eligible-event list.',
    },
    async () => {
      backend({ events: [] });

      render(<OperationalFeasibilityCheck />);

      await waitFor(() =>
        expect(
          screen.getByText(
            'No events currently require an Operational Safety Check.'
          )
        ).toBeInTheDocument()
      );
    }
  );


  tc(
    'FE-SAFETY-003',
    'OperationalFeasibilityCheck',
    'Loading eligible events fails.',
    'An error message is shown.',
    {
      kind: 'Negative',
      data: '500 "Unable to load safety checks."',
      steps:
        '1. Return 500 when eligible events are requested.',
    },
    async () => {
      backend({
        events: () =>
          json(
            {
              detail: 'Unable to load safety checks.',
            },
            500
          ),
      });

      render(<OperationalFeasibilityCheck />);

      expect(
        await screen.findByText(
          /Unable to load events requiring a safety check/
        )
      ).toBeInTheDocument();
    }
  );


  tc(
    'FE-SAFETY-004',
    'OperationalFeasibilityCheck (details)',
    'The Safety Officer selects an eligible event.',
    'The event details required for the safety review are displayed.',
    {
      steps:
        '1. Load eligible events. 2. Click "View details".',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      expect(
        screen.getByText('Workshop')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Annual student gala.')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Theatre')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Yes')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Seminar Room 1')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Reservation #5')
      ).toBeInTheDocument();
    }
  );


  tc(
    'FE-SAFETY-005',
    'OperationalFeasibilityCheck (details)',
    'Safety information is not yet stored in the current database schema.',
    '"Not available yet" is shown for the unavailable safety considerations.',
    {
      kind: 'Edge',
      steps:
        '1. Open an event. 2. Inspect the safety considerations.',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      expect(
        screen.getAllByText('Not available yet')
      ).toHaveLength(4);
    }
  );


  tc(
    'FE-SAFETY-006',
    'OperationalFeasibilityCheck (details)',
    'Loading the selected event fails.',
    'The backend error message is shown and the details panel does not open.',
    {
      kind: 'Negative',
      data: '400 "Event is not ready for an Operational Safety Check."',
      steps:
        '1. Return 400 for event details. 2. Click "View details".',
    },
    async () => {
      backend({
        details: () =>
          json(
            {
              detail:
                'Event is not ready for an Operational Safety Check.',
            },
            400
          ),
      });

      await ready();

      fireEvent.click(
        screen.getByRole('button', {
          name: 'View details',
        })
      );

      expect(
        await screen.findByText(
          'Event is not ready for an Operational Safety Check.'
        )
      ).toBeInTheDocument();

      expect(
        screen.queryByText('Safety decision')
      ).toBeNull();
    }
  );


  tc(
    'FE-SAFETY-007',
    'OperationalFeasibilityCheck (decision)',
    'No decision has been selected.',
    '"Submit decision" is disabled.',
    {
      kind: 'State',
      steps:
        '1. Open an event. 2. Inspect the decision button.',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      expect(
        screen.getByRole('button', {
          name: 'Submit decision',
        })
      ).toBeDisabled();
    }
  );


  tc(
    'FE-SAFETY-008',
    'OperationalFeasibilityCheck (decision)',
    'The Safety Officer selects Approve.',
    'Comments remain optional and the decision can be submitted.',
    {
      steps:
        '1. Open an event. 2. Select Approve.',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: { value: 'Approved' },
        }
      );

      expect(
        screen.getByRole('button', {
          name: 'Submit decision',
        })
      ).toBeEnabled();

      expect(
        screen.getByPlaceholderText('Optional comments')
      ).not.toBeRequired();
    }
  );


  tc(
    'FE-SAFETY-009',
    'OperationalFeasibilityCheck (decision)',
    'The Safety Officer selects Reject.',
    'Comments become required.',
    {
      kind: 'State',
      steps:
        '1. Open an event. 2. Select Reject.',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: { value: 'Rejected' },
        }
      );

      const comments =
        screen.getByPlaceholderText(
          'Explain the safety issue and required changes.'
        );

      expect(comments).toBeRequired();
    }
  );


  tc(
    'FE-SAFETY-010',
    'OperationalFeasibilityCheck (decision)',
    'The Safety Officer selects Request Changes.',
    'Comments become required.',
    {
      kind: 'State',
      steps:
        '1. Open an event. 2. Select Request Changes.',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: { value: 'Changes Requested' },
        }
      );

      expect(
        screen.getByPlaceholderText(
          'Explain the safety issue and required changes.'
        )
      ).toBeRequired();
    }
  );


  tc(
    'FE-SAFETY-011',
    'OperationalFeasibilityCheck (decision)',
    'The Safety Officer approves an event without comments.',
    'The approval is POSTed and a success message shows the new Preparation status.',
    {
      data: 'decision = Approved, comments omitted',
      steps:
        '1. Open event. 2. Select Approve. 3. Submit.',
    },
    async () => {
      const f = backend();

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: { value: 'Approved' },
        }
      );

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Submit decision',
        })
      );

      expect(
        await screen.findByText(
          'Gala: Approved. Event status is now Preparation.'
        )
      ).toBeInTheDocument();

      const [url, options] =
        callsTo(
          f,
          '/safety-check/events/1/decision',
          'POST'
        )[0];

      expect(url).toMatch(
        /safety-check\/events\/1\/decision$/
      );

      expect(JSON.parse(options.body)).toEqual({
        decision: 'Approved',
        comments: null,
      });
    }
  );


  tc(
    'FE-SAFETY-012',
    'OperationalFeasibilityCheck (decision)',
    'The Safety Officer rejects an event and enters comments.',
    'The rejection and trimmed comments are POSTed.',
    {
      data:
        'decision = Rejected, comments = "  Emergency access blocked.  "',
      steps:
        '1. Open event. 2. Select Reject. 3. Enter comments. 4. Submit.',
    },
    async () => {
      const f = backend({
        post: () =>
          json({
            message:
              'Operational Safety Check submitted successfully.',
            event_id: 1,
            decision: 'Rejected',
            event_status: 'Planning',
          }),
      });

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: { value: 'Rejected' },
        }
      );

      fireEvent.change(
        screen.getByPlaceholderText(
          'Explain the safety issue and required changes.'
        ),
        {
          target: {
            value: '  Emergency access blocked.  ',
          },
        }
      );

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Submit decision',
        })
      );

      expect(
        await screen.findByText(
          'Gala: Rejected. Event status is now Planning.'
        )
      ).toBeInTheDocument();

      const [, options] =
        callsTo(
          f,
          '/safety-check/events/1/decision',
          'POST'
        )[0];

      expect(JSON.parse(options.body)).toEqual({
        decision: 'Rejected',
        comments: 'Emergency access blocked.',
      });
    }
  );


  tc(
    'FE-SAFETY-013',
    'OperationalFeasibilityCheck (decision)',
    'The Safety Officer requests changes and enters comments.',
    'The Changes Requested decision and comments are POSTed.',
    {
      data:
        'decision = Changes Requested, comments = "Revise venue layout."',
      steps:
        '1. Open event. 2. Select Request Changes. 3. Enter comments. 4. Submit.',
    },
    async () => {
      const f = backend({
        post: () =>
          json({
            message:
              'Operational Safety Check submitted successfully.',
            event_id: 1,
            decision: 'Changes Requested',
            event_status: 'Planning',
          }),
      });

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: {
            value: 'Changes Requested',
          },
        }
      );

      fireEvent.change(
        screen.getByPlaceholderText(
          'Explain the safety issue and required changes.'
        ),
        {
          target: {
            value: 'Revise venue layout.',
          },
        }
      );

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Submit decision',
        })
      );

      expect(
        await screen.findByText(
          'Gala: Changes Requested. Event status is now Planning.'
        )
      ).toBeInTheDocument();

      const [, options] =
        callsTo(
          f,
          '/safety-check/events/1/decision',
          'POST'
        )[0];

      expect(JSON.parse(options.body)).toEqual({
        decision: 'Changes Requested',
        comments: 'Revise venue layout.',
      });
    }
  );


  tc(
    'FE-SAFETY-014',
    'OperationalFeasibilityCheck (decision)',
    'Submitting the safety decision fails.',
    'The backend error message is shown and the event details remain open.',
    {
      kind: 'Negative',
      data: '400 "Unable to submit safety decision."',
      steps:
        '1. Return 400 on POST. 2. Submit an approval.',
    },
    async () => {
      backend({
        post: () =>
          json(
            {
              detail:
                'Unable to submit safety decision.',
            },
            400
          ),
      });

      await ready();
      await openDetails();

      fireEvent.change(
        screen.getByRole('combobox'),
        {
          target: { value: 'Approved' },
        }
      );

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Submit decision',
        })
      );

      expect(
        await screen.findByText(
          'Unable to submit safety decision.'
        )
      ).toBeInTheDocument();

      expect(
        screen.getByText('Safety decision')
      ).toBeInTheDocument();
    }
  );


  tc(
    'FE-SAFETY-015',
    'OperationalFeasibilityCheck (details)',
    'The event already has a previous Changes Requested decision.',
    'The previous decision and comments are displayed.',
    {
      kind: 'State',
      steps:
        '1. Return an existing safety check. 2. Open the event.',
    },
    async () => {
      backend({
        details: {
          ...DETAILS,
          safety_check: {
            check_id: 3,
            event_id: 1,
            safety_officer_id: 's1',
            status: 'Changes Requested',
            comments: 'Revise the venue layout.',
          },
        },
      });

      await ready();
      await openDetails();

      expect(
        screen.getByText('Previous safety decision')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Changes Requested')
      ).toBeInTheDocument();

      expect(
        screen.getByText('Revise the venue layout.')
      ).toBeInTheDocument();
    }
  );


  tc(
    'FE-SAFETY-016',
    'OperationalFeasibilityCheck (details)',
    'The Safety Officer closes the selected event.',
    'The detail panel closes and the eligible-event table remains.',
    {
      kind: 'State',
      steps:
        '1. Open an event. 2. Click Close.',
    },
    async () => {
      backend();

      await ready();
      await openDetails();

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Close',
        })
      );

      expect(
        screen.queryByText('Safety decision')
      ).toBeNull();

      expect(
        screen.getByText('Gala')
      ).toBeInTheDocument();

      expect(
        screen.getByRole('button', {
          name: 'View details',
        })
      ).toBeInTheDocument();
    }
  );
});