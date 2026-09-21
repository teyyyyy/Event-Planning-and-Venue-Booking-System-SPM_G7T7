// Builds "Unit Test Case Documentation" (.docx) from the result files written by
//   Vitest  (frontend/src/test/register-reporter.js)  and  pytest  (test/conftest.py).
//
//   node generate.mjs <frontend-results.json> <backend-results.json> <output.docx>
//
// Every test declares its own ID / scenario / steps / expected result (see tc() helpers),
// so this script only lays the data out and records the status from the actual run.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer, PageNumber,
  PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';

const [feFile, beFile, outFile] = process.argv.slice(2);
if (!feFile || !beFile || !outFile) {
  console.error('usage: node generate.mjs <frontend.json> <backend.json> <out.docx>');
  process.exit(2);
}

// ---- configuration ---------------------------------------------------------------------
const PROJECT = 'Gather — Event Planning and Venue Booking System';
const TEAM = 'SPM G7T7';
const AUTHOR = process.env.TC_AUTHOR || 'Jeremytzm'; // "Created By" / "Executed By" columns
const RUN_DATE = process.env.TC_DATE || new Date().toISOString().slice(0, 10);
const FONT = 'Arial';

const SECTIONS = [
  { n: '6.1', title: 'Authentication and session', prefixes: ['FE-SUPA', 'FE-AUTH', 'FE-LOGIN', 'FE-API', 'BE-AUTH'],
    intro: 'Feature codes: SUPA, AUTH, LOGIN, API. Sign-in uses Supabase Auth (email + password). Unit tests replace the Supabase client and the network with test doubles — they verify our code calls the SDK and API correctly, not that Supabase authenticates anyone.',
    fe: 'frontend/src/__tests__/supabase.test.js, api.test.js, AuthContext.test.jsx, Login.test.jsx', be: 'test/test_be_auth.py' },
  { n: '6.2', title: 'Application shell and role routing', prefixes: ['FE-APP', 'BE-APP'],
    intro: 'Feature code: APP. Covers which workspace and navigation each role sees (frontend/src/App.jsx) and the FastAPI application wiring — routers, CORS and request validation (backend/main.py).',
    fe: 'frontend/src/__tests__/App.test.jsx', be: 'test/test_be_app.py' },
  { n: '6.3', title: 'Event organiser — event requests', prefixes: ['FE-ORG', 'BE-ORG'],
    intro: 'Feature code: ORG. Creating, drafting, editing and submitting event requests, including schedule validation and multi-day events.',
    fe: 'frontend/src/__tests__/event_organiser.test.jsx', be: 'test/test_be_organiser.py' },
  { n: '6.4', title: 'Coordinator assignment and event status', prefixes: ['FE-COORD', 'BE-COORD'],
    intro: 'Feature code: COORD. Automatic assignment to the least-loaded coordinator, reassignment, status changes and workload counting.',
    fe: 'frontend/src/__tests__/coordinator_assignment.test.jsx', be: 'test/test_be_coordinator.py' },
  { n: '6.5', title: 'Venue booking approval', prefixes: ['FE-VENUE', 'BE-VENUE'],
    intro: 'Feature code: VENUE. Venue staff review, approve or reject booking requests; timestamps are shown in Singapore time.',
    fe: 'frontend/src/__tests__/venue_approval.test.jsx', be: 'test/test_be_venue.py' },
  { n: '6.6', title: 'Equipment request (Event Coordinator)', prefixes: ['FE-EQREQ', 'BE-EQREQ'],
    intro: 'Feature code: EQREQ. Coordinators request equipment for their events; availability is checked against stock, maintenance and overlapping reservations.',
    fe: 'frontend/src/__tests__/EquipmentRequest.test.jsx', be: 'test/test_be_equipment_request.py' },
  { n: '6.7', title: 'Equipment update (Technical Support)', prefixes: ['FE-EQUPD', 'BE-EQUPD'],
    intro: 'Feature code: EQUPD. Technical support staff amend, cancel or add to submitted equipment requests.',
    fe: 'frontend/src/__tests__/EquipmentUpdate.test.jsx', be: 'test/test_be_equipment_update.py' },
  { n: '6.8', title: 'Equipment availability check (Technical Support)', prefixes: ['FE-EQAVAIL', 'BE-EQAVAIL'],
    intro: 'Feature code: EQAVAIL. Technical support checks whether the equipment requested for an event can be fulfilled.',
    fe: 'frontend/src/__tests__/EquipmentAvailability.test.jsx', be: 'test/test_be_equipment_availability.py' },
  { n: '6.9', title: 'Venue request (Event Coordinator)', prefixes: ['FE-VREQ', 'BE-VREQ'],
    intro: 'Feature code: VREQ. Coordinators browse the venue catalogue (auto-filtered by the event\'s requirements), request a venue for an event, and track their submissions. The frontend checks approved bookings for overlaps before submitting.',
    fe: 'frontend/src/__tests__/VenueRequest.test.jsx', be: 'test/test_be_venue_request.py' },
  { n: '6.10', title: 'Venue catalogue (Venue Staff, Technical Support)', prefixes: ['FE-VCAT', 'BE-VCAT'],
    intro: 'Feature code: VCAT. Venue staff and technical support browse venue information; only venue staff may edit operating hours, facilities, accessibility and layouts, and all input is validated on the server.',
    fe: 'frontend/src/__tests__/VenueCatalogue.test.jsx', be: 'test/test_be_venue_catalogue.py' },
];

// ---- load + validate -------------------------------------------------------------------
const all = [...JSON.parse(readFileSync(feFile, 'utf8')), ...JSON.parse(readFileSync(beFile, 'utf8'))];
const problems = [];
const seen = new Set();
for (const t of all) {
  if (!/^(FE|BE)-[A-Z]+-\d{3}$/.test(t.id)) problems.push(`bad id ${t.id}`);
  if (seen.has(t.id)) problems.push(`duplicate id ${t.id}`);
  seen.add(t.id);
  for (const key of ['unit', 'scenario', 'steps', 'expected']) if (!t[key]) problems.push(`${t.id}: missing ${key}`);
  if (!SECTIONS.some((s) => s.prefixes.some((p) => t.id.startsWith(`${p}-`)))) problems.push(`${t.id}: no section for this prefix`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const byNumber = (a, b) => a.id.localeCompare(b.id);
const forPrefix = (prefix) => all.filter((t) => t.id.startsWith(`${prefix}-`)).sort(byNumber);
const counts = (list) => ({ total: list.length, pass: list.filter((t) => t.status === 'Pass').length, fail: list.filter((t) => t.status === 'Fail').length });
const fe = all.filter((t) => t.layer === 'FE');
const be = all.filter((t) => t.layer === 'BE');

// ---- small builders --------------------------------------------------------------------
const run = (text, o = {}) => new TextRun({ text, font: FONT, ...o });
const para = (text, o = {}) => new Paragraph({ spacing: { after: 120 }, ...o.p, children: [run(text, o.r)] });
const rich = (parts, o = {}) => new Paragraph({ spacing: { after: 120 }, ...o, children: parts.map(([text, r]) => run(text, r)) });
const bullet = (parts) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [].concat(parts).map((p) => (typeof p === 'string' ? run(p) : run(p[0], p[1]))) });
const code = (text) => new Paragraph({ spacing: { after: 100 }, shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' }, indent: { left: 200 }, children: [run(text, { font: 'Courier New', size: 19 })] });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(text)] });
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(text)] });

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

function cell(content, width, o = {}) {
  const paragraphs = (Array.isArray(content) ? content : [content]).map((c) => (typeof c === 'string'
    ? new Paragraph({ spacing: { after: o.gap ?? 40 }, alignment: o.align, children: [run(c, { size: o.size ?? 18, bold: o.bold, color: o.color, italics: o.italics })] })
    : c));
  return new TableCell({
    width: { size: width, type: WidthType.DXA }, borders, verticalAlign: o.valign ?? VerticalAlign.TOP,
    columnSpan: o.span, margins: { top: 50, bottom: 30, left: 80, right: 80 },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined, children: paragraphs,
  });
}

function table(widths, header, rows, o = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const head = new TableRow({
    tableHeader: true, cantSplit: true,
    children: header.map((h, i) => cell(h, widths[i], { bold: true, fill: o.headFill ?? '7BA7D9', color: 'FFFFFF', size: o.size, valign: VerticalAlign.CENTER })),
  });
  const body = rows.map((r) => new TableRow({ cantSplit: o.cantSplit, children: r.map((c, i) => (c instanceof TableCell ? c : cell(c, widths[i], { size: o.size, fill: o.rowFill }))) }));
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [head, ...body] });
}

const steps = (text) => text.split(/\s+(?=\d+\.\s)/).map((s) => s.trim()).filter(Boolean);

// ---- register table (one row per test case; columns follow the test-case template) ------
const REG = [1450, 2100, 1400, 2650, 1350, 2100, 1450, 750, 1000, 1150]; // = 15400, the A4-landscape content width
const REG_TOTAL = REG.reduce((a, b) => a + b, 0);

function registerTable(list) {
  const S = 15;
  const head = (labels, fill) => labels.map(([label, w]) => cell(label, w, { bold: true, fill, color: 'FFFFFF', size: 16, valign: VerticalAlign.CENTER }));
  const header = new TableRow({
    tableHeader: true, cantSplit: true,
    children: [
      ...head([['Test Case ID / Type', REG[0]], ['Test Scenario', REG[1]], ['Pre-conditions', REG[2]], ['Test Steps', REG[3]], ['Test Data', REG[4]], ['Expected Result', REG[5]]], '5B8FCB'),
      ...head([['Actual Result', REG[6]], ['Pass / Fail', REG[7]], ['Remarks', REG[8]], ['Created / Executed By, Date', REG[9]]], 'D9924A'),
    ],
  });
  const blue = 'EAF1FA';
  const orange = 'FBEEDD';
  const rows = list.map((t) => {
    const statusFill = t.status === 'Pass' ? 'C6E7C6' : t.status === 'Fail' ? 'F4B6B6' : 'FFF2B3';
    const actual = t.status === 'Pass' ? 'As expected.' : t.status === 'Fail' ? `Failed: ${t.message || 'see run output'}` : 'Not executed.';
    const remarks = [t.remarks, t.status === 'Skipped' ? 'Skipped in code.' : ''].filter(Boolean).join(' ') || 'NA';
    return new TableRow({
      cantSplit: true,
      children: [
        cell([t.id, `(${t.type})`], REG[0], { size: S, fill: blue, bold: false }),
        cell([new Paragraph({ spacing: { after: 40 }, children: [run(t.unit, { size: S, bold: true })] }), t.scenario], REG[1], { size: S, fill: blue }),
        cell(t.preconditions || 'None', REG[2], { size: S, fill: blue }),
        cell(steps(t.steps), REG[3], { size: S, fill: blue }),
        cell(t.data || 'N/A', REG[4], { size: S, fill: blue }),
        cell(t.expected, REG[5], { size: S, fill: blue }),
        cell(actual, REG[6], { size: S, fill: orange }),
        cell(t.status === 'Skipped' ? 'Not Executed' : t.status, REG[7], { size: S, fill: statusFill, bold: true, align: AlignmentType.CENTER }),
        cell(remarks, REG[8], { size: S, fill: orange }),
        cell([`Created: ${AUTHOR}, ${RUN_DATE}`, `Executed: ${AUTHOR}, ${RUN_DATE}`], REG[9], { size: 13, fill: orange, gap: 60 }),
      ],
    });
  });
  return new Table({ width: { size: REG_TOTAL, type: WidthType.DXA }, columnWidths: REG, rows: [header, ...rows] });
}

// ---- document content ------------------------------------------------------------------
const W = 9026; // portrait content width (A4, 1" margins)
const cover = [];
cover.push(new Paragraph({ spacing: { before: 400, after: 60 }, children: [run('Unit Test Case Documentation', { size: 52, bold: true, color: '1F3864' })] }));
cover.push(new Paragraph({ spacing: { after: 240 }, children: [run(`${PROJECT} · ${TEAM}`, { size: 26, color: '595959' })] }));
const total = counts(all);
cover.push(table([2400, W - 2400], ['Item', 'Detail'], [
  ['Document owner', 'Engineering — Gather / SPM G7T7'],
  ['Status', 'Living document — regenerated whenever unit tests are added or changed (see §2.3)'],
  ['Current test frameworks', 'Frontend: Vitest 3 + React Testing Library (jsdom).  Backend: pytest.'],
  ['Last verified run', `${RUN_DATE} — ${total.pass} of ${total.total} registered test cases passed, ${total.fail} failed (see §7)`],
]));

const contents = [
  h1('Contents'),
  ...['1. Purpose and scope', '2. How to run the tests and read the results', '3. How to read a test case entry', '4. Test ID naming convention', '5. Controlled vocabularies']
    .map((t) => para(t)),
  para('6. Test case register', { r: { bold: true } }),
  ...SECTIONS.map((s) => para(`     ${s.n} ${s.title}`)),
  ...['7. Test execution log', '8. Defects raised by the unit tests', '9. Maintaining this document'].map((t) => para(t)),
];

const intro = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [run('1. Purpose and scope')] }),
  para('This document is the register of unit test cases for the Gather event-planning and venue-booking application. It records, for every automated unit test, the scenario, the pre-conditions, the steps and data used, the expected result, and the result observed on the last run, so that:'),
  bullet('reviewers and markers can see test coverage without reading the test code;'),
  bullet('the team shares one vocabulary for test IDs and outcomes;'),
  bullet('new tests are added in a consistent shape as the product grows.'),
  para(`Scope: automated unit tests only — individual functions, hooks and components tested in isolation with their dependencies (Supabase, the network, child components) replaced by test doubles. ${fe.length} frontend and ${be.length} backend test cases are registered, covering every module in frontend/src and backend/. Integration tests, end-to-end (browser) tests and the seed script test/coordinator_assignment_test.py (which needs a live database) are out of scope. The older unittest-style files in test/ (event_validation_test.py, venue_approval_test.py, venue_catalogue_test.py) still run under pytest but are not registered here; their scenarios are covered by the BE-ORG, BE-VENUE and BE-VCAT cases.`),

  h1('2. How to run the tests and read the results'),
  h2('2.1 Frontend (Vitest)'),
  para('From the repository root:'),
  code('cd frontend && npm install && npm test'),
  para('This runs vitest run — a single pass that exits non-zero if any test fails. Useful variants:'),
  bullet([['npm run test:watch', { font: 'Courier New' }], ' — re-run on file changes during development.']),
  bullet([['npx vitest run --reporter=verbose', { font: 'Courier New' }], ' — one line per test case.']),
  para('The tests do not need real Supabase values: vitest.config.js injects fixed VITE_* values and the Supabase client is replaced by a test double where it is used.'),
  h2('2.2 Backend (pytest)'),
  para('From the repository root, using the backend virtual environment:'),
  code('cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements-dev.txt'),
  code('cd .. && backend/.venv/bin/python -m pytest -v'),
  para('The backend tests use an in-memory stand-in for the Supabase client (test/fake_supabase.py), so no database or .env file is needed.'),
  h2('2.3 Regenerating this document'),
  para('Each test carries its own case ID, scenario, pre-conditions, steps, data and expected result (the tc(...) wrapper in frontend/src/test/tc.js and the @tc(...) decorator in test/tc.py). Running the build script executes both suites and regenerates this file, so the register cannot drift from the tests:'),
  code('cd docs/test-register && npm install && ./build.sh'),
  para('The Pass / Fail column comes from that run. The Created / Executed By names default to the git user and can be overridden with the TC_AUTHOR environment variable.'),

  h1('3. How to read a test case entry'),
  para('Each test case is one row of the register in §6. The columns follow the team\'s test-case template: the blue columns are written when the test is designed, and the orange columns are filled in when it is executed.'),
  table([2000, 4200, 2826], ['Item', 'Description', 'Example'], [
    ['Test Case ID', 'Unique ID of the test case, with its Type in brackets underneath (see §4, §5).', 'FE-LOGIN-002 (Positive)'],
    ['Test Scenario', 'Succinct summary of what is tested. The function, component or route under test is shown on the first line, above the scenario.', 'Check login with valid credentials'],
    ['Pre-conditions', 'Conditions to be fulfilled before executing the test, e.g. data the test double must contain.', 'users table holds the profile for id u1'],
    ['Test Steps', 'Step-by-step procedure the test follows.', '1. Type the email and password. 2. Click "Sign in".'],
    ['Test Data', 'Specific inputs used to conduct the test.', 'email = a@x.com; password = secret'],
    ['Expected Result', 'Expected outcome of the test.', 'login is called once with the entered email and password.'],
    ['Actual Result', 'Outcome observed on the last run. "As expected." for a pass; the assertion message for a fail.', 'As expected.'],
    ['Pass / Fail', 'Status of the test execution: Pass, Fail, Not Executed (skipped) or Blocked.', 'Pass'],
    ['Remarks', 'Any comments about the execution; defects are flagged here (see §8).', 'NA'],
    ['Created By / Date of Creation', 'Author of the test case and the date it was created ("Created:" line of the last column).', `${AUTHOR}, ${RUN_DATE}`],
    ['Executed By / Date of Execution', 'Person who ran the test case and the date it was run ("Executed:" line of the last column).', `${AUTHOR}, ${RUN_DATE}`],
  ], { size: 18, rowFill: 'EAF1FA' }),
  para(''),

  h1('4. Test ID naming convention'),
  para('IDs have the form LAYER-FEATURE-NNN:'),
  bullet([['LAYER', { bold: true }], ' — FE for frontend (Vitest), BE for backend (pytest).']),
  bullet([['FEATURE', { bold: true }], ' — short uppercase code for the area: SUPA (Supabase client), AUTH (login state / backend token checks), LOGIN (sign-in form), API (authenticated fetch helper), APP (app shell and routing), ORG (event organiser), COORD (coordinator assignment), VENUE (venue approval), VREQ (venue request), VCAT (venue catalogue), EQREQ (equipment request), EQUPD (equipment update), EQAVAIL (equipment availability).']),
  bullet([['NNN', { bold: true }], ' — zero-padded number, sequential within one LAYER-FEATURE pair, in creation order.']),
  para('Example: FE-VENUE-013 is the thirteenth frontend test written for venue approval. When a test is removed its ID is retired, not recycled — keep the row and mark it Deprecated.'),

  h1('5. Controlled vocabularies'),
  h2('5.1 Type'),
  table([1800, W - 1800], ['Type', 'Meaning'], [
    ['Positive', 'The feature does the right thing on a valid, expected input.'],
    ['Negative', 'The feature rejects or safely handles an invalid input or failure.'],
    ['Edge', 'A boundary or unusual-but-valid case (empty list, missing optional field).'],
    ['State', 'Behaviour that depends on component or UI state rather than a user action.'],
    ['Regression', 'Pins down a specific behaviour so it cannot silently change.'],
    ['Security', 'Protects an authentication, authorisation or ownership boundary.'],
    ['Performance', 'Asserts caching, call counts or similar efficiency behaviour.'],
    ['Config', 'Behaviour when configuration is missing or invalid, or fixed configuration values.'],
  ], { size: 18, rowFill: 'EAF1FA' }),
  h2('5.2 Pass / Fail status'),
  table([1800, W - 1800], ['Status', 'Meaning'], [
    ['Pass', 'Green on the last recorded run.'],
    ['Fail', 'Red on the last recorded run — the Remarks column and §8 explain the cause.'],
    ['Not Executed', 'Deliberately skipped in code (test.skip / pytest.mark.skip).'],
    ['Blocked', 'Cannot run (dependency or environment missing).'],
  ], { size: 18, rowFill: 'EAF1FA' }),
];

// §6 register (landscape section)
const summaryRows = SECTIONS.map((s) => {
  const f = counts(all.filter((t) => t.layer === 'FE' && s.prefixes.some((p) => t.id.startsWith(`${p}-`))));
  const b = counts(all.filter((t) => t.layer === 'BE' && s.prefixes.some((p) => t.id.startsWith(`${p}-`))));
  return [`${s.n} ${s.title}`, String(f.total), String(b.total), String(f.pass + b.pass), String(f.fail + b.fail)];
});
summaryRows.push(['Total', String(fe.length), String(be.length), String(total.pass), String(total.fail)].map((c, i) => (i === 0 ? c : c)));

const register = [
  h1('6. Test case register'),
  para('Coverage summary:'),
  table([7400, 1800, 1800, 1800, 1800], ['Feature area', 'Frontend tests', 'Backend tests', 'Passed', 'Failed'], summaryRows, { size: 18, rowFill: 'EAF1FA' }),
  para(''),
];
for (const s of SECTIONS) {
  const fePrefixes = s.prefixes.filter((p) => p.startsWith('FE-'));
  const bePrefixes = s.prefixes.filter((p) => p.startsWith('BE-'));
  const feList = fePrefixes.flatMap(forPrefix);
  const beList = bePrefixes.flatMap(forPrefix);
  register.push(h2(`${s.n} ${s.title}`), para(s.intro));
  if (feList.length) {
    register.push(h3(`${s.n}.1 Frontend`), para(`Files: ${s.fe}.`, { r: { italics: true, size: 18 } }), registerTable(feList), para(''));
  }
  if (beList.length) {
    register.push(h3(`${s.n}.${feList.length ? 2 : 1} Backend`), para(`Files: ${s.be}.`, { r: { italics: true, size: 18 } }), registerTable(beList), para(''));
  }
}

// §7-9
const feC = counts(fe);
const beC = counts(be);
const defects = all.filter((t) => (t.remarks || '').startsWith('DEFECT') || t.status === 'Fail').sort(byNumber);
const closing = [
  h1('7. Test execution log'),
  para('Record each meaningful run here — at least every release and every time a Status in §6 changes. "Result" is passed / total.'),
  table([1300, 1300, 2600, 1500, W - 6700], ['Date', 'Run by', 'Scope', 'Result', 'Notes'], [
    [RUN_DATE, AUTHOR, 'Frontend (Vitest) — all suites', `${feC.pass} / ${feC.total} passed`, `${feC.fail} failed. 11 test files.`],
    [RUN_DATE, AUTHOR, 'Backend (pytest) — registered suites', `${beC.pass} / ${beC.total} passed`, `${beC.fail} failed${beC.fail ? ' — a known defect, marked xfail so the suite still exits green (see §8)' : ''}. The older unittest-style tests in test/ also pass but are not registered.`],
  ], { size: 18, rowFill: 'EAF1FA' }),
  para(''),

  h1('8. Defects raised by the unit tests'),
  para(defects.length
    ? 'The following test cases fail on the last run because the application does not behave as intended. The tests assert the intended behaviour. A backend test for a known defect is marked xfail(strict) so the suite still exits green; pytest will report it as unexpectedly passing once the code is fixed, which is the cue to remove `defect=` from its @tc(...).'
    : 'No test cases fail on the last run. Defects found earlier are recorded in §8.1.'),
  ...defects.map((t) => rich([[`${t.id} — ${t.unit}. `, { bold: true }], [t.remarks || t.message, {}]])),
  h2('8.1 Defects found and fixed'),
  para('These were found by the first run of the suite (5 failing tests) and fixed in the application code; the tests below now pass and guard against regression.'),
  bullet([['FE-COORD-006, FE-COORD-020 — "Assign coordinator" did nothing. ', { bold: true }], 'In coordinator_assignment.jsx the button was wired to reassign() instead of assign(), so no request was sent. It now calls assign() in the organiser view; the coordinator drop-down still calls reassign().']),
  bullet([['FE-VENUE-014, FE-COORD-009, FE-COORD-017 — messages erased by the reload that followed. ', { bold: true }], 'venue_approval.jsx (failed approve/reject) and coordinator_assignment.jsx (assign, submit, reassign) set a message and then awaited a reload whose success path cleared it, so the user never saw it. The loaders now take a keepMessage flag and these flows pass it.']),
  h2('8.2 Other observations (no failing test)'),
  bullet('frontend/src/coordinator_assignment.jsx: an event whose status is "Submitted" is displayed as "Under review" in the coordinator\'s status drop-down, because "Submitted" is not one of EVENT_STATUSES.'),
  bullet('backend/venue_request.py: /api/venues, /api/venue-bookings and /api/venue-booking-requests/... do not use the current_user / role dependencies, so any caller can list, create or read bookings for any coordinator_id. The other venue and equipment routers verify the caller.'),
  bullet('frontend/src/VenueRequest.jsx: the "My Submissions" list is loaded once when the page opens and is not refreshed after a request is submitted, so a new request only appears after the page is reloaded.'),
  bullet('frontend/src/VenueRequest.jsx: selecting an event reads selectedEvent.start_datetime / end_datetime directly, so an event row without those fields would throw a TypeError and blank the page. Events created through the organiser form store event_date, start_time and end_time; this depends on the Event Details table exposing the start_datetime / end_datetime fields.'),

  h1('9. Maintaining this document'),
  bullet('When a pull request adds or changes a unit test, give the test its metadata (tc(...) / @tc(...)) and re-run docs/test-register/build.sh; commit the regenerated .docx with the PR.'),
  bullet('Give each new test the next ID in its LAYER-FEATURE sequence. Add a new FEATURE code to §4 and a section entry in generate.mjs if a new area appears.'),
  bullet('The generator refuses to build if an ID is duplicated, malformed, has no matching section, or is missing a scenario, steps or expected result.'),
  bullet('If a test is deleted, do not reuse its ID.'),
  bullet('Add a row to §7 for every release and whenever a Status changes.'),
  bullet('Keep the wording implementation-independent where possible: describe the behaviour, not the mock set-up.'),
];

// ---- assemble --------------------------------------------------------------------------
const styles = {
  default: { document: { run: { font: FONT, size: 20 } } },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: FONT, color: '1F3864' }, paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0, keepNext: true } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: FONT, color: '2F5597' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, font: FONT, color: '2F5597' }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2, keepNext: true } },
  ],
};
const numbering = { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] };
const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${TEAM} — Unit Test Case Documentation — page `, { size: 16, color: '7F7F7F' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '7F7F7F' })] })] });
const portrait = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } };
const landscape = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } };

const doc = new Document({
  creator: AUTHOR, title: 'Unit Test Case Documentation', styles, numbering,
  sections: [
    { properties: portrait, footers: { default: footer }, children: [...cover, ...contents, ...intro] },
    { properties: landscape, footers: { default: footer }, children: register },
    { properties: portrait, footers: { default: footer }, children: closing },
  ],
});

writeFileSync(outFile, await Packer.toBuffer(doc));
console.log(`wrote ${outFile}: ${all.length} test cases (${total.pass} pass, ${total.fail} fail)`);
