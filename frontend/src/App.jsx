import React, { useState } from 'react';

import { useAuth } from './AuthContext';
import Login from './Login';
import CoordinatorAssignment from './coordinator_assignment';
import EventOrganiser from './event_organiser';
import EquipmentRequest from './EquipmentRequest';


function AuthedApp() {

  const { user, logout } = useAuth();

  const isCoordinator =
    user.role
      .trim()
      .toLowerCase()
      .includes('coordinator');


  // ============================================================
  // EVENT COORDINATOR VIEW
  // ============================================================

  if (isCoordinator) {

    return (
      <CoordinatorWorkspace
        user={user}
        logout={logout}
      />
    );
  }


  // ============================================================
  // EVENT ORGANISER VIEW
  // Existing behaviour stays basically the same
  // ============================================================

  return (
    <OrganiserWorkspace
      user={user}
      logout={logout}
    />
  );
}


// ================================================================
// Event Coordinator workspace
// ================================================================

function CoordinatorWorkspace({
  user,
  logout
}) {

  const [
    activeSection,
    setActiveSection
  ] = useState('events');

  const [
    editingEvent,
    setEditingEvent
  ] = useState(null);

  const [
    eventMode,
    setEventMode
  ] = useState('management');


  function openEventManagement() {

    setActiveSection('events');

    setEventMode('management');

    setEditingEvent(null);
  }


  function openEquipmentRequest() {

    setActiveSection('equipment');

    setEditingEvent(null);
  }


  function editEvent(event) {

    setEditingEvent(event);

    setEventMode('edit');
  }


  return (

    <div className="coordinator-workspace">


      {/* ========================================================
          LEFT SIDEBAR
      ======================================================== */}

      <aside className="coordinator-sidebar">

        <div>

          <div className="logo">
            G
          </div>


          <div className="side-label">
            EVENT COORDINATOR
          </div>


          <nav className="coordinator-side-nav">

            <button

              type="button"

              className={
                activeSection === 'events'
                  ? 'coordinator-nav-button active'
                  : 'coordinator-nav-button'
              }

              onClick={
                openEventManagement
              }

            >

              Event Management

            </button>


            <button

              type="button"

              className={
                activeSection === 'equipment'
                  ? 'coordinator-nav-button active'
                  : 'coordinator-nav-button'
              }

              onClick={
                openEquipmentRequest
              }

            >

              Equipment Request

            </button>

          </nav>

        </div>


        <button
          type="button"
          className="coordinator-logout"
          onClick={logout}
          title={user.email}
        >

          Log out

        </button>

      </aside>


      {/* ========================================================
          RIGHT SIDE
      ======================================================== */}

      <div className="coordinator-main">


        {/* EVENT MANAGEMENT */}

        {
          activeSection === 'events' &&
          eventMode === 'management' && (

            <div className="embedded-existing-page">

              <CoordinatorAssignment

                user={user}

                onEditEvent={
                  editEvent
                }

              />

            </div>

          )
        }


        {/* Existing event edit behaviour */}

        {
          activeSection === 'events' &&
          eventMode === 'edit' && (

            <div className="embedded-existing-page">

              <EventOrganiser

                user={user}

                editingEvent={
                  editingEvent
                }

                onEditComplete={
                  () =>
                    setEditingEvent(null)
                }

              />

            </div>

          )
        }


        {/* EQUIPMENT REQUEST */}

        {
          activeSection === 'equipment' && (

            <EquipmentRequest
              user={user}
            />

          )
        }

      </div>

    </div>
  );
}


// ================================================================
// Existing organiser view
// ================================================================

function OrganiserWorkspace({
  user,
  logout
}) {

  const [
    activeRole,
    setActiveRole
  ] = useState('organiser');

  const [
    editingEvent,
    setEditingEvent
  ] = useState(null);


  return (

    <>

      <div
        className="role-tabs"
        role="tablist"
        aria-label="User role views"
      >

        <button

          className={
            activeRole === 'organiser'
              ? 'active'
              : ''
          }

          onClick={
            () =>
              setActiveRole(
                'organiser'
              )
          }

        >

          Create event

        </button>


        <button

          className={
            activeRole === 'coordinator'
              ? 'active'
              : ''
          }

          onClick={
            () =>
              setActiveRole(
                'coordinator'
              )
          }

        >

          Event status

        </button>


        <button
          className="logout-tab"
          onClick={logout}
          title={user.email}
        >

          Log out

        </button>

      </div>


      {
        activeRole === 'organiser'
          ? (

              <EventOrganiser

                user={user}

                editingEvent={
                  editingEvent
                }

                onEditComplete={
                  () =>
                    setEditingEvent(null)
                }

              />

            )
          : (

              <CoordinatorAssignment

                user={user}

                onEditEvent={
                  (event) => {

                    setEditingEvent(
                      event
                    );

                    setActiveRole(
                      'organiser'
                    );
                  }
                }

              />

            )
      }

    </>
  );
}


// ================================================================
// Main App
// ================================================================

export default function App() {

  const {
    user,
    loading
  } = useAuth();


  if (loading) {

    return (

      <div className="auth-screen">

        <p className="auth-loading">
          Loading…
        </p>

      </div>
    );
  }


  return user
    ? <AuthedApp />
    : <Login />;
}
