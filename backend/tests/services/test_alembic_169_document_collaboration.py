"""Migration 169 builds the two collaboration tables exactly as the models declare them.

The CI rollback job builds the schema with ``create_all`` and then downgrades
one step, so every constraint and index name the migration drops must be the
name the model gives it. No DB: the names are read off the models and the
migration source.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.models.document_comment import DocumentComment
from app.models.document_history import DocumentHistoryEntry

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "169_document_collaboration.py"
)
_spec = importlib.util.spec_from_file_location("mig169", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)
SOURCE = _MIG_PATH.read_text()


def test_revision_chain():
    assert mig.revision == "169"
    assert mig.down_revision == "168"


def test_the_migration_imports_no_app_code():
    assert "from app" not in SOURCE
    assert "import app" not in SOURCE


def test_table_names():
    assert (mig.COMMENTS, mig.HISTORY) == (
        DocumentComment.__tablename__,
        DocumentHistoryEntry.__tablename__,
    )


def _names(model, kind) -> set[str]:
    table = model.__table__
    if kind == "index":
        return {ix.name for ix in table.indexes}
    return {c.name for c in table.constraints if c.name and c.name.startswith("ck_")}


def test_index_names_match_the_models():
    assert _names(DocumentComment, "index") == {
        "ix_document_comments_architecture_decision_id",
        "ix_document_comments_soaw_id",
        "ix_document_comments_parent_id",
    }
    assert _names(DocumentHistoryEntry, "index") == {
        "ix_document_history_adr_seq",
        "ix_document_history_soaw_seq",
    }
    # The comment indexes are named by op.f over the indexed columns.
    assert SOURCE.count('op.f(f"ix_{COMMENTS}_{column}")') == 2
    assert 'for column in ("architecture_decision_id", "soaw_id", "parent_id"):' in SOURCE
    assert 'for column in ("parent_id", "soaw_id", "architecture_decision_id"):' in SOURCE
    assert '"ix_document_history_adr_seq"' in SOURCE
    assert '"ix_document_history_soaw_seq"' in SOURCE


def test_check_constraints_match_the_models():
    assert _names(DocumentComment, "check") == {"ck_document_comments_one_owner"}
    assert _names(DocumentHistoryEntry, "check") == {"ck_document_history_one_owner"}
    assert '"ck_document_comments_one_owner"' in SOURCE
    assert '"ck_document_history_one_owner"' in SOURCE
    assert mig.ONE_OWNER == "num_nonnulls(architecture_decision_id, soaw_id) = 1"
    for model in (DocumentComment, DocumentHistoryEntry):
        (check,) = [c for c in model.__table__.constraints if c.name and c.name.startswith("ck_")]
        assert str(check.sqltext) == mig.ONE_OWNER


def test_the_timeline_takes_the_statement_clock_and_an_identity():
    created = DocumentHistoryEntry.__table__.c.created_at
    assert "clock_timestamp" in str(created.server_default.arg)
    assert "server_default=sa.func.clock_timestamp()" in SOURCE
    seq = DocumentHistoryEntry.__table__.c.seq
    assert seq.identity is not None and seq.identity.always is True
    assert "sa.Identity(always=True)" in SOURCE
