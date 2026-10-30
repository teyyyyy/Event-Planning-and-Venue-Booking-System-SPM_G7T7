import React from "react";
import { describe, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { tc } from "../test/tc";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ request }));

import VenueApproval from "../venue_approval";

const booking = (o = {}) => ({
  request_id: 1,
  status: "Pending",
  event_id: 10,
  event_name: "Gala",
  venue_id: 1,
  venue_name: "Hall A",
  event_date: "2026-10-03",
  event_end_date: "2026-10-05",
  start_time: "09:00:00",
  end_time: "17:00:00",
  accessibility_required: true,
  layout_required: "Theatre",
  facilities_required: ["Parking", "AV"],
  event_type: "Dinner",
  event_capacity: 100,
  coordinator_name: "Cara",
  coordinator_email: "c@x",
  event_description: "A gala",
  ...o,
});
const open = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "View details" }));
  return screen.getByRole("region", { name: "Venue booking request details" });
};

describe("VenueApproval", () => {
  tc(
    "FE-VENUE-001",
    "VenueApproval",
    "Venue staff opens the page.",
    "A loading row shows, then /venue-booking-requests is fetched and each request lists event, venue, SGT start/end and status.",
    {
      pre: "API returns one booking.",
      steps: "1. Render. 2. Wait for the table.",
    },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      expect(screen.getByText("Loading…")).toBeInTheDocument();
      expect(await screen.findByText("Gala")).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("/venue-booking-requests");
      expect(screen.getByText("2026-10-03 09:00 SGT")).toBeInTheDocument();
      expect(screen.getByText("2026-10-05 17:00 SGT")).toBeInTheDocument();
      expect(screen.getByText("Hall A")).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-002",
    "VenueApproval",
    "There are no requests.",
    '"No venue booking requests found." is displayed.',
    { kind: "Edge", steps: "1. Return an empty list." },
    async () => {
      request.mockResolvedValue([]);
      render(<VenueApproval />);
      expect(
        await screen.findByText("No venue booking requests found."),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-003",
    "VenueApproval",
    "Loading fails.",
    'The message "Unable to load venue booking requests. (<error>)" is shown.',
    {
      kind: "Negative",
      data: '"Missing bearer token."',
      steps: "1. Reject the request call.",
    },
    async () => {
      request.mockRejectedValue(new Error("Missing bearer token."));
      render(<VenueApproval />);
      expect(
        await screen.findByText(
          "Unable to load venue booking requests. (Missing bearer token.)",
        ),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-004",
    "VenueApproval",
    "A booking has no event name.",
    'The row falls back to "Event #<id>".',
    { kind: "Edge", steps: "1. Return a booking with event_name null." },
    async () => {
      request.mockResolvedValue([booking({ event_name: null })]);
      render(<VenueApproval />);
      expect(await screen.findByText("Event #10")).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-005",
    "RequestDetail",
    'Staff clicks "View details".',
    "A details panel shows status, venue, times, accessibility, layout, facilities, type, capacity, coordinator (with email) and description.",
    { steps: '1. Render. 2. Click "View details".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      const panel = await open();
      const p = within(panel);
      expect(p.getByText("Yes")).toBeInTheDocument();
      expect(p.getByText("Theatre")).toBeInTheDocument();
      expect(p.getByText("Parking, AV")).toBeInTheDocument();
      expect(p.getByText("Cara (c@x)")).toBeInTheDocument();
      expect(p.getByText("A gala")).toBeInTheDocument();
      expect(p.getByText("100")).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-006",
    "RequestDetail",
    "Optional values are missing.",
    'Blank fields show "—"; accessibility shows "No"; timestamps show "—".',
    { kind: "Edge", steps: "1. Open a booking with empty optional fields." },
    async () => {
      request.mockResolvedValue([
        booking({
          accessibility_required: false,
          layout_required: null,
          facilities_required: [],
          coordinator_name: null,
          event_description: null,
          start_time: null,
        }),
      ]);
      render(<VenueApproval />);
      const panel = await open();
      expect(within(panel).getByText("No")).toBeInTheDocument();
      expect(within(panel).getAllByText("—").length).toBeGreaterThanOrEqual(5);
    },
  );

  tc(
    "FE-VENUE-007",
    "RequestDetail",
    "Coordinator has a name but no email.",
    "Only the name is shown, without brackets.",
    {
      kind: "Edge",
      steps: "1. Open a booking whose coordinator_email is null.",
    },
    async () => {
      request.mockResolvedValue([booking({ coordinator_email: null })]);
      render(<VenueApproval />);
      expect(within(await open()).getByText("Cara")).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-008",
    "RequestDetail",
    "A Pending request is opened.",
    'Approve and "Reject…" buttons are shown.',
    { steps: "1. Open a pending booking." },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      const p = within(await open());
      expect(p.getByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(p.getByRole("button", { name: "Reject…" })).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-009",
    "RequestDetail",
    "An already-decided request is opened.",
    "No Approve/Reject buttons; a Rejected request shows its reason and alternative venue.",
    {
      kind: "State",
      data: 'status Alternative Offered, reason "Double booked", alternative_venue_id 2',
      steps: "1. Open a rejected booking.",
    },
    async () => {
      request.mockImplementation(async (url) =>
        url === "/venues"
          ? [{ venue_id: 2, name: "Hall B", location: "Jurong" }]
          : [
              booking({
                status: "Alternative Offered",
                rejection_reason: "Double booked",
                alternative_venue_id: 2,
              }),
            ],
      );
      render(<VenueApproval />);
      const p = within(await open());
      expect(p.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(p.getByText("Double booked")).toBeInTheDocument();
      expect(p.getByText("Hall B")).toBeInTheDocument();
      expect(
        p.getByText(/awaiting the event coordinator's decision/i),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-010",
    "VenueApproval (approve)",
    "Staff approves a request.",
    'POST /venue-booking-requests/<id>/approve is sent, the row status becomes Approved and the message "Request for Gala approved." appears.',
    { steps: '1. Open a pending booking. 2. Click "Approve".' },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues") return [];
        if (url === "/venue-booking-requests") return [booking()];
        if (url === "/venue-booking-requests/1/approve")
          return booking({ status: "Approved" });
      });
      render(<VenueApproval />);
      fireEvent.click(
        within(await open()).getByRole("button", { name: "Approve" }),
      );
      expect(
        await screen.findByText("Request for Gala approved."),
      ).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith(
        "/venue-booking-requests/1/approve",
        { method: "POST", body: "{}" },
      );
      expect(
        within(screen.getByRole("table")).getByText("Approved"),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-011",
    "VenueApproval (reject)",
    'Staff clicks "Reject…".',
    'A form with optional reason and alternative-venue fields appears and the decision buttons are replaced by "Confirm rejection" / "Cancel".',
    { steps: '1. Open a pending booking. 2. Click "Reject…".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      fireEvent.click(
        within(await open()).getByRole("button", { name: "Reject…" }),
      );
      expect(
        screen.getByLabelText(/Reason for rejection \(optional\)/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm rejection" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    },
  );

  tc(
    "FE-VENUE-012",
    "VenueApproval (reject)",
    "Staff cancels the rejection form.",
    "The Approve / Reject… buttons return without sending a request.",
    { kind: "State", steps: '1. Click "Reject…". 2. Click "Cancel".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      fireEvent.click(
        within(await open()).getByRole("button", { name: "Reject…" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-013",
    "VenueApproval (reject)",
    "Staff confirms a rejection with reason and alternative.",
    'POST /reject is sent with {reason, alternative_venue_id}; the row shows Alternative Offered and the message "Request for Gala alternative offered.".',
    {
      data: 'reason "Double booked", alternative "Hall B"',
      steps:
        '1. Click "Reject…". 2. Fill both fields. 3. Click "Confirm rejection".',
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [{ venue_id: 2, name: "Hall B", location: "Jurong" }];
        if (url === "/venue-booking-requests") return [booking()];
        if (url === "/venue-booking-requests/1/alternative-venue-availability")
          return [{ venue_id: 2, available: true, reason: null }];
        if (url === "/venue-booking-requests/1/reject")
          return booking({
            status: "Alternative Offered",
            rejection_reason: "Double booked",
            alternative_venue_id: 2,
          });
      });
      render(<VenueApproval />);
      fireEvent.click(
        within(await open()).getByRole("button", { name: "Reject…" }),
      );
      fireEvent.change(screen.getByLabelText(/Reason for rejection/), {
        target: { value: "Double booked" },
      });
      fireEvent.change(screen.getByLabelText(/Alternative venue/), {
        target: { value: "2" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm rejection" }),
      );
      expect(
        await screen.findByText("Request for Gala alternative offered."),
      ).toBeInTheDocument();
      const [path, options] = request.mock.calls.find(
        (call) => call[0] === "/venue-booking-requests/1/reject",
      );
      expect(path).toBe("/venue-booking-requests/1/reject");
      expect(JSON.parse(options.body)).toEqual({
        reason: "Double booked",
        alternative_venue_id: 2,
      });
    },
  );

  tc(
    "FE-VENUE-028",
    "VenueApproval (alternative venue availability)",
    "Staff opens the optional alternative venue selector.",
    "Unavailable catalogue venues, confirmed overlaps and active holds are disabled with reasons; a clear venue is labeled Available.",
    { steps: "1. Open a pending request. 2. Open Reject. 3. Inspect alternative venue options." },
    async () => {
      const venues = [
        { venue_id: 1, name: "Hall A", location: "Campus" },
        { venue_id: 2, name: "Renovation Hall", location: "West", is_available: false, unavailability_reason: "Renovation" },
        { venue_id: 3, name: "Confirmed Hall", location: "East" },
        { venue_id: 4, name: "Held Hall", location: "North" },
        { venue_id: 5, name: "Available Hall", location: "South" },
      ];
      request.mockImplementation(async (url) => {
        if (url === "/venues") return venues;
        if (url === "/venue-booking-requests") return [booking()];
        if (url === "/venue-booking-requests/1/alternative-venue-availability") {
          return [
            { venue_id: 1, available: true, reason: null },
            { venue_id: 2, available: false, reason: "Renovation" },
            { venue_id: 3, available: false, reason: "A confirmed booking overlaps this event, including setup/teardown time." },
            { venue_id: 4, available: false, reason: "Venue is on hold until 2026-10-30 20:00 SGT." },
            { venue_id: 5, available: true, reason: null },
          ];
        }
        return [];
      });
      render(<VenueApproval />);
      const panel = within(await open());
      fireEvent.click(panel.getByRole("button", { name: "Reject…" }));

      const renovation = await screen.findByRole("option", { name: /Renovation Hall.*Unavailable: Renovation/ });
      const confirmed = screen.getByRole("option", { name: /Confirmed Hall.*A confirmed booking overlaps/ });
      const held = screen.getByRole("option", { name: /Held Hall.*Venue is on hold until/ });
      const available = screen.getByRole("option", { name: /Available Hall.*Available/ });
      expect(renovation).toBeDisabled();
      expect(confirmed).toBeDisabled();
      expect(held).toBeDisabled();
      expect(available).toBeEnabled();
    },
  );

  tc(
    "FE-VENUE-014",
    "VenueApproval (decide)",
    "The decision fails (e.g. already decided by someone else).",
    "The error message is displayed and stays on screen while the list is reloaded.",
    {
      data: '409 "This request was just decided by someone else."',
      steps: '1. Reject the decision call. 2. Click "Approve".',
      kind: "Regression",
    },
    async () => {
      let fetchCount = 0;
      request.mockImplementation(async (url) => {
        if (url === "/venues") return [];
        if (url === "/venue-booking-requests") {
          fetchCount++;
          // Return pending initially, then approved on the reload
          return [booking({ status: fetchCount > 1 ? "Approved" : "Pending" })];
        }
        if (url === "/venue-booking-requests/1/approve") {
          throw new Error("This request was just decided by someone else.");
        }
      });

      render(<VenueApproval />);
      fireEvent.click(
        within(await open()).getByRole("button", { name: "Approve" }),
      );

      expect(
        await screen.findByText(
          "This request was just decided by someone else.",
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(
          within(screen.getByRole("table")).getByText("Approved"),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByText("This request was just decided by someone else."),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-015",
    "VenueApproval (decide)",
    "A decision is in flight.",
    "Approve and Reject… are disabled until it completes.",
    {
      kind: "State",
      pre: "Decision call never resolves.",
      steps: '1. Click "Approve". 2. Inspect the buttons.',
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues") return [];
        if (url === "/venue-booking-requests") return [booking()];
        if (url === "/venue-booking-requests/1/approve")
          return new Promise(() => {}); // never resolves
      });
      render(<VenueApproval />);
      fireEvent.click(
        within(await open()).getByRole("button", { name: "Approve" }),
      );
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Reject…" })).toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-016",
    "VenueApproval",
    "Staff clicks Close on the details panel.",
    "The panel disappears.",
    { kind: "State", steps: '1. Open a booking. 2. Click "Close".' },
    async () => {
      request.mockResolvedValue([booking()]);
      render(<VenueApproval />);
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(
        screen.queryByRole("region", { name: "Venue booking request details" }),
      ).toBeNull();
    },
  );

  tc(
    "FE-VENUE-017",
    "VenueApproval (detail)",
    "A booking was created by processing an approved event change request.",
    "The detail names the change request; the event change history can be shown (loaded from /events/<id>/change-log) and hidden.",
    {
      data: "change_request_id = 11",
      steps:
        "1. Open the booking. 2. Click Show event change history. 3. Click Hide event change history.",
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues") return [];
        if (url === "/venue-booking-requests")
          return [booking({ change_request_id: 11 })];
        if (url === "/events/10/change-log") return [];
      });
      render(<VenueApproval />);
      const detail = await open();
      expect(
        within(detail).getByText("New request for approved change request #11"),
      ).toBeInTheDocument();
      fireEvent.click(
        within(detail).getByRole("button", {
          name: "Show event change history",
        }),
      );
      expect(
        await within(detail).findByText(
          "No changes have been recorded since this event was submitted.",
        ),
      ).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("/events/10/change-log");
      fireEvent.click(
        within(detail).getByRole("button", {
          name: "Hide event change history",
        }),
      );
      expect(
        within(detail).queryByText(/No changes have been recorded/),
      ).toBeNull();
    },
  );

  tc(
    "FE-VENUE-018",
    "VenueApproval (detail)",
    "A booking was superseded by a replacement after an approved event change.",
    "It shows a Superseded status, offers no decision actions and has no change-request link.",
    { kind: "State", steps: "1. Open a Superseded booking." },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues") return [];
        if (url === "/venue-booking-requests")
          return [booking({ status: "Superseded" })];
      });
      render(<VenueApproval />);
      const detail = await open();
      expect(within(detail).getByText("Superseded")).toHaveClass(
        "pill",
        "status-superseded",
      );
      expect(
        within(detail).queryByRole("button", { name: "Approve" }),
      ).toBeNull();
      expect(within(detail).queryByText(/approved change request/)).toBeNull();
    },
  );

  tc(
    "FE-VENUE-019",
    "VenueApproval (overlap)",
    "A venue has setup and teardown durations that create a buffer collision.",
    "Approve is disabled and a setup/teardown buffer warning is shown.",
    { steps: "1. Mock venue setup/teardown times. 2. Open request." },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [
            { venue_id: 1, name: "Hall A", setup_time: 60, teardown_time: 60 },
          ];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Pending Event",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:00:00",
              end_time: "11:30:00",
            }),
            booking({
              request_id: 2,
              event_name: "Approved Event",
              status: "Approved",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "12:00:00",
              end_time: "14:00:00",
            }),
          ];
        return [];
      });
      render(<VenueApproval />);

      const rows = await screen.findAllByRole("button", {
        name: "View details",
      });
      fireEvent.click(rows[0]);
      const panel = await screen.findByRole("region", {
        name: "Venue booking request details",
      });

      expect(
        await within(panel).findByText(/overlapping with event teardown/),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole("button", { name: "Approve" }),
      ).toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-020",
    "VenueApproval (overlap)",
    "A venue has unset or zero setup/teardown durations with no conflicting bookings.",
    "Venue is marked available and Approve remains enabled.",
    { steps: "1. Mock zero buffer times. 2. Open request." },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [
            { venue_id: 1, name: "Hall A", setup_time: 0, teardown_time: 0 },
          ];
        if (url === "/venue-booking-requests")
          return [booking({ status: "Pending" })];
        return [];
      });
      render(<VenueApproval />);

      const panel = within(await open());
      expect(
        panel.getByText("Venue is available for this time slot."),
      ).toBeInTheDocument();
      expect(panel.getByRole("button", { name: "Approve" })).not.toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-021",
    "VenueApproval (overlap)",
    "A pending request overlaps with an approved request's setup or teardown buffer time.",
    "The warning banner indicates a setup/teardown overlap and Approve is disabled.",
    {
      steps:
        "1. Mock a pending request overlapping an approved request's buffer. 2. Open pending request.",
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [
            { venue_id: 1, name: "Hall A", setup_time: 60, teardown_time: 60 },
          ];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Pending Event",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:00:00",
              end_time: "11:30:00",
            }),
            booking({
              request_id: 2,
              event_name: "Approved Event",
              status: "Approved",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "12:00:00",
              end_time: "14:00:00",
            }),
          ];
        return [];
      });
      render(<VenueApproval />);

      const rows = await screen.findAllByRole("button", {
        name: "View details",
      });
      fireEvent.click(rows[0]);
      const panel = await screen.findByRole("region", {
        name: "Venue booking request details",
      });

      expect(
        await within(panel).findByText(/overlapping with event teardown/),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole("button", { name: "Approve" }),
      ).toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-022",
    "VenueApproval (overlap)",
    "A pending request overlaps directly in core event time with an approved request.",
    "The warning banner indicates a core event time overlap and Approve is disabled.",
    {
      steps:
        "1. Mock requests with direct core time collision. 2. Open pending request.",
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [{ venue_id: 1, setup_time: 30, teardown_time: 30 }];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Pending Event",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:00:00",
              end_time: "12:00:00",
            }),
            booking({
              request_id: 2,
              event_name: "Core Collision Event",
              status: "Approved",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "11:00:00",
              end_time: "13:00:00",
            }),
          ];
        return [];
      });
      render(<VenueApproval />);

      const rows = await screen.findAllByRole("button", {
        name: "View details",
      });
      fireEvent.click(rows[0]);
      const panel = await screen.findByRole("region", {
        name: "Venue booking request details",
      });

      expect(
        await within(panel).findByText(/overlaps in event time/),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole("button", { name: "Approve" }),
      ).toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-023",
    "VenueApproval (overlap)",
    "A pending request overlaps with another pending request.",
    "A warning displays naming the competing event, but Approve remains enabled.",
    { steps: "1. Mock two overlapping pending requests. 2. Open one of them." },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [{ venue_id: 1, setup_time: 30, teardown_time: 30 }];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Pending A",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:00:00",
              end_time: "12:00:00",
            }),
            booking({
              request_id: 2,
              event_name: "Pending B",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:30:00",
              end_time: "12:30:00",
            }),
          ];
        return [];
      });
      render(<VenueApproval />);

      const rows = await screen.findAllByRole("button", {
        name: "View details",
      });
      fireEvent.click(rows[0]);
      const panel = await screen.findByRole("region", {
        name: "Venue booking request details",
      });

      expect(
        await within(panel).findByText(
          /Venue is available, but 'Pending B'.* also requesting/,
        ),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole("button", { name: "Approve" }),
      ).not.toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-025",
    "VenueApproval (overlap)",
    "Multiple competing pending requests overlap with the selected request.",
    'The warning message uses the plural verb "are also requesting".',
    { steps: "1. Mock two competing pending requests. 2. Open request." },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [{ venue_id: 1, setup_time: 10, teardown_time: 10 }];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Target Event",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:00:00",
              end_time: "12:00:00",
            }),
            booking({
              request_id: 2,
              event_name: "Competitor A",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "10:30:00",
              end_time: "11:30:00",
            }),
            booking({
              request_id: 3,
              event_name: "Competitor B",
              status: "Pending",
              event_date: "2026-10-03",
              event_end_date: "2026-10-03",
              start_time: "11:00:00",
              end_time: "12:30:00",
            }),
          ];
        return [];
      });
      render(<VenueApproval />);
      const rows = await screen.findAllByRole("button", {
        name: "View details",
      });
      fireEvent.click(rows[0]);
      const panel = await screen.findByRole("region", {
        name: "Venue booking request details",
      });
      expect(
        await within(panel).findByText(/are also requesting/),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-026",
    "VenueApproval (overlap)",
    "Overlap check encounters invalid or missing event dates.",
    "An error message is displayed indicating invalid or missing times.",
    {
      steps:
        "1. Mock request with missing start/end datetimes. 2. Open request.",
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [{ venue_id: 1, setup_time: 10, teardown_time: 10 }];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Bad Dates Event",
              status: "Pending",
              start_time: null,
              end_time: null,
            }),
          ];
        return [];
      });
      render(<VenueApproval />);
      const rows = await screen.findAllByRole("button", {
        name: "View details",
      });
      fireEvent.click(rows[0]);
      const panel = await screen.findByRole("region", {
        name: "Venue booking request details",
      });
      expect(
        await within(panel).findByText(
          /Cannot approve: This event has invalid or missing start\/end times./,
        ),
      ).toBeInTheDocument();
    },
  );

  tc(
    "FE-VENUE-027",
    "VenueApproval (decide)",
    "Staff attempts to approve when overlapInfo has an error type.",
    "Action is blocked and approval is disabled.",
    {
      steps: "1. Open a request with invalid times. 2. Inspect Approve button.",
    },
    async () => {
      request.mockImplementation(async (url) => {
        if (url === "/venues")
          return [{ venue_id: 1, setup_time: 10, teardown_time: 10 }];
        if (url === "/venue-booking-requests")
          return [
            booking({
              request_id: 1,
              event_name: "Bad Dates Event",
              status: "Pending",
              start_time: null,
              end_time: null,
            }),
          ];
        return [];
      });
      render(<VenueApproval />);
      const panel = await open();
      const approveBtn = within(panel).getByRole("button", { name: "Approve" });
      expect(approveBtn).toBeDisabled();
    },
  );

  tc(
    "FE-VENUE-029",
    "VenueApproval (alternative venue availability)",
    "An alternative venue has an active request for the same event.",
    "The venue is marked unavailable with the active request reason and is disabled.",
    { steps: "1. Open a pending request. 2. Open Reject. 3. Inspect alternative venue options for an active request conflict." },
    async () => {
      const venues = [
        { venue_id: 1, name: "Hall A", location: "Campus" },
        { venue_id: 6, name: "Hall B", location: "Jurong" },
      ];
      request.mockImplementation(async (url) => {
        if (url === "/venues") return venues;
        if (url === "/venue-booking-requests") return [booking()];
        if (url === "/venue-booking-requests/1/alternative-venue-availability") {
          return [
            { venue_id: 1, available: true, reason: null },
            { venue_id: 6, available: false, reason: "This event already has an active request for this venue." },
          ];
        }
        return [];
      });
      render(<VenueApproval />);
      const panel = within(await open());
      fireEvent.click(panel.getByRole("button", { name: "Reject…" }));

      const activeRequestVenue = await screen.findByRole("option", { name: /Hall B.*This event already has an active request for this venue./ });
      expect(activeRequestVenue).toBeDisabled();
    },
  );
});
