"""Keep a nightly shard's mutation state from one run to the next, as an artifact.

    python scripts/mutation/nightly_state.py pack --dir .mutation/backend/backend \\
        --output nightly-state.tgz
    python scripts/mutation/nightly_state.py restore --name nightly-state-backend-3 \\
        --into .mutation/backend/backend

A shard's state is what makes the nightly resumable: mutmut's ``mutants/``
directory (every verdict and the test-to-function stats) or Stryker's per-chunk
incremental files and reports. It used to live in an Actions cache, and caches
are evicted least-recently-used once a repository passes 10 GB. The nightly's
are read once a day, so they go first: run 35 (2026-10-15) found none of the
frontend's eight and five of the backend's six, and the frontend restarted a
complete baseline from nothing. An artifact is kept for its retention period
whatever else the repository stores.

``pack`` tars the directory rather than letting ``upload-artifact`` walk it,
because mutmut's state sits in the shadow root (``shadow_root.py``), full of
relative symlinks back into the repository: an artifact follows a link and
would bring the linked directory back as a stale copy, while ``tar`` keeps it a
link, exactly as ``actions/cache`` (also tar) did.

``restore`` takes the newest completed run of the nightly on ``main`` that kept
an artifact of that name: a shard that died before saving, or a run cancelled
early, falls through to the one before it. A pull request's smoke run of the
workflow uploads too, but is never on ``main``, so it is never read back. It
writes ``restored=true|false`` to ``$GITHUB_OUTPUT``; on ``false`` the workflow
falls back to the cache it used to keep.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path

WORKFLOW = "mutation-nightly.yml"
BRANCH = "main"
ARCHIVE = "nightly-state.tgz"
LOOKBACK = 10  # runs; the nightly runs five evenings a week

Runner = Callable[[Sequence[str]], subprocess.CompletedProcess]


def _run(cmd: Sequence[str]) -> subprocess.CompletedProcess:
    return subprocess.run(list(cmd), capture_output=True, text=True)


def pack(directory: Path, output: Path, run: Runner = _run) -> bool:
    """Tar ``directory``'s contents into ``output``, links kept as links.

    False, with a warning, when there is no state yet: a shard whose setup
    failed before its first mutant has nothing to keep, and its job is red
    already; the upload that follows then finds no file and says so.
    """
    if not directory.is_dir():
        print(f"::warning::no state to keep: {directory} is not a directory")
        return False
    result = run(["tar", "-czf", str(output), "-C", str(directory), "."])
    if result.returncode != 0:
        raise SystemExit(f"tar failed: {result.stderr.strip()}")
    return True


def recent_runs(lookback: int, run: Runner = _run) -> list[str]:
    """The newest completed nightly runs on ``main``, newest first."""
    result = run(
        [
            "gh",
            "run",
            "list",
            "--workflow",
            WORKFLOW,
            "--branch",
            BRANCH,
            "--status",
            "completed",
            "--limit",
            str(lookback),
            "--json",
            "databaseId",
        ]
    )
    if result.returncode != 0:
        print(f"::warning::cannot list the nightly's runs: {result.stderr.strip()}")
        return []
    return [str(r["databaseId"]) for r in json.loads(result.stdout or "[]")]


def restore(
    name: str,
    into: Path,
    lookback: int = LOOKBACK,
    run: Runner = _run,
    workdir: Path | None = None,
) -> str | None:
    """Unpack the newest kept ``name`` into ``into``; the run id it came from, or None."""
    with tempfile.TemporaryDirectory(dir=workdir) as tmp:
        for run_id in recent_runs(lookback, run):
            target = Path(tmp) / run_id
            fetched = run(["gh", "run", "download", run_id, "--name", name, "--dir", str(target)])
            archive = target / ARCHIVE
            if fetched.returncode != 0 or not archive.is_file():
                continue
            into.mkdir(parents=True, exist_ok=True)
            unpacked = run(["tar", "-xzf", str(archive), "-C", str(into)])
            if unpacked.returncode != 0:
                print(f"::warning::run {run_id}'s {name} would not unpack: {unpacked.stderr}")
                continue
            return run_id
    return None


def _output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as fh:
            fh.write(f"{key}={value}\n")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("pack", help="tar a shard's state directory")
    p.add_argument("--dir", type=Path, required=True)
    p.add_argument("--output", type=Path, default=Path(ARCHIVE))
    r = sub.add_parser("restore", help="unpack the newest kept state of a shard")
    r.add_argument("--name", required=True, help="the artifact's name")
    r.add_argument("--into", type=Path, required=True)
    r.add_argument("--lookback", type=int, default=LOOKBACK)
    args = parser.parse_args(argv)

    if args.command == "pack":
        pack(args.dir, args.output)
        return 0
    run_id = restore(args.name, args.into, args.lookback)
    if run_id is None:
        print(f"No completed run within the last {args.lookback} kept {args.name}.")
        _output("restored", "false")
    else:
        print(f"Restored {args.name} from run {run_id}.")
        _output("restored", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())
