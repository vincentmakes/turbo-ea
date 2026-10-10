"""Name the tests that fail on UNMUTATED code under the mutation harness.

    python scripts/mutation/harness.py report --dir harness \\
        --summary "$GITHUB_STEP_SUMMARY" --output harness.md

Stryker's initial ("dry") test run of a frontend chunk and mutmut's "clean
test" of a backend shard run the suite with no mutant applied; a test that
fails there has a race the slower, instrumented run exposed, and the chunk (or
half of the shard's night) measures nothing past it. Every red nightly of
October 2026 was one of these, and the test's name sat thousands of lines deep
in Stryker's output, past the 5,000 lines the Actions log API returns.

``stryker_scope.py nightly --harness`` and ``mutmut_scope.py run --harness``
parse their tool's output through the two parsers here, print one GitHub
``::error::`` annotation per failing test (``annotate``) and append the entries
to a ``mutation-harness-<suite>-<shard>.json`` file (``append``) that the
shard uploads beside its records. Both halves of a night append to the same
file, so a chunk that fails twice is listed twice: that is the difference
between a one-off and a deterministic failure. The report job's ``report``
renders every such file into one section at the top of the step summary and of
the "Mutation survivors (nightly)" issue; it never fails the run (the shard job
already did) and it never goes through ``gate.py``, whose records schema is a
mutant's verdict and nothing else.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

KINDS = ("test", "error", "timeout", "unknown")
# Stryker colours its log prefix whenever `allowConsoleColors` is on, piped
# or not; the parser strips it rather than relying on the flag.
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
# A Stryker log line: `21:14:03 (1234) ERROR DryRunExecutor <message>`.
_STRYKER_LOG = re.compile(
    r"^\d{2}:\d{2}:\d{2} \(\d+\) (?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL) \S+ ?(.*)$"
)
# pytest's short summary under CI=true: `FAILED <nodeid> - <message>`, the
# message untrimmed; a parametrized id may carry spaces inside its brackets.
_PYTEST_SUMMARY = re.compile(
    r"^(?P<word>FAILED|ERROR) (?P<node>\S+?(?:\[.*\])?)(?: - (?P<msg>.*))?$"
)
# Stryker 10, process/3-dry-run-executor.js
FAILED_TESTS = "One or more tests failed in the initial test run:"
ERRORED_TESTS = "One or more tests resulted in an error:"
TIMED_OUT = "Initial test run timed out!"

RULE = (
    "Each one passed in CI and failed with no mutant applied, so it is a race the slower, "
    "instrumented run exposed, and the shard measured nothing past it (a frontend chunk; "
    "half of a backend night). Fix the race the same day: in the product if it remounts, in "
    "the test if it reads too early. Never retry, raise a timeout or exclude the test "
    '(`scripts/mutation/README.md`, "A test that fails only in Stryker\'s initial run").'
)


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text)


def stryker_dry_run_failures(output: str) -> list[dict]:
    """``{kind, test, message}`` per failing test of Stryker's initial run.

    The block is one log write: the ``FAILED_TESTS`` line, then ``\\t<test>``
    and ``\\t\\t<message>`` pairs; an untabbed line continues the message, and
    the next log line ends the block.
    """
    found: list[dict] = []
    lines = strip_ansi(output).splitlines()
    i = 0
    while i < len(lines):
        match = _STRYKER_LOG.match(lines[i])
        i += 1
        if not match:
            continue
        message = match.group(1).strip()
        if message == TIMED_OUT:
            found.append({"kind": "timeout", "test": "", "message": TIMED_OUT})
            continue
        if message not in (FAILED_TESTS, ERRORED_TESTS):
            continue
        kind = "test" if message == FAILED_TESTS else "error"
        current: dict | None = None
        while i < len(lines) and not _STRYKER_LOG.match(lines[i]):
            line = lines[i]
            i += 1
            if line.startswith("\t\t"):
                if current is not None:
                    current["message"] = line[2:]
            elif line.startswith("\t"):
                current = {"kind": kind, "test": line[1:] if kind == "test" else "", "message": ""}
                if kind == "error":
                    current["message"] = line[1:]
                found.append(current)
            elif current is not None:
                current["message"] = f"{current['message']}\n{line}".strip("\n")
    return found


def pytest_failures(output: str) -> list[dict]:
    """``{kind, test, message}`` per distinct FAILED / ERROR short-summary line."""
    found: dict[tuple[str, str], dict] = {}
    for line in strip_ansi(output).splitlines():
        match = _PYTEST_SUMMARY.match(line.rstrip())
        if not match:
            continue
        key = (match.group("word"), match.group("node"))
        if key in found:
            continue
        found[key] = {
            "kind": "test" if match.group("word") == "FAILED" else "error",
            "test": match.group("node"),
            "message": match.group("msg") or "",
        }
    return list(found.values())


def entry(
    suite: str,
    shard: str | None,
    chunk: int | None,
    kind: str,
    test: str,
    message: str,
    files: Iterable[str] = (),
) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown harness failure kind {kind!r}")
    return {
        "suite": suite,
        "shard": shard,
        "chunk": chunk,
        "kind": kind,
        "test": test,
        "message": message,
        "files": list(files),
        "at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _where(e: dict) -> str:
    where = e["suite"]
    if e.get("shard"):
        where += f" shard {e['shard']}"
    if e.get("chunk") is not None:
        where += f" chunk {e['chunk']}"
    return where


def _label(e: dict) -> str:
    if e["kind"] == "test":
        return e["test"]
    if e["kind"] == "timeout":
        return "(initial test run timed out)"
    if e["kind"] == "error":
        return e["test"] or "(initial test run error)"
    return "(no initial-test-run block; see the step log)"


def annotate(e: dict, phrase: str) -> None:
    """One ``::error::`` line per failure, as GitHub's workflow commands need it."""
    first = e["message"].splitlines()[0] if e["message"] else ""
    text = f"{_where(e)}: failed on unmutated code in {phrase}: {_label(e)}"
    if first:
        text += f" — {first}"
    text = text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error::{text}")


def append(path: Path, entries: list[dict]) -> None:
    if not entries:
        return
    existing = json.loads(path.read_text("utf-8")) if path.exists() else []
    path.write_text(json.dumps([*existing, *entries], indent=1) + "\n")


def load(paths: Iterable[Path]) -> list[dict]:
    entries = []
    for path in sorted(paths):
        for e in json.loads(path.read_text("utf-8")):
            if e.get("kind") not in KINDS:
                raise ValueError(f"{path}: unknown harness failure kind {e.get('kind')!r}")
            entries.append(e)
    return entries


def _cell(text: str) -> str:
    first = text.splitlines()[0] if text else ""
    if len(first) > 200:
        first = first[:197] + "…"
    return first.replace("|", "\\|")


def render(entries: list[dict]) -> list[str]:
    """The Markdown section; empty when nothing failed."""
    if not entries:
        return []
    seen = Counter(
        (e["suite"], e.get("shard"), e.get("chunk"), e["kind"], e["test"]) for e in entries
    )
    rows = []
    for key in sorted(seen, key=lambda k: (k[0], str(k[1]), -1 if k[2] is None else k[2], k[4])):
        e = next(
            x
            for x in entries
            if (x["suite"], x.get("shard"), x.get("chunk"), x["kind"], x["test"]) == key
        )
        message = _cell(e["message"])
        if e.get("files"):
            message = f"{message} (reproduce: `make mutation-frontend FILE={e['files'][0]}`)"
        rows.append(
            f"| {e['suite']} | {e.get('shard') or '–'} | "
            f"{'–' if e.get('chunk') is None else e['chunk']} | `{_cell(_label(e))}` | "
            f"{message} | {seen[key]}× |"
        )
    return [
        "## Tests that failed on unmutated code under the harness",
        "",
        f"{len(seen)} test(s) failed in Stryker's initial test run or mutmut's clean test. {RULE}",
        "",
        "| Suite | Shard | Chunk | Test | Message | Seen |",
        "|---|---|---|---|---|---|",
        *rows,
        "",
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("report")
    r.add_argument(
        "--dir", type=Path, required=True, help="where the shards' files were downloaded"
    )
    r.add_argument("--summary", type=Path, help="append the section here (the step summary)")
    r.add_argument("--output", type=Path, help="written only when at least one test failed")
    args = parser.parse_args(argv)
    try:
        entries = load(args.dir.glob("mutation-harness-*.json")) if args.dir.is_dir() else []
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"::error::cannot read the harness failures: {exc}")
        return 2
    section = render(entries)
    if not section:
        print("No test failed on unmutated code under the harness.")
        return 0
    text = "\n".join(section)
    print(text)
    if args.summary:
        with args.summary.open("a") as fh:
            fh.write(text + "\n")
    if args.output:
        args.output.write_text(text + "\n")
    print(
        f"::warning::{len(entries)} test failure(s) on unmutated code under the harness; "
        "see the summary"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
