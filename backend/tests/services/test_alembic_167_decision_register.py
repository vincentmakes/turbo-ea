"""Unit tests for migration 167 (decision register, additive step).

These pin the migration's own copy of ``plan_relates_links`` — no DB. The app
copy (``app/services/decision_links_legacy.py``) is pinned by
``test_decision_links_legacy.py``; the two must agree, and the last test here
checks they do on a shared set of cases.
"""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

from app.services import decision_links_legacy

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "167_decision_register.py"
)
_spec = importlib.util.spec_from_file_location("mig167", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

A = uuid.UUID("00000000-0000-4000-8000-00000000000a")
B = uuid.UUID("00000000-0000-4000-8000-00000000000b")
C = uuid.UUID("00000000-0000-4000-8000-00000000000c")
GHOST = "00000000-0000-4000-8000-0000000000ff"


def test_revision_chain():
    assert mig.revision == "167"
    assert mig.down_revision == "166"


def test_the_migration_imports_no_app_code():
    source = _MIG_PATH.read_text()
    assert "from app" not in source
    assert "import app" not in source


def test_ids_and_references_resolve_and_are_deduped_per_pair():
    rows = [
        (A, "ADR-001", [str(B), "ADR-002", " adr-002 ", str(C).upper()]),
        (B, "ADR-002", ["ADR-001"]),
        (C, "ADR-003", []),
    ]
    assert mig.plan_relates_links(rows) == [(A, B), (A, C), (B, A)]


def test_self_dict_non_string_and_dangling_entries_are_dropped():
    related = [
        "ADR-001",
        str(A),
        {"type": "assessment", "id": str(B)},
        7,
        None,
        "",
        GHOST,
        "ADR-404",
    ]
    rows = [(A, "ADR-001", related), (B, "ADR-002", None)]
    assert mig.plan_relates_links(rows) == []


def test_a_non_list_value_yields_nothing():
    rows = [(A, "ADR-001", "ADR-002"), (B, "ADR-002", {"x": "ADR-001"})]
    assert mig.plan_relates_links(rows) == []


def test_a_shared_reference_is_ambiguous_and_dropped():
    rows = [(A, "ADR-001", ["ADR-002", str(B)]), (B, "ADR-002", []), (C, "adr-002", [])]
    assert mig.plan_relates_links(rows) == [(A, B)]


def test_the_migration_and_the_app_copy_agree():
    cases = [
        [(A, "ADR-001", ["ADR-002", str(C)]), (B, "ADR-002", [str(A)]), (C, "ADR-003", [])],
        [(A, "ADR-001", [{"id": str(B)}, GHOST, "ADR-001"]), (B, "ADR-002", None)],
        [(A, None, [str(B)]), (B, "ADR-002", ["ADR-002"]), (C, "ADR-002", ["ADR-002"])],
    ]
    for rows in cases:
        assert mig.plan_relates_links(rows) == decision_links_legacy.plan_relates_links(rows)
