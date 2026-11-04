"""The guard ratchet, ``scripts/guard_ratchet.py``.

It is the check that keeps every other check honest: a bug here either waves
a lowered floor through or blocks every pull request. The parsers are tested
on the shapes the repo actually uses, each rule end to end in a throwaway git
repository, and the watch list against the real tree, so a renamed allowlist
fails here instead of silently leaving the watch. Loaded off disk like
``test_mutation_scripts.py`` loads ``scripts/mutation/``.
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "scripts"))
ratchet = importlib.import_module("guard_ratchet")

# ── Parsers ────────────────────────────────────────────────────────────────


class TestTsCollection:
    def test_record_keys_with_multiline_values_and_comments(self):
        text = (
            "const EXEMPT: Record<string, string> = {\n"
            '  // a comment with "quotes", and a comma\n'
            '  "src/a.tsx": "one, with a comma",\n'
            '  "src/b.tsx":\n'
            '    "split " +\n'
            '    "over lines",\n'
            "  Bare: `template {braces}`,\n"
            "};\n"
        )
        assert ratchet.ts_collection(text, "EXEMPT") == ["src/a.tsx", "src/b.tsx", "Bare"]

    def test_set_and_array(self):
        assert ratchet.ts_collection('const S = new Set(["a", "b"]);', "S") == ["a", "b"]
        assert ratchet.ts_collection("const A = ['x', 'y',];", "A") == ["x", "y"]

    def test_absent_and_empty(self):
        assert ratchet.ts_collection("const OTHER = {};", "EXEMPT") is None
        assert ratchet.ts_collection("const EXEMPT: Record<string, string> = {};", "EXEMPT") == []

    def test_record_maps_are_found_by_type(self):
        text = 'const A_OK: Record<string, string> = {};\nconst B = new Set(["x"]);\n'
        assert ratchet.ts_record_maps(text) == ["A_OK"]


class TestPyCollections:
    SOURCE = (
        "import pytest\n"
        'AUTH = frozenset({"a", "b"})\n'
        'GATES: dict[str, frozenset[str]] = {"x.py": frozenset({"g1", "g2"})}\n'
        'MIXED = {"m.py": ("h1", "h2")}\n'
        'RAISES: dict[tuple[str, int], tuple[int, str]] = {("r", 403): (3, "why")}\n'
        'REASONS: dict[str, str] = {"k": ("long " "reason")}\n'
        "COMPUTED = {x for x in range(3)}\n"
    )

    def test_reads_the_literals_it_can(self):
        values = ratchet.py_module_values(self.SOURCE)
        assert set(values) == {"AUTH", "GATES", "MIXED", "RAISES", "REASONS"}
        assert values["REASONS"][0] == "dict[str, str]"

    def test_items(self):
        values = {k: v for k, (_a, v) in ratchet.py_module_values(self.SOURCE).items()}
        assert sorted(ratchet.items_of(values["AUTH"])) == ["a", "b"]
        assert sorted(ratchet.items_of(values["GATES"])) == ["x.py -> g1", "x.py -> g2"]
        assert ratchet.items_of(values["MIXED"]) == ["m.py -> h1", "m.py -> h2"]
        assert ratchet.items_of(values["RAISES"]) == ["('r', 403) x3"]
        assert ratchet.items_of(values["REASONS"]) == ["k"]


class TestFloorParsers:
    def test_floors_toml(self):
        text = '[diff]\nbackend = 60\nmin_mutants = 10\n[modules]\n"a/b.py" = 98  # why\n'
        assert ratchet.floors_toml(text) == {
            "[diff] backend": 60,
            "[diff] min_mutants": 10,
            "[modules] a/b.py": 98,
        }

    def test_vitest_and_package_json(self):
        vitest = "coverage: { thresholds: {\n lines: 85,\n branches: 79.5,\n },\n}"
        assert ratchet.vitest_thresholds(vitest) == {
            "thresholds.lines": 85,
            "thresholds.branches": 79.5,
        }
        pkg = '{"config": {"coverageFloorMergedLines": 88.2, "other": 1}}'
        assert ratchet.package_json_floors(pkg) == {"config.coverageFloorMergedLines": 88.2}

    def test_workflow_gates_are_ranked_not_positional(self):
        before = "jobs:\n  test:\n    run: diff-cover x --fail-under=80\n"
        after = (
            "jobs:\n  test:\n    run: report --fail-under=0\n"
            "    run: diff-cover x --fail-under=80\n"
        )
        assert ratchet.workflow_fail_under(before) == {"test --fail-under #1": 80}
        assert ratchet.workflow_fail_under(after) == {
            "test --fail-under #1": 80,
            "test --fail-under #2": 0,
        }

    def test_anti_rot_floors(self):
        assert ratchet.anti_rot_floors("MIN_FILES = 1_000  # floor\nMINUTES = 3\n") == {
            "MIN_FILES": 1000
        }
        assert ratchet.anti_rot_floors("const MIN_SITES = 10;\nconst MIN_X: number = 4;") == {
            "MIN_SITES": 10,
            "MIN_X": 4,
        }


# ── End to end, in a throwaway repository ──────────────────────────────────

GUARD = "backend/tests/services/test_thing_guard.py"
PERMS = "backend/tests/services/test_permission_keys_guard.py"
GUARD_TEXT = (
    "import pytest\n"
    "pytestmark = pytest.mark.source_scan\n"
    'THING_OK: dict[str, str] = {"a.py": "why"}\n'
    "MIN_FILES = 10\n\n"
    "def test_one():\n    pass\n\n"
    "def test_two():\n    pass\n"
)
FLOORS = '[suite]\nbackend = 76\n[diff]\nmin_mutants = 10\n[modules]\n"backend/app/x.py" = 98\n'


class Repo:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.git("init", "-q", "-b", "main")

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(self.root), *args],
            capture_output=True,
            text=True,
            check=True,
        ).stdout

    def write(self, path: str, text: str) -> None:
        (self.root / path).parent.mkdir(parents=True, exist_ok=True)
        (self.root / path).write_text(text)

    def edit(self, path: str, old: str, new: str) -> None:
        text = (self.root / path).read_text()
        assert old in text
        self.write(path, text.replace(old, new, 1))

    def commit(self) -> str:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "c")
        return self.git("rev-parse", "HEAD").strip()

    def findings(self, base: str) -> list[str]:
        return [
            f.line()
            for f in ratchet.run(ratchet.Tree(base, self.root), ratchet.Tree(None, self.root))
        ]


@pytest.fixture
def repo(tmp_path: Path) -> tuple[Repo, str]:
    r = Repo(tmp_path)
    r.write("scripts/mutation/floors.toml", FLOORS)
    r.write("backend/app/x.py", "def f():\n    return 1\n")
    r.write(GUARD, GUARD_TEXT)
    r.write(
        PERMS,
        "import pytest\npytestmark = pytest.mark.source_scan\n"
        'CHECKS = frozenset({"a", "b"})\n\ndef test_x():\n    pass\n',
    )
    r.write("backend/tests/test_plain.py", "def test_p():\n    pass\n")
    r.write("scripts/guard_ratchet.py", "# the ratchet\n")
    return r, r.commit()


class TestRules:
    def test_unchanged_tree_is_clean(self, repo):
        r, base = repo
        assert r.findings(base) == []

    def test_lowered_and_removed_floors(self, repo):
        r, base = repo
        r.edit("scripts/mutation/floors.toml", "backend = 76", "backend = 70")
        r.edit("scripts/mutation/floors.toml", "min_mutants = 10", "min_mutants = 20")
        r.edit("scripts/mutation/floors.toml", '"backend/app/x.py" = 98\n', "")
        r.edit(GUARD, "MIN_FILES = 10", "MIN_FILES = 1")
        assert r.findings(base) == [
            f"[floor] {GUARD}: MIN_FILES 10 -> 1",
            "[floor] scripts/mutation/floors.toml: [diff] min_mutants 10 -> 20",
            "[floor] scripts/mutation/floors.toml: [modules] backend/app/x.py removed (was 98)",
            "[floor] scripts/mutation/floors.toml: [suite] backend 76 -> 70",
        ]

    def test_raised_floors_and_a_deleted_modules_floor_pass(self, repo):
        r, base = repo
        r.edit("scripts/mutation/floors.toml", "backend = 76", "backend = 80")
        r.edit("scripts/mutation/floors.toml", '"backend/app/x.py" = 98\n', "")
        (r.root / "backend/app/x.py").unlink()
        assert r.findings(base) == []

    def test_removing_an_informational_zero_floor_passes(self, repo):
        """A ``--fail-under=0`` report is not a bar; dropping it lowers nothing."""
        r, base = repo
        r.write(
            ".github/workflows/ci.yml",
            "jobs:\n  test:\n    run: report --fail-under=0\n"
            "    run: diff-cover x --fail-under=80\n",
        )
        base = r.commit()
        r.edit(".github/workflows/ci.yml", "    run: report --fail-under=0\n", "")
        assert r.findings(base) == []
        r.edit(".github/workflows/ci.yml", "--fail-under=80", "--fail-under=0")
        assert r.findings(base) == [
            "[floor] .github/workflows/ci.yml: test --fail-under #1 80 -> 0"
        ]
        r.write(".github/workflows/ci.yml", "jobs:\n  test:\n    run: nothing\n")
        assert r.findings(base) == [
            "[floor] .github/workflows/ci.yml: test --fail-under #1 removed (was 80)"
        ]

    def test_allowlist_growth_is_flagged_and_narrowing_is_not(self, repo):
        r, base = repo
        r.edit(GUARD, '{"a.py": "why"}', '{"b.py": "a plausible reason"}')
        assert r.findings(base) == [f"[allowlist] {GUARD}: THING_OK adds 'b.py'"]

    def test_must_comply_list_shrinking_is_flagged(self, repo):
        r, base = repo
        r.edit(PERMS, '{"a", "b"}', '{"a", "b", "c"}')
        assert r.findings(base) == []
        base = r.commit()
        r.edit(PERMS, '{"a", "b", "c"}', '{"a"}')
        assert r.findings(base) == [
            f"[must-comply list] {PERMS}: CHECKS drops 'b'",
            f"[must-comply list] {PERMS}: CHECKS drops 'c'",
        ]

    def test_a_list_that_can_no_longer_be_read_is_flagged(self, repo):
        r, base = repo
        r.edit(
            GUARD, 'THING_OK: dict[str, str] = {"a.py": "why"}', "THING_OK = load_from_somewhere()"
        )
        assert r.findings(base) == [
            f"[allowlist] {GUARD}: THING_OK can no longer be read (removed or reshaped)"
        ]

    def test_guard_tests_removed_unmarked_or_deleted(self, repo):
        r, base = repo
        r.edit(GUARD, "def test_two():\n    pass\n", "")
        assert r.findings(base) == [f"[guard test] {GUARD}: tests 2 -> 1"]
        r.edit(GUARD, "pytestmark = pytest.mark.source_scan\n", "")
        r.git("mv", GUARD, "backend/tests/services/test_thing.py")
        assert f"[guard test] {GUARD}: file removed" in r.findings(base)

    def test_new_skip_and_suppression_markers(self, repo):
        r, base = repo
        r.edit(
            "backend/tests/test_plain.py",
            "def test_p",
            "@pytest.mark.skip(reason='later')\ndef test_p",
        )
        r.edit("backend/app/x.py", "return 1", "return 1  # pragma: no cover")
        assert r.findings(base) == [
            "[suppression] backend/app/x.py: +1 coverage exclusion pragma",
            "[suppression] backend/tests/test_plain.py: +1 skipped or xfailed test",
        ]

    def test_a_mutation_pragma_is_a_notice_not_a_blocker(self, repo):
        r, base = repo
        r.edit("backend/app/x.py", "return 1", "return 1  # pragma: no mutate, equivalent")
        findings = ratchet.run(ratchet.Tree(base, r.root), ratchet.Tree(None, r.root))
        assert [f.line() for f in findings] == [
            "[notice] backend/app/x.py: +1 mutation suppression"
        ]
        assert ratchet.blocking(findings) == []

    def test_touching_the_ratchet_is_flagged(self, repo):
        r, base = repo
        r.write("scripts/guard_ratchet.py", "# the ratchet, defanged\n")
        assert r.findings(base) == ["[ratchet] scripts/guard_ratchet.py: changed"]


class TestMain:
    def test_exit_codes_and_summary(self, repo, monkeypatch, tmp_path):
        r, base = repo
        r.git("branch", "base")
        r.git("checkout", "-q", "-b", "feature")
        r.edit("scripts/mutation/floors.toml", "backend = 76", "backend = 70")
        r.commit()
        monkeypatch.setattr(ratchet, "REPO", r.root)
        summary = tmp_path / "summary.md"
        assert ratchet.main(["--base", "base", "--summary", str(summary)]) == 1
        assert ratchet.main(["--base", "base", "--approved"]) == 0
        text = summary.read_text()
        assert "**Blocked.**" in text and "[suite] backend 76 -> 70" in text

    def test_notices_alone_pass_and_are_reported(self, repo, monkeypatch, tmp_path):
        r, base = repo
        r.git("branch", "base")
        r.git("checkout", "-q", "-b", "feature")
        r.edit("backend/app/x.py", "return 1", "return 1  # pragma: no mutate, equivalent")
        r.commit()
        monkeypatch.setattr(ratchet, "REPO", r.root)
        summary = tmp_path / "summary.md"
        assert ratchet.main(["--base", "base", "--summary", str(summary)]) == 0
        text = summary.read_text()
        assert "No bar lowered" in text and "**Notices**" in text and "mutation suppression" in text
        assert base in r.git("merge-base", "base", "HEAD")


# ── The watch list against the real repository ─────────────────────────────


class TestRealRepository:
    head = ratchet.Tree(None)

    def test_every_registered_list_is_readable(self):
        missing = [
            f"{w.path}: {w.name}"
            for w in ratchet.REGISTRY
            if (text := self.head.read(w.path)) is None or w.read(text) is None
        ]
        assert not missing, (
            f"renamed or moved? update REGISTRY in scripts/guard_ratchet.py: {missing}"
        )

    def test_every_floor_file_has_floors(self):
        empty = [p for p, extract in ratchet.FLOOR_FILES if not extract(self.head.read(p) or "")]
        assert not empty

    def test_every_reason_map_in_a_guard_test_is_watched(self):
        """A guard's ``{name: reason}`` exemption map is typed ``dict[str, str]`` or registered."""
        registered = {(w.path, w.name) for w in ratchet.REGISTRY}
        unwatched = [
            f"{path}: {name}"
            for path, text in ratchet.guard_files(self.head).items()
            if path.endswith(".py")
            for name, (ann, value) in ratchet.py_module_values(text).items()
            if isinstance(value, dict)
            and value
            and all(isinstance(v, str) for v in value.values())
            and ann != "dict[str, str]"
            and (path, name) not in registered
        ]
        assert not unwatched, (
            "annotate these `dict[str, str]` (or add them to REGISTRY) so the ratchet "
            "sees them grow: "
            f"{unwatched}"
        )

    def test_the_guards_are_found(self):
        guards = ratchet.guard_files(self.head)
        assert "backend/tests/services/test_route_auth_guard.py" in guards
        assert "frontend/src/theme/rawColours.sourceScan.test.ts" in guards
        assert len(guards) >= 30
