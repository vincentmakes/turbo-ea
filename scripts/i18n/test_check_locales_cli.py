"""Exercise the translation workflow against a temporary Git repository."""

import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_locales as cl


class BranchTranslations(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.locales = self.root / "frontend/src/i18n/locales"
        self.todo = self.root / "todo.json"
        for name, value in {
            "REPO": self.root,
            "LOCALES_DIR": self.locales,
            "DOCS_DIR": self.root / "docs",
            "PAGES_TS": self.root / "pages.ts",
            "TARGET_LOCALES": ("ru",),
        }.items():
            patcher = patch.object(cl, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.git("init", "-q")

    def git(self, *args):
        subprocess.run(
            [
                "git",
                "-c",
                "user.email=test@example.test",
                "-c",
                "user.name=Test",
                "-c",
                "commit.gpgsign=false",
                *args,
            ],
            cwd=self.root,
            check=True,
            capture_output=True,
        )

    def baseline(self):
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        self.git("branch", "base")

    def write(self, locale, ns, data):
        target = self.locales / locale / (ns + ".json")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(cl.canonical_json(data), encoding="utf-8")
        return target

    def run_cli(self, *args):
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            return cl.main([*args, "--base", "base"])

    def work(self):
        self.assertEqual(0, self.run_cli("todo", "ru", "--out", str(self.todo)))
        return json.loads(self.todo.read_text(encoding="utf-8"))

    def apply(self, entries):
        self.todo.write_text(json.dumps(entries), encoding="utf-8")
        return self.run_cli("apply", "ru", str(self.todo))

    def test_manual_gaps_include_older_pages_and_exclude_internal_plans(self):
        page = self.root / "docs/admin/example.md"
        plan = self.root / "docs/superpowers/plans/example.md"
        for path in (page, plan):
            path.parent.mkdir(parents=True)
            path.write_text("# Example\n", encoding="utf-8")
        self.baseline()
        self.assertEqual(self.run_cli("report"), 1)
        self.assertEqual(
            cl.build_report("base")["docs"]["no_sibling"],
            {"docs/admin/example.md": ["ru"]},
        )
        page.with_suffix(".ru.md").write_text("# Пример\n", encoding="utf-8")
        self.assertEqual(self.run_cli("report"), 0)
        self.git("add", ".")
        self.git("commit", "-qm", "translate")
        self.git("branch", "-f", "base")
        page.write_text("# Updated example\n", encoding="utf-8")
        self.assertEqual(self.run_cli("report"), 1)
        self.assertEqual(
            cl.build_report("base")["docs"]["untouched_sibling"],
            {"docs/admin/example.md": ["ru"]},
        )
        page.with_suffix(".ru.md").write_text("# Обновлённый пример\n", encoding="utf-8")
        self.assertEqual(self.run_cli("report"), 0)

    def test_changed_and_removed_keys_across_branch_and_worktree(self):
        self.write(
            "en",
            "ui",
            {
                "button": "Save",
                "ok": "Okay",
                "old.key": "old",
                "g": {"keep": "Don't touch", "old": "obsolete"},
            },
        )
        self.write(
            "ru",
            "ui",
            {
                "button": "Сохранить",
                "ok": "OK",
                "old.key": "X",
                "g": {"keep": "keep", "old": "X"},
                "unrelated": "X",
            },
        )
        self.baseline()
        self.write("en", "ui", {"button": "Save all", "ok": "OK", "g": {"keep": "Don't touch"}})
        self.git("add", ".")
        self.git("commit", "-qm", "change source")
        self.write("en", "new", {"title": "New"})
        todo = self.work()
        self.assertEqual(
            todo,
            {
                "ui:button": "Save all",
                "ui:ok": "OK",
                "ui:old.key": None,
                "ui:g.old": None,
                "new:title": "New",
            },
        )
        self.assertEqual(
            set(cl.build_report("base")["ui"]["ru"]["ui"]["changed"]), {"button", "ok"}
        )
        self.assertEqual(
            self.apply({**todo, "ui:button": "Сохранить всё", "new:title": "Новый"}), 0
        )
        self.assertEqual(self.work(), {"ui:ok": "OK"})
        self.assertEqual(cl.build_report("base")["fatal"], 0)
        self.assertEqual(cl.load("ru", "ui")["unrelated"], "X")

    def test_removed_namespace_plural_family_and_repeated_apply(self):
        source = {"n_one": "one", "n_other": "many"}
        self.write("en", "old", source)
        target = self.write("ru", "old", {**source, "n_few": "few", "n_many": "many"})
        self.baseline()
        (self.locales / "en/old.json").rename(self.locales / "en/new.json")
        todo = self.work()
        self.assertEqual(
            todo,
            {
                "old:n_one": None,
                "old:n_other": None,
                "old:n_few": None,
                "old:n_many": None,
                "new:n_one": "one",
                "new:n_other": "many",
            },
        )
        self.assertEqual(self.apply(todo), 0)
        self.assertFalse(target.exists())
        self.assertEqual(self.apply(todo), 0)
        self.assertEqual(self.work(), {})

    def test_safe_deletion_and_flat_layout(self):
        self.write(
            "en",
            "ui",
            {"remove": "old", "active": "keep", "n_one": "n", "n_other": "ns"},
        )
        target = self.write("ru", "ui", {})
        original = (
            '{\n  "active": "caf\\u00e9",\n\n'
            '  "extra": "x",\n  "n_few": "few",\n  "remove": "old"\n}\n'
        )
        target.write_bytes(original.encode("utf-8"))
        self.baseline()
        self.write("en", "ui", {"active": "keep", "n_one": "n", "n_other": "ns"})
        for forbidden in ("active", "extra", "n_few"):
            self.assertEqual(self.apply({"ui:remove": None, "ui:" + forbidden: None}), 1)
            self.assertEqual(target.read_text(encoding="utf-8"), original)
        self.assertEqual(self.apply({"ui:remove": None}), 0)
        self.assertEqual(
            target.read_bytes().decode("utf-8"),
            original.replace(',\n  "remove": "old"', ""),
        )

    def test_shape_changes_never_destroy_unrequested_descendants(self):
        old = {"group": {"nested": "old"}, "becomesObject": "old"}
        new = {"group": "new", "becomesObject": {"child": "new"}}
        self.write("en", "ui", old)
        target = self.write("ru", "ui", old)
        self.baseline()
        self.write("en", "ui", new)
        self.assertEqual(self.apply({"ui:group": "new"}), 1)
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), old)
        todo = self.work()
        self.assertEqual(self.apply(todo), 0)
        self.assertEqual(cl.load("ru", "ui"), new)
        self.assertEqual(self.apply(todo), 0)

    def test_modified_plural_reviews_existing_variants_and_preserves_current_work(self):
        self.write("en", "ui", {"n_one": "one", "n_other": "{{count}} cards", "done": "Save"})
        self.write(
            "ru",
            "ui",
            {
                "n_one": "one",
                "n_other": "{{count}} карт",
                "n_few": "{{count}} карты",
                "done": "Сохранить",
            },
        )
        self.baseline()
        self.write(
            "en",
            "ui",
            {"n_one": "one", "n_other": "{{count}} relations", "done": "Save all"},
        )
        self.write(
            "ru",
            "ui",
            {
                "n_one": "one",
                "n_other": "{{count}} карт",
                "n_few": "{{count}} карты",
                "done": "Сохранить всё",
            },
        )
        self.assertEqual(
            self.work(),
            {"ui:n_other": "{{count}} relations", "ui:n_few": "{{count}} relations"},
        )
        self.assertEqual(self.apply({"ui:n_few": "связи"}), 1)
        self.assertEqual(
            self.apply({"ui:n_few": "{{count}} связи", "ui:n_other": "{{count}} связей"}),
            0,
        )
        self.assertEqual(self.work(), {})

    def test_unknown_base_fails_each_command(self):
        self.todo.write_text("{}", encoding="utf-8")
        for args in (
            ["report"],
            ["todo", "ru", "--out", str(self.todo)],
            ["apply", "ru", str(self.todo)],
        ):
            self.assertEqual(self.run_cli(*args), 1)
