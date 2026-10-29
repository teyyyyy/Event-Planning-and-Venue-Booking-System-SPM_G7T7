# Coordinator assignment — stories 8.3 and 8.4

## Acceptance criteria and behavior

| Story / criterion | Implementation |
| --- | --- |
| 8.3: display unassigned events | **Coordinator Assignments → Unassigned events** lists submitted requests without a coordinator. Organiser drafts remain private to the organiser workflow. |
| 8.3: view events by coordinator and active counts | **Active events** lists active events across coordinators. Filter by coordinator, all coordinators, or unassigned. Workloads are calculated from current event assignments, including coordinators with zero active events. |
| 8.3: assign a coordinator | Open **View details**, choose a coordinator, and select **Assign coordinator**. A submitted event becomes Assigned and leaves the unassigned queue. |
| 8.4: display all active events | Active means every status except Draft, Completed (including legacy Complete), Cancelled and Rejected. Date alone does not mark an event inactive. |
| 8.4: confirm reassignment and show success | Open an assigned event, choose a different coordinator, select **Review reassignment**, then **Confirm reassignment**. Cancellation does not save. Success names the event and incoming coordinator. The event's status is preserved. |
| 8.4: notify the incoming coordinator | The existing notification trigger creates an in-app assignment message. |
| 8.4: notify the outgoing coordinator | A new trigger creates a self-contained message naming the reassigned event. The outgoing coordinator can still read this message; its event link and direct event-status updates are denied once they are no longer assigned. |
| 8.4: display current workload | Counts appear above the list and in the assignment selector, and reload after successful assignment/reassignment. |
| 8.4: unlimited reassignment | There is no reassignment counter or limit. Each genuine coordinator change creates notifications. Selecting the current coordinator is disabled; an equivalent API call is a no-op. |

Notifications use the existing inbox, which refreshes every 30 seconds and has a manual refresh button. These are in-app messages, not emails.

Event and coordinator reads are paginated internally so the database's per-response row limit does not truncate the lists or workload counts.

## Changed files

| File | Change |
| --- | --- |
| `backend/coordinator_assignment.py` | Lead active-event listing, atomic assignment RPC, conflict handling, paginated reads and actual workload counts. |
| `backend/main.py` | Actionable error when the new database function is missing. |
| `frontend/src/coordinator_assignment.jsx` | Lead tabs, coordinator filter, workloads, confirmation, success/error handling and refresh. |
| `frontend/src/App.jsx` | Coordinator Assignments navigation label. |
| `backend/sql/coordinator_reassignment.sql` | Atomic assignment function and outgoing-coordinator notification trigger. |
| `backend/sql/rollback_coordinator_reassignment.sql` | Non-destructive rollback of the new database objects. |
| `test/test_be_coordinator.py` | Updated assignment contracts and workload expectations. |
| `test/test_be_coordinator_lead.py` | Active lists, pagination, access controls and failure/notification checks. |
| `test/fake_supabase.py` | Range support for paginated query tests. |
| `frontend/src/__tests__/CoordinatorLead.test.jsx` | Lead interaction and regression tests. |
| `test/coordinator_reassignment_sql.mjs` | Isolated tests of the actual PostgreSQL functions and triggers. |
| `docs/test-register/generate.mjs` | Updated descriptions and source-file references for the coordinator test section. |
| `docs/Coordinator-Assignment.md` | Acceptance-criteria mapping, rollout, rollback and validation notes. |

## Deployment prerequisite and impact

Human approval is required before applying this migration to a shared/live database.

1. Confirm `backend/sql/sprint2_registration_notifications.sql` has already been applied, and that `users.active_event_count` exists (used by the existing assignment implementation).
2. Apply `backend/sql/coordinator_reassignment.sql` in the Supabase SQL Editor **before releasing the updated backend/frontend**.
3. Release the application changes together. The Lead assignment endpoint now uses `assign_event_coordinator`; without the migration it returns a setup error rather than saving partially.
4. Test with non-production test accounts: initial assignment, filtered browsing, two successive reassignments, and both coordinators' inboxes.

Installing the migration adds/replaces two functions and one trigger. It does not backfill or delete existing data, or alter tables. It is transactional and rerunnable. Each subsequent assignment transaction locks the event and affected coordinator rows, checks the verified Lead and selected coordinator, checks the previously displayed coordinator, updates the assignment and workload caches, and emits notifications. A failure rolls everything back. The new function can only be called using the backend service role; the Lead identity comes from the verified session, never from the browser body.

The `expected_coordinator_id` field is null for initial assignment and the currently displayed ID for reassignment. If another Lead has already changed it, the server responds with HTTP 409. Close the dialog, refresh, and review the new assignment before retrying. Inactive events also return 409.

Existing coordinator-side legacy routes retain their behavior; the Lead workflow uses the atomic operation. Existing venue/equipment requests and change-request ownership are not rewritten by this feature. In particular, a pending change request remains with its existing reviewer; moving related requests as well would require a separate ownership decision.

## Rollback

Revert the application release first, then apply `backend/sql/rollback_coordinator_reassignment.sql`. This removes only the new RPC and outgoing-notification trigger/function. It preserves existing assignments, workload values, and delivered notifications. It does not attempt to reverse a Lead's completed decisions. The original incoming-notification trigger remains installed. Reapplying the forward migration restores the new operation.

## Validation

- `scripts/test-all.sh`: repository guardrails, lint, backend/frontend tests and unchanged coverage gates.
- `scripts/check-guardrails.sh`: policy and secret-pattern checks.
- `test/test_be_coordinator_lead.py`: Lead-only access, active filtering, trusted actor, error handling, migration errors and notification access after reassignment.
- `frontend/src/__tests__/CoordinatorLead.test.jsx`: filters, confirmation/cancel, repeated changes, workloads, errors, refresh, pending saves and stale responses.
- `test/coordinator_reassignment_sql.mjs`: executes the actual SQL on isolated PostgreSQL (PGlite), including 25 further reassignments, both notifications, all active/inactive statuses, stale writes, invalid targets, privileges, atomic failure rollback and migration rollback.

Run the isolated database checks without connecting to Supabase:

```sh
npm install --prefix /tmp/coordinator-sql-test --no-audit --no-fund @electric-sql/pglite
PGLITE_MODULE=/tmp/coordinator-sql-test/node_modules/@electric-sql/pglite/dist/index.js \
  node test/coordinator_reassignment_sql.mjs
```

The stale-write test submits a second request with an outdated expected coordinator; PGlite does not simulate independently connected concurrent production sessions. Live deployment and live notification delivery still need verification after the approved migration.
