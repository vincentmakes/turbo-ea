"""GRC API — Governance KPIs, AI Inventory dashboard, semantic discovery.

The Governance and Compliance subtabs of ``/grc`` also live behind their own
existing permission groups (``risks.*``, ``security_compliance.*``,
``adr.*``); this router only owns the AI Governance surface and a small
cross-tab overview. It reuses the semantic AI detector from
``turbolens_security.detect_ai_bearing_cards`` so we never duplicate the
LLM prompt or signal heuristics.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.ai_governance import AiGovernanceClassification
from app.models.card import Card
from app.models.risk import Risk
from app.models.stakeholder import Stakeholder
from app.schemas.grc import (
    AiInventoryDetection,
    AiInventoryItem,
    AiInventoryKpis,
    AiInventoryPage,
    DiscoverResponse,
    GrcOverview,
)
from app.services.turbolens_ai import get_ai_config, is_ai_configured
from app.services.turbolens_security import (
    AI_SUBTYPES,
    ScanCard,
    detect_ai_bearing_cards,
)

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


def _card_to_scan_card(card: Card) -> ScanCard:
    """Project a Card into a ScanCard suitable for ``detect_ai_bearing_cards``."""
    attrs = card.attributes or {}
    vendor = (attrs.get("vendor") or "").strip()
    product = (attrs.get("productName") or attrs.get("product") or card.name or "").strip()
    return ScanCard(
        id=str(card.id),
        name=card.name,
        type=card.type,
        subtype=card.subtype,
        description=(card.description or "")[:500],
        vendor=vendor,
        product=product,
        version=(attrs.get("version") or "").strip() or None,
        business_criticality=attrs.get("businessCriticality"),
        lifecycle_phase=None,
        attributes=attrs,
    )


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
    high_or_unacceptable = 0
    last_detected: datetime | None = None
    card_ids: list[str] = []

    for attrs, detected_at in rows:
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
        if detected_at and (last_detected is None or detected_at > last_detected):
            last_detected = detected_at

    # Unowned: of the total AI cards, how many have zero stakeholders.
    classified_card_ids_rows = (await db.execute(select(AiGovernanceClassification.card_id))).all()
    card_ids = [str(r[0]) for r in classified_card_ids_rows]
    sc = await _stakeholder_counts(db, card_ids)
    unowned = sum(1 for cid in card_ids if sc.get(cid, 0) == 0)

    unclassified = total - with_risk_class

    return AiInventoryKpis(
        total=total,
        with_risk_class=with_risk_class,
        unclassified=unclassified,
        high_or_unacceptable=high_or_unacceptable,
        unowned=unowned,
        by_risk_class=by_risk_class,
        by_lifecycle=by_lifecycle,
        last_discovered_at=last_detected,
    )


# ---------------------------------------------------------------------------
# Discovery — populate the classification cache
# ---------------------------------------------------------------------------


@router.post("/ai-inventory/discover", response_model=DiscoverResponse)
async def discover_ai_inventory(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_permission("grc.manage")),
) -> DiscoverResponse:
    """Refresh the AI Governance classification cache.

    Walks Application / ITComponent / Interface cards and flags AI-bearing
    ones using the shared semantic detector. Synchronous: the LLM pass is
    skipped when no AI provider is configured, so this is fast on most
    installs. Force-included (override=yes) cards are also recorded.
    """
    result = await db.execute(
        select(Card).where(
            Card.type.in_(_AI_TARGET_TYPES),
            Card.status != "ARCHIVED",
        )
    )
    cards = list(result.scalars().all())

    # Build ScanCard projections for the detector.
    scan_cards = [_card_to_scan_card(c) for c in cards]
    ai_config = await get_ai_config(db)
    has_provider = is_ai_configured(ai_config)
    detected = await detect_ai_bearing_cards(db, scan_cards)

    # Existing classifications keyed by card id for upsert.
    existing_rows = (await db.execute(select(AiGovernanceClassification))).scalars().all()
    existing = {str(c.card_id): c for c in existing_rows}

    now = datetime.now(timezone.utc)
    by_method = {"subtype": 0, "semantic": 0, "override": 0}
    seen_card_ids: set[str] = set()

    for card in cards:
        cid = str(card.id)
        attrs = card.attributes or {}
        override = attrs.get("aiClassificationOverride")
        det = detected.get(cid)

        if override == "no":
            # Force-exclude: remove from cache, count nothing.
            if cid in existing:
                await db.delete(existing[cid])
            continue

        if override == "yes":
            method = "override"
            role = attrs.get("aiSystemRole") or "embedded"
            confidence = 1.0
            subtype_match = card.subtype in AI_SUBTYPES
            signal = "Manual override (aiClassificationOverride=yes)"
        elif det is not None:
            subtype_match = bool(det.get("subtype_match"))
            method = "subtype" if subtype_match else "semantic"
            role = det.get("role", "embedded")
            confidence = float(det.get("confidence", 0.6) or 0.6)
            signal = det.get("signal", "") or ""
        else:
            continue  # neither override nor detected

        seen_card_ids.add(cid)
        by_method[method] = by_method.get(method, 0) + 1

        if cid in existing:
            row = existing[cid]
            row.detected_role = role
            row.confidence = confidence
            row.subtype_match = subtype_match
            row.signal = signal
            row.detected_at = now
        else:
            db.add(
                AiGovernanceClassification(
                    card_id=card.id,
                    detected_role=role,
                    confidence=confidence,
                    subtype_match=subtype_match,
                    signal=signal,
                    detected_at=now,
                )
            )

    # Stale rows — classifications for cards that no longer qualify.
    for cid, row in existing.items():
        if cid not in seen_card_ids:
            await db.delete(row)

    await db.commit()

    return DiscoverResponse(
        classified=sum(by_method.values()),
        by_method=by_method,
        skipped_no_ai_provider=not has_provider,
    )
