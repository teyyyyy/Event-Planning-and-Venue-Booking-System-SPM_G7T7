import React, { useState, useEffect } from "react";
import VenueCalendar from "./components/VenueCalendar";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";

export default function VenueStaffCalendarView() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCalendarData() {
      try {
        const venuesRes = await fetch(`${API}/venues`);

        if (venuesRes.ok) {
          setVenues(await venuesRes.json());
        }
      } catch (error) {
        console.error("Failed to fetch calendar data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchCalendarData();
  }, []);

  if (loading) {
    return <div className="empty">Loading calendar data...</div>;
  }

  return (
    <main className="shell">
      <section className="content">
        <header>
          <div>
            <p className="kicker">Gather / Venue desk</p>
            <h1>Venue Availability Calendar</h1>
          </div>
        </header>
        <VenueCalendar venues={venues} apiBaseUrl={API} />
      </section>
    </main>
  );
}
