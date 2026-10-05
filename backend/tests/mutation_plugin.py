"""Under mutmut, leave out the tests that read backend source instead of running it.

Some guard tests scan ``app/`` as text — every relation writer orients, every
notification passes its actor, every card read takes the scope. Under mutmut
``app/`` is its copy of the code, rewritten with a trampoline around every
function, so those scans fail on code that is not the code. They could not
kill a mutant anyway: a mutant changes behaviour at run time and a scan never
runs anything. So a test marked ``@pytest.mark.source_scan`` (or a module with
``pytestmark = pytest.mark.source_scan``) is deselected whenever mutmut is the
one running pytest, which it signals with ``MUTANT_UNDER_TEST`` in every
process it starts. Everywhere else the marker changes nothing.

Registered by ``tests/conftest.py``'s ``pytest_configure``.
"""

from __future__ import annotations

import os

import pytest

MARKER = "source_scan"
DESCRIPTION = (
    f"{MARKER}: reads backend source files instead of running them; deselected under "
    "mutmut, whose app/ is a rewritten copy (tests/mutation_plugin.py)"
)


def under_mutmut() -> bool:
    return bool(os.environ.get("MUTANT_UNDER_TEST"))


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not under_mutmut():
        return
    dropped = [item for item in items if item.get_closest_marker(MARKER)]
    if dropped:
        config.hook.pytest_deselected(items=dropped)
        items[:] = [item for item in items if not item.get_closest_marker(MARKER)]
