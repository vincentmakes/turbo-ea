"""A release build re-resolves the backend's Python dependencies.

The publish workflow keeps the `backend-build` stage cached on a branch push
(its `pip install` layer is keyed on backend/pyproject.toml alone), which is
how certifi 2026.10.18 — CRITICAL, GHSA-6q48-6c7w-9gw2 — stayed in the
backend image after 2026.10.19 was out, and the Trivy gate failed every re-run
of the v2.172.0 tag. A tag push now adds `backend-build` to the no-cache
filters, and the two pyprojects floor certifi at the fixed release so no
resolver picks the bad one again. The workflow is scanned as text, like
``test_publish_workflow_signing``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

_ROOT = Path(__file__).resolve().parents[3]
_WORKFLOW = _ROOT / ".github" / "workflows" / "docker-publish.yml"
_FILTERS_RE = re.compile(r"no-cache-filters:\s*(\$\{\{.*\}\})")
_CERTIFI_FLOOR = "certifi>=2026.10.19"


def _filters_expression() -> str:
    match = _FILTERS_RE.search(_WORKFLOW.read_text())
    assert match, "docker-publish.yml declares no-cache-filters"
    return match.group(1)


def test_a_release_tag_rebuilds_the_backend_pip_stage():
    expr = _filters_expression()
    assert "startsWith(github.ref, 'refs/tags/')" in expr
    tag_list = re.search(r"refs/tags/'\)\s*&&\s*'([^']+)'", expr)
    assert tag_list, "the tag branch of the expression names its stages"
    assert "backend-build" in tag_list.group(1).split(",")


def test_a_branch_push_keeps_the_backend_pip_stage_cached():
    expr = _filters_expression()
    branch_list = re.search(r"\|\|\s*'([^']+)'\)\s*\|\|\s*''", expr)
    assert branch_list, "the branch-push list is the expression's fallback"
    assert "backend-build" not in branch_list.group(1).split(",")
    # The runtime stages still rebuild on every push, as before.
    assert {"backend", "mcp-server"} <= set(branch_list.group(1).split(","))


def test_the_filters_are_only_emitted_on_push():
    # buildx refuses --no-cache together with --no-cache-filter, and the
    # scheduled / manual runs already pass --no-cache.
    assert _filters_expression().startswith("${{ github.event_name == 'push' &&")


@pytest.mark.parametrize("pyproject", ["backend/pyproject.toml", "mcp-server/pyproject.toml"])
def test_certifi_is_floored_at_the_fixed_release(pyproject: str):
    assert _CERTIFI_FLOOR in (_ROOT / pyproject).read_text()
