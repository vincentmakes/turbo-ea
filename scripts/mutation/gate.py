"""Score mutation results and judge them against ``floors.toml``.

    python scripts/mutation/gate.py --suite backend --scope diff --records scoped.json

The ONE place a mutation score is computed, for all three suites. The
tool-specific collectors (``mutmut_scope.py collect``, ``stryker_scope.py
collect``) turn their tool's results into the same records, so mutmut and
StrykerJS are judged by the same arithmetic::

    {"suite": "backend", "file": "backend/app/x.py", "function": "f",
     "line": 12, "status": "survived", "raw_status": "no tests",
     "id": "app.x.x_f__mutmut_3", "description": "- a < b\\n+ a <= b"}

``status`` is one of ``killed`` (a test failed, or timed out, on the mutant),
``survived`` (no test noticed — including a mutant NO test even reaches, which
is the worst finding, not an exemption), ``excluded`` (the tool could not run
it: skipped, compile/runtime error) and ``pending`` (the run did not finish).
Score = killed / (killed + survived). A pending mutant fails the gate outright:
a partial run is not a score.

Scopes:
  diff    mutants on lines the PR added or changed; fails under ``[diff]``,
          but only with at least ``min_mutants`` of them — below that a
          percentage is noise, so it warns and the PR's Test Plan answers for
          each survivor instead.
  suite   the whole suite (the nightly); fails under ``[suite]`` or under any
          ``[modules]`` floor for a file of this suite. With ``--allow-pending``
          (the nightly, which builds the baseline over several time-boxed runs)
          an untested mutant is progress rather than an error: it is left out
          of the score, and a floor applies only once everything it covers
          has been measured.

Exit 0 pass, 1 below a floor, 2 incomplete or unusable input.
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_FLOORS = HERE / "floors.toml"
SUITES = ("backend", "frontend", "mcp")
STATUSES = ("killed", "survived", "excluded", "pending")
SUMMARY_SURVIVOR_LIMIT = 50


@dataclass
class Tally:
    killed: int = 0
    survived: int = 0
    excluded: int = 0
    pending: int = 0

    def add(self, status: str) -> None:
        setattr(self, status, getattr(self, status) + 1)

    @property
    def scored(self) -> int:
        return self.killed + self.survived

    @property
    def score(self) -> float | None:
        return None if self.scored == 0 else 100.0 * self.killed / self.scored


@dataclass
class Verdict:
    passed: bool
    incomplete: bool
    lines: list[str] = field(default_factory=list)


def load_floors(path: Path = DEFAULT_FLOORS) -> dict:
    floors = tomllib.loads(path.read_text("utf-8"))
    validate_floors(floors)
    return floors


def validate_floors(floors: dict) -> None:
    """Every floor is an int percentage; every suite has a diff and a suite floor."""
    for section in ("diff", "suite"):
        for suite in SUITES:
            value = floors.get(section, {}).get(suite)
            if not isinstance(value, int) or not 0 <= value <= 100:
                raise ValueError(f"[{section}] {suite} must be an int 0-100, got {value!r}")
    minimum = floors.get("diff", {}).get("min_mutants")
    if not isinstance(minimum, int) or minimum < 1:
        raise ValueError(f"[diff] min_mutants must be a positive int, got {minimum!r}")
    for module, value in floors.get("modules", {}).items():
        if not isinstance(value, int) or not 0 <= value <= 100:
            raise ValueError(f"[modules] {module} must be an int 0-100, got {value!r}")
        if suite_of(module) is None:
            raise ValueError(f"[modules] {module} is not under backend/, frontend/ or mcp-server/")


def suite_of(path: str) -> str | None:
    first = path.split("/", 1)[0]
    return {"backend": "backend", "frontend": "frontend", "mcp-server": "mcp"}.get(first)


def load_records(path: Path) -> list[dict]:
    records = json.loads(path.read_text("utf-8"))
    for record in records:
        if record.get("status") not in STATUSES:
            raise ValueError(f"unknown status in {record!r}")
    return records


def tally(records: list[dict]) -> Tally:
    total = Tally()
    for record in records:
        total.add(record["status"])
    return total


def per_file(records: list[dict]) -> dict[str, Tally]:
    files: dict[str, Tally] = defaultdict(Tally)
    for record in records:
        files[record["file"]].add(record["status"])
    return dict(files)


def fmt(score: float | None) -> str:
    return "n/a" if score is None else f"{score:.1f}%"


def judge(
    records: list[dict], suite: str, scope: str, floors: dict, allow_pending: bool = False
) -> Verdict:
    total = tally(records)
    lines = [f"## Mutation score: {suite} ({scope})", ""]
    partial = allow_pending and scope == "suite" and total.pending > 0
    if total.pending and not partial:
        lines.append(
            f"**Incomplete run:** {total.pending} mutant(s) were never tested — the run "
            "hit its time budget or stopped early. A partial run is not a score; "
            f"of the {total.scored} that were tested, {total.killed} were killed."
        )
        lines += ["", *file_table(records)]
        return Verdict(passed=False, incomplete=True, lines=lines)

    passed = True
    if scope == "diff":
        floor = floors["diff"][suite]
        minimum = floors["diff"]["min_mutants"]
        if total.scored == 0:
            lines.append("No mutants on the lines this change adds or modifies.")
        elif total.scored < minimum:
            lines.append(
                f"{total.killed} of {total.scored} mutants on changed lines killed "
                f"({fmt(total.score)}). Fewer than {minimum}, so the {floor}% floor "
                "does not apply: answer for each survivor below in the PR's Test Plan."
            )
        else:
            passed = total.score >= floor
            mark = "pass" if passed else "**FAIL**"
            lines.append(
                f"{mark}: {fmt(total.score)} of {total.scored} mutants on changed lines "
                f"killed; the floor is {floor}% (`scripts/mutation/floors.toml`)."
            )
    else:
        floor = floors["suite"][suite]
        measured = total.scored + total.excluded
        if partial:
            share = 100.0 * measured / (measured + total.pending)
            lines.append(
                f"Baseline in progress: {measured} of {measured + total.pending} mutants "
                f"measured ({share:.0f}%); the rest resume on the next run. "
                f"{fmt(total.score)} of those measured were killed. The {floor}% suite "
                "floor applies once the baseline is complete."
            )
        else:
            passed = total.score is None or total.score >= floor
            mark = "pass" if passed else "**FAIL**"
            lines.append(
                f"{mark}: {fmt(total.score)} of {total.scored} mutants killed "
                f"({total.excluded} excluded); the suite floor is {floor}%."
            )
        files = per_file(records)
        module_rows = []
        for module, module_floor in sorted(floors.get("modules", {}).items()):
            if suite_of(module) != suite:
                continue
            t = files.get(module, Tally())
            if t.scored + t.excluded + t.pending == 0:
                # A wrong path, a file with nothing mutable, or a shard whose
                # records never arrived: never a silent pass.
                module_rows.append(f"| `{module}` | not measured | {module_floor}% | **check** |")
                passed = passed and partial
                continue
            if t.pending:
                module_rows.append(
                    f"| `{module}` | {fmt(t.score)} so far | {module_floor}% | "
                    f"{t.pending} still to measure |"
                )
                continue
            ok = t.score is None or t.score >= module_floor
            passed = passed and ok
            module_rows.append(
                f"| `{module}` | {fmt(t.score)} | {module_floor}% | {'ok' if ok else '**FAIL**'} |"
            )
        if module_rows:
            lines += [
                "",
                "### Critical modules",
                "",
                "| Module | Score | Floor | |",
                "|---|---|---|---|",
                *module_rows,
            ]

    lines += ["", *file_table(records)]
    return Verdict(passed=passed, incomplete=False, lines=lines)


def file_table(records: list[dict], limit: int = 40) -> list[str]:
    files = per_file(records)
    if not files:
        return []
    rows = sorted(files.items(), key=lambda kv: (-kv[1].survived, kv[0]))[:limit]
    out = ["| File | Mutants | Killed | Survived | Score |", "|---|---|---|---|---|"]
    for path, t in rows:
        out.append(f"| `{path}` | {t.scored} | {t.killed} | {t.survived} | {fmt(t.score)} |")
    if len(files) > limit:
        out.append(f"| … {len(files) - limit} more files | | | | |")
    return out


def survivor_lines(records: list[dict], limit: int | None = None) -> list[str]:
    survivors = [r for r in records if r["status"] == "survived"]
    survivors.sort(key=lambda r: (r["file"], r.get("line") or 0, r.get("id", "")))
    out: list[str] = []
    for record in survivors[:limit]:
        where = record["file"] + (f":{record['line']}" if record.get("line") else "")
        what = record.get("raw_status") or "survived"
        out.append(f"- `{where}` `{record.get('id', '')}` ({what})")
        if record.get("description"):
            out += ["  ```diff", *[f"  {d}" for d in record["description"].splitlines()], "  ```"]
    if limit is not None and len(survivors) > limit:
        out.append(f"- … {len(survivors) - limit} more in the uploaded artifact")
    return out


def backlog(records: list[dict], suite: str, floors: dict) -> list[str]:
    """The survivors of a full run, critical modules first, then by count."""
    critical = {m for m in floors.get("modules", {}) if suite_of(m) == suite}
    by_function: dict[tuple[str, str], int] = defaultdict(int)
    for record in records:
        if record["status"] == "survived":
            # mutmut names the function; Stryker only gives a line.
            where = record.get("function") or f"line {record.get('line') or '?'}"
            by_function[(record["file"], where)] += 1
    files = per_file(records)
    order = sorted(
        (path for path, t in files.items() if t.survived),
        key=lambda p: (p not in critical, -files[p].survived, p),
    )
    total = tally(records)
    out = [
        f"### {suite}: {total.survived} surviving mutants in {len(order)} files "
        f"(score {fmt(total.score)})",
        "",
    ]
    for path in order:
        t = files[path]
        flag = " (critical module)" if path in critical else ""
        out.append(f"- **`{path}`**{flag}: {t.survived} survived, score {fmt(t.score)}")
        functions = sorted(
            ((fn, n) for (f, fn), n in by_function.items() if f == path),
            key=lambda kv: (-kv[1], kv[0]),
        )
        out.append("  - " + ", ".join(f"`{fn}` ({n})" for fn, n in functions))
    return out


def regressions(records: list[dict], previous: list[dict], threshold: float = 0.5) -> list[str]:
    """Files whose score fell since the previous full run."""
    now, before = per_file(records), per_file(previous)
    out = []
    for path in sorted(now):
        old = before.get(path)
        if old is None or old.score is None or now[path].score is None:
            continue
        if now[path].score < old.score - threshold:
            out.append(f"| `{path}` | {fmt(old.score)} | {fmt(now[path].score)} |")
    if not out:
        return []
    return [
        "",
        "### Files whose score dropped since the previous run",
        "",
        "| File | Before | Now |",
        "|---|---|---|",
        *out,
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--suite", required=True, choices=SUITES)
    parser.add_argument("--scope", required=True, choices=("diff", "suite"))
    parser.add_argument(
        "--records", required=True, type=Path, nargs="+", help="one or more record files"
    )
    parser.add_argument("--floors", type=Path, default=DEFAULT_FLOORS)
    parser.add_argument("--summary", type=Path, help="append the markdown report here")
    parser.add_argument("--survivors", type=Path, help="write the full survivor list here")
    parser.add_argument(
        "--previous", type=Path, nargs="*", default=[], help="records of the previous full run"
    )
    parser.add_argument(
        "--informational", action="store_true", help="report, never fail on a floor"
    )
    parser.add_argument(
        "--allow-pending",
        action="store_true",
        help="suite scope: untested mutants are baseline progress, not an error",
    )
    args = parser.parse_args(argv)

    try:
        floors = load_floors(args.floors)
        records = [r for path in args.records for r in load_records(path)]
    except (OSError, ValueError) as exc:
        print(f"::error::mutation gate: {exc}")
        return 2

    verdict = judge(records, args.suite, args.scope, floors, args.allow_pending)
    report = list(verdict.lines)
    if args.scope == "diff":
        survivors = survivor_lines(records, SUMMARY_SURVIVOR_LIMIT)
        if survivors:
            report += ["", "### Surviving mutants on changed lines", "", *survivors]
    else:
        previous = [r for path in args.previous if path.exists() for r in load_records(path)]
        if previous:
            report += regressions(records, previous)

    text = "\n".join(report) + "\n"
    print(text)
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as fh:
            fh.write(text)
    if args.survivors:
        body = backlog(records, args.suite, floors) if args.scope == "suite" else []
        body = body or survivor_lines(records)
        args.survivors.write_text("\n".join(body) + "\n", encoding="utf-8")

    if verdict.incomplete:
        print("::error::mutation run incomplete")
        return 2
    if not verdict.passed:
        if args.informational:
            print("::warning::mutation score under its floor (informational run)")
            return 0
        print("::error::mutation score under its floor; see the job summary")
        return 1
    if args.scope == "diff":
        scored = tally(records).scored
        if 0 < scored < floors["diff"]["min_mutants"] and tally(records).survived:
            print("::warning::surviving mutants on changed lines; list them in the Test Plan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
