"""Changes to independently checked files must reach their CI jobs."""

import fnmatch
import re
from pathlib import Path

import pytest

CI = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "ci.yml"


TOOLING_INPUTS = [
    ("docs/admin/supply-chain.md", "signature_docs"),
    ("docs/reference/releases.md", "signature_docs"),
    ("backend/tests/services/test_release_workflow_guards.py", "signature_docs"),
    (".claude/hooks/security-review.cjs", "review_hooks"),
    (".claude/hooks/check-security-review.cjs", "review_hooks"),
    (".claude/hooks/release-audits.cjs", "review_hooks"),
    (".claude/hooks/shell-commands.cjs", "review_hooks"),
    (".claude/settings.json", "review_hooks"),
    (".codex/hooks.json", "review_hooks"),
    ("scripts/security/test_security_review_hooks.py", "review_hooks"),
    ("scripts/security/release-audits.test.cjs", "review_hooks"),
    (".claude/hooks/session-start.sh", "trail_bootstrap"),
    ("scripts/test_trail_web_start.sh", "trail_bootstrap"),
    ("scripts/i18n/check_locales.py", "translation_tool"),
    ("scripts/i18n/test_check_locales_cli.py", "translation_tool"),
    ("scripts/screenshots/capture.ts", "screenshot_tool"),
    ("scripts/screenshots/capture.test.mjs", "screenshot_tool"),
    ("scripts/screenshots/package.json", "screenshot_tool"),
    ("scripts/screenshots/package-lock.json", "screenshot_tool"),
]


def workflow_jobs():
    workflow = CI.read_text(encoding="utf-8")
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", workflow.split("\njobs:\n", 1)[1], flags=re.M)
    return dict(zip(parts[1::2], parts[2::2], strict=True))


def output_patterns(changes, output):
    expression = re.search(rf"^      {output}: \$\{{\{{ (.+) \}}\}}$", changes, re.M)
    assert expression, f"missing change output {output}"
    patterns = []
    for comparison in expression.group(1).split(" || "):
        name = re.fullmatch(r"steps\.filter\.outputs\.(\w+) == 'true'", comparison).group(1)
        block = re.search(rf"^            {name}:\n((?:              .*\n)+)", changes, re.M)
        patterns.extend(re.findall(r"^              - '([^']+)'$", block.group(1), re.M))
    return patterns


@pytest.mark.parametrize(
    "changed_file, job",
    [
        ("docs/api/openapi.json", "openapi-spec"),
        ("docker-compose.yml", "backend-test-unit"),
        (".github/workflows/ci.yml", "tooling-tests"),
        *((path, "tooling-tests") for path, _ in TOOLING_INPUTS),
    ],
)
def test_file_change_enables_its_check(changed_file, job):
    jobs = workflow_jobs()
    body = jobs[job]
    assert re.search(r"^    needs: (?:\[)?changes(?:\])?$", body, re.M)
    condition = re.search(r"^    if: (.+)$", body, re.M).group(1)

    # Handle the current OR-of-boolean-comparisons syntax and fail closed if it changes.
    patterns = []
    for term in condition.split(" || "):
        output = re.fullmatch(r"needs\.changes\.outputs\.(\w+) == 'true'", term).group(1)
        patterns.extend(output_patterns(jobs["changes"], output))
    assert any(fnmatch.fnmatchcase(changed_file, pattern) for pattern in patterns), (
        f"{changed_file} does not enable {job}"
    )


@pytest.mark.parametrize("changed_file, output", TOOLING_INPUTS)
def test_tooling_inputs_enable_the_step_that_checks_them(changed_file, output):
    patterns = output_patterns(workflow_jobs()["changes"], output)
    assert any(fnmatch.fnmatchcase(changed_file, pattern) for pattern in patterns)


@pytest.mark.parametrize(
    "output",
    ["signature_docs", "review_hooks", "trail_bootstrap", "translation_tool", "screenshot_tool"],
)
def test_ci_workflow_change_enables_each_tooling_step(output):
    workflow = CI.read_text(encoding="utf-8")
    expression = re.search(rf"^      {output}: \$\{{\{{ (.+) \}}\}}$", workflow, re.M)
    assert expression, f"missing change output {output}"
    assert "steps.filter.outputs.ci == 'true'" in expression.group(1).split(" || ")


@pytest.mark.parametrize(
    "command, output",
    [
        ("python scripts/security/test_security_review_hooks.py", "review_hooks"),
        ("node --test scripts/security/release-audits.test.cjs", "review_hooks"),
        ("bash scripts/test_trail_web_start.sh", "trail_bootstrap"),
        (
            "python -m unittest discover -s scripts/i18n -p test_check_locales_cli.py",
            "translation_tool",
        ),
        ("npm ci --prefix scripts/screenshots", "screenshot_tool"),
        ("npm --prefix scripts/screenshots test", "screenshot_tool"),
        (
            "python -m pytest --noconftest -q "
            "backend/tests/services/test_release_workflow_guards.py "
            "-k documented_backend_signature",
            "signature_docs",
        ),
    ],
)
def test_tooling_suite_runs_only_for_its_inputs(command, output):
    body = workflow_jobs()["tooling-tests"]

    # Each command must remain attached to its own step and its path predicate.
    steps = re.split(r"^      - (?:name:|uses:|run:)", body, flags=re.M)[1:]
    step = next((item for item in steps if command in item), None)
    assert step is not None, f"{command} is missing from tooling-tests"
    assert f"needs.changes.outputs.{output} == 'true'" in step
