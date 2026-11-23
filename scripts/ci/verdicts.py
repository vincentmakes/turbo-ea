#!/usr/bin/env python3
"""Skip a CI job that already passed, in this pull request, on the same inputs.

The ``changes`` job in ``.github/workflows/ci.yml`` decides which suites run by
comparing the pull request with its BASE, so a PR that touches backend and
frontend re-runs every backend job each time a later push only fixes a
frontend test. This script is the second half of that decision: for each job
group below it fingerprints the files the group's path filters cover, on both
sides of the PR's merge commit, and looks for a marker an earlier run of the
SAME pull request saved after that group passed on byte-identical inputs. A
group with a marker is reported ``done``, and its jobs are skipped.

Stdlib only: the ``changes`` job installs nothing.

* **Fingerprint.** ``sha256`` over the ``git ls-tree -r`` entries (mode, object
  id, path) of every file one of the group's filters matches, unioned with the
  ``ci`` filter, at ``HEAD`` (the merge commit GitHub builds) and at ``HEAD^1``
  (the base side). Both sides, because diff-cover and the mutation gate judge
  the diff, not only the tree. The patterns are read out of the ``filters:``
  block of ``ci.yml`` itself, so there is one list of paths, not two.
* **Lookup.** ``GET /repos/{repo}/actions/caches`` with ``ref`` set to this
  PR's merge ref and ``key`` set to the marker prefix. The ``ref`` filter is
  always sent and every returned entry is re-checked against it: a marker from
  another pull request or branch never counts.
* **Fail wide.** Anything unexpected — the API, git, a merge commit with one
  parent, a filter this matcher cannot read — means "no verdicts": every job
  runs, and a warning says why. Never the other way round.

Trust assumption. A marker is an Actions cache in the pull request's own
scope, and its key is computable in advance, so a commit of the same pull
request that edits the workflow could save a marker for a later, clean-looking
commit, whose checks would then be skipped rather than run; fingerprinting the
``ci`` filter does not prevent that. This is acceptable only because pull
requests are restricted to the maintainer and allowlisted bots
(``restrict-pr-authors.yml``), every skipped job is named in the ``changes``
job summary with the run that passed it, and every push to ``main`` runs the
suites regardless. If the author allowlist is ever opened up, the cache must
move to a recorder pull-request code cannot write to (for example a
``workflow_run`` workflow from the default branch).

Markers are saved by the last step of each covered job (``actions/cache/save``
under ``<key>-<run id>-<run attempt>``), only on ``pull_request`` and only on
success.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

VERSION = "v1"
KEY_PREFIX = f"verdict-{VERSION}-"
CI_FILTER = "ci"
ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


@dataclass(frozen=True)
class Group:
    """Jobs that pass or fail as one unit, and the path filters their inputs live under."""

    name: str
    filters: tuple[str, ...]
    jobs: tuple[str, ...]
    # The job that saves the marker: the last job of the unit when it is one of
    # ``jobs`` (its last steps), else a small job of its own that runs after the
    # unit's last job passed.
    recorder: str

    @property
    def ident(self) -> str:
        """The group name as a workflow output name (``done_<ident>``, ``key_<ident>``)."""
        return self.name.replace("-", "_")


def _one(name: str, filters: tuple[str, ...]) -> Group:
    return Group(name, filters, (name,), name)


GROUPS: tuple[Group, ...] = (
    _one("backend-lint", ("backend",)),
    _one("backend-typecheck", ("backend",)),
    _one("migration-rollback", ("backend",)),
    Group(
        "backend-unit",
        ("backend", "mutation", "images"),
        ("backend-test-unit",),
        "backend-test-unit",
    ),
    # The shards and their aggregate are one unit: the aggregate needs every
    # shard's coverage from the same run.
    Group(
        "backend-integration",
        ("backend",),
        ("backend-test-shards", "backend-test-integration"),
        "backend-test-integration",
    ),
    # The mutmut jobs never save a cache themselves (the nightly owns those
    # caches, test_ci_workflow_mutation.py), so a job of their own records.
    Group(
        "backend-mutation",
        ("backend", "mutation"),
        ("backend-mutation",),
        "backend-mutation-verdict",
    ),
    _one("frontend-lint", ("frontend",)),
    _one("frontend-build", ("frontend",)),
    # The shards and their aggregate are one unit, as on the backend. The
    # aggregate also merges the browser suite's coverage, so it records only
    # when Frontend E2E passed or was skipped by its path filter.
    Group(
        "frontend-tests",
        ("frontend", "e2e"),
        ("frontend-test-shards", "frontend-test"),
        "frontend-test",
    ),
    # The browser suite boots the real backend, so a backend change re-runs it
    # (and only it: the unit shards do not read the backend). Its job skips on
    # its own marker only when the aggregate will not need its coverage from
    # this run — see E2E_CONDITION.
    Group(
        "frontend-e2e",
        ("frontend", "e2e", "backend"),
        ("frontend-e2e",),
        "frontend-e2e",
    ),
    _one("frontend-mutation", ("frontend", "mutation")),
    _one("mcp-test", ("mcp",)),
    Group("mcp-mutation", ("mcp", "mutation"), ("mcp-mutation",), "mcp-mutation-verdict"),
)


# The one job whose skip reads two markers. If the aggregate runs on this push,
# it needs Frontend E2E's coverage artifact from the same run, so E2E must run
# too; when the `frontend` gate is off the aggregate never runs and E2E's own
# marker is enough.
E2E_CONDITION = (
    "needs.changes.outputs.e2e == 'true' && !(needs.changes.outputs.done_frontend_e2e == 'true'"
    " && (needs.changes.outputs.done_frontend_tests == 'true'"
    " || needs.changes.outputs.frontend != 'true'))"
)


class NoVerdictsError(Exception):
    """A reason to run everything."""


# ── The path filters ───────────────────────────────────────────────────────

_FILTER_NAME = re.compile(r"^            ([a-z][a-z0-9_-]*):\s*$")
_FILTER_ENTRY = re.compile(r"^              - '([^']+)'\s*$")


def parse_filters(workflow_text: str) -> dict[str, list[str]]:
    """The ``filters: |`` block of the paths-filter step, as name → patterns.

    Read as text, like the workflow guard tests do: the block is a YAML string
    holding YAML, at fixed indentation. A line in the block that is neither a
    filter name, a quoted entry, a comment nor blank is refused rather than
    guessed at.
    """
    lines = workflow_text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "filters: |")
    except StopIteration:
        raise NoVerdictsError("no `filters: |` block in the workflow") from None
    indent = len(lines[start]) - len(lines[start].lstrip())
    filters: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines[start + 1 :]:
        stripped = line.strip()
        if stripped and len(line) - len(line.lstrip()) <= indent:
            break  # back out of the block scalar
        if not stripped or stripped.startswith("#"):
            continue
        name = _FILTER_NAME.match(line)
        entry = _FILTER_ENTRY.match(line)
        if name:
            current = name.group(1)
            filters[current] = []
        elif entry and current is not None:
            filters[current].append(entry.group(1))
        else:
            raise NoVerdictsError(f"unreadable line in the filters block: {line!r}")
    if not filters:
        raise NoVerdictsError("the filters block is empty")
    return filters


_GLOB_CHARS = re.compile(r"[*?\[\]{}!]")


def compile_pattern(pattern: str) -> Callable[[str], bool]:
    """A predicate for one paths-filter pattern, in the forms ``ci.yml`` uses.

    ``dir/**`` (everything below ``dir``), an exact path, and either of those
    negated with a leading ``!``. Anything else raises :class:`NoVerdictsError`, so
    a new glob form in ``ci.yml`` turns the cache off instead of mismatching.

    A negated pattern follows dorny/paths-filter's default ``some`` quantifier
    literally: ``!p`` matches every path ``p`` does not, so a filter carrying
    one matches nearly the whole tree. That is what the action does when it
    decides whether the job runs, and for a fingerprint over-matching only
    costs a skip, never a missed change.
    """
    negated = pattern.startswith("!")
    body = pattern[1:] if negated else pattern
    if body.endswith("/**"):
        prefix = body[: -len("**")]
        if not prefix.strip("/") or _GLOB_CHARS.search(prefix):
            raise NoVerdictsError(f"unsupported filter pattern {pattern!r}")

        def positive(path: str) -> bool:
            return path.startswith(prefix)
    else:
        if not body or _GLOB_CHARS.search(body):
            raise NoVerdictsError(f"unsupported filter pattern {pattern!r}")

        def positive(path: str) -> bool:
            return path == body

    if negated:
        return lambda path: not positive(path)
    return positive


def matcher(filters: dict[str, list[str]], names: Iterable[str]) -> Callable[[str], bool]:
    """A path matches the group when any pattern of any of its filters (plus ``ci``) does."""
    predicates = []
    for name in (*names, CI_FILTER):
        if name not in filters:
            raise NoVerdictsError(f"no `{name}` filter in the workflow")
        predicates.extend(compile_pattern(p) for p in filters[name])
    return lambda path: any(p(path) for p in predicates)


# ── Git ────────────────────────────────────────────────────────────────────

Git = Callable[..., str]


def run_git(*args: str, cwd: Path = ROOT) -> str:
    try:
        out = subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", "") or str(exc)
        raise NoVerdictsError(f"git {' '.join(args)} failed: {detail.strip()}") from exc
    return out.stdout


def merge_sides(git: Git) -> tuple[str, str]:
    """``(HEAD, HEAD^1)`` of the PR's merge commit; anything else means no verdicts."""
    parents = git("rev-list", "--parents", "-n", "1", "HEAD").split()
    if len(parents) != 3:
        raise NoVerdictsError(
            f"HEAD has {len(parents) - 1} parent(s), not the two of a pull request merge commit"
        )
    return parents[0], parents[1]


def tree_entries(git: Git, rev: str) -> list[tuple[str, str, str]]:
    """``(mode, object id, path)`` of every entry of ``rev``'s tree, recursively."""
    out = git("ls-tree", "-r", "-z", "--full-tree", rev)
    entries = []
    for record in out.split("\0"):
        if not record:
            continue
        meta, _, path = record.partition("\t")
        mode, _kind, obj = meta.split(" ")
        entries.append((mode, obj, path))
    return entries


def fingerprint(
    group: Group,
    match: Callable[[str], bool],
    head: list[tuple[str, str, str]],
    base: list[tuple[str, str, str]],
) -> str:
    digest = hashlib.sha256()
    digest.update(f"{KEY_PREFIX}{group.name}\n".encode())
    for side, entries in (("head", head), ("base", base)):
        digest.update(f"[{side}]\n".encode())
        for mode, obj, path in sorted(entries, key=lambda e: e[2]):
            if match(path):
                digest.update(f"{mode} {obj}\t{path}\n".encode())
    return digest.hexdigest()


def group_key(group: Group, fp: str) -> str:
    """The marker key up to the run suffix the recording step appends."""
    return f"{KEY_PREFIX}{group.name}-{fp}"


# ── The cache listing ──────────────────────────────────────────────────────

ListCaches = Callable[[str, str, str], list[dict]]
PER_PAGE = 100
MAX_PAGES = 50


def gh_list_caches(repo: str, ref: str, prefix: str) -> list[dict]:
    """Every Actions cache of ``ref`` whose key starts with ``prefix`` (a prefix match)."""
    caches: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        args = [
            "gh",
            "api",
            "-X",
            "GET",
            f"repos/{repo}/actions/caches",
            "-f",
            f"ref={ref}",
            "-f",
            f"key={prefix}",
            "-f",
            f"per_page={PER_PAGE}",
            "-f",
            f"page={page}",
        ]
        try:
            out = subprocess.run(args, check=True, capture_output=True, text=True).stdout
            batch = json.loads(out)["actions_caches"]
        except (OSError, subprocess.CalledProcessError, ValueError, KeyError, TypeError) as exc:
            detail = getattr(exc, "stderr", "") or str(exc)
            raise NoVerdictsError(f"listing the caches failed: {detail.strip()}") from exc
        caches.extend(batch)
        if len(batch) < PER_PAGE:
            return caches
    raise NoVerdictsError(f"more than {MAX_PAGES * PER_PAGE} verdict caches; not reading further")


_RUN_SUFFIX = re.compile(r"^-(\d+)-(\d+)$")


def passing_run(caches: Iterable[dict], ref: str, key: str) -> str | None:
    """The run id of the earliest marker for exactly ``key`` on exactly ``ref``, if any."""
    runs = []
    for cache in caches:
        if not isinstance(cache, dict) or cache.get("ref") != ref:
            continue
        name = cache.get("key")
        if not isinstance(name, str) or not name.startswith(key):
            continue
        suffix = _RUN_SUFFIX.match(name[len(key) :])
        if suffix:
            runs.append(int(suffix.group(1)))
    return str(min(runs)) if runs else None


# ── Putting it together ────────────────────────────────────────────────────


@dataclass(frozen=True)
class Verdict:
    group: Group
    key: str
    run: str | None  # the run that passed it, or None: the group runs


def lookup(
    workflow_text: str, git: Git, list_caches: ListCaches, repo: str, pr: str
) -> tuple[list[Verdict], str | None]:
    """A verdict per group, and why none was used when the listing failed.

    Raises :class:`NoVerdictsError` when the fingerprints themselves cannot be
    trusted (then no key is emitted and nothing is recorded either). When only
    the cache listing fails, the keys are still returned — this run records
    its markers for the next push — but no group is reported done.
    """
    if not re.fullmatch(r"[1-9]\d*", pr):
        raise NoVerdictsError(f"not a pull request number: {pr!r}")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        raise NoVerdictsError(f"not a repository name: {repo!r}")
    filters = parse_filters(workflow_text)
    matchers = {g.name: matcher(filters, g.filters) for g in GROUPS}
    head, base = merge_sides(git)
    head_entries, base_entries = tree_entries(git, head), tree_entries(git, base)
    ref = f"refs/pull/{pr}/merge"
    keys = {
        g.name: group_key(g, fingerprint(g, matchers[g.name], head_entries, base_entries))
        for g in GROUPS
    }
    try:
        caches = list_caches(repo, ref, KEY_PREFIX)
    except Exception as exc:  # the listing, however it failed: run everything
        reason = str(exc) if isinstance(exc, NoVerdictsError) else f"{type(exc).__name__}: {exc}"
        return [Verdict(g, keys[g.name], None) for g in GROUPS], reason
    return [Verdict(g, keys[g.name], passing_run(caches, ref, keys[g.name])) for g in GROUPS], None


def outputs(verdicts: Sequence[Verdict]) -> list[str]:
    """``done_<group>`` / ``key_<group>`` lines for ``$GITHUB_OUTPUT``; every group gets both."""
    by_name = {v.group.name: v for v in verdicts}
    lines = []
    for g in GROUPS:
        v = by_name.get(g.name)
        lines.append(f"done_{g.ident}={'true' if v is not None and v.run else 'false'}")
        lines.append(f"key_{g.ident}={v.key if v is not None else ''}")
    return lines


def summary(verdicts: Sequence[Verdict], server: str, repo: str, reason: str | None) -> str:
    out = ["## Verdicts this pull request already earned", ""]
    if reason is not None:
        out.append(f"No verdicts used, every job runs: {reason}")
        return "\n".join(out) + "\n"
    skipped = [v for v in verdicts if v.run]
    if not skipped:
        out.append("No group passed earlier on these exact inputs; every job runs.")
        return "\n".join(out) + "\n"
    out += [
        "These jobs are **skipped**: they passed in an earlier run of this pull request "
        "on byte-identical inputs (both sides of the merge).",
        "",
        "| Group | Jobs skipped | Passed in |",
        "|---|---|---|",
    ]
    for v in skipped:
        jobs = ", ".join(f"`{j}`" for j in v.group.jobs)
        link = f"[run {v.run}]({server}/{repo}/actions/runs/{v.run})"
        out.append(f"| {v.group.name} | {jobs} | {link} |")
    ran = [v.group.name for v in verdicts if not v.run]
    if ran:
        out += ["", "Every other group runs: " + ", ".join(ran) + "."]
    return "\n".join(out) + "\n"


def _append(path: str | None, text: str) -> None:
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)


def main(
    argv: Sequence[str] | None = None,
    git: Git = run_git,
    list_caches: ListCaches = gh_list_caches,
    env: dict[str, str] | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--pr", required=True, help="pull request number")
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--workflow", default=str(WORKFLOW))
    args = parser.parse_args(argv)
    env = dict(os.environ) if env is None else env
    server = env.get("GITHUB_SERVER_URL", "https://github.com")

    reason: str | None = None
    verdicts: list[Verdict] = []
    try:
        text = Path(args.workflow).read_text(encoding="utf-8")
        verdicts, reason = lookup(text, git, list_caches, args.repo, args.pr)
    except NoVerdictsError as exc:
        reason = str(exc)
    except Exception as exc:  # anything at all: run everything, say why
        reason = f"unexpected {type(exc).__name__}: {exc}"
    if reason is not None:
        verdicts = [Verdict(v.group, v.key, None) for v in verdicts]
        print(f"::warning title=CI verdict cache::{reason} — every job runs.")

    _append(env.get("GITHUB_OUTPUT"), "\n".join(outputs(verdicts)) + "\n")
    _append(env.get("GITHUB_STEP_SUMMARY"), summary(verdicts, server, args.repo, reason))
    for v in verdicts:
        state = f"skip (passed in run {v.run})" if v.run else "run"
        print(f"{v.group.name}: {state}  [{v.key}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
