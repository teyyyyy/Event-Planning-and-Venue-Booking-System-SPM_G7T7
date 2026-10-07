#!/usr/bin/env bash
# Single entry point for local runs, the git hook, the Claude Code hook and CI.
#   scripts/test-all.sh            lint + both suites + coverage gates
#   scripts/test-all.sh --register also rebuild docs/Unit-Test-Cases.docx afterwards
# Fails if lint finds a problem, a test fails, a test is missing its tc() documentation, or coverage drops
# below the gates (backend: .coveragerc; frontend: thresholds in frontend/vitest.config.js).
# CI (.github/workflows/ci.yml) runs the same checks; the dependency audit and secret scan run only in CI.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/backend/.venv/bin/python"; [ -x "$PY" ] || PY=python3
status=0

echo "== Backend lint (ruff)"
(cd "$ROOT" && "$PY" -m ruff check .) || status=1

echo "== Backend (pytest)"
(cd "$ROOT" && "$PY" -m pytest -q --cov=backend --cov-report=term-missing:skip-covered) || status=1

echo "== Frontend lint (ESLint)"
(cd "$ROOT/frontend" && npm run lint --silent) || status=1

echo "== Frontend (Vitest)"
(cd "$ROOT/frontend" && npx vitest run --coverage --coverage.reporter=text-summary) || status=1

if [ "$status" -ne 0 ]; then
  echo "FAILED: fix the lint errors or failing/undocumented tests, or add tests for the new code above." >&2
  exit 1
fi
if [ "${1:-}" = "--register" ]; then
  "$ROOT/docs/test-register/build.sh" || { echo "FAILED: could not build the test register." >&2; exit 1; }
fi
echo "Lint clean, all tests passed and coverage gates met."
