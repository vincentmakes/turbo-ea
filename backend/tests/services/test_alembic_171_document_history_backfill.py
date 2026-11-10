"""Unit tests for migration 171 (backfill a timeline for every existing decision and SoAW).

The pure ``plan_history_rows`` is exercised here — no DB. Every planned row is
pinned exactly: owner, kind, actor, name, time and the migration's marker.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "171_document_history_backfill.py"
)
_spec = importlib.util.spec_from_file_location("mig171", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

ADA = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
BOB = uuid.UUID("00000000-0000-4000-8000-0000000000b2")
GONE = uuid.UUID("00000000-0000-4000-8000-0000000000ff")
USERS = {ADA: "Ada Lovelace", BOB: "Bob Builder"}

D1 = uuid.UUID("00000000-0000-4000-8000-0000000000d1")
D2 = uuid.UUID("00000000-0000-4000-8000-0000000000d2")
S1 = uuid.UUID("00000000-0000-4000-8000-0000000000e1")


def at(day: int, hour: int = 9, minute: int = 0) -> datetime:
    return datetime(2026, 3, day, hour, minute, tzinfo=timezone.utc)


def adr(**fields):
    return {
        "kind": "adr",
        "id": D1,
        "parent_id": None,
        "created_at": at(1),
        "created_by": ADA,
        "signatories": [],
        "signed_at": None,
        "recorded_at": None,
        "recorded_by": None,
        **fields,
    }


def row(owner, kind, when, actor=None, name=None, column="architecture_decision_id"):
    return {
        column: owner,
        "kind": kind,
        "actor_id": actor,
        "actor_name": name,
        "created_at": when,
        "via": "migration:171",
    }


def test_revision_chain():
    assert mig.revision == "171"
    assert mig.down_revision == "170"
    assert mig.VIA == "migration:171"


def test_the_migration_imports_no_app_code():
    source = _MIG_PATH.read_text()
    assert "from app" not in source
    assert "import app" not in source


def test_a_draft_has_one_created_row():
    assert mig.plan_history_rows([adr()], USERS) == [row(D1, "created", at(1), ADA, "Ada Lovelace")]


def test_a_creator_who_no_longer_exists_is_no_actor():
    assert mig.plan_history_rows([adr(created_by=GONE)], USERS) == [row(D1, "created", at(1))]
    assert mig.plan_history_rows([adr(created_by=None)], USERS) == [row(D1, "created", at(1))]


def test_a_signed_decision_with_two_signatories():
    signatories = [
        {
            "user_id": str(BOB),
            "display_name": "Bob (then)",
            "email": "bob@example.com",
            "status": "signed",
            "signed_at": "2026-03-03T10:00:00+00:00",
        },
        {
            "user_id": str(ADA).upper(),
            "display_name": "Ada",
            "email": "ada@example.com",
            "status": "signed",
            "signed_at": "2026-03-02T08:30:00",
        },
    ]
    planned = mig.plan_history_rows([adr(signatories=signatories, signed_at=at(3, 10))], USERS)
    assert planned == [
        row(D1, "created", at(1), ADA, "Ada Lovelace"),
        row(D1, "signature", at(2, 8, 30), ADA, "Ada"),
        row(D1, "signature", at(3, 10), BOB, "Bob (then)"),
        row(D1, "signed", at(3, 10)),
    ]
    assert all("email" not in str(r) for r in planned)
    assert all("example.com" not in str(r) for r in planned)


def test_a_recorded_decision():
    planned = mig.plan_history_rows([adr(recorded_at=at(4), recorded_by=BOB)], USERS)
    assert planned == [
        row(D1, "created", at(1), ADA, "Ada Lovelace"),
        row(D1, "recorded", at(4), BOB, "Bob Builder"),
    ]


def test_a_recorded_by_who_no_longer_exists():
    planned = mig.plan_history_rows([adr(recorded_at=at(4), recorded_by=GONE)], USERS)
    assert planned[1] == row(D1, "recorded", at(4))


def test_a_revision_is_revised_not_created():
    planned = mig.plan_history_rows([adr(id=D2, parent_id=D1, created_by=BOB)], USERS)
    assert planned == [row(D2, "revised", at(1), BOB, "Bob Builder")]


def test_a_soaw():
    soaw = {
        "kind": "soaw",
        "id": S1,
        "parent_id": None,
        "created_at": at(5),
        "created_by": BOB,
        "signatories": [
            {
                "user_id": "demo-sig-cto-office",
                "display_name": "CTO Office",
                "email": "cto@example.com",
                "status": "signed",
                "signed_at": "2026-03-06T09:00:00Z",
            }
        ],
        "signed_at": at(6),
        # A SoAW has no recorded step, whatever the row carries.
        "recorded_at": at(7),
        "recorded_by": ADA,
    }
    assert mig.plan_history_rows([soaw], USERS) == [
        row(S1, "created", at(5), BOB, "Bob Builder", column="soaw_id"),
        row(S1, "signature", at(6), None, "CTO Office", column="soaw_id"),
        row(S1, "signed", at(6), column="soaw_id"),
    ]


def test_malformed_signatory_entries_are_skipped():
    signatories = [
        "not a dict",
        None,
        {"user_id": str(ADA), "display_name": "Pending", "status": "pending", "signed_at": None},
        {"user_id": str(ADA), "display_name": "No time", "status": "signed"},
        {"user_id": str(ADA), "display_name": "Bad time", "status": "signed", "signed_at": "x"},
        {"user_id": str(ADA), "display_name": "Number", "status": "signed", "signed_at": 5},
        {"user_id": 7, "display_name": "", "status": "signed", "signed_at": "2026-03-02T00:00:00Z"},
        {"user_id": "not-a-uuid", "status": "signed", "signed_at": "2026-03-02T01:00:00Z"},
    ]
    planned = mig.plan_history_rows([adr(signatories=signatories)], USERS)
    assert planned == [
        row(D1, "created", at(1), ADA, "Ada Lovelace"),
        row(D1, "signature", at(2, 0)),
        row(D1, "signature", at(2, 1)),
    ]


def test_non_list_signatories_give_no_signature():
    assert mig.plan_history_rows([adr(signatories={"a": 1})], USERS) == [
        row(D1, "created", at(1), ADA, "Ada Lovelace")
    ]
    assert mig.plan_history_rows([adr(signatories=None)], USERS) == [
        row(D1, "created", at(1), ADA, "Ada Lovelace")
    ]


def test_a_document_without_a_creation_time_has_no_created_row():
    assert mig.plan_history_rows([adr(created_at=None, signed_at=at(2))], USERS) == [
        row(D1, "signed", at(2))
    ]


def test_rows_of_several_documents_interleave_by_time():
    first = adr(signed_at=at(9))
    second = adr(id=D2, created_at=at(2), created_by=BOB)
    planned = mig.plan_history_rows([first, second], USERS)
    assert [(r["architecture_decision_id"], r["kind"]) for r in planned] == [
        (D1, "created"),
        (D2, "created"),
        (D1, "signed"),
    ]


def test_ties_sort_by_step_then_by_document_order():
    sig = {"user_id": str(ADA), "status": "signed", "signed_at": at(1).isoformat()}
    late = adr(id=D2, created_at=at(1), created_by=None)
    early = adr(signatories=[sig], signed_at=at(1), recorded_at=at(1), recorded_by=None)
    planned = mig.plan_history_rows([early, late], USERS)
    assert [(r["architecture_decision_id"], r["kind"]) for r in planned] == [
        (D1, "created"),
        (D2, "created"),
        (D1, "signature"),
        (D1, "signed"),
        (D1, "recorded"),
    ]


def test_naive_datetimes_are_utc():
    naive = datetime(2026, 3, 1, 9, 0)
    assert mig.plan_history_rows([adr(created_at=naive)], USERS)[0]["created_at"] == at(1)


def test_nothing_in_nothing_out():
    assert mig.plan_history_rows([], USERS) == []
