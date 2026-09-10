import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import Login from './Login';
import CoordinatorAssignment from './coordinator_assignment';
import EventOrganiser from './event_organiser';

function AuthedApp() {
  const { user, logout } = useAuth();
  const [activeRole, setActiveRole] = useState('organiser');

  return (
    <>
      <div className="role-tabs" role="tablist" aria-label="User role views">
        <button
          className={activeRole === 'organiser' ? 'active' : ''}
          onClick={() => setActiveRole('organiser')}
        >
          Event organiser
        </button>
        <button
          className={activeRole === 'coordinator' ? 'active' : ''}
          onClick={() => setActiveRole('coordinator')}
        >
          Coordinator assignment
        </button>
        <button className="logout-tab" onClick={logout} title={user.email}>
          Log out
        </button>
      </div>
      {activeRole === 'organiser' ? <EventOrganiser /> : <CoordinatorAssignment />}
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
