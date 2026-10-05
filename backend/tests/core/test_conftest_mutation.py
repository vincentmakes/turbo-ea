"""The two things ``tests/conftest.py`` does for mutation runs.

mutmut forks several pytest runs at once, so each needs its own Postgres
schema; and a mutation run must fail, not skip, when the database is gone —
a skipped suite kills no mutant and still exits 0.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.conftest import _worker_schema

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
