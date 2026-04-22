"""Risk register service — derived level, reference generator, promotion.

Pure helpers + small DB coordinators used by ``app/api/v1/risks.py``
(and indirectly by the promote-from-finding endpoints inside the same
router).

The :func:`derive_level` table encodes TOGAF Phase G's initial / residual
risk level derivation from a probability × impact pair. It is computed
server-side on every write so the API layer can treat ``initial_level``
and ``residual_level`` as read-only fields.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.risk import Risk, RiskCard
from app.models.turbolens import TurboLensComplianceFinding, TurboLensCveFinding

logger = logging.getLogger("turboea.risk_service")

PROBABILITY_VALUES = ("very_high", "high", "medium", "low")
IMPACT_VALUES = ("critical", "high", "medium", "low")
LEVEL_VALUES = ("critical", "high", "medium", "low")

STATUS_VALUES = (
    "identified",
    "analysed",
    "mitigation_planned",
    "in_progress",
    "mitigated",
    "monitoring",
    "accepted",
    "closed",
)

# 4x4 level matrix: rows = probability (very_high..low), cols = impact (critical..low).
# Mirrors the grid documented in the plan: combined severity and likelihood
# weighted so that even high-probability/low-impact stays medium.
_LEVEL_MATRIX: dict[str, dict[str, str]] = {
    "very_high": {"critical": "critical", "high": "critical", "medium": "high", "low": "medium"},
    "high": {"critical": "critical", "high": "high", "medium": "high", "low": "medium"},
    "medium": {"critical": "high", "high": "high", "medium": "medium", "low": "low"},
    "low": {"critical": "medium", "high": "medium", "medium": "low", "low": "low"},
}


def derive_level(probability: str | None, impact: str | None) -> str | None:
    """Compute derived risk level from probability × impact. Returns None
    if either input is missing or unknown.
    """
    if not probability or not impact:
        return None
    return _LEVEL_MATRIX.get(probability, {}).get(impact)


# ---------------------------------------------------------------------------
# Reference generator
# ---------------------------------------------------------------------------


_REFERENCE_RE = re.compile(r"^R-(\d+)$")


async def next_reference(db: AsyncSession) -> str:
    """Return the next monotonic ``R-NNNNNN`` reference.

    Reads the max existing reference and adds one. This is race-safe in
    practice because the unique constraint on ``reference`` rejects
    duplicates — on the rare conflict the caller can retry.
    """
    result = await db.execute(select(Risk.reference))
    highest = 0
    for (ref,) in result.all():
        match = _REFERENCE_RE.match(ref or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"R-{highest + 1:06d}"


# ---------------------------------------------------------------------------
# Status workflow
# ---------------------------------------------------------------------------


_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "identified": {"analysed", "accepted"},
    "analysed": {"mitigation_planned", "accepted"},
    "mitigation_planned": {"in_progress", "accepted"},
    "in_progress": {"mitigated", "accepted"},
    "mitigated": {"monitoring", "closed", "in_progress"},
    "monitoring": {"closed", "in_progress", "accepted"},
    "accepted": {"in_progress", "closed"},
    "closed": {"in_progress"},
}


def validate_status_transition(current: str, new: str) -> None:
    """Raise :class:`ValueError` if ``new`` is not reachable from ``current``."""
    if current == new:
        return
    allowed = _ALLOWED_TRANSITIONS.get(current, set())
    if new not in allowed:
        raise ValueError(
            f"Illegal status transition: {current} → {new}. Allowed: {sorted(allowed) or '(none)'}"
        )


# ---------------------------------------------------------------------------
# Card linking
# ---------------------------------------------------------------------------


async def link_cards(
    db: AsyncSession,
    risk_id: uuid.UUID,
    card_ids: list[uuid.UUID],
    role: str = "affected",
) -> None:
    """Add missing (risk_id, card_id) junction rows. Idempotent.

    Silently skips card ids that don't match an existing card so a stale
    payload from the UI can't trigger a FK error. Existing links keep
    their role — this function never re-assigns role on a dup link.
    """
    if not card_ids:
        return
    existing_res = await db.execute(select(RiskCard.card_id).where(RiskCard.risk_id == risk_id))
    existing = {cid for (cid,) in existing_res.all()}

    valid_res = await db.execute(select(Card.id).where(Card.id.in_(card_ids)))
    valid = {cid for (cid,) in valid_res.all()}

    for cid in card_ids:
        if cid in existing or cid not in valid:
            continue
        db.add(RiskCard(risk_id=risk_id, card_id=cid, role=role))


# ---------------------------------------------------------------------------
# Promotion from TurboLens findings
# ---------------------------------------------------------------------------


_CVSS_TO_IMPACT: dict[str, str] = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
}


_COMPLIANCE_SEVERITY_TO_IMPACT: dict[str, str] = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
    "info": "low",
}


def _safe_probability(value: str | None) -> str:
    return value if value in PROBABILITY_VALUES else "medium"


def _safe_impact(value: str | None) -> str:
    return value if value in IMPACT_VALUES else "medium"


async def promote_cve_finding(
    db: AsyncSession,
    finding_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    overrides: dict[str, Any] | None = None,
) -> Risk:
    """Create a Risk from a CVE finding, or return the already-promoted one.

    Seeds:
    * category = ``security``
    * source_type = ``security_cve`` / source_ref = CVE id
    * title = ``"<cve_id> on <card_name or product>"``
    * description = finding description + business impact
    * mitigation = finding remediation
    * initial_probability/impact = finding.probability / CVSS severity
    * links the finding's affected card
    * writes ``risk_id`` back on the finding so the UI can route to it
    """
    finding = await db.get(TurboLensCveFinding, finding_id)
    if finding is None:
        raise LookupError("Finding not found")

    if finding.risk_id is not None:
        existing = await db.get(Risk, finding.risk_id)
        if existing is not None:
            return existing

    card = await db.get(Card, finding.card_id)
    card_label = card.name if card else finding.product or str(finding.card_id)

    overrides = overrides or {}
    probability = _safe_probability(overrides.get("initial_probability") or finding.probability)
    impact = _safe_impact(
        overrides.get("initial_impact") or _CVSS_TO_IMPACT.get(finding.severity, "medium")
    )
    title = overrides.get("title") or f"{finding.cve_id} on {card_label}"
    description = overrides.get("description") or _compose_cve_description(finding)

    risk = Risk(
        id=uuid.uuid4(),
        reference=await next_reference(db),
        title=title[:500],
        description=description,
        category=overrides.get("category", "security"),
        source_type="security_cve",
        source_ref=finding.cve_id,
        initial_probability=probability,
        initial_impact=impact,
        initial_level=derive_level(probability, impact) or "medium",
        mitigation=overrides.get("mitigation") or finding.remediation,
        owner_id=overrides.get("owner_id"),
        target_resolution_date=overrides.get("target_resolution_date"),
        status="identified",
        created_by=user_id,
    )
    db.add(risk)
    await db.flush()
    if finding.card_id:
        await link_cards(db, risk.id, [finding.card_id])
    finding.risk_id = risk.id
    await db.flush()
    return risk


async def promote_compliance_finding(
    db: AsyncSession,
    finding_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    overrides: dict[str, Any] | None = None,
) -> Risk:
    """Create a Risk from a compliance finding (see :func:`promote_cve_finding`)."""
    finding = await db.get(TurboLensComplianceFinding, finding_id)
    if finding is None:
        raise LookupError("Finding not found")

    if finding.risk_id is not None:
        existing = await db.get(Risk, finding.risk_id)
        if existing is not None:
            return existing

    overrides = overrides or {}
    # Compliance findings don't carry a probability in the same
    # vocabulary — default to medium, escalated for non_compliant.
    default_probability = "high" if finding.status == "non_compliant" else "medium"
    probability = _safe_probability(overrides.get("initial_probability") or default_probability)
    impact = _safe_impact(
        overrides.get("initial_impact")
        or _COMPLIANCE_SEVERITY_TO_IMPACT.get(finding.severity, "medium")
    )

    card_label = None
    if finding.card_id:
        card = await db.get(Card, finding.card_id)
        card_label = card.name if card else None

    article = (finding.regulation_article or "").strip()
    where = card_label or "landscape"
    title_base = f"{article}: {where}" if article else f"{finding.regulation.upper()}: {where}"
    title = overrides.get("title") or title_base

    description_parts = [finding.requirement or "", finding.gap_description or ""]
    description = overrides.get("description") or "\n\n".join(p for p in description_parts if p)

    risk = Risk(
        id=uuid.uuid4(),
        reference=await next_reference(db),
        title=title[:500],
        description=description,
        category=overrides.get("category", "compliance"),
        source_type="security_compliance",
        source_ref=finding.regulation,
        initial_probability=probability,
        initial_impact=impact,
        initial_level=derive_level(probability, impact) or "medium",
        mitigation=overrides.get("mitigation") or finding.remediation,
        owner_id=overrides.get("owner_id"),
        target_resolution_date=overrides.get("target_resolution_date"),
        status="identified",
        created_by=user_id,
    )
    db.add(risk)
    await db.flush()
    if finding.card_id:
        await link_cards(db, risk.id, [finding.card_id])
    finding.risk_id = risk.id
    await db.flush()
    return risk


def _compose_cve_description(finding: TurboLensCveFinding) -> str:
    blocks: list[str] = []
    if finding.description:
        blocks.append(finding.description)
    if finding.business_impact:
        blocks.append(f"Business impact: {finding.business_impact}")
    if finding.cvss_score is not None:
        blocks.append(
            f"CVSS {finding.cvss_score:.1f} ({finding.severity}), "
            f"attack vector: {finding.attack_vector or 'unknown'}."
        )
    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# Serialisation helpers used by the API layer
# ---------------------------------------------------------------------------


async def risk_to_dict(db: AsyncSession, risk: Risk) -> dict[str, Any]:
    """Flatten a Risk + joined card summaries + owner display name."""
    # Load linked cards (id + name + type + role).
    card_rows = await db.execute(
        select(RiskCard.card_id, RiskCard.role, Card.name, Card.type)
        .join(Card, Card.id == RiskCard.card_id)
        .where(RiskCard.risk_id == risk.id)
    )
    cards = [
        {
            "card_id": str(cid),
            "card_name": name,
            "card_type": ctype,
            "role": role,
        }
        for cid, role, name, ctype in card_rows.all()
    ]

    owner_name = None
    if risk.owner_id:
        # Lazy import to avoid circulars.
        from app.models.user import User

        owner = await db.get(User, risk.owner_id)
        owner_name = owner.display_name if owner else None

    return {
        "id": str(risk.id),
        "reference": risk.reference,
        "title": risk.title,
        "description": risk.description,
        "category": risk.category,
        "source_type": risk.source_type,
        "source_ref": risk.source_ref,
        "initial_probability": risk.initial_probability,
        "initial_impact": risk.initial_impact,
        "initial_level": risk.initial_level,
        "mitigation": risk.mitigation,
        "residual_probability": risk.residual_probability,
        "residual_impact": risk.residual_impact,
        "residual_level": risk.residual_level,
        "owner_id": str(risk.owner_id) if risk.owner_id else None,
        "owner_name": owner_name,
        "target_resolution_date": (
            risk.target_resolution_date.isoformat() if risk.target_resolution_date else None
        ),
        "status": risk.status,
        "acceptance_rationale": risk.acceptance_rationale,
        "accepted_by": str(risk.accepted_by) if risk.accepted_by else None,
        "accepted_at": risk.accepted_at.isoformat() if risk.accepted_at else None,
        "created_by": str(risk.created_by) if risk.created_by else None,
        "created_at": risk.created_at.isoformat() if risk.created_at else None,
        "updated_at": risk.updated_at.isoformat() if risk.updated_at else None,
        "cards": cards,
    }


def build_level_matrix(risks: list[Risk], *, residual: bool = False) -> list[list[int]]:
    """Return a 4×4 counts matrix indexed by probability (rows) × impact (cols)."""
    prob_idx = {p: i for i, p in enumerate(PROBABILITY_VALUES)}
    imp_idx = {i: j for j, i in enumerate(IMPACT_VALUES)}
    matrix = [[0] * 4 for _ in range(4)]
    for r in risks:
        p = r.residual_probability if residual else r.initial_probability
        i = r.residual_impact if residual else r.initial_impact
        if p is None or i is None:
            continue
        pi = prob_idx.get(p)
        ii = imp_idx.get(i)
        if pi is None or ii is None:
            continue
        matrix[pi][ii] += 1
    return matrix


def compute_metrics(risks: list[Risk]) -> dict[str, Any]:
    """KPI payload for the register page header."""
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    today = now.date()

    by_status: dict[str, int] = {s: 0 for s in STATUS_VALUES}
    by_level: dict[str, int] = {lvl: 0 for lvl in LEVEL_VALUES}
    by_category: dict[str, int] = {}
    overdue = 0
    created_this_month = 0

    for r in risks:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        level = r.residual_level or r.initial_level
        if level in by_level:
            by_level[level] += 1
        by_category[r.category] = by_category.get(r.category, 0) + 1
        if (
            r.target_resolution_date
            and r.target_resolution_date < today
            and r.status not in ("closed", "accepted", "mitigated")
        ):
            overdue += 1
        if r.created_at and r.created_at >= month_start:
            created_this_month += 1

    return {
        "total": len(risks),
        "by_status": by_status,
        "by_level": by_level,
        "by_category": by_category,
        "overdue": overdue,
        "created_this_month": created_this_month,
        "initial_matrix": build_level_matrix(risks, residual=False),
        "residual_matrix": build_level_matrix(risks, residual=True),
    }


# Legacy callers may have expected a simple risk counter — kept minimal.
async def risk_count(db: AsyncSession) -> int:
    result = await db.execute(select(func.count(Risk.id)))
    return int(result.scalar() or 0)
