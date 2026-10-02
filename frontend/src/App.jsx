import React, { useState } from "react";
import { useAuth } from "./AuthContext";
import Login from "./Login";
import MfaChallenge from "./MfaChallenge";
import SecurityButton from "./SecuritySettings";
import CoordinatorAssignment from "./coordinator_assignment";
import EventOrganiser from "./event_organiser";
import EquipmentRequest from "./EquipmentRequest";
import EquipmentUpdate from "./EquipmentUpdate";
import EquipmentAvailability from "./EquipmentAvailability";
import VenueApproval from "./venue_approval";
import VenueRequest from "./VenueRequest";
import VenueCatalogue from "./VenueCatalogue";

import AttendeeWorkspace from "./AttendeeWorkspace";
import Notifications from "./Notifications";

function AuthedApp() {
  const { user, logout } = useAuth();
  const normalizedRole = user.role.trim().toLowerCase();
  const isCoordinator = normalizedRole === "event coordinator";
  const isTechnicalSupport = normalizedRole === "technical support staff";
  const isOrganiser = normalizedRole === "event organiser";
  const isVenueStaff = normalizedRole === "venue staff";
  const isAttendee = normalizedRole === "attendee";

  if (isAttendee) return <AttendeeWorkspace user={user} logout={logout} />;
  if (isTechnicalSupport)
    return <TechnicalSupportWorkspace user={user} logout={logout} />;
  if (isCoordinator)
    return <CoordinatorWorkspace user={user} logout={logout} />;
  if (isOrganiser) return <OrganiserWorkspace user={user} logout={logout} />;
  if (isVenueStaff)
    return <VenueStaffWorkspace logout={logout} email={user.email} />;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h2>Access unavailable</h2>
        <p>Your account does not have a recognised role.</p>
        <button type="button" className="primary" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
}

// Venue Staff workspace
function VenueStaffWorkspace({ logout, email }) {
  const [activeSection, setActiveSection] = useState("catalogue");
  return (
    <div className="coordinator-workspace">
      <aside className="coordinator-sidebar">
        <div><div className="logo">G</div><div className="side-label">VENUE STAFF</div>
          <nav className="coordinator-side-nav" aria-label="Venue Staff navigation">
            <button type="button" className={`coordinator-nav-button ${activeSection === 'catalogue' ? 'active' : ''}`} onClick={() => setActiveSection('catalogue')}>Venue Catalogue</button>
            <button type="button" className={`coordinator-nav-button ${activeSection === 'approvals' ? 'active' : ''}`} onClick={() => setActiveSection('approvals')}>Booking Approvals</button>
          </nav>
        </div>
        <div className="coordinator-side-footer"><SecurityButton /><button className="coordinator-logout" onClick={logout} title={email}>Log out</button></div>
      </aside>
      <div className="coordinator-main">
        {activeSection === 'catalogue' ? <VenueCatalogue canEdit /> : <div className="embedded-existing-page"><VenueApproval /></div>}
      </div>
    </div>
  );
}

// Technical Support Staff workspace
function TechnicalSupportWorkspace({ user, logout }) {
  const [activeSection, setActiveSection] = useState("equipment-update");

  return (
    <div className="coordinator-workspace">
      <aside className="coordinator-sidebar">
        <div>
          <div className="logo">G</div>
          <div className="side-label">TECHNICAL SUPPORT</div>

          <nav className="coordinator-side-nav">
            <button type="button" className={`coordinator-nav-button ${activeSection === 'catalogue' ? 'active' : ''}`} onClick={() => setActiveSection('catalogue')}>Venue Catalogue</button>
            <button
              type="button"
              className={
                activeSection === "equipment-update"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={() => setActiveSection("equipment-update")}
            >
              Equipment Update
            </button>

            <button
              type="button"
              className={
                activeSection === "equipment-availability"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={() => setActiveSection("equipment-availability")}
            >
              Equipment Availability Check
            </button>
          </nav>
        </div>

        <div className="coordinator-side-footer"><SecurityButton /><button
          type="button"
          className="coordinator-logout"
          onClick={logout}
          title={user.email}
        >
          Log out
        </button></div>
      </aside>

      <div className="coordinator-main">
        {activeSection === "catalogue" && <VenueCatalogue />}
        {activeSection === "equipment-update" && (
          <EquipmentUpdate user={user} />
        )}
        {activeSection === "equipment-availability" && (
          <EquipmentAvailability user={user} />
        )}
      </div>
    </div>
  );
}

// Event Coordinator workspace
function CoordinatorWorkspace({ user, logout }) {
  const [activeSection, setActiveSection] = useState("events");
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventMode, setEventMode] = useState("management");

  function openEventManagement() {
    setActiveSection("events");
    setEventMode("management");
    setEditingEvent(null);
  }

  function openEquipmentRequest() {
    setActiveSection("equipment");
    setEditingEvent(null);
  }

  function openVenueRequest() {
    setActiveSection("venue");
    setEditingEvent(null);
  }

  function editEvent(event) {
    setEditingEvent(event);
    setEventMode("edit");
  }

  return (
    <div className="coordinator-workspace">
      <aside className="coordinator-sidebar">
        <div>
          <div className="logo">G</div>
          <div className="side-label">EVENT COORDINATOR</div>

          <nav className="coordinator-side-nav">
            <button
              type="button"
              className={
                activeSection === "events"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={openEventManagement}
            >
              Event Management
            </button>

            <button
              type="button"
              className={
                activeSection === "equipment"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={openEquipmentRequest}
            >
              Equipment Request
            </button>

            <button
              type="button"
              className={
                activeSection === "venue"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={openVenueRequest}
            >
              Venue Request
            </button>
          </nav>
        </div>

        <div className="coordinator-side-footer"><SecurityButton /><button
          type="button"
          className="coordinator-logout"
          onClick={logout}
          title={user.email}
        >
          Log out
        </button></div>
      </aside>

      <div className="coordinator-main">
        {activeSection === "events" && eventMode === "management" && (
          <div className="embedded-existing-page">
            <CoordinatorAssignment user={user} onEditEvent={editEvent} />
          </div>
        )}

        {activeSection === "events" && eventMode === "edit" && (
          <div className="embedded-existing-page">
            <EventOrganiser
              user={user}
              editingEvent={editingEvent}
              onEditComplete={() => {
                setEditingEvent(null);
                setEventMode("management");
              }}
            />
          </div>
        )}

        {activeSection === "equipment" && <EquipmentRequest user={user} />}

        {activeSection === "venue" && <VenueRequest user={user} />}
      </div>
    </div>
  );
}

// Event Organiser workspace
function OrganiserWorkspace({ user, logout }) {
  const [activeRole, setActiveRole] = useState("organiser");

  return (
    <div className="coordinator-workspace">
      <aside className="coordinator-sidebar">
        <div>
          <div className="logo">G</div>
          <div className="side-label">EVENT ORGANISER</div>

          <nav className="coordinator-side-nav" aria-label="Event Organiser navigation">
            <button
              type="button"
              className={
                activeRole === "organiser"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={() => setActiveRole("organiser")}
            >
              Create event
            </button>

            <button
              type="button"
              className={
                activeRole === "coordinator"
                  ? "coordinator-nav-button active"
                  : "coordinator-nav-button"
              }
              onClick={() => setActiveRole("coordinator")}
            >
              Event status
            </button>
          </nav>
        </div>

        <div className="coordinator-side-footer"><SecurityButton /><button
          type="button"
          className="coordinator-logout"
          onClick={logout}
          title={user.email}
        >
          Log out
        </button></div>
      </aside>

      <div className="coordinator-main">
        <div className="embedded-existing-page">
          {activeRole === "organiser" ? (
            <EventOrganiser user={user} />
          ) : (
            <CoordinatorAssignment user={user} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading, mfa } = useAuth();

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  if (user) return <React.Fragment key={user.id}><AuthedApp /><Notifications /></React.Fragment>;
  return mfa ? <MfaChallenge /> : <Login />;
}
