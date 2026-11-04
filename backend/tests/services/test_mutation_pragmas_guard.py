"""Guard: a ``# pragma: no mutate`` sits on the line that holds the code it suppresses.

mutmut reads the pragma per line: a trailing ``# pragma: no mutate`` exempts the
nodes that START on that line, and nothing else. When ``ruff format`` splits a
call that no longer fits in 100 columns, the trailing comment moves to the line
holding the closing parenthesis — so the pragma still reads as present while the
arguments it was written for, now on the line above, are mutated again (the
``jwt.encode(...)`` in ``core/security.py`` was stranded that way, and the MCP
server's ``oauth.py`` fell below its critical-module floor from the same shape;
``mcp-server/tests/test_mutation_pragmas.py`` is this scan's twin).

The scan fails on a pragma whose line holds nothing but closing punctuation
(``)``, ``]``, ``}``, optionally a ``.method()`` chain, a comma or a colon),
unless the ``file:line`` is in ``STRANDED_OK`` with the reason. Fix it by joining
the statement back onto one line with the pragma — move the reason to a comment
above if the line would run past 100 columns — or, when even the bare pragma
does not fit, fence the statement with ``# pragma: no mutate start`` /
``# pragma: no mutate end`` comment lines.

Reads ``app/`` as source, so it is a ``source_scan`` and is deselected under
mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import io
import re
import tokenize

import pytest

from tests.app_source import iter_py

pytestmark = pytest.mark.source_scan

PRAGMA = "pragma: no mutate"

# Nothing but closers, then any ``.method(...)`` chain, then an optional ``,`` or ``:``.
CLOSING_ONLY = re.compile(r"^[)\]}]+(?:\.\w+\([^()]*\)|[)\]}])*[,:]?$")

# ``"<path under app/>:<line>"`` -> why the pragma may stay on a closing line.
STRANDED_OK: dict[str, str] = {}


def _stranded_pragmas(source: str) -> list[int]:
    """Line numbers of every ``no mutate`` pragma trailing a closing-punctuation-only line."""
    lines = source.splitlines()
    found = []
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type != tokenize.COMMENT or PRAGMA not in tok.string:
            continue
        row, col = tok.start
        code = lines[row - 1][:col].strip()
        if code and CLOSING_ONLY.match(code):
            found.append(row)
    return found


def _stranded() -> list[str]:
    return [f"{rel}:{line}" for rel, text in iter_py().items() for line in _stranded_pragmas(text)]


def test_the_app_uses_the_pragma():
    # A scan that never meets a pragma proves nothing.
    assert any(PRAGMA in text for text in iter_py().values())


def test_no_pragma_is_stranded_on_a_closing_line():
    offenders = [site for site in _stranded() if site not in STRANDED_OK]
    assert not offenders, (
        "mutmut reads `# pragma: no mutate` per line, and only for code that STARTS on "
        "that line. `ruff format` split these calls and left the pragma on the closing "
        "line, so the code it was written for is mutated again. Join each statement back "
        "onto one line with the pragma (reason in a comment above if it would exceed 100 "
        "columns), or fence it with `# pragma: no mutate start` / `end` comment lines: "
        f"{offenders}"
    )


def test_allowlist_is_not_stale():
    found = set(_stranded())
    for site in STRANDED_OK:
        assert site in found, f"{site} no longer strands a pragma; drop it from STRANDED_OK"


@pytest.mark.parametrize(
    "snippet",
    [
        "return jwt.encode(\n    payload, key, algorithm=ALG\n)  # pragma: no mutate, default\n",
        'auth = h.get(\n    b"authorization", b""\n).decode()  # pragma: no mutate\n',
        "v = f(\n    a\n).strip().lower()  # pragma: no mutate\n",
        "call(\n    f(\n        a\n    ),  # pragma: no mutate\n)\n",
        "if g(\n    a\n):  # pragma: no mutate\n    pass\n",
        "x = [\n    1\n]  # pragma: no mutate\n",
        "x = {\n    1: 2\n}  # pragma: no mutate\n",
    ],
)
def test_scanner_flags_a_stranded_pragma(snippet):
    assert _stranded_pragmas(snippet)


@pytest.mark.parametrize(
    "snippet",
    [
        "return jwt.encode(payload, key, algorithm=ALG)  # pragma: no mutate, default\n",
        'auth = h.get(b"authorization", b"").decode()  # pragma: no mutate\n',
        "# pragma: no mutate start\nawait f(a)\n# pragma: no mutate end\n",
        "x = f(\n    a,  # pragma: no mutate\n)\n",
        'x = ")  # pragma: no mutate"\n',
        "x = f(a)  # a plain comment\n",
    ],
)
def test_scanner_ignores_a_pragma_on_its_own_code(snippet):
    assert _stranded_pragmas(snippet) == []
