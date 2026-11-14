"""Migration 173 builds ``document_images`` exactly as the model declares it.

The CI rollback job builds the schema with ``create_all`` and then downgrades
one step, so the index and constraint names the migration uses must be the
model's. No DB: names and columns are read off the model and the migration.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa

from app.models.document_image import DocumentImage

_MIG_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "173_document_images.py"
_spec = importlib.util.spec_from_file_location("mig173", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)
SOURCE = _MIG_PATH.read_text()


def test_revision_chain():
    assert (mig.revision, mig.down_revision) == ("173", "172")


def test_the_migration_imports_no_app_code():
    assert "from app" not in SOURCE
    assert "import app" not in SOURCE


def test_names_match_the_model():
    table = DocumentImage.__table__
    assert mig.TABLE == table.name == "document_images"
    assert {ix.name for ix in table.indexes} == {"ix_document_images_used_at_created_at"}
    (index,) = table.indexes
    assert [c.name for c in index.columns] == ["used_at", "created_at"]
    assert '"ix_document_images_used_at_created_at"' in SOURCE
    checks = [c for c in table.constraints if isinstance(c, sa.CheckConstraint)]
    assert [(c.name, str(c.sqltext)) for c in checks] == [
        ("ck_document_images_kind", "kind IN ('adr', 'soaw')")
    ]
    assert "sa.CheckConstraint(\"kind IN ('adr', 'soaw')\", name=\"ck_document_images_kind\")" in (
        SOURCE
    )


def test_columns_are_strings_not_text():
    """Bounded String columns (the workspace transfer writes them as cells)."""
    columns = DocumentImage.__table__.columns
    assert {
        name: (type(columns[name].type).__name__, columns[name].type.length)
        for name in ("kind", "mime_type", "sha256")
    } == {"kind": ("String", 8), "mime_type": ("String", 32), "sha256": ("String", 64)}
    assert columns["data"].nullable is False
    assert columns["used_at"].nullable is True
    assert columns["created_by"].foreign_keys.pop().ondelete == "SET NULL"
    assert "server_default=sa.func.now()" in SOURCE
