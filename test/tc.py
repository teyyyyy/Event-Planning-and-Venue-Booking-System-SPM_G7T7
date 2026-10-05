"""Test-case metadata decorator.

Each test carries the fields of the unit-test-case template (ID, scenario,
pre-conditions, steps, data, expected result) so the Word register can be
generated straight from the tests and cannot drift from them.
"""


import pytest


def tc(case_id, unit, scenario, expected, *, steps, pre="None", data="N/A", kind="Positive", defect=None):
    """defect: text describing a known bug. The test still asserts the intended behaviour; it is
    marked xfail(strict) so the suite stays green, the register shows it as Fail, and pytest
    complains as soon as the bug is fixed (remove `defect=` then)."""
    def wrap(fn):
        fn.tc_meta = {
            "id": case_id, "unit": unit, "scenario": scenario, "preconditions": pre,
            "steps": steps, "data": data, "expected": expected, "type": kind,
            "remarks": f"DEFECT: {defect}" if defect else "",
        }
        return pytest.mark.xfail(strict=True, reason=defect)(fn) if defect else fn

    return wrap
