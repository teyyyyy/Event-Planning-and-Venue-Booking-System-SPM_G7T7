import React from 'react';
import { describe, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { tc } from '../test/tc';

const auth = vi.hoisted(() => ({ value: {} }));
vi.mock('../AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('../Login', () => ({ default: () => <div>LOGIN SCREEN</div> }));
vi.mock('../coordinator_assignment', () => ({
  default: ({ onEditEvent }) => <div>COORDINATOR PAGE<button onClick={() => onEditEvent({ id: 5 })}>trigger edit</button></div>,
}));
vi.mock('../event_organiser', () => ({
  default: ({ editingEvent, onEditComplete }) => <div>ORGANISER PAGE {editingEvent ? `editing ${editingEvent.id}` : 'new'}<button onClick={onEditComplete}>finish edit</button></div>,
}));
vi.mock('../EquipmentRequest', () => ({ default: () => <div>EQUIPMENT REQUEST PAGE</div> }));
vi.mock('../EquipmentUpdate', () => ({ default: () => <div>EQUIPMENT UPDATE PAGE</div> }));
vi.mock('../EquipmentAvailability', () => ({ default: () => <div>EQUIPMENT AVAILABILITY PAGE</div> }));
vi.mock('../venue_approval', () => ({ default: () => <div>VENUE APPROVAL PAGE</div> }));
vi.mock('../VenueRequest', () => ({ default: () => <div>VENUE REQUEST PAGE</div> }));
vi.mock('../VenueCatalogue', () => ({ default: ({ canEdit }) => <div>VENUE CATALOGUE PAGE {canEdit ? 'editable' : 'read-only'}</div> }));

import App from '../App';

const logout = vi.fn();
const as = (role) => { auth.value = { user: { id: 'u1', email: 'a@x.com', role }, loading: false, logout }; };

describe('App', () => {
  beforeEach(() => { auth.value = { user: null, loading: false, logout }; });

  tc('FE-APP-001', 'App', 'Authentication state is still loading.', 'A "Loading…" indicator is shown; neither login nor a workspace renders.',
    { kind: 'State', steps: '1. Render App with loading = true.' },
    () => {
      auth.value = { user: null, loading: true, logout };
      render(<App />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('LOGIN SCREEN')).toBeNull();
    });

  tc('FE-APP-002', 'App', 'No user is signed in.', 'The Login screen is shown.', { steps: '1. Render App with user = null.' },
    () => { render(<App />); expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument(); });

  tc('FE-APP-003', 'AuthedApp (technical support)', 'A Technical Support Staff user is signed in.', 'The technical-support sidebar shows with the Equipment Update page open by default.',
    { data: 'role = "technical support staff"', steps: '1. Render App as technical support.' },
    () => {
      as('technical support staff');
      render(<App />);
      expect(screen.getByText('TECHNICAL SUPPORT')).toBeInTheDocument();
      expect(screen.getByText('EQUIPMENT UPDATE PAGE')).toBeInTheDocument();
    });

  tc('FE-APP-004', 'AuthedApp (technical support)', 'Technical support switches to "Equipment Availability Check".', 'The availability page replaces the update page.',
    { steps: '1. Render as technical support. 2. Click the availability nav button.' },
    () => {
      as('technical support staff');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Equipment Availability Check' }));
      expect(screen.getByText('EQUIPMENT AVAILABILITY PAGE')).toBeInTheDocument();
      expect(screen.queryByText('EQUIPMENT UPDATE PAGE')).toBeNull();
    });

  tc('FE-APP-005', 'AuthedApp (coordinator)', 'An Event Coordinator is signed in.', 'The coordinator sidebar shows with Event Management open.',
    { data: 'role = "event coordinator"', steps: '1. Render App as coordinator.' },
    () => {
      as('event coordinator');
      render(<App />);
      expect(screen.getByText('EVENT COORDINATOR')).toBeInTheDocument();
      expect(screen.getByText(/COORDINATOR PAGE/)).toBeInTheDocument();
    });

  tc('FE-APP-006', 'AuthedApp (coordinator)', 'Coordinator opens "Equipment Request".', 'The equipment request page is shown.',
    { steps: '1. Render as coordinator. 2. Click "Equipment Request".' },
    () => {
      as('event coordinator');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Equipment Request' }));
      expect(screen.getByText('EQUIPMENT REQUEST PAGE')).toBeInTheDocument();
    });

  tc('FE-APP-007', 'AuthedApp (coordinator)', 'Coordinator clicks Edit on an event in Event Management.', 'The event form opens pre-filled with that event; finishing the edit returns to Event Management.',
    { steps: '1. Render as coordinator. 2. Trigger onEditEvent. 3. Trigger onEditComplete.' },
    () => {
      as('event coordinator');
      render(<App />);
      fireEvent.click(screen.getByText('trigger edit'));
      expect(screen.getByText('ORGANISER PAGE editing 5')).toBeInTheDocument();
      fireEvent.click(screen.getByText('finish edit'));
      expect(screen.getByText(/COORDINATOR PAGE/)).toBeInTheDocument();
    });

  tc('FE-APP-008', 'AuthedApp (coordinator)', 'Coordinator returns to "Event Management" from another section.', 'Event management is shown and any edit state is cleared.',
    { kind: 'State', steps: '1. Render as coordinator. 2. Open Equipment Request. 3. Click "Event Management".' },
    () => {
      as('event coordinator');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Equipment Request' }));
      fireEvent.click(screen.getByRole('button', { name: 'Event Management' }));
      expect(screen.getByText(/COORDINATOR PAGE/)).toBeInTheDocument();
    });

  tc('FE-APP-009', 'AuthedApp (organiser)', 'An Event Organiser is signed in.', 'The "Create event" tab is active showing the organiser form.',
    { data: 'role = "event organiser"', steps: '1. Render App as organiser.' },
    () => {
      as('event organiser');
      render(<App />);
      expect(screen.getByRole('button', { name: 'Create event' })).toHaveClass('active');
      expect(screen.getByText('ORGANISER PAGE new')).toBeInTheDocument();
    });

  tc('FE-APP-010', 'AuthedApp (organiser)', 'Organiser opens the "Event status" tab and edits an event.', 'Status view shows; choosing edit switches back to the form pre-filled with that event.',
    { steps: '1. Render as organiser. 2. Click "Event status". 3. Trigger onEditEvent.' },
    () => {
      as('event organiser');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Event status' }));
      fireEvent.click(screen.getByText('trigger edit'));
      expect(screen.getByText('ORGANISER PAGE editing 5')).toBeInTheDocument();
    });

  tc('FE-APP-011', 'AuthedApp (venue staff)', 'A Venue Staff user is signed in.', 'The venue-staff sidebar shows with the editable Venue Catalogue open by default and a Log out button.',
    { data: 'role = "venue staff"', steps: '1. Render App as venue staff.' },
    () => {
      as('venue staff');
      render(<App />);
      expect(screen.getByText('VENUE STAFF')).toBeInTheDocument();
      expect(screen.getByText('VENUE CATALOGUE PAGE editable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    });

  tc('FE-APP-012', 'AuthedApp (role matching)', 'Role has odd casing and surrounding spaces.', 'The role is normalised and the correct workspace opens.',
    { kind: 'Edge', data: 'role = "  Venue STAFF "', steps: '1. Render App with that role.' },
    () => { as('  Venue STAFF '); render(<App />); expect(screen.getByText('VENUE STAFF')).toBeInTheDocument(); });

  tc('FE-APP-013', 'AuthedApp (unknown role)', 'The user has a role the app does not recognise.', '"Access unavailable" is shown instead of any workspace.',
    { kind: 'Negative', data: 'role = "janitor"', steps: '1. Render App with an unknown role.' },
    () => {
      as('janitor');
      render(<App />);
      expect(screen.getByText('Access unavailable')).toBeInTheDocument();
      expect(screen.getByText('Your account does not have a recognised role.')).toBeInTheDocument();
    });

  tc('FE-APP-014', 'AuthedApp (unknown role)', 'User with an empty role clicks Log out.', 'logout is called.',
    { kind: 'Edge', data: 'role = ""', steps: '1. Render App with a blank role. 2. Click "Log out".' },
    () => {
      as('');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
      expect(logout).toHaveBeenCalledTimes(1);
    });

  tc('FE-APP-015', 'AuthedApp (logout)', 'Coordinator clicks Log out in the sidebar.', 'logout is called and the button title shows the user\'s email.',
    { steps: '1. Render as coordinator. 2. Click "Log out".' },
    () => {
      as('event coordinator');
      render(<App />);
      const button = screen.getByRole('button', { name: 'Log out' });
      expect(button).toHaveAttribute('title', 'a@x.com');
      fireEvent.click(button);
      expect(logout).toHaveBeenCalledTimes(1);
    });

  tc('FE-APP-016', 'AuthedApp (venue staff)', 'Venue staff switches to "Booking Approvals".', 'The approvals page replaces the catalogue; switching back shows the catalogue again.',
    { steps: '1. Render as venue staff. 2. Click "Booking Approvals". 3. Click "Venue Catalogue".' },
    () => {
      as('venue staff');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Booking Approvals' }));
      expect(screen.getByText('VENUE APPROVAL PAGE')).toBeInTheDocument();
      expect(screen.queryByText(/VENUE CATALOGUE PAGE/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Venue Catalogue' }));
      expect(screen.getByText(/VENUE CATALOGUE PAGE/)).toBeInTheDocument();
    });

  tc('FE-APP-017', 'AuthedApp (coordinator)', 'Coordinator opens "Venue Request".', 'The venue request page is shown.',
    { steps: '1. Render as coordinator. 2. Click "Venue Request".' },
    () => {
      as('event coordinator');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Venue Request' }));
      expect(screen.getByText('VENUE REQUEST PAGE')).toBeInTheDocument();
    });

  tc('FE-APP-018', 'AuthedApp (technical support)', 'Technical support opens "Venue Catalogue".', 'The catalogue is shown read-only (no edit rights).',
    { kind: 'Security', steps: '1. Render as technical support. 2. Click "Venue Catalogue".' },
    () => {
      as('technical support staff');
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Venue Catalogue' }));
      expect(screen.getByText('VENUE CATALOGUE PAGE read-only')).toBeInTheDocument();
    });
});
