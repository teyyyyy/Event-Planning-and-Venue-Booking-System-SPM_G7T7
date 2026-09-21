"""pytest wiring: import path for the backend, plus a results dump for the test register."""

import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

_RESULTS = []


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    report = (yield).get_result()
    meta = getattr(getattr(item, "function", None), "tc_meta", None)
    if not meta or (report.when != "call" and report.outcome == "passed"):
        return
    if report.when == "teardown" and report.outcome == "passed":
        return
    status = {"passed": "Pass", "failed": "Fail", "skipped": "Skipped"}[report.outcome]
    message = (report.longreprtext.strip().splitlines() or [""])[-1] if report.outcome == "failed" else ""
    if hasattr(report, "wasxfail") and report.outcome == "skipped":  # known defect: failed as expected
        status, message = "Fail", str(report.wasxfail)
    _RESULTS.append({**meta, "layer": "BE", "status": status, "message": message})


def pytest_sessionfinish(session):
    path = os.environ.get("TC_RESULTS_PATH")
    if path:
        Path(path).write_text(json.dumps(_RESULTS, indent=1))


@pytest.fixture
def use_db(monkeypatch):
    """Point each module's db() at a fake client: use_db(client, module_a, module_b)."""
    def apply(client, *modules):
        for module in modules:
            monkeypatch.setattr(module, "db", lambda: client)
        return client
    return apply
