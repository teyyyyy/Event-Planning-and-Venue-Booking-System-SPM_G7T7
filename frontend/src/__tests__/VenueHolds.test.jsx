import React from "react";
import { describe, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { tc } from "../test/tc";
import { json } from "../test/helpers";

// Stories 22.1 and 22.2: venue staff hold venues; coordinators see holds and expiries.
const request = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ request, authenticatedFetch }));

import VenueApproval from "../venue_approval";
import VenueCalendar from "../components/VenueCalendar";
import VenueRequest from "../VenueRequest";

afterEach(() => {
  vi.useRealTimers();
});

// ---- Venue staff: placing, removing and deciding on holds ------------------------------------

const booking = (o = {}) => ({
  request_id: 1,
  status: "Pending",
  event_id: 10,
  event_name: "Gala",
  venue_id: 1,
  venue_name: "Hall A",
  event_date: "2026-10-03",
  event_end_date: "2026-10-03",
  start_time: "09:00:00",
  end_time: "17:00:00",
  facilities_required: [],
  ...o,
});
const HELD = { status: "On Hold", hold_expires_at: "2026-10-02T18:00:00+08:00" };

// handlers: { "POST /venue-booking-requests/1/hold": (options) => result }
function staffApi(bookings, handlers = {}) {
  request.mockImplementation(async (path, options = {}) => {
    const handler = handlers[`${options.method || "GET"} ${path}`];
    if (handler) return handler(options);
    if (path === "/venue-booking-requests") return bookings;
    if (path === "/venues") return [{ venue_id: 1, name: "Hall A", setup_time: 0, teardown_time: 0 }];
    throw new Error(`Unexpected request ${path}`);
  });
}
const openFirst = async () => {
  fireEvent.click((await screen.findAllByRole("button", { name: "View details" }))[0]);
  return screen.getByRole("region", { name: "Venue booking request details" });
};

describe("Venue holds — venue staff", () => {
  tc("FE-VHOLD-001", "VenueApproval (place hold)", "Venue staff hold a pending request until a chosen SGT time.",
    "The hold is sent with an explicit +08:00 offset, a confirmation names the event and expiry, and the request shows On Hold with its expiry and a Remove hold action.",
    { data: "Hold until 2099-03-01 10:00", steps: '1. Open the request. 2. Click "Place hold…". 3. Enter the expiry. 4. Click "Confirm hold".' },
    async () => {
      const held = booking({ status: "On Hold", hold_expires_at: "2099-03-01T10:00:00+08:00" });
      staffApi([booking()], { "POST /venue-booking-requests/1/hold": () => held });
      render(<VenueApproval />);
      const panel = await openFirst();
      await within(panel).findByText("Venue is available for this time slot.");
      fireEvent.click(within(panel).getByRole("button", { name: "Place hold…" }));
      const input = within(panel).getByLabelText("Hold until (SGT)");
      expect(input.getAttribute("min")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(within(panel).getByRole("button", { name: "Confirm hold" })).toBeDisabled();
      fireEvent.change(input, { target: { value: "2099-03-01T10:00" } });
      fireEvent.click(within(panel).getByRole("button", { name: "Confirm hold" }));
      expect(await screen.findByText("Venue held for Gala until 2099-03-01 10:00 SGT.")).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("/venue-booking-requests/1/hold", {
        method: "POST", body: JSON.stringify({ expires_at: "2099-03-01T10:00:00+08:00" }),
      });
      const detail = screen.getByRole("region", { name: "Venue booking request details" });
      expect(within(detail).queryByLabelText("Hold until (SGT)")).not.toBeInTheDocument();
      expect(within(detail).getByText("Hold expires").nextSibling).toHaveTextContent("2099-03-01 10:00 SGT");
      expect(within(detail).getByRole("button", { name: "Remove hold" })).toBeInTheDocument();
      expect(within(detail).queryByRole("button", { name: "Place hold…" })).not.toBeInTheDocument();
      const row = screen.getAllByRole("row")[1];
      expect(within(row).getByText("On Hold")).toHaveClass("status-on-hold");
      expect(row).toHaveTextContent("until 2099-03-01 10:00 SGT");
    });

  tc("FE-VHOLD-002", "VenueApproval (place hold)", "The backend refuses the hold (for example, another hold overlaps).",
    "The backend message is shown, the requests are reloaded and the hold form stays open to try again.",
    { kind: "Negative", data: "409 \"The venue is already booked or on hold for this time.\"", steps: "1. Place a hold the backend rejects." },
    async () => {
      staffApi([booking()], { "POST /venue-booking-requests/1/hold": () => { throw new Error("The venue is already booked or on hold for this time."); } });
      render(<VenueApproval />);
      const panel = await openFirst();
      await within(panel).findByText("Venue is available for this time slot.");
      fireEvent.click(within(panel).getByRole("button", { name: "Place hold…" }));
      fireEvent.change(within(panel).getByLabelText("Hold until (SGT)"), { target: { value: "2099-03-01T10:00" } });
      fireEvent.click(within(panel).getByRole("button", { name: "Confirm hold" }));
      expect(await screen.findByText("The venue is already booked or on hold for this time.")).toBeInTheDocument();
      await waitFor(() => expect(request.mock.calls.filter(([path]) => path === "/venue-booking-requests")).toHaveLength(2));
      expect(within(panel).getByRole("button", { name: "Confirm hold" })).toBeInTheDocument();
    });

  tc("FE-VHOLD-003", "VenueApproval (place hold)", "Venue staff open the hold form and cancel it.",
    "The form closes without a request and the Approve, Reject and Place hold actions return.",
    { kind: "State", steps: '1. Click "Place hold…". 2. Click "Cancel".' },
    async () => {
      staffApi([booking()]);
      render(<VenueApproval />);
      const panel = await openFirst();
      await within(panel).findByText("Venue is available for this time slot.");
      fireEvent.click(within(panel).getByRole("button", { name: "Place hold…" }));
      expect(within(panel).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
      expect(within(panel).queryByLabelText("Hold until (SGT)")).not.toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Place hold…" })).toBeInTheDocument();
      expect(request.mock.calls.some(([path]) => path.endsWith("/hold"))).toBe(false);
    });

  tc("FE-VHOLD-004", "VenueApproval (remove hold)", "Venue staff remove an active hold.",
    "The hold's expiry is shown, DELETE is sent for the request, and it returns to Pending with a confirmation and the Place hold action.",
    { steps: '1. Open the held request. 2. Click "Remove hold".' },
    async () => {
      staffApi([booking(HELD)], { "DELETE /venue-booking-requests/1/hold": () => booking() });
      render(<VenueApproval />);
      const panel = await openFirst();
      expect(within(panel).getByText("Hold expires").nextSibling).toHaveTextContent("2026-10-02 18:00 SGT");
      expect(within(panel).queryByRole("button", { name: "Place hold…" })).not.toBeInTheDocument();
      await within(panel).findByText("Venue is available for this time slot.");
      fireEvent.click(within(panel).getByRole("button", { name: "Remove hold" }));
      expect(await screen.findByText("Hold removed for Gala. The request is pending again.")).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("/venue-booking-requests/1/hold", { method: "DELETE" });
      const detail = screen.getByRole("region", { name: "Venue booking request details" });
      expect(within(detail).getByRole("button", { name: "Place hold…" })).toBeInTheDocument();
      expect(within(detail).queryByText("Hold expires")).not.toBeInTheDocument();
    });

  tc("FE-VHOLD-005", "VenueApproval (approve held)", "Venue staff approve a request that is on hold.",
    "Approval is available while the hold is active and converts it into the confirmed booking.",
    { steps: "1. Open the held request. 2. Click Approve." },
    async () => {
      staffApi([booking(HELD)], { "POST /venue-booking-requests/1/approve": () => booking({ status: "Approved" }) });
      render(<VenueApproval />);
      const panel = await openFirst();
      await within(panel).findByText("Venue is available for this time slot.");
      fireEvent.click(within(panel).getByRole("button", { name: "Approve" }));
      expect(await screen.findByText("Request for Gala approved.")).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("/venue-booking-requests/1/approve", { method: "POST", body: "{}" });
    });

  tc("FE-VHOLD-006", "VenueApproval (expired hold)", "Venue staff open a request whose hold expired.",
    "The expiry is shown with a note that the coordinator must submit a new request; no approve, reject or hold actions and no availability check are offered.",
    { kind: "Edge", steps: "1. Open the expired request." },
    async () => {
      staffApi([booking({ status: "Expired", hold_expires_at: "2026-10-01T18:00:00+08:00" })]);
      render(<VenueApproval />);
      const panel = await openFirst();
      expect(within(panel).getByText("Hold expired").nextSibling).toHaveTextContent("2026-10-01 18:00 SGT");
      expect(within(panel).getByRole("note")).toHaveTextContent("The event coordinator must submit a new venue request.");
      for (const name of ["Approve", "Reject…", "Place hold…", "Remove hold"]) {
        expect(within(panel).queryByRole("button", { name })).not.toBeInTheDocument();
      }
      expect(within(panel).queryByText(/Availability:/)).not.toBeInTheDocument();
    });

  tc("FE-VHOLD-007", "VenueApproval (availability)", "Another event holds the venue at an overlapping time, or its hold has expired.",
    "An active hold blocks approval and further holds with a message naming the event and expiry; an expired hold is ignored and the venue shows as available.",
    { kind: "Negative", pre: "Rival 2026-10-03 12:00-14:00 at Hall A.", steps: "1. Open Gala with Rival On Hold. 2. Repeat with Rival Expired." },
    async () => {
      const rival = (o) => booking({ request_id: 2, event_id: 11, event_name: "Rival", event_date: "2026-10-03", event_end_date: "2026-10-03", start_time: "12:00:00", end_time: "14:00:00", ...o });
      staffApi([booking(), rival({ status: "On Hold", hold_expires_at: "2026-10-01T12:00:00+08:00" })]);
      const { unmount } = render(<VenueApproval />);
      let panel = await openFirst();
      expect(await within(panel).findByText(/Unavailable\. Venue is on hold for 'Rival' until 2026-10-01 12:00 SGT/)).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(within(panel).getByRole("button", { name: "Place hold…" })).toBeDisabled();
      unmount();

      staffApi([booking(), rival({ status: "Expired", hold_expires_at: "2026-10-01T12:00:00+08:00" })]);
      render(<VenueApproval />);
      panel = await openFirst();
      expect(await within(panel).findByText("Venue is available for this time slot.")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Approve" })).toBeEnabled();
    });
});

// ---- Calendar ------------------------------------------------------------------------------------

describe("Venue holds — calendar", () => {
  tc("FE-VHOLD-008", "VenueCalendar (holds)", "A venue has an active hold and an expired hold this week.",
    "The active hold is drawn solid and labelled with its SGT expiry; the expired hold is faded, dashed and labelled as expired; a legend explains the states once a venue is chosen.",
    { pre: "Today is Wednesday 7 Oct 2026. Held Gala Wed 10:00-12:00 until 6 Oct 18:00; Lapsed Thu 14:00-15:00.", steps: '1. Choose "Hall A".' },
    async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 7, 10, 0));
      request.mockResolvedValue([
        { request_id: 1, status: "On Hold", hold_expires_at: "2026-10-06T18:00:00+08:00",
          "Event Details": { event_name: "Held Gala", event_date: "2026-10-07", start_time: "10:00:00", end_time: "12:00:00" } },
        { request_id: 2, status: "Expired", hold_expires_at: "2026-10-05T18:00:00+08:00",
          "Event Details": { event_name: "Lapsed", event_date: "2026-10-08", start_time: "14:00:00", end_time: "15:00:00" } },
      ]);
      render(<VenueCalendar venues={[{ venue_id: 1, name: "Hall A" }]} />);
      expect(screen.queryByText("On Hold (until expiry)")).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
      await waitFor(() => expect(document.querySelectorAll("tbody td div[title]")).toHaveLength(2));
      expect(screen.getByText("On Hold (until expiry)")).toBeInTheDocument();
      expect(screen.getByText("Expired hold")).toBeInTheDocument();

      const [held, lapsed] = document.querySelectorAll("tbody td div[title]");
      expect(held).toHaveTextContent("Held Gala (On Hold until 2026-10-06 18:00 SGT)");
      expect(held.getAttribute("title")).toContain("On Hold until 2026-10-06 18:00 SGT");
      expect(held.querySelector("div").style.border).toContain("solid");
      expect(held.querySelector("div").style.opacity).toBe("1");
      expect(lapsed).toHaveTextContent("Lapsed (Expired hold)");
      expect(lapsed.getAttribute("title")).toContain("Expired, expired 2026-10-05 18:00 SGT");
      expect(lapsed.querySelector("div").style.border).toContain("dashed");
      expect(lapsed.querySelector("div").style.opacity).toBe("0.6");
    });
});

// ---- Event coordinator: venue statuses, clashes and expired holds ----------------------------------

const venue = (venue_id, name) => ({ venue_id, name, location: "Singapore", capacity: 100, layouts: [], facilities: [], accessible: 1 });
const VENUES = [venue(1, "Hall A"), venue(2, "Hall B"), venue(3, "Hall C"), venue(4, "Hall D")];
const event = (id, name) => ({ id, event_name: name, event_date: "2026-10-05", event_end_date: "2026-10-05", start_time: "10:00:00", end_time: "12:00:00",
  event_capacity: null, layout_required: null, facilities_required: [], accessibility_required: 0 });
const STATUSES = [
  { venue_id: 1, status: "Available", hold_expires_at: null, request_id: null, own_event: false },
  { venue_id: 2, status: "Confirmed", hold_expires_at: null, request_id: 7, own_event: true },
  { venue_id: 3, status: "On Hold", hold_expires_at: "2026-10-02T18:00:00+08:00", request_id: 8, own_event: false },
  { venue_id: 4, status: "Expired", hold_expires_at: "2026-09-30T18:00:00+08:00", request_id: 9, own_event: true },
];

function coordinatorApi(o = {}) {
  const d = { venues: VENUES, events: [event(1, "Gala"), event(2, "Forum")], submitted: [], booked: [], statuses: STATUSES, ...o };
  const pick = (value, url) => (value instanceof Function ? value(url) : json(value));
  authenticatedFetch.mockImplementation(async (url, options = {}) => {
    if ((options.method || "GET") === "POST") return json({ request_id: 99 });
    if (url.includes("/venue-availability")) return pick(d.statuses, url);
    if (url.includes("/venue-catalogue/")) return json({ setup_time: 0, teardown_time: 0 });
    if (url.includes("/venue-booking-requests/venues/")) return pick(d.booked, url);
    if (url.includes("/venue-booking-requests/coordinators/")) return pick(d.submitted, url);
    if (url.includes("/event-coordinators/")) return pick(d.events, url);
    if (url.endsWith("/venues")) return pick(d.venues, url);
    return json({}, 404);
  });
}
const renderCoordinator = async () => {
  render(<VenueRequest user={{ id: "c1" }} />);
  await screen.findByText("Submit venue request");
};
const pickEvent = (id) => fireEvent.change(document.querySelector("select"), { target: { value: String(id) } });
const venueRow = async (name) => (await screen.findByText(name)).closest("tr");
const statusCell = (row) => row.querySelectorAll("td")[6];
const selectButton = (row) => within(row).getByRole("button", { name: "Select Venue" });

describe("Venue holds — event coordinator", () => {
  tc("FE-VHOLD-009", "VenueRequest (venue status)", "A coordinator selects an event.",
    "Each venue shows its status for the event's time: Available, Confirmed, On Hold with its SGT expiry, or Expired (the venue is available again); confirmed and held venues cannot be selected, and the coordinator's own request is marked.",
    { pre: "Hall A free, Hall B confirmed for this event, Hall C held by another event, Hall D's hold for this event expired.", steps: "1. Select the Gala event." },
    async () => {
      coordinatorApi();
      await renderCoordinator();
      pickEvent(1);
      await waitFor(() => expect(statusCell((document.querySelectorAll("tbody tr")[1]))).toHaveTextContent("Available"));
      expect(authenticatedFetch.mock.calls.map(([url]) => url)).toContainEqual(expect.stringMatching(/\/venue-availability\?event_id=1$/));
      const [hallA, hallB, hallC, hallD] = await Promise.all(["Hall A", "Hall B", "Hall C", "Hall D"].map(venueRow));
      expect(within(statusCell(hallA)).getByText("Available")).toHaveClass("status-available");
      expect(selectButton(hallA)).toBeEnabled();
      expect(statusCell(hallB)).toHaveTextContent("ConfirmedYour request");
      expect(selectButton(hallB)).toBeDisabled();
      expect(within(statusCell(hallC)).getByText("On Hold until 2026-10-02 18:00 SGT")).toHaveClass("status-on-hold");
      expect(selectButton(hallC)).toBeDisabled();
      expect(statusCell(hallD)).toHaveTextContent("ExpiredHold lapsed — venue available");
      expect(statusCell(hallD)).not.toHaveTextContent("Your request");
      expect(selectButton(hallD)).toBeEnabled();
    });

  tc("FE-VHOLD-010", "VenueRequest (venue status)", "Venue statuses cannot be loaded (error response or network failure).",
    "Statuses show \"—\", venues stay selectable and no page error appears; the venue is still checked on submit.",
    { kind: "Negative", data: "500; network error", steps: "1. Fail the status request. 2. Select an event." },
    async () => {
      for (const statuses of [() => json({ detail: "boom" }, 500), () => { throw new Error("offline"); }]) {
        coordinatorApi({ statuses });
        const { unmount } = render(<VenueRequest user={{ id: "c1" }} />);
        await screen.findByText("Submit venue request");
        pickEvent(1);
        await waitFor(() => expect(authenticatedFetch.mock.calls.some(([url]) => url.includes("/venue-availability"))).toBe(true));
        const row = await venueRow("Hall C");
        expect(statusCell(row)).toHaveTextContent("—");
        expect(selectButton(row)).toBeEnabled();
        expect(document.querySelector(".page-error")).toBeNull();
        unmount();
        authenticatedFetch.mockReset();
      }
    });

  tc("FE-VHOLD-011", "VenueRequest (venue status)", "The coordinator switches events before the first event's statuses arrive.",
    "The late response for the first event is ignored, so the list keeps the second event's statuses.",
    { kind: "Edge", steps: "1. Select Gala (slow). 2. Select Forum. 3. Let Gala's response arrive." },
    async () => {
      let releaseGala;
      coordinatorApi({
        statuses: (url) => url.endsWith("event_id=1")
          ? new Promise((resolve) => { releaseGala = () => resolve(json([{ venue_id: 1, status: "On Hold", hold_expires_at: "2026-10-02T18:00:00+08:00", own_event: false }])); })
          : json([{ venue_id: 1, status: "Available", hold_expires_at: null, own_event: false }]),
      });
      await renderCoordinator();
      pickEvent(1);
      await waitFor(() => expect(releaseGala).toBeDefined());
      pickEvent(2);
      await waitFor(async () => expect(statusCell(await venueRow("Hall A"))).toHaveTextContent("Available"));
      releaseGala();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(statusCell(await venueRow("Hall A"))).toHaveTextContent("Available");
      expect(screen.queryByText(/On Hold until/)).not.toBeInTheDocument();
    });

  tc("FE-VHOLD-012", "VenueRequest (submit)", "Another event holds the chosen venue at an overlapping time.",
    "An error dialog says the venue is on hold until the SGT expiry and no request is sent.",
    { kind: "Negative", pre: "Hall A held 10:30-11:30 on the event's day; statuses unavailable.", steps: "1. Select the event and Hall A. 2. Click \"Submit Request\"." },
    async () => {
      coordinatorApi({
        statuses: () => json({}, 500),
        booked: [{ request_id: 8, status: "On Hold", hold_expires_at: "2026-10-02T18:00:00+08:00",
          "Event Details": { event_date: "2026-10-05", event_end_date: "2026-10-05", start_time: "10:30:00", end_time: "11:30:00" } }],
      });
      await renderCoordinator();
      pickEvent(1);
      fireEvent.click(selectButton(await venueRow("Hall A")));
      fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
      expect(await screen.findByText("This venue is on hold for another event until 2026-10-02 18:00 SGT (including setup/teardown buffers). Please choose a different venue.")).toBeInTheDocument();
      expect(authenticatedFetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    });

  tc("FE-VHOLD-013", "VenueRequest (submissions)", "The coordinator has a held request and one whose hold expired.",
    "The held request shows its expiry; the expired one says to submit a new request, its details explain why, and \"Submit new request\" opens the request form for that event.",
    { steps: '1. Open "My Submissions". 2. Open each request\'s details. 3. Click "Submit new request".' },
    async () => {
      coordinatorApi({
        submitted: [
          { request_id: 5, event_id: 1, venue_id: 1, status: "On Hold", hold_expires_at: "2026-10-02T18:00:00+08:00" },
          { request_id: 6, event_id: 2, venue_id: 2, status: "Expired", hold_expires_at: "2026-09-30T18:00:00+08:00" },
        ],
      });
      await renderCoordinator();
      fireEvent.click(screen.getByRole("button", { name: "My Submissions" }));
      expect(await screen.findByText("Held until 2026-10-02 18:00 SGT")).toBeInTheDocument();
      expect(screen.getByText("Hold expired — submit a new request to continue.")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Held until 2026-10-02 18:00 SGT").closest("li"));
      let dialog = screen.getByRole("alertdialog");
      expect(dialog).toHaveTextContent("Hold expires: 2026-10-02 18:00 SGT");
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

      fireEvent.click(screen.getByText("Forum").closest("tr"));
      dialog = screen.getByRole("alertdialog");
      expect(dialog).toHaveTextContent("Hold expired: 2026-09-30 18:00 SGT");
      expect(dialog).toHaveTextContent("The venue hold expired. Submit a new venue request for this event to continue.");
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

      fireEvent.click(screen.getByRole("button", { name: "Submit new request" }));
      expect(await screen.findByText("Submit venue request")).toBeInTheDocument();
      expect(document.querySelector("select").value).toBe("2");
      await waitFor(() => expect(authenticatedFetch.mock.calls.map(([url]) => url)).toContainEqual(expect.stringMatching(/event_id=2$/)));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
});
