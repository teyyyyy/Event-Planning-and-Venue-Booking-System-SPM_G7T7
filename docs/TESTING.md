# Unit testing guide

How to add unit tests after you implement or change a feature. The short version:

1. Write tests for every function, component and API route you added or changed.
2. Give each test a case ID and its `tc` / `@tc` documentation.
3. Run `scripts/test-all.sh --register`.
4. Commit the tests **and** the regenerated `docs/Unit-Test-Cases.docx` with your feature.

No database or `.env` is needed. Supabase and the network are replaced by test doubles.

## One-time setup (per clone)

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements-dev.txt && cd ..
cd frontend && npm install && cd ..
cd docs/test-register && npm install && cd ../..
git config core.hooksPath .githooks   # runs the tests before each commit that touches code
```

## 1. Find where your tests go

| You changed | Add tests to | Case ID |
| --- | --- | --- |
| `backend/<module>.py` | `test/test_be_<module>.py` | `BE-<CODE>-NNN` |
| `frontend/src/<Component>.jsx` or a `.js` helper | `frontend/src/__tests__/<Component>.test.jsx` | `FE-<CODE>-NNN` |
| A new or changed **protected API route** | also `test/test_role_access.py`: allowed and denied cases for all five roles, plus another user's id in the path | `BE-ROLE-NNN` |

`<CODE>` is the feature code of the area, e.g. `VREQ` for venue requests. The full list is the `CODES` map in
[`test-register/generate.mjs`](test-register/generate.mjs) and §4 of the register.

**Picking the number.** Use the next free number for that code. Find the highest one in use:

```bash
grep -rhoE "BE-VREQ-[0-9]{3}" test frontend/src | sort | tail -1
```

Numbers are never reused. If you delete a test, its ID is retired.

**Building a new feature area?** Choose a new code (uppercase letters/digits), then in `docs/test-register/generate.mjs`:

- add it to `CODES`, e.g. `TICKET: 'ticket sales'`;
- add a section to `SECTIONS`, after the last one:

```js
{ n: '6.15', title: 'Ticket sales (Attendee)', prefixes: ['FE-TICKET', 'BE-TICKET'],
  intro: 'Feature code: TICKET. One or two sentences on what the feature does and what the tests cover.',
  fe: 'frontend/src/__tests__/Tickets.test.jsx', be: 'test/test_be_tickets.py' },
```

The register build fails with `no section for this prefix` or `add its feature code to CODES` until you do.

## 2. Decide what to test

For each function, component or route, cover the cases that apply. Each one becomes a test, and its `kind` is one of:

| kind | Write one when… |
| --- | --- |
| `Positive` | the normal, valid use works (the happy path). |
| `Negative` | input is invalid, a request fails (400/404/500), or the network throws. |
| `Edge` | lists are empty, optional fields are missing, or values sit on a boundary. |
| `State` | the UI changes with state: loading, disabled while saving, tab switches. |
| `Security` | the wrong role gets 401/403, or another user's id in the path is refused. |
| `Regression` | you fixed a bug and want it to stay fixed. |
| `Performance` | caching or call counts matter. |
| `Config` | settings or environment values are missing or fixed. |

CI also enforces **coverage**: backend 90% of lines, frontend 98% of lines, 96% of statements, 94% of functions
and 88% of branches. In practice, every `if`, every error path and every new component needs a test that reaches it.

## 3. Write the test

Every test is declared with its documentation, which becomes one row of the Word register. Write the
scenario and expected result as plain sentences about behaviour, not about mocks. Write `steps` as
`1. … 2. …`, because the register splits the steps on those numbers.

### Backend (pytest)

```python
"""Unit tests for backend/tickets.py (attendees buy tickets)."""

import pytest
from fastapi import HTTPException

import tickets as tk
from fake_supabase import FakeClient
from tc import tc


@tc("BE-TICKET-001", "buy_ticket", "An attendee buys a ticket for a confirmed event.",
    "A ticket row is inserted for the attendee and its id is returned.",
    pre="Event 1 is Confirmed with 10 seats left.", data="event_id = 1, user a1",
    steps="1. Call buy_ticket(1, user).")
def test_buy_ticket(use_db):
    client = use_db(FakeClient({"Event Details": [{"id": 1, "event_status": "Confirmed"}], "tickets": []}), tk)
    out = tk.buy_ticket(1, {"id": "a1", "role": "Attendee"})
    assert client.tables["tickets"][0]["user_id"] == "a1" and out["ticket_id"]


@tc("BE-TICKET-002", "buy_ticket", "The event is not confirmed.", "HTTP 400 and nothing is inserted.",
    pre="Event 1 is a Draft.", steps="1. Call buy_ticket(1, user).", kind="Negative")
def test_buy_ticket_draft(use_db):
    client = use_db(FakeClient({"Event Details": [{"id": 1, "event_status": "Draft"}], "tickets": []}), tk)
    with pytest.raises(HTTPException) as e:
        tk.buy_ticket(1, {"id": "a1", "role": "Attendee"})
    assert e.value.status_code == 400 and client.tables["tickets"] == []
```

- `use_db(client, module)` points the module's `db()` at the in-memory `FakeClient` (`test/fake_supabase.py`).
  For a module that uses another accessor, such as `venue_request.get_supabase`, use `monkeypatch.setattr`.
- To test a route over HTTP as a signed-in user, override `current_user` (see `sign_in` in
  `test/test_be_equipment_reservation.py`):

  ```python
  monkeypatch.setitem(main.app.dependency_overrides, current_user, lambda: {"id": "a1", "role": "Attendee"})
  ```

- Name new files `test_*.py`. The older `*_test.py` files are not registered, so don't add tests to them.
- Found a bug you can't fix in this PR? Write the test for the **correct** behaviour and add
  `defect="what is wrong"` to `@tc`. The suite stays green, the register shows it as Fail in §8, and pytest
  reports `XPASS(strict)` once someone fixes it. That is the cue to remove `defect=`.

### Frontend (Vitest + React Testing Library)

```jsx
import React from 'react';
import { describe, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { tc } from '../test/tc';

const request = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ request }));

import Tickets from '../Tickets';

describe('Tickets', () => {
  tc('FE-TICKET-001', 'Tickets', 'An attendee buys a ticket.', 'POST /tickets is sent and a confirmation is shown.',
    { pre: 'One confirmed event.', data: 'event 1', steps: '1. Render. 2. Click "Buy ticket".' },
    async () => {
      request.mockResolvedValueOnce([{ id: 1, event_name: 'Gala' }]).mockResolvedValueOnce({ ticket_id: 9 });
      render(<Tickets />);
      fireEvent.click(await screen.findByRole('button', { name: 'Buy ticket' }));
      expect(await screen.findByText('Ticket 9 confirmed.')).toBeInTheDocument();
      expect(request).toHaveBeenLastCalledWith('/tickets', expect.objectContaining({ method: 'POST' }));
    });

  tc('FE-TICKET-002', 'Tickets', 'Buying fails.', 'The error message is shown and the button is enabled again.',
    { kind: 'Negative', steps: '1. Reject the POST. 2. Click "Buy ticket".' },
    async () => { /* … */ });
});
```

- Use `tc(...)` instead of `it(...)` / `test(...)`. A plain `it` fails the run.
- The options object takes `pre`, `data`, `steps` (required), `kind` (default `Positive`) and `remarks`.
  Write each key once. With a duplicate key, the last value silently wins.
- Components that call `fetch` directly can use `mockFetch` and `json` from `../test/helpers`.
- Don't hard-code dates that will pass. Derive future dates from today (see `FUTURE` in `event_organiser.test.jsx`).

## 4. Run the tests

Before you commit, run everything exactly as CI does. This also rebuilds the Word register:

```bash
scripts/test-all.sh --register
```

While developing, run just the file you're working on:

```bash
backend/.venv/bin/python -m pytest test/test_be_tickets.py -q
cd frontend && npx vitest run src/__tests__/Tickets.test.jsx
cd frontend && npm run test:watch   # re-runs on save
```

To find untested lines, check the coverage output of `scripts/test-all.sh`. The backend report lists the
missing line numbers for each file.

## 5. Commit and open the pull request

- Commit the feature, its tests and the regenerated `docs/Unit-Test-Cases.docx` together.
- **Update from `main` first**, then run `scripts/test-all.sh --register` again. Someone may have taken your case
  IDs, and a branch that passes alone can still fail against a newer `main`.
- `docs/Unit-Test-Cases.docx` conflicts during a merge? Don't merge it by hand. Keep either version, run
  `scripts/test-all.sh --register` and commit the regenerated file.
- The **CI** checks on the PR run the same lint, tests and gates (plus a secret scan and dependency audit).
  The **Test register** job's run page has the generated register under *Artifacts → unit-test-cases*.
  **Never merge while a check is red.**

## When it fails

| You see | Why | Fix |
| --- | --- | --- |
| `Tests missing @tc(...) documentation` | A `test_*` function has no `@tc` decorator. | Add `@tc(...)`. |
| `Tests missing tc() documentation` | A frontend test uses `it` / `test`. | Use `tc(...)`. |
| `ruff` lists `F401`, `F841`, `E…` or similar | Lint found an unused import or variable, or a syntax-level problem. | Fix what it points to. `ruff check . --fix` handles the simple ones. |
| ESLint reports `no-unused-vars` or `react-hooks/rules-of-hooks`, or `Exceeded max-warnings` | Lint error, or a new `exhaustive-deps` warning. | Fix it. Run `cd frontend && npm run lint`. |
| `npm audit` / `pip-audit` reports a vulnerability | A dependency has a known high or critical advisory. | Update that package. |
| `gitleaks` reports a leak | A key or token is in the git history. | Revoke the key at its provider, then remove it from the code. |
| `Required test coverage of 90% not reached` | New backend code isn't tested. | Add tests for the lines listed as missing. |
| `Coverage for … does not meet global threshold` | New frontend code isn't tested. | Add tests for the uncovered branches/functions. |
| `duplicate id …` | Two tests share an ID, often after updating from `main`. | Renumber yours to the next free ID. |
| `no section for this prefix` / `add its feature code to CODES` | New feature code. | See *Building a new feature area* above. |
| `[XPASS(strict)]` | A test marked `defect=` now passes. | The bug is fixed: remove `defect=`. |
| A test fails on another branch or on a later day | Hard-coded date, or a test that depends on another test's data. | Derive dates from today. Build each test's data inside the test. |
| `No module named pytest` or vitest not found when committing | Dependencies are not installed in this clone or worktree. | Run the one-time setup above. `git commit --no-verify` skips the hook in an emergency. CI still runs. |

## How the register is built

`scripts/test-all.sh --register` runs lint and both suites with the coverage gates. Each test writes out its `tc`
documentation and result (`frontend/src/test/register-reporter.js`, `test/conftest.py`), and
`docs/test-register/generate.mjs` lays them out as `docs/Unit-Test-Cases.docx`. The Pass / Fail column always
reflects the latest run. The narrative sections (scope, defects, observations) are written in `generate.mjs`.
Edit them there, never in Word, because the file is overwritten on every build.
