"""The CI verdict cache, ``scripts/ci/verdicts.py``.

It decides which CI jobs a pull request may skip, so its failure mode matters
more than its success: every doubt must end in "run everything". The filter
parser is tested on the real ``ci.yml``, the fingerprint on throwaway git
repositories with a real two-parent merge commit, and the cache listing with
the API call injected so no test reaches the network. Loaded off disk like
``test_guard_ratchet.py`` loads ``scripts/guard_ratchet.py``.
"""

from __future__ import annotations

import importlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "scripts" / "ci"))
verdicts = importlib.import_module("verdicts")

CI_TEXT = (REPO / ".github" / "workflows" / "ci.yml").read_text()
GROUP = {g.name: g for g in verdicts.GROUPS}

# ── The filters block ──────────────────────────────────────────────────────


def test_every_pattern_in_ci_yml_is_a_form_the_matcher_supports():
    """A new glob form in ci.yml must turn up here, not as a silent mismatch."""
    filters = verdicts.parse_filters(CI_TEXT)
    patterns = [p for entries in filters.values() for p in entries]
    assert len(patterns) >= 25
    for pattern in patterns:
        verdicts.compile_pattern(pattern)  # raises NoVerdictsError on anything else


def test_the_parser_reads_the_real_block():
    filters = verdicts.parse_filters(CI_TEXT)
    assert filters["backend"] == [
        "backend/**",
        "scripts/dump_openapi.py",
        "scripts/guard_ratchet.py",
    ]
    assert filters["ci"] == [".github/workflows/**", "scripts/ci/**"]
    assert "!deploy/terraform/**" in filters["deploy"]
    assert filters["mutation"] == ["scripts/mutation/**"]
    # the block ends where the next step begins
    assert "Look up the verdicts" not in json.dumps(filters)


def test_every_group_names_filters_the_workflow_has():
    filters = verdicts.parse_filters(CI_TEXT)
    for group in verdicts.GROUPS:
        for name in group.filters:
            assert name in filters, (group.name, name)
        verdicts.matcher(filters, group.filters)


BLOCK = """\
      - uses: x
        with:
          filters: |
            one:
              - 'a/**'
              # a comment
              - 'b.txt'

            ci:
              - '.github/workflows/**'
      - name: next
"""


def test_parse_filters_stops_at_the_end_of_the_block():
    assert verdicts.parse_filters(BLOCK) == {
        "one": ["a/**", "b.txt"],
        "ci": [".github/workflows/**"],
    }


@pytest.mark.parametrize(
    "text, message",
    [
        ("jobs:\n  a:\n", "no `filters: |` block"),
        ("          filters: |\n      - name: x\n", "the filters block is empty"),
        ("          filters: |\n            one:\n              - a/**\n", "unreadable line"),
        ("          filters: |\n              - 'a/**'\n", "unreadable line"),
    ],
)
def test_parse_filters_refuses_what_it_cannot_read(text, message):
    with pytest.raises(verdicts.NoVerdictsError, match=message):
        verdicts.parse_filters(text)


# ── Patterns ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "pattern, path, expected",
    [
        ("backend/**", "backend/app/main.py", True),
        ("backend/**", "backend/.env.example", True),
        ("backend/**", "backend", False),
        ("backend/**", "backendx/a.py", False),
        ("backend/**", "x/backend/a.py", False),
        (".github/workflows/**", ".github/workflows/ci.yml", True),
        ("Dockerfile", "Dockerfile", True),
        ("Dockerfile", "frontend/Dockerfile", False),
        ("Dockerfile", "Dockerfile.dev", False),
        ("!deploy/terraform/**", "deploy/terraform/main.tf", False),
        ("!deploy/terraform/**", "deploy/helm/x.yaml", True),
        ("!deploy/terraform/**", "README.md", True),
        ("!Dockerfile", "Dockerfile", False),
        ("!Dockerfile", "README.md", True),
    ],
)
def test_pattern_semantics(pattern, path, expected):
    assert verdicts.compile_pattern(pattern)(path) is expected


@pytest.mark.parametrize(
    "pattern",
    ["*.py", "src/*.ts", "src/**/x.ts", "**", "/**", "!**", "a/{b,c}/**", "a?/**", "", "!", "[ab]"],
)
def test_other_glob_forms_turn_the_cache_off(pattern):
    with pytest.raises(verdicts.NoVerdictsError, match="unsupported filter pattern"):
        verdicts.compile_pattern(pattern)


def test_the_matcher_always_unions_the_ci_filter():
    filters = {"one": ["a/**"], "ci": ["ci/**"], "two": ["b"]}
    match = verdicts.matcher(filters, ("one",))
    assert match("a/x") and match("ci/y")
    assert not match("b") and not match("c")
    with pytest.raises(verdicts.NoVerdictsError, match="no `three` filter"):
        verdicts.matcher(filters, ("three",))
    with pytest.raises(verdicts.NoVerdictsError, match="no `ci` filter"):
        verdicts.matcher({"one": ["a/**"]}, ("one",))


# ── Groups ─────────────────────────────────────────────────────────────────


def test_group_identities_are_unique_and_output_safe():
    idents = [g.ident for g in verdicts.GROUPS]
    assert len(set(idents)) == len(idents)
    for g in verdicts.GROUPS:
        assert g.ident.replace("_", "").isalnum() and "-" not in g.ident
        assert g.jobs and g.filters
    assert GROUP["frontend-tests"].ident == "frontend_tests"


def test_the_units_are_what_the_plan_says():
    assert GROUP["backend-integration"].jobs == (
        "backend-test-shards",
        "backend-test-integration",
    )
    assert GROUP["backend-integration"].recorder == "backend-test-integration"
    assert GROUP["frontend-tests"].recorder == "frontend-test"
    assert GROUP["frontend-tests"].jobs == ("frontend-test-shards", "frontend-test")
    # a backend-only push does not re-run the unit shards ...
    assert set(GROUP["frontend-tests"].filters) == {"frontend", "e2e"}
    # ... but the browser suite boots the backend, so it re-runs that
    assert GROUP["frontend-e2e"].jobs == ("frontend-e2e",)
    assert GROUP["frontend-e2e"].recorder == "frontend-e2e"
    assert set(GROUP["frontend-e2e"].filters) == {"frontend", "e2e", "backend"}
    assert "done_frontend_e2e" in verdicts.E2E_CONDITION
    assert "done_frontend_tests" in verdicts.E2E_CONDITION
    assert set(GROUP["backend-unit"].filters) == {"backend", "mutation", "images"}


# ── Git ────────────────────────────────────────────────────────────────────


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()


def _write(repo: Path, files: dict[str, str]) -> None:
    for path, content in files.items():
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)


ROOT_FILES = {"backend/a.py": "a\n", "frontend/x.ts": "x\n", ".github/workflows/ci.yml": "ci\n"}


def _pr_repo(tmp_path: Path, base: dict[str, str], pr: dict[str, str], name: str = "r") -> Path:
    """A repository whose HEAD is a two-parent merge of ``pr`` into ``base``."""
    repo = tmp_path / name
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@example.invalid")
    _git(repo, "config", "user.name", "t")
    _git(repo, "config", "commit.gpgsign", "false")
    _write(repo, {"README.md": "root\n", **ROOT_FILES})
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "root")
    _git(repo, "checkout", "-q", "-b", "pr")
    _write(repo, pr)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "--allow-empty", "-m", "pr")
    _git(repo, "checkout", "-q", "main")
    _write(repo, base)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "--allow-empty", "-m", "base")
    _git(repo, "merge", "-q", "--no-ff", "--no-edit", "pr")
    return repo


def _git_in(repo: Path):
    return lambda *args: verdicts.run_git(*args, cwd=repo)


FILTERS = {"backend": ["backend/**"], "frontend": ["frontend/**"], "ci": [".github/workflows/**"]}
BACKEND = verdicts.Group("g", ("backend",), ("j",), "j")


def _fp(repo: Path, group=BACKEND) -> str:
    git = _git_in(repo)
    head, base = verdicts.merge_sides(git)
    return verdicts.fingerprint(
        group,
        verdicts.matcher(FILTERS, group.filters),
        verdicts.tree_entries(git, head),
        verdicts.tree_entries(git, base),
    )


BASE = {"backend/a.py": "a\n", "frontend/x.ts": "x\n", ".github/workflows/ci.yml": "ci\n"}


def test_merge_sides_are_the_merge_and_its_first_parent(tmp_path):
    repo = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"})
    head, base = verdicts.merge_sides(_git_in(repo))
    assert head == _git(repo, "rev-parse", "HEAD")
    assert base == _git(repo, "rev-parse", "HEAD^1")
    assert base != _git(repo, "rev-parse", "HEAD^2")


def test_a_single_parent_head_means_no_verdicts(tmp_path):
    repo = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"})
    _write(repo, {"backend/c.py": "c\n"})
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "linear")
    with pytest.raises(verdicts.NoVerdictsError, match="1 parent"):
        verdicts.merge_sides(_git_in(repo))


def test_a_git_failure_means_no_verdicts(tmp_path):
    with pytest.raises(verdicts.NoVerdictsError, match="git rev-list"):
        verdicts.merge_sides(_git_in(tmp_path))


def test_tree_entries_lists_mode_object_and_path(tmp_path):
    repo = _pr_repo(tmp_path, BASE, {"backend/sub dir/b.py": "b\n"})
    entries = verdicts.tree_entries(_git_in(repo), "HEAD")
    by_path = {path: (mode, obj) for mode, obj, path in entries}
    assert by_path["backend/sub dir/b.py"][0] == "100644"
    assert by_path["backend/a.py"][1] == _git(repo, "rev-parse", "HEAD:backend/a.py")
    assert set(by_path) == {
        "README.md",
        "backend/a.py",
        "backend/sub dir/b.py",
        "frontend/x.ts",
        ".github/workflows/ci.yml",
    }


def test_the_fingerprint_is_stable_across_identical_inputs(tmp_path):
    one = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"}, "one")
    two = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n", "frontend/y.ts": "y\n"}, "two")
    # a different commit graph, an unmatched file on the PR side: the same verdict
    assert _git(one, "rev-parse", "HEAD") != _git(two, "rev-parse", "HEAD")
    assert _fp(one) == _fp(two)
    assert len(_fp(one)) == 64


@pytest.mark.parametrize(
    "base, pr",
    [
        # the PR side (HEAD) changes
        (BASE, {"backend/b.py": "B\n"}),
        (BASE, {"backend/b.py": "b\n", "backend/c.py": "c\n"}),
        (BASE, {"backend/b.py": "b\n", ".github/workflows/ci.yml": "ci2\n"}),
        # the base side (HEAD^1) changes, the merged tree too
        ({**BASE, "backend/a.py": "a2\n"}, {"backend/b.py": "b\n"}),
    ],
)
def test_the_fingerprint_moves_with_any_matched_file(tmp_path, base, pr):
    reference = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"}, "reference")
    changed = _pr_repo(tmp_path, base, pr, "changed")
    assert _fp(reference) != _fp(changed)


def test_the_fingerprint_moves_with_the_base_side_alone(tmp_path):
    """Same merged tree, different diff: diff-cover would judge other lines."""
    # PR adds b.py; in `moved`, base already carries b.py and the PR changes nothing
    reference = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"}, "reference")
    moved = _pr_repo(tmp_path, {**BASE, "backend/b.py": "b\n"}, {"backend/b.py": "b\n"}, "moved")
    assert _git(reference, "rev-parse", "HEAD^{tree}") == _git(moved, "rev-parse", "HEAD^{tree}")
    assert _fp(reference) != _fp(moved)


def test_the_fingerprint_moves_with_a_mode_change():
    match = verdicts.matcher(FILTERS, ("backend",))
    plain = [("100644", "1" * 40, "backend/run.sh")]
    executable = [("100755", "1" * 40, "backend/run.sh")]
    assert verdicts.fingerprint(BACKEND, match, plain, plain) != verdicts.fingerprint(
        BACKEND, match, executable, plain
    )


def test_the_fingerprint_ignores_files_outside_the_group(tmp_path):
    reference = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"}, "reference")
    other = _pr_repo(tmp_path, {**BASE, "frontend/x.ts": "X\n"}, {"backend/b.py": "b\n"}, "other")
    assert _fp(reference) == _fp(other)
    frontend = verdicts.Group("f", ("frontend",), ("j",), "j")
    assert _fp(reference, frontend) != _fp(other, frontend)


def test_the_fingerprint_is_per_group_and_per_version(tmp_path):
    repo = _pr_repo(tmp_path, BASE, {"backend/b.py": "b\n"})
    twin = verdicts.Group("h", ("backend",), ("j",), "j")
    assert _fp(repo) != _fp(repo, twin)


def test_head_and_base_are_hashed_as_separate_sides():
    match = verdicts.matcher(FILTERS, ("backend",))
    a = [("100644", "1" * 40, "backend/a.py")]
    b = [("100644", "2" * 40, "backend/a.py")]
    assert verdicts.fingerprint(BACKEND, match, a, b) != verdicts.fingerprint(BACKEND, match, b, a)
    # order of the listing does not matter, content does
    two = a + [("100644", "3" * 40, "backend/b.py")]
    assert verdicts.fingerprint(BACKEND, match, two, a) == verdicts.fingerprint(
        BACKEND, match, list(reversed(two)), a
    )


def test_group_key_shape():
    assert verdicts.group_key(GROUP["backend-lint"], "ab12") == "verdict-v1-backend-lint-ab12"


# ── Reading the markers ────────────────────────────────────────────────────

REF = "refs/pull/7/merge"
KEY = "verdict-v1-backend-lint-" + "a" * 64


def _cache(key: str, ref: str = REF) -> dict:
    return {"id": 1, "ref": ref, "key": key, "size_in_bytes": 20}


def test_passing_run_reads_the_run_id_off_the_key():
    assert verdicts.passing_run([_cache(f"{KEY}-1234-1")], REF, KEY) == "1234"


def test_passing_run_takes_the_earliest_run():
    caches = [_cache(f"{KEY}-900-2"), _cache(f"{KEY}-1000-1"), _cache(f"{KEY}-899-1")]
    assert verdicts.passing_run(caches, REF, KEY) == "899"


@pytest.mark.parametrize(
    "cache",
    [
        _cache(f"{KEY}-1234-1", ref="refs/pull/8/merge"),  # another pull request
        _cache(f"{KEY}-1234-1", ref="refs/heads/main"),  # a branch
        {"key": f"{KEY}-1234-1"},  # no ref at all
        _cache(f"{KEY[:-1]}b-1234-1"),  # another fingerprint
        _cache(f"{KEY}0-1234-1"),  # a longer fingerprint sharing the prefix
        _cache(f"{KEY}-1234"),  # no attempt
        _cache(f"{KEY}-x-1"),  # not a run id
        _cache(f"{KEY}-1234-1-extra"),
        _cache(KEY),
        {"ref": REF, "key": 5},
        "not a dict",
    ],
)
def test_passing_run_ignores_anything_but_this_prs_exact_marker(cache):
    assert verdicts.passing_run([cache], REF, KEY) is None


def test_the_listing_always_sends_the_ref_filter(monkeypatch):
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        page = int(next(a for a in args if a.startswith("page="))[len("page=") :])
        count = verdicts.PER_PAGE if page == 1 else 3
        body = {"actions_caches": [_cache(f"{KEY}-{page}{i}-1") for i in range(count)]}
        return subprocess.CompletedProcess(args, 0, stdout=json.dumps(body), stderr="")

    monkeypatch.setattr(verdicts.subprocess, "run", fake_run)
    caches = verdicts.gh_list_caches("o/r", REF, "verdict-v1-")
    assert len(caches) == verdicts.PER_PAGE + 3
    assert len(calls) == 2
    for args in calls:
        assert args[:5] == ["gh", "api", "-X", "GET", "repos/o/r/actions/caches"]
        assert f"ref={REF}" in args
        assert args[args.index(f"ref={REF}") - 1] == "-f"
        assert "key=verdict-v1-" in args
    assert "page=1" in calls[0] and "page=2" in calls[1]


def test_the_listing_gives_up_rather_than_paging_forever(monkeypatch):
    def fake_run(args, **kwargs):
        body = {"actions_caches": [_cache(f"{KEY}-1-1")] * verdicts.PER_PAGE}
        return subprocess.CompletedProcess(args, 0, stdout=json.dumps(body), stderr="")

    monkeypatch.setattr(verdicts.subprocess, "run", fake_run)
    with pytest.raises(verdicts.NoVerdictsError, match="more than"):
        verdicts.gh_list_caches("o/r", REF, "verdict-v1-")


@pytest.mark.parametrize(
    "outcome",
    [
        subprocess.CalledProcessError(1, ["gh"], stderr="HTTP 403: Resource not accessible"),
        FileNotFoundError("gh"),
        "not json",
        json.dumps({"message": "no caches key"}),
        json.dumps(["a list"]),
    ],
)
def test_a_failed_listing_raises_no_verdicts(monkeypatch, outcome):
    def fake_run(args, **kwargs):
        if isinstance(outcome, BaseException):
            raise outcome
        return subprocess.CompletedProcess(args, 0, stdout=outcome, stderr="")

    monkeypatch.setattr(verdicts.subprocess, "run", fake_run)
    with pytest.raises(verdicts.NoVerdictsError, match="listing the caches failed"):
        verdicts.gh_list_caches("o/r", REF, "verdict-v1-")


# ── End to end ─────────────────────────────────────────────────────────────


def _workflow_repo(tmp_path: Path) -> Path:
    """A PR merge commit over a tree carrying the real ci.yml."""
    files = {**BASE, ".github/workflows/ci.yml": CI_TEXT, "mcp-server/m.py": "m\n"}
    return _pr_repo(tmp_path, files, {"backend/b.py": "b\n"})


def _main(repo: Path, tmp_path: Path, list_caches, pr: str = "7"):
    out, summary = tmp_path / "out", tmp_path / "summary"
    env = {
        "GITHUB_OUTPUT": str(out),
        "GITHUB_STEP_SUMMARY": str(summary),
        "GITHUB_SERVER_URL": "https://github.example",
    }
    code = verdicts.main(
        ["--pr", pr, "--repo", "o/r", "--workflow", str(repo / ".github/workflows/ci.yml")],
        git=_git_in(repo),
        list_caches=list_caches,
        env=env,
    )
    assert code == 0
    lines = dict(line.split("=", 1) for line in out.read_text().splitlines())
    return lines, summary.read_text()


def test_a_marker_for_this_pr_skips_exactly_its_group(tmp_path, capsys):
    repo = _workflow_repo(tmp_path)
    seen: list[tuple[str, str, str]] = []

    def list_none(repo_name, ref, prefix):
        seen.append((repo_name, ref, prefix))
        return []

    first, summary = _main(repo, tmp_path, list_none)
    assert seen == [("o/r", "refs/pull/7/merge", "verdict-v1-")]
    assert all(first[f"done_{g.ident}"] == "false" for g in verdicts.GROUPS)
    assert "every job runs" in summary
    key = first["key_backend_lint"]
    assert key.startswith("verdict-v1-backend-lint-")

    def list_one(repo_name, ref, prefix):
        return [_cache(f"{key}-4242-1", ref=ref), _cache(f"{key}-4243-1", ref="refs/pull/9/merge")]

    second, summary = _main(repo, tmp_path, list_one)
    assert second["done_backend_lint"] == "true"
    assert {g.ident for g in verdicts.GROUPS if second[f"done_{g.ident}"] == "true"} == {
        "backend_lint"
    }
    assert second == {**first, "done_backend_lint": "true"}
    assert "[run 4242](https://github.example/o/r/actions/runs/4242)" in summary
    assert "`backend-lint`" in summary and "**skipped**" in summary
    assert "skip (passed in run 4242)" in capsys.readouterr().out


def test_every_group_gets_both_outputs(tmp_path):
    repo = _workflow_repo(tmp_path)
    lines, _ = _main(repo, tmp_path, lambda *a: [])
    assert set(lines) == {f"{k}_{g.ident}" for g in verdicts.GROUPS for k in ("done", "key")}
    assert len({lines[f"key_{g.ident}"] for g in verdicts.GROUPS}) == len(verdicts.GROUPS)


def test_a_failed_listing_runs_everything_but_still_records(tmp_path, capsys):
    repo = _workflow_repo(tmp_path)

    def broken(*args):
        raise verdicts.NoVerdictsError("listing the caches failed: HTTP 500")

    lines, summary = _main(repo, tmp_path, broken)
    assert all(lines[f"done_{g.ident}"] == "false" for g in verdicts.GROUPS)
    assert all(lines[f"key_{g.ident}"].startswith("verdict-v1-") for g in verdicts.GROUPS)
    assert "HTTP 500" in summary and "every job runs" in summary
    assert "::warning title=CI verdict cache::listing the caches failed" in capsys.readouterr().out


def test_an_unexpected_listing_error_runs_everything(tmp_path, capsys):
    repo = _workflow_repo(tmp_path)

    def broken(*args):
        raise RuntimeError("boom")

    lines, summary = _main(repo, tmp_path, broken)
    assert all(lines[f"done_{g.ident}"] == "false" for g in verdicts.GROUPS)
    assert "RuntimeError: boom" in summary
    assert "::warning" in capsys.readouterr().out


def test_no_merge_commit_means_no_keys_and_no_skips(tmp_path, capsys):
    repo = _workflow_repo(tmp_path)
    _git(repo, "commit", "-q", "--allow-empty", "-m", "linear")
    called = []
    lines, summary = _main(repo, tmp_path, lambda *a: called.append(a) or [])
    assert called == []
    assert all(lines[f"done_{g.ident}"] == "false" for g in verdicts.GROUPS)
    assert all(lines[f"key_{g.ident}"] == "" for g in verdicts.GROUPS)
    assert "parent" in summary
    assert "::warning" in capsys.readouterr().out


def test_an_unexpected_error_anywhere_runs_everything(tmp_path):
    repo = _workflow_repo(tmp_path)

    def git(*args):
        raise ValueError("odd")

    out = tmp_path / "out"
    verdicts.main(
        ["--pr", "7", "--repo", "o/r", "--workflow", str(repo / ".github/workflows/ci.yml")],
        git=git,
        list_caches=lambda *a: [],
        env={"GITHUB_OUTPUT": str(out), "GITHUB_STEP_SUMMARY": str(tmp_path / "s")},
    )
    assert "done_backend_lint=false" in out.read_text()
    assert "unexpected ValueError: odd" in (tmp_path / "s").read_text()


@pytest.mark.parametrize("pr", ["0", "", "7; rm -rf /", "-1", "07"])
def test_a_bad_pull_request_number_runs_everything(tmp_path, pr):
    repo = _workflow_repo(tmp_path)
    lines, summary = _main(repo, tmp_path, lambda *a: [_cache("x")], pr=pr)
    assert all(lines[f"done_{g.ident}"] == "false" for g in verdicts.GROUPS)
    assert "not a pull request number" in summary


def test_a_bad_repository_name_runs_everything(tmp_path):
    repo = _workflow_repo(tmp_path)
    with pytest.raises(verdicts.NoVerdictsError, match="not a repository name"):
        verdicts.lookup(CI_TEXT, _git_in(repo), lambda *a: [], "o/r/../x", "7")


def test_an_unreadable_workflow_runs_everything(tmp_path):
    repo = _workflow_repo(tmp_path)
    (repo / ".github/workflows/ci.yml").write_text(
        CI_TEXT.replace("- 'backend/**'", "- 'backend/*.py'", 1)
    )
    lines, summary = _main(repo, tmp_path, lambda *a: [])
    assert all(lines[f"key_{g.ident}"] == "" for g in verdicts.GROUPS)
    assert "unsupported filter pattern 'backend/*.py'" in summary


def test_outputs_and_summary_without_a_runner(tmp_path, capsys):
    """Outside Actions, both go to stdout rather than failing."""
    repo = _workflow_repo(tmp_path)
    verdicts.main(
        ["--pr", "7", "--repo", "o/r", "--workflow", str(repo / ".github/workflows/ci.yml")],
        git=_git_in(repo),
        list_caches=lambda *a: [],
        env={},
    )
    out = capsys.readouterr().out
    assert "done_backend_lint=false" in out
    assert "## Verdicts this pull request already earned" in out


def test_summary_lists_the_groups_that_still_run():
    skipped = verdicts.Verdict(GROUP["backend-integration"], "k1", "77")
    ran = verdicts.Verdict(GROUP["frontend-lint"], "k2", None)
    text = verdicts.summary([skipped, ran], "https://gh", "o/r", None)
    assert (
        "| backend-integration | `backend-test-shards`, `backend-test-integration` | "
        "[run 77](https://gh/o/r/actions/runs/77) |"
    ) in text
    assert "Every other group runs: frontend-lint." in text
    only = verdicts.summary([skipped], "https://gh", "o/r", None)
    assert "Every other group runs" not in only


def test_outputs_for_missing_groups_are_false_and_empty():
    lines = verdicts.outputs([verdicts.Verdict(GROUP["mcp-test"], "kk", "5")])
    assert "done_mcp_test=true" in lines and "key_mcp_test=kk" in lines
    assert "done_backend_lint=false" in lines and "key_backend_lint=" in lines
    assert len(lines) == 2 * len(verdicts.GROUPS)
