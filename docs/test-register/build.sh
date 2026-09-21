#!/usr/bin/env bash
# Runs both unit-test suites, then regenerates docs/Unit-Test-Cases.docx from the results.
# A failing test does not stop the build — the failure is recorded in the document.
set -u
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
TMP="$(mktemp -d)"

echo "== Frontend (Vitest)"
(cd "$ROOT/frontend" && TC_RESULTS_PATH="$TMP/fe.json" npx vitest run) || echo "(frontend had failures)"

echo "== Backend (pytest)"
(cd "$ROOT" && TC_RESULTS_PATH="$TMP/be.json" backend/.venv/bin/python -m pytest -q) || echo "(backend had failures)"

[ -f "$TMP/fe.json" ] && [ -f "$TMP/be.json" ] || { echo "missing result files" >&2; exit 1; }
node generate.mjs "$TMP/fe.json" "$TMP/be.json" "$ROOT/docs/Unit-Test-Cases.docx"
