"""The mutation-testing scripts under ``scripts/mutation/``.

They decide which mutants a pull request is judged on and whether it passes,
so a bug in them is a gate that waves everything through (or blocks
everything). Loaded off disk like ``test_teax_grants_lint.py`` loads the teax
CLI; the scripts import each other by bare name, so their directory goes on
``sys.path`` first.
"""

from __future__ import annotations

import difflib
import fnmatch
import importlib
import json
import subprocess
import sys
import textwrap
import time
import tomllib
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = REPO / "scripts" / "mutation"
sys.path.insert(0, str(SCRIPTS))

changed_lines = importlib.import_module("changed_lines")
gate = importlib.import_module("gate")
mutmut_scope = importlib.import_module("mutmut_scope")
stryker_scope = importlib.import_module("stryker_scope")
shadow_root = importlib.import_module("shadow_root")


# ── changed_lines ────────────────────────────────────────────────────────────

DIFF = """\
diff --git a/backend/app/x.py b/backend/app/x.py
index 1..2 100644
--- a/backend/app/x.py
+++ b/backend/app/x.py
@@ -10,0 +11,3 @@ def f():
+    a = 1
+    b = 2
+    c = 3
@@ -20 +23 @@ def g():
-    old
+    new
@@ -30,2 +33,0 @@ def h():
-    gone
-    gone too
@@ -40,2 +40,2 @@ def i():
-    x
-    y
+    x2
+    y2
diff --git a/backend/app/new.py b/backend/app/new.py
new file mode 100644
--- /dev/null
+++ b/backend/app/new.py
@@ -0,0 +1,2 @@
+def n():
+    return 1
diff --git a/backend/app/dead.py b/backend/app/dead.py
deleted file mode 100644
--- a/backend/app/dead.py
+++ /dev/null
@@ -1,2 +0,0 @@
-def d():
-    return 0
"""


class TestChangedLines:
    def test_new_side_ranges_per_file(self):
        assert changed_lines.parse_unified_diff(DIFF) == {
            "backend/app/x.py": [(11, 13), (23, 23), (40, 41)],
            "backend/app/new.py": [(1, 2)],
        }

    def test_a_pure_deletion_contributes_no_line(self):
        ranges = changed_lines.parse_unified_diff(DIFF)["backend/app/x.py"]
        assert not changed_lines.touches(ranges, 33)

    def test_a_deleted_file_is_absent(self):
        assert "backend/app/dead.py" not in changed_lines.parse_unified_diff(DIFF)

    def test_crlf_headers_and_adjacent_hunks_merge(self):
        text = "+++ b/f.py\r\n@@ -1 +1 @@\r\n@@ -2 +2,2 @@\r\n"
        assert changed_lines.parse_unified_diff(text) == {"f.py": [(1, 3)]}

    @pytest.mark.parametrize(
        "first, last, expected",
        [(10, None, False), (11, None, True), (13, 15, True), (14, 22, False), (20, 25, True)],
    )
    def test_touches(self, first, last, expected):
        assert changed_lines.touches([(11, 13), (23, 23)], first, last) is expected

    def test_against_a_real_repository(self, tmp_path):
        def git(*args):
            subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

        git("init", "-q", "-b", "main")
        git("config", "user.email", "t@example.com")
        git("config", "user.name", "t")
        (tmp_path / "a.py").write_text("one\ntwo\nthree\n")
        git("add", ".")
        git("commit", "-qm", "base")
        git("checkout", "-qb", "feature")
        (tmp_path / "a.py").write_text("one\nTWO\nthree\nfour\n")
        git("commit", "-qam", "change")
        (tmp_path / "b.py").write_text("uncommitted\n")
        git("add", "b.py")  # staged, not committed: the working tree counts
        assert changed_lines.changed_lines("main", ["."], repo=tmp_path) == {
            "a.py": [(2, 2), (4, 4)],
            "b.py": [(1, 1)],
        }


# ── gate ─────────────────────────────────────────────────────────────────────

FLOORS = {
    "diff": {"backend": 60, "frontend": 60, "mcp": 60, "min_mutants": 4},
    "suite": {"backend": 50, "frontend": 50, "mcp": 50},
    "modules": {"backend/app/critical.py": 80},
}


def rec(status, file="backend/app/x.py", line=1, raw=None, function="f"):
    return {
        "suite": "backend",
        "file": file,
        "function": function,
        "line": line,
        "status": status,
        "raw_status": raw or status,
        "id": f"m{line}",
    }


def write(tmp_path, name, data):
    path = tmp_path / name
    path.write_text(json.dumps(data))
    return path


def floors_file(tmp_path, floors=FLOORS):
    lines = []
    for section, values in floors.items():
        lines.append(f"[{section}]")
        lines += [f'"{k}" = {v}' for k, v in values.items()]
    path = tmp_path / "floors.toml"
    path.write_text("\n".join(lines) + "\n")
    return path


class TestGate:
    def test_score_counts_killed_over_killed_plus_survived(self):
        t = gate.tally([rec("killed"), rec("killed"), rec("survived"), rec("excluded")])
        assert (t.scored, round(t.score, 1)) == (3, 66.7)

    def test_a_mutant_no_test_reaches_counts_as_survived(self):
        assert mutmut_scope.STATUS["no tests"] == "survived"
        assert stryker_scope.STATUS["NoCoverage"] == "survived"

    def test_diff_scope_fails_under_the_floor(self, tmp_path, capsys):
        records = [rec("killed", line=1), *[rec("survived", line=n) for n in (2, 3, 4)]]
        code = gate.main(
            [
                "--suite",
                "backend",
                "--scope",
                "diff",
                "--floors",
                str(floors_file(tmp_path)),
                "--records",
                str(write(tmp_path, "r.json", records)),
            ]
        )
        out = capsys.readouterr().out
        assert code == 1
        assert "**FAIL**" in out and "`backend/app/x.py:2`" in out

    def test_diff_scope_under_min_mutants_warns_instead_of_failing(self, tmp_path, capsys):
        records = [rec("survived", line=2)]
        code = gate.main(
            [
                "--suite",
                "backend",
                "--scope",
                "diff",
                "--floors",
                str(floors_file(tmp_path)),
                "--records",
                str(write(tmp_path, "r.json", records)),
            ]
        )
        assert code == 0
        assert "::warning::" in capsys.readouterr().out

    def test_a_pending_mutant_is_an_incomplete_run(self, tmp_path):
        records = [rec("killed"), rec("pending", raw="not checked")]
        args = ["--suite", "backend", "--scope", "suite", "--floors", str(floors_file(tmp_path))]
        path = write(tmp_path, "r.json", records)
        assert gate.main([*args, "--records", str(path)]) == 2
        assert gate.main([*args, "--records", str(path), "--informational"]) == 2

    def test_a_partial_baseline_reports_progress_and_defers_its_floors(self):
        records = [
            rec("killed", line=1),
            rec("survived", line=2),
            rec("pending", line=3, raw="not checked"),
            rec("survived", file="backend/app/critical.py"),
            rec("pending", file="backend/app/critical.py", line=2, raw="not checked"),
        ]
        strict = gate.judge(records, "backend", "suite", FLOORS)
        assert strict.incomplete and not strict.passed
        partial = gate.judge(records, "backend", "suite", FLOORS, allow_pending=True)
        assert not partial.incomplete
        assert partial.passed  # 33% < 50% and 0% < 80%, but neither scope is fully measured
        text = "\n".join(partial.lines)
        assert "3 of 5 mutants measured" in text and "1 still to measure" in text

    def test_a_partial_baseline_enforces_a_fully_measured_module(self):
        records = [
            rec("pending", line=3, raw="not checked"),
            rec("survived", file="backend/app/critical.py"),
        ]
        assert not gate.judge(records, "backend", "suite", FLOORS, allow_pending=True).passed

    def test_allow_pending_does_not_relax_the_diff_gate(self):
        records = [rec("killed"), rec("pending", raw="not checked")]
        assert gate.judge(records, "backend", "diff", FLOORS, allow_pending=True).incomplete

    def test_suite_scope_enforces_module_floors(self, tmp_path):
        records = [
            *[rec("killed", line=n) for n in range(10)],
            rec("killed", file="backend/app/critical.py"),
            rec("survived", file="backend/app/critical.py", line=2),
        ]
        verdict = gate.judge(records, "backend", "suite", FLOORS)
        assert not verdict.passed  # 91.7% overall, but the critical module sits at 50%
        assert any("critical.py" in line and "**FAIL**" in line for line in verdict.lines)

    def test_a_listed_module_without_records_is_never_a_silent_pass(self):
        records = [rec("killed")]
        complete = gate.judge(records, "backend", "suite", FLOORS)
        assert not complete.passed
        assert any("not measured" in line for line in complete.lines)
        records.append(rec("pending", line=2, raw="not checked"))
        assert gate.judge(records, "backend", "suite", FLOORS, allow_pending=True).passed

    def test_module_floors_of_another_suite_are_ignored(self):
        floors = {**FLOORS, "modules": {"frontend/src/lib/a.ts": 100}}
        assert gate.judge([rec("killed")], "backend", "suite", floors).passed

    def test_informational_reports_but_passes(self, tmp_path):
        records = [rec("survived", line=n) for n in range(5)]
        args = ["--suite", "backend", "--scope", "suite", "--floors", str(floors_file(tmp_path))]
        path = write(tmp_path, "r.json", records)
        assert gate.main([*args, "--records", str(path)]) == 1
        assert gate.main([*args, "--records", str(path), "--informational"]) == 0

    def test_records_and_previous_runs_may_span_several_shard_files(self, tmp_path, capsys):
        shard1 = write(tmp_path, "s1.json", [rec("killed", line=1)])
        shard2 = write(tmp_path, "s2.json", [rec("survived", line=2)])
        before = write(tmp_path, "p1.json", [rec("killed", line=1), rec("killed", line=2)])
        code = gate.main(
            [
                "--suite",
                "backend",
                "--scope",
                "suite",
                "--floors",
                str(floors_file(tmp_path, {**FLOORS, "modules": {}})),
                "--records",
                str(shard1),
                str(shard2),
                "--previous",
                str(before),
                str(tmp_path / "missing.json"),
            ]
        )
        out = capsys.readouterr().out
        assert code == 0  # 50% meets the 50% suite floor
        assert "of 2 mutants killed" in out and "score dropped" in out

    def test_backlog_lists_critical_modules_first(self):
        records = [
            *[rec("survived", file="backend/app/busy.py", line=n) for n in range(5)],
            rec("survived", file="backend/app/critical.py", function="guard"),
        ]
        body = "\n".join(gate.backlog(records, "backend", FLOORS))
        assert body.index("critical.py") < body.index("busy.py")
        assert "`guard` (1)" in body

    def test_regressions_name_files_whose_score_fell(self):
        before = [rec("killed", line=1), rec("killed", line=2)]
        now = [rec("killed", line=1), rec("survived", line=2)]
        assert any("x.py" in line for line in gate.regressions(now, before))
        assert gate.regressions(before, before) == []

    @pytest.mark.parametrize(
        "patch",
        [
            {"diff": {**FLOORS["diff"], "backend": 101}},
            {"suite": {"backend": 50, "frontend": 50}},
            {"diff": {**FLOORS["diff"], "min_mutants": 0}},
            {"modules": {"docs/x.md": 50}},
        ],
    )
    def test_invalid_floors_are_refused(self, patch):
        with pytest.raises(ValueError):
            gate.validate_floors({**FLOORS, **patch})

    def test_the_committed_floors_are_valid(self):
        floors = gate.load_floors()
        for module in floors.get("modules", {}):
            assert (REPO / module).is_file(), f"[modules] names a missing file: {module}"


# ── mutmut_scope ─────────────────────────────────────────────────────────────

SOURCE = textwrap.dedent(
    '''\
    """Module."""

    import functools


    def plain(a, b):
        """Doc."""
        if a < b:
            return a
        return b


    # A comment that libcst hands to the next function.
    @functools.cache
    def decorated(x):
        return x + 1


    class Thing:
        def method(self, n):
            total = 0
            for i in range(n):
                total += i
            return total

        @staticmethod
        def helper(v):
            return v * 2


    @router.get("/route")
    async def route_handler(x):
        return x
    '''
)


def mutmut_style_diff(source, first, last, line, old, new):
    """What `mutmut show` prints: a unified diff of the function's own lines."""
    lines = source.splitlines()[first - 1 : last]
    mutated = list(lines)
    index = line - first
    assert mutated[index].strip() == old
    mutated[index] = mutated[index].replace(old, new)
    body = "\n".join(lines).strip().split("\n")
    changed = "\n".join(mutated).strip().split("\n")
    return "\n".join(
        difflib.unified_diff(body, changed, fromfile="x.py", tofile="x.py", lineterm="")
    )


class TestMutmutNames:
    @pytest.mark.parametrize(
        "rel, module",
        [
            ("app/services/lifecycle.py", "app.services.lifecycle"),
            ("app/ext/__init__.py", "app.ext"),
        ],
    )
    def test_module_of(self, rel, module):
        assert mutmut_scope.module_of(rel) == module

    def test_patterns_cover_functions_and_methods_of_one_file_only(self):
        import fnmatch

        patterns = mutmut_scope.patterns_for("app/ext/__init__.py")
        hits = ["app.ext.x_f__mutmut_1", "app.ext.xǁCǁm__mutmut_2"]
        misses = ["app.ext.cron.x_parse__mutmut_1"]
        assert all(any(fnmatch.fnmatch(n, p) for p in patterns) for n in hits)
        assert not any(fnmatch.fnmatch(n, p) for n in misses for p in patterns)

    @pytest.mark.parametrize(
        "name, expected",
        [
            ("app.x.x_plain__mutmut_3", ("app.x", "plain", None)),
            ("app.x.xǁThingǁmethod__mutmut_12", ("app.x", "method", "Thing")),
            ("app.x.x__private__mutmut_1", ("app.x", "_private", None)),
        ],
    )
    def test_split_name(self, name, expected):
        assert mutmut_scope.split_name(name) == expected

    def test_should_mutate_mirrors_the_config(self):
        config = {
            "source_paths": ["app"],
            "do_not_mutate": ["app/services/seed*"],
        }
        assert mutmut_scope.should_mutate("app/services/lifecycle.py", config)
        assert not mutmut_scope.should_mutate("app/services/seed_demo.py", config)
        assert not mutmut_scope.should_mutate("tests/test_x.py", config)
        assert not mutmut_scope.should_mutate("app/data/x.json", config)
        assert not mutmut_scope.should_mutate("app/a.py", {**config, "only_mutate": ["app/b.py"]})


class TestScoping:
    def test_touched_functions(self):
        assert mutmut_scope.touched_functions(SOURCE, [(8, 8)]) == [("plain", None)]
        # @functools.cache: mutmut skips any decorator but staticmethod/classmethod
        assert mutmut_scope.touched_functions(SOURCE, [(14, 14), (22, 22)]) == [
            ("method", "Thing"),
        ]
        assert mutmut_scope.touched_functions(SOURCE, [(1, 3)]) == []

    def test_decorated_functions_are_reported_not_mutated(self, suite_repo, monkeypatch, capsys):
        assert mutmut_scope.touched_functions(SOURCE, [(26, 34)]) == [("helper", "Thing")]
        assert mutmut_scope.touched_functions(SOURCE, [(14, 34)], mutated=False) == [
            ("decorated", None),
            ("route_handler", None),
        ]
        summary = suite_repo / "summary.md"
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
        monkeypatch.setattr(mutmut_scope, "mutmut", lambda *a, **k: pytest.fail("ran mutmut"))
        assert mutmut_scope.run("backend", {"backend/app/x.py": [[33, 34]]}, 2, suite_repo) == 0
        assert "`backend/app/x.py: route_handler`" in summary.read_text()
        assert "::notice::" in capsys.readouterr().out

    def test_function_pattern(self):
        assert mutmut_scope.function_pattern("app/x.py", "plain", None) == "app.x.x_plain__mutmut_*"
        assert (
            mutmut_scope.function_pattern("app/x.py", "method", "Thing")
            == "app.x.xǁThingǁmethod__mutmut_*"
        )

    def test_shards_partition_the_mutable_files(self, suite_repo):
        for n in range(1, 4):
            (suite_repo / "backend" / "app" / f"m{n}.py").write_text("def f():\n    return 1\n" * n)
        every = mutmut_scope.mutable_files("backend", suite_repo)
        assert "app/seed.py" not in every
        shards = [mutmut_scope.shard_files("backend", f"{k}/3", suite_repo) for k in (1, 2, 3)]
        assert sorted(f for s in shards for f in s) == every
        assert all(shards)
        with pytest.raises(ValueError):
            mutmut_scope.parse_shard("4/3")


class TestLocate:
    def test_function_spans_include_decorators(self):
        assert mutmut_scope.function_span(SOURCE, "plain", None) == (6, 10)
        assert mutmut_scope.function_span(SOURCE, "decorated", None) == (14, 16)
        assert mutmut_scope.function_span(SOURCE, "method", "Thing") == (20, 24)
        assert mutmut_scope.function_span(SOURCE, "missing", None) is None

    def test_diff_line_one_is_the_comment_above_a_function(self):
        lines = SOURCE.splitlines()
        assert mutmut_scope.diff_origin(lines, 14) == 13
        assert mutmut_scope.diff_origin(lines, 6) == 6

    @pytest.mark.parametrize(
        "func, cls, first, last, line, old, new",
        [
            ("plain", None, 6, 10, 8, "if a < b:", "if a <= b:"),
            ("decorated", None, 13, 16, 16, "return x + 1", "return x - 1"),
            ("method", "Thing", 20, 24, 23, "total += i", "total -= i"),
        ],
    )
    def test_a_mutant_lands_on_its_source_line(self, func, cls, first, last, line, old, new):
        diff = mutmut_style_diff(SOURCE, first, last, line, old, new)
        found, _ = mutmut_scope.locate(SOURCE, func, cls, diff)
        assert found == [line]

    def test_an_unplaceable_diff_returns_no_line_but_the_span(self):
        found, span = mutmut_scope.locate(SOURCE, "plain", None, "garbage")
        assert (found, span) == ([], (6, 10))


@pytest.fixture
def suite_repo(tmp_path):
    backend = tmp_path / "backend"
    (backend / "app").mkdir(parents=True)
    (backend / "tests").mkdir()
    (backend / "alembic").mkdir()
    (backend / "pyproject.toml").write_text(
        '[tool.mutmut]\nsource_paths = ["app"]\ndo_not_mutate = ["app/seed.py"]\n'
    )
    (backend / "app" / "x.py").write_text(SOURCE)
    (backend / "app" / "seed.py").write_text("def s():\n    return 1\n")
    (tmp_path / "VERSION").write_text("1.0.0\n")
    (tmp_path / "frontend").mkdir()
    (tmp_path / ".git").mkdir()
    return tmp_path


class TestMutmutRunAndCollect:
    def test_run_scopes_mutmut_to_the_changed_files(self, suite_repo, monkeypatch):
        calls = []
        monkeypatch.setattr(
            mutmut_scope,
            "mutmut",
            lambda d, *a, stream=False, budget=None: (
                calls.append(a) or subprocess.CompletedProcess(a, 0, "", "")
            ),
        )
        changed = {
            "backend/app/x.py": [[8, 8]],
            "backend/app/seed.py": [[1, 2]],
            "docs/a.md": [[1, 1]],
        }
        assert mutmut_scope.run("backend", changed, 3, repo=suite_repo) == 0
        # only the touched function, not the whole file
        assert calls == [("run", "--max-children", "3", "app.x.x_plain__mutmut_*")]
        assert (suite_repo / "backend" / "mutants").is_symlink()

    @staticmethod
    def fake_mutmut(monkeypatch, calls, meta=None, generate=None):
        """mutmut as the nightly sees it: the generate-only call stops on
        "nothing matches" (after writing ``meta``, as generation does)."""

        def fake(d, *a, stream=False, budget=None):
            calls.append((a, budget))
            if a[-1] == mutmut_scope._GENERATE_ONLY:
                if generate is not None:
                    return generate
                if meta is not None:
                    path = d / "mutants" / "app" / "x.py.meta"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps({"exit_code_by_key": meta}))
                # captured, mutmut's assertion lands on stderr (verified on 3.8.0)
                err = f"AssertionError: {mutmut_scope._NOTHING_MATCHES}"
                return subprocess.CompletedProcess(a, 1, "Listing all tests", err)
            return subprocess.CompletedProcess(a, 0, "", "")

        monkeypatch.setattr(mutmut_scope, "mutmut", fake)

    def test_a_shard_never_generated_runs_whole_files(self, suite_repo, monkeypatch):
        calls = []
        self.fake_mutmut(monkeypatch, calls)
        assert mutmut_scope.run("backend", None, 2, suite_repo, shard="1/1", budget=5) == 0
        generate, test = calls
        assert generate == (("run", "--max-children", "2", mutmut_scope._GENERATE_ONLY), None)
        assert test[0] == ("run", "--max-children", "2", "app.x.x_*", "app.x.xǁ*")
        assert 1 <= test[1] <= 5  # what generating took comes off the budget

    def test_a_shard_names_only_functions_with_an_unchecked_mutant(self, suite_repo, monkeypatch):
        """mutmut re-tests every mutant named on its command line, verdict or
        not: naming the shard's files re-tested its whole baseline each night,
        and the unchecked tail never came up (run 12, 2026-10-07)."""
        calls = []
        meta = {
            "app.x.x_plain__mutmut_1": 1,
            "app.x.x_plain__mutmut_2": 0,
            "app.x.x_other__mutmut_1": None,  # unchecked, or reset by a code change
            "app.x.x_other__mutmut_2": 1,
            "app.x.xǁThingǁmethod__mutmut_1": None,
            "app.x.xǁThingǁmethod__mutmut_2": None,
            "app.x.x_untested__mutmut_1": 33,  # no tests: a verdict too
        }
        self.fake_mutmut(monkeypatch, calls, meta=meta)
        assert mutmut_scope.run("backend", None, 2, suite_repo, shard="1/1", budget=5) == 0
        assert calls[-1][0] == (
            "run",
            "--max-children",
            "2",
            # partly checked: the one mutant by name, so its killed sibling is not re-run
            "app.x.x_other__mutmut_1",
            # nothing checked yet: the function's pattern
            "app.x.xǁThingǁmethod__mutmut_*",
        )
        # the names pick out exactly the unchecked mutants and no others
        names = list(meta)
        picked = [n for n in names if any(fnmatch.fnmatch(n, p) for p in calls[-1][0][3:])]
        assert picked == [n for n, code in meta.items() if code is None]

    def test_a_shard_reopens_survivors_after_generating_and_before_naming(
        self, suite_repo, monkeypatch
    ):
        calls, order = [], []
        self.fake_mutmut(monkeypatch, calls, meta={"app.x.x_plain__mutmut_1": 0})

        def reopen(directory, files):
            order.append(("reopen", list(calls), files))
            meta = directory / "mutants" / "app" / "x.py.meta"
            meta.write_text(json.dumps({"exit_code_by_key": {"app.x.x_plain__mutmut_1": None}}))
            return 1

        monkeypatch.setattr(mutmut_scope, "reopen_survivors", reopen)
        assert mutmut_scope.run("backend", None, 2, suite_repo, shard="1/1", budget=5) == 0
        (step, before, files) = order[0]
        assert [c[0][-1] for c in before] == [mutmut_scope._GENERATE_ONLY]
        assert files == ["app/x.py"]
        assert calls[-1][0][-1] == "app.x.x_plain__mutmut_*"

    def test_a_shard_with_every_verdict_in_place_tests_nothing(
        self, suite_repo, monkeypatch, capsys
    ):
        calls = []
        self.fake_mutmut(monkeypatch, calls, meta={"app.x.x_plain__mutmut_1": 1})
        assert mutmut_scope.run("backend", None, 2, suite_repo, shard="1/1", budget=5) == 0
        assert len(calls) == 1  # generated, then nothing to test
        assert "has a verdict" in capsys.readouterr().out

    def test_a_failure_while_generating_stops_the_shard(self, suite_repo, monkeypatch):
        calls = []
        failed = subprocess.CompletedProcess([], 2, "SyntaxError", "")
        self.fake_mutmut(monkeypatch, calls, generate=failed)
        assert mutmut_scope.run("backend", None, 2, suite_repo, shard="1/1") == 2
        assert len(calls) == 1

    def test_named_files_are_retested_on_purpose(self, suite_repo, monkeypatch):
        """``--files`` (and a PR's changed functions) still name everything:
        there a re-test is what was asked for."""
        calls = []
        self.fake_mutmut(monkeypatch, calls, meta={"app.x.x_plain__mutmut_1": 1})
        assert mutmut_scope.run("backend", None, 2, suite_repo, files=["app/x.py"]) == 0
        assert [c[0] for c in calls] == [("run", "--max-children", "2", "app.x.x_*", "app.x.xǁ*")]

    def test_run_with_nothing_mutable_changed_does_not_start_mutmut(self, suite_repo, monkeypatch):
        monkeypatch.setattr(mutmut_scope, "mutmut", lambda *a, **k: pytest.fail("ran mutmut"))
        assert mutmut_scope.run("backend", {"backend/app/seed.py": [[1, 1]]}, 2, suite_repo) == 0

    def test_run_treats_a_file_without_functions_as_nothing_to_do(self, suite_repo, monkeypatch):
        out = "AssertionError: Filtered for specific mutants, but nothing matches"
        monkeypatch.setattr(
            mutmut_scope, "mutmut", lambda *a, **k: subprocess.CompletedProcess(a, 1, out, "")
        )
        assert mutmut_scope.run("backend", {"backend/app/x.py": [[8, 8]]}, 2, suite_repo) == 0

    def test_a_change_outside_any_function_mutates_nothing(self, suite_repo, monkeypatch):
        monkeypatch.setattr(mutmut_scope, "mutmut", lambda *a, **k: pytest.fail("ran mutmut"))
        assert mutmut_scope.run("backend", {"backend/app/x.py": [[1, 3]]}, 2, suite_repo) == 0

    def test_the_budget_stops_mutmut_cleanly(self, tmp_path, monkeypatch, capsys):
        stand_in = "import time; print('started', flush=True); time.sleep(60)"
        monkeypatch.setattr(mutmut_scope, "MUTMUT", [sys.executable, "-c", stand_in])
        result = mutmut_scope.mutmut(tmp_path, stream=True, budget=0.02)
        assert result.returncode == 0
        assert "Time budget of 0.02 min reached" in capsys.readouterr().out

    def test_a_real_mutmut_failure_propagates(self, suite_repo, monkeypatch):
        monkeypatch.setattr(
            mutmut_scope, "mutmut", lambda *a, **k: subprocess.CompletedProcess(a, 1, "boom", "")
        )
        assert mutmut_scope.run("backend", None, 2, suite_repo) == 1

    def test_collect_keeps_only_mutants_on_changed_lines(self, suite_repo, monkeypatch):
        on_line = mutmut_style_diff(SOURCE, 6, 10, 8, "if a < b:", "if a <= b:")
        off_line = mutmut_style_diff(SOURCE, 6, 10, 10, "return b", "return None")
        method = mutmut_style_diff(SOURCE, 20, 24, 23, "total += i", "total -= i")
        shows = {
            "app.x.x_plain__mutmut_1": on_line,
            "app.x.x_plain__mutmut_2": off_line,
            "app.x.xǁThingǁmethod__mutmut_1": method,
        }
        statuses = {
            "app.x.x_plain__mutmut_1": "no tests",
            "app.x.x_plain__mutmut_2": "survived",
            "app.x.xǁThingǁmethod__mutmut_1": "killed",
        }

        def fake(directory, *args, stream=False):
            if args[0] == "results":
                text = "\n".join(f"    {k}: {v}" for k, v in statuses.items())
                return subprocess.CompletedProcess(args, 0, text, "")
            return subprocess.CompletedProcess(args, 0, f"# {args[1]}\n{shows[args[1]]}", "")

        monkeypatch.setattr(mutmut_scope, "mutmut", fake)
        records = mutmut_scope.collect(
            "backend", {"backend/app/x.py": [[8, 8], [23, 23]]}, repo=suite_repo, workers=1
        )
        assert [(r["id"], r["line"], r["status"]) for r in records] == [
            ("app.x.x_plain__mutmut_1", 8, "survived"),
            ("app.x.xǁThingǁmethod__mutmut_1", 23, "killed"),
        ]
        assert records[1]["function"] == "Thing.method"
        assert "-    if a < b:" in records[0]["description"]

    def test_collect_without_a_change_returns_every_mutant(self, suite_repo, monkeypatch):
        text = "    app.x.x_plain__mutmut_1: killed\n    app.x.x_plain__mutmut_2: not checked\n"
        monkeypatch.setattr(
            mutmut_scope, "mutmut", lambda *a, **k: subprocess.CompletedProcess(a, 0, text, "")
        )
        records = mutmut_scope.collect("backend", None, repo=suite_repo)
        assert [r["status"] for r in records] == ["killed", "pending"]
        assert {r["file"] for r in records} == {"backend/app/x.py"}


# ── stryker_scope ────────────────────────────────────────────────────────────


def survivors_suite(tmp_path, verdicts, tests_by_function, tests, commit="abc123"):
    """A suite as a cached nightly leaves it: test modules, mutmut's stats and
    one file's verdicts."""
    suite = tmp_path / "suite"
    for rel, text in tests.items():
        (suite / rel).parent.mkdir(parents=True, exist_ok=True)
        (suite / rel).write_text(text)
    mutants = suite / "mutants"
    (mutants / "app").mkdir(parents=True)
    (mutants / "mutmut-stats.json").write_text(
        json.dumps({"tests_by_mangled_function_name": tests_by_function, "git_commit": commit})
    )
    (mutants / "app" / "x.py.meta").write_text(json.dumps({"exit_code_by_key": verdicts}))
    return suite


def verdicts_of(suite):
    return json.loads((suite / "mutants" / "app" / "x.py.meta").read_text())["exit_code_by_key"]


class TestReopenSurvivors:
    """mutmut keeps a survivor's verdict until its function's code changes, so
    the kills a tests-only PR adds never reached the nightly (found while
    hardening the auth modules, 2026-10-08)."""

    VERDICTS = {
        "app.x.x_plain__mutmut_1": 1,  # killed: never reopened
        "app.x.x_plain__mutmut_2": 0,  # survived, tested by test_a
        "app.x.x_other__mutmut_1": 0,  # survived, tested by test_b only
        "app.x.x_untested__mutmut_1": 33,  # no tests, now run by test_a
        "app.x.x_new__mutmut_1": None,  # already unchecked
    }
    TESTS_BY_FUNCTION = {
        "app.x.x_plain": ["tests/test_a.py::test_one", "tests/test_b.py::test_two"],
        "app.x.x_other": ["tests/test_b.py::test_three"],
        "app.x.x_untested": ["tests/test_a.py::test_new"],
    }
    TESTS = {"tests/test_a.py": "def test_one(): pass\n", "tests/test_b.py": "B = 1\n"}

    def suite(self, tmp_path, monkeypatch, changed_since=None):
        suite = survivors_suite(tmp_path, self.VERDICTS, self.TESTS_BY_FUNCTION, self.TESTS)
        monkeypatch.setattr(mutmut_scope, "tests_changed_since", lambda d, c: changed_since)
        return suite

    def test_a_changed_test_module_reopens_the_survivors_it_runs(self, tmp_path, monkeypatch):
        suite = self.suite(tmp_path, monkeypatch, changed_since=set())
        mutmut_scope.reopen_survivors(suite, ["app/x.py"])  # first run: the baseline
        (suite / "tests" / "test_a.py").write_text("def test_one(): assert 1\n")
        verdicts_before = verdicts_of(suite)
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 2
        after = verdicts_of(suite)
        assert {k for k in after if after[k] != verdicts_before[k]} == {
            "app.x.x_plain__mutmut_2",
            "app.x.x_untested__mutmut_1",
        }
        assert after["app.x.x_plain__mutmut_2"] is None
        assert after["app.x.x_untested__mutmut_1"] is None
        assert after["app.x.x_plain__mutmut_1"] == 1
        assert after["app.x.x_other__mutmut_1"] == 0  # test_b did not change

    def test_unchanged_tests_reopen_nothing_and_the_digest_records_them(
        self, tmp_path, monkeypatch
    ):
        suite = self.suite(tmp_path, monkeypatch, changed_since=set())
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 0
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 0
        assert verdicts_of(suite) == self.VERDICTS
        digest = json.loads((suite / "mutants" / mutmut_scope.TESTS_DIGEST).read_text())
        assert digest == mutmut_scope.tests_digest(suite)
        assert set(digest) == {"tests/test_a.py", "tests/test_b.py"}

    def test_a_new_test_module_counts_as_changed(self, tmp_path, monkeypatch):
        suite = self.suite(tmp_path, monkeypatch, changed_since=set())
        mutmut_scope.reopen_survivors(suite, ["app/x.py"])
        (suite / "tests" / "test_c.py").write_text("def test_four(): pass\n")
        stats = json.loads((suite / "mutants" / "mutmut-stats.json").read_text())
        # what mutmut's stats pass in generate_only records for the new module
        stats["tests_by_mangled_function_name"]["app.x.x_other"].append(
            "tests/test_c.py::test_four"
        )
        (suite / "mutants" / "mutmut-stats.json").write_text(json.dumps(stats))
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 1
        assert verdicts_of(suite)["app.x.x_other__mutmut_1"] is None

    def test_the_first_run_asks_git_what_changed_since_the_stats(self, tmp_path, monkeypatch):
        seen = []
        suite = survivors_suite(tmp_path, self.VERDICTS, self.TESTS_BY_FUNCTION, self.TESTS)
        monkeypatch.setattr(
            mutmut_scope,
            "tests_changed_since",
            lambda d, commit: seen.append((d, commit)) or {"tests/test_b.py"},
        )
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 2
        assert seen == [(suite, "abc123")]
        after = verdicts_of(suite)
        assert after["app.x.x_plain__mutmut_2"] is None
        assert after["app.x.x_other__mutmut_1"] is None
        assert after["app.x.x_untested__mutmut_1"] == 33  # run by test_a only

    def test_without_git_every_test_module_counts_as_changed(self, tmp_path, monkeypatch):
        suite = self.suite(tmp_path, monkeypatch, changed_since=None)
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 3
        assert [k for k, v in verdicts_of(suite).items() if v is not None] == [
            "app.x.x_plain__mutmut_1"
        ]

    def test_only_the_files_in_scope_are_touched(self, tmp_path, monkeypatch):
        suite = self.suite(tmp_path, monkeypatch, changed_since=None)
        assert mutmut_scope.reopen_survivors(suite, ["app/y.py"]) == 0
        assert verdicts_of(suite) == self.VERDICTS

    def test_no_stats_means_nothing_to_reopen(self, tmp_path):
        suite = tmp_path / "suite"
        (suite / "mutants").mkdir(parents=True)
        assert mutmut_scope.reopen_survivors(suite, ["app/x.py"]) == 0
        assert not (suite / "mutants" / mutmut_scope.TESTS_DIGEST).exists()

    def test_the_digest_hashes_every_test_module_by_content(self, tmp_path):
        suite = tmp_path / "suite"
        (suite / "tests" / "api").mkdir(parents=True)
        (suite / "tests" / "api" / "test_a.py").write_text("A")
        (suite / "tests" / "notes.txt").write_text("not a module")
        first = mutmut_scope.tests_digest(suite)
        assert list(first) == ["tests/api/test_a.py"]
        (suite / "tests" / "api" / "test_a.py").write_text("B")
        assert mutmut_scope.tests_digest(suite) != first


class TestTestsChangedSince:
    @staticmethod
    def git(cwd, *args):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    @pytest.fixture
    def repo(self, tmp_path):
        self.git(tmp_path, "init", "-q")
        self.git(tmp_path, "config", "user.email", "t@example.com")
        self.git(tmp_path, "config", "user.name", "t")
        suite = tmp_path / "backend"
        (suite / "tests").mkdir(parents=True)
        (suite / "app").mkdir()
        (suite / "tests" / "test_a.py").write_text("A")
        (suite / "tests" / "test_b.py").write_text("B")
        (suite / "app" / "x.py").write_text("X")
        self.git(tmp_path, "add", "-A")
        self.git(tmp_path, "commit", "-qm", "base")
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=tmp_path, capture_output=True, text=True
        ).stdout.strip()
        (suite / "tests" / "test_a.py").write_text("A2")
        (suite / "tests" / "test_c.py").write_text("C")
        (suite / "app" / "x.py").write_text("X2")  # source: not a test
        self.git(tmp_path, "add", "-A")
        self.git(tmp_path, "commit", "-qm", "next")
        return suite, base

    def test_lists_the_test_modules_changed_since_the_commit(self, repo):
        suite, base = repo
        assert mutmut_scope.tests_changed_since(suite, base) == {
            "tests/test_a.py",
            "tests/test_c.py",
        }

    def test_no_commit_or_an_unknown_one_cannot_say(self, repo):
        suite, _ = repo
        assert mutmut_scope.tests_changed_since(suite, None) is None
        assert mutmut_scope.tests_changed_since(suite, "0" * 40) is None


class TestStrykerScope:
    @pytest.mark.parametrize(
        "path, selected",
        [
            ("src/lib/searchRank.ts", True),
            ("src/features/inventory/InventoryPage.tsx", True),
            ("src/lib/searchRank.test.ts", False),
            ("src/test/setup.ts", False),
            ("src/main.tsx", False),
            ("src/i18n/locales/en/common.json", False),
            ("src/features/diagrams/iconPaths.ts", False),
            ("e2e/login.spec.ts", False),
        ],
    )
    def test_the_real_config_decides_what_is_mutated(self, path, selected):
        assert stryker_scope.selector()(path) is selected

    def test_mutate_arg_is_one_range_per_changed_hunk(self):
        changed = {
            "frontend/src/lib/a.ts": [[10, 14], [20, 20]],
            "frontend/src/lib/a.test.ts": [[1, 3]],
            "backend/app/x.py": [[1, 1]],
        }
        assert stryker_scope.mutate_arg(changed) == "src/lib/a.ts:10-14,src/lib/a.ts:20-20"
        assert stryker_scope.mutate_arg({"backend/app/x.py": [[1, 1]]}) == ""

    @pytest.mark.parametrize("name", ["src/a,b.ts", "src/a\nb.ts", "src/a\x1b.ts"])
    def test_a_file_name_that_could_inject_is_refused(self, name):
        with pytest.raises(SystemExit):
            stryker_scope.mutate_arg({f"frontend/{name}": [[1, 1]]})

    def test_collect_filters_to_changed_lines_and_maps_statuses(self, tmp_path):
        def mutant(i, line, status):
            loc = {"start": {"line": line, "column": 1}, "end": {"line": line, "column": 5}}
            return {
                "id": str(i),
                "mutatorName": "EqualityOperator",
                "replacement": "a <= b",
                "location": loc,
                "status": status,
            }

        report = {
            "files": {
                "src/lib/a.ts": {
                    "source": "line1\nreturn a < b;\nline3\n",
                    "mutants": [
                        mutant(1, 2, "Survived"),
                        mutant(2, 3, "Killed"),
                        mutant(3, 2, "CompileError"),
                    ],
                },
                "src/lib/other.ts": {"source": "", "mutants": [mutant(4, 1, "Survived")]},
            }
        }
        records = stryker_scope.collect(report, {"frontend/src/lib/a.ts": [[2, 2]]})
        assert [(r["id"], r["status"]) for r in records] == [
            ("EqualityOperator#1", "survived"),
            ("EqualityOperator#3", "excluded"),
        ]
        assert records[0]["description"] == "- return a < b;\n+ a <= b"
        assert len(stryker_scope.collect(report, None)) == 4

    def test_shards_partition_every_mutable_file(self):
        every = stryker_scope.mutable_files()
        assert "src/lib/searchRank.ts" in every
        # The coverage tooling Frontend Tests gates on is in scope; the
        # generator scripts beside it are not.
        assert "scripts/merge-lcov.mjs" in every
        assert "scripts/e2e-coverage.mjs" in every
        assert "scripts/app-asset.mjs" in every
        assert not any(f.startswith("scripts/gen-") for f in every)
        assert not any(f.endswith((".test.ts", ".test.tsx")) for f in every)
        shards = [stryker_scope.shard_files(f"{k}/4") for k in range(1, 5)]
        assert sorted(f for s in shards for f in s) == every
        with pytest.raises(ValueError):
            stryker_scope.shard_files("0/4")

    def test_report_path_matches_the_config(self):
        config = json.loads((REPO / "frontend" / "stryker.config.json").read_text())
        assert stryker_scope.REPORT.as_posix() == config["jsonReporter"]["fileName"]

    def test_chunks_are_stable_when_a_file_is_added(self):
        assert stryker_scope.chunk_of("src/lib/a.ts") == stryker_scope.chunk_of("src/lib/a.ts")
        assert 0 <= stryker_scope.chunk_of("src/lib/a.ts") < stryker_scope.CHUNKS

    def test_globs(self):
        regex = stryker_scope.glob_to_regex("src/**/*.{ts,tsx}")
        assert regex.match("src/a.ts") and regex.match("src/x/y/b.tsx")
        assert not regex.match("src/a.js") and not regex.match("lib/a.ts")


# ── shadow_root ──────────────────────────────────────────────────────────────


class TestShadowRoot:
    def test_build_mirrors_the_repo_one_level_down(self, suite_repo):
        mutants = shadow_root.build("backend", suite_repo)
        shadow = suite_repo / ".mutation" / "backend"
        assert mutants == shadow / "backend" and mutants.is_dir() and not mutants.is_symlink()
        assert (shadow / "VERSION").read_text() == "1.0.0\n"
        assert (shadow / "frontend").is_symlink()
        assert not (shadow / ".git").exists()  # git inside the mirror must not see a work tree
        assert (mutants / "alembic").is_symlink()
        # what mutmut copies itself must never be a link into the real tree
        for owned in ("app", "tests", "pyproject.toml"):
            assert not (mutants / owned).exists()
        link = suite_repo / "backend" / "mutants"
        assert link.is_symlink() and link.resolve() == mutants.resolve()
        # the same relative climb reaches the same repository entry
        assert (mutants / "x" / "y").parents[2] == shadow

    def test_build_is_idempotent_and_clean_removes_it(self, suite_repo):
        shadow_root.build("backend", suite_repo)
        shadow_root.build("backend", suite_repo)
        shadow_root.clean("backend", suite_repo)
        assert not (suite_repo / ".mutation").exists()
        assert not (suite_repo / "backend" / "mutants").exists()

    def test_a_leftover_real_mutants_dir_is_refused(self, suite_repo):
        (suite_repo / "backend" / "mutants").mkdir()
        with pytest.raises(SystemExit):
            shadow_root.build("backend", suite_repo)

    def test_the_real_suites_declare_what_mutmut_owns(self):
        for suite, source in (("backend", "app"), ("mcp-server", "turbo_ea_mcp")):
            config = tomllib.loads((REPO / suite / "pyproject.toml").read_text())
            assert config["tool"]["mutmut"]["source_paths"] == [source]
            assert source in shadow_root.mutmut_owned(REPO / suite)


# ── stryker nightly: resumable chunks ───────────────────────────────────────

FAKE_STRYKER = """
import json, pathlib, sys, time
args = sys.argv[1:]
files = args[args.index("--mutate") + 1].split(",")
if any("slow" in f for f in files):
    time.sleep(60)
if any("broken" in f for f in files):
    sys.exit(1)
report = {"files": {f: {"source": "x\\n", "mutants": [
    {"id": "1", "mutatorName": "M", "replacement": "y", "status": "Killed",
     "location": {"start": {"line": 1, "column": 1}, "end": {"line": 1, "column": 2}}}
]} for f in files}}
out = pathlib.Path("reports/mutation/mutation.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report))
pathlib.Path(args[args.index("--incrementalFile") + 1]).write_text("{}")
"""


@pytest.fixture
def frontend_repo(tmp_path, monkeypatch):
    fe = tmp_path / "frontend"
    (fe / "src").mkdir(parents=True)
    for name in ("a", "b", "c", "d"):
        (fe / "src" / f"{name}.ts").write_text("export const x = 1;\n")
    (fe / "src" / "a.test.ts").write_text("test\n")
    config = fe / "stryker.config.json"
    config.write_text(json.dumps({"mutate": ["src/**/*.ts", "!src/**/*.test.ts"]}))
    fake = tmp_path / "fake_stryker.py"
    fake.write_text(FAKE_STRYKER)
    monkeypatch.setattr(stryker_scope, "STRYKER", [sys.executable, str(fake)])
    monkeypatch.setattr(stryker_scope, "CHUNKS", 2)
    return fe, config


class TestStrykerNightly:
    def test_every_chunk_runs_and_collect_merges_them(self, frontend_repo, tmp_path):
        fe, config = frontend_repo
        state = tmp_path / "state"
        assert stryker_scope.nightly("1/1", 30, state, fe, config) == 0
        assert len(list(state.glob("chunk-1-*.mutation.json"))) == 2
        assert len(list(state.glob("chunk-1-*.incremental.json"))) == 2
        records = stryker_scope.collect_state(state, "1/1", fe, config)
        assert sorted(r["file"] for r in records) == [
            f"frontend/src/{n}.ts" for n in ("a", "b", "c", "d")
        ]
        assert {r["status"] for r in records} == {"killed"}

    def test_files_no_chunk_has_measured_are_pending(self, frontend_repo, tmp_path):
        fe, config = frontend_repo
        state = tmp_path / "state"
        assert stryker_scope.nightly("1/1", 30, state, fe, config, max_chunks=1) == 0
        records = stryker_scope.collect_state(state, "1/1", fe, config)
        statuses = {r["status"] for r in records}
        assert statuses == {"killed", "pending"}
        assert len(records) == 4

    def test_the_oldest_chunk_runs_first(self, frontend_repo, tmp_path):
        fe, config = frontend_repo
        state = tmp_path / "state"
        stryker_scope.nightly("1/1", 30, state, fe, config, max_chunks=1)
        first = {p.name for p in state.glob("*.mutation.json")}
        stryker_scope.nightly("1/1", 30, state, fe, config, max_chunks=1)
        assert len({p.name for p in state.glob("*.mutation.json")} - first) == 1

    def test_a_failing_chunk_fails_the_run_and_keeps_going(self, frontend_repo, tmp_path):
        fe, config = frontend_repo
        (fe / "src" / "broken.ts").write_text("x\n")
        state = tmp_path / "state"
        assert stryker_scope.nightly("1/1", 30, state, fe, config) == 1
        assert list(state.glob("*.mutation.json"))  # the other chunk still landed

    def test_the_budget_stops_a_chunk_and_keeps_its_previous_report(
        self, frontend_repo, tmp_path, monkeypatch, capsys
    ):
        fe, config = frontend_repo
        for name in ("a", "b", "c", "d"):
            (fe / "src" / f"{name}.ts").unlink()
        (fe / "src" / "slow.ts").write_text("x\n")
        monkeypatch.setattr(stryker_scope, "CHUNKS", 1)
        monkeypatch.setattr(stryker_scope, "MIN_CHUNK_SECONDS", 0)
        state = tmp_path / "state"
        state.mkdir()
        previous = state / "chunk-1-0.mutation.json"
        previous.write_text('{"files": {}}')
        started = time.monotonic()
        assert stryker_scope.nightly("1/1", 0.02, state, fe, config) == 0
        assert time.monotonic() - started < 30  # stopped, not waited out
        assert previous.read_text() == '{"files": {}}'
        # it had the whole budget and still did not finish: say so
        assert "cannot finish within one budget" in capsys.readouterr().out
        # and it is not marked as measured from today's inputs
        assert not (state / "chunk-1-0.inputs").exists()


class TestStrykerNightlySkipsUnchangedChunks:
    """Stryker pays a full dry run per chunk even when every result is reused,
    so a chunk whose last report was made from the same inputs is skipped."""

    @staticmethod
    def calls(monkeypatch):
        seen = []
        real = stryker_scope._run_chunk

        def counting(files, *args):
            seen.append(sorted(files))
            return real(files, *args)

        monkeypatch.setattr(stryker_scope, "_run_chunk", counting)
        return seen

    def test_a_second_pass_over_the_same_inputs_runs_nothing(
        self, frontend_repo, tmp_path, monkeypatch, capsys
    ):
        fe, config = frontend_repo
        state = tmp_path / "state"
        assert stryker_scope.nightly("1/1", 30, state, fe, config) == 0
        reports = {p: p.read_text() for p in state.glob("*.mutation.json")}
        seen = self.calls(monkeypatch)
        assert stryker_scope.nightly("1/1", 30, state, fe, config) == 0
        assert seen == []
        assert {p: p.read_text() for p in state.glob("*.mutation.json")} == reports
        assert capsys.readouterr().out.count(": unchanged") == 2

    def test_any_change_under_src_reruns_every_chunk(self, frontend_repo, tmp_path, monkeypatch):
        fe, config = frontend_repo
        state = tmp_path / "state"
        stryker_scope.nightly("1/1", 30, state, fe, config)
        # a test file belongs to no chunk, yet it can change every verdict
        (fe / "src" / "a.test.ts").write_text("test, edited\n")
        seen = self.calls(monkeypatch)
        stryker_scope.nightly("1/1", 30, state, fe, config)
        assert sorted(f for chunk in seen for f in chunk) == [
            f"src/{n}.ts" for n in ("a", "b", "c", "d")
        ]

    def test_a_config_change_reruns_too(self, frontend_repo, tmp_path, monkeypatch):
        fe, config = frontend_repo
        state = tmp_path / "state"
        (fe / "package-lock.json").write_text("{}")
        stryker_scope.nightly("1/1", 30, state, fe, config)
        (fe / "package-lock.json").write_text('{"lockfileVersion": 3}')
        seen = self.calls(monkeypatch)
        stryker_scope.nightly("1/1", 30, state, fe, config)
        assert len(seen) == 2

    def test_a_failed_chunk_is_retried(self, frontend_repo, tmp_path, monkeypatch):
        fe, config = frontend_repo
        (fe / "src" / "broken.ts").write_text("x\n")
        state = tmp_path / "state"
        assert stryker_scope.nightly("1/1", 30, state, fe, config) == 1
        seen = self.calls(monkeypatch)
        assert stryker_scope.nightly("1/1", 30, state, fe, config) == 1
        assert len(seen) == 1 and "src/broken.ts" in seen[0]

    def test_a_chunk_with_a_report_but_no_recorded_inputs_reruns(
        self, frontend_repo, tmp_path, monkeypatch
    ):
        """A cache saved before the digest existed carries reports only."""
        fe, config = frontend_repo
        state = tmp_path / "state"
        stryker_scope.nightly("1/1", 30, state, fe, config)
        for recorded in state.glob("*.inputs"):
            recorded.unlink()
        seen = self.calls(monkeypatch)
        stryker_scope.nightly("1/1", 30, state, fe, config)
        assert len(seen) == 2

    def test_the_digest_covers_content_and_names_not_listing_order(self, frontend_repo):
        fe, _ = frontend_repo
        before = stryker_scope.inputs_digest(fe)
        assert stryker_scope.inputs_digest(fe) == before
        (fe / "src" / "b.ts").write_text("export const x = 2;\n")
        changed = stryker_scope.inputs_digest(fe)
        assert changed != before
        (fe / "src" / "b.ts").rename(fe / "src" / "e.ts")
        renamed = stryker_scope.inputs_digest(fe)
        assert renamed != changed
        (fe / "tsconfig.app.json").write_text("{}")
        configured = stryker_scope.inputs_digest(fe)
        assert configured != renamed
        # a file outside src/ and the listed configs is not an input
        (fe / "README.md").write_text("notes\n")
        assert stryker_scope.inputs_digest(fe) == configured
