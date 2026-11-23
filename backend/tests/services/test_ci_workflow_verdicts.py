"""The verdict cache's wiring in ``ci.yml``: what may be skipped, and what records.

Reads ``.github/workflows/ci.yml`` off disk like ``test_ci_workflow_sharding.py``
and the group table out of ``scripts/ci/verdicts.py``. What must not drift: a
job skips only on its own group's marker and never on a missing one (``!=
'true'``); a group's marker is saved only after the whole unit passed — never
by a shard, never on ``always()``, never off a pull request; the fingerprint
covers at least every filter that decides whether the job runs; and the jobs
left out on purpose (advisory scans, secrets, the spec, docs and deploy) stay
out.
"""

from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CI = ROOT / ".github" / "workflows" / "ci.yml"
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
verdicts = importlib.import_module("verdicts")

SAVE = "actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0"
RESTORE = "actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0"

# Jobs that never skip on a verdict, with why. A scan whose verdict depends on
# a database outside the repository cannot be cached on the repository's bytes.
NEVER_SKIPPED: dict[str, str] = {
    "changes": "decides what runs",
    "secrets": "not path-filtered; a credential can land in any file",
    "security-backend": "advisory databases change daily",
    "security-frontend": "advisory databases change daily",
    "openapi-spec": "regenerates and commits on main; cheap",
    "coverage-badges": "push to main only",
    "docs-build": "not in the table yet",
    "devcontainer-check": "not in the table yet",
}


def jobs() -> dict[str, str]:
    """Job id → its raw YAML body (text between two top-level job keys)."""
    text = CI.read_text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", text, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def steps(body: str) -> list[str]:
    return re.split(r"^      - ", body.split("    steps:\n", 1)[1], flags=re.M)[1:]


def job_if(body: str) -> str:
    """The job-level ``if:`` as one line (a folded ``>-`` block joined with spaces)."""
    m = re.search(r"^    if: (>-\n((?:      .*\n)+)|(.*)\n)", body, flags=re.M)
    assert m, "no job-level if:"
    if m.group(3) is not None:
        return m.group(3)
    return " ".join(line.strip() for line in m.group(2).splitlines())


def own_steps(body: str) -> list[str]:
    """Steps without the comment lines that introduce the NEXT job."""
    # `[ \t]*`, not `\s*`: `\s` also matches the newline the group ends on, which
    # makes the repetition ambiguous and backtrack exponentially on blank lines.
    return [re.sub(r"\n(?:  #.*\n|[ \t]*\n)*\Z", "\n", s) for s in steps(body)]


GROUPS = [pytest.param(g, id=g.name) for g in verdicts.GROUPS]


# The one documented two-marker skip: Frontend E2E skips on its own marker only
# when Frontend Tests, which needs its coverage artifact from the same run, is
# not running on this push (skipped on its marker, or its gate is off).
E2E_IF = (
    "needs.changes.outputs.e2e == 'true'"
    " && !(needs.changes.outputs.done_frontend_e2e == 'true'"
    " && (needs.changes.outputs.done_frontend_tests == 'true'"
    " || needs.changes.outputs.frontend != 'true'))"
)


@pytest.mark.parametrize("group", GROUPS)
def test_every_job_of_a_group_skips_on_that_groups_marker_only(group):
    j = jobs()
    for job in group.jobs:
        condition = job_if(j[job])
        # never `== 'false'`: a missing output must run the job
        assert "== 'false'" not in condition
        if job == "frontend-e2e":
            assert condition == E2E_IF
            assert verdicts.E2E_CONDITION == E2E_IF
            assert set(re.findall(r"outputs\.done_(\w+)", j[job])) == {
                "frontend_e2e",
                "frontend_tests",
            }
            continue
        assert condition.endswith(f" && needs.changes.outputs.done_{group.ident} != 'true'"), job
        assert set(re.findall(r"outputs\.done_(\w+)", j[job])) == {group.ident}, job


def _evaluate(condition: str, outputs: dict[str, bool]) -> bool:
    """A job-level `if:` of this shape, evaluated in Python against string outputs."""
    expr = re.sub(
        r"needs\.changes\.outputs\.(\w+) (==|!=) 'true'",
        lambda m: f"(outputs[{m.group(1)!r}] {'is' if m.group(2) == '==' else 'is not'} True)",
        condition.replace("always() && ", ""),
    )
    expr = expr.replace("&&", " and ").replace("||", " or ").replace("!(", " not (")
    assert "needs." not in expr and "'true'" not in expr, expr
    return eval(expr, {"__builtins__": {}}, {"outputs": outputs})  # noqa: S307


def test_the_browser_suite_runs_whenever_the_aggregate_needs_its_coverage():
    """Evaluate the workflow's own two conditions over every combination of outputs."""
    j = jobs()
    e2e_if, tests_if = job_if(j["frontend-e2e"]), job_if(j["frontend-test"])
    names = ("e2e", "frontend", "done_frontend_e2e", "done_frontend_tests")
    for bits in range(16):
        out = {name: bool(bits >> i & 1) for i, name in enumerate(names)}
        e2e_runs, aggregate_runs = _evaluate(e2e_if, out), _evaluate(tests_if, out)
        if aggregate_runs and out["e2e"]:
            assert e2e_runs, out  # the aggregate merges its coverage from this run
        if out["e2e"] and not out["done_frontend_e2e"]:
            assert e2e_runs, out  # no marker of its own: it runs
        if not out["e2e"]:
            assert not e2e_runs, out
        if out["e2e"] and out["done_frontend_e2e"] and not aggregate_runs:
            assert not e2e_runs, out  # the skip this split exists for


@pytest.mark.parametrize("group", GROUPS)
def test_the_fingerprint_covers_every_filter_that_gates_the_job(group):
    """A job that runs on a filter the fingerprint ignores could be skipped past a change."""
    j = jobs()
    for job in group.jobs:
        gates = {
            gate
            for gate in re.findall(r"needs\.changes\.outputs\.(\w+) [!=]= 'true'", job_if(j[job]))
            if not gate.startswith("done_")
        }
        assert gates, job
        assert gates <= set(group.filters), (job, gates - set(group.filters))


@pytest.mark.parametrize("group", GROUPS)
def test_the_marker_is_saved_last_and_only_after_the_unit_passed(group):
    j = jobs()
    key = (
        f"key: ${{{{ needs.changes.outputs.key_{group.ident} }}}}"
        "-${{ github.run_id }}-${{ github.run_attempt }}"
    )
    if group.recorder in group.jobs:
        record, save = own_steps(j[group.recorder])[-2:]
        assert record.startswith("name: Record the verdict for later pushes\n")
        assert 'echo "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" > .verdict/passed' in record
        assert save.startswith("name: Save the verdict\n")
        assert f"uses: {SAVE}\n" in save
        assert "path: .verdict\n" in save and key in save
        condition = (
            f"github.event_name == 'pull_request' && needs.changes.outputs.key_{group.ident} != ''"
        )
        for step in (record, save):
            line = re.search(r"^        if: (.*)$", step, flags=re.M).group(1)
            # default success(): no status function may widen it
            assert line.startswith(condition), step
            assert not re.search(r"\b(always|failure|cancelled)\(\)", line), step
    else:
        # a job of its own, after the unit's last job passed
        assert group.recorder not in group.jobs
        body = j[group.recorder]
        last = group.jobs[-1]
        assert f"    needs: [changes, {last}]\n" in body
        assert job_if(body) == (
            f"github.event_name == 'pull_request' && needs.{last}.result == 'success'"
            f" && needs.changes.outputs.key_{group.ident} != ''"
        )
        assert f"uses: {SAVE}\n" in body and key in body
        assert "always()" not in body


def test_the_frontend_unit_records_only_with_a_green_or_absent_browser_suite():
    record, save = own_steps(jobs()["frontend-test"])[-2:]
    for step in (record, save):
        assert (
            "&& (needs.frontend-e2e.result == 'success' || needs.frontend-e2e.result == 'skipped')"
        ) in step


def test_shards_and_the_browser_suite_never_record():
    j = jobs()
    recorders = {g.recorder for g in verdicts.GROUPS}
    for job_id, body in j.items():
        saves = "actions/cache/save@" in body
        if job_id in recorders:
            assert saves, job_id
            assert body.count("actions/cache/save@") == 1, job_id
        else:
            assert not saves, job_id
            assert "needs.changes.outputs.key_" not in body, job_id
    for job in ("backend-test-shards", "frontend-test-shards"):
        assert job not in recorders
    # the browser suite is its own group now, and records for itself
    assert "frontend-e2e" in recorders


def test_every_skipping_job_is_in_the_table_and_the_rest_are_not():
    j = jobs()
    in_table = {job for g in verdicts.GROUPS for job in g.jobs}
    recorders = {g.recorder for g in verdicts.GROUPS}
    for job_id, body in j.items():
        if job_id in in_table:
            continue
        assert "needs.changes.outputs.done_" not in body, job_id
    for job_id in NEVER_SKIPPED:
        assert job_id in j, f"stale entry {job_id}"
        assert job_id not in in_table and job_id not in recorders
    for job_id in j:
        if job_id.startswith(("helm", "deploy", "terraform")):
            assert job_id not in in_table and job_id not in recorders


def test_the_changes_job_looks_up_this_prs_markers_and_never_fails_on_it():
    body = jobs()["changes"]
    assert "      actions: read" in body
    assert "fetch-depth: 2\n" in body
    lookup = next(s for s in steps(body) if "scripts/ci/verdicts.py" in s)
    assert "id: verdicts\n" in lookup
    assert "if: github.event_name == 'pull_request'\n" in lookup
    assert "continue-on-error: true\n" in lookup
    assert "GH_TOKEN: ${{ github.token }}\n" in lookup
    assert "PR_NUMBER: ${{ github.event.pull_request.number }}\n" in lookup
    # the PR number reaches the shell as an env var, never interpolated
    run = lookup.split("run: ", 1)[1]
    assert "${{" not in run
    assert '--pr "$PR_NUMBER"' in run and '--repo "$GITHUB_REPOSITORY"' in run
    # the lookup runs after the paths filter it reads
    assert body.index("dorny/paths-filter@") < body.index("run: python3 scripts/ci/verdicts.py")


@pytest.mark.parametrize("group", GROUPS)
def test_the_changes_job_exports_both_outputs_per_group(group):
    body = jobs()["changes"]
    assert (
        f"      done_{group.ident}: ${{{{ github.event_name == 'pull_request'"
        f" && steps.verdicts.outputs.done_{group.ident} == 'true' }}}}\n"
    ) in body
    assert f"      key_{group.ident}: ${{{{ steps.verdicts.outputs.key_{group.ident} }}}}\n" in body


def test_a_change_to_the_skip_logic_reruns_every_suite():
    filters = verdicts.parse_filters(CI.read_text())
    assert "scripts/ci/**" in filters["ci"]
    assert ".github/workflows/**" in filters["ci"]


def test_the_save_action_is_the_pinned_one_the_workflow_already_restores_with():
    text = CI.read_text()
    assert RESTORE in text
    for line in text.splitlines():
        if "actions/cache/" in line:
            assert line.strip().endswith(
                ("@" + SAVE.split("@", 1)[1], "@" + RESTORE.split("@", 1)[1])
            )


def test_every_action_in_ci_yml_is_pinned_to_a_commit():
    for line in CI.read_text().splitlines():
        m = re.match(r"^\s*(?:- )?uses: ([^\s#]+)", line)
        if m and not m.group(1).startswith("./"):
            assert re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", m.group(1)), line


def test_every_job_the_table_names_exists_and_the_lookup_is_the_last_step():
    j = jobs()
    for g in verdicts.GROUPS:
        assert g.recorder in j, g.recorder
        for job in g.jobs:
            assert job in j, job
    assert "id: verdicts\n" in own_steps(j["changes"])[-1]
