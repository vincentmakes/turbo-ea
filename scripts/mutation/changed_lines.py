"""The lines a change adds or modifies, per file — what the mutation diff gate scores.

    python scripts/mutation/changed_lines.py --base origin/main -- backend/app
    {"backend/app/services/lifecycle.py": [[12, 14], [40, 40]]}

Compares the merge base of ``--base`` and ``HEAD`` with the WORKING TREE, so the
same command scopes a pull request in CI (clean checkout) and a branch with
uncommitted edits on a laptop (``make mutation-diff``). Only the new side of
each hunk counts: a pure deletion adds no line a test could be asked about,
and a deleted file is skipped. Paths are repository-relative.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")

Ranges = dict[str, list[tuple[int, int]]]


def parse_unified_diff(text: str) -> Ranges:
    """``git diff -U0`` output → ``{path: [(first, last), ...]}`` of new-side lines."""
    ranges: Ranges = {}
    path: str | None = None
    for line in text.splitlines():
        if line.startswith("+++ "):
            target = line[4:].rstrip("\r")
            if target == "/dev/null":
                path = None
            else:
                path = target[2:] if target.startswith("b/") else target
            continue
        if path is None:
            continue
        match = _HUNK.match(line)
        if not match:
            continue
        start = int(match.group(1))
        count = 1 if match.group(2) is None else int(match.group(2))
        if count == 0:
            continue  # pure deletion: nothing new to test
        ranges.setdefault(path, []).append((start, start + count - 1))
    return {p: _merge(r) for p, r in ranges.items()}


def _merge(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def touches(ranges: list[tuple[int, int]], first: int, last: int | None = None) -> bool:
    """True when the line span ``first..last`` intersects any changed range."""
    last = first if last is None else last
    return any(start <= last and first <= end for start, end in ranges)


def changed_lines(base: str, paths: list[str], repo: Path = REPO) -> Ranges:
    merge_base = subprocess.run(
        ["git", "merge-base", base, "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    diff = subprocess.run(
        [
            "git",
            "diff",
            "-U0",
            "--no-color",
            "--no-ext-diff",
            "--diff-filter=AMR",
            merge_base,
            "--",
            *paths,
        ],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return parse_unified_diff(diff)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", required=True, help="branch or commit to compare against")
    parser.add_argument("--output", type=Path, help="write the JSON here instead of stdout")
    parser.add_argument("paths", nargs="*", default=["."], help="limit to these paths")
    args = parser.parse_args(argv)
    result = changed_lines(args.base, args.paths)
    text = json.dumps(result, indent=1, sort_keys=True)
    if args.output:
        args.output.write_text(text + "\n")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
