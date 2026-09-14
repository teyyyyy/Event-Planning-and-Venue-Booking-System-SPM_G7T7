import React, { useState } from 'react';

import { useAuth } from './AuthContext';
import Login from './Login';
import CoordinatorAssignment from './coordinator_assignment';
import EventOrganiser from './event_organiser';
import EquipmentRequest from './EquipmentRequest';
import EquipmentUpdate from './EquipmentUpdate';


function AuthedApp() {

  const { user, logout } = useAuth();


  const normalizedRole =
    user.role
      .trim()
      .toLowerCase();


  const isCoordinator =
    normalizedRole ===
    'event coordinator';


  const isTechnicalSupport =
    normalizedRole ===
    'technical support staff';


  const isOrganiser =
    normalizedRole ===
    'event organiser';


  // ============================================================
  // TECHNICAL SUPPORT STAFF VIEW
  // ============================================================

  if (isTechnicalSupport) {

    return (
      <TechnicalSupportWorkspace
        user={user}
        logout={logout}
      />
    );
  }


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
  // ============================================================

  if (isOrganiser) {

    return (
      <OrganiserWorkspace
        user={user}
        logout={logout}
      />
    );
  }


  // ============================================================
  // UNKNOWN ROLE FALLBACK
  // ============================================================

  return (

    <div className="auth-screen">

      <div className="auth-card">

        <h2>
          Access unavailable
        </h2>

        <p>
          Your account does not have a recognised role.
        </p>

        <button
          type="button"
          className="primary"
          onClick={logout}
        >
          Log out
        </button>

      </div>

    </div>
  );
}


// ================================================================
// Technical Support Staff workspace
// ================================================================

function TechnicalSupportWorkspace({
  user,
  logout
}) {

  const [
    activeSection,
    setActiveSection
  ] = useState('equipment-update');


  function openEquipmentUpdate() {

    setActiveSection(
      'equipment-update'
    );
  }


  /*
   * Later when EquipmentReservation.jsx is created,
   * you can add:
   *
   * function openEquipmentReservation() {
   *   setActiveSection('equipment-reservation');
   * }
   */


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
            TECHNICAL SUPPORT
          </div>


          <nav className="coordinator-side-nav">

            <button

              type="button"

              className={
                activeSection === 'equipment-update'
                  ? 'coordinator-nav-button active'
                  : 'coordinator-nav-button'
              }

              onClick={
                openEquipmentUpdate
              }

            >

              Equipment Update

            </button>


            {/*
              Later, when Equipment Reservation is ready:

              <button

                type="button"

                className={
                  activeSection === 'equipment-reservation'
                    ? 'coordinator-nav-button active'
                    : 'coordinator-nav-button'
                }

                onClick={
                  () =>
                    setActiveSection(
                      'equipment-reservation'
                    )
                }

              >

                Equipment Reservation

              </button>
            */}

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


        {/* EQUIPMENT UPDATE */}

        {
          activeSection === 'equipment-update' && (

            <EquipmentUpdate
              user={user}
            />

          )
        }


        {/*
          Later, when EquipmentReservation.jsx exists:

          {
            activeSection === 'equipment-reservation' && (

              <EquipmentReservation
                user={user}
              />

            )
          }
        */}

      </div>

    </div>
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
                  () => {
                    setEditingEvent(null);
                    setEventMode('management');
                  }
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
