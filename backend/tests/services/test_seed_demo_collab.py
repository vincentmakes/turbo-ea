"""The demo seed of the collaboration features on decisions and SoAWs.

``seed_demo_collab`` adds threads, mentions and versions to the decisions and
the SoAW the base demo seeder creates. These tests run it on a seeded demo and
pin what it writes — the threads, their kinds, authors, sections and resolved
state, the rejection and its timeline row, the three versions of ADR-003 in
order, and the mentions in the text — and its marker contract: it runs once,
and on an install without the demo decisions it writes nothing.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.document_comment import DocumentComment
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.services import document_discussion_service as discussion
from app.services.mention_markup import canonical_span, iter_mentions
from app.services.mention_service import marker_of
from app.services.seed import seed_metamodel
from app.services.seed_demo import DEMO_ADRS, DEMO_ADRS_EXTRA, seed_demo_data
from app.services.seed_demo_collab import (
    API_GATEWAY,
    CARD_AKS,
    CARD_SAP_S4,
    CARD_SNOWFLAKE,
    CLOUD_ANSWER,
    CLOUD_FIRST,
    CLOUD_QUESTION,
    CONTAINER_FIRST,
    DATA_WAREHOUSE,
    REJECTION_ANSWER,
    REJECTION_REASON,
    SAP_INTEGRATION,
    SAP_SOAW_NAME,
    SAP_V1_DECISION,
    SAP_V1_TITLE,
    SAP_V2_DECISION,
    SEEDER_KEY,
    WAREHOUSE_ANSWER,
    container_mention_sentence,
    sap_mention_sentence,
    seed_collab_demo_data,
    soaw_question,
    warehouse_question,
)
from app.services.seed_markers import demo_seed_completed
from tests.conftest import create_user

SEEDED_ON = date(2026, 11, 10)
NOW = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)


def _seeded(reference: str) -> dict:
    return next(d for d in DEMO_ADRS + DEMO_ADRS_EXTRA if d["reference_number"] == reference)


def _ago(days: int) -> datetime:
    return NOW - timedelta(days=days)


# ---------------------------------------------------------------------------
# Without a database
# ---------------------------------------------------------------------------


def test_the_targets_are_named_by_reference_revision_and_title() -> None:
    assert CLOUD_FIRST == ("ADR-001", 1, "Adopt Cloud-First Strategy for All New Applications")
    assert API_GATEWAY == (
        "ADR-002",
        2,
        "Introduce Centralized API Gateway for External and Cross-Domain APIs",
    )
    assert SAP_INTEGRATION == ("ADR-003", 1, "Use SAP Integration Suite for S/4HANA Connectivity")
    assert DATA_WAREHOUSE == ("ADR-006", 1, "Consolidate Data Warehouse on Cloud-Native Platform")
    assert CONTAINER_FIRST == (
        "ADR-007",
        1,
        "Adopt Container-First Deployment for All New Services",
    )
    assert SAP_SOAW_NAME == "SAP S/4HANA Migration — Statement of Architecture Work"


def test_the_appended_sentences_hold_canonical_spans() -> None:
    card, decision = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
    sap = sap_mention_sentence(card, decision)
    assert canonical_span("card", card) in sap
    assert canonical_span("decision", decision) in sap
    assert iter_mentions(sap) == [("card", card), ("decision", decision)]
    container = container_mention_sentence(card, decision)
    assert iter_mentions(container) == [("decision", decision), ("card", card)]
    assert iter_mentions(warehouse_question(card)) == [("card", card)]
    assert iter_mentions(soaw_question(card)) == [("card", card)]


# ---------------------------------------------------------------------------
# On a seeded demo
# ---------------------------------------------------------------------------


async def _seed_demo(db):
    await seed_metamodel(db)
    admin = await create_user(db, role="admin", display_name="Demo Admin")
    await db.commit()
    await seed_demo_data(db, today=SEEDED_ON)
    return admin


async def _decision(db, reference: str, revision: int = 1) -> ArchitectureDecision:
    return (
        await db.execute(
            select(ArchitectureDecision).where(
                ArchitectureDecision.reference_number == reference,
                ArchitectureDecision.revision_number == revision,
            )
        )
    ).scalar_one()


async def _card(db, key: tuple[str, str]) -> Card:
    card_type, name = key
    return (
        await db.execute(select(Card).where(Card.type == card_type, Card.name == name))
    ).scalar_one()


async def _comments(db, column, doc_id) -> list[DocumentComment]:
    return list(
        (
            await db.execute(
                select(DocumentComment)
                .where(column == doc_id)
                .order_by(DocumentComment.created_at, DocumentComment.id)
            )
        )
        .scalars()
        .all()
    )


async def _timeline(db, doc_id) -> list[DocumentHistoryEntry]:
    return list(
        (
            await db.execute(
                select(DocumentHistoryEntry)
                .where(DocumentHistoryEntry.architecture_decision_id == doc_id)
                .order_by(DocumentHistoryEntry.seq)
            )
        )
        .scalars()
        .all()
    )


async def _count_backfilled(db) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(DocumentHistoryEntry)
                .where(DocumentHistoryEntry.via == "migration:171")
            )
        ).scalar_one()
    )


async def _count(db, model) -> int:
    return int((await db.execute(select(func.count()).select_from(model))).scalar_one())


async def test_it_seeds_threads_mentions_and_versions(db):
    await _seed_demo(db)

    result = await seed_collab_demo_data(db, now=NOW)

    assert result == {"threads": 4, "replies": 3, "mentions": 4, "versions": 3}
    assert await demo_seed_completed(db, SEEDER_KEY) is True


async def test_the_open_thread_on_the_decision_in_review(db):
    admin = await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    doc = await _decision(db, "ADR-006")
    snowflake = await _card(db, CARD_SNOWFLAKE)

    thread, reply = await _comments(db, DocumentComment.architecture_decision_id, doc.id)

    assert doc.status == "in_review"
    assert (thread.kind, thread.section, thread.parent_id) == ("comment", "decision", None)
    assert (thread.author_id, thread.author_name) == (None, "Data Architecture Lead")
    assert thread.body == warehouse_question(snowflake.id)
    assert iter_mentions(thread.body) == [("card", str(snowflake.id))]
    assert (thread.resolved_at, thread.created_at) == (None, _ago(4))
    assert (reply.parent_id, reply.section, reply.kind) == (thread.id, "decision", "comment")
    assert (reply.author_id, reply.author_name) == (admin.id, "Demo Admin")
    assert (reply.body, reply.created_at) == (WAREHOUSE_ANSWER, _ago(3))
    assert await discussion.open_thread_count(db, "adr", doc.id) == 1


async def test_the_resolved_thread_on_a_signed_decision(db):
    admin = await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    doc = await _decision(db, "ADR-001")

    thread, reply = await _comments(db, DocumentComment.architecture_decision_id, doc.id)

    assert doc.status == "signed"
    assert (thread.kind, thread.section, thread.author_name) == (
        "comment",
        "consequences",
        "CTO Office",
    )
    assert (thread.body, thread.created_at) == (CLOUD_QUESTION, _ago(40))
    assert (thread.resolved_at, thread.resolved_by) == (_ago(38), admin.id)
    assert (reply.parent_id, reply.author_id, reply.body) == (thread.id, admin.id, CLOUD_ANSWER)
    assert reply.created_at == _ago(39)
    assert await discussion.open_thread_count(db, "adr", doc.id) == 0


async def test_the_rejection_thread_and_its_timeline_row(db):
    admin = await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    doc = await _decision(db, "ADR-007")

    thread, reply = await _comments(db, DocumentComment.architecture_decision_id, doc.id)
    steps = await _timeline(db, doc.id)

    assert doc.status == "draft"
    assert (thread.kind, thread.section, thread.parent_id) == ("rejection", None, None)
    assert (thread.author_id, thread.author_name) == (None, "Enterprise Architect")
    assert thread.body == discussion.plain_to_html(REJECTION_REASON)
    assert (thread.resolved_at, thread.created_at) == (None, _ago(8))
    assert (reply.parent_id, reply.author_id, reply.body) == (thread.id, admin.id, REJECTION_ANSWER)
    assert reply.created_at == _ago(6)
    assert await discussion.open_thread_count(db, "adr", doc.id) == 1

    assert [s.kind for s in steps] == ["created", "sent_for_review", "rejected", "baseline", "save"]
    created, sent, rejected, baseline, save = steps
    # The timeline the base seed's plain row is given first (as migration 171
    # gives an upgraded install's).
    assert (created.via, created.content, created.actor_id) == ("migration:171", None, admin.id)
    assert (sent.actor_id, sent.created_at) == (admin.id, _ago(10))
    assert sent.signatories == [
        {"user_id": "demo-sig-enterprise-architect", "display_name": "Enterprise Architect"},
        {"user_id": "demo-sig-cto-office", "display_name": "CTO Office"},
    ]
    assert (rejected.actor_id, rejected.actor_name) == (None, "Enterprise Architect")
    assert (rejected.note, rejected.created_at) == (REJECTION_REASON, _ago(8))
    assert baseline.content["decision"] == _seeded("ADR-007")["decision"]
    assert save.content["decision"] == doc.decision
    assert (baseline.created_at, save.created_at) == (_ago(6), _ago(6))


async def test_three_versions_of_the_draft_in_order(db):
    admin = await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    doc = await _decision(db, "ADR-003")
    sap = await _card(db, CARD_SAP_S4)
    gateway = await _decision(db, "ADR-002", 2)
    seeded = _seeded("ADR-003")

    steps = await _timeline(db, doc.id)

    final = seeded["decision"] + sap_mention_sentence(sap.id, gateway.id)
    assert doc.status == "draft"
    assert (doc.title, doc.decision) == (seeded["title"], final)
    # A fresh install reads like an upgraded one: the backfilled ``created``
    # row (no content), then version 1 as the baseline and two saves.
    assert [s.kind for s in steps] == ["created", "baseline", "save", "save"]
    assert (steps[0].via, steps[0].content) == ("migration:171", None)
    versions = steps[1:]
    assert [s.content["title"] for s in versions] == [
        SAP_V1_TITLE,
        seeded["title"],
        seeded["title"],
    ]
    assert [s.content["decision"] for s in versions] == [SAP_V1_DECISION, SAP_V2_DECISION, final]
    assert [s.created_at for s in versions] == [_ago(14), _ago(8), _ago(3)]
    assert [s.actor_id for s in versions] == [None, admin.id, admin.id]
    # The other sections are the seeded text in every version.
    assert {s.content["context"] for s in versions} == {seeded["context"]}


async def test_the_mentions_in_the_text(db):
    await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    sap_doc, container = await _decision(db, "ADR-003"), await _decision(db, "ADR-007")
    sap, aks = await _card(db, CARD_SAP_S4), await _card(db, CARD_AKS)
    gateway, cloud = await _decision(db, "ADR-002", 2), await _decision(db, "ADR-001")

    assert sap_doc.decision.startswith(_seeded("ADR-003")["decision"])
    assert iter_mentions(sap_doc.decision) == [("card", str(sap.id)), ("decision", str(gateway.id))]
    assert container.decision == _seeded("ADR-007")["decision"] + container_mention_sentence(
        aks.id, cloud.id
    )
    assert iter_mentions(container.decision) == [
        ("decision", str(cloud.id)),
        ("card", str(aks.id)),
    ]
    for doc in (sap_doc, container):
        for field in ("context", "consequences", "alternatives_considered"):
            assert iter_mentions(getattr(doc, field) or "") == []


async def test_the_soaw_thread(db):
    await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    soaw = (await db.execute(select(SoAW).where(SoAW.name == SAP_SOAW_NAME))).scalar_one()
    sap = await _card(db, CARD_SAP_S4)

    (thread,) = await _comments(db, DocumentComment.soaw_id, soaw.id)

    assert (thread.kind, thread.section, thread.author_name) == (
        "comment",
        "2.2",
        "SAP Solution Architect",
    )
    assert (thread.body, thread.resolved_at, thread.created_at) == (
        soaw_question(sap.id),
        None,
        _ago(2),
    )
    assert await discussion.open_thread_count(db, "soaw", soaw.id) == 1


async def test_every_seeded_mention_names_an_existing_card_or_decision(db):
    await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    texts = [c.body for c in (await db.execute(select(DocumentComment))).scalars().all()]
    for doc in (await db.execute(select(ArchitectureDecision))).scalars().all():
        texts += [doc.context or "", doc.decision or "", doc.consequences or ""]
    mentions = {m for text in texts for m in iter_mentions(text)}
    cards = {str(i) for i in (await db.execute(select(Card.id))).scalars().all()}
    decisions = {str(i) for i in (await db.execute(select(ArchitectureDecision.id))).scalars()}

    assert {kind for kind, _ in mentions} == {"card", "decision"}
    assert len(mentions) == 5
    for kind, target in mentions:
        assert target in (cards if kind == "card" else decisions), (kind, target)
    assert marker_of("card", (await _card(db, CARD_SNOWFLAKE)).id) in "".join(texts)


async def test_seeding_twice_changes_nothing(db):
    await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    comments = await _count(db, DocumentComment)
    steps = await _count(db, DocumentHistoryEntry)
    sap_text = (await _decision(db, "ADR-003")).decision

    again = await seed_collab_demo_data(db, now=NOW)

    assert again == {"skipped": True, "reason": "already seeded"}
    backfilled = await _count_backfilled(db)
    assert (comments, steps - backfilled) == (7, 7)
    assert backfilled > 0
    assert await _count(db, DocumentComment) == comments
    assert await _count(db, DocumentHistoryEntry) == steps
    assert (await _decision(db, "ADR-003")).decision == sap_text


async def test_deleted_threads_are_not_brought_back(db):
    await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)
    for comment in (await db.execute(select(DocumentComment))).scalars().all():
        await db.delete(comment)
    await db.commit()

    again = await seed_collab_demo_data(db, now=NOW)

    assert again["skipped"] is True
    assert await _count(db, DocumentComment) == 0


async def test_it_skips_and_marks_without_the_demo_decisions(db):
    await seed_metamodel(db)
    await create_user(db, role="admin")
    await db.commit()

    result = await seed_collab_demo_data(db, now=NOW)

    assert result == {"skipped": True, "reason": "demo decisions not found"}
    assert await demo_seed_completed(db, SEEDER_KEY) is True
    assert await _count(db, DocumentComment) == 0
    assert await _count(db, DocumentHistoryEntry) == 0


async def test_a_renamed_decision_is_not_a_target(db):
    """A decision is found by reference, revision AND title, never by its
    reference alone: a renamed ADR-006 gets no thread."""
    await _seed_demo(db)
    doc = await _decision(db, "ADR-006")
    doc.title = "Something else entirely"
    await db.commit()

    await seed_collab_demo_data(db, now=NOW)

    assert await _comments(db, DocumentComment.architecture_decision_id, doc.id) == []


async def test_it_waits_for_an_admin_without_marking(db):
    await seed_metamodel(db)
    await db.commit()

    result = await seed_collab_demo_data(db, now=NOW)

    assert result == {"skipped": True, "reason": "no admin user found"}
    assert await demo_seed_completed(db, SEEDER_KEY) is False


async def test_an_upgraded_install_keeps_its_backfilled_timeline(db):
    """On an existing demo install migration 171 gave every decision a
    ``created`` row without content: the first version is then the baseline."""
    await _seed_demo(db)
    doc = await _decision(db, "ADR-003")
    db.add(DocumentHistoryEntry(architecture_decision_id=doc.id, kind="created", via="m171"))
    await db.commit()

    result = await seed_collab_demo_data(db, now=NOW)

    steps = await _timeline(db, doc.id)
    assert result["versions"] == 3
    assert [s.kind for s in steps] == ["created", "baseline", "save", "save"]
    assert steps[0].content is None
    versions = steps[1:]
    assert [s.content["title"] for s in versions] == [
        SAP_V1_TITLE,
        _seeded("ADR-003")["title"],
        _seeded("ADR-003")["title"],
    ]
    assert [s.content["decision"] for s in versions] == [
        SAP_V1_DECISION,
        SAP_V2_DECISION,
        doc.decision,
    ]
    assert [s.created_at for s in versions] == [_ago(14), _ago(8), _ago(3)]


async def test_each_part_skips_on_its_own_natural_key(db):
    """A decision no longer in the state a part needs, or already holding what
    the part would write, is left alone; the other parts still run."""
    admin = await _seed_demo(db)
    sap = await _decision(db, "ADR-003")
    sap.status = "in_review"
    container = await _decision(db, "ADR-007")
    db.add(DocumentHistoryEntry(architecture_decision_id=container.id, kind="rejected"))
    warehouse = await _decision(db, "ADR-006")
    snowflake = await _card(db, CARD_SNOWFLAKE)
    db.add(
        DocumentComment(
            architecture_decision_id=warehouse.id,
            author_id=admin.id,
            author_name="Demo Admin",
            body=warehouse_question(snowflake.id),
            section="decision",
        )
    )
    await db.commit()

    result = await seed_collab_demo_data(db, now=NOW)

    # ADR-001 and the SoAW get their threads, ADR-007 its amended text only.
    assert result == {"threads": 2, "replies": 1, "mentions": 2, "versions": 0}
    assert iter_mentions(sap.decision) == []
    # ADR-003 in review: its backfilled timeline only, no version.
    assert [s.kind for s in await _timeline(db, sap.id)] == ["created", "sent_for_review"]
    assert [
        c.kind for c in await _comments(db, DocumentComment.architecture_decision_id, container.id)
    ] == []
    assert len(await _comments(db, DocumentComment.architecture_decision_id, warehouse.id)) == 1
    assert len(iter_mentions(container.decision)) == 2


async def test_a_signed_container_decision_is_left_alone(db):
    await _seed_demo(db)
    container = await _decision(db, "ADR-007")
    container.status = "signed"
    await db.commit()

    result = await seed_collab_demo_data(db, now=NOW)

    assert result == {"threads": 3, "replies": 2, "mentions": 2, "versions": 3}
    assert [(s.kind, s.via) for s in await _timeline(db, container.id)] == [
        ("created", "migration:171")
    ]
    assert container.decision == _seeded("ADR-007")["decision"]


async def test_every_demo_document_gets_the_timeline_of_an_upgraded_install(db):
    """The base seed inserts the decisions and SoAWs as plain rows after
    migration 171 ran; the seeder gives each the rows the migration would
    have written, the review request of a document in review included."""
    await _seed_demo(db)
    await seed_collab_demo_data(db, now=NOW)

    decisions = (await db.execute(select(ArchitectureDecision))).scalars().all()
    soaws = (await db.execute(select(SoAW))).scalars().all()
    for doc in decisions:
        opening = [
            (s.kind, s.via) for s in await _timeline(db, doc.id) if s.kind in ("created", "revised")
        ]
        expected = "revised" if doc.parent_id else "created"
        assert opening == [(expected, "migration:171")], doc.reference_number
    for soaw in soaws:
        opening = (
            await db.execute(
                select(DocumentHistoryEntry.kind, DocumentHistoryEntry.via).where(
                    DocumentHistoryEntry.soaw_id == soaw.id,
                    DocumentHistoryEntry.kind.in_(("created", "revised")),
                )
            )
        ).all()
        assert [tuple(r) for r in opening] == [("created", "migration:171")], soaw.name

    warehouse = await _decision(db, "ADR-006")
    steps = await _timeline(db, warehouse.id)
    assert [s.kind for s in steps] == ["created", "sent_for_review"]
    assert steps[1].signatories == [
        {"user_id": s["user_id"], "display_name": s["display_name"]}
        for s in _seeded("ADR-006")["signatories"]
    ]
    assert all("email" not in entry for entry in steps[1].signatories)
