import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { tc } from '../test/tc';

const request = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ request }));

import VenueCatalogue from '../VenueCatalogue';

const HOURS = {
  monday: { closed: false, opens: '09:00', closes: '18:00' }, tuesday: { closed: false, opens: '09:00', closes: '18:00' },
  wednesday: { closed: false, opens: '09:00', closes: '18:00' }, thursday: { closed: false, opens: '09:00', closes: '18:00' },
  friday: { closed: false, opens: '09:00', closes: '18:00' }, saturday: { closed: false, opens: '10:00', closes: '14:00' },
  sunday: { closed: true, opens: null, closes: null },
};
const VENUE = { venue_id: 1, name: 'Hall A', location: 'Singapore', capacity: 100, operating_hours: HOURS, facilities: ['Wi-Fi', 'Projector'], accessible: 1, accessibility_details: 'Step-free entrance', layouts: ['Theatre', 'Banquet'] };

// Route the mocked request(): '/venue-catalogue' -> list, '/venue-catalogue/<id>' -> detail, PUT -> putResult.
function backend({ list = [VENUE], detail = VENUE, put } = {}) {
  request.mockImplementation(async (path, options = {}) => {
    if (options.method === 'PUT') return put ? put(path, options) : { ...detail, ...JSON.parse(options.body), name: detail.name, venue_id: detail.venue_id };
    return path === '/venue-catalogue' ? list : detail;
  });
}
const openDetail = async (props = {}) => {
  render(<VenueCatalogue {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Hall A' }));
  await screen.findByRole('heading', { name: 'Hall A' });
};
const startEdit = async () => { await openDetail({ canEdit: true }); fireEvent.click(screen.getByRole('button', { name: 'Edit venue' })); await screen.findByRole('heading', { name: 'Edit Hall A' }); };
const form = () => document.querySelector('form.catalogue-panel');
const area = (i) => document.querySelectorAll('textarea')[i]; // 0 facilities, 1 notes, 2 layouts

describe('VenueCatalogue', () => {
  beforeEach(() => request.mockReset());

  tc('FE-VCAT-001', 'VenueCatalogue', 'The catalogue opens.', 'A loading message shows, then /venue-catalogue is fetched and each venue is a card with name, location, capacity and layouts.',
    { steps: '1. Render. 2. Wait for the cards.' },
    async () => {
      backend();
      render(<VenueCatalogue />);
      expect(screen.getByText('Loading venue information…')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Hall A' })).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith('/venue-catalogue', expect.objectContaining({ signal: expect.anything() }));
      expect(screen.getByText('Capacity: 100')).toBeInTheDocument();
      expect(screen.getByText('Theatre, Banquet')).toBeInTheDocument();
    });

  tc('FE-VCAT-002', 'VenueCatalogue', 'There are no venues.', '"No venues available." is shown.', { kind: 'Edge', steps: '1. Return an empty list.' },
    async () => { backend({ list: [] }); render(<VenueCatalogue />); expect(await screen.findByText('No venues available.')).toBeInTheDocument(); });

  tc('FE-VCAT-003', 'VenueCatalogue', 'Loading fails and the user clicks "Try again".', 'The error is shown with a retry button; retrying fetches again and shows the venues.',
    { kind: 'Negative', data: '"Venue information could not be loaded"', steps: '1. Reject the first load. 2. Click "Try again".' },
    async () => {
      request.mockRejectedValueOnce(new Error('Venue information could not be loaded')).mockResolvedValue([VENUE]);
      render(<VenueCatalogue />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Venue information could not be loaded');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: 'Hall A' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

  tc('FE-VCAT-004', 'VenueCatalogue (details)', 'The user opens a venue.', 'GET /venue-catalogue/<id> is called and the details show the week\'s hours ("Closed" for a closed day), facilities, accessibility and layouts.',
    { steps: '1. Render. 2. Click "View Hall A".' },
    async () => {
      backend();
      await openDetail();
      expect(request).toHaveBeenCalledWith('/venue-catalogue/1', expect.anything());
      expect(screen.getByText('Monday').nextSibling).toHaveTextContent('09:00 – 18:00');
      expect(screen.getByText('Saturday').nextSibling).toHaveTextContent('10:00 – 14:00');
      expect(screen.getByText('Sunday').nextSibling).toHaveTextContent('Closed');
      expect(screen.getByText('Wi-Fi, Projector')).toBeInTheDocument();
      expect(screen.getByText('Accessible')).toBeInTheDocument();
      expect(screen.getByText('Step-free entrance')).toBeInTheDocument();
    });

  tc('FE-VCAT-005', 'VenueCatalogue (details)', 'A venue has no hours, lists or accessibility information.', 'The page shows "Not specified" placeholders and "No additional accessibility information."',
    { kind: 'Edge', data: 'operating_hours/facilities/layouts missing; accessible = null; capacity = null', steps: '1. Open a sparse venue.' },
    async () => {
      const sparse = { venue_id: 1, name: 'Hall A', location: 'SG', capacity: null, accessible: null };
      backend({ list: [sparse], detail: sparse });
      await openDetail();
      expect(screen.getAllByText('Not specified').length).toBeGreaterThanOrEqual(10);
      expect(screen.getByText('No additional accessibility information.')).toBeInTheDocument();
      expect(screen.getByText(/Capacity: Not specified/)).toBeInTheDocument();
    });

  tc('FE-VCAT-006', 'VenueCatalogue (read-only)', 'A viewer without edit rights (technical support) opens a venue.', 'No "Edit venue" button is offered and the intro says "Browse venue information for technical planning."',
    { kind: 'Security', data: 'canEdit = false (default)', steps: '1. Render without canEdit. 2. Open a venue.' },
    async () => {
      backend();
      await openDetail();
      expect(screen.queryByRole('button', { name: 'Edit venue' })).toBeNull();
      expect(screen.getByText('Browse venue information for technical planning.')).toBeInTheDocument();
    });

  tc('FE-VCAT-007', 'VenueCatalogue (edit)', 'Venue staff (canEdit) opens a venue.', 'An "Edit venue" button is offered and the intro mentions keeping information up to date.', { data: 'canEdit = true', steps: '1. Render with canEdit. 2. Open a venue.' },
    async () => {
      backend();
      await openDetail({ canEdit: true });
      expect(screen.getByRole('button', { name: 'Edit venue' })).toBeInTheDocument();
      expect(screen.getByText('View venues and keep their planning information up to date.')).toBeInTheDocument();
    });

  tc('FE-VCAT-008', 'VenueCatalogue (navigation)', 'The user clicks "← Back to catalogue" from a venue.', 'The card list is shown again.', { kind: 'State', steps: '1. Open a venue. 2. Click the back button.' },
    async () => {
      backend();
      await openDetail();
      fireEvent.click(screen.getByRole('button', { name: '← Back to catalogue' }));
      expect(await screen.findByRole('button', { name: 'View Hall A' })).toBeInTheDocument();
    });

  tc('FE-VCAT-009', 'VenueCatalogue (edit)', 'Venue staff clicks "Edit venue".', 'The form is pre-filled: one item per line in the list boxes, a closed day ticked with its time inputs disabled, and the accessibility select set.',
    { steps: '1. Open a venue as staff. 2. Click "Edit venue".' },
    async () => {
      backend();
      await startEdit();
      expect(area(0)).toHaveValue('Wi-Fi\nProjector');
      expect(area(2)).toHaveValue('Theatre\nBanquet');
      expect(screen.getByLabelText('Monday opening time')).toHaveValue('09:00');
      expect(screen.getByLabelText('Sunday opening time')).toBeDisabled();
      expect(document.querySelector('select')).toHaveValue('1');
      expect(area(1)).toHaveValue('Step-free entrance');
    });

  tc('FE-VCAT-010', 'VenueCatalogue (edit)', 'Venue staff cancels editing.', 'The details view returns and no PUT is sent.', { kind: 'State', steps: '1. Click "Edit venue". 2. Click "Cancel".' },
    async () => {
      backend();
      await startEdit();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('button', { name: 'Edit venue' })).toBeInTheDocument();
      expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0);
    });

  tc('FE-VCAT-011', 'VenueCatalogue (edit)', 'Staff edits facilities (with blank lines and padding) and saves.', 'PUT /venue-catalogue/<id> is sent with the lists as trimmed arrays (blank lines dropped) and accessible as a number; a success message and the updated details follow.',
    { data: 'facilities "Wi-Fi\\n\\n  Stage  "', steps: '1. Click "Edit venue". 2. Change facilities. 3. Click "Save changes".' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(area(0), { target: { value: 'Wi-Fi\n\n  Stage  ' } });
      fireEvent.submit(form());
      expect(await screen.findByText('Hall A updated successfully.')).toBeInTheDocument();
      const [path, options] = request.mock.calls.find(([, o]) => o?.method === 'PUT');
      expect(path).toBe('/venue-catalogue/1');
      const body = JSON.parse(options.body);
      expect(body.facilities).toEqual(['Wi-Fi', 'Stage']);
      expect(body.layouts).toEqual(['Theatre', 'Banquet']);
      expect(body.accessible).toBe(1);
      expect(screen.getByText('Wi-Fi, Stage')).toBeInTheDocument();
    });

  tc('FE-VCAT-012', 'VenueCatalogue (edit)', 'A day\'s closing time is not later than its opening time.', 'The error "Monday: closing time must be later than opening time on the same day." is shown and no PUT is sent.',
    { kind: 'Negative', data: 'Monday 09:00-08:00', steps: '1. Edit. 2. Set Monday closing to 08:00. 3. Save.' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(screen.getByLabelText('Monday closing time'), { target: { value: '08:00' } });
      fireEvent.submit(form());
      expect(await screen.findByText('Monday: closing time must be later than opening time on the same day.')).toBeInTheDocument();
      expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0);
    });

  tc('FE-VCAT-013', 'VenueCatalogue (edit)', 'Staff ticks "Closed" for Monday and saves.', 'The time inputs are disabled and the payload sends {closed: true, opens: null, closes: null} for Monday.',
    { steps: '1. Edit. 2. Tick Monday\'s Closed box. 3. Save.' },
    async () => {
      backend();
      await startEdit();
      fireEvent.click(document.querySelectorAll('input[type=checkbox]')[0]);
      expect(screen.getByLabelText('Monday opening time')).toBeDisabled();
      fireEvent.submit(form());
      await screen.findByText('Hall A updated successfully.');
      const body = JSON.parse(request.mock.calls.find(([, o]) => o?.method === 'PUT')[1].body);
      expect(body.operating_hours.monday).toEqual({ closed: true, opens: null, closes: null });
    });

  tc('FE-VCAT-014', 'VenueCatalogue (edit)', 'More than 30 facilities are entered.', 'The error "Enter up to 30 items per list, with no more than 100 characters per item." is shown and no PUT is sent.', { kind: 'Edge', data: '31 lines', steps: '1. Edit. 2. Enter 31 facilities. 3. Save.' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(area(0), { target: { value: Array.from({ length: 31 }, (_, i) => `f${i}`).join('\n') } });
      fireEvent.submit(form());
      expect(await screen.findByText(/Enter up to 30 items per list/)).toBeInTheDocument();
      expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0);
    });

  tc('FE-VCAT-015', 'VenueCatalogue (edit)', 'A layout item is longer than 100 characters.', 'The same list-limit error is shown and no PUT is sent.', { kind: 'Edge', data: '101 characters', steps: '1. Edit. 2. Enter a 101-character layout. 3. Save.' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(area(2), { target: { value: 'x'.repeat(101) } });
      fireEvent.submit(form());
      expect(await screen.findByText(/Enter up to 30 items per list/)).toBeInTheDocument();
    });

  tc('FE-VCAT-016', 'VenueCatalogue (edit)', 'The server rejects the save.', 'The error message is shown (without a "Try again" button) and the form stays open with the user\'s edits.',
    { kind: 'Negative', data: '404 "Venue not found. Changes were not saved."', steps: '1. Make PUT reject. 2. Save.' },
    async () => {
      backend({ put: () => { throw new Error('Venue not found. Changes were not saved.'); } });
      await startEdit();
      fireEvent.change(area(0), { target: { value: 'Stage' } });
      fireEvent.submit(form());
      expect(await screen.findByText('Venue not found. Changes were not saved.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(area(0)).toHaveValue('Stage');
    });

  tc('FE-VCAT-017', 'VenueCatalogue (edit)', 'A save is in progress.', 'The submit button reads "Saving…" and is disabled, and Cancel is disabled.', { kind: 'State', pre: 'PUT never resolves.', steps: '1. Edit. 2. Save. 3. Inspect the buttons.' },
    async () => {
      backend({ put: () => new Promise(() => {}) });
      await startEdit();
      fireEvent.submit(form());
      expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

  tc('FE-VCAT-018', 'VenueCatalogue (edit)', 'The user is editing a venue.', 'The "← Back to catalogue" button is disabled so unsaved edits cannot be dropped by accident.', { kind: 'State', steps: '1. Click "Edit venue". 2. Inspect the back button.' },
    async () => {
      backend();
      await startEdit();
      expect(screen.getByRole('button', { name: '← Back to catalogue' })).toBeDisabled();
    });

  tc('FE-VCAT-019', 'VenueCatalogue (edit)', 'A save is attempted without edit rights (canEdit = false).', 'No form is ever rendered, so no PUT can be sent.', { kind: 'Security', steps: '1. Render without canEdit. 2. Open a venue. 3. Look for a form.' },
    async () => {
      backend();
      await openDetail();
      expect(form()).toBeNull();
      await waitFor(() => expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0));
    });
});
