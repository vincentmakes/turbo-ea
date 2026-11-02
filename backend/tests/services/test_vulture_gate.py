"""The dead-code gate: ``vulture`` runs in Backend Lint at the dev-extras version.

The Backend Lint job installs vulture on its own (not the dev extras), so the
pin is written twice; this keeps the two in step and keeps the step in the job.
Reads files off disk only.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
CI = BACKEND.parent / ".github" / "workflows" / "ci.yml"


def _pyproject() -> dict:
    return tomllib.loads((BACKEND / "pyproject.toml").read_text())


def _dev_pin() -> str:
    pins = [d for d in _pyproject()["project"]["optional-dependencies"]["dev"] if "vulture" in d]
    assert len(pins) == 1, pins
    return pins[0]


def _lint_job() -> str:
    text = CI.read_text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", text, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2], strict=True))["backend-lint"]


def test_vulture_is_pinned_exactly_in_the_dev_extras():
    assert re.fullmatch(r"vulture==\d+(\.\d+)+", _dev_pin())


def test_backend_lint_installs_the_same_vulture_and_runs_it_from_backend():
    job = _lint_job()
    assert f'"{_dev_pin()}"' in job
    assert re.search(r"- run: vulture\n\s+working-directory: backend\n", job), job


def test_vulture_config_scans_app_and_the_whitelist():
    cfg = _pyproject()["tool"]["vulture"]
    assert cfg["min_confidence"] == 80
    assert cfg["paths"] == ["app", "vulture_whitelist.py"]
    assert (BACKEND / "vulture_whitelist.py").is_file()
