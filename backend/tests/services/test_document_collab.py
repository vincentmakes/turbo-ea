"""The collaboration hook surface (``app/services/document_collab.py``).

Pure helpers first (no database), then the hooks that touch the session:
``on_workflow`` writes the timeline row, the other three hand back what they
were given.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.services import document_collab as collab
from app.services.card_read_scope import CardReadScope
from tests.conftest import create_user

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
U2 = uuid.UUID("00000000-0000-4000-8000-000000000002")


# --- pure helpers -----------------------------------------------------------------


def test_the_kinds_and_steps():
    assert collab.DOC_KINDS == ("adr", "soaw")
    assert collab.OWNER_COLUMNS == {"adr": "architecture_decision_id", "soaw": "soaw_id"}
    assert collab.WORKFLOW_STEPS == (
        "created",
        "revised",
        "sent_for_review",
        "signature",
        "signed",
        "rejected",
        "recalled",
        "recorded",
    )
    assert collab.TEXT_FIELDS == {
        "adr": ("context", "decision", "consequences", "alternatives_considered"),
        "soaw": ("sections",),
    }


def test_owner_fields():
    assert collab.owner_fields("adr", U1) == {"architecture_decision_id": U1}
    assert collab.owner_fields("soaw", U2) == {"soaw_id": U2}
    with pytest.raises(ValueError):
        collab.owner_fields("card", U1)


def test_history_signatories_keep_id_and_name_only():
    entries = [
        {
            "user_id": str(U1),
            "display_name": "Ada",
            "email": "ada@example.com",
            "status": "pending",
            "signed_at": None,
            "comment": "x",
        },
        {"user_id": str(U2)},
        "junk",
    ]
    assert collab.history_signatories(entries) == [
        {"user_id": str(U1), "display_name": "Ada"},
        {"user_id": str(U2), "display_name": None},
    ]
    assert collab.history_signatories(None) == []


@pytest.mark.parametrize("kind, step", [("card", "created"), ("adr", "saved"), ("soaw", "")])
def test_check_step_refuses_unknown_values(kind, step):
    with pytest.raises(ValueError):
        collab.check_step(kind, step)


def test_check_step_accepts_every_known_pair():
    for kind in collab.DOC_KINDS:
        for step in collab.WORKFLOW_STEPS:
            assert collab.check_step(kind, step) is None


def test_is_signatory():
    sigs = [{"user_id": str(U2)}, "junk", {"display_name": "x"}]
    assert collab.is_signatory(sigs, U2) is True
    assert collab.is_signatory(sigs, U1) is False
    assert collab.is_signatory(None, U1) is False
    assert collab.is_signatory([], U1) is False


@pytest.mark.parametrize(
    "may_comment, may_moderate, signatory, expected",
    [
        (True, True, False, {"comment": True, "moderate": True}),
        (False, False, True, {"comment": True, "moderate": False}),
        (False, True, False, {"comment": False, "moderate": True}),
        (False, False, False, {"comment": False, "moderate": False}),
    ],
)
def test_comment_capabilities(may_comment, may_moderate, signatory, expected):
    assert (
        collab.comment_capabilities(
            may_comment=may_comment, may_moderate=may_moderate, signatory=signatory
        )
        == expected
    )


def test_empty_payloads():
    can = {"comment": True, "moderate": False}
    assert collab.discussion_payload(can) == {"can": can, "open_count": 0, "threads": []}
    assert collab.mentioned_in_payload() == {"decisions": [], "soaws": []}
    assert collab.history_payload([{"id": "x"}], can_view_versions=False) == {
        "can_view_versions": False,
        "entries": [{"id": "x"}],
    }


def _entry(**fields) -> DocumentHistoryEntry:
    base = {
        "id": U1,
        "kind": "signature",
        "actor_id": U2,
        "actor_name": "Ada (then)",
        "note": "fine",
        "content": None,
        "created_at": datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc),
    }
    return DocumentHistoryEntry(**{**base, **fields})


def test_history_entry_payload():
    assert collab.history_entry_payload(_entry(), "Ada") == {
        "id": str(U1),
        "kind": "signature",
        "actor": {"id": str(U2), "display_name": "Ada"},
        "actor_name": "Ada (then)",
        "note": "fine",
        "created_at": "2026-03-01T09:00:00+00:00",
        "has_content": False,
    }


def test_history_entry_payload_without_a_live_actor_or_with_content():
    gone = collab.history_entry_payload(_entry(content={"title": "T"}), None)
    assert (gone["actor"], gone["actor_name"], gone["has_content"]) == (None, "Ada (then)", True)
    system = collab.history_entry_payload(_entry(actor_id=None, created_at=None), "Ada")
    assert (system["actor"], system["created_at"]) == (None, None)
    empty = collab.history_entry_payload(_entry(content={}), None)
    assert empty["has_content"] is True


# --- hooks on the session ------------------------------------------------------------


async def _decision(db) -> ArchitectureDecision:
    adr = ArchitectureDecision(reference_number="ADR-001", title="T")
    db.add(adr)
    await db.flush()
    return adr


async def _rows(db) -> list[DocumentHistoryEntry]:
    return list(
        (await db.execute(select(DocumentHistoryEntry).order_by(DocumentHistoryEntry.seq)))
        .scalars()
        .all()
    )


async def test_on_workflow_writes_a_row_for_a_user(db):
    user = await create_user(db, display_name="Ada")
    adr = await _decision(db)
    entry = await collab.on_workflow(db, "adr", adr, "rejected", user=user, note="Not yet")
    (row,) = await _rows(db)
    assert row is entry
    assert (row.architecture_decision_id, row.soaw_id) == (adr.id, None)
    assert (row.kind, row.actor_id, row.actor_name, row.note) == (
        "rejected",
        user.id,
        "Ada",
        "Not yet",
    )
    assert (row.content, row.signatories, row.via) == (None, None, "system")
    assert row.seq is not None and row.created_at is not None


async def test_on_workflow_looks_up_an_actor_by_id(db):
    user = await create_user(db, display_name="Bob")
    adr = await _decision(db)
    await collab.on_workflow(db, "adr", adr, "created", user=user.id)
    await collab.on_workflow(db, "adr", adr, "signed", user=uuid.uuid4())
    await collab.on_workflow(db, "adr", adr, "recorded", user=None)
    rows = await _rows(db)
    assert [(r.kind, r.actor_id, r.actor_name) for r in rows] == [
        ("created", user.id, "Bob"),
        ("signed", None, None),
        ("recorded", None, None),
    ]
    assert rows[0].seq < rows[1].seq < rows[2].seq


async def test_on_workflow_keeps_signatories_on_a_review_request_only(db):
    soaw = SoAW(name="Plan")
    db.add(soaw)
    await db.flush()
    sigs = [{"user_id": str(U1), "display_name": "Ada", "email": "a@x", "status": "pending"}]
    await collab.on_workflow(db, "soaw", soaw, "sent_for_review", user=None, signatories=sigs)
    await collab.on_workflow(db, "soaw", soaw, "recalled", user=None, signatories=sigs)
    first, second = await _rows(db)
    assert (first.soaw_id, first.architecture_decision_id) == (soaw.id, None)
    assert first.signatories == [{"user_id": str(U1), "display_name": "Ada"}]
    assert second.signatories is None


async def test_on_workflow_blank_note_is_none(db):
    adr = await _decision(db)
    await collab.on_workflow(db, "adr", adr, "signature", user=None, note="")
    (row,) = await _rows(db)
    assert row.note is None


async def test_on_workflow_refuses_an_unknown_step(db):
    adr = await _decision(db)
    with pytest.raises(ValueError):
        await collab.on_workflow(db, "adr", adr, "published", user=None)
    assert await _rows(db) == []


async def test_the_other_hooks_hand_back_what_they_got(db):
    user = await create_user(db)
    adr = await _decision(db)
    incoming = {"decision": "<p>x</p>"}
    scope = CardReadScope.everything()
    assert (
        await collab.before_save(db, "adr", adr, incoming, user=user, read_scope=scope) is incoming
    )
    assert await collab.after_save(db, "adr", adr, user=user, was_draft=True, before=None) is None
    payloads = [{"id": "x"}]
    assert await collab.render_doc(db, "adr", payloads, user=user, read_scope=None) is payloads


async def test_load_document_and_404s(db):
    adr = await _decision(db)
    assert await collab.load_document(db, "adr", str(adr.id)) is adr
    for bad in (str(uuid.uuid4()), "not-a-uuid"):
        with pytest.raises(HTTPException) as exc:
            await collab.load_document(db, "adr", bad)
        assert (exc.value.status_code, exc.value.detail) == (
            404,
            "Architecture decision not found",
        )
    with pytest.raises(HTTPException) as exc:
        await collab.load_document(db, "soaw", str(adr.id))
    assert exc.value.detail == "Statement of Architecture Work not found"


async def test_history_entries_in_seq_order_with_current_names(db):
    user = await create_user(db, display_name="Now")
    adr = await _decision(db)
    other = ArchitectureDecision(reference_number="ADR-002", title="Other")
    db.add(other)
    await db.flush()
    await collab.on_workflow(db, "adr", adr, "created", user=user)
    await collab.on_workflow(db, "adr", other, "created", user=user)
    gone = DocumentHistoryEntry(
        architecture_decision_id=adr.id, kind="signature", actor_name="Gone"
    )
    db.add(gone)
    await db.flush()
    user.display_name = "Renamed"
    await db.flush()
    entries = await collab.history_entries(db, "adr", adr.id)
    assert [(e["kind"], e["actor"], e["actor_name"]) for e in entries] == [
        ("created", {"id": str(user.id), "display_name": "Renamed"}, "Now"),
        ("signature", None, "Gone"),
    ]
