"""The two slow test jobs run as shards, and the aggregates stay the required checks.

Reads ``.github/workflows/ci.yml`` off disk like the nginx and publish-workflow
guards. Two things must never drift: branch protection treats a *skipped*
required check as passing, so the aggregate job carrying the required name has
to run on ``always()`` and fail explicitly when a shard failed; and a shard
measures a fraction of the suite, so it must never report or gate on the
coverage it collected — the floor and the diff gate belong to the aggregate.

The frontend aggregate also folds in the browser suite's coverage: it needs
``frontend-e2e`` for that LCOV, never for its verdict, and the merged floor,
the diff gate and the badge read the merged report only when that job passed.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

CI = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "ci.yml"


def jobs() -> dict[str, str]:
    """Job id → its raw YAML body (text between two top-level job keys)."""
    text = CI.read_text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", text, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def steps(body: str) -> list[str]:
    """A job's steps as raw text blocks, in order."""
    return re.split(r"^      - ", body.split("    steps:\n", 1)[1], flags=re.M)[1:]


def first_step(body: str) -> str:
    return steps(body)[0]


CASES = [
    pytest.param(
        "backend-test-integration",
        "backend-test-shards",
        "",
        "Backend Integration Tests",
        "backend",
        4,
        [
            "--shard=${{ matrix.shard }}/${{ strategy.job-total }}",
            "--cov-report= ",
            "--cov-fail-under=0",
            "-n auto",
        ],
        [
            "python -m coverage combine coverage.shard-*",
            "python -m coverage report",
            "coverage xml",
        ],
        id="backend",
    ),
    pytest.param(
        "frontend-test",
        "frontend-test-shards",
        ", frontend-e2e",
        "Frontend Tests",
        "frontend",
        3,
        [
            "--shard=${{ matrix.shard }}/${{ strategy.job-total }}",
            "--reporter=blob",
            "--coverage.thresholds.lines=0",
            "--coverage.thresholds.statements=0",
            "--coverage.thresholds.branches=0",
            "--coverage.thresholds.functions=0",
        ],
        [
            "npx vitest run --merge-reports --coverage.enabled",
            "node scripts/merge-lcov.mjs --out coverage-merged --fail-under-from-package "
            "coverage/lcov.info coverage-e2e/lcov.info",
            "diff-cover coverage-merged/lcov.info",
        ],
        id="frontend",
    ),
]


@pytest.mark.parametrize(
    "aggregate_id, shards_id, extra_needs, required_name, gate, count, shard_flags, "
    "aggregate_commands",
    CASES,
)
def test_the_aggregate_is_the_required_check_and_cannot_be_skipped_past_a_failed_shard(
    aggregate_id,
    shards_id,
    extra_needs,
    required_name,
    gate,
    count,
    shard_flags,
    aggregate_commands,
):
    j = jobs()
    aggregate, shards = j[aggregate_id], j[shards_id]

    # The required name sits on the aggregate alone; shard legs carry "(shard k/N)".
    assert f"    name: {required_name}\n" in aggregate
    assert CI.read_text().count(f"    name: {required_name}\n") == 1
    assert (
        f"    name: {required_name} (shard ${{{{ matrix.shard }}}}/${{{{ strategy.job-total }}}})\n"
        in shards
    )

    # Skipped reads as passing: run on always(), gate only on the changes filter,
    # and make the very first step fail on anything but a fully green matrix.
    assert f"    needs: [changes, {shards_id}{extra_needs}]\n" in aggregate
    assert f"    if: always() && needs.changes.outputs.{gate} == 'true'\n" in aggregate
    guard = first_step(aggregate)
    assert f"needs.{shards_id}.result" in guard and '= "success"' in guard
    # The always() summary step must not run before checkout when the guard
    # failed — it would only add a second error to an already red job.
    assert "if: always() && steps.shards-ok.outcome == 'success'" in aggregate

    # The matrix is the ONLY place the shard count is declared: the name and
    # the command read it from strategy.job-total, the legs publish it, and
    # the aggregate refuses to combine fewer data files than that.
    assert "      fail-fast: false\n" in shards
    assert f"        shard: [{', '.join(str(k) for k in range(1, count + 1))}]\n" in shards
    assert "      count: ${{ steps.meta.outputs.count }}" in shards
    assert 'echo "count=${{ strategy.job-total }}" >> "$GITHUB_OUTPUT"' in shards
    for flag in shard_flags:
        assert flag in shards, flag
    assert "if-no-files-found: error" in shards
    assert "overwrite: true" in shards
    assert f'expected="${{{{ needs.{shards_id}.outputs.count }}}}"' in aggregate
    assert 'test "$found" -eq "$expected"' in aggregate

    for command in aggregate_commands:
        assert command in aggregate, command
    assert "Diff coverage" in aggregate and "--fail-under=80" in aggregate

    # The key, not the phrase: the comment introducing the next job may cite it.
    for body in (aggregate, shards):
        assert "continue-on-error:" not in body


def test_the_frontend_aggregate_folds_in_the_browser_coverage_only_from_a_green_run():
    """The browser suite's LCOV joins the figure; its verdict stays its own check."""
    j = jobs()
    aggregate, e2e = j["frontend-test"], j["frontend-e2e"]

    # Wherever a frontend change can move the figure, the browser suite ran
    # too — otherwise the merged floor and the badge would swing with the path
    # filter. The e2e filter is therefore frontend/** plus its own inputs, and
    # the job gates on it alone: the wider `frontend` filter also fires for
    # scripts/mutation/**, which cannot move the figure and must not boot the
    # browser suite.
    assert "    if: needs.changes.outputs.e2e == 'true'\n" in e2e
    rest = CI.read_text().split("            e2e:\n", 1)[1]
    entries = re.match(r"((?:              .*\n)+)", rest).group(1)
    assert "- 'frontend/**'\n" in entries
    assert "- 'scripts/e2e/**'\n" in entries
    assert "scripts/mutation" not in entries
    assert 'E2E_COVERAGE: "1"' in e2e
    assert "node scripts/e2e-coverage.mjs" in e2e
    upload = next(s for s in steps(e2e) if "name: frontend-e2e-coverage" in s)
    assert "path: frontend/coverage-e2e/lcov.info" in upload
    assert "if-no-files-found: error" in upload
    assert "continue-on-error:" not in e2e

    # The aggregate downloads and merges only from a green run, and its guard
    # step judges the shards alone.
    download = next(s for s in steps(aggregate) if "name: frontend-e2e-coverage" in s)
    assert "if: needs.frontend-e2e.result == 'success'" in download
    assert "needs.frontend-e2e.result" not in first_step(aggregate)
    merge = next(s for s in steps(aggregate) if "scripts/merge-lcov.mjs" in s)
    success_branch, _, fallback = merge.partition("else")
    assert "--fail-under-from-package" in success_branch
    assert "--fail-under-from-package" not in fallback
    assert "merge-lcov.mjs --out coverage-merged coverage/lcov.info\n" in fallback
    for step in steps(aggregate):
        if "coverage-badge/frontend" in step or "name: coverage-badge-frontend" in step:
            assert "needs.frontend-e2e.result == 'success'" in step, step
    assert "jq -r '.total.lines.pct' coverage-merged/coverage-summary.json" in aggregate


def test_the_merged_lines_floor_is_set_and_a_number():
    """merge-lcov.mjs reads it from package.json under --fail-under-from-package.

    The script refuses a string or an out-of-range value itself; the case that
    needs pinning here is the key going MISSING (a rename, a typo), which the
    script now refuses too — this test keeps the key where CI expects it.
    """
    import json

    pkg = json.loads((CI.parents[2] / "frontend" / "package.json").read_text())
    floor = pkg["config"]["coverageFloorMergedLines"]
    assert isinstance(floor, (int, float)) and not isinstance(floor, bool)
    assert 0 <= floor <= 100


def test_the_frontend_blob_upload_includes_the_hidden_reports_directory():
    # .vitest-reports/ is a dotdir and upload-artifact skips hidden files by default.
    shards = jobs()["frontend-test-shards"]
    assert "path: frontend/.vitest-reports/" in shards
    assert "include-hidden-files: true" in shards


def test_the_backend_shard_hands_over_a_visible_file():
    # The data file is renamed out of its dotfile name for the same reason.
    shards = jobs()["backend-test-shards"]
    assert 'mv .coverage "coverage.shard-${{ matrix.shard }}"' in shards
    assert "path: backend/coverage.shard-${{ matrix.shard }}" in shards


def test_the_workflow_parses():
    yaml = pytest.importorskip("yaml")
    parsed = yaml.safe_load(CI.read_text())
    for job_id in (
        "backend-test-shards",
        "backend-test-integration",
        "frontend-test-shards",
        "frontend-test",
    ):
        assert job_id in parsed["jobs"], job_id
    assert parsed["jobs"]["backend-test-shards"]["strategy"]["matrix"]["shard"] == [1, 2, 3, 4]
    assert parsed["jobs"]["frontend-test-shards"]["strategy"]["matrix"]["shard"] == [1, 2, 3]
    assert parsed["jobs"]["frontend-test"]["needs"] == [
        "changes",
        "frontend-test-shards",
        "frontend-e2e",
    ]
