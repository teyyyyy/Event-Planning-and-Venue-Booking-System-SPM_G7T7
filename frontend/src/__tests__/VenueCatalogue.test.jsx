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
const VENUE = { venue_id: 1, name: 'Hall A', location: 'Singapore', capacity: 100, operating_hours: HOURS, facilities: ['Wi-Fi', 'Projector'], accessible: 1, accessibility_details: 'Step-free entrance', layouts: ['Theatre', 'Banquet'], setup_time: 90, teardown_time: 30 };

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
const startEdit = async () => { await openDetail({ canEdit: true }); fireEvent.click(screen.getByRole('button', { name: 'Edit venue' })); await screen.findByRole('heading', { name: 'Hall A' }); };
const form = () => document.querySelector('form.catalogue-panel');

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

  tc('FE-VCAT-004', 'VenueCatalogue (details)', 'The user opens a venue.', 'GET /venue-catalogue/<id> is called and the details show setup and teardown minutes, facilities, accessibility, emergency access, venue restrictions and layouts.',
    { steps: '1. Render. 2. Click "View Hall A".' },
    async () => {
      backend({ detail: { ...VENUE, emergency_access: 'Rear emergency exit', venue_restrictions: 'No open flames' } });
      await openDetail();
      expect(request).toHaveBeenCalledWith('/venue-catalogue/1', expect.anything());
      expect(screen.getByText('Wi-Fi, Projector')).toBeInTheDocument();
      expect(screen.getByText('Accessible')).toBeInTheDocument();
      expect(screen.getByText('Step-free entrance')).toBeInTheDocument();
      expect(screen.getByText('Rear emergency exit')).toBeInTheDocument();
      expect(screen.getByText('No open flames')).toBeInTheDocument();
      expect(screen.getByText('Theatre, Banquet')).toBeInTheDocument();
      expect(screen.getByText('90 minutes')).toBeInTheDocument();
      expect(screen.getByText('30 minutes')).toBeInTheDocument();
    });

  tc('FE-VCAT-005', 'VenueCatalogue (details)', 'A venue has no lists, accessibility, emergency access or venue restrictions.', 'The page shows "Not specified" placeholders and "No additional accessibility information.".',
    { kind: 'Edge', data: 'facilities/layouts missing; accessible/capacity/setup_time/teardown_time missing; emergency_access/venue_restrictions blank', steps: '1. Open a sparse venue.' },
    async () => {
      const sparse = { venue_id: 1, name: 'Hall A', location: 'SG', capacity: null, accessible: null };
      backend({ list: [sparse], detail: sparse });
      await openDetail();
      expect(screen.getAllByText('Not specified').length).toBeGreaterThanOrEqual(7);
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

  tc('FE-VCAT-009', 'VenueCatalogue (edit)', 'Venue staff clicks "Edit venue".', 'The form is pre-filled with setup and teardown durations, accessibility, accessibility notes, emergency access and venue restrictions; facilities and layouts remain read-only.',
    { steps: '1. Open a venue as staff. 2. Click "Edit venue".' },
    async () => {
      backend({ detail: { ...VENUE, emergency_access: 'Rear emergency exit', venue_restrictions: 'No open flames' } });
      await startEdit();
      expect(screen.getByLabelText('Setup time (minutes)')).toHaveValue('90');
      expect(screen.getByLabelText('Teardown time (minutes)')).toHaveValue('30');
      expect(screen.getByLabelText('Accessibility')).toHaveValue('1');
      expect(screen.getByLabelText('Accessibility notes')).toHaveValue('Step-free entrance');
      expect(screen.getByLabelText('Emergency access')).toHaveValue('Rear emergency exit');
      expect(screen.getByLabelText('Venue restrictions')).toHaveValue('No open flames');
      expect(screen.getByText('Facilities:').parentElement).toHaveTextContent('Facilities: Wi-Fi, Projector');
      expect(screen.getByText('Supported characteristics / layouts:').parentElement).toHaveTextContent('Supported characteristics / layouts: Theatre, Banquet');
    });

  tc('FE-VCAT-010', 'VenueCatalogue (edit)', 'Venue staff cancels editing.', 'The details view returns and no PUT is sent.', { kind: 'State', steps: '1. Click "Edit venue". 2. Click "Cancel".' },
    async () => {
      backend();
      await startEdit();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('button', { name: 'Edit venue' })).toBeInTheDocument();
      expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0);
    });

  tc('FE-VCAT-020', 'VenueCatalogue (edit)', 'Staff enters a fractional setup duration.', 'A whole-number validation message appears and no PUT is sent.',
    { kind: 'Negative', data: 'setup_time = 2.5', steps: '1. Edit a venue. 2. Enter 2.5 for setup time. 3. Save.' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(screen.getByLabelText('Setup time (minutes)'), { target: { value: '2.5' } });
      fireEvent.submit(form());
      expect(await screen.findByText(/Setup time must be a whole number of minutes/)).toBeInTheDocument();
      expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0);
    });

  tc('FE-VCAT-011', 'VenueCatalogue (edit)', 'Staff edits venue planning fields and saves.', 'PUT /venue-catalogue/<id> includes accessibility, accessibility notes, emergency access, venue restrictions and whole-number setup and teardown minutes; the success message and updated details follow.',
    { data: 'setup_time = 120, teardown_time = 45, accessibility = 0, updated planning notes', steps: '1. Click "Edit venue". 2. Change the planning fields. 3. Click "Save changes".' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(screen.getByLabelText('Setup time (minutes)'), { target: { value: '120' } });
      fireEvent.change(screen.getByLabelText('Teardown time (minutes)'), { target: { value: '45' } });
      fireEvent.change(screen.getByLabelText('Accessibility'), { target: { value: '0' } });
      fireEvent.change(screen.getByLabelText('Accessibility notes'), { target: { value: 'Ramp required' } });
      fireEvent.change(screen.getByLabelText('Emergency access'), { target: { value: 'Use rear emergency exit' } });
      fireEvent.change(screen.getByLabelText('Venue restrictions'), { target: { value: 'No open flames' } });
      fireEvent.submit(form());
      expect(await screen.findByText('Hall A updated successfully.')).toBeInTheDocument();
      const [path, options] = request.mock.calls.find(([, o]) => o?.method === 'PUT');
      expect(path).toBe('/venue-catalogue/1');
      const body = JSON.parse(options.body);
      expect(body.accessible).toBe(0);
      expect(body.accessibility_details).toBe('Ramp required');
      expect(body.emergency_access).toBe('Use rear emergency exit');
      expect(body.venue_restrictions).toBe('No open flames');
      expect(body.setup_time).toBe(120);
      expect(body.teardown_time).toBe(45);
      expect(body).not.toHaveProperty('facilities');
      expect(body).not.toHaveProperty('layouts');
      expect(screen.getByText('Not accessible')).toBeInTheDocument();
      expect(screen.getByText('Ramp required')).toBeInTheDocument();
      expect(screen.getByText('Use rear emergency exit')).toBeInTheDocument();
      expect(screen.getByText('No open flames')).toBeInTheDocument();
      expect(screen.getByText('120 minutes')).toBeInTheDocument();
      expect(screen.getByText('45 minutes')).toBeInTheDocument();
    });

  tc('FE-VCAT-016', 'VenueCatalogue (edit)', 'The server rejects the save.', 'The error message is shown (without a "Try again" button) and the form stays open with the user\'s edits.',
    { kind: 'Negative', data: '404 "Venue not found. Changes were not saved."', steps: '1. Make PUT reject. 2. Save.' },
    async () => {
      backend({ put: () => { throw new Error('Venue not found. Changes were not saved.'); } });
      await startEdit();
      fireEvent.change(screen.getByLabelText('Emergency access'), { target: { value: 'Use loading bay exit' } });
      fireEvent.submit(form());
      expect(await screen.findByText('Venue not found. Changes were not saved.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.getByLabelText('Emergency access')).toHaveValue('Use loading bay exit');
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

  tc('FE-VCAT-021', 'VenueCatalogue (details)', 'A venue has a 1-minute setup and teardown duration.', 'The details show "1 minute" singular format.',
    { data: 'setup_time = 1, teardown_time = 1', steps: '1. Open a venue with 1 minute setup/teardown.' },
    async () => {
      backend({ detail: { ...VENUE, setup_time: 1, teardown_time: 1 } });
      await openDetail();
      expect(screen.getAllByText('1 minute')).toHaveLength(2);
    });

  tc('FE-VCAT-022', 'VenueCatalogue (details)', 'A venue is marked as not accessible.', 'The details show "Not accessible".',
    { data: 'accessible = 0', steps: '1. Open a venue with accessible = 0.' },
    async () => {
      backend({ detail: { ...VENUE, accessible: 0 } });
      await openDetail();
      expect(screen.getByText('Not accessible')).toBeInTheDocument();
    });

  tc('FE-VCAT-023', 'VenueCatalogue (edit)', 'Staff enters a setup time exceeding the maximum allowed value.', 'An error message appears and no PUT is sent.',
    { kind: 'Negative', data: 'setup_time = 3000000000', steps: '1. Edit a venue. 2. Enter 3000000000 for setup time. 3. Save.' },
    async () => {
      backend();
      await startEdit();
      fireEvent.change(screen.getByLabelText('Setup time (minutes)'), { target: { value: '3000000000' } });
      fireEvent.submit(form());
      expect(await screen.findByText(/Setup time must be a whole number of minutes/)).toBeInTheDocument();
      expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0);
    });

  tc('FE-VCAT-024', 'VenueCatalogue', 'Loading fails with an error having no message.', 'A default fallback error message is shown.',
    { kind: 'Negative', data: 'Error with empty message', steps: '1. Reject load with new Error(). 2. Check error text.' },
    async () => {
      request.mockRejectedValueOnce(new Error(''));
      render(<VenueCatalogue />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load venues.');
    });
});


tc('FE-VCAT-025', 'Venue unavailability', 'Staff block and reopen a venue.', 'The reason is saved and availability is updated.', { steps: 'Open venue, enter reason, block, reopen.' }, async () => {
  backend();
  request.mockImplementation(async (path, options = {}) => options.method === 'PATCH'
    ? { ...VENUE, ...JSON.parse(options.body) } : path === '/venue-catalogue' ? [VENUE] : VENUE);
  await openDetail({ canEdit: true });
  expect(screen.getByRole('button', { name: 'Mark unavailable' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason for unavailability'), { target: { value: 'Maintenance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));
  expect(await screen.findByRole('heading', { name: 'Unavailable' })).toBeInTheDocument();
  expect(screen.getByText('Maintenance')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark available' }));
  expect(await screen.findByRole('heading', { name: 'Available 24/7' })).toBeInTheDocument();
});

tc('FE-VCAT-026', 'Venue unavailability', 'Marking a venue unavailable fails.', 'The server error is shown and the venue remains available.',
  { kind: 'Negative', data: 'PATCH rejects with a server message', steps: '1. Open venue. 2. Enter reason. 3. Make PATCH fail. 4. Mark unavailable.' },
  async () => {
    backend();
    request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PATCH') throw new Error('Unable to block venue.');
      return path === '/venue-catalogue' ? [VENUE] : VENUE;
    });
    await openDetail({ canEdit: true });
    fireEvent.change(screen.getByLabelText('Reason for unavailability'), { target: { value: 'Maintenance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to block venue.');
    expect(screen.getByRole('heading', { name: 'Available 24/7' })).toBeInTheDocument();
  });

tc('FE-VCAT-027', 'Venue unavailability', 'Updating availability fails without a server error message.', 'The default availability error is shown.',
  { kind: 'Negative', data: 'PATCH rejects with an empty error message', steps: '1. Open venue. 2. Enter reason. 3. Make PATCH fail without a message. 4. Mark unavailable.' },
  async () => {
    backend();
    request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PATCH') throw new Error('');
      return path === '/venue-catalogue' ? [VENUE] : VENUE;
    });
    await openDetail({ canEdit: true });
    fireEvent.change(screen.getByLabelText('Reason for unavailability'), { target: { value: 'Maintenance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark unavailable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update availability.');
  });

