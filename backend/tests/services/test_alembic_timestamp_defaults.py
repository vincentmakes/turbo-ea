"""Every migration-created ``created_at`` / ``updated_at`` carries a server default.

Every model reads those two columns from ``TimestampMixin``, whose
``server_default=func.now()`` makes the ORM leave them out of the INSERT and
rely on the database. A migration that creates one of them without the default
therefore produces a table the ORM cannot insert into — and nothing in the
test suite notices, because ``conftest`` builds the schema with
``Base.metadata.create_all`` (default included), never with the migrations.
Migration 149 shipped exactly that on ``process_message_flows`` and every
upgraded install got a 500 on publishing a process with message flows (#1133);
058 had repaired the same omission on the archlens tables before it.

The source scan below is the recurrence guard: it reads every migration off
disk and fails on a timestamp ``sa.Column`` without ``server_default``. The
second class exercises migration 151's pure decision helper, no DB.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

_VERSIONS = Path(__file__).resolve().parents[2] / "alembic" / "versions"

_COLUMN_START = re.compile(r'sa\.Column\(\s*"(created_at|updated_at)"')


def _column_calls(source: str):
    """Yield ``(column_name, call_text)`` for every timestamp ``sa.Column(...)``."""
    for match in _COLUMN_START.finditer(source):
        start = match.start()
        depth = 0
        i = start + len("sa.Column")
        while True:
            char = source[i]
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        yield match.group(1), source[start : i + 1]


def _migration_files() -> list[Path]:
    return sorted(p for p in _VERSIONS.glob("*.py") if p.name[0].isdigit())


class TestEveryMigrationDeclaresTimestampDefaults:
    def test_versions_directory_is_scanned(self):
        files = _migration_files()
        assert len(files) > 100, "the scan found no migrations — path wrong?"
        # 149 is the one that shipped the bug; make sure it is in the sweep.
        assert any(p.name.startswith("149_") for p in files)

    def test_scanner_recognises_the_shipped_mistake(self):
        """What 149 carried before the fix must be caught, whatever its layout."""
        offending = (
            'sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),\n'
            'sa.Column(\n    "updated_at",\n    sa.DateTime(timezone=True),\n'
            "    nullable=False,\n),\n"
        )
        found = [(name, "server_default" in call) for name, call in _column_calls(offending)]
        assert found == [("created_at", False), ("updated_at", False)]

    def test_scanner_accepts_a_default_in_either_layout(self):
        ok = (
            'sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),\n'
            'sa.Column(\n    "updated_at",\n    sa.DateTime(timezone=True),\n'
            "    server_default=sa.func.now(),\n    nullable=False,\n),\n"
        )
        assert all("server_default" in call for _, call in _column_calls(ok))

    @pytest.mark.parametrize("path", _migration_files(), ids=lambda p: p.name)
    def test_timestamp_columns_carry_a_server_default(self, path: Path):
        source = path.read_text(encoding="utf-8")
        missing = [name for name, call in _column_calls(source) if "server_default" not in call]
        assert not missing, (
            f"{path.name} creates {missing} without server_default. The model reads "
            "these from TimestampMixin's server default and omits them from the "
            "INSERT, so a migrated install cannot insert into this table (#1133). "
            "Add server_default=sa.func.now()."
        )


_MIG_PATH = _VERSIONS / "151_message_flow_timestamp_defaults.py"
_spec = importlib.util.spec_from_file_location("mig151", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _col(name: str, default: str | None) -> dict:
    return {"name": name, "type": None, "nullable": False, "default": default}


class TestMigration151Helper:
    def test_both_missing_on_a_table_149_created(self):
        cols = [_col("id", None), _col("created_at", None), _col("updated_at", None)]
        assert mig.columns_missing_default(cols) == ["created_at", "updated_at"]

    def test_nothing_missing_on_a_fresh_install(self):
        cols = [_col("created_at", "now()"), _col("updated_at", "now()")]
        assert mig.columns_missing_default(cols) == []

    def test_only_the_missing_one_is_altered(self):
        cols = [_col("created_at", "now()"), _col("updated_at", None)]
        assert mig.columns_missing_default(cols) == ["updated_at"]

    def test_empty_string_default_counts_as_missing(self):
        assert mig.columns_missing_default([_col("created_at", "")]) == ["created_at"]

    def test_other_columns_are_ignored(self):
        assert mig.columns_missing_default([_col("id", None), _col("name", None)]) == []

    def test_downgrade_is_a_no_op(self):
        assert mig.downgrade() is None
