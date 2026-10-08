"""Run mutmut on the Python suites and turn its results into gate records.

    python scripts/mutation/mutmut_scope.py run --suite backend --changed changed.json
    python scripts/mutation/mutmut_scope.py run --suite backend --shard 2/6 --budget 300
    python scripts/mutation/mutmut_scope.py collect --suite backend --changed changed.json \\
        --output records.json

``run`` builds the shadow root (``shadow_root.py``) and runs ``mutmut run`` on
a set of mutant-name patterns, never on nothing: without names mutmut's
"clean test" step re-runs the whole suite serially a second time.

* ``--changed`` (a PR): the mutants of every top-level function or method the
  change touches. Not the whole file: one edited line in a 3,000-line route
  module would otherwise mutate all of it.
* ``--shard K/N`` (the nightly): every mutable file, dealt largest-first into
  N shards like ``backend/tests/shard_plugin.py`` deals test files, so the
  suite runs on N runners. mutmut keeps each verdict in ``mutants/``, so with
  ``--budget`` a shard stops cleanly after that many minutes and the next
  night resumes where it stopped: the baseline of the existing code is built
  up over several nights, then only changed functions are re-tested.

  That resumption is this script's doing, not mutmut's: mutmut re-tests every
  mutant NAMED on its command line, verdict or not, and skips verdicts only
  when it is given no names at all, which would mean the whole suite as its
  clean test and every shard's mutants at once. Passing the shard's file
  patterns therefore re-tested the whole shard each night, fastest first, so
  once the baseline was large the budget ran out before the mutants still
  unchecked came up (2026-10-07: a night of 1.2 mutants a second and not one
  new verdict). A shard run first lets mutmut regenerate the mutants without
  testing any (``generate_only``), which is also when it resets the verdicts
  of every function whose code changed, then names only the functions that
  still have an unchecked mutant (``unchecked_patterns``).

  A changed *test* resets nothing in mutmut: it keeps a survivor's verdict
  until its function's source changes, so the kills a tests-only PR adds
  would never reach the nightly. Between generating and naming, a shard
  therefore reopens every survived or untested mutant whose function is
  exercised by a test module that changed since the last run
  (``reopen_survivors``), judged by a digest of the test modules kept in the
  cached ``mutants/``.

``collect`` reads ``mutmut results`` and writes the records ``gate.py``
scores; with ``--changed`` it keeps only mutants on a changed line, with
``--shard`` only the shard's files.

mutmut's ``only_mutate`` is deliberately never used for scoping: it is not
part of the configuration fingerprint, so changing it between runs keeps the
old test-to-function stats and every function newly in scope reads "no tests".

mutmut reports a mutant by name (``app.x.x_f__mutmut_3``) and shows it as a
unified diff of the *function*, numbered from the function's first line, so
the absolute line is recovered here: the function is found with ``ast`` and
the diff's ``-`` line is checked against the source. Anything that cannot be
placed counts as changed when its function overlaps the change — the gate
errs towards asking about a mutant, never towards hiding one.
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import shadow_root  # noqa: E402
from changed_lines import touches  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SUITE_DIRS = {"backend": "backend", "mcp": "mcp-server"}
CLASS_SEP = "ǁ"
MUTMUT = ["mutmut"]  # the command; a test swaps in a stand-in

# mutmut's status strings (mutmut/stats.py) → the gate's four.
STATUS = {
    "killed": "killed",
    "timeout": "killed",
    "segfault": "killed",
    "caught by type check": "killed",
    "survived": "survived",
    "no tests": "survived",
    "suspicious": "survived",
    "skipped": "excluded",
    "not checked": "pending",
    "check was interrupted by user": "pending",
}

_RESULT = re.compile(r"^\s+(\S+__mutmut_\d+): (.+?)\s*$")
_HUNK = re.compile(r"^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@")
_NOTHING_MATCHES = "Filtered for specific mutants, but nothing matches"
# A name no mutant has. mutmut generates the mutants, loads its stats, then
# stops on _NOTHING_MATCHES before running a single test.
_GENERATE_ONLY = "mutmut_scope.generate_only__mutmut_0"
# Beside mutmut's own files in the cached mutants/: what the tests were when
# the cached verdicts were last brought up to date.
TESTS_DIGEST = "mutmut-tests-digest.json"
# Verdicts a new test can change: survived (0) and no tests (33).
_REOPENABLE = (0, 33)


# ── configuration ────────────────────────────────────────────────────────────


def suite_dir(suite: str, repo: Path = REPO) -> Path:
    return repo / SUITE_DIRS[suite]


def mutmut_config(directory: Path) -> dict:
    data = tomllib.loads((directory / "pyproject.toml").read_text("utf-8"))
    return data.get("tool", {}).get("mutmut", {})


def should_mutate(rel: str, config: dict) -> bool:
    """The same include/exclude test mutmut applies (configuration.should_mutate)."""
    if not rel.endswith(".py"):
        return False
    if not any(rel == p or rel.startswith(p.rstrip("/") + "/") for p in config["source_paths"]):
        return False
    only = config.get("only_mutate", [])
    if only and not any(fnmatch.fnmatch(rel, p) for p in only):
        return False
    return not any(fnmatch.fnmatch(rel, p) for p in config.get("do_not_mutate", []))


# ── names ↔ files ────────────────────────────────────────────────────────────


def module_of(rel: str) -> str:
    """``app/x/y.py`` → ``app.x.y``; a package ``__init__`` names the package."""
    module = rel[: -len(".py")].replace("/", ".")
    return module[: -len(".__init__")] if module.endswith(".__init__") else module


def patterns_for(rel: str) -> list[str]:
    """mutmut name patterns for exactly the functions and methods of one file."""
    module = module_of(rel)
    return [f"{module}.x_*", f"{module}.x{CLASS_SEP}*"]


def function_pattern(rel: str, func: str, cls: str | None) -> str:
    """The pattern for the mutants of one function or method."""
    key = f"x{CLASS_SEP}{cls}{CLASS_SEP}{func}" if cls else f"x_{func}"
    return f"{module_of(rel)}.{key}__mutmut_*"


_TRAMPOLINE_SAFE = {"staticmethod", "classmethod"}


def is_mutated(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """mutmut skips every decorated function except a bare @staticmethod or
    @classmethod (mutation/file_mutation.py) — every FastAPI route handler."""
    if not node.decorator_list:
        return True
    only = node.decorator_list[0] if len(node.decorator_list) == 1 else None
    return isinstance(only, ast.Name) and only.id in _TRAMPOLINE_SAFE


def touched_functions(
    source: str, ranges: list, *, mutated: bool | None = True
) -> list[tuple[str, str | None]]:
    """(name, class) of each top-level function or method a change overlaps.

    ``mutated=True`` keeps only those mutmut mutates, ``False`` only those it
    skips (decorated), ``None`` both.
    """
    out: list[tuple[str, str | None]] = []
    for node in ast.parse(source).body:
        candidates = [(node, None)]
        if isinstance(node, ast.ClassDef):
            candidates = [(child, node.name) for child in node.body]
        for child, cls in candidates:
            if not isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            if mutated is not None and is_mutated(child) is not mutated:
                continue
            first = min([child.lineno, *(d.lineno for d in child.decorator_list)])
            if touches(ranges, first, child.end_lineno or child.lineno):
                out.append((child.name, cls))
    return out


def skipped_note(suite: str, changed: dict, repo: Path = REPO) -> list[str]:
    """Touched functions mutmut cannot mutate, as ``file: name`` strings."""
    directory = suite_dir(suite, repo)
    out = []
    for rel, ranges in sorted(changed_files(changed, suite, repo).items()):
        source = (directory / rel).read_text("utf-8")
        for func, cls in touched_functions(source, ranges, mutated=False):
            out.append(f"{SUITE_DIRS[suite]}/{rel}: {cls + '.' if cls else ''}{func}")
    return out


def mutable_files(suite: str, repo: Path = REPO) -> list[str]:
    """Every suite-relative file mutmut mutates, sorted."""
    directory = suite_dir(suite, repo)
    config = mutmut_config(directory)
    found = []
    for source in config["source_paths"]:
        for path in (directory / source).rglob("*.py"):
            rel = path.relative_to(directory).as_posix()
            if should_mutate(rel, config):
                found.append(rel)
    return sorted(found)


def parse_shard(value: str) -> tuple[int, int]:
    index, _, count = value.partition("/")
    k, n = int(index), int(count)
    if n < 1 or not 1 <= k <= n:
        raise ValueError(f"--shard expects K/N with 1 <= K <= N, got {value!r}")
    return k, n


def shard_files(suite: str, shard: str, repo: Path = REPO) -> list[str]:
    """The files of shard K of N: largest first into the lightest shard, by size."""
    k, n = parse_shard(shard)
    directory = suite_dir(suite, repo)
    load = [0] * n
    mine = []
    files = mutable_files(suite, repo)
    sizes = {rel: (directory / rel).stat().st_size for rel in files}
    for rel in sorted(files, key=lambda r: (-sizes[r], r)):
        lightest = min(range(n), key=lambda i: (load[i], i))
        load[lightest] += sizes[rel]
        if lightest == k - 1:
            mine.append(rel)
    return sorted(mine)


def split_name(name: str) -> tuple[str, str, str | None]:
    """``app.x.xǁCǁm__mutmut_2`` → (``app.x``, ``m``, ``C``)."""
    mangled = name.partition("__mutmut_")[0]
    parts = mangled.split(".")
    for i in range(len(parts) - 1, -1, -1):
        if parts[i].startswith(("x_", "x" + CLASS_SEP)):
            module, key = ".".join(parts[:i]), ".".join(parts[i:])
            break
    else:
        raise ValueError(f"not a mutmut mutant name: {name}")
    if key.startswith("x" + CLASS_SEP):
        cls, _, func = key[2:].partition(CLASS_SEP)
        return module, func, cls
    return module, key[2:], None


def file_for(module: str, directory: Path) -> str:
    """Suite-relative path of the file a module name came from."""
    candidate = module.replace(".", "/") + ".py"
    if (directory / candidate).exists():
        return candidate
    return module.replace(".", "/") + "/__init__.py"


# ── locating a mutant in the source ──────────────────────────────────────────


def function_span(source: str, func: str, cls: str | None) -> tuple[int, int] | None:
    """(first line incl. decorators, last line) of a top-level function or method."""
    tree = ast.parse(source)
    body = tree.body
    if cls is not None:
        owner = next((n for n in body if isinstance(n, ast.ClassDef) and n.name == cls), None)
        if owner is None:
            return None
        body = owner.body
    for node in body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == func:
            first = min([node.lineno, *(d.lineno for d in node.decorator_list)])
            return first, node.end_lineno or node.lineno
    return None


def diff_origin(lines: list[str], first: int) -> int:
    """The source line mutmut's function diff numbers as line 1.

    mutmut prints the function as libcst sees it — comment lines directly above
    it belong to it — then strips leading blank lines.
    """
    indent = len(lines[first - 1]) - len(lines[first - 1].lstrip())
    i = first - 1
    while i > 0:
        above = lines[i - 1]
        stripped = above.strip()
        if stripped == "" or (
            stripped.startswith("#") and len(above) - len(above.lstrip()) <= indent
        ):
            i -= 1
        else:
            break
    while i < first - 1 and lines[i].strip() == "":
        i += 1
    return i + 1


def removed_lines(diff: str) -> list[tuple[int, str]]:
    """(function-relative line, text) of each original line the mutation changes."""
    out: list[tuple[int, str]] = []
    old = None
    pending_insert = False
    for line in diff.splitlines():
        match = _HUNK.match(line)
        if match:
            old = int(match.group(1))
            continue
        if old is None or line.startswith(("---", "+++")):
            continue
        if line.startswith("-"):
            out.append((old, line[1:]))
            old += 1
            pending_insert = False
        elif line.startswith("+"):
            pending_insert = True
        else:
            if pending_insert and not out:
                out.append((max(old - 1, 1), ""))
            pending_insert = False
            old += 1
    return out


def locate(source: str, func: str, cls: str | None, diff: str) -> tuple[list[int], tuple]:
    """Absolute lines a mutant changes, plus its function's span (for the fallback)."""
    span = function_span(source, func, cls)
    if span is None:
        return [], ()
    lines = source.splitlines()
    origin = diff_origin(lines, span[0])
    found: list[int] = []
    for rel, text in removed_lines(diff):
        guess = origin + rel - 1
        if not text.strip():
            found.append(guess)
            continue
        if 0 < guess <= len(lines) and lines[guess - 1].strip() == text.strip():
            found.append(guess)
            continue
        matches = [
            n
            for n in range(max(1, origin - 2), span[1] + 1)
            if lines[n - 1].strip() == text.strip()
        ]
        if matches:
            found.append(min(matches, key=lambda n: abs(n - guess)))
    return found, span


# ── mutmut ───────────────────────────────────────────────────────────────────


def mutmut(
    directory: Path, *args: str, stream: bool = False, budget: float | None = None
) -> subprocess.CompletedProcess:
    if not stream:
        return subprocess.run(
            [*MUTMUT, *args], cwd=directory, capture_output=True, text=True, check=False
        )
    proc = subprocess.Popen(
        [*MUTMUT, *args],
        cwd=directory,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    stopped = threading.Event()

    def stop() -> None:
        # mutmut saves every verdict as it lands and handles Ctrl-C by
        # stopping its workers, so an interrupted run resumes next time.
        stopped.set()
        proc.send_signal(signal.SIGINT)

    timer = threading.Timer(budget * 60, stop) if budget else None
    if timer:
        timer.daemon = True
        timer.start()
    captured = []
    assert proc.stdout is not None
    for line in proc.stdout:
        captured.append(line)
        sys.stdout.write(line)
        sys.stdout.flush()
    code = proc.wait()
    if timer:
        timer.cancel()
    if stopped.is_set():
        print(f"\nTime budget of {budget:g} min reached; the rest resumes on the next run.")
        code = 0
    return subprocess.CompletedProcess(proc.args, code, "".join(captured), "")


def changed_files(changed: dict, suite: str, repo: Path = REPO) -> dict[str, list]:
    """Suite-relative mutable files of a change → their changed line ranges."""
    directory = suite_dir(suite, repo)
    prefix = SUITE_DIRS[suite] + "/"
    config = mutmut_config(directory)
    out = {}
    for path, ranges in changed.items():
        if path.startswith(prefix) and should_mutate(path[len(prefix) :], config):
            out[path[len(prefix) :]] = [tuple(r) for r in ranges]
    return out


def run_patterns(
    suite: str,
    changed: dict | None,
    shard: str | None,
    repo: Path = REPO,
    files: list[str] | None = None,
) -> list[str]:
    directory = suite_dir(suite, repo)
    if files:
        config = mutmut_config(directory)
        unknown = [f for f in files if not should_mutate(f, config)]
        if unknown:
            raise SystemExit(f"not mutable in {suite} (suite-relative paths?): {unknown}")
        return [p for rel in files for p in patterns_for(rel)]
    if changed is not None:
        patterns = []
        for rel, ranges in sorted(changed_files(changed, suite, repo).items()):
            source = (directory / rel).read_text("utf-8")
            patterns += [function_pattern(rel, f, c) for f, c in touched_functions(source, ranges)]
        return patterns
    files = shard_files(suite, shard, repo) if shard else mutable_files(suite, repo)
    return [p for rel in files for p in patterns_for(rel)]


def report_skipped(skipped: list[str]) -> None:
    """Say which touched functions no mutant can reach, in the log and the summary."""
    if not skipped:
        return
    text = [
        "",
        "### Changed functions mutmut does not mutate",
        "",
        "mutmut skips every decorated function (each FastAPI route handler among",
        "them), so the lines below carry no mutation score. Logic that should be",
        "held to one belongs in a plain function the handler calls.",
        "",
        *[f"- `{item}`" for item in skipped],
        "",
    ]
    print("::notice::" + f"{len(skipped)} changed decorated function(s) are not mutated")
    print("\n".join(text))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(text) + "\n")


def generate_only(directory: Path, max_children: int) -> subprocess.CompletedProcess:
    """Bring ``mutants/`` up to date with the source without testing anything."""
    return mutmut(directory, "run", "--max-children", str(max_children), _GENERATE_ONLY)


def unchecked_patterns(directory: Path, files: list[str]) -> list[str]:
    """The mutants of ``files`` that still have no verdict, read from the
    ``.meta`` file mutmut keeps beside each mutated file: one pattern for a
    function none of whose mutants has one (new or changed code), the exact
    names where only some lack one (a budget cut mid-function, a reopened
    survivor), since a pattern would re-test the function's killed mutants
    too. A file with no ``.meta`` has never been generated: all of it."""
    patterns: list[str] = []
    for rel in files:
        meta = directory / "mutants" / f"{rel}.meta"
        if not meta.is_file():
            patterns += patterns_for(rel)
            continue
        verdicts = json.loads(meta.read_text("utf-8")).get("exit_code_by_key", {})
        by_function: dict[str, list[str]] = {}
        unchecked: dict[str, list[str]] = {}
        for name, code in verdicts.items():
            function = name.rpartition("__mutmut_")[0]
            by_function.setdefault(function, []).append(name)
            if code is None:
                unchecked.setdefault(function, []).append(name)
        for function in sorted(unchecked):
            if len(unchecked[function]) == len(by_function[function]):
                patterns.append(f"{function}__mutmut_*")
            else:
                patterns += sorted(unchecked[function])
    return patterns


def tests_digest(directory: Path) -> dict[str, str]:
    """sha256 of every module under the suite's ``tests/``, suite-relative."""
    return {
        path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted((directory / "tests").rglob("*.py"))
    }


def tests_changed_since(directory: Path, commit: str | None) -> set[str] | None:
    """Test modules changed between ``commit`` and HEAD, suite-relative, or
    None when git cannot say. A CI checkout is shallow, so the commit is
    fetched when it is missing."""
    if not commit:
        return None

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["git", *args], cwd=directory, capture_output=True, text=True)

    if git("cat-file", "-e", f"{commit}^{{commit}}").returncode != 0:
        if git("fetch", "--quiet", "--depth=1", "origin", commit).returncode != 0:
            return None
    diff = git("diff", "--name-only", "--relative", commit, "HEAD", "--", "tests")
    if diff.returncode != 0:
        return None
    return {line for line in diff.stdout.splitlines() if line}


def reopen_survivors(directory: Path, files: list[str]) -> int:
    """Reset to unchecked every survived or untested mutant of ``files`` whose
    function a changed test module exercises; return how many.

    Changed means since the digest the previous run left in ``mutants/``. The
    first run has none and asks git what changed since the commit mutmut's
    stats were built at, or, when git cannot say, treats every test module as
    changed. Run it after ``generate_only``: that is when mutmut associates
    the tests that are new with the functions they run.
    """
    mutants = directory / "mutants"
    stats_file = mutants / "mutmut-stats.json"
    if not stats_file.is_file():
        return 0
    stats = json.loads(stats_file.read_text("utf-8"))
    current = tests_digest(directory)
    digest_file = mutants / TESTS_DIGEST
    if digest_file.is_file():
        previous = json.loads(digest_file.read_text("utf-8"))
        changed = {f for f in previous.keys() | current.keys() if previous.get(f) != current.get(f)}
    else:
        changed = tests_changed_since(directory, stats.get("git_commit"))
        if changed is None:
            changed = set(current)
    tests_by_function = stats.get("tests_by_mangled_function_name", {})
    reopened = 0
    for rel in files if changed else []:
        meta = mutants / f"{rel}.meta"
        if not meta.is_file():
            continue
        data = json.loads(meta.read_text("utf-8"))
        verdicts = data.get("exit_code_by_key", {})
        stale = [
            name
            for name, code in verdicts.items()
            if code in _REOPENABLE
            and any(
                test.split("::", 1)[0] in changed
                for test in tests_by_function.get(name.rpartition("__mutmut_")[0], ())
            )
        ]
        if stale:
            for name in stale:
                verdicts[name] = None
            meta.write_text(json.dumps(data), "utf-8")
            reopened += len(stale)
    digest_file.write_text(json.dumps(current, indent=1, sort_keys=True), "utf-8")
    return reopened


def run(
    suite: str,
    changed: dict | None,
    max_children: int,
    repo: Path = REPO,
    shard: str | None = None,
    budget: float | None = None,
    files: list[str] | None = None,
) -> int:
    directory = suite_dir(suite, repo)
    if changed is not None:
        report_skipped(skipped_note(suite, changed, repo))
    patterns = run_patterns(suite, changed, shard, repo, files)
    if not patterns:
        print(f"No {suite} function to mutate in this scope.")
        return 0
    shadow_root.build(SUITE_DIRS[suite], repo)
    if changed is None and not files:
        started = time.monotonic()
        generated = generate_only(directory, max_children)
        # mutmut's assertion lands on stderr when its output is captured
        stopped = _NOTHING_MATCHES in generated.stdout + generated.stderr
        if generated.returncode != 0 and not stopped:
            print(generated.stdout, generated.stderr, sep="\n")
            return generated.returncode
        in_scope = shard_files(suite, shard, repo) if shard else mutable_files(suite, repo)
        reopened = reopen_survivors(directory, in_scope)
        if reopened:
            print(f"{reopened} survivor(s) reopened: a test that runs them changed.")
        patterns = unchecked_patterns(directory, in_scope)
        if not patterns:
            print(f"Every {suite} mutant in this scope has a verdict.")
            return 0
        print(f"{len(patterns)} function(s) or mutant(s) still unchecked.")
        if budget:
            budget = max(budget - (time.monotonic() - started) / 60, 1.0)
    args = ["run", "--max-children", str(max_children), *patterns]
    result = mutmut(directory, *args, stream=True, budget=budget)
    if result.returncode != 0 and _NOTHING_MATCHES in result.stdout:
        print("The functions in scope hold nothing mutmut can mutate.")
        return 0
    return result.returncode


def results(directory: Path) -> dict[str, str]:
    out = mutmut(directory, "results", "--all", "true")
    if out.returncode != 0:
        raise SystemExit(f"mutmut results failed:\n{out.stdout}\n{out.stderr}")
    found = {}
    for line in out.stdout.splitlines():
        match = _RESULT.match(line)
        if match:
            found[match.group(1)] = match.group(2)
    return found


def show(directory: Path, name: str) -> str:
    out = mutmut(directory, "show", name)
    return out.stdout if out.returncode == 0 else ""


def collect(
    suite: str,
    changed: dict | None,
    repo: Path = REPO,
    workers: int = 8,
    shard: str | None = None,
    files: list[str] | None = None,
) -> list[dict]:
    directory = suite_dir(suite, repo)
    prefix = SUITE_DIRS[suite]
    scope = changed_files(changed, suite, repo) if changed is not None else None
    only = set(shard_files(suite, shard, repo)) if shard else None
    if files:
        only = set(files)

    records = []
    for name, raw in sorted(results(directory).items()):
        module, func, cls = split_name(name)
        rel = file_for(module, directory)
        if scope is not None and rel not in scope:
            continue
        if only is not None and rel not in only:
            continue
        records.append(
            {
                "suite": suite,
                "file": f"{prefix}/{rel}",
                "function": f"{cls}.{func}" if cls else func,
                "line": None,
                "status": STATUS.get(raw, "pending"),
                "raw_status": raw,
                "id": name,
            }
        )
    if scope is None:
        return records

    with ThreadPoolExecutor(max_workers=workers) as pool:
        diffs = list(pool.map(lambda r: show(directory, r["id"]), records))
    sources: dict[str, str] = {}
    kept = []
    for record, diff in zip(records, diffs, strict=True):
        rel = record["file"][len(prefix) + 1 :]
        source = sources.setdefault(rel, (directory / rel).read_text("utf-8"))
        _, func, cls = split_name(record["id"])
        found, span = locate(source, func, cls, diff)
        ranges = scope[rel]
        if found:
            if not any(touches(ranges, n) for n in found):
                continue
            record["line"] = min(n for n in found if touches(ranges, n))
        elif not span or not touches(ranges, span[0], span[1]):
            continue
        body = [
            d for d in diff.splitlines() if d.startswith(("-", "+")) and d[:3] not in ("---", "+++")
        ]
        record["description"] = "\n".join(body)
        kept.append(record)
    return kept


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("run", "collect"):
        p = sub.add_parser(command)
        p.add_argument("--suite", required=True, choices=sorted(SUITE_DIRS))
        scope = p.add_mutually_exclusive_group()
        scope.add_argument("--changed", type=Path, help="changed_lines.py output (diff scope)")
        scope.add_argument("--shard", help="K/N: one of N slices of the whole suite")
        scope.add_argument("--files", nargs="+", help="whole files, suite-relative")
        if command == "run":
            p.add_argument("--max-children", type=int, default=4)
            p.add_argument("--budget", type=float, help="stop cleanly after this many minutes")
        else:
            p.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    changed = json.loads(args.changed.read_text()) if args.changed else None
    if args.command == "run":
        return run(
            args.suite,
            changed,
            args.max_children,
            shard=args.shard,
            budget=args.budget,
            files=args.files,
        )
    records = collect(args.suite, changed, shard=args.shard, files=args.files)
    args.output.write_text(json.dumps(records, indent=1) + "\n")
    print(f"{len(records)} mutant record(s) written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
