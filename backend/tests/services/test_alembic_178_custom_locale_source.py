"""Migration 178 adds the three provenance columns of a custom language
exactly as the model declares them. No DB: read off the model and the
migration module."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa

from app.models.custom_locale import CustomLocale

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "178_custom_locale_source.py"
)
_spec = importlib.util.spec_from_file_location("mig178", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)
SOURCE = _MIG_PATH.read_text()


def test_revision_chain():
    assert (mig.revision, mig.down_revision) == ("178", "177")


def test_the_migration_imports_no_app_code():
    assert "from app" not in SOURCE
    assert "import app" not in SOURCE


def test_the_columns_are_the_models():
    assert mig.LOCALES == CustomLocale.__table__.name
    for name, length in mig.COLUMNS:
        column = CustomLocale.__table__.columns[name]
        assert isinstance(column.type, sa.String)
        assert column.type.length == length
        assert column.nullable is True
        assert column.server_default is None
    assert [n for n, _ in mig.COLUMNS] == ["source", "source_sha256", "source_commit"]


def test_upgrade_adds_and_downgrade_drops_them(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        mig.op, "add_column", lambda table, col: calls.append(("add", table, col.name))
    )
    monkeypatch.setattr(
        mig.op, "drop_column", lambda table, name: calls.append(("drop", table, name))
    )
    mig.upgrade()
    mig.downgrade()
    assert calls == [
        ("add", "custom_locales", "source"),
        ("add", "custom_locales", "source_sha256"),
        ("add", "custom_locales", "source_commit"),
        ("drop", "custom_locales", "source_commit"),
        ("drop", "custom_locales", "source_sha256"),
        ("drop", "custom_locales", "source"),
    ]
