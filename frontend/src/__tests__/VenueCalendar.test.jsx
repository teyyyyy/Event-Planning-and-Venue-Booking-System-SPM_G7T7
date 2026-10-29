import React from "react";
import { describe, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { tc } from "../test/tc";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ request }));

import VenueCalendar from "../components/VenueCalendar";
import VenueStaffCalendar from "../VenueStaffCalendar";
import { clockTime, eventWindow } from "../eventTimes";

const VENUES = [
  { venue_id: 1, name: "Hall A" },
  { venue_id: 2, name: "Hall B" },
];
// Wednesday 7 Oct 2026, so the calendar opens on the week of Monday 5 Oct.
const WEDNESDAY = new Date(2026, 9, 7, 10, 0);

const weekLabel = (monday) => {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;
};
const pickVenue = (id) =>
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: String(id) },
  });
// Cell for an hour row (0-23) and a weekday column (0 = Monday).
const cell = (hour, day) =>
  document.querySelectorAll("tbody tr")[hour].querySelectorAll("td")[day + 1];
const blocks = () => [...document.querySelectorAll("tbody td div[title]")];

describe("VenueCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  tc(
    "FE-VCAL-001",
    "VenueCalendar",
    "The calendar opens before a venue is chosen.",
    "The venue picker lists every venue, the current Monday-Sunday week is shown and the schedule asks for a venue; nothing is fetched.",
    {
      pre: "Today is Wednesday 7 Oct 2026.",
      steps: "1. Render with two venues.",
    },
    () => {
      render(<VenueCalendar venues={VENUES} />);
      expect(
        screen.getByRole("option", { name: "Select a venue to view..." }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Hall B" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(weekLabel(new Date(2026, 9, 5))),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Please select a venue to view its schedule."),
      ).toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );

  tc(
    "FE-VCAL-002",
    "VenueCalendar",
    "The calendar is opened on a Sunday.",
    "The week shown is the one that started on the previous Monday.",
    {
      kind: "Edge",
      pre: "Today is Sunday 11 Oct 2026.",
      steps: "1. Render on a Sunday.",
    },
    () => {
      vi.setSystemTime(new Date(2026, 9, 11, 10, 0));
      render(<VenueCalendar venues={VENUES} />);
      expect(
        screen.getByText(weekLabel(new Date(2026, 9, 5))),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VCAL-003",
    "VenueCalendar",
    "A venue is chosen.",
    "Approved and Pending bookings for that venue are requested; a 7-day grid with 24 hourly rows (12 AM … 11 PM) is shown and scrolled to 8 AM.",
    { steps: '1. Choose "Hall A".' },
    async () => {
      request.mockResolvedValue([]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/venue-booking-requests/venues/1?include_pending=true",
        ),
      );
      const hours = [...document.querySelectorAll("tbody tr")].map(
        (row) => row.querySelector("td").textContent,
      );
      expect(hours).toHaveLength(24);
      expect([hours[0], hours[1], hours[12], hours[13], hours[23]]).toEqual([
        "12 AM",
        "1 AM",
        "12 PM",
        "1 PM",
        "11 PM",
      ]);
      expect(document.querySelectorAll("thead th")).toHaveLength(8);
      expect(document.querySelector(".request-table-wrapper").scrollTop).toBe(
        480,
      );
    },
  );

  tc(
    "FE-VCAL-004",
    "VenueCalendar",
    "The venue has an approved booking, a pending booking and three incomplete records this week.",
    'Each booking is drawn in its day column at its start hour, offset by its start minute and as tall as its duration; pending ones are labelled "(Pending)" and dashed; records without event times or without a linked event are skipped and a missing event name shows "Unknown Event".',
    {
      pre: "Approved Gala Wed 09:30-11:00; Pending Talk Thu 14:00-15:00; one booking whose event has no times; one booking with no linked event; one approved booking Fri 08:00-09:00 whose event has no name.",
      steps: '1. Choose "Hall A".',
    },
    async () => {
      request.mockResolvedValue([
        {
          request_id: 1,
          status: "Approved",
          "Event Details": {
            event_name: "Gala",
            event_date: "2026-10-07",
            start_time: "09:30:00",
            end_time: "11:00:00",
          },
        },
        {
          request_id: 2,
          status: "Pending",
          "Event Details": {
            event_name: "Talk",
            event_date: "2026-10-08",
            event_end_date: "2026-10-08",
            start_time: "14:00:00",
            end_time: "15:00:00",
          },
        },
        {
          request_id: 3,
          status: "Approved",
          "Event Details": { event_name: "No times" },
        },
        {
          request_id: 4,
          status: "Approved",
          "Event Details": {
            event_date: "2026-10-09",
            start_time: "08:00:00",
            end_time: "09:00:00",
          },
        },
        { request_id: 7, status: "Approved", "Event Details": null },
      ]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(blocks()).toHaveLength(3));

      // Gala (Approved, 9:30 AM - 11:00 AM = 90 min / 90px)
      const galaContainer = cell(9, 2).querySelector("div");
      expect(galaContainer).toHaveTextContent("Gala");
      expect(galaContainer).toHaveTextContent("9:30 AM - 11:00 AM");
      expect(galaContainer.getAttribute("title")).toContain(
        "Gala (Req ID: 1) - Approved",
      );
      expect(galaContainer.style.top).toBe("30px");
      expect(galaContainer.querySelector("div").style.height).toBe("90px");
      expect(galaContainer.querySelector("div").style.border).toContain(
        "solid",
      );

      // Talk (Pending, 2:00 PM - 3:00 PM)
      const talkContainer = cell(14, 3).querySelector("div");
      expect(talkContainer).toHaveTextContent("Talk (Pending)");
      expect(talkContainer).toHaveTextContent("2:00 PM - 3:00 PM");
      expect(talkContainer.querySelector("div").style.border).toContain(
        "dashed",
      );

      expect(cell(8, 4).querySelector("div")).toHaveTextContent(
        "Unknown Event",
      );
      expect(screen.queryByText(/No times/)).toBeNull();
    },
  );

  tc(
    "FE-VCAL-005",
    "VenueCalendar",
    "A booking runs past midnight.",
    "It is split per day: until midnight on the first day, and from 12 AM to its end on the next day.",
    {
      kind: "Edge",
      data: "Wed 22:00 - Thu 02:00",
      steps: '1. Choose "Hall A" with an overnight booking.',
    },
    async () => {
      request.mockResolvedValue([
        {
          request_id: 5,
          status: "Approved",
          "Event Details": {
            event_name: "Night run",
            event_date: "2026-10-07",
            event_end_date: "2026-10-08",
            start_time: "22:00:00",
            end_time: "02:00:00",
          },
        },
      ]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);

      await waitFor(() => expect(blocks()).toHaveLength(2));

      // Wednesday Block (Wed 10:00 PM - 12:00 AM = 120px height)
      const wedContainer = cell(22, 2).querySelector("div");
      expect(wedContainer).toHaveTextContent("Night run");
      expect(wedContainer).toHaveTextContent("10:00 PM - 2:00 AM");
      expect(wedContainer.querySelector("div").style.height).toBe("120px");

      // Thursday Block (Thu 12:00 AM - 2:00 AM = 120px height)
      const thuContainer = cell(0, 3).querySelector("div");
      expect(thuContainer).toHaveTextContent("Night run");
      expect(thuContainer).toHaveTextContent("10:00 PM - 2:00 AM");
      expect(thuContainer.querySelector("div").style.height).toBe("120px");
    },
  );

  tc(
    "FE-VCAL-006",
    "VenueCalendar",
    "The user moves to the next week and back.",
    "The week label changes by seven days each time and only bookings in the visible week are drawn.",
    {
      kind: "State",
      pre: "One booking on Wed 14 Oct.",
      steps:
        '1. Choose "Hall A". 2. Click "Next Week →". 3. Click "← Prev Week".',
    },
    async () => {
      request.mockResolvedValue([
        {
          request_id: 6,
          status: "Approved",
          "Event Details": {
            event_name: "Next week",
            event_date: "2026-10-14",
            start_time: "10:00:00",
            end_time: "11:00:00",
          },
        },
      ]);
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() => expect(request).toHaveBeenCalled());
      expect(blocks()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Next Week →" }));
      expect(
        screen.getByText(weekLabel(new Date(2026, 9, 12))),
      ).toBeInTheDocument();
      expect(await screen.findByText("Next week")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "← Prev Week" }));
      expect(
        screen.getByText(weekLabel(new Date(2026, 9, 5))),
      ).toBeInTheDocument();
      expect(blocks()).toHaveLength(0);
    },
  );

  tc(
    "FE-VCAL-007",
    "VenueCalendar",
    "Loading bookings fails, then the venue is cleared.",
    'The error is logged and an empty grid is shown; clearing the venue returns to the "select a venue" message.',
    {
      kind: "Negative",
      data: 'request rejects "Network down"',
      steps:
        '1. Choose "Hall A" while the request fails. 2. Choose the placeholder option.',
    },
    async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      request.mockRejectedValue(new Error("Network down"));
      render(<VenueCalendar venues={VENUES} />);
      pickVenue(1);
      await waitFor(() =>
        expect(log).toHaveBeenCalledWith(
          "Failed to load calendar bookings",
          expect.any(Error),
        ),
      );
      expect(blocks()).toHaveLength(0);
      pickVenue("");
      expect(
        screen.getByText("Please select a venue to view its schedule."),
      ).toBeInTheDocument();
      log.mockRestore();
    },
  );

  tc(
    "FE-VCAL-010",
    "VenueCalendar (setup time)",
    "A venue has setup_time configured and a booking is displayed.",
    'The setup block renders "Setup" and the hover title reflects the expanded setup start time.',
    {
      pre: "Hall A has setup_time = 30.",
      steps: '1. Render with venue setup_time = 30. 2. Select "Hall A".',
    },
    async () => {
      const setupVenue = [
        { venue_id: 1, name: "Hall A", setup_time: 30, teardown_time: 0 },
      ];
      request.mockResolvedValue([
        {
          request_id: 1,
          status: "Approved",
          "Event Details": {
            event_name: "Gala",
            event_date: "2026-10-07",
            start_time: "10:00:00",
            end_time: "12:00:00",
          },
        },
      ]);
      render(<VenueCalendar venues={setupVenue} />);
      pickVenue(1);

      expect(await screen.findByText("Setup")).toBeInTheDocument();
      expect(screen.getByText("Gala")).toBeInTheDocument();

      const block = screen.getByText("Gala").closest("div[title]");
      expect(block.getAttribute("title")).toContain(
        "Booking (incl. setup & teardown): 9:30 AM - 12:00 PM",
      );
    },
  );

  tc(
    "FE-VCAL-011",
    "VenueCalendar (turnaround time)",
    "A venue has teardown_time configured and a booking is displayed.",
    'The teardown block renders "Teardown" and the hover title reflects the expanded teardown end time.',
    {
      pre: "Hall A has teardown_time = 30.",
      steps: '1. Render with venue teardown_time = 30. 2. Select "Hall A".',
    },
    async () => {
      const teardownVenue = [
        { venue_id: 1, name: "Hall A", setup_time: 0, teardown_time: 30 },
      ];
      request.mockResolvedValue([
        {
          request_id: 1,
          status: "Approved",
          "Event Details": {
            event_name: "Gala",
            event_date: "2026-10-07",
            start_time: "10:00:00",
            end_time: "12:00:00",
          },
        },
      ]);
      render(<VenueCalendar venues={teardownVenue} />);
      pickVenue(1);

      expect(await screen.findByText("Teardown")).toBeInTheDocument();

      const block = screen.getByText("Gala").closest("div[title]");
      expect(block.getAttribute("title")).toContain(
        "Booking (incl. setup & teardown): 10:00 AM - 12:30 PM",
      );
    },
  );

  tc(
    "FE-VCAL-012",
    "VenueCalendar (short setup/teardown)",
    "A venue has short setup and teardown durations (< 15 mins).",
    "The blocks render without text labels when shorter than 15 minutes.",
    {
      pre: "Hall A has setup_time = 10, teardown_time = 5.",
      steps: '1. Render with setup_time = 10, teardown_time = 5. 2. Select "Hall A".',
    },
    async () => {
      const shortVenue = [
        { venue_id: 1, name: "Hall A", setup_time: 10, teardown_time: 5 },
      ];
      request.mockResolvedValue([
        {
          request_id: 1,
          status: "Approved",
          "Event Details": {
            event_name: "Short Setup",
            event_date: "2026-10-07",
            start_time: "10:00:00",
            end_time: "12:00:00",
          },
        },
      ]);
      render(<VenueCalendar venues={shortVenue} />);
      pickVenue(1);

      await waitFor(() => expect(screen.getByText("Short Setup")).toBeInTheDocument());
      expect(screen.queryByText("Setup")).not.toBeInTheDocument();
      expect(screen.queryByText("Teardown")).not.toBeInTheDocument();
    },
  );
});

describe("eventTimes", () => {
  tc(
    "FE-VCAL-013",
    "eventWindow",
    "An event has a start date, end date and times.",
    "Start and end combine each date with its time as SGT wall-clock values; a blank end date ends the event on its start date.",
    {
      data: "2026-10-07 22:00 to 2026-10-08 02:00; 2026-10-09 08:00-09:30 with no end date",
      steps: "1. Call eventWindow for a multi-day event. 2. Call it for a single-day event.",
    },
    () => {
      const overnight = eventWindow({
        event_date: "2026-10-07",
        event_end_date: "2026-10-08",
        start_time: "22:00:00",
        end_time: "02:00:00",
      });
      expect(overnight).toEqual({
        start: new Date(2026, 9, 7, 22, 0),
        end: new Date(2026, 9, 8, 2, 0),
      });
      const singleDay = eventWindow({
        event_date: "2026-10-09",
        event_end_date: null,
        start_time: "08:00",
        end_time: "09:30:00",
      });
      expect(singleDay).toEqual({
        start: new Date(2026, 9, 9, 8, 0),
        end: new Date(2026, 9, 9, 9, 30),
      });
    },
  );

  tc(
    "FE-VCAL-014",
    "eventWindow",
    "There is no event, or it is missing its date or a time, or its date is invalid.",
    "null is returned in every case.",
    {
      kind: "Negative",
      data: 'null; no event_date; no start_time; no end_time; event_date = "2026-13-45"',
      steps: "1. Call eventWindow with each incomplete or invalid event.",
    },
    () => {
      const full = {
        event_date: "2026-10-07",
        start_time: "09:00:00",
        end_time: "17:00:00",
      };
      expect(eventWindow(null)).toBeNull();
      expect(eventWindow({ ...full, event_date: null })).toBeNull();
      expect(eventWindow({ ...full, start_time: null })).toBeNull();
      expect(eventWindow({ ...full, end_time: "" })).toBeNull();
      expect(eventWindow({ ...full, event_date: "2026-13-45" })).toBeNull();
      expect(eventWindow({ ...full, event_end_date: "soon" })).toBeNull();
    },
  );

  tc(
    "FE-VCAL-015",
    "clockTime",
    "A stored time has seconds, has none, or is missing.",
    'The hours and minutes are returned ("09:00"); a missing time gives "".',
    {
      kind: "Edge",
      data: '"09:00:00", "14:30", null',
      steps: "1. Call clockTime for each value.",
    },
    () => {
      expect(clockTime("09:00:00")).toBe("09:00");
      expect(clockTime("14:30")).toBe("14:30");
      expect(clockTime(null)).toBe("");
    },
  );
});

describe("VenueStaffCalendar", () => {
  tc(
    "FE-VCAL-008",
    "VenueStaffCalendar",
    "Venue staff opens the availability calendar.",
    "A loading message shows, then the venue list is fetched and offered in the calendar.",
    { steps: "1. Render. 2. Wait for the calendar." },
    async () => {
      request.mockResolvedValue(VENUES);
      render(<VenueStaffCalendar />);
      expect(screen.getByText("Loading calendar data...")).toBeInTheDocument();
      expect(
        await screen.findByRole("heading", {
          name: "Venue Availability Calendar",
        }),
      ).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("/venues");
      expect(
        screen.getByRole("option", { name: "Hall A" }),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VCAL-009",
    "VenueStaffCalendar",
    "The venue list cannot be loaded.",
    "The error is logged and the calendar still opens with no venues to choose.",
    {
      kind: "Negative",
      data: "request rejects",
      steps: "1. Make /venues fail. 2. Render.",
    },
    async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      request.mockRejectedValue(new Error("Forbidden"));
      render(<VenueStaffCalendar />);
      expect(
        await screen.findByRole("heading", {
          name: "Venue Availability Calendar",
        }),
      ).toBeInTheDocument();
      expect(log).toHaveBeenCalledWith(
        "Failed to fetch calendar data:",
        expect.any(Error),
      );
      expect(screen.getAllByRole("option")).toHaveLength(1);
      log.mockRestore();
    },
  );
});
