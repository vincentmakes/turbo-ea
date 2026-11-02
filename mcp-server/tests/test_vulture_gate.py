"""The lint and dead-code gates: ruff and vulture run in MCP Server Tests.

The job gets both tools from the dev extras, so the pins are written once, in
``pyproject.toml``. This keeps the pins, the ``[tool.*]`` config and the CI steps
in step, and keeps vulture on the backend's version. Reads files off disk only.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

MCP = Path(__file__).resolve().parents[1]
REPO = MCP.parent
CI = REPO / ".github" / "workflows" / "ci.yml"


def _pyproject(root: Path = MCP) -> dict:
    return tomllib.loads((root / "pyproject.toml").read_text())


def _dev_pin(tool: str, root: Path = MCP) -> str:
    dev = _pyproject(root)["project"]["optional-dependencies"]["dev"]
    pins = [d for d in dev if re.match(rf"{tool}\b", d)]
    assert len(pins) == 1, pins
    return pins[0]


def _mcp_job() -> str:
    text = CI.read_text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", text, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2], strict=True))["mcp-test"]


def _step(job: str, run: str) -> int:
    """Offset of a ``- run: <run>`` step that runs from mcp-server/."""
    match = re.search(rf"- run: {re.escape(run)}\n\s+working-directory: mcp-server\n", job)
    assert match, f"no `{run}` step in mcp-test:\n{job}"
    return match.start()


def test_vulture_is_pinned_exactly_and_to_the_backend_version():
    pin = _dev_pin("vulture")
    assert re.fullmatch(r"vulture==\d+(\.\d+)+", pin)
    assert pin == _dev_pin("vulture", REPO / "backend")


def test_ruff_has_the_backend_floor():
    assert _dev_pin("ruff") == _dev_pin("ruff", REPO / "backend")


def test_mcp_job_installs_the_dev_extras_then_lints_before_testing():
    job = _mcp_job()
    install = _step(job, 'pip install -e ".[dev]"')
    fmt = _step(job, "ruff format --check .")
    lint = _step(job, "ruff check .")
    dead = _step(job, "vulture")
    tests = job.index("- run: python -m pytest")
    assert install < fmt < lint < dead < tests


def test_ruff_config_mirrors_the_backend():
    ours, backend = _pyproject()["tool"]["ruff"], _pyproject(REPO / "backend")["tool"]["ruff"]
    assert ours["line-length"] == backend["line-length"] == 100
    assert ours["lint"]["select"] == backend["lint"]["select"]


def test_vulture_config_scans_the_package_and_the_whitelist():
    cfg = _pyproject()["tool"]["vulture"]
    assert cfg["min_confidence"] == 80
    assert cfg["paths"] == ["turbo_ea_mcp", "vulture_whitelist.py"]
    assert cfg["exclude"] == ["tests/"]
    assert (MCP / "vulture_whitelist.py").is_file()


def test_only_the_package_is_installed():
    """The whitelist sits beside the package; it must never ship in the image."""
    find = _pyproject()["tool"]["setuptools"]["packages"]["find"]
    assert find["include"] == ["turbo_ea_mcp*"]
