"""The timeline a document gets from what it stores: the service copy
(``document_history_service.plan_backfill`` / ``backfill_timelines``, used by
the demo seeder) and migration 171's frozen copy (``plan_history_rows``) must
plan the same rows, so a fresh demo install reads like an upgraded one.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.services import document_history_service as history
from tests.conftest import create_user

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "171_document_history_backfill.py"
)
_spec = importlib.util.spec_from_file_location("mig171_backfill", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

ADA = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
BOB = uuid.UUID("00000000-0000-4000-8000-0000000000b2")
GONE = uuid.UUID("00000000-0000-4000-8000-0000000000ff")
USERS = {ADA: "Ada Lovelace", BOB: "Bob Builder"}


def at(day: int, hour: int = 9) -> datetime:
    return datetime(2026, 3, day, hour, 0, tzinfo=timezone.utc)


def _id(n: int) -> uuid.UUID:
    return uuid.UUID(f"00000000-0000-4000-8000-{n:012d}")


def _signed(user_id, name, when) -> dict:
    return {
        "user_id": str(user_id),
        "display_name": name,
        "email": "x@example.com",
        "status": "signed",
        "signed_at": when.isoformat(),
    }


def _pending(user_id, name) -> dict:
    return {
        "user_id": str(user_id),
        "display_name": name,
        "email": "y@example.com",
        "status": "pending",
        "signed_at": None,
    }


def _adr(n, **fields) -> dict:
    return {
        "kind": "adr",
        "id": _id(n),
        "parent_id": None,
        "status": "draft",
        "created_at": at(1),
        "updated_at": at(1),
        "created_by": ADA,
        "signatories": [],
        "signed_at": None,
        "recorded_at": None,
        "recorded_by": None,
        **fields,
    }


#: A draft, a decision in review with one signature given, a signed decision
#: with two signatures, a recorded one, a revision, and a SoAW in review.
REPRESENTATIVE = [
    _adr(1),
    _adr(
        2,
        status="in_review",
        created_at=at(2),
        updated_at=at(5),
        signatories=[_pending(BOB, "Bob"), _signed(ADA, "Ada", at(4)), "junk"],
    ),
    _adr(
        3,
        status="signed",
        created_at=at(1, 8),
        updated_at=at(6),
        signatories=[_signed(ADA, "Ada", at(3)), _signed(GONE, "Gone", at(6))],
        signed_at=at(6),
    ),
    _adr(4, status="recorded", recorded_at=at(7), recorded_by=BOB, created_by=GONE),
    _adr(5, parent_id=_id(3), created_at=at(8), created_by=BOB),
    {
        "kind": "soaw",
        "id": _id(6),
        "parent_id": None,
        "status": "in_review",
        "created_at": at(2),
        "updated_at": at(3),
        "created_by": BOB,
        "signatories": [_pending("demo-sig-cto-office", "CTO Office")],
        "signed_at": None,
    },
]


def test_the_service_and_the_migration_plan_the_same_rows():
    planned = history.plan_backfill(REPRESENTATIVE, USERS)
    assert planned == mig.plan_history_rows(REPRESENTATIVE, USERS)
    assert [
        (r.get("architecture_decision_id") or r.get("soaw_id"), r["kind"]) for r in planned
    ] == [
        (_id(3), "created"),
        (_id(1), "created"),
        (_id(4), "created"),
        (_id(2), "created"),
        (_id(6), "created"),
        (_id(6), "sent_for_review"),
        (_id(3), "signature"),
        (_id(2), "sent_for_review"),
        (_id(2), "signature"),
        (_id(3), "signature"),
        (_id(3), "signed"),
        (_id(4), "recorded"),
        (_id(5), "revised"),
    ]
    sent = [r for r in planned if r["kind"] == "sent_for_review"]
    assert [r["signatories"] for r in sent] == [
        [{"user_id": "demo-sig-cto-office", "display_name": "CTO Office"}],
        [
            {"user_id": str(BOB), "display_name": "Bob"},
            {"user_id": str(ADA), "display_name": "Ada"},
        ],
    ]
    assert [r["created_at"] for r in sent] == [at(3), at(4)]
    assert {r["via"] for r in planned} == {"migration:171"}
    assert all(r["signatories"] is None for r in planned if r["kind"] != "sent_for_review")


@pytest.mark.parametrize("index", range(len(REPRESENTATIVE)))
def test_each_document_alone_is_planned_the_same(index):
    docs = [REPRESENTATIVE[index]]
    assert history.plan_backfill(docs, USERS) == mig.plan_history_rows(docs, USERS)


#: Edge cases, each planned alone by both copies and compared row for row.
EDGE_CASES = {
    "malformed_signatories": _adr(
        7,
        signatories=[
            "not a dict",
            None,
            {"user_id": str(ADA), "display_name": "No time", "status": "signed"},
            {"user_id": str(ADA), "display_name": "Bad", "status": "signed", "signed_at": "x"},
            {"user_id": str(ADA), "display_name": "Num", "status": "signed", "signed_at": 5},
            {"user_id": 7, "display_name": "", "status": "signed", "signed_at": "2026-03-02"},
            {
                "user_id": "nope",
                "display_name": "  ",
                "status": "signed",
                "signed_at": "2026-03-03",
            },
            {
                "user_id": str(BOB).upper(),
                "display_name": "Bob",
                "status": "signed",
                "signed_at": " 2026-03-04T10:00:00 ",
            },
            {
                "user_id": str(GONE),
                "display_name": "Gone",
                "status": "signed",
                "signed_at": "2026-03-05T10:00:00Z",
            },
        ],
    ),
    "non_list_signatories_in_review": _adr(8, status="in_review", signatories={"a": 1}),
    "naive_and_string_times": _adr(
        9,
        created_at="2026-03-01T09:00:00",
        updated_at=" 2026-03-02T09:00:00 ",
        status="in_review",
        signatories=[_pending(ADA, "Ada")],
    ),
    "bad_time_strings": _adr(10, created_at="garbage", updated_at="garbage", status="in_review"),
    "in_review_without_dates": _adr(
        11, status="in_review", created_at=None, updated_at=None, signatories=[]
    ),
    "in_review_updated_before_created": _adr(
        12, status="in_review", created_at=at(5), updated_at=at(4)
    ),
    "in_review_with_only_an_update": _adr(
        13, status="in_review", created_at=None, updated_at=at(4)
    ),
    "creator_as_string_and_gone_recorder": _adr(
        14, created_by=str(BOB), recorded_at=at(9), recorded_by=GONE
    ),
    "creator_not_a_uuid": _adr(15, created_by=12345),
    "soaw_ignores_recorded": {
        "kind": "soaw",
        "id": _id(16),
        "parent_id": _id(6),
        "status": "signed",
        "created_at": at(3),
        "updated_at": at(4),
        "created_by": ADA,
        "signatories": [_signed(ADA, "Ada", at(4))],
        "signed_at": at(4),
        "recorded_at": at(5),
        "recorded_by": ADA,
    },
}


@pytest.mark.parametrize("name", sorted(EDGE_CASES))
def test_edge_cases_are_planned_the_same(name):
    docs = [EDGE_CASES[name]]
    assert history.plan_backfill(docs, USERS) == mig.plan_history_rows(docs, USERS)


def test_all_edge_cases_together_interleave_the_same():
    docs = list(EDGE_CASES.values()) + REPRESENTATIVE
    planned = history.plan_backfill(docs, USERS)
    assert planned == mig.plan_history_rows(docs, USERS)
    assert len(planned) == 31


def test_the_two_mark_their_rows_alike():
    assert history.BACKFILL_VIA == mig.VIA


async def _documents(db, ada, bob):
    """The representative set as rows: a draft, a decision in review, a
    signed one, a recorded one, a revision and a SoAW in review."""
    draft = ArchitectureDecision(
        reference_number="ADR-101", title="Draft", created_by=ada.id, created_at=at(1)
    )
    review = ArchitectureDecision(
        reference_number="ADR-102",
        title="Review",
        status="in_review",
        created_by=ada.id,
        created_at=at(2),
        updated_at=at(5),
        signatories=[_pending(bob.id, "Bob"), _signed(ada.id, "Ada", at(4))],
    )
    signed = ArchitectureDecision(
        reference_number="ADR-103",
        title="Signed",
        status="signed",
        created_by=bob.id,
        created_at=at(1, 8),
        signatories=[_signed(ada.id, "Ada", at(3)), _signed(bob.id, "Bob", at(6))],
        signed_at=at(6),
    )
    recorded = ArchitectureDecision(
        reference_number="ADR-104",
        title="Recorded",
        status="recorded",
        created_at=at(1),
        recorded_at=at(7),
        recorded_by=bob.id,
    )
    db.add_all([draft, review, signed, recorded])
    await db.flush()
    revision = ArchitectureDecision(
        reference_number="ADR-103",
        title="Signed",
        revision_number=2,
        parent_id=signed.id,
        created_by=bob.id,
        created_at=at(8),
    )
    soaw = SoAW(
        name="Plan",
        status="in_review",
        created_by=bob.id,
        created_at=at(2),
        updated_at=at(3),
        signatories=[_pending(ada.id, "Ada")],
    )
    db.add_all([revision, soaw])
    await db.flush()
    return [draft, review, signed, recorded, revision], soaw


def _stored(entry: DocumentHistoryEntry) -> dict:
    owner = (
        {"architecture_decision_id": entry.architecture_decision_id}
        if entry.architecture_decision_id is not None
        else {"soaw_id": entry.soaw_id}
    )
    return {
        **owner,
        "kind": entry.kind,
        "actor_id": entry.actor_id,
        "actor_name": entry.actor_name,
        "created_at": entry.created_at,
        "via": entry.via,
        "signatories": entry.signatories,
    }


async def _migration_input(db, decisions, soaw) -> list[dict]:
    """What migration 171 reads for the same documents, in its order."""
    rows = []
    for doc in sorted(decisions, key=lambda d: (d.created_at, d.id)):
        rows.append(
            {
                "kind": "adr",
                **{
                    c: getattr(doc, c)
                    for c in (
                        "id",
                        "parent_id",
                        "status",
                        "created_at",
                        "updated_at",
                        "created_by",
                        "signatories",
                        "signed_at",
                        "recorded_at",
                        "recorded_by",
                    )
                },
            }
        )
    rows.append(
        {
            "kind": "soaw",
            **{
                c: getattr(soaw, c)
                for c in (
                    "id",
                    "parent_id",
                    "status",
                    "created_at",
                    "updated_at",
                    "created_by",
                    "signatories",
                    "signed_at",
                )
            },
        }
    )
    return rows


async def test_backfill_writes_what_the_migration_plans_and_only_once(db):
    ada = await create_user(db, email="ada@b.test", display_name="Ada Lovelace")
    bob = await create_user(db, email="bob@b.test", display_name="Bob Builder")
    decisions, soaw = await _documents(db, ada, bob)
    users = {ada.id: "Ada Lovelace", bob.id: "Bob Builder"}
    expected = mig.plan_history_rows(await _migration_input(db, decisions, soaw), users)

    written = await history.backfill_timelines(db)

    rows = (
        (await db.execute(select(DocumentHistoryEntry).order_by(DocumentHistoryEntry.seq)))
        .scalars()
        .all()
    )
    assert written == len(expected) == 13
    assert [_stored(r) for r in rows] == expected
    sent = [r for r in rows if r.kind == "sent_for_review"]
    assert [r.signatories for r in sent] == [
        [{"user_id": str(ada.id), "display_name": "Ada"}],
        [
            {"user_id": str(bob.id), "display_name": "Bob"},
            {"user_id": str(ada.id), "display_name": "Ada"},
        ],
    ]
    # Every other row stores SQL NULL signatories, as the migration does.
    nulls = (
        await db.execute(
            select(DocumentHistoryEntry.kind).where(DocumentHistoryEntry.signatories.is_(None))
        )
    ).scalars()
    assert sorted(nulls) == sorted(r.kind for r in rows if r.kind != "sent_for_review")
    assert all(r.content is None for r in rows)

    assert await history.backfill_timelines(db) == 0
    assert len((await db.execute(select(DocumentHistoryEntry))).scalars().all()) == 13


async def test_a_document_with_any_timeline_row_is_left_alone(db):
    kept = ArchitectureDecision(reference_number="ADR-201", title="Kept", created_at=at(1))
    bare = SoAW(name="Bare", created_at=at(2))
    db.add_all([kept, bare])
    await db.flush()
    db.add(DocumentHistoryEntry(architecture_decision_id=kept.id, kind="recalled"))
    await db.flush()

    assert await history.backfill_timelines(db) == 1

    rows = (
        (await db.execute(select(DocumentHistoryEntry).order_by(DocumentHistoryEntry.seq)))
        .scalars()
        .all()
    )
    assert [(r.architecture_decision_id, r.soaw_id, r.kind) for r in rows] == [
        (kept.id, None, "recalled"),
        (None, bare.id, "created"),
    ]
    assert (rows[1].created_at, rows[1].via, rows[1].actor_id) == (at(2), "migration:171", None)
