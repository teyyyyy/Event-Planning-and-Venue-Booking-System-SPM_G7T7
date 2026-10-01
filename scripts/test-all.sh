#!/usr/bin/env bash
# Single entry point for local runs, the git hook, the Claude Code hook and CI.
#   scripts/test-all.sh            both suites + coverage gates
#   scripts/test-all.sh --register also rebuild docs/Unit-Test-Cases.docx afterwards
# Fails if a test fails, a test is missing its tc() documentation, or coverage drops below the gates
# (backend: 100% of lines in backend/; frontend: thresholds in frontend/vitest.config.js).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/backend/.venv/bin/python"; [ -x "$PY" ] || PY=python3
status=0

echo "== Backend (pytest)"
(cd "$ROOT" && "$PY" -m pytest -q --cov=backend --cov-report=term-missing:skip-covered --cov-fail-under=100) || status=1

echo "== Frontend (Vitest)"
(cd "$ROOT/frontend" && npx vitest run --coverage --coverage.reporter=text-summary) || status=1

if [ "$status" -ne 0 ]; then
  echo "FAILED: fix the failing/undocumented tests or add tests for the new code above." >&2
  exit 1
fi
[ "${1:-}" = "--register" ] && "$ROOT/docs/test-register/build.sh"
echo "All tests passed and coverage gates met."
