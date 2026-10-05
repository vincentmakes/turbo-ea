"""Every mutation-suppression pragma says why.

Marking a mutant as not worth killing is the gate's one escape hatch, so it
carries a reason, like an audit-ci or trivy allowlist entry
(scripts/mutation/README.md). The separator is mutmut's own: its parser
splits the pragma on a COMMA (``mutmut/mutation/pragma_handling.py``), so
``# pragma: no mutate block: why`` would silently degrade to a single-line
pragma while ``# pragma: no mutate block, why`` keeps the block. Stryker
takes a reason after a colon natively. ``end`` / ``restore`` close a region
and need none.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]

PY_ROOTS = [ROOT / "backend" / "app", ROOT / "mcp-server" / "turbo_ea_mcp"]
TS_ROOT = ROOT / "frontend" / "src"

PY_PRAGMA = re.compile(r"#\s*pragma:\s*no mutate\b(?P<tail>.*)$")
PY_REASONED = re.compile(r"^(?:\s+(?:block|start))?\s*,\s*\S.{7,}$")
PY_END = re.compile(r"^\s+end\b")

TS_PRAGMA = re.compile(r"//\s*Stryker\s+(?P<verb>disable|restore)\b(?P<tail>.*)$")
TS_REASONED = re.compile(r"^(?:\s+next-line)?\s+[\w,]+\s*:\s*\S.{7,}$")


def py_violations(text: str) -> list[int]:
    bad = []
    for number, line in enumerate(text.splitlines(), 1):
        match = PY_PRAGMA.search(line)
        if match and not PY_END.match(match["tail"]) and not PY_REASONED.match(match["tail"]):
            bad.append(number)
    return bad


def ts_violations(text: str) -> list[int]:
    bad = []
    for number, line in enumerate(text.splitlines(), 1):
        match = TS_PRAGMA.search(line)
        if match and match["verb"] == "disable" and not TS_REASONED.match(match["tail"]):
            bad.append(number)
    return bad


@pytest.mark.parametrize(
    "line, ok",
    [
        ("x = 1  # pragma: no mutate, equivalent: the bound is inclusive by definition", True),
        ("# pragma: no mutate block, generated table, asserted whole by test_x", True),
        ("# pragma: no mutate start, log formatting only, no behaviour", True),
        ("# pragma: no mutate end", True),
        ("x = 1  # pragma: no mutate", False),
        ("x = 1  # pragma: no mutate, ok", False),  # a reason, not a shrug
        ("# pragma: no mutate block: the colon turns this into a bare pragma", False),
    ],
)
def test_python_pragma_format(line, ok):
    assert (py_violations(line) == []) is ok


@pytest.mark.parametrize(
    "line, ok",
    [
        ("// Stryker disable next-line EqualityOperator: 0 and -0 are the same here", True),
        ("// Stryker disable all: generated lookup table, compared whole in its test", True),
        ("// Stryker restore all", True),
        ("// Stryker disable next-line all", False),
        ("// Stryker disable StringLiteral", False),
    ],
)
def test_stryker_pragma_format(line, ok):
    assert (ts_violations(line) == []) is ok


def test_every_python_pragma_has_a_reason():
    bad = [
        f"{path.relative_to(ROOT)}:{n}"
        for root in PY_ROOTS
        for path in sorted(root.rglob("*.py"))
        for n in py_violations(path.read_text("utf-8"))
    ]
    assert not bad, "add `, <reason>` after `no mutate`: " + ", ".join(bad)


def test_every_stryker_pragma_has_a_reason():
    bad = [
        f"{path.relative_to(ROOT)}:{n}"
        for path in sorted(TS_ROOT.rglob("*.ts*"))
        if not path.name.endswith((".test.ts", ".test.tsx"))
        for n in ts_violations(path.read_text("utf-8"))
    ]
    assert not bad, "add `: <reason>` after the mutator: " + ", ".join(bad)
