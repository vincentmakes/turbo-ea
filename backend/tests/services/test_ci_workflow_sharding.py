"""The two slow test jobs run as shards, and the aggregates stay the required checks.

Reads ``.github/workflows/ci.yml`` off disk like the nginx and publish-workflow
guards. Two things must never drift: branch protection treats a *skipped*
required check as passing, so the aggregate job carrying the required name has
to run on ``always()`` and fail explicitly when a shard failed; and a shard
measures a fraction of the suite, so it must never report or gate on the
coverage it collected — the floor and the diff gate belong to the aggregate.
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


def first_step(body: str) -> str:
    steps = body.split("    steps:\n", 1)[1]
    return re.split(r"^      - ", steps, flags=re.M)[1]


CASES = [
    pytest.param(
        "backend-test-integration",
        "backend-test-shards",
        "Backend Integration Tests",
        "backend",
        4,
        ["--shard=${{ matrix.shard }}/4", "--cov-report= ", "--cov-fail-under=0", "-n auto"],
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
        "Frontend Tests",
        "frontend",
        3,
        [
            "--shard=${{ matrix.shard }}/3",
            "--reporter=blob",
            "--coverage.thresholds.lines=0",
            "--coverage.thresholds.statements=0",
            "--coverage.thresholds.branches=0",
            "--coverage.thresholds.functions=0",
        ],
        ["npx vitest run --merge-reports --coverage.enabled"],
        id="frontend",
    ),
]


@pytest.mark.parametrize(
    "aggregate_id, shards_id, required_name, gate, count, shard_flags, aggregate_commands", CASES
)
def test_the_aggregate_is_the_required_check_and_cannot_be_skipped_past_a_failed_shard(
    aggregate_id, shards_id, required_name, gate, count, shard_flags, aggregate_commands
):
    j = jobs()
    aggregate, shards = j[aggregate_id], j[shards_id]

    # The required name sits on the aggregate alone; shard legs carry "(shard k/N)".
    assert f"    name: {required_name}\n" in aggregate
    assert CI.read_text().count(f"    name: {required_name}\n") == 1
    assert f"    name: {required_name} (shard ${{{{ matrix.shard }}}}/{count})\n" in shards

    # Skipped reads as passing: run on always(), gate only on the changes filter,
    # and make the very first step fail on anything but a fully green matrix.
    assert f"    needs: [changes, {shards_id}]\n" in aggregate
    assert f"    if: always() && needs.changes.outputs.{gate} == 'true'\n" in aggregate
    guard = first_step(aggregate)
    assert f"needs.{shards_id}.result" in guard and '= "success"' in guard

    # The matrix is the one place the shard count is declared; the command and
    # the job name must say the same N.
    assert "      fail-fast: false\n" in shards
    assert f"        shard: [{', '.join(str(k) for k in range(1, count + 1))}]\n" in shards
    for flag in shard_flags:
        assert flag in shards, flag
    assert "if-no-files-found: error" in shards

    for command in aggregate_commands:
        assert command in aggregate, command
    assert "Diff coverage" in aggregate and "--fail-under=80" in aggregate

    # The key, not the phrase: the comment introducing the next job may cite it.
    for body in (aggregate, shards):
        assert "continue-on-error:" not in body


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
