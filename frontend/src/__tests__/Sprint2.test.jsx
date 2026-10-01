import React from 'react';
import { describe, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { tc } from '../test/tc';
vi.mock('../api', () => ({ request: vi.fn() }));
vi.mock('../SecuritySettings', () => ({ default: () => null }));
import { request } from '../api';
import AttendeeWorkspace from '../AttendeeWorkspace';
import Notifications from '../Notifications';
const event = { id: 1, event_name: 'Gather', description: 'Latest details', status: 'Confirmed', event_date: '2099-01-01', start_time: '09:00', end_time: '10:00', venues: [{ name: 'Hall', location: 'Campus' }] };
beforeEach(() => { request.mockReset(); window.history.replaceState(null, '', '/'); });

describe('Sprint 2', () => {
  tc('FE-SP2-001', 'Attendee registration', 'Attendee registers for a confirmed event.', 'Success is displayed and repeat registration is disabled.', { steps: '1. Browse events. 2. Click Register.' }, async () => {
    request.mockResolvedValueOnce([event]).mockResolvedValueOnce({ message: 'Registration successful.' });
    render(<AttendeeWorkspace user={{ email: 'a@example.com' }} logout={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('Registration successful.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registered' })).toBeDisabled();
    expect(request).toHaveBeenCalledWith('/attendee/events/1/register', { method: 'POST' });
  });
  tc('FE-SP2-002', 'Registration conflict', 'Last available place was already taken.', 'Server error is shown without a false success.', { steps: '1. Reject registration as full. 2. Click Register.' }, async () => {
    request.mockResolvedValueOnce([event]).mockRejectedValueOnce(new Error('This event is full.'));
    render(<AttendeeWorkspace user={{}} logout={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This event is full.');
    expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled();
  });
  tc('FE-SP2-003', 'My registered events', 'A registered event was cancelled.', 'Current event details and Cancelled status remain visible.', { steps: '1. Switch to My registered events.' }, async () => {
    request.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...event, status: 'Cancelled', registered: true }]);
    render(<AttendeeWorkspace user={{}} logout={vi.fn()} />);
    await screen.findByText('No upcoming confirmed events are available.');
    fireEvent.click(screen.getByRole('button', { name: 'My registered events' }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Hall (Campus)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
  });
  tc('FE-SP2-004', 'Empty registrations', 'Attendee has no registrations.', 'An explicit empty message is shown.', { steps: '1. Open My registered events with an empty API response.' }, async () => {
    request.mockResolvedValue([]);
    render(<AttendeeWorkspace user={{}} logout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'My registered events' }));
    expect(await screen.findByText('You have no registered events.')).toBeInTheDocument();
  });
  tc('FE-SP2-005', 'Notification read status', 'An unread notification is displayed.', 'Mark as read persists through the API and updates the unread count.', { steps: '1. Open notifications. 2. Mark as read.' }, async () => {
    request.mockResolvedValueOnce([{ id: 1, description: 'Gather cancelled.', created_at: '2026-01-01T00:00:00Z', is_read: false }]).mockResolvedValueOnce({ is_read: true });
    render(<Notifications />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
    expect(screen.getByRole('link', { name: 'View record' })).toHaveAttribute('href', '#notification/1');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull());
    expect(request).toHaveBeenCalledWith('/notifications/1/read', { method: 'PATCH' });
  });
  tc('FE-SP2-006', 'Notification link access', 'A bookmarked notification links to a record the user cannot access.', 'Access error is shown without record details.', { steps: '1. Open #notification/1. 2. Reject record access.' }, async () => {
    window.history.replaceState(null, '', '/#notification/1');
    request.mockImplementation(path => path.endsWith('/record') ? Promise.reject(new Error('You no longer have access to this event.')) : Promise.resolve([]));
    render(<Notifications />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You no longer have access');
    expect(screen.queryByText('Latest details')).toBeNull();
  });
});


afterEach(() => { vi.useRealTimers(); });
const notification = { id: 1, description: 'Gather cancelled.', created_at: '2026-01-01T00:00:00Z', is_read: false };

tc('FE-SP2-007', 'Failed read save', 'Mark as read fails.', 'Notification stays unread and can be retried.', { steps: '1. Open inbox. 2. Reject PATCH. 3. Retry successfully.', kind: 'Negative' }, async () => {
  request.mockResolvedValueOnce([notification]).mockRejectedValueOnce(new Error('Unable to save.')).mockResolvedValueOnce({ is_read: true });
  render(<Notifications />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save.');
  expect(screen.getByRole('button', { name: 'Notifications (1)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull());
});

tc('FE-SP2-008', 'Event refresh', 'Registered event details change.', 'Refresh shows the latest name and cancelled status.', { steps: '1. Open registrations. 2. Refresh after details change.' }, async () => {
  request.mockResolvedValueOnce([]).mockResolvedValueOnce([event]).mockResolvedValueOnce([{ ...event, event_name: 'Updated Gather', status: 'Cancelled' }]);
  render(<AttendeeWorkspace user={{}} logout={vi.fn()} />);
  await screen.findByText('No upcoming confirmed events are available.');
  fireEvent.click(screen.getByRole('button', { name: 'My registered events' }));
  await screen.findByText('Gather');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }));
  expect(await screen.findByText('Updated Gather')).toBeInTheDocument();
  expect(screen.getByText('Cancelled')).toBeInTheDocument();
});

tc('FE-SP2-009', 'Notification polling', 'A new notification arrives while the inbox is open.', 'The 30-second poll refreshes the inbox; unmount stops polling.', { steps: '1. Render inbox. 2. Advance 30 seconds. 3. Unmount and advance again.' }, async () => {
  vi.useFakeTimers();
  request.mockResolvedValueOnce([]).mockResolvedValue([notification]);
  const { unmount } = render(<Notifications />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText('Gather cancelled.')).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(request).toHaveBeenCalledTimes(2);
});

tc('FE-SP2-010', 'Inbox retry', 'Initial inbox request fails.', 'The error is shown and manual refresh recovers to an empty inbox.', { steps: '1. Reject initial fetch. 2. Open inbox. 3. Refresh.', kind: 'Negative' }, async () => {
  request.mockRejectedValueOnce(new Error('Database setup is incomplete.')).mockResolvedValueOnce([]);
  render(<Notifications />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Database setup is incomplete.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }));
  expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

tc('FE-SP2-011', 'Correct linked record', 'A venue booking notification is opened.', 'The exact booking, venue and rejection details are shown.', { steps: '1. Open notification deep link. 2. Inspect linked booking.' }, async () => {
  window.history.replaceState(null, '', '/#notification/1');
  request.mockImplementation(path => Promise.resolve(path.endsWith('/record') ? { type: 'venue_booking', event, record: { request_id: 7, status: 'Rejected', rejection_reason: 'Unavailable' }, venue: { name: 'Hall B', location: 'Campus' } } : [notification]));
  render(<Notifications />);
  expect(await screen.findByText('Venue booking #7')).toBeInTheDocument();
  expect(screen.getByText('Requested venue: Hall B — Campus')).toBeInTheDocument();
  expect(screen.getByText('Reason: Unavailable')).toBeInTheDocument();
});

tc('FE-SP2-012', 'Registration pending', 'The registration response has not arrived.', 'Repeated clicks are blocked until the response returns.', { steps: '1. Hold POST pending. 2. Click Register. 3. Check disabled action. 4. Resolve success.' }, async () => {
  let complete;
  request.mockResolvedValueOnce([event]).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  render(<AttendeeWorkspace user={{}} logout={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Register' }));
  expect(screen.getByRole('button', { name: 'Registering…' })).toBeDisabled();
  await act(async () => complete({ message: 'Registration successful.' }));
  expect(screen.getByRole('button', { name: 'Registered' })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(2);
});
