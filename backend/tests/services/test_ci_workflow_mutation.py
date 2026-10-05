"""The mutation gate's CI wiring: the PR jobs, the nightly, and the files they share.

Reads the workflows and configs off disk like ``test_ci_workflow_sharding.py``.
What must not drift: the PR jobs are diff-scoped and PR-only, the backend job
cannot pass on a missing database, a PR-controlled file name never reaches a
shell through ``${{ }}``, the caches the PR jobs restore are the ones the
nightly saves, and the nightly measures the existing code resumably and
reports it through the same gate.
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CI = ROOT / ".github" / "workflows" / "ci.yml"
NIGHTLY = ROOT / ".github" / "workflows" / "mutation-nightly.yml"


def jobs(path: Path) -> dict[str, str]:
    """Job id → its raw YAML body (text between two top-level job keys)."""
    text = path.read_text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", text, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


PR_JOBS = [
    pytest.param("backend-mutation", "Backend Mutation Tests", "backend", id="backend"),
    pytest.param("mcp-mutation", "MCP Mutation Tests", "mcp", id="mcp"),
    pytest.param("frontend-mutation", "Frontend Mutation Tests", "frontend", id="frontend"),
]


@pytest.mark.parametrize("job_id, name, suite", PR_JOBS)
def test_each_suite_has_a_diff_scoped_pr_gate(job_id, name, suite):
    body = jobs(CI)[job_id]
    assert f"name: {name}\n" in body
    assert "needs: changes" in body
    assert (
        f"if: github.event_name == 'pull_request' && needs.changes.outputs.{suite} == 'true'"
        in body
    )
    assert "fetch-depth: 0" in body  # changed_lines.py needs the merge base
    assert "scripts/mutation/changed_lines.py" in body
    assert f"scripts/mutation/gate.py --suite {suite} --scope diff" in body
    assert '--summary "$GITHUB_STEP_SUMMARY"' in body
    assert "continue-on-error" not in body
    if suite != "frontend":  # stop cleanly before the job timeout, with a summary
        assert "--budget " in body


def test_the_backend_gate_cannot_pass_on_a_missing_database():
    body = jobs(CI)["backend-mutation"]
    assert 'TEST_DB_REQUIRED: "1"' in body
    assert "image: postgres:16-alpine" in body
    conftest = (ROOT / "backend" / "tests" / "conftest.py").read_text()
    assert 'os.getenv("TEST_DB_REQUIRED")' in conftest


def test_no_mutation_job_interpolates_step_output_into_a_script():
    """`--mutate` is built from file names a PR controls."""
    for job_id in ("backend-mutation", "mcp-mutation", "frontend-mutation"):
        assert "${{ steps." not in jobs(CI)[job_id]
    # the nightly's only step outputs are the shard counts its jobs export
    for line in NIGHTLY.read_text().splitlines():
        if "${{ steps." in line:
            assert (
                line.strip()
                == "count: ${{ steps.meta.outputs.count }} # every leg writes the same value"
            )


@pytest.mark.parametrize("filter_name", ["backend", "frontend", "mcp"])
def test_a_change_to_the_scripts_reruns_every_gate(filter_name):
    rest = CI.read_text().split(f"            {filter_name}:\n", 1)[1]
    entries = re.match(r"((?:              .*\n)+)", rest).group(1)
    assert "'scripts/mutation/**'" in entries


@pytest.mark.parametrize(
    "pr_job, path, prefix",
    [
        ("backend-mutation", ".mutation/backend/backend", "mutmut-backend-shard"),
        ("mcp-mutation", ".mutation/mcp-server/mcp-server", "mutmut-mcp-shard"),
    ],
)
def test_pr_jobs_restore_the_cache_the_nightly_saves(pr_job, path, prefix):
    body = jobs(CI)[pr_job]
    assert f"path: {path}" in body
    assert f"restore-keys: {prefix}1-" in body
    nightly = NIGHTLY.read_text()
    assert f"path: {path}" in nightly
    assert f"key: {prefix}" in nightly
    assert "actions/cache/save@" in nightly and "actions/cache/save@" not in body


def test_the_nightly_measures_every_suite_resumably():
    j = jobs(NIGHTLY)
    assert {"backend", "mcp", "frontend", "report"} <= set(j)
    assert "shard: [1, " in j["backend"] and '--shard "$SHARD"' in j["backend"]
    assert "shard: [1, " in j["frontend"] and "stryker_scope.py nightly" in j["frontend"]
    assert '--budget "$BUDGET"' in j["frontend"] and "collect --state" in j["frontend"]
    assert "--shard 1/1" in j["mcp"]
    for job in ("backend", "mcp"):
        assert '--budget "$BUDGET"' in j[job]
        assert 'TEST_DB_REQUIRED: "1"' in j[job] or job == "mcp"
    text = NIGHTLY.read_text()
    assert 'cron: "' in text and "workflow_dispatch:" in text
    # caches are written by main only
    assert "SAVE_CACHE: ${{ github.event_name != 'pull_request' && github.ref == " in text
    assert text.count("if: always() && env.SAVE_CACHE == 'true'") == 3


def test_the_nightly_report_runs_after_failed_shards_and_uses_the_gate():
    body = jobs(NIGHTLY)["report"]
    # a missing shard must not silently shrink the score
    assert "needs.backend.outputs.count" in body and "needs.frontend.outputs.count" in body
    assert "needs: [backend, mcp, frontend]" in body
    assert "if: always()" in body
    assert 'gate.py --suite "$suite" --scope suite --allow-pending' in body
    assert "issues: write" in body
    assert "ISSUE_TITLE: Mutation survivors (nightly)" in body
    # the job only fails after the issue and artifacts are written
    assert body.index("Update the survivors issue") < body.index("Fail when a suite")


def test_the_nightly_alone_may_write_issues():
    assert "issues: write" not in CI.read_text()
    top = NIGHTLY.read_text().split("\njobs:\n", 1)[0]
    assert "permissions:\n  contents: read\n" in top


def test_stryker_config_leaves_the_floor_to_the_gate():
    config = json.loads((ROOT / "frontend" / "stryker.config.json").read_text())
    assert config["testRunner"] == "vitest"
    # Stryker's threads pool ignores vi.stubEnv("TZ"); its config leaves those suites out
    assert config["vitest"]["configFile"] == "vitest.stryker.config.ts"
    stryker_vitest = (ROOT / "frontend" / "vitest.stryker.config.ts").read_text()
    assert "stubEnv" in stryker_vitest and "configDefaults.exclude" in stryker_vitest
    assert config["thresholds"]["break"] is None  # the floor lives in floors.toml
    assert config["jsonReporter"]["fileName"] == "reports/mutation/mutation.json"
    assert config["incrementalFile"] == "reports/stryker-incremental.json"
    # A static mutant has no per-test coverage, so each one reruns the whole
    # suite: left on, they cost a nine-file run 95% of its time.
    assert config["ignoreStatic"] is True
    # The dry run is single-threaded over every test related to the mutated
    # files: the whole suite extrapolated to ~50 minutes on 2026-10-05, so a
    # widely imported module's chunk needs this much or it never finishes.
    assert config["dryRunTimeoutMinutes"] >= 60
    # gitignore-style: an unanchored "reports" also drops src/features/reports,
    # tests and all, from Stryker's sandbox — silently.
    assert config["ignorePatterns"] and all(p.startswith("/") for p in config["ignorePatterns"])
    # the nightly keeps one incremental file and report per chunk, cached
    assert "path: frontend/reports/nightly" in NIGHTLY.read_text()


def test_mutmut_is_pinned_identically_in_both_python_suites():
    pins = set()
    for suite in ("backend", "mcp-server"):
        data = tomllib.loads((ROOT / suite / "pyproject.toml").read_text())
        dev = data["project"]["optional-dependencies"]["dev"]
        pins |= {d for d in dev if d.startswith("mutmut")}
        mutmut = data["tool"]["mutmut"]
        assert "only_mutate" not in mutmut  # see mutmut_scope.py: it keeps stale stats
        assert data["tool"]["pytest"]["ini_options"]["testpaths"] == ["tests"]
    assert len(pins) == 1 and next(iter(pins)).startswith("mutmut==")


def test_every_floor_is_documented_in_the_rule_that_owns_it():
    claude = (ROOT / "CLAUDE.md").read_text()
    assert "scripts/mutation/floors.toml" in claude
    for job in ("Backend Mutation Tests", "Frontend Mutation Tests", "MCP Mutation Tests"):
        assert job in claude
        assert job in (ROOT / "CONTRIBUTING.md").read_text()
    template = (ROOT / ".github" / "pull_request_template.md").read_text()
    assert "Mutation" in template
