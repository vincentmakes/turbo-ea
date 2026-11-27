"""Migration 181 builds ``mcp_sessions`` exactly as the model declares it.

The CI rollback job builds the schema with ``create_all`` and then downgrades
one step, so the index name the migration drops must be the model's; and an
upgraded install must get the same columns, types, nullability and defaults a
fresh one does. No DB: read off the model and the migration module.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.models.mcp_session import McpSession

_MIG_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "181_mcp_sessions.py"
_spec = importlib.util.spec_from_file_location("mig181", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)
SOURCE = _MIG_PATH.read_text()

MODEL = McpSession.__table__


def test_revision_chain():
    assert (mig.revision, mig.down_revision) == ("181", "180")


def test_the_migration_imports_no_app_code():
    assert "from app" not in SOURCE
    assert "import app" not in SOURCE


def test_the_table_is_the_models():
    assert mig.TABLE == MODEL.name == "mcp_sessions"


def _upgrade(monkeypatch) -> tuple[dict[str, sa.Column], list[tuple]]:
    created: dict[str, sa.Column] = {}
    indexes: list[tuple] = []

    def create_table(name, *columns):
        assert name == "mcp_sessions"
        created.update({col.name: col for col in columns})

    monkeypatch.setattr(mig.op, "create_table", create_table)
    monkeypatch.setattr(
        mig.op,
        "create_index",
        lambda name, table, cols, **kw: indexes.append((name, table, tuple(cols), kw)),
    )
    mig.upgrade()
    return created, indexes


def test_the_columns_are_the_models(monkeypatch):
    created, _ = _upgrade(monkeypatch)
    assert set(created) == set(MODEL.columns.keys())
    for name, column in created.items():
        model_column = MODEL.columns[name]
        assert type(column.type) is type(model_column.type), name
        assert column.nullable == model_column.nullable, name
        assert getattr(column.type, "length", None) == getattr(model_column.type, "length", None), (
            name
        )
        assert getattr(column.type, "timezone", None) == getattr(
            model_column.type, "timezone", None
        ), name


def test_keys_and_the_owner_foreign_key(monkeypatch):
    created, _ = _upgrade(monkeypatch)
    assert created["id"].primary_key is True
    assert isinstance(created["id"].type, postgresql.UUID)
    (fk,) = created["user_id"].foreign_keys
    assert fk.target_fullname == "users.id"
    # Deleting a person ends their connections with them.
    assert fk.ondelete == "CASCADE" == next(iter(MODEL.columns["user_id"].foreign_keys)).ondelete


def test_server_defaults(monkeypatch):
    created, _ = _upgrade(monkeypatch)
    defaulted = {name for name, col in created.items() if col.server_default is not None}
    assert defaulted == {"generation", "created_at", "last_used_at"}
    assert created["generation"].server_default.arg == "0"
    for name in ("created_at", "last_used_at"):
        assert isinstance(created[name].server_default.arg, sa.sql.functions.now), name
        assert isinstance(MODEL.columns[name].server_default.arg, sa.sql.functions.now), name


def test_the_index_is_the_models(monkeypatch):
    _, indexes = _upgrade(monkeypatch)
    assert indexes == [("ix_mcp_sessions_user_id", "mcp_sessions", ("user_id",), {})]
    assert {(ix.name, tuple(c.name for c in ix.columns)) for ix in MODEL.indexes} == {
        ("ix_mcp_sessions_user_id", ("user_id",))
    }


def test_downgrade_drops_the_index_then_the_table(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        mig.op, "drop_index", lambda name, table_name: calls.append(("index", name, table_name))
    )
    monkeypatch.setattr(mig.op, "drop_table", lambda name: calls.append(("table", name)))
    mig.downgrade()
    assert calls == [
        ("index", "ix_mcp_sessions_user_id", "mcp_sessions"),
        ("table", "mcp_sessions"),
    ]
