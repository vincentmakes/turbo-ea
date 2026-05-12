"""GRC API — Governance KPIs and AI Inventory registry.

The Governance and Compliance subtabs of ``/grc`` live behind their own
permission groups (``risks.*``, ``security_compliance.*``, ``adr.*``);
this router owns the AI Governance read surface and a cross-tab overview.

Detection itself is **not** owned by this router — the Compliance Scanner
(``turbolens_security.run_compliance_scan``) is the sole AI detector
entrypoint, and writes into ``ai_governance_classifications`` via the
shared ``persist_ai_governance`` helper. The AI Inventory page reads
from that cache. The single mutation path here (``classify_card_as_ai``)
is a manual curation action, not detection.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.ai_governance import AiGovernanceClassification
from app.models.card import Card
from app.models.risk import Risk, RiskCard
from app.models.stakeholder import Stakeholder
from app.models.turbolens import TurboLensAnalysisRun
from app.schemas.grc import (
    AiInventoryDetection,
    AiInventoryItem,
    AiInventoryKpis,
    AiInventoryPage,
    AiLinkedRisk,
    GrcOverview,
)
from app.services.turbolens_security import persist_ai_governance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/grc", tags=["GRC"])

# Card types that carry the AI Governance section in fields_schema.
_AI_TARGET_TYPES = ("Application", "ITComponent", "Interface")
# Risk statuses that count as "open" on the overview (mirrors risk_service.STATUS_VALUES).
_OPEN_RISK_STATUSES = ("identified", "analysed", "mitigation_planned", "in_progress")
_HIGH_RISK_LEVELS = ("high", "critical")
_HIGH_AI_RISK_CLASSES = ("high", "unacceptable")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _detection_method(
    attrs: dict[str, Any], subtype_match: bool
) -> Literal["subtype", "semantic", "override"]:
    """Pick the method label the inventory dashboard surfaces."""
    if attrs.get("aiClassificationOverride") == "yes":
        return "override"
    if subtype_match:
        return "subtype"
    return "semantic"


async def _stakeholder_counts(db: AsyncSession, card_ids: list[str]) -> dict[str, int]:
    """Return ``{card_id: stakeholder_count}`` for the given cards."""
    if not card_ids:
        return {}
    result = await db.execute(
        select(Stakeholder.card_id, func.count(Stakeholder.id))
        .where(Stakeholder.card_id.in_(card_ids))
        .group_by(Stakeholder.card_id)
    )
    return {str(row[0]): int(row[1]) for row in result.all()}


# ---------------------------------------------------------------------------
# Overview KPIs
# ---------------------------------------------------------------------------


@router.get("/overview", response_model=GrcOverview)
async def grc_overview(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission("grc.view")),
) -> GrcOverview:
    """Cross-tab KPIs for the GRC landing.

    Cheap — counts only, no joins onto findings.
    """
    open_risks = (
        await db.execute(select(func.count(Risk.id)).where(Risk.status.in_(_OPEN_RISK_STATUSES)))
    ).scalar_one()
    high_risks = (
        await db.execute(
            select(func.count(Risk.id)).where(
                Risk.status.in_(_OPEN_RISK_STATUSES),
                or_(
                    Risk.residual_level.in_(_HIGH_RISK_LEVELS),
                    and_(Risk.residual_level.is_(None), Risk.initial_level.in_(_HIGH_RISK_LEVELS)),
                ),
            )
        )
    ).scalar_one()

    ai_total = (await db.execute(select(func.count(AiGovernanceClassification.id)))).scalar_one()

    # AI cards with high/unacceptable risk class (read from card.attributes JSONB).
    ai_high_risk_rows = await db.execute(
        select(Card.id, Card.attributes)
        .join(AiGovernanceClassification, AiGovernanceClassification.card_id == Card.id)
        .where(Card.attributes["aiRiskClass"].astext.in_(_HIGH_AI_RISK_CLASSES))
    )
    ai_high_risk = sum(1 for _row in ai_high_risk_rows.all())

    # AI cards with no stakeholder rows.
    ai_with_owner_subq = select(Stakeholder.card_id).distinct().subquery()
    ai_unowned = (
        await db.execute(
            select(func.count(AiGovernanceClassification.id)).where(
                AiGovernanceClassification.card_id.not_in(select(ai_with_owner_subq))
            )
        )
    ).scalar_one()

    last_discovered = (
        await db.execute(select(func.max(AiGovernanceClassification.detected_at)))
    ).scalar_one_or_none()

    return GrcOverview(
        open_risks=int(open_risks),
        high_or_critical_risks=int(high_risks),
        ai_systems_total=int(ai_total),
        ai_systems_unowned=int(ai_unowned),
        ai_systems_high_risk=int(ai_high_risk),
        ai_systems_last_discovered_at=last_discovered,
    )


# ---------------------------------------------------------------------------
# AI Inventory
# ---------------------------------------------------------------------------


@router.get("/ai-inventory", response_model=AiInventoryPage)
async def get_ai_inventory(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    risk_class: str | None = Query(None),
    lifecycle_stage: str | None = Query(None),
    method: str | None = Query(None, pattern="^(subtype|semantic|override)$"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission("grc.view")),
) -> AiInventoryPage:
    """Paginated list of AI-bearing cards with their AI Governance attributes."""
    # Build the base query: join classification → card, exclude force-excluded cards.
    base = (
        select(Card, AiGovernanceClassification)
        .join(AiGovernanceClassification, AiGovernanceClassification.card_id == Card.id)
        .where(
            Card.status != "ARCHIVED",
            or_(
                Card.attributes["aiClassificationOverride"].astext != "no",
                Card.attributes["aiClassificationOverride"].astext.is_(None),
            ),
        )
    )
    if risk_class:
        base = base.where(Card.attributes["aiRiskClass"].astext == risk_class)
    if lifecycle_stage:
        base = base.where(Card.attributes["aiLifecycleStage"].astext == lifecycle_stage)
    if method == "subtype":
        base = base.where(AiGovernanceClassification.subtype_match.is_(True))
    elif method == "semantic":
        base = base.where(
            AiGovernanceClassification.subtype_match.is_(False),
            or_(
                Card.attributes["aiClassificationOverride"].astext != "yes",
                Card.attributes["aiClassificationOverride"].astext.is_(None),
            ),
        )
    elif method == "override":
        base = base.where(Card.attributes["aiClassificationOverride"].astext == "yes")

    # Total count (no LIMIT/OFFSET).
    total_q = select(func.count()).select_from(base.subquery())
    total = int((await db.execute(total_q)).scalar_one())

    # Paginated rows, ordered by card name for stable display.
    rows = (
        await db.execute(base.order_by(Card.name).offset((page - 1) * page_size).limit(page_size))
    ).all()

    card_ids = [str(card.id) for card, _ in rows]
    stakeholder_counts = await _stakeholder_counts(db, card_ids)

    items: list[AiInventoryItem] = []
    for card, classification in rows:
        attrs = card.attributes or {}
        detection = AiInventoryDetection(
            method=_detection_method(attrs, classification.subtype_match),
            role=classification.detected_role
            if classification.detected_role in {"provider", "consumer", "embedded"}
            else "embedded",
            confidence=float(classification.confidence),
            subtype_match=classification.subtype_match,
            signal=classification.signal or "",
            detected_at=classification.detected_at,
        )
        items.append(
            AiInventoryItem(
                card_id=str(card.id),
                card_name=card.name,
                card_type=card.type,
                card_subtype=card.subtype,
                detection=detection,
                ai_risk_class=attrs.get("aiRiskClass"),
                ai_system_role=attrs.get("aiSystemRole"),
                ai_lifecycle_stage=attrs.get("aiLifecycleStage"),
                ai_intended_purpose=attrs.get("aiIntendedPurpose"),
                ai_classification_override=attrs.get("aiClassificationOverride"),
                owner_count=stakeholder_counts.get(str(card.id), 0),
            )
        )

    return AiInventoryPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/ai-inventory/kpis", response_model=AiInventoryKpis)
async def get_ai_inventory_kpis(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission("grc.view")),
) -> AiInventoryKpis:
    """Aggregate KPIs for the AI inventory header tiles."""
    rows = (
        await db.execute(
            select(Card.attributes, AiGovernanceClassification.detected_at)
            .join(AiGovernanceClassification, AiGovernanceClassification.card_id == Card.id)
            .where(
                Card.status != "ARCHIVED",
                or_(
                    Card.attributes["aiClassificationOverride"].astext != "no",
                    Card.attributes["aiClassificationOverride"].astext.is_(None),
                ),
            )
        )
    ).all()

    by_risk_class: dict[str, int] = {}
    by_lifecycle: dict[str, int] = {}
    total = 0
    with_risk_class = 0
    pending_review = 0
    high_or_unacceptable = 0
    card_ids: list[str] = []

    for attrs, _detected_at in rows:
        attrs = attrs or {}
        total += 1
        rc = attrs.get("aiRiskClass")
        if rc:
            with_risk_class += 1
            by_risk_class[rc] = by_risk_class.get(rc, 0) + 1
            if rc in _HIGH_AI_RISK_CLASSES:
                high_or_unacceptable += 1
        ls = attrs.get("aiLifecycleStage")
        if ls:
            by_lifecycle[ls] = by_lifecycle.get(ls, 0) + 1
        # «Pending review» = AI card missing either a risk classification
        # OR a documented intended purpose. Both are required to close the
        # EU AI Act Annex IV / ISO 42001 6.1.4 impact-assessment story.
        if not rc or not (attrs.get("aiIntendedPurpose") or "").strip():
            pending_review += 1

    # Unowned: of the total AI cards, how many have zero stakeholders.
    classified_card_ids_rows = (await db.execute(select(AiGovernanceClassification.card_id))).all()
    card_ids = [str(r[0]) for r in classified_card_ids_rows]
    sc = await _stakeholder_counts(db, card_ids)
    unowned = sum(1 for cid in card_ids if sc.get(cid, 0) == 0)

    unclassified = total - with_risk_class

    # "Last scanned" reflects the source of truth — detection happens during a
    # compliance scan, not on the inventory page. Pull the most recent finished
    # compliance scan that included EU AI Act in its scope.
    last_scanned_row = (
        await db.execute(
            select(func.max(TurboLensAnalysisRun.completed_at)).where(
                TurboLensAnalysisRun.analysis_type == "security_compliance",
                TurboLensAnalysisRun.status == "completed",
                TurboLensAnalysisRun.results["regulations"].astext.like('%"eu_ai_act"%'),
            )
        )
    ).scalar()

    return AiInventoryKpis(
        total=total,
        with_risk_class=with_risk_class,
        unclassified=unclassified,
        pending_review=pending_review,
        high_or_unacceptable=high_or_unacceptable,
        unowned=unowned,
        by_risk_class=by_risk_class,
        by_lifecycle=by_lifecycle,
        last_discovered_at=last_scanned_row,
    )


# ---------------------------------------------------------------------------
# Detection — driven exclusively by the Compliance Scanner
# ---------------------------------------------------------------------------
# Detection used to live here (POST /grc/ai-inventory/discover). It was
# removed in favour of `run_compliance_scan` being the sole detector
# entrypoint — the AI Inventory is a registry that reads, not a detection
# pipeline (#536). The persistence helper now lives in
# `turbolens_security.persist_ai_governance` so both the scanner and the
# manual «Classify as AI» action share one write path.


# ---------------------------------------------------------------------------
# Cross-link: Risk Register entries touching AI-bearing cards
# ---------------------------------------------------------------------------


@router.get("/ai-risks", response_model=list[AiLinkedRisk])
async def list_ai_linked_risks(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission("grc.view")),
    open_only: bool = Query(True, description="Filter to risks that are not yet closed."),
    limit: int = Query(10, ge=1, le=50),
) -> list[AiLinkedRisk]:
    """Risk Register entries whose linked cards include at least one AI system.

    Powers the *Risks on AI systems* cross-link panel on the AI Inventory page.
    Default is open risks, capped to 10 — the panel is a teaser into the
    proper Risk Register tab, not a full risk register.
    """
    ai_card_ids = (
        select(AiGovernanceClassification.card_id)
        .join(Card, Card.id == AiGovernanceClassification.card_id)
        .where(Card.status != "ARCHIVED")
    )
    stmt = (
        select(Risk)
        .join(RiskCard, RiskCard.risk_id == Risk.id)
        .where(RiskCard.card_id.in_(ai_card_ids))
        .distinct()
        .order_by(Risk.updated_at.desc())
        .limit(limit)
    )
    if open_only:
        stmt = stmt.where(Risk.status.in_(_OPEN_RISK_STATUSES))

    risks = list((await db.execute(stmt)).scalars().all())
    if not risks:
        return []

    # Resolve the AI cards touched by these risks (only the AI ones — not the
    # full set of linked cards — so the panel surfaces the AI angle clearly).
    risk_ids = [r.id for r in risks]
    rc_rows = (
        await db.execute(
            select(RiskCard.risk_id, Card.id, Card.name)
            .join(Card, Card.id == RiskCard.card_id)
            .where(RiskCard.risk_id.in_(risk_ids), RiskCard.card_id.in_(ai_card_ids))
        )
    ).all()
    by_risk: dict[str, list[tuple[str, str]]] = {}
    for risk_id, card_id, card_name in rc_rows:
        by_risk.setdefault(str(risk_id), []).append((str(card_id), card_name))

    return [
        AiLinkedRisk(
            id=str(r.id),
            reference=r.reference,
            title=r.title,
            status=r.status,
            initial_level=r.initial_level,
            residual_level=r.residual_level,
            affected_card_ids=[c[0] for c in by_risk.get(str(r.id), [])],
            affected_card_names=[c[1] for c in by_risk.get(str(r.id), [])],
        )
        for r in risks
    ]


# ---------------------------------------------------------------------------
# Manual «Classify as AI» — set aiClassificationOverride="yes" on a card
# ---------------------------------------------------------------------------


@router.post("/ai-inventory/classify/{card_id}", status_code=204)
async def classify_card_as_ai(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission("grc.manage")),
) -> None:
    """Force-add a card to the AI inventory without waiting for the next
    compliance scan.

    Sets ``aiClassificationOverride="yes"`` on the card and routes the upsert
    through the same persistence helper the Compliance Scanner uses, so the
    cache table reflects the change immediately. Useful for shadow-AI
    systems the semantic detector won't catch (e.g. a custom fine-tuned
    model hidden behind a generic «Service» card).
    """
    import uuid as uuid_mod

    from fastapi import HTTPException

    try:
        card_uuid = uuid_mod.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid card id") from exc

    card = (await db.execute(select(Card).where(Card.id == card_uuid))).scalar_one_or_none()
    if card is None:
        raise HTTPException(404, "Card not found")

    if card.type not in _AI_TARGET_TYPES:
        raise HTTPException(
            400,
            f"AI Inventory only tracks {', '.join(_AI_TARGET_TYPES)} cards.",
        )

    # Flip the override flag on the card; the shared persistence helper then
    # honours it (turbolens_security.persist_ai_governance: override="yes"
    # branch). No need for a separate write path here.
    attrs = dict(card.attributes or {})
    attrs["aiClassificationOverride"] = "yes"
    card.attributes = attrs
    await db.flush()

    await persist_ai_governance(db, {})
    await db.commit()
