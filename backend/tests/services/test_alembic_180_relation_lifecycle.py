"""Migration 180 adds a relation's lifecycle and a relation type's lifecycle
switch exactly as the models declare them. No DB: read off the models and the
migration module."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.models.relation import Relation
from app.models.relation_type import RelationType

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "180_relation_lifecycle.py"
)
_spec = importlib.util.spec_from_file_location("mig180", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)
SOURCE = _MIG_PATH.read_text()


def test_revision_chain():
    assert (mig.revision, mig.down_revision) == ("180", "179")


def test_the_migration_imports_no_app_code():
    assert "from app" not in SOURCE
    assert "import app" not in SOURCE


def test_the_tables_are_the_models():
    assert mig.RELATIONS == Relation.__table__.name
    assert mig.RELATION_TYPES == RelationType.__table__.name


def _added(monkeypatch) -> dict[tuple[str, str], sa.Column]:
    added: dict[tuple[str, str], sa.Column] = {}
    monkeypatch.setattr(
        mig.op, "add_column", lambda table, col: added.update({(table, col.name): col})
    )
    mig.upgrade()
    return added


def test_both_columns_are_not_null_with_the_models_server_defaults(monkeypatch):
    added = _added(monkeypatch)
    assert set(added) == {("relations", "lifecycle"), ("relation_types", "lifecycle_enabled")}

    lifecycle = added[("relations", "lifecycle")]
    model_lifecycle = Relation.__table__.columns["lifecycle"]
    assert isinstance(lifecycle.type, postgresql.JSONB)
    assert isinstance(model_lifecycle.type, postgresql.JSONB)
    assert lifecycle.nullable is False and model_lifecycle.nullable is False
    # Every existing relation reads as "always in effect".
    assert lifecycle.server_default.arg == "{}" == model_lifecycle.server_default.arg

    enabled = added[("relation_types", "lifecycle_enabled")]
    model_enabled = RelationType.__table__.columns["lifecycle_enabled"]
    assert isinstance(enabled.type, sa.Boolean) and isinstance(model_enabled.type, sa.Boolean)
    assert enabled.nullable is False and model_enabled.nullable is False
    # Off for every existing relation type, built-in ones included.
    assert str(enabled.server_default.arg.compile()) == "false"
    assert model_enabled.server_default.arg == "false"


def test_downgrade_drops_both(monkeypatch):
    dropped: list[tuple[str, str]] = []
    monkeypatch.setattr(mig.op, "drop_column", lambda table, name: dropped.append((table, name)))
    mig.downgrade()
    assert dropped == [("relation_types", "lifecycle_enabled"), ("relations", "lifecycle")]
