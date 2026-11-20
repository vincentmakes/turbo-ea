"""Changes to independently checked files must reach their CI jobs."""

import fnmatch
import re
from pathlib import Path

import pytest

CI = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "ci.yml"


@pytest.mark.parametrize(
    "changed_file, job",
    [
        ("docs/api/openapi.json", "openapi-spec"),
        ("docker-compose.yml", "backend-test-unit"),
    ],
)
def test_file_change_enables_its_check(changed_file, job):
    workflow = CI.read_text(encoding="utf-8")
    jobs = re.split(r"^  ([a-z][a-z0-9-]*):\n", workflow.split("\njobs:\n", 1)[1], flags=re.M)
    jobs = dict(zip(jobs[1::2], jobs[2::2], strict=True))
    changes = jobs["changes"]
    body = jobs[job]
    assert re.search(r"^    needs: (?:\[)?changes(?:\])?$", body, re.M)
    condition = re.search(r"^    if: (.+)$", body, re.M).group(1)

    # Handle the current OR-of-boolean-comparisons syntax and fail closed if it changes.
    enabled = False
    for term in condition.split(" || "):
        output = re.fullmatch(r"needs\.changes\.outputs\.(\w+) == 'true'", term).group(1)
        expression = re.search(rf"^      {output}: \$\{{\{{ (.+) \}}\}}$", changes, re.M).group(1)
        for comparison in expression.split(" || "):
            name = re.fullmatch(r"steps\.filter\.outputs\.(\w+) == 'true'", comparison).group(1)
            block = re.search(rf"^            {name}:\n((?:              .*\n)+)", changes, re.M)
            patterns = re.findall(r"^              - '([^']+)'$", block.group(1), re.M)
            enabled |= any(fnmatch.fnmatchcase(changed_file, pattern) for pattern in patterns)
    assert enabled, f"{changed_file} does not enable {job}"
