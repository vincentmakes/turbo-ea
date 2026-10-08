"""What ``tests/conftest.py`` does for mutation runs.

mutmut forks several pytest runs at once, so each needs its own Postgres
schema; a mutation run must fail, not skip, when the database is gone — a
skipped suite kills no mutant and still exits 0; and tests that read app/ as
text are left out, because under mutmut app/ is a rewritten copy.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.conftest import _worker_schema

pytest_plugins = ["pytester"]

BACKEND = Path(__file__).resolve().parents[2]
DB_TEST = "tests/api/test_auth.py::TestRegister::test_first_user_gets_admin_role"


class TestWorkerSchema:
    def test_xdist_workers_keep_their_names(self, monkeypatch):
        monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw3")
        monkeypatch.setenv("MUTANT_UNDER_TEST", "app.x.x_f__mutmut_1")
        assert _worker_schema() == "test_gw3"

    def test_each_mutmut_process_gets_its_own_schema(self, monkeypatch):
        monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
        monkeypatch.setenv("MUTANT_UNDER_TEST", "stats")
        assert _worker_schema() == f"test_mut_{os.getpid()}"

    def test_a_plain_run_uses_the_default_schema(self, monkeypatch):
        monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
        monkeypatch.delenv("MUTANT_UNDER_TEST", raising=False)
        assert _worker_schema() is None


def run_against_a_closed_port(**extra: str) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_PORT": "1",  # nothing listens there
        **extra,
    }
    for key in ("PYTEST_XDIST_WORKER", "MUTANT_UNDER_TEST", "TEST_DB_REQUIRED"):
        if key not in extra:
            env.pop(key, None)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-rs", DB_TEST],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.mark.parametrize(
    "extra, code, message",
    [
        ({}, 0, "Test database not available"),  # a laptop without Docker: skip
        ({"TEST_DB_REQUIRED": "1"}, 1, "TEST_DB_REQUIRED is set"),  # a mutation run: fail
    ],
)
def test_a_missing_database_skips_unless_it_is_required(extra, code, message):
    result = run_against_a_closed_port(**extra)
    assert result.returncode == code, result.stdout[-2000:]
    assert message in result.stdout


@pytest.mark.parametrize(
    "env, expected",
    [
        ({}, {"test_scan", "test_runs", "test_module_scan"}),
        ({"MUTANT_UNDER_TEST": "stats"}, {"test_runs"}),
        # mutmut's clean pass: set, but empty
        ({"MUTANT_UNDER_TEST": ""}, {"test_runs"}),
    ],
)
def test_source_scans_are_left_out_only_under_mutmut(pytester, monkeypatch, env, expected):
    monkeypatch.delenv("MUTANT_UNDER_TEST", raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    pytester.syspathinsert(BACKEND)
    pytester.makeconftest(
        "from tests import mutation_plugin\n"
        "def pytest_configure(config):\n"
        "    config.addinivalue_line('markers', mutation_plugin.DESCRIPTION)\n"
        "    config.pluginmanager.register(mutation_plugin, 'turbo-ea-mutation')\n"
    )
    pytester.makepyfile(
        test_mixed=(
            "import pytest\n"
            "@pytest.mark.source_scan\n"
            "def test_scan():\n    pass\n"
            "def test_runs():\n    pass\n"
        ),
        test_scans=(
            "import pytest\n"
            "pytestmark = pytest.mark.source_scan\n"
            "def test_module_scan():\n    pass\n"
        ),
    )
    result = pytester.runpytest("-v", "-p", "no:cacheprovider", "--strict-markers")
    passed = {line.split("::")[1].split(" ")[0] for line in result.outlines if " PASSED" in line}
    assert passed == expected
