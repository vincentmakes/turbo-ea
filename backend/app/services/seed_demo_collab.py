"""NexaTech Industries demo — collaboration on decisions and SoAWs.

Release 2.200.0 gave decisions and Statements of Architecture Work a
discussion, mentions in their text and an edit history. Without demo content a
fresh ``SEED_DEMO=true`` boot shows an empty discussion, a History tab with
nothing to compare and no "Mentioned in" anywhere, so this seeder adds a small,
plausible footprint to the decisions and the SoAW the base seeder creates:

* **mentions** — ADR-003 and ADR-007 each gain one appended sentence naming a
  demo card and another demo decision (the seeded text is kept as it is);
* **discussion** — an open thread with a reply on ADR-006 (in review), tagged
  to its Decision section and mentioning a card; a resolved thread on ADR-001
  (signed); a rejection of ADR-007 with its reason, the matching ``rejected``
  timeline row and the author's answer; an open thread on the SAP S/4HANA
  Migration SoAW;
* **history** — first, every demo document without a timeline gets the one
  migration 171 gives the documents of an upgraded install
  (``document_history_service.backfill_timelines``: created or revised, sent
  for review with its signatories, signatures, signed, recorded); then three
  versions of ADR-003 (a draft) with visibly different wording, oldest first.

Everything is written through the collaboration services
(``document_collab``, ``document_discussion_service``,
``document_history_service``), so the comment allowlist, the mention checks,
the section rule and the version rules hold exactly as for a person. The
demo has one real account, the first admin, so the services run as that
admin; the reviewers' comments are then attributed to the reviewer personas
the base seeder names as signatories ("Data Architecture Lead", "CTO Office",
…), stored as an author name without an account, the way a comment of a
former colleague reads.

Targets are found by natural key — reference number, revision AND title from
the base seeder's constants — and only while that row is still the current
revision; a missing target skips its part. Idempotent via the durable marker
in ``app_settings.general_settings.demoSeeded`` (see ``seed_markers``), with a
natural-key skip per part on top. A separate seeder key because every
existing demo install has already marked the other seeders complete, so this
runs once on such an install at its next start.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.document_comment import DocumentComment
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.models.user import User
from app.services import document_collab as collab
from app.services import document_discussion_service as discussion
from app.services import document_history_service as history
from app.services.mention_markup import canonical_span
from app.services.mention_service import marker_of
from app.services.seed_demo import (
    DEMO_ADR_REGISTER,
    DEMO_ADRS,
    DEMO_ADRS_EXTRA,
    DEMO_SOAW_SAP,
)
from app.services.seed_markers import demo_seed_completed, mark_demo_seed_completed

SEEDER_KEY = "decision_collab"


def _title(reference: str, revision: int = 1) -> str:
    """The seeded title of ``reference`` revision ``revision`` (its natural key)."""
    for d in DEMO_ADRS + DEMO_ADRS_EXTRA + DEMO_ADR_REGISTER:
        if d["reference_number"] == reference and d.get("revision_number", 1) == revision:
            return str(d["title"])
    raise KeyError((reference, revision))


# (reference number, revision, title) of every decision this seeder touches.
CLOUD_FIRST = ("ADR-001", 1, _title("ADR-001"))
API_GATEWAY = ("ADR-002", 2, _title("ADR-002", 2))
SAP_INTEGRATION = ("ADR-003", 1, _title("ADR-003"))
DATA_WAREHOUSE = ("ADR-006", 1, _title("ADR-006"))
CONTAINER_FIRST = ("ADR-007", 1, _title("ADR-007"))

SAP_SOAW_NAME: str = str(DEMO_SOAW_SAP["name"])

# (card type, name) of the cards the seeded text mentions.
CARD_SAP_S4 = ("Application", "SAP S/4HANA")
CARD_SNOWFLAKE = ("Application", "Snowflake")
CARD_AKS = ("ITComponent", "Azure Kubernetes Service")

# Reviewer personas: the signatory names the base seeder already uses.
DATA_ARCHITECTURE_LEAD = "Data Architecture Lead"
CTO_OFFICE = "CTO Office"
ENTERPRISE_ARCHITECT = "Enterprise Architect"
SAP_SOLUTION_ARCHITECT = "SAP Solution Architect"

# --- ADR-003: the three versions ---------------------------------------------------

#: The first version's title and decision text; the second keeps the seeded
#: title with a firmer decision; the third is the seeded text plus a sentence.
SAP_V1_TITLE = "Evaluate SAP Integration Suite for S/4HANA Connectivity"
SAP_V1_DECISION = (
    "<p>Evaluate SAP Integration Suite (formerly CPI) as the middleware for the "
    "S/4HANA integrations. Point-to-point interfaces remain allowed while the "
    "migration is under way.</p>"
)
SAP_V2_DECISION = (
    "<p>Adopt SAP Integration Suite (formerly CPI) as the primary middleware for "
    "S/4HANA-connected integrations. A point-to-point integration needs an "
    "approved exception.</p>"
)


def sap_mention_sentence(card_id: Any, decision_id: Any) -> str:
    """The sentence appended to ADR-003's decision text."""
    return (
        "<p>The first integration flows connect "
        f"{canonical_span('card', card_id)} with the MES and PLM systems; non-SAP "
        f"consumers keep using the gateway set out in {canonical_span('decision', decision_id)}"
        ".</p>"
    )


def container_mention_sentence(card_id: Any, decision_id: Any) -> str:
    """The sentence appended to ADR-007's decision text after its rejection."""
    return (
        "<p>This applies the cloud-first strategy of "
        f"{canonical_span('decision', decision_id)} to deployment: new services run on "
        f"{canonical_span('card', card_id)}, and every VM-based service gets a "
        "migration date in the cloud roadmap.</p>"
    )


# --- the discussion ------------------------------------------------------------------

REJECTION_REASON = (
    "The exception route is too open: 'migrated opportunistically' sets no end date "
    "for the VM estate, and the decision does not say how it follows the cloud-first "
    "strategy. Please add both before the next round."
)
REJECTION_ANSWER = (
    "<p>Done: the decision now points to the cloud-first strategy and every "
    "VM-based service gets a migration date. Ready for another look.</p>"
)


def warehouse_question(card_id: Any) -> str:
    """The open thread on ADR-006's Decision section."""
    return (
        "<p>Before I sign: the medallion layers assume "
        f"{canonical_span('card', card_id)} stays our only warehouse. Is the marketing "
        "instance folded into it, or do we run two accounts until the SQL Server "
        "reports are migrated?</p>"
    )


WAREHOUSE_ANSWER = (
    "<p>One account. The marketing instance moves in during the bronze phase; the "
    "SQL Server reports follow in the silver phase.</p>"
)
CLOUD_QUESTION = (
    "<p>We promise portable container-based deployments to limit lock-in. Who "
    "checks that the exceptions stay exceptions?</p>"
)
CLOUD_ANSWER = (
    "<p>The Architecture Review Board reviews the exception list every quarter; "
    "the first review is on its agenda.</p>"
)


def soaw_question(card_id: Any) -> str:
    """The open thread on the SAP SoAW's assumptions and constraints."""
    return (
        "<p>The constraints should name the cut-over freeze for "
        f"{canonical_span('card', card_id)}: no new interfaces in the four weeks "
        "before go-live.</p>"
    )


# ===================================================================
# Helpers
# ===================================================================


@dataclass
class _Clock:
    """Timestamps counted back from the seeding moment."""

    now: datetime

    def days_ago(self, days: float) -> datetime:
        return self.now - timedelta(days=days)


async def _decision(db: AsyncSession, key: tuple[str, int, str]) -> ArchitectureDecision | None:
    """The decision named by ``(reference, revision, title)`` while it is the
    current revision of its chain (no later revision points at it)."""
    reference, revision, title = key
    row = (
        await db.execute(
            select(ArchitectureDecision).where(
                ArchitectureDecision.reference_number == reference,
                ArchitectureDecision.revision_number == revision,
                ArchitectureDecision.title == title,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    child = (
        await db.execute(
            select(ArchitectureDecision.id).where(ArchitectureDecision.parent_id == row.id).limit(1)
        )
    ).scalar_one_or_none()
    return None if child is not None else row


async def _decision_id(db: AsyncSession, key: tuple[str, int, str]) -> uuid.UUID | None:
    """The id of the decision named by ``key``, current or not (a mention of
    any revision names its whole chain)."""
    reference, revision, title = key
    return (
        await db.execute(
            select(ArchitectureDecision.id).where(
                ArchitectureDecision.reference_number == reference,
                ArchitectureDecision.revision_number == revision,
                ArchitectureDecision.title == title,
            )
        )
    ).scalar_one_or_none()


async def _card_id(db: AsyncSession, key: tuple[str, str]) -> uuid.UUID | None:
    card_type, name = key
    return (
        await db.execute(
            select(Card.id)
            .where(Card.type == card_type, Card.name == name, Card.status != "ARCHIVED")
            .order_by(Card.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()


async def _soaw(db: AsyncSession, name: str) -> SoAW | None:
    """The current revision of the SoAW called ``name``."""
    rows = (await db.execute(select(SoAW).where(SoAW.name == name))).scalars().all()
    parents = {r.parent_id for r in rows}
    current = [r for r in rows if r.id not in parents]
    return max(current, key=lambda r: r.revision_number) if current else None


def _history_owner(doc_kind: str) -> Any:
    return getattr(DocumentHistoryEntry, collab.OWNER_COLUMNS[doc_kind])


async def _last_seq(db: AsyncSession, doc_kind: str, doc_id: uuid.UUID) -> int:
    value = (
        await db.execute(
            select(func.max(DocumentHistoryEntry.seq)).where(_history_owner(doc_kind) == doc_id)
        )
    ).scalar_one_or_none()
    return int(value or 0)


async def _date_new_rows(
    db: AsyncSession, doc_kind: str, doc_id: uuid.UUID, after_seq: int, at: datetime
) -> int:
    """Date the document's timeline rows written after ``after_seq`` at ``at``;
    returns the last ``seq`` now on the timeline."""
    rows = (
        (
            await db.execute(
                select(DocumentHistoryEntry).where(
                    _history_owner(doc_kind) == doc_id, DocumentHistoryEntry.seq > after_seq
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.created_at = at
    await db.flush()
    return max([after_seq, *(r.seq for r in rows)])


async def _has_comment(db: AsyncSession, doc_kind: str, doc_id: uuid.UUID, body: str) -> bool:
    """Whether the document already holds a comment with this stored body."""
    owner = getattr(DocumentComment, collab.OWNER_COLUMNS[doc_kind])
    html = discussion.comment_html(body, allow_empty=True)
    found = await db.execute(
        select(DocumentComment.id).where(owner == doc_id, DocumentComment.body == html).limit(1)
    )
    return found.scalar_one_or_none() is not None


def _as_persona(comment: DocumentComment, name: str) -> None:
    """Attribute a comment to a reviewer who has no account on the demo."""
    comment.author_id = None
    comment.author_name = name


def _date(comment: DocumentComment, at: datetime) -> None:
    comment.created_at = at
    comment.updated_at = at


async def _post(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    *,
    admin: User,
    body: str,
    at: datetime,
    section: str | None = None,
    parent: DocumentComment | None = None,
    persona: str | None = None,
) -> DocumentComment:
    """One comment through the discussion service, dated ``at``."""
    acc = await discussion.access(db, doc_kind, doc, admin)
    written = await discussion.add_comment(
        db,
        doc_kind,
        doc,
        user=admin,
        acc=acc,
        body=body,
        section=section,
        parent_id=str(parent.id) if parent is not None else None,
    )
    comment = written.comment
    if persona is not None:
        _as_persona(comment, persona)
    _date(comment, at)
    await db.flush()
    return comment


async def _append(
    db: AsyncSession,
    doc: ArchitectureDecision,
    sentence: str,
    *,
    admin: User,
) -> str:
    """``doc``'s decision text with ``sentence`` appended, as the mention
    rules store it (checked against the admin's read scope)."""
    out = await collab.before_save(
        db,
        collab.ADR,
        doc,
        {"decision": (doc.decision or "") + sentence},
        user=admin,
        read_scope=None,
    )
    return str(out["decision"])


# ===================================================================
# The parts
# ===================================================================


async def _seed_sap_versions(
    db: AsyncSession,
    doc: ArchitectureDecision,
    *,
    admin: User,
    card_id: uuid.UUID,
    gateway_id: uuid.UUID,
    clock: _Clock,
) -> int:
    """ADR-003: three versions, the last one the seeded text with a mention
    sentence appended. Returns the number of versions written (0 when the
    decision is no draft, already mentions the card or already has versions)."""
    if doc.status != "draft" or marker_of("card", card_id) in (doc.decision or ""):
        return 0
    if await history.latest_version(db, collab.ADR, doc.id) is not None:
        return 0
    final_title = doc.title
    final_decision = await _append(db, doc, sap_mention_sentence(card_id, gateway_id), admin=admin)
    seq = await _last_seq(db, collab.ADR, doc.id)
    has_created = (
        await db.execute(
            select(DocumentHistoryEntry.id).where(
                _history_owner(collab.ADR) == doc.id, DocumentHistoryEntry.kind == "created"
            )
        )
    ).first() is not None

    # Version 1: the first wording.
    doc.title = SAP_V1_TITLE
    doc.decision = SAP_V1_DECISION
    await db.flush()
    first = await history.current_snapshot(db, collab.ADR, doc)
    if not has_created:
        await collab.on_workflow(db, collab.ADR, doc, "created", user=admin)
        seq = await _date_new_rows(db, collab.ADR, doc.id, seq, clock.days_ago(14))

    # Version 2: the seeded title, a firmer decision. Without a ``created`` row
    # carrying content, the save first keeps version 1 as the baseline.
    doc.title = final_title
    doc.decision = SAP_V2_DECISION
    await db.flush()
    await collab.after_save(db, collab.ADR, doc, user=admin, was_draft=True, before=first)
    if has_created:
        # The baseline is version 1, the save version 2.
        rows = (
            (
                await db.execute(
                    select(DocumentHistoryEntry)
                    .where(_history_owner(collab.ADR) == doc.id, DocumentHistoryEntry.seq > seq)
                    .order_by(DocumentHistoryEntry.seq)
                )
            )
            .scalars()
            .all()
        )
        for row, days in zip(rows, (14, 8), strict=False):
            row.created_at = clock.days_ago(days)
        await db.flush()
        seq = max([seq, *(r.seq for r in rows)])
    else:
        seq = await _date_new_rows(db, collab.ADR, doc.id, seq, clock.days_ago(8))

    # Version 3: the seeded text with the mention sentence.
    second = await history.current_snapshot(db, collab.ADR, doc)
    doc.decision = final_decision
    await db.flush()
    await collab.after_save(db, collab.ADR, doc, user=admin, was_draft=True, before=second)
    await _date_new_rows(db, collab.ADR, doc.id, seq, clock.days_ago(3))
    return 3


async def _seed_container_rejection(
    db: AsyncSession,
    doc: ArchitectureDecision,
    *,
    admin: User,
    card_id: uuid.UUID,
    cloud_id: uuid.UUID,
    clock: _Clock,
) -> dict[str, int]:
    """ADR-007: sent for review, rejected by the Enterprise Architect with a
    reason (the ``rejection`` thread and the ``rejected`` row), answered by
    the author, whose amended text mentions a card and ADR-001."""
    counts = {"threads": 0, "replies": 0, "mentions": 0}
    if doc.status != "draft":
        return counts
    already = (
        await db.execute(
            select(DocumentHistoryEntry.id).where(
                _history_owner(collab.ADR) == doc.id, DocumentHistoryEntry.kind == "rejected"
            )
        )
    ).first()
    if already is None:
        seq = await _last_seq(db, collab.ADR, doc.id)
        await collab.on_workflow(
            db,
            collab.ADR,
            doc,
            "sent_for_review",
            user=admin,
            signatories=[
                {"user_id": "demo-sig-enterprise-architect", "display_name": ENTERPRISE_ARCHITECT},
                {"user_id": "demo-sig-cto-office", "display_name": CTO_OFFICE},
            ],
        )
        seq = await _date_new_rows(db, collab.ADR, doc.id, seq, clock.days_ago(10))
        rejected = await collab.on_workflow(
            db, collab.ADR, doc, "rejected", user=admin, note=REJECTION_REASON
        )
        rejected.actor_id = None
        rejected.actor_name = ENTERPRISE_ARCHITECT
        seq = await _date_new_rows(db, collab.ADR, doc.id, seq, clock.days_ago(8))
        thread = (
            await db.execute(
                select(DocumentComment)
                .where(
                    DocumentComment.architecture_decision_id == doc.id,
                    DocumentComment.kind == discussion.REJECTION,
                )
                .order_by(DocumentComment.created_at.desc())
                .limit(1)
            )
        ).scalar_one()
        _as_persona(thread, ENTERPRISE_ARCHITECT)
        _date(thread, clock.days_ago(8))
        await db.flush()
        await _post(
            db,
            collab.ADR,
            doc,
            admin=admin,
            body=REJECTION_ANSWER,
            parent=thread,
            at=clock.days_ago(6),
        )
        counts["threads"] += 1
        counts["replies"] += 1

    if marker_of("card", card_id) not in (doc.decision or ""):
        seq = await _last_seq(db, collab.ADR, doc.id)
        before = await history.current_snapshot(db, collab.ADR, doc)
        doc.decision = await _append(
            db, doc, container_mention_sentence(card_id, cloud_id), admin=admin
        )
        await db.flush()
        await collab.after_save(db, collab.ADR, doc, user=admin, was_draft=True, before=before)
        await _date_new_rows(db, collab.ADR, doc.id, seq, clock.days_ago(6))
        counts["mentions"] += 2
    return counts


async def _seed_thread(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    *,
    admin: User,
    question: str,
    persona: str,
    section: str,
    asked: datetime,
    answer: str | None = None,
    answered: datetime | None = None,
    resolved: datetime | None = None,
) -> dict[str, int]:
    """A thread opened by a reviewer persona, optionally answered by the
    author and resolved. Skipped when the document already holds the question."""
    counts = {"threads": 0, "replies": 0}
    if await _has_comment(db, doc_kind, doc.id, question):
        return counts
    thread = await _post(
        db, doc_kind, doc, admin=admin, body=question, section=section, persona=persona, at=asked
    )
    counts["threads"] = 1
    if answer is not None and answered is not None:
        await _post(db, doc_kind, doc, admin=admin, body=answer, parent=thread, at=answered)
        counts["replies"] = 1
    if resolved is not None:
        acc = await discussion.access(db, doc_kind, doc, admin)
        await discussion.resolve_thread(db, thread, user=admin, acc=acc)
        thread.resolved_at = resolved
        await db.flush()
    return counts


# ===================================================================
# Public entry point
# ===================================================================


async def seed_collab_demo_data(db: AsyncSession, *, now: datetime | None = None) -> dict:
    """Seed the discussion, mentions and history of the demo decisions and SoAW.

    ``now`` is the moment the seeded timestamps count back from (defaults to
    the current time).
    """
    if await demo_seed_completed(db, SEEDER_KEY):
        return {"skipped": True, "reason": "already seeded"}

    admin = (
        await db.execute(
            select(User).where(User.role == "admin").order_by(User.created_at).limit(1)
        )
    ).scalar_one_or_none()
    if admin is None:
        return {"skipped": True, "reason": "no admin user found"}

    cloud_first = await _decision(db, CLOUD_FIRST)
    sap = await _decision(db, SAP_INTEGRATION)
    warehouse = await _decision(db, DATA_WAREHOUSE)
    container = await _decision(db, CONTAINER_FIRST)
    soaw = await _soaw(db, SAP_SOAW_NAME)
    if not any((cloud_first, sap, warehouse, container, soaw)):
        # Not a demo register (a real landscape, or the demo decisions are
        # gone): nothing to discuss, now or later.
        await mark_demo_seed_completed(db, SEEDER_KEY)
        await db.commit()
        return {"skipped": True, "reason": "demo decisions not found"}

    # The base seeder inserts the demo decisions and SoAWs as plain rows, after
    # migration 171 ran: give them the timeline that migration gives the
    # documents of an upgraded install first, so both read the same (on
    # ADR-003 the first version below is then the baseline after ``created``).
    await history.backfill_timelines(db)

    clock = _Clock(now or datetime.now(timezone.utc))
    sap_card = await _card_id(db, CARD_SAP_S4)
    snowflake = await _card_id(db, CARD_SNOWFLAKE)
    aks = await _card_id(db, CARD_AKS)
    gateway_id = await _decision_id(db, API_GATEWAY)
    cloud_id = await _decision_id(db, CLOUD_FIRST)

    totals = {"threads": 0, "replies": 0, "mentions": 0, "versions": 0}

    def add(counts: dict[str, int]) -> None:
        for key, value in counts.items():
            totals[key] += value

    if sap is not None and sap_card is not None and gateway_id is not None:
        versions = await _seed_sap_versions(
            db, sap, admin=admin, card_id=sap_card, gateway_id=gateway_id, clock=clock
        )
        totals["versions"] += versions
        totals["mentions"] += 2 if versions else 0

    if container is not None and aks is not None and cloud_id is not None:
        add(
            await _seed_container_rejection(
                db, container, admin=admin, card_id=aks, cloud_id=cloud_id, clock=clock
            )
        )

    if warehouse is not None and snowflake is not None:
        add(
            await _seed_thread(
                db,
                collab.ADR,
                warehouse,
                admin=admin,
                question=warehouse_question(snowflake),
                persona=DATA_ARCHITECTURE_LEAD,
                section="decision",
                asked=clock.days_ago(4),
                answer=WAREHOUSE_ANSWER,
                answered=clock.days_ago(3),
            )
        )

    if cloud_first is not None:
        add(
            await _seed_thread(
                db,
                collab.ADR,
                cloud_first,
                admin=admin,
                question=CLOUD_QUESTION,
                persona=CTO_OFFICE,
                section="consequences",
                asked=clock.days_ago(40),
                answer=CLOUD_ANSWER,
                answered=clock.days_ago(39),
                resolved=clock.days_ago(38),
            )
        )

    if soaw is not None and sap_card is not None:
        add(
            await _seed_thread(
                db,
                collab.SOAW,
                soaw,
                admin=admin,
                question=soaw_question(sap_card),
                persona=SAP_SOLUTION_ARCHITECT,
                section="2.2",
                asked=clock.days_ago(2),
            )
        )

    await mark_demo_seed_completed(db, SEEDER_KEY)
    await db.commit()
    return totals
