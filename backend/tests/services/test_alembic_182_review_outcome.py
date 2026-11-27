"""Unit tests for migration 182 (review outcomes on decisions and SoAWs).

The pure ``plan_backfill`` is exercised here — no DB: only a draft whose
latest workflow row is ``rejected`` is backfilled as ``changes_requested``,
with that row's time, actor, name and note.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

_MIG_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "182_review_outcome.py"
_spec = importlib.util.spec_from_file_location("mig182", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

ADA = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
D1 = uuid.UUID("00000000-0000-4000-8000-0000000000d1")
D2 = uuid.UUID("00000000-0000-4000-8000-0000000000d2")
D3 = uuid.UUID("00000000-0000-4000-8000-0000000000d3")


def at(day: int) -> datetime:
    return datetime(2026, 3, day, 9, 0, tzinfo=timezone.utc)


def row(owner, seq, kind, *, actor=None, name=None, note=None, day=1):
    return {
        "owner": owner,
        "seq": seq,
        "kind": kind,
        "created_at": at(day),
        "actor_id": actor,
        "actor_name": name,
        "note": note,
    }


def test_revision_chain():
    assert mig.revision == "182"
    assert mig.down_revision == "181"


def test_the_migration_imports_no_app_code():
    source = _MIG_PATH.read_text()
    assert "from app" not in source
    assert "import app" not in source


def test_both_documents_get_the_columns():
    assert mig.TABLES == {
        "architecture_decisions": "architecture_decision_id",
        "statement_of_architecture_works": "soaw_id",
    }
    columns = {c.name: c for c in mig._columns()}
    assert list(columns) == [
        "outcome",
        "outcome_at",
        "outcome_by",
        "outcome_by_name",
        "outcome_note",
    ]
    assert all(c.nullable for c in columns.values())
    assert columns["outcome"].type.length == 20
    assert columns["outcome_note"].type.length == 4000
    (fk,) = columns["outcome_by"].foreign_keys
    assert (fk.target_fullname, fk.ondelete) == ("users.id", "SET NULL")


def test_the_workflow_kinds_are_the_steps_before_this_migration():
    assert mig.WORKFLOW_KINDS == (
        "created",
        "revised",
        "sent_for_review",
        "signature",
        "signed",
        "rejected",
        "recalled",
        "recorded",
    )


def test_a_draft_last_rejected_becomes_changes_requested():
    history = [
        row(D1, 1, "created", actor=ADA, name="Ada", day=1),
        row(D1, 2, "sent_for_review", actor=ADA, name="Ada", day=2),
        row(D1, 3, "rejected", actor=ADA, name="Ada (then)", note="Too costly", day=3),
    ]
    assert mig.plan_backfill([D1], history) == {
        D1: {
            "outcome": "changes_requested",
            "outcome_at": at(3),
            "outcome_by": ADA,
            "outcome_by_name": "Ada (then)",
            "outcome_note": "Too costly",
        }
    }


def test_saves_after_the_rejection_do_not_hide_it():
    history = [
        row(D1, 1, "created"),
        row(D1, 2, "rejected", note="No", day=2),
        row(D1, 3, "save", day=3),
        row(D1, 4, "baseline", day=3),
        row(D1, 5, "restored", day=4),
    ]
    plan = mig.plan_backfill([D1], history)
    assert plan[D1]["outcome_at"] == at(2)
    assert plan[D1]["outcome_by"] is None


def test_a_later_step_leaves_the_draft_alone():
    history = [
        row(D1, 1, "rejected"),
        row(D1, 2, "sent_for_review"),
        row(D1, 3, "recalled"),
        row(D2, 1, "created"),
        row(D3, 4, "rejected"),
        row(D3, 9, "revised"),
    ]
    assert mig.plan_backfill([D1, D2, D3], history) == {}


def test_only_the_drafts_handed_in_are_planned():
    history = [row(D1, 1, "rejected"), row(D2, 1, "rejected")]
    assert set(mig.plan_backfill([D2], history)) == {D2}
    assert mig.plan_backfill([], history) == {}


def test_rows_arrive_in_any_order():
    history = [row(D1, 7, "rejected", note="last", day=7), row(D1, 2, "sent_for_review")]
    assert mig.plan_backfill([D1], history)[D1]["outcome_note"] == "last"
    history = [row(D1, 7, "recalled"), row(D1, 2, "rejected")]
    assert mig.plan_backfill([D1], history) == {}


# --- the backfill against the database (the columns come from the models) -----


async def _backfill(db) -> None:
    conn = await db.connection()
    for table_name, owner_column in mig.TABLES.items():
        await conn.run_sync(mig._backfill, table_name, owner_column)


async def test_the_backfill_touches_only_drafts_last_rejected(db):
    from app.models.architecture_decision import ArchitectureDecision
    from app.models.document_history import DocumentHistoryEntry
    from app.models.soaw import SoAW
    from tests.conftest import create_user

    ada = await create_user(db, email="mig182@test.com")
    rejected = ArchitectureDecision(reference_number="ADR-181", title="Sent back", status="draft")
    resent = ArchitectureDecision(reference_number="ADR-182", title="Resent", status="in_review")
    plain = ArchitectureDecision(reference_number="ADR-183", title="Plain", status="draft")
    kept = ArchitectureDecision(
        reference_number="ADR-184", title="Already", status="draft", outcome="withdrawn"
    )
    soaw = SoAW(name="Sent back plan", status="draft")
    db.add_all([rejected, resent, plain, kept, soaw])
    await db.flush()

    def step(kind, *, adr=None, soaw_doc=None, note=None):
        owner = (
            {"architecture_decision_id": adr.id} if adr is not None else {"soaw_id": soaw_doc.id}
        )
        return DocumentHistoryEntry(
            **owner, kind=kind, actor_id=ada.id, actor_name="Ada (then)", note=note
        )

    for entry in (
        step("sent_for_review", adr=rejected),
        step("rejected", adr=rejected, note="Too costly"),
        step("save", adr=rejected),
        step("rejected", adr=resent, note="old"),
        step("sent_for_review", adr=resent),
        step("rejected", adr=kept, note="ignored"),
        step("rejected", soaw_doc=soaw, note="Scope?"),
    ):
        db.add(entry)
        await db.flush()

    await _backfill(db)
    for doc in (rejected, resent, plain, kept, soaw):
        await db.refresh(doc)

    assert (rejected.outcome, rejected.outcome_by, rejected.outcome_by_name) == (
        "changes_requested",
        ada.id,
        "Ada (then)",
    )
    assert rejected.outcome_note == "Too costly"
    assert rejected.outcome_at is not None
    assert (soaw.outcome, soaw.outcome_note) == ("changes_requested", "Scope?")
    assert (resent.outcome, plain.outcome) == (None, None)
    assert (kept.outcome, kept.outcome_note) == ("withdrawn", None)
