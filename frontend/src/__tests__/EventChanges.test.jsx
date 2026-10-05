import React from 'react';
import { describe, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { tc } from '../test/tc';

const request = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ request }));

import EventChangeHistory from '../EventChangeHistory';
import { arrangementLabel, classifyChange, fieldLabels } from '../eventChanges';

const EVENT = {
  event_name: 'Gala', event_type: 'Workshop', description: 'Plan', event_date: '2026-11-01', event_end_date: '2026-11-01',
  start_time: '10:00:00', end_time: '12:00:00', event_capacity: 50,
};
const proposal = (o = {}) => ({ ...EVENT, start_time: '10:00', end_time: '12:00', event_capacity: '50', ...o });
const entry = (o = {}) => ({
  id: 1, change_type: 'Significant', created_at: '2026-10-05T09:00:00+00:00', changed_by_name: 'Bob', change_request_id: 11,
  changed_fields: ['start_time', 'event_name'], significant_fields: ['start_time'],
  previous_values: { start_time: '10:00:00', event_name: 'Gala' }, new_values: { start_time: '14:00:00', event_name: 'Gala Night' },
  reset_venue_request_ids: [5], reset_equipment_request_ids: [9], ...o,
});

describe('eventChanges', () => {
  tc('FE-EVCHG-001', 'classifyChange', 'Only the name, type and description are edited.', 'The change is not significant and affects neither venue nor equipment.',
    { data: 'event_name Gala → Gala Night', steps: '1. Classify the proposal.' },
    () => {
      expect(classifyChange(EVENT, proposal({ event_name: 'Gala Night', description: 'New' }))).toEqual({
        significant: false, significantFields: [], affectsVenue: false, affectsEquipment: false,
      });
    });

  tc('FE-EVCHG-002', 'classifyChange', 'Schedule or capacity changes are proposed.',
    'Time changes affect the venue and equipment; a capacity-only change affects the venue only.',
    { data: 'start 10:00 → 14:00; capacity 50 → 200', steps: '1. Classify a time change. 2. Classify a capacity change.' },
    () => {
      expect(classifyChange(EVENT, proposal({ start_time: '14:00' }))).toEqual({
        significant: true, significantFields: ['start_time'], affectsVenue: true, affectsEquipment: true,
      });
      expect(classifyChange(EVENT, proposal({ event_capacity: '200' }))).toMatchObject({ significantFields: ['event_capacity'], affectsEquipment: false });
    });

  tc('FE-EVCHG-003', 'classifyChange', 'Values only differ in format.', 'HH:MM equals HH:MM:SS, a blank end date equals the start date and blank values compare equal.',
    { kind: 'Edge', steps: '1. Classify a proposal with a blank end date against an event with a blank description.' },
    () => {
      expect(classifyChange({ ...EVENT, description: null }, proposal({ event_end_date: '', description: '' })).significant).toBe(false);
    });

  tc('FE-EVCHG-004', 'fieldLabels / arrangementLabel', 'Field and arrangement names are displayed.',
    'Known fields use readable labels, unknown fields fall back to their name, and arrangement labels join what is affected.',
    { steps: '1. Format field lists. 2. Format each venue/equipment combination.' },
    () => {
      expect(fieldLabels(['start_time', 'event_capacity', 'custom'])).toBe('Start time, Capacity, custom');
      expect(fieldLabels(undefined)).toBe('');
      expect(arrangementLabel(true, true)).toBe('venue booking and equipment requests');
      expect(arrangementLabel(true, false)).toBe('venue booking');
      expect(arrangementLabel(false, true)).toBe('equipment requests');
    });
});

describe('EventChangeHistory', () => {
  tc('FE-EVCHG-005', 'EventChangeHistory', 'An event has a significant and an ordinary recorded change.',
    'Each entry shows its type, date, author and change request; fields list old → new values with significant ones marked, and reopened requests are named.',
    { pre: 'API returns two entries.', steps: '1. Render for event 1. 2. Wait for the history.' },
    async () => {
      request.mockResolvedValue([
        entry(),
        entry({ id: 2, change_type: 'Ordinary', changed_by_name: null, change_request_id: null, created_at: null, changed_fields: ['description'], significant_fields: undefined,
          previous_values: { description: 'Plan' }, new_values: { description: 'New plan' }, reset_venue_request_ids: [], reset_equipment_request_ids: undefined }),
      ]);
      render(<EventChangeHistory eventId={1} />);
      expect(screen.getByText('Loading change history…')).toBeInTheDocument();
      const list = await screen.findByRole('list', { name: 'Event change history' });
      const [significant, ordinary] = within(list).getAllByRole('listitem');
      expect(request).toHaveBeenCalledWith('/events/1/change-log');
      expect(within(significant).getByText('Significant change')).toBeInTheDocument();
      expect(within(significant).getByText('2026-10-05 · by Bob · change request #11')).toBeInTheDocument();
      expect(within(significant).getByRole('rowheader', { name: 'Start time' }).closest('tr')).toHaveClass('significant-field');
      expect(within(significant).getByText('14:00')).toBeInTheDocument();
      expect(within(significant).getByRole('rowheader', { name: 'Event name' }).closest('tr')).not.toHaveClass('significant-field');
      expect(within(significant).getByText('Returned to Pending for re-review: venue booking #5, equipment request #9.')).toBeInTheDocument();
      expect(within(ordinary).getByText('Ordinary edit')).toBeInTheDocument();
      expect(within(ordinary).getByText('New plan')).toBeInTheDocument();
      expect(within(ordinary).queryByText(/Returned to Pending/)).toBeNull();
    });

  tc('FE-EVCHG-006', 'EventChangeHistory', 'Recorded values are blank, lists, accessibility flags or unknown fields.',
    'Blank values read "Not set", lists are joined (empty lists read "None"), accessibility reads Required / Not required, and unknown fields show their name.',
    { kind: 'Edge', steps: '1. Render an entry with each value type.' },
    async () => {
      request.mockResolvedValue([entry({
        changed_fields: ['layout_required', 'facilities_required', 'accessibility_required', 'mystery'],
        previous_values: { layout_required: null, facilities_required: [], accessibility_required: 0, mystery: 'a' },
        new_values: { layout_required: 'Banquet', facilities_required: ['Stage', 'Projector'], accessibility_required: 1 },
        reset_venue_request_ids: undefined,
      })]);
      render(<EventChangeHistory eventId={1} />);
      await screen.findByRole('list', { name: 'Event change history' });
      const row = (name) => screen.getByRole('rowheader', { name }).closest('tr');
      expect(within(row('Layout')).getByText('Not set')).toBeInTheDocument();
      expect(within(row('Facilities')).getByText('None')).toBeInTheDocument();
      expect(within(row('Facilities')).getByText('Stage, Projector')).toBeInTheDocument();
      expect(within(row('Accessibility')).getByText('Not required')).toBeInTheDocument();
      expect(within(row('Accessibility')).getByText('Required')).toBeInTheDocument();
      expect(within(row('mystery')).getByText('Not set')).toBeInTheDocument();
    });

  tc('FE-EVCHG-007', 'EventChangeHistory', 'An entry has no changed field list.', 'The entry still shows its heading with an empty comparison.',
    { kind: 'Edge', steps: '1. Render an entry without changed_fields.' },
    async () => {
      request.mockResolvedValue([entry({ changed_fields: undefined })]);
      render(<EventChangeHistory eventId={1} />);
      expect(await screen.findByText('Significant change')).toBeInTheDocument();
      expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
    });

  tc('FE-EVCHG-008', 'EventChangeHistory', 'The event has no recorded changes.', '"No changes have been recorded since this event was submitted." is shown.',
    { kind: 'Edge', steps: '1. Return an empty list.' },
    async () => {
      request.mockResolvedValue([]);
      render(<EventChangeHistory eventId={1} />);
      expect(await screen.findByText('No changes have been recorded since this event was submitted.')).toBeInTheDocument();
    });

  tc('FE-EVCHG-009', 'EventChangeHistory', 'Loading the history fails.', 'An alert explains the history could not be loaded and includes the error.',
    { kind: 'Negative', data: '"You do not have access to this event\'s change history."', steps: '1. Reject the request.' },
    async () => {
      request.mockRejectedValue(new Error("You do not have access to this event's change history."));
      render(<EventChangeHistory eventId={1} />);
      expect(await screen.findByRole('alert')).toHaveTextContent("Unable to load the change history. (You do not have access to this event's change history.)");
    });

  tc('FE-EVCHG-010', 'EventChangeHistory', 'The panel is closed before the history loads or fails.', 'Late responses are ignored after unmount.',
    { kind: 'Edge', steps: '1. Render with pending requests. 2. Unmount. 3. Resolve and reject them.' },
    async () => {
      let resolve; let reject;
      request.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
      const first = render(<EventChangeHistory eventId={1} />);
      const second = render(<EventChangeHistory eventId={2} />);
      first.unmount();
      second.unmount();
      resolve([entry()]);
      reject(new Error('late'));
      await Promise.resolve();
      expect(screen.queryByText('Significant change')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
});
