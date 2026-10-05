"""Scope StrykerJS to a change, and turn its JSON report into gate records.

    python scripts/mutation/stryker_scope.py args --changed changed.json
    src/lib/a.ts:10-14,src/lib/b.ts:3-3
    python scripts/mutation/stryker_scope.py shard --shard 3/8
    src/features/a.tsx,src/lib/b.ts,...
    python scripts/mutation/stryker_scope.py collect \\
        --report frontend/reports/mutation/mutation.json --changed changed.json \\
        --output records.json

``args`` prints the value for ``stryker run --mutate``: one ``file:first-last``
entry per changed range of every file the config's ``mutate`` globs select
(so a test file or a generated one is never mutated because a PR touched it),
and nothing when no such file changed. Stryker's ``--mutate`` replaces the
config's list entirely, which is what scopes the run to those lines.

``shard`` prints the same kind of value for slice K of N of everything the
config selects, dealt largest-first by size like the backend's test shards, so
the nightly can spread the whole frontend over N runners.

``collect`` reads the report (mutation-testing-report-schema) and writes the
records ``gate.py`` scores; with ``--changed`` it keeps only mutants whose
location overlaps a changed line, so a mutant the incremental file carried
over from elsewhere in the file never counts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from changed_lines import touches  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
FRONTEND = REPO / "frontend"
CONFIG = FRONTEND / "stryker.config.json"

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
    """Every frontend-relative file the config's ``mutate`` globs select, sorted."""
    selected = selector(config_path)
    found = []
    for path in (frontend / "src").rglob("*"):
        if path.suffix in (".ts", ".tsx") and path.is_file():
            rel = path.relative_to(frontend).as_posix()
            if selected(rel):
                found.append(rel)
    return sorted(found)


def shard_files(shard: str, frontend: Path = FRONTEND, config_path: Path = CONFIG) -> list[str]:
    index, _, count = shard.partition("/")
    k, n = int(index), int(count)
    if n < 1 or not 1 <= k <= n:
        raise ValueError(f"--shard expects K/N with 1 <= K <= N, got {shard!r}")
    files = mutable_files(frontend, config_path)
    sizes = {rel: (frontend / rel).stat().st_size for rel in files}
    load = [0] * n
    mine = []
    for rel in sorted(files, key=lambda r: (-sizes[r], r)):
        lightest = min(range(n), key=lambda i: (load[i], i))
        load[lightest] += sizes[rel]
        if lightest == k - 1:
            mine.append(rel)
    return sorted(mine)


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
    c = sub.add_parser("collect")
    c.add_argument("--report", type=Path, required=True)
    c.add_argument("--changed", type=Path)
    c.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "shard":
        print(",".join(shard_files(args.shard)))
        return 0
    changed = json.loads(args.changed.read_text()) if args.changed else None
    if args.command == "args":
        print(mutate_arg(changed))
        return 0
    if not args.report.exists():
        print(f"::error::no Stryker report at {args.report}")
        return 2
    records = collect(json.loads(args.report.read_text("utf-8")), changed)
    args.output.write_text(json.dumps(records, indent=1) + "\n")
    print(f"{len(records)} mutant record(s) written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
