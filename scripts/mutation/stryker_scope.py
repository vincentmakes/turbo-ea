"""Scope StrykerJS to a change, and turn its JSON report into gate records.

    python scripts/mutation/stryker_scope.py args --changed changed.json
    src/lib/a.ts:10-14,src/lib/b.ts:3-3
    python scripts/mutation/stryker_scope.py shard --shard 3/8
    src/features/a.tsx,src/lib/b.ts,...
    python scripts/mutation/stryker_scope.py nightly --shard 3/8 --budget 280 \\
        --state frontend/reports/nightly
    python scripts/mutation/stryker_scope.py collect \\
        --report frontend/reports/mutation/mutation.json --changed changed.json \\
        --output records.json
    python scripts/mutation/stryker_scope.py collect --state frontend/reports/nightly \\
        --shard 3/8 --output records.json

``args`` prints the value for ``stryker run --mutate``: one ``file:first-last``
entry per changed range of every file the config's ``mutate`` globs select
(so a test file or a generated one is never mutated because a PR touched it),
and nothing when no such file changed. Stryker's ``--mutate`` replaces the
config's list entirely, which is what scopes the run to those lines.

``shard`` prints the same kind of value for slice K of N of everything the
config selects, so the nightly can spread the whole frontend over N runners.

The deal is by a hash of the path, never by size: a file belongs to one of
``N * CHUNKS`` global chunks, ``crc32(path) % (N * CHUNKS)``, and global chunk
``g`` is chunk ``g // N`` of shard ``g % N + 1``. A file therefore keeps its
shard and its chunk for as long as its path and the shard count do, whatever
happens to the size of any other file. The size-balanced deal this replaced
re-dealt most files every night (436 of 528 between two runs), and since each
shard caches its own state, a file that moved was scored from whatever report
its new shard happened to hold, weeks old or from before its tests existed.

``nightly`` makes a shard RESUMABLE, which Stryker alone is not: it writes
its incremental file only when a whole run completes, so a cold shard that
overran its budget would lose every result, every night. The shard's files are
split into ``CHUNKS`` stable chunks (above), each with its own incremental
file and last report in the cached ``--state`` directory. Chunks run
oldest-report-first until the budget is spent; a chunk cut off by the budget
keeps its previous report. A chunk whose last report was made from the same
inputs (``inputs_digest``: every file under ``src/`` plus the lockfile and the
Stryker/Vitest/TypeScript configs) is skipped: Stryker pays a full dry run per
chunk even when it reuses every result, which on a quiet night was hours per
shard spent re-running nothing, and the second half of the budget walked every
chunk the first half had just finished.

``collect`` reads a report (mutation-testing-report-schema) and writes the
records ``gate.py`` scores; with ``--changed`` it keeps only mutants whose
location overlaps a changed line, so a mutant the incremental file carried
over from elsewhere in the file never counts. With ``--state`` it merges the
chunk reports of a shard and adds a ``pending`` record for every shard file no
chunk has measured yet, so the gate shows the baseline's progress. A chunk's
report is read only for the files that chunk holds now: Stryker's incremental
mode copies every mutant of a file that has left the run into the new report
("so they aren't forgotten"), and without the filter those stale verdicts
would score a file the chunk never tested.

A chunk whose Stryker run fails is failed by a test that failed on UNMUTATED
code in Stryker's initial run (or, rarely, by Stryker itself). ``nightly``
reads the names off Stryker's output, prints one ``::error::`` per test, says
so on the chunk's status line and, with ``--harness FILE``, appends the entries
for the report job (``harness.py``); the run still exits 1.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402
from changed_lines import touches  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
FRONTEND = REPO / "frontend"
CONFIG = FRONTEND / "stryker.config.json"
REPORT = Path("reports") / "mutation" / "mutation.json"  # relative to the frontend
STRYKER = ["npx", "stryker", "run"]  # the command; a test swaps in a stand-in
CHUNKS = 16  # per shard: ~4 files each at today's size, small enough to finish
MIN_CHUNK_SECONDS = 60  # never start a chunk with less time than this left
# Lines of a chunk's output kept for reading its failure; Stryker exits right
# after naming the tests its initial run failed on, so a short tail holds them.
TAIL_LINES = 5000
# What a chunk's verdicts depend on besides src/ (relative to the frontend).
DIGEST_FILES = (
    "package-lock.json",
    "stryker.config.json",
    "vitest.config.ts",
    "vitest.stryker.config.ts",
)

STATUS = {
    "Killed": "killed",
    "Timeout": "killed",
    "Survived": "survived",
    "NoCoverage": "survived",
    "CompileError": "excluded",
    "RuntimeError": "excluded",
    "Ignored": "excluded",
    "Pending": "pending",
}


def glob_to_regex(glob: str) -> re.Pattern[str]:
    """The subset of glob Stryker's ``mutate`` list uses: ``**``, ``*``, ``?``, ``{a,b}``."""
    out, i = [], 0
    while i < len(glob):
        c = glob[i]
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
            continue
        if glob.startswith("**", i):
            out.append(".*")
            i += 2
            continue
        if c == "*":
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "{":
            end = glob.index("}", i)
            out.append("(?:" + "|".join(re.escape(a) for a in glob[i + 1 : end].split(",")) + ")")
            i = end
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("^" + "".join(out) + "$")


def selector(config_path: Path = CONFIG):
    """``path -> bool`` for a frontend-relative path, per the config's ``mutate`` list."""
    patterns = json.loads(config_path.read_text("utf-8"))["mutate"]
    include = [glob_to_regex(p) for p in patterns if not p.startswith("!")]
    exclude = [glob_to_regex(p[1:]) for p in patterns if p.startswith("!")]

    def selected(path: str) -> bool:
        return any(r.match(path) for r in include) and not any(r.match(path) for r in exclude)

    return selected


def frontend_changes(changed: dict, config_path: Path = CONFIG) -> dict[str, list]:
    """Frontend-relative mutable files of a change → their changed line ranges."""
    selected = selector(config_path)
    out = {}
    for path, ranges in changed.items():
        if path.startswith("frontend/") and selected(path[len("frontend/") :]):
            out[path[len("frontend/") :]] = [tuple(r) for r in ranges]
    return out


_UNSAFE = re.compile(r"[,\x00-\x1f\x7f]")


def mutate_arg(changed: dict, config_path: Path = CONFIG) -> str:
    files = frontend_changes(changed, config_path)
    # A comma would split Stryker's list and a control character could forge
    # extra lines wherever the value is written; no source file needs either.
    unsafe = sorted(p for p in files if _UNSAFE.search(p))
    if unsafe:
        raise SystemExit(f"refusing to mutate files with unsafe names: {unsafe!r}")
    return ",".join(
        f"{path}:{start}-{end}" for path, ranges in sorted(files.items()) for start, end in ranges
    )


def mutable_files(frontend: Path = FRONTEND, config_path: Path = CONFIG) -> list[str]:
    """Every frontend-relative file the config's ``mutate`` globs select, sorted.

    Walks ``src/`` (the app) and ``scripts/`` (the coverage tooling CI gates
    on) — the two directories the ``mutate`` list names — never the frontend
    root, which would mean node_modules.
    """
    selected = selector(config_path)
    found = []
    for subdir in ("src", "scripts"):
        root = frontend / subdir
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.suffix in (".ts", ".tsx", ".mjs") and path.is_file():
                rel = path.relative_to(frontend).as_posix()
                if selected(rel):
                    found.append(rel)
    return sorted(found)


def parse_shard(shard: str) -> tuple[int, int]:
    index, _, count = shard.partition("/")
    k, n = int(index), int(count)
    if n < 1 or not 1 <= k <= n:
        raise ValueError(f"--shard expects K/N with 1 <= K <= N, got {shard!r}")
    return k, n


def _global_chunk(path: str, shards: int, chunks: int | None) -> int:
    return zlib.crc32(path.encode("utf-8")) % (shards * (chunks or CHUNKS))


def shard_of(path: str, shards: int, chunks: int | None = None) -> int:
    """The shard (1-based) a file belongs to; it depends on nothing but its path."""
    return _global_chunk(path, shards, chunks) % shards + 1


def chunk_of(path: str, chunks: int | None = None, shards: int = 1) -> int:
    """The file's chunk inside its shard; with one shard, ``crc32 % chunks``."""
    return _global_chunk(path, shards, chunks) // shards


def shard_files(shard: str, frontend: Path = FRONTEND, config_path: Path = CONFIG) -> list[str]:
    k, n = parse_shard(shard)
    return [rel for rel in mutable_files(frontend, config_path) if shard_of(rel, n) == k]


def shard_chunks(
    shard: str, frontend: Path = FRONTEND, config_path: Path = CONFIG
) -> dict[int, list[str]]:
    """A shard's files grouped by chunk, each list sorted."""
    _, n = parse_shard(shard)
    groups: dict[int, list[str]] = {}
    for rel in shard_files(shard, frontend, config_path):
        groups.setdefault(chunk_of(rel, shards=n), []).append(rel)
    return groups


def shard_index(shard: str) -> str:
    return shard.partition("/")[0]


def _report_path(state: Path, shard: str, chunk: int) -> Path:
    return state / f"chunk-{shard_index(shard)}-{chunk}.mutation.json"


def _inputs_path(state: Path, shard: str, chunk: int) -> Path:
    return state / f"chunk-{shard_index(shard)}-{chunk}.inputs"


def inputs_digest(frontend: Path = FRONTEND) -> str:
    """One hash of everything a chunk's verdicts can depend on.

    The whole of ``src/``, not just the chunk's files and the tests: a mutated
    file's tests also run every module it imports, and Stryker's own
    incremental diff, which only compares mutated and test files, would carry
    a verdict across a change to one of those.
    """
    paths = [p for p in (frontend / "src").rglob("*") if p.is_file()]
    paths += frontend.glob("tsconfig*.json")
    paths += [frontend / name for name in DIGEST_FILES if (frontend / name).is_file()]
    digest = hashlib.sha256()
    for rel, path in sorted((p.relative_to(frontend).as_posix(), p) for p in paths):
        digest.update(rel.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def _run_chunk(
    files: list[str], incremental: Path, timeout: float, frontend: Path
) -> tuple[str, str]:
    """Run Stryker on one chunk: (``done`` | ``failed`` | ``budget``, its output's tail).

    The output is streamed through to stdout as before; the tail is kept so a
    failed chunk can be read for the tests its initial run failed on
    (``harness.stryker_dry_run_failures``), which Stryker logs right before it
    exits.
    """
    (frontend / REPORT).unlink(missing_ok=True)
    cmd = [
        *STRYKER,
        "--mutate",
        ",".join(files),
        "--incremental",
        "--incrementalFile",
        str(incremental),
        "--allowConsoleColors",
        "false",
    ]
    # Its own process group, so the budget stops Stryker's workers too.
    proc = subprocess.Popen(
        cmd,
        cwd=frontend,
        start_new_session=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
    )
    tail: collections.deque[str] = collections.deque(maxlen=TAIL_LINES)

    def relay() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            tail.append(line)
            sys.stdout.write(line)
            sys.stdout.flush()

    reader = threading.Thread(target=relay, daemon=True)
    reader.start()
    try:
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        reader.join(timeout=30)
        return "budget", "".join(tail)
    reader.join(timeout=30)
    status = "done" if code == 0 and (frontend / REPORT).exists() else "failed"
    return status, "".join(tail)


def _failed_status(found: list[dict]) -> str:
    """The status line's detail for a failed chunk, from what its output said."""
    tests = [f["test"] for f in found if f["kind"] == "test"]
    if tests:
        return "failed — initial test run: " + "; ".join(tests)
    if any(f["kind"] == "timeout" for f in found):
        return "failed — initial test run timed out"
    if found:
        return "failed — initial test run error: " + (found[0]["message"].splitlines() or [""])[0]
    return "failed"


def nightly(
    shard: str,
    budget: float,
    state: Path,
    frontend: Path = FRONTEND,
    config_path: Path = CONFIG,
    max_chunks: int | None = None,
    clock=time.monotonic,
    harness_path: Path | None = None,
) -> int:
    """Advance a shard's baseline by as many chunks as the budget allows.

    A chunk whose Stryker run fails is named for what failed it: the tests of
    its initial run, each as a ``::error::`` annotation, and, with
    ``harness_path``, as entries appended to that file for the report job.
    """
    state.mkdir(parents=True, exist_ok=True)
    groups = shard_chunks(shard, frontend, config_path)

    def last_report(chunk: int) -> float:
        path = _report_path(state, shard, chunk)
        return path.stat().st_mtime if path.exists() else 0.0

    order = sorted(groups, key=lambda c: (last_report(c), c))
    if max_chunks is not None:
        order = order[:max_chunks]
    deadline = clock() + budget * 60
    inputs = inputs_digest(frontend)
    failed = []
    for chunk in order:
        recorded = _inputs_path(state, shard, chunk)
        if (
            _report_path(state, shard, chunk).exists()
            and recorded.exists()
            and recorded.read_text() == inputs
        ):
            print(f"chunk {chunk} ({len(groups[chunk])} files): unchanged")
            continue
        remaining = deadline - clock()
        if remaining < MIN_CHUNK_SECONDS:
            print(f"Budget spent; {len(order) - order.index(chunk)} chunk(s) wait for next run.")
            break
        incremental = state / f"chunk-{shard_index(shard)}-{chunk}.incremental.json"
        outcome, output = _run_chunk(groups[chunk], incremental.resolve(), remaining, frontend)
        if outcome == "failed":
            found = harness.stryker_dry_run_failures(output)
            print(f"chunk {chunk} ({len(groups[chunk])} files): {_failed_status(found)}")
            if not found:
                found = [
                    {
                        "kind": "unknown",
                        "test": "",
                        "message": "Stryker exited without an initial-test-run block; "
                        "see the step log",
                    }
                ]
            entries = [
                harness.entry(
                    "frontend", shard, chunk, f["kind"], f["test"], f["message"], groups[chunk]
                )
                for f in found
            ]
            for e in entries:
                harness.annotate(e, "Stryker's initial test run")
            if harness_path is not None:
                harness.append(harness_path, entries)
            failed.append(chunk)
            continue
        print(f"chunk {chunk} ({len(groups[chunk])} files): {outcome}")
        if outcome == "done":
            shutil.copyfile(frontend / REPORT, _report_path(state, shard, chunk))
            recorded.write_text(inputs)
        else:
            print("Budget spent mid-chunk; it keeps its previous report.")
            if remaining >= budget * 60 * 0.9:
                # It had (nearly) the whole night and still did not finish, so
                # it never will: the chunk count needs raising.
                print(
                    f"::warning::chunk {chunk} of shard {shard} cannot finish within one "
                    "budget; raise CHUNKS in scripts/mutation/stryker_scope.py"
                )
            break
    if failed:
        print(f"::error::Stryker failed on chunk(s) {failed} of shard {shard}")
        return 1
    return 0


def _relative(name: str, frontend: Path) -> str:
    path = Path(name)
    return path.relative_to(frontend).as_posix() if path.is_absolute() else path.as_posix()


def merged_report(
    state: Path, shard: str, frontend: Path = FRONTEND, config_path: Path = CONFIG
) -> dict:
    """The newest result for every file of a shard, each from the chunk that holds it.

    A chunk's report speaks only for the files the chunk holds now. Stryker's
    incremental mode carries the old mutants of a file that left the run into
    the new report, so the same file can appear in the report of a chunk that
    never tested it; those entries are dropped here.
    """
    members = {c: set(files) for c, files in shard_chunks(shard, frontend, config_path).items()}
    prefix = f"chunk-{shard_index(shard)}-"
    files: dict = {}
    paths = sorted(state.glob(f"{prefix}*.mutation.json"), key=lambda p: p.stat().st_mtime)
    for path in paths:  # oldest first, so a newer report of a file wins
        chunk = int(path.name[len(prefix) : -len(".mutation.json")])
        own = members.get(chunk, set())
        for name, entry in json.loads(path.read_text("utf-8")).get("files", {}).items():
            if _relative(name, frontend) in own:
                files[name] = entry
    return {"files": files}


def collect_state(
    state: Path, shard: str, frontend: Path = FRONTEND, config_path: Path = CONFIG
) -> list[dict]:
    mine = shard_files(shard, frontend, config_path)
    report = merged_report(state, shard, frontend, config_path)
    records = collect(report, None, frontend)
    measured = {r["file"] for r in records}
    for rel in mine:
        if f"frontend/{rel}" not in measured and rel not in report["files"]:
            records.append(
                {
                    "suite": "frontend",
                    "file": f"frontend/{rel}",
                    "function": None,
                    "line": None,
                    "status": "pending",
                    "raw_status": "not measured yet (whole file)",
                    "id": rel,
                }
            )
    return records


def collect(report: dict, changed: dict | None, frontend: Path = FRONTEND) -> list[dict]:
    scope = None
    if changed is not None:
        scope = {
            p[len("frontend/") :]: [tuple(r) for r in rs]
            for p, rs in changed.items()
            if p.startswith("frontend/")
        }
    records = []
    for name, entry in sorted(report.get("files", {}).items()):
        path = Path(name)
        rel = path.relative_to(frontend).as_posix() if path.is_absolute() else path.as_posix()
        if scope is not None and rel not in scope:
            continue
        source_lines = entry.get("source", "").splitlines()
        for mutant in entry.get("mutants", []):
            start = mutant["location"]["start"]["line"]
            end = mutant["location"]["end"]["line"]
            if scope is not None and not touches(scope[rel], start, end):
                continue
            original = source_lines[start - 1].strip() if 0 < start <= len(source_lines) else ""
            records.append(
                {
                    "suite": "frontend",
                    "file": f"frontend/{rel}",
                    "function": None,
                    "line": start,
                    "status": STATUS.get(mutant["status"], "pending"),
                    "raw_status": mutant["status"],
                    "id": f"{mutant.get('mutatorName', '?')}#{mutant['id']}",
                    "description": f"- {original}\n+ {mutant.get('replacement', '')}".rstrip(),
                }
            )
    return records


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    a = sub.add_parser("args")
    a.add_argument("--changed", type=Path, required=True)
    sh = sub.add_parser("shard")
    sh.add_argument("--shard", required=True, help="K/N")
    n = sub.add_parser("nightly")
    n.add_argument("--shard", required=True, help="K/N")
    n.add_argument("--budget", type=float, required=True, help="minutes")
    n.add_argument("--state", type=Path, required=True, help="the cached chunk directory")
    n.add_argument("--max-chunks", type=int, help="run at most this many chunks")
    n.add_argument(
        "--harness", type=Path, help="append the tests a chunk's initial run failed on here"
    )
    c = sub.add_parser("collect")
    source = c.add_mutually_exclusive_group(required=True)
    source.add_argument("--report", type=Path, help="one Stryker JSON report")
    source.add_argument("--state", type=Path, help="a nightly chunk directory (with --shard)")
    c.add_argument("--shard", help="K/N, with --state")
    c.add_argument("--changed", type=Path)
    c.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "shard":
        print(",".join(shard_files(args.shard)))
        return 0
    if args.command == "nightly":
        return nightly(
            args.shard,
            args.budget,
            args.state,
            max_chunks=args.max_chunks,
            harness_path=args.harness,
        )
    changed = json.loads(args.changed.read_text()) if args.changed else None
    if args.command == "args":
        print(mutate_arg(changed))
        return 0
    if args.state:
        if not args.shard:
            parser.error("--state needs --shard")
        records = collect_state(args.state, args.shard)
    else:
        if not args.report.exists():
            print(f"::error::no Stryker report at {args.report}")
            return 2
        records = collect(json.loads(args.report.read_text("utf-8")), changed)
    args.output.write_text(json.dumps(records, indent=1) + "\n")
    print(f"{len(records)} mutant record(s) written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
