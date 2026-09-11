import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import Login from './Login';
import CoordinatorAssignment from './coordinator_assignment';
import EventOrganiser from './event_organiser';

function AuthedApp() {
  const { user, logout } = useAuth();
  const isCoordinator = user.role.trim().toLowerCase().includes('coordinator');
  const [activeRole, setActiveRole] = useState(isCoordinator ? 'coordinator' : 'organiser');
  const [editingEvent, setEditingEvent] = useState(null);

  return (
    <>
      <div className="role-tabs" role="tablist" aria-label="User role views">
        {!isCoordinator && <button
          className={activeRole === 'organiser' ? 'active' : ''}
          onClick={() => setActiveRole('organiser')}
        >
          Create event
        </button>}
        <button
          className={activeRole === 'coordinator' ? 'active' : ''}
          onClick={() => setActiveRole('coordinator')}
        >
          {isCoordinator ? 'Event management' : 'Event status'}
        </button>
        <button className="logout-tab" onClick={logout} title={user.email}>
          Log out
        </button>
      </div>
      {activeRole === 'organiser' ? <EventOrganiser user={user} editingEvent={editingEvent} onEditComplete={() => setEditingEvent(null)} /> : <CoordinatorAssignment user={user} onEditEvent={(event) => { setEditingEvent(event); setActiveRole('organiser'); }} />}
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  return user ? <AuthedApp /> : <Login />;
}
