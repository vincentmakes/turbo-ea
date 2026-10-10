"""Every mutation-suppression pragma says why.

Marking a mutant as not worth killing is the gate's one escape hatch, so it
carries a reason, like an audit-ci or trivy allowlist entry
(scripts/mutation/README.md). The separator is mutmut's own: its parser
splits the pragma on a COMMA (``mutmut/mutation/pragma_handling.py``), so
``# pragma: no mutate block: why`` would silently degrade to a single-line
pragma while ``# pragma: no mutate block, why`` keeps the block. Stryker
takes a reason after a colon natively. ``end`` / ``restore`` close a region
and need none.

mutmut also reads a pragma only where its parser looks for one: at the end
of a statement, on a compound header, or on a line of its own. A pragma after
an argument inside a multi-line call is not read and suppresses nothing, so
the reasoned survivor stays a survivor; ``test_mutmut_reads_every_pragma``
pins that none sits where it would be ignored.
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


def unread_pragmas(text: str) -> list[int]:
    """Lines whose pragma sits inside brackets, where mutmut never reads one.

    mutmut's parser (``PragmaVisitor``) reads a pragma from a statement's
    trailing comment, a compound header or a comment line between statements.
    A comment inside ``(…)``, ``[…]`` or ``{…}`` is held by libcst's
    ``ParenthesizedWhitespace``, which that parser never visits.
    """
    import libcst as cst
    from libcst.metadata import ParentNodeProvider, PositionProvider

    class Finder(cst.CSTVisitor):
        METADATA_DEPENDENCIES = (ParentNodeProvider, PositionProvider)

        def __init__(self) -> None:
            self.lines: list[int] = []

        def visit_Comment(self, node: cst.Comment) -> None:  # noqa: N802 (libcst name)
            if not PY_PRAGMA.search(node.value):
                return
            holder = self.get_metadata(ParentNodeProvider, node)
            if isinstance(
                self.get_metadata(ParentNodeProvider, holder), cst.ParenthesizedWhitespace
            ):
                self.lines.append(self.get_metadata(PositionProvider, node).start.line)

    finder = Finder()
    cst.MetadataWrapper(cst.parse_module(text)).visit(finder)
    return finder.lines


@pytest.mark.parametrize(
    "source, unread",
    [
        ("x = f(a, b)  # pragma: no mutate, the whole statement's first line\n", []),
        ("x = f(\n    a,\n    b,\n)  # pragma: no mutate, read at the statement's end\n", []),
        ("if a:  # pragma: no mutate, a compound header is read too\n    pass\n", []),
        ("x = f(\n    a,  # pragma: no mutate, an argument is never read\n    b,\n)\n", [2]),
        ("x = f(  # pragma: no mutate, nor after an opening bracket\n    a,\n)\n", [1]),
        ("x = [\n    # pragma: no mutate, nor on a line of its own inside one\n    a,\n]\n", [2]),
        ("# pragma: no mutate block, a line between statements is read\nx = 1\n", []),
    ],
)
def test_where_mutmut_reads_a_pragma(source, unread):
    assert unread_pragmas(source) == unread


@pytest.mark.source_scan
def test_mutmut_reads_every_pragma():
    bad = [
        f"{path.relative_to(ROOT)}:{n}"
        for root in PY_ROOTS
        for path in sorted(root.rglob("*.py"))
        if "no mutate" in (text := path.read_text("utf-8"))
        for n in unread_pragmas(text)
    ]
    assert not bad, "mutmut does not read these pragmas (see the docstring): " + ", ".join(bad)
