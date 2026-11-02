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

  tc('FE-EVCHG-011', 'classifyChange', 'Equipment selections contain the same values in a different array order.', 'The selections compare equal and do not create a significant change.',
    { kind: 'Edge', data: '["Projector", "Microphone"] vs ["Microphone", "Projector"]', steps: '1. Classify equivalent equipment arrays in different orders.' },
    () => {
      const current = { ...EVENT, equipment_required: ['Projector', 'Microphone'] };
      const proposed = proposal({ equipment_required: ['Microphone', 'Projector'] });
      expect(classifyChange(current, proposed)).toEqual({
        significant: false,
        significantFields: [],
        affectsVenue: false,
        affectsEquipment: false,
      });
    });

  tc('FE-EVCHG-012', 'classifyChange', 'Equipment selections are stored as a PostgreSQL-style serialized list.', 'The serialized list is normalised and compares equal to the proposed array.',
    { kind: 'Edge', data: '{"Microphone","Projector"}', steps: '1. Compare a serialized equipment list with an equivalent array.' },
    () => {
      const current = { ...EVENT, equipment_required: '{"Projector","Microphone"}' };
      const proposed = proposal({ equipment_required: ['Microphone', 'Projector'] });
      expect(classifyChange(current, proposed).significant).toBe(false);
    });

  tc('FE-EVCHG-013', 'classifyChange', 'Facilities are stored as a bracketed serialized list containing quoted values.', 'The serialized facilities are normalised and compare equal to the proposed array.',
    { kind: 'Edge', data: '["Stage","Aircon"]', steps: '1. Compare a bracketed serialized facility list with an equivalent array.' },
    () => {
      const current = { ...EVENT, facilities_required: '["Stage","Aircon"]' };
      const proposed = proposal({ facilities_required: ['Aircon', 'Stage'] });
      expect(classifyChange(current, proposed).significant).toBe(false);
    });

  tc('FE-EVCHG-014', 'classifyChange', 'An array selection contains blank values and surrounding whitespace.', 'Blank selections are ignored and remaining values are trimmed before comparison.',
    { kind: 'Edge', data: '[" Microphone ", "", "Projector"]', steps: '1. Compare selections containing whitespace and blanks.' },
    () => {
      const current = { ...EVENT, equipment_required: [' Microphone ', '', 'Projector'] };
      const proposed = proposal({ equipment_required: ['Projector', 'Microphone'] });
      expect(classifyChange(current, proposed).significant).toBe(false);
    });

  tc('FE-EVCHG-015', 'classifyChange', 'An array field is null, blank or an empty serialized value.', 'Each representation is normalised as an empty selection.',
    { kind: 'Edge', steps: '1. Compare null, blank and empty serialized selections with an empty array.' },
    () => {
      expect(classifyChange(
        { ...EVENT, equipment_required: null },
        proposal({ equipment_required: [] }),
      ).significant).toBe(false);

      expect(classifyChange(
        { ...EVENT, equipment_required: '' },
        proposal({ equipment_required: [] }),
      ).significant).toBe(false);

      expect(classifyChange(
        { ...EVENT, equipment_required: '   ' },
        proposal({ equipment_required: [] }),
      ).significant).toBe(false);
    });

  tc('FE-EVCHG-016', 'classifyChange', 'A non-array non-string selection value is compared.', 'The value is converted to text before comparison.',
    { kind: 'Edge', data: 'equipment_required = 123', steps: '1. Compare a numeric selection value with its string representation.' },
    () => {
      expect(classifyChange(
        { ...EVENT, equipment_required: 123 },
        proposal({ equipment_required: ['123'] }),
      ).significant).toBe(false);
    });

  tc('FE-EVCHG-017', 'classifyChange', 'The proposed equipment selection differs from the current selection.', 'The change is significant and affects equipment but not venue.',
    { data: 'Microphone → Projector', steps: '1. Classify a changed equipment requirement.' },
    () => {
      const result = classifyChange(
        { ...EVENT, equipment_required: ['Microphone'] },
        proposal({ equipment_required: ['Projector'] }),
      );

      expect(result).toEqual({
        significant: true,
        significantFields: ['equipment_required'],
        affectsVenue: false,
        affectsEquipment: true,
      });
    });

  tc('FE-EVCHG-018', 'classifyChange', 'Accessibility changes from not required to required.', 'The change is significant and affects the venue only.',
    { data: 'accessibility_required 0 → 1', steps: '1. Classify an accessibility change.' },
    () => {
      const result = classifyChange(
        { ...EVENT, accessibility_required: 0 },
        proposal({ accessibility_required: 1 }),
      );

      expect(result).toEqual({
        significant: true,
        significantFields: ['accessibility_required'],
        affectsVenue: true,
        affectsEquipment: false,
      });
    });

  tc('FE-EVCHG-019', 'classifyChange', 'Accessibility values use equivalent numeric and string representations.', 'The values compare equal and do not create a change.',
    { kind: 'Edge', data: '1 vs "1"', steps: '1. Compare equivalent accessibility representations.' },
    () => {
      expect(classifyChange(
        { ...EVENT, accessibility_required: 1 },
        proposal({ accessibility_required: '1' }),
      ).significant).toBe(false);
    });

  tc('FE-EVCHG-020', 'classifyChange', 'A field exists on the current event but is omitted from the proposal.', 'The omitted field is ignored rather than treated as changed.',
    { kind: 'Edge', steps: '1. Classify a partial proposal that omits a significant field.' },
    () => {
      const result = classifyChange(
        { ...EVENT, equipment_required: ['Microphone'] },
        { event_name: 'Gala' },
      );

      expect(result).toEqual({
        significant: false,
        significantFields: [],
        affectsVenue: false,
        affectsEquipment: false,
      });
    });

  tc('FE-EVCHG-021', 'arrangementLabel', 'A change affects neither venue nor equipment.', 'The arrangement label is empty.',
    { kind: 'Edge', steps: '1. Format an arrangement with both impact flags false.' },
    () => {
      expect(arrangementLabel(false, false)).toBe('');
    });
});
