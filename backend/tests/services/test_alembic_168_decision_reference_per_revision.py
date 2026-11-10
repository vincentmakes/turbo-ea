"""Unit tests for migration 168 (a revision keeps its decision's reference).

These pin the migration's pure downgrade planner, ``plan_renumbering`` — no DB.
The up/down/up run against a real database is proven by hand on a scratch
database and by CI's migration rollback job.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "168_decision_reference_per_revision.py"
)
_spec = importlib.util.spec_from_file_location("mig168", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
A = uuid.UUID("00000000-0000-4000-8000-00000000000a")
B = uuid.UUID("00000000-0000-4000-8000-00000000000b")
C = uuid.UUID("00000000-0000-4000-8000-00000000000c")
D = uuid.UUID("00000000-0000-4000-8000-00000000000d")


def test_revision_chain():
    assert mig.revision == "168"
    assert mig.down_revision == "167"


def test_the_migration_imports_no_app_code():
    source = _MIG_PATH.read_text()
    assert "from app" not in source
    assert "import app" not in source


def test_constraint_and_index_names_match_the_model():
    from app.models.architecture_decision import ArchitectureDecision

    table = ArchitectureDecision.__table__
    uniques = {
        c.name: tuple(col.name for col in c.columns)
        for c in table.constraints
        if c.__class__.__name__ == "UniqueConstraint"
    }
    assert uniques == {mig.NEW_UNIQUE: ("reference_number", "revision_number")}
    assert {i.name for i in table.indexes} >= {mig.REFERENCE_INDEX}
    assert table.c.reference_number.unique is not True
    assert "related_decisions" not in table.c
    assert mig.OLD_UNIQUE == "architecture_decisions_reference_number_key"


def test_unique_references_need_no_renumbering():
    rows = [(A, "ADR-001", 1, T0), (B, "ADR-002", 1, T0)]
    assert mig.plan_renumbering(rows) == []


def test_an_empty_table_needs_nothing():
    assert mig.plan_renumbering([]) == []


def test_the_first_revision_keeps_the_reference_and_later_ones_continue_the_sequence():
    rows = [
        (C, "ADR-001", 3, T0),
        (A, "ADR-001", 1, T0 + timedelta(days=5)),
        (B, "ADR-001", 2, T0),
        (D, "ADR-007", 1, T0),
    ]
    assert mig.plan_renumbering(rows) == [(B, "ADR-008"), (C, "ADR-009")]


def test_a_tie_on_revision_is_broken_by_created_at_then_id():
    rows = [
        (B, "ADR-004", 2, T0 + timedelta(hours=1)),
        (D, "ADR-004", 2, T0),
        (C, "ADR-004", 1, T0),
        (A, "ADR-004", 1, T0),
    ]
    # Keeper: (1, T0, A). Then (1, T0, C), (2, T0, D), (2, T0+1h, B).
    assert mig.plan_renumbering(rows) == [(C, "ADR-005"), (D, "ADR-006"), (B, "ADR-007")]


def test_a_missing_created_at_sorts_first():
    rows = [(A, "ADR-002", 1, T0), (B, "ADR-002", 1, None)]
    assert mig.plan_renumbering(rows) == [(A, "ADR-003")]


def test_groups_are_renumbered_in_reference_order_from_one_counter():
    rows = [
        (A, "ADR-010", 1, T0),
        (B, "ADR-010", 2, T0),
        (C, "ADR-002", 1, T0),
        (D, "ADR-002", 2, T0),
    ]
    assert mig.plan_renumbering(rows) == [(D, "ADR-011"), (B, "ADR-012")]


def test_numbering_is_numeric_case_insensitive_and_ignores_other_formats():
    rows = [
        (A, "ADR-999", 1, T0),
        (B, "adr-1000", 1, T0),
        (C, "DEC-5000", 1, T0),
        (D, "DEC-5000", 2, T0),
    ]
    assert mig.plan_renumbering(rows) == [(D, "ADR-1001")]


def test_numbers_are_zero_padded_to_three_digits_and_references_compare_exactly():
    rows = [(A, "X", 1, T0), (B, "X", 2, T0), (C, "x", 1, T0)]
    assert mig.plan_renumbering(rows) == [(B, "ADR-001")]
