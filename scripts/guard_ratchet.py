#!/usr/bin/env python3
"""Guard ratchet: fail a pull request that lowers a bar the test suite holds.

The suite guards itself with floors (coverage, mutation score, the guard
tests' own ``MIN_*`` anti-rot counts), exclusions (what is measured and
mutated), allowlists (what a guard test lets through, and the security
scanners' accepted findings) and the guard tests themselves. CLAUDE.md says
none of these is lowered, widened or loosened without a reason; this script is
what enforces it. It compares the working tree with the merge base of
``--base`` and reports every change that makes a bar easier to pass:

* a floor that went down, or disappeared;
* an exclusion list that widened (or an inclusion list that narrowed);
* an allowlist that grew (or a must-comply list that shrank);
* a guard test file that lost tests, or disappeared;
* a new skip / xfail / todo marker in a test, or a new ``no cover`` /
  ``v8 ignore`` in product code (a new ``no mutate`` / ``Stryker disable`` is
  listed as a non-blocking notice: it already owes a reason and a Test Plan line);
* a change to this script or its workflow.

Each of those can be right, which is why the check is not "never": a human
reads the list and applies the ``guard-change-approved`` label, and the job
re-runs green with the findings recorded in its summary. An agent never
applies that label.

Standard library only, so the CI job needs nothing but Python.

    python scripts/guard_ratchet.py --base origin/main
    python scripts/guard_ratchet.py --base origin/main --approved --summary "$GITHUB_STEP_SUMMARY"
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

REPO = Path(__file__).resolve().parents[1]
APPROVAL_LABEL = "guard-change-approved"
NOTICE = "notice"  # a finding that is reported but never blocks

# Changing these changes the ratchet itself.
RATCHET_FILES = ("scripts/guard_ratchet.py", ".github/workflows/guard-ratchet.yml")
# The ratchet's own tests quote every marker it counts; they are not product tests.
SELF_TESTS = frozenset({"backend/tests/core/test_guard_ratchet.py"})


@dataclass(frozen=True, order=True)
class Finding:
    kind: str
    where: str
    detail: str

    def line(self) -> str:
        return f"[{self.kind}] {self.where}: {self.detail}"


# ── Reading a revision ─────────────────────────────────────────────────────


class Tree:
    """Files of one revision (``rev``), or of the working tree (``rev=None``)."""

    def __init__(self, rev: str | None, root: Path = REPO) -> None:
        self.rev = rev
        self.root = root
        self._cache: dict[str, str | None] = {}
        self._files: list[str] | None = None

    def _git(self, *args: str, stdin: bytes | None = None) -> bytes:
        return subprocess.run(
            ["git", "-C", str(self.root), *args], input=stdin, capture_output=True, check=True
        ).stdout

    def files(self) -> list[str]:
        if self._files is None:
            if self.rev is None:
                out = self._git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
                names = [n for n in out.decode().split("\0") if n]
                self._files = sorted(n for n in set(names) if (self.root / n).is_file())
            else:
                out = self._git("ls-tree", "-r", "--name-only", "-z", self.rev)
                self._files = sorted(n for n in out.decode().split("\0") if n)
        return self._files

    def select(self, prefixes: Iterable[str], suffixes: Iterable[str]) -> list[str]:
        prefixes, suffixes = tuple(prefixes), tuple(suffixes)
        return [f for f in self.files() if f.startswith(prefixes) and f.endswith(suffixes)]

    def read_many(self, paths: Iterable[str]) -> dict[str, str | None]:
        wanted = [p for p in dict.fromkeys(paths) if p not in self._cache]
        if wanted and self.rev is None:
            for p in wanted:
                full = self.root / p
                self._cache[p] = (
                    full.read_text(encoding="utf-8", errors="replace") if full.is_file() else None
                )
        elif wanted:
            out = self._git(
                "cat-file", "--batch", stdin="".join(f"{self.rev}:{p}\n" for p in wanted).encode()
            )
            pos = 0
            for p in wanted:
                nl = out.index(b"\n", pos)
                header = out[pos:nl].decode().split()
                pos = nl + 1
                if header[-1] == "missing" or header[1] != "blob":
                    self._cache[p] = None
                    continue
                size = int(header[2])
                self._cache[p] = out[pos : pos + size].decode("utf-8", errors="replace")
                pos += size + 1
        return {p: self._cache[p] for p in paths}

    def read(self, path: str) -> str | None:
        return self.read_many([path])[path]


# ── Small parsers ──────────────────────────────────────────────────────────


def _scan(text: str, start: int, stop_at_close: bool) -> Iterable[tuple[int, str, int]]:
    """Walk ``text`` from ``start`` yielding (index, char, depth) outside strings and comments.

    Depth counts (), [] and {}; with ``stop_at_close`` the walk ends at the bracket
    that closes the one at ``start``.
    """
    depth, i, n = 0, start, len(text)
    while i < n:
        c = text[i]
        if c in "\"'`":
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i < 0 else i
            continue
        if text.startswith("/*", i):
            i = text.find("*/", i + 2)
            i = n if i < 0 else i + 2
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if stop_at_close and depth == 0:
                yield i, c, depth
                return
        yield i, c, depth
        i += 1


def _bracket_body(text: str, open_idx: int) -> str:
    end = open_idx
    for end, _c, _d in _scan(text, open_idx, stop_at_close=True):
        pass
    return text[open_idx + 1 : end]


def _split_top(body: str) -> list[str]:
    """Split a bracket body on its own commas (not those nested or inside strings)."""
    parts, last = [], 0
    for i, c, depth in _scan("(" + body + ")", 0, stop_at_close=True):
        if c == "," and depth == 1:
            parts.append(body[last : i - 1])
            last = i
    parts.append(body[last:])
    return [p for p in (_strip_comments(p).strip() for p in parts) if p]


def _strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)
    return "\n".join(re.sub(r"^\s*//.*$", "", line) for line in s.splitlines())


_TS_STRING = re.compile(r"""^(["'`])((?:\\.|(?!\1)[^\\])*)\1""", re.DOTALL)
_TS_KEY = re.compile(r"""^(?:(["'`])((?:\\.|(?!\1)[^\\])*)\1|([A-Za-z_$][\w$]*))\s*:""", re.DOTALL)


def ts_collection(text: str, name: str) -> list[str] | None:
    """Items of ``const NAME = {...} | [...] | new Set([...])``: object keys or array strings."""
    m = re.search(rf"\bconst\s+{re.escape(name)}\b[^=]*=\s*(new\s+Set\s*\(\s*)?([\[{{])", text)
    if not m:
        return None
    body = _bracket_body(text, m.end(2) - 1)
    items = []
    for part in _split_top(body):
        if m.group(2) == "{":
            k = _TS_KEY.match(part)
            if k:
                items.append(k.group(2) if k.group(2) is not None else k.group(3))
        else:
            s = _TS_STRING.match(part)
            items.append(s.group(2) if s else part)
    return items


def ts_record_maps(text: str) -> list[str]:
    """Names of ``const X: Record<string, string> = {`` — the frontend's reason maps."""
    return re.findall(r"\bconst\s+([A-Z][A-Z0-9_]*)\s*:\s*Record<string,\s*string>\s*=\s*\{", text)


def _literal(node: ast.AST) -> object:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Set)):
        return [_literal(e) for e in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_literal(e) for e in node.elts)
    if isinstance(node, ast.Dict):
        return {_literal(k): _literal(v) for k, v in zip(node.keys, node.values) if k is not None}
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"frozenset", "set", "tuple", "list"}
    ):
        return _literal(node.args[0]) if node.args else []
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _literal(node.left), _literal(node.right)
        if isinstance(left, str) and isinstance(right, str):
            return left + right
    raise ValueError(ast.dump(node))


def py_module_values(text: str) -> dict[str, tuple[str | None, object]]:
    """Module-level ``NAME = <literal>`` → (annotation, value), for the literals we can read."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    out: dict[str, tuple[str | None, object]] = {}
    for stmt in tree.body:
        if (
            isinstance(stmt, ast.Assign)
            and len(stmt.targets) == 1
            and isinstance(stmt.targets[0], ast.Name)
        ):
            target, ann, value = stmt.targets[0].id, None, stmt.value
        elif (
            isinstance(stmt, ast.AnnAssign)
            and isinstance(stmt.target, ast.Name)
            and stmt.value is not None
        ):
            target, ann, value = stmt.target.id, ast.unparse(stmt.annotation), stmt.value
        else:
            continue
        try:
            out[target] = (ann, _literal(value))
        except ValueError:
            pass
    return out


def _fmt(x: object) -> str:
    return x if isinstance(x, str) else repr(x)


def items_of(value: object) -> list[str]:
    """What a collection lets through, one string per entry.

    A dict contributes its keys; a dict whose values are lists of names
    (``PUBLIC_GATES``, ``MIXED_MODULES``) contributes ``key -> name`` pairs; one
    whose values start with a count (``UNRECORDED_RAISES``) carries the count,
    so raising it is growth.
    """
    if isinstance(value, dict):
        out = []
        for k, v in value.items():
            if (
                isinstance(v, (list, tuple))
                and v
                and isinstance(v[0], int)
                and not isinstance(v[0], bool)
            ):
                out.append(f"{_fmt(k)} x{v[0]}")
            elif isinstance(v, (list, tuple)) and v and all(isinstance(x, str) for x in v):
                out.extend(f"{_fmt(k)} -> {x}" for x in v)
            else:
                out.append(_fmt(k))
        return out
    if isinstance(value, (list, tuple)):
        return [_fmt(x) for x in value]
    return [_fmt(value)]


# ── Floors ─────────────────────────────────────────────────────────────────

Floors = Callable[[str], dict[str, float]]


def floors_toml(text: str) -> dict[str, float]:
    data = tomllib.loads(text)
    return {
        f"[{section}] {key}": float(v)
        for section, table in data.items()
        if isinstance(table, dict)
        for key, v in table.items()
        if isinstance(v, (int, float))
    }


def pyproject_fail_under(text: str) -> dict[str, float]:
    v = tomllib.loads(text).get("tool", {}).get("coverage", {}).get("report", {}).get("fail_under")
    return {} if v is None else {"fail_under": float(v)}


def vitest_thresholds(text: str) -> dict[str, float]:
    m = re.search(r"thresholds\s*:\s*\{([^}]*)\}", text)
    return (
        {}
        if not m
        else {
            f"thresholds.{k}": float(v) for k, v in re.findall(r"(\w+)\s*:\s*([\d.]+)", m.group(1))
        }
    )


def package_json_floors(text: str) -> dict[str, float]:
    config = json.loads(text).get("config", {})
    return {f"config.{k}": float(v) for k, v in config.items() if k.startswith("coverageFloor")}


def workflow_fail_under(text: str) -> dict[str, float]:
    """Every ``--fail-under=N`` / ``--cov-fail-under=N`` of a workflow, per job, strictest first.

    Keyed by rank rather than position, so a new informational ``=0`` report
    added beside a gate is not read as the gate dropping; removing the gate,
    or lowering it, is.
    """
    per_job: dict[tuple[str, str], list[float]] = {}
    job = "(top)"
    for line in text.splitlines():
        jm = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if jm:
            job = jm.group(1)
        for flag, value in re.findall(r"(--(?:cov-)?fail-under)=([\d.]+)", line):
            per_job.setdefault((job, flag), []).append(float(value))
    return {
        f"{job} {flag} #{rank}": value
        for (job, flag), values in per_job.items()
        for rank, value in enumerate(sorted(values, reverse=True), start=1)
    }


_PY_MIN = re.compile(r"^(MIN_[A-Z0-9_]+)\s*(?::\s*\w+)?\s*=\s*([\d_]+)\s*(?:#.*)?$", re.MULTILINE)
_TS_MIN = re.compile(r"\bconst\s+(MIN_[A-Z0-9_]+)\s*(?::\s*\w+)?\s*=\s*([\d_]+)\s*;")


def anti_rot_floors(text: str) -> dict[str, float]:
    """A guard's ``MIN_*`` constant: the count below which the scan passes vacuously."""
    return {
        name: float(v.replace("_", "")) for name, v in _PY_MIN.findall(text) + _TS_MIN.findall(text)
    }


FLOOR_FILES: tuple[tuple[str, Floors], ...] = (
    ("scripts/mutation/floors.toml", floors_toml),
    ("backend/pyproject.toml", pyproject_fail_under),
    ("mcp-server/pyproject.toml", pyproject_fail_under),
    ("frontend/vitest.config.ts", vitest_thresholds),
    ("frontend/package.json", package_json_floors),
    (".github/workflows/ci.yml", workflow_fail_under),
)
# A larger number lowers the bar: below `min_mutants` the diff gate only warns.
HIGHER_IS_LOOSER = frozenset({"[diff] min_mutants"})


def compare_floors(
    where: str, base: dict[str, float], head: dict[str, float], head_tree: Tree
) -> list[Finding]:
    found = []
    for key, old in sorted(base.items()):
        new = head.get(key)
        if new is None:
            if old == 0:
                continue  # a floor of 0 is a report, not a bar: removing it lowers nothing
            module = re.fullmatch(r"\[modules\] (.+)", key)
            if module and head_tree.read(module.group(1)) is None:
                continue  # the module itself is gone; so is its floor
            found.append(Finding("floor", where, f"{key} removed (was {old:g})"))
        elif (new > old) if key in HIGHER_IS_LOOSER else (new < old):
            found.append(Finding("floor", where, f"{key} {old:g} -> {new:g}"))
    return found


# ── Exclusions, allowlists ─────────────────────────────────────────────────

GROW, SHRINK = "grow", "shrink"  # the direction that loosens


@dataclass(frozen=True)
class Watched:
    path: str
    name: str
    loosens: str
    read: Callable[[str], list[str] | None]


def _toml_list(*keys: str) -> Callable[[str], list[str] | None]:
    def read(text: str) -> list[str] | None:
        node: object = tomllib.loads(text)
        for k in keys:
            if not isinstance(node, dict) or k not in node:
                return None
            node = node[k]
        return [str(x) for x in node] if isinstance(node, list) else None

    return read


def _vitest_list(section: str, key: str) -> Callable[[str], list[str] | None]:
    """``include`` / ``exclude`` of the test block (``section="test"``) or of ``coverage``."""

    def read(text: str) -> list[str] | None:
        cov = text.find("coverage:")
        scope = text[:cov] if section == "test" else text[cov:] if cov >= 0 else ""
        m = re.search(rf"\b{key}\s*:\s*\[", scope)
        if not m:
            return None
        return [
            s.group(2)
            for p in _split_top(_bracket_body(scope, m.end() - 1))
            if (s := _TS_STRING.match(p))
        ]

    return read


def _stryker(negated: bool) -> Callable[[str], list[str] | None]:
    def read(text: str) -> list[str] | None:
        mutate = json.loads(text).get("mutate")
        if not isinstance(mutate, list):
            return None
        return [p for p in mutate if p.startswith("!") == negated]

    return read


def _py_names(name: str) -> Callable[[str], list[str] | None]:
    def read(text: str) -> list[str] | None:
        found = py_module_values(text).get(name)
        return None if found is None else items_of(found[1])

    return read


def _ts_names(name: str) -> Callable[[str], list[str] | None]:
    return lambda text: ts_collection(text, name)


def _gitleaks(text: str) -> list[str]:
    data = tomllib.loads(text)
    blocks = list(data.get("allowlists", []))
    if isinstance(data.get("allowlist"), dict):
        blocks.append(data["allowlist"])
    for rule in data.get("rules", []):
        blocks.extend(rule.get("allowlists", []))
        if isinstance(rule.get("allowlist"), dict):
            blocks.append(rule["allowlist"])
    return [
        f"{key}: {v}"
        for block in blocks
        for key in ("paths", "regexes", "stopwords", "commits", "targetRules")
        for v in block.get(key, [])
    ]


def _plain_lines(text: str) -> list[str]:
    return [
        ln.strip() for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")
    ]


def _audit_ci(text: str) -> list[str] | None:
    m = re.search(r'"allowlist"\s*:\s*\[', text)
    if not m:
        return None
    return [
        s.group(2) if (s := _TS_STRING.match(p)) else p
        for p in _split_top(_bracket_body(text, m.end() - 1))
    ]


def _zap(text: str) -> list[str]:
    out = []
    for ln in _plain_lines(text):
        cols = ln.split("\t")
        if len(cols) >= 2 and cols[1] != "FAIL":
            out.append("\t".join(cols[:3] if cols[1] == "OUTOFSCOPE" else cols[:2]))
    return out


T = "backend/tests/services/"
# Allowlists and must-comply lists in guard tests whose type does not mark
# them. Reason maps typed ``dict[str, str]`` / ``Record<string, string>`` are
# found on their own, in any guard test.
REGISTRY: tuple[Watched, ...] = (
    # Coverage and mutation scope.
    Watched(
        "backend/pyproject.toml",
        "tool.coverage.run.omit",
        GROW,
        _toml_list("tool", "coverage", "run", "omit"),
    ),
    Watched(
        "backend/pyproject.toml",
        "tool.mutmut.do_not_mutate",
        GROW,
        _toml_list("tool", "mutmut", "do_not_mutate"),
    ),
    Watched(
        "mcp-server/pyproject.toml",
        "tool.coverage.run.omit",
        GROW,
        _toml_list("tool", "coverage", "run", "omit"),
    ),
    Watched(
        "mcp-server/pyproject.toml",
        "tool.mutmut.do_not_mutate",
        GROW,
        _toml_list("tool", "mutmut", "do_not_mutate"),
    ),
    Watched("frontend/vitest.config.ts", "test.include", SHRINK, _vitest_list("test", "include")),
    Watched(
        "frontend/vitest.config.ts", "coverage.include", SHRINK, _vitest_list("coverage", "include")
    ),
    Watched(
        "frontend/vitest.config.ts", "coverage.exclude", GROW, _vitest_list("coverage", "exclude")
    ),
    Watched("frontend/stryker.config.json", "mutate (included)", SHRINK, _stryker(negated=False)),
    Watched("frontend/stryker.config.json", "mutate (excluded)", GROW, _stryker(negated=True)),
    # Security scanners' accepted findings.
    Watched(".gitleaks.toml", "allowlists", GROW, _gitleaks),
    Watched(".github/trivy-allowlist", "CVE ids", GROW, _plain_lines),
    Watched(".github/audit-ci.jsonc", "allowlist", GROW, _audit_ci),
    Watched(".github/zap-rules.tsv", "non-FAIL rules", GROW, _zap),
    # What satisfies a guard (growth loosens it).
    Watched(T + "test_route_auth_guard.py", "AUTH", GROW, _py_names("AUTH")),
    Watched(T + "test_route_auth_guard.py", "ROUTER_AUTH", GROW, _py_names("ROUTER_AUTH")),
    Watched(T + "test_route_auth_guard.py", "PUBLIC_GATES", GROW, _py_names("PUBLIC_GATES")),
    Watched(T + "test_card_read_scope_guard.py", "SCOPE_MARKERS", GROW, _py_names("SCOPE_MARKERS")),
    Watched(
        "frontend/src/lib/richHtml.sourceScan.test.ts", "SANITIZERS", GROW, _ts_names("SANITIZERS")
    ),
    # Exemptions without a type annotation.
    Watched(
        T + "test_audit_log_guard.py", "NOT_AN_ADMIN_ACTION", GROW, _py_names("NOT_AN_ADMIN_ACTION")
    ),
    Watched(
        T + "test_audit_log_guard.py", "NOT_A_BULK_EXPORT", GROW, _py_names("NOT_A_BULK_EXPORT")
    ),
    Watched(
        T + "test_auth_audit_guard.py", "UNRECORDED_RAISES", GROW, _py_names("UNRECORDED_RAISES")
    ),
    Watched(
        T + "test_notification_actor.py", "SYSTEM_EMITTERS", GROW, _py_names("SYSTEM_EMITTERS")
    ),
    Watched(T + "test_notification_actor.py", "SELF_ALLOWED", GROW, _py_names("SELF_ALLOWED")),
    Watched(
        "backend/tests/api/test_read_scope_sentinel_sweep.py",
        "UNMAPPED_PARAMS",
        GROW,
        _py_names("UNMAPPED_PARAMS"),
    ),
    Watched(
        "backend/tests/api/test_read_scope_sentinel_sweep.py",
        "SKIP_PREFIXES",
        GROW,
        _py_names("SKIP_PREFIXES"),
    ),
    Watched(
        T + "test_ci_workflow_mutation.py", "READS_NO_SOURCE", GROW, _py_names("READS_NO_SOURCE")
    ),
    Watched("mcp-server/tests/test_safeguards.py", "_NOT_A_BATCH", GROW, _py_names("_NOT_A_BATCH")),
    # What a guard holds to its rule (shrinking loosens it).
    Watched(
        T + "test_card_read_scope_guard.py", "READ_SERVICES", SHRINK, _py_names("READ_SERVICES")
    ),
    Watched(
        T + "test_audit_log_guard.py", "PURE_ADMIN_MODULES", SHRINK, _py_names("PURE_ADMIN_MODULES")
    ),
    Watched(T + "test_audit_log_guard.py", "MIXED_MODULES", SHRINK, _py_names("MIXED_MODULES")),
    Watched(
        T + "test_auth_audit_guard.py", "RECORDING_ROUTES", SHRINK, _py_names("RECORDING_ROUTES")
    ),
    Watched(T + "test_notification_actor.py", "NOTIFY_FUNCS", SHRINK, _py_names("NOTIFY_FUNCS")),
    Watched(T + "test_permission_keys_guard.py", "CHECKS", SHRINK, _py_names("CHECKS")),
    Watched(T + "test_permission_keys_guard.py", "KEY_KWARGS", SHRINK, _py_names("KEY_KWARGS")),
    Watched(
        T + "test_agent_instructions_budget.py",
        "FORBIDDEN_GLOBS",
        SHRINK,
        _py_names("FORBIDDEN_GLOBS"),
    ),
)


# ── Guard tests ────────────────────────────────────────────────────────────

PY_TEST_ROOTS = ("backend/tests/", "mcp-server/tests/")
TS_TEST_SUFFIXES = (".test.ts", ".test.tsx", ".spec.ts")
_PY_TEST = re.compile(r"^\s*(?:async\s+)?def\s+test_", re.MULTILINE)
_TS_TEST = re.compile(r"^\s*(?:it|test|itSourceScan)(?:\.each\([^\n]*?\))?\s*\(", re.MULTILINE)


def is_guard(path: str, text: str) -> bool:
    """A test that reads the source as text to hold a convention: the repo marks them all."""
    if path in SELF_TESTS:
        return False
    if path.startswith(PY_TEST_ROOTS) and path.endswith(".py"):
        return "source_scan" in text or "guard" in Path(path).name
    if path.startswith("frontend/") and path.endswith(TS_TEST_SUFFIXES):
        return ".sourceScan." in path or "describeSourceScan(" in text or "itSourceScan(" in text
    return False


def guard_files(tree: Tree) -> dict[str, str]:
    candidates = tree.select(PY_TEST_ROOTS, (".py",)) + tree.select(
        ("frontend/",), TS_TEST_SUFFIXES
    )
    texts = tree.read_many(candidates)
    return {p: t for p, t in texts.items() if t is not None and is_guard(p, t)}


def count_tests(path: str, text: str) -> int:
    return len((_PY_TEST if path.endswith(".py") else _TS_TEST).findall(text))


# ── Markers: skips in tests, suppressions in product code ──────────────────


@dataclass(frozen=True)
class Marker:
    label: str
    prefixes: tuple[str, ...]
    suffixes: tuple[str, ...]
    pattern: re.Pattern[str]
    tests_only: bool = False  # count only in test files (else only outside them)
    # A notice is listed in the summary but blocks nothing: mutation pragmas are
    # already held to a reason (test_mutation_pragmas.py) and named in the Test
    # Plan, and blocking them sent a third of all PRs to the label.
    blocking: bool = True


def _is_test(path: str) -> bool:
    return (
        path.startswith(PY_TEST_ROOTS)
        or path.endswith(TS_TEST_SUFFIXES)
        or path.startswith("frontend/e2e/")
    )


MARKERS: tuple[Marker, ...] = (
    Marker(
        "skipped or xfailed test",
        PY_TEST_ROOTS,
        (".py",),
        re.compile(r"pytest\.mark\.(?:skip|skipif|xfail)\b|pytest\.(?:skip|xfail|importorskip)\("),
        tests_only=True,
    ),
    Marker(
        "skipped, todo or expected-fail test",
        ("frontend/",),
        (".ts", ".tsx"),
        re.compile(
            r"\b(?:it|test|describe|itSourceScan|describeSourceScan)\.(?:skip|skipIf|todo|fixme|fails)\b"
            r"|\bx(?:it|describe)\("
        ),
        tests_only=True,
    ),
    Marker(
        "coverage exclusion pragma",
        ("backend/app/", "mcp-server/turbo_ea_mcp/"),
        (".py",),
        re.compile(r"pragma:\s*no\s*cover"),
    ),
    Marker(
        "coverage ignore hint",
        ("frontend/src/", "frontend/scripts/"),
        (".ts", ".tsx", ".mjs"),
        re.compile(r"\b(?:v8|c8|istanbul)\s+ignore\b"),
    ),
    Marker(
        "mutation suppression",
        ("backend/app/", "mcp-server/turbo_ea_mcp/"),
        (".py",),
        re.compile(r"pragma:\s*no\s*mutate"),
        blocking=False,
    ),
    Marker(
        "mutation suppression",
        ("frontend/src/", "frontend/scripts/"),
        (".ts", ".tsx", ".mjs"),
        re.compile(r"Stryker\s+disable"),
        blocking=False,
    ),
)


def marker_counts(tree: Tree, marker: Marker) -> dict[str, int]:
    paths = [
        p
        for p in tree.select(marker.prefixes, marker.suffixes)
        if p not in SELF_TESTS and _is_test(p) == marker.tests_only
    ]
    return {p: len(marker.pattern.findall(t)) for p, t in tree.read_many(paths).items() if t}


# ── The checks ─────────────────────────────────────────────────────────────


def check_floors(base: Tree, head: Tree) -> list[Finding]:
    found = []
    for path, extract in FLOOR_FILES:
        old, new = base.read(path), head.read(path)
        if old is None:
            continue
        if new is None:
            found.append(Finding("floor", path, "file removed"))
            continue
        found += compare_floors(path, extract(old), extract(new), head)
    base_guards, head_guards = guard_files(base), guard_files(head)
    for path, text in base_guards.items():
        if path in head_guards:
            found += compare_floors(
                path, anti_rot_floors(text), anti_rot_floors(head_guards[path]), head
            )
    return found


def watched_lists(base: Tree, head: Tree) -> list[Watched]:
    watched = list(REGISTRY)
    known = {(w.path, w.name) for w in watched}
    for tree in (base, head):
        for path, text in guard_files(tree).items():
            if path.endswith(".py"):
                names = [
                    n for n, (ann, _v) in py_module_values(text).items() if ann == "dict[str, str]"
                ]
                make = _py_names
            else:
                names, make = ts_record_maps(text), _ts_names
            for name in names:
                if (path, name) not in known:
                    known.add((path, name))
                    watched.append(Watched(path, name, GROW, make(name)))
    return watched


def check_lists(base: Tree, head: Tree) -> list[Finding]:
    found = []
    for w in watched_lists(base, head):
        old_text, new_text = base.read(w.path), head.read(w.path)
        if old_text is None:
            continue  # a new file or list: nothing to loosen yet
        kind = "allowlist" if w.loosens == GROW else "must-comply list"
        if w.path.endswith(("pyproject.toml", "vitest.config.ts", "stryker.config.json")):
            kind = "measurement scope"
        old = w.read(old_text)
        if old is None:
            continue
        new = w.read(new_text) if new_text is not None else None
        if new is None:
            found.append(
                Finding(kind, w.path, f"{w.name} can no longer be read (removed or reshaped)")
            )
            continue
        old_set, new_set = set(old), set(new)
        changed = sorted(new_set - old_set) if w.loosens == GROW else sorted(old_set - new_set)
        verb = "adds" if w.loosens == GROW else "drops"
        found += [Finding(kind, w.path, f"{w.name} {verb} {item!r}") for item in changed]
    return found


def check_guard_tests(base: Tree, head: Tree) -> list[Finding]:
    found = []
    head_guards = guard_files(head)
    for path, text in sorted(guard_files(base).items()):
        new_text = head_guards.get(path) or head.read(path)
        if new_text is None:
            found.append(Finding("guard test", path, "file removed"))
            continue
        old_n, new_n = count_tests(path, text), count_tests(path, new_text)
        if new_n < old_n:
            found.append(Finding("guard test", path, f"tests {old_n} -> {new_n}"))
        if path not in head_guards:
            found.append(Finding("guard test", path, "no longer marked as a source scan"))
    return found


def check_markers(base: Tree, head: Tree) -> list[Finding]:
    found = []
    for marker in MARKERS:
        old, new = marker_counts(base, marker), marker_counts(head, marker)
        for path in sorted(new):
            gained = new[path] - old.get(path, 0)
            if gained > 0:
                kind = "suppression" if marker.blocking else NOTICE
                found.append(Finding(kind, path, f"+{gained} {marker.label}"))
    return found


def check_ratchet(base: Tree, head: Tree) -> list[Finding]:
    found = []
    for path in RATCHET_FILES:
        old, new = base.read(path), head.read(path)
        if old is not None and old != new:
            found.append(Finding("ratchet", path, "removed" if new is None else "changed"))
    return found


CHECKS = (check_ratchet, check_floors, check_lists, check_guard_tests, check_markers)


def run(base: Tree, head: Tree) -> list[Finding]:
    return sorted({f for check in CHECKS for f in check(base, head)})


# ── Entry point ────────────────────────────────────────────────────────────


def merge_base(ref: str, root: Path = REPO) -> str:
    out = subprocess.run(
        ["git", "-C", str(root), "merge-base", ref, "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def blocking(findings: list[Finding]) -> list[Finding]:
    return [f for f in findings if f.kind != NOTICE]


def _cell(text: str) -> str:
    return text.replace("|", "\\|")  # outside the f-string: 3.11 allows no backslash inside


def _table(findings: list[Finding]) -> str:
    rows = "\n".join(f"| {f.kind} | `{f.where}` | {_cell(f.detail)} |" for f in findings)
    return f"| Kind | Where | Change |\n|---|---|---|\n{rows}\n"


def summary(findings: list[Finding], approved: bool, base_rev: str) -> str:
    out = "### Guard ratchet\n\n"
    blockers = blocking(findings)
    notices = [f for f in findings if f.kind == NOTICE]
    if not blockers:
        out += f"No bar lowered against `{base_rev[:12]}`.\n"
    else:
        state = (
            f"**Approved** by the `{APPROVAL_LABEL}` label."
            if approved
            else "**Blocked.** Fix these, or have a maintainer review them and apply the "
            f"`{APPROVAL_LABEL}` label."
        )
        out += (
            f"{len(blockers)} change(s) lower a bar against `{base_rev[:12]}`. {state}\n\n"
            + _table(blockers)
        )
    if notices:
        out += "\n**Notices** (not blocking; answer them in the Test Plan):\n\n" + _table(notices)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--base", default="origin/main", help="branch to compare with (its merge base with HEAD)"
    )
    parser.add_argument(
        "--approved", action="store_true", help=f"a maintainer applied {APPROVAL_LABEL}"
    )
    parser.add_argument(
        "--summary", help="append a Markdown summary here (e.g. $GITHUB_STEP_SUMMARY)"
    )
    args = parser.parse_args(argv)

    base_rev = merge_base(args.base, REPO)
    findings = run(Tree(base_rev, REPO), Tree(None, REPO))
    blockers = blocking(findings)
    for f in findings:
        level = "notice" if f.kind == NOTICE else "warning" if args.approved else "error"
        print(f"::{level} file={f.where}::{f.line()}")
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(summary(findings, args.approved, base_rev))
    if not blockers:
        print(f"Guard ratchet: no bar lowered against {base_rev[:12]}.")
        return 0
    print(
        f"Guard ratchet: {len(blockers)} change(s) lower a bar.",
        "Approved." if args.approved else "Blocked.",
    )
    return 0 if args.approved else 1


if __name__ == "__main__":
    sys.exit(main())
