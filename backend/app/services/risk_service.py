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
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.risk import Risk, RiskCard
from app.models.todo import Todo
from app.models.turbolens import TurboLensComplianceFinding
from app.services import notification_service
from app.services.event_bus import event_bus

logger = logging.getLogger("turboea.risk_service")

#: ``risks.source_type`` values. ``manual`` is a person in the register,
#: ``compliance`` a promoted scanner finding, ``extension`` a row filed by an
#: installed extension through the SDK risks bridge (whose ``source_ref`` is
#: prefixed with the extension key so two extensions can never collide).
SOURCE_VALUES = ("manual", "compliance", "extension")

PROBABILITY_VALUES = ("very_high", "high", "medium", "low")
IMPACT_VALUES = ("critical", "high", "medium", "low")
LEVEL_VALUES = ("critical", "high", "medium", "low")

CATEGORY_VALUES = (
    "security",
    "compliance",
    "operational",
    "technology",
    "financial",
    "reputational",
    "strategic",
)

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


def risk_link(risk: Risk) -> str:
    """The in-app deep link of a risk — also the identity of its owner Todo."""
    return f"/ea-delivery/risks/{risk.id}"


def risk_summary(risk: Risk) -> str:
    level = (risk.residual_level or risk.initial_level or "").lower()
    parts = [risk.reference]
    if level:
        parts.append(level.capitalize())
    parts.append(risk.title or "")
    return " · ".join(p for p in parts if p)


async def linked_card_ids(db: AsyncSession, risk_id: uuid.UUID) -> list[uuid.UUID]:
    res = await db.execute(select(RiskCard.card_id).where(RiskCard.risk_id == risk_id))
    return [cid for (cid,) in res.all()]


async def publish_risk_event(
    db: AsyncSession,
    risk: Risk,
    event_type: str,
    card_ids: list[uuid.UUID],
    *,
    actor_id: uuid.UUID | None,
    extra: dict | None = None,
) -> None:
    """Fan-out a risk-related event to every affected card so the
    register changes show up in the per-card history timeline. ``actor_id``
    is ``None`` for a write nobody performed in person (an extension)."""
    if not card_ids:
        return
    payload: dict = {
        "risk_id": str(risk.id),
        "reference": risk.reference,
        "title": risk.title,
        "level": risk.residual_level or risk.initial_level,
        "status": risk.status,
        "category": risk.category,
        "link": risk_link(risk),
        "summary": risk_summary(risk),
    }
    if extra:
        payload.update(extra)
    for cid in card_ids:
        await event_bus.publish(
            event_type,
            payload,
            db=db,
            card_id=cid,
            user_id=actor_id,
        )


async def sync_owner_todo(
    db: AsyncSession,
    risk: Risk,
    *,
    actor_id: uuid.UUID | None,
    previous_owner: uuid.UUID | None,
) -> None:
    """Mirror the PPM task pattern: keep a single ``is_system`` Todo on
    the current owner and fire a notification when the owner changes.

    * Owner assigned (new or changed) → create/update a Todo + notify.
    * Owner cleared → delete the existing system Todo. No notification.
    * Idempotent: the Todo's ``link`` doubles as its identity.

    ``actor_id`` may be ``None`` (an extension assigned the owner): the Todo
    then has no creator and the notification no actor, which is exactly the
    truth — nobody did it in person.
    """
    link = risk_link(risk)
    existing_res = await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True)))
    existing = existing_res.scalar_one_or_none()

    if risk.owner_id is None:
        if existing is not None:
            await db.delete(existing)
        return

    description = f"[Risk {risk.reference}] {risk.title}"
    if existing is not None:
        existing.assigned_to = risk.owner_id
        existing.description = description
        existing.due_date = risk.target_resolution_date
        # Keep status linked to risk lifecycle so closed risks don't
        # leave zombie todos on the owner's list.
        existing.status = (
            "done" if risk.status in ("mitigated", "monitoring", "accepted", "closed") else "open"
        )
    else:
        db.add(
            Todo(
                id=uuid.uuid4(),
                card_id=None,
                description=description,
                status="open",
                link=link,
                is_system=True,
                assigned_to=risk.owner_id,
                created_by=actor_id,
                due_date=risk.target_resolution_date,
            )
        )

    # Notification — fires whenever the owner actually changes, including
    # self-assignment, so the bell mirrors the expectation set by other
    # assignment flows. notification_service whitelists "risk_assigned"
    # for the self-notify case.
    if risk.owner_id != previous_owner:
        try:
            await notification_service.create_notification(
                db,
                user_id=risk.owner_id,
                notif_type="risk_assigned",
                title=f"Risk {risk.reference} assigned to you",
                message=risk.title[:200],
                link=link,
                data={
                    "risk_id": str(risk.id),
                    "reference": risk.reference,
                    "level": risk.residual_level or risk.initial_level,
                },
                actor_id=actor_id,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Risk-assignment notification failed")


async def create_risk(
    db: AsyncSession,
    *,
    title: str,
    description: str = "",
    category: str = "operational",
    initial_probability: str = "medium",
    initial_impact: str = "medium",
    owner_id: uuid.UUID | None = None,
    target_resolution_date: date | None = None,
    card_ids: list[uuid.UUID] | None = None,
    source_type: str = "manual",
    source_ref: str | None = None,
    actor_id: uuid.UUID | None,
    event_extra: dict | None = None,
) -> Risk:
    """The one writer behind ``POST /risks`` and the SDK risks bridge.

    Allocates the reference, derives the initial level, links the cards,
    keeps the owner's system Todo + ``risk_assigned`` notification in step,
    and fans the ``risk.added`` event out to every linked card. Flushes,
    never commits — the caller owns the transaction. ``actor_id`` is the
    person performing the write, or ``None`` for an extension (then
    ``created_by`` stays NULL and the events carry no user).
    """
    risk = Risk(
        id=uuid.uuid4(),
        reference=await next_reference(db),
        title=title,
        description=description or "",
        category=category,
        source_type=source_type,
        source_ref=source_ref,
        initial_probability=initial_probability,
        initial_impact=initial_impact,
        initial_level=derive_level(initial_probability, initial_impact) or "medium",
        owner_id=owner_id,
        target_resolution_date=target_resolution_date,
        status="identified",
        created_by=actor_id,
    )
    db.add(risk)
    await db.flush()

    if card_ids:
        await link_cards(db, risk.id, list(card_ids))

    await sync_owner_todo(db, risk, actor_id=actor_id, previous_owner=None)

    linked = await linked_card_ids(db, risk.id)
    # ``created`` tells the rollback engine this batch raised the risk (its
    # inverse is deleting it), as opposed to a later ``risk.added`` that only
    # linked an existing risk to one more card (its inverse is the unlink).
    await publish_risk_event(
        db,
        risk,
        "risk.added",
        linked,
        actor_id=actor_id,
        extra={**(event_extra or {}), "created": True},
    )
    return risk


# Scalar columns whose edits are recorded as old/new pairs on ``risk.updated``
# so a batch that changed them can be rolled back field by field.
RISK_TRACKED_FIELDS: tuple[str, ...] = (
    "title",
    "description",
    "category",
    "initial_probability",
    "initial_impact",
    "residual_probability",
    "residual_impact",
    "owner_id",
    "target_resolution_date",
    "status",
    "acceptance_rationale",
    "accepted_by",
    "accepted_at",
)


def _json_value(value: Any) -> Any:
    if isinstance(value, (uuid.UUID, datetime, date)):
        return value.isoformat() if not isinstance(value, uuid.UUID) else str(value)
    return value


def risk_snapshot(risk: Risk) -> dict[str, Any]:
    """The tracked fields of a risk as JSON-ready values — take it before
    an edit, hand it to :func:`risk_changes` after."""
    return {k: _json_value(getattr(risk, k)) for k in RISK_TRACKED_FIELDS}


def risk_changes(before: dict[str, Any], risk: Risk) -> dict[str, dict[str, Any]]:
    """``{field: {"old", "new"}}`` for every tracked field that moved —
    the same shape ``card.updated`` carries, which is what the rollback
    engine and the History tab both read."""
    after = risk_snapshot(risk)
    return {
        k: {"old": before[k], "new": after[k]} for k in RISK_TRACKED_FIELDS if before[k] != after[k]
    }


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


async def promote_compliance_finding(
    db: AsyncSession,
    finding_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    overrides: dict[str, Any] | None = None,
) -> Risk:
    """Create a Risk from a compliance finding, or return the already-promoted one.

    Seeds:
    * category = ``compliance``
    * source_type = ``compliance`` / source_ref = regulation key
    * title = ``"<article>: <card or 'landscape'>"``
    * description = requirement + gap description
    * links the finding's affected card (if any)
    * writes ``risk_id`` back on the finding so the UI can route to it

    When the finding carries a ``remediation`` string, it is spawned as a
    one-shot mitigation task on the new risk (description = remediation,
    title = "Remediate: <article>") so the guidance becomes actionable
    work owned by the risk owner rather than inert text.
    """
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
        source_type="compliance",
        source_ref=finding.regulation,
        initial_probability=probability,
        initial_impact=impact,
        initial_level=derive_level(probability, impact) or "medium",
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
    finding.decision = "risk_tracked"
    finding.reviewed_by = user_id
    finding.reviewed_at = datetime.now(timezone.utc)
    await db.flush()

    # Seed a one-shot mitigation task from the finding's remediation
    # guidance, if present. Imported lazily to avoid a circular import
    # between risk_service and risk_mitigation_task_service.
    remediation = (finding.remediation or "").strip()
    if remediation and user_id is not None:
        from app.services.risk_mitigation_task_service import (
            create_task_with_first_occurrence,
        )

        task_title = (
            f"Remediate: {article}" if article else f"Remediate {finding.regulation.upper()}"
        )
        await create_task_with_first_occurrence(
            db,
            risk=risk,
            title=task_title[:500],
            description=remediation,
            owner_id=overrides.get("owner_id"),
            due_date=overrides.get("target_resolution_date"),
            recurrence_unit="none",
            recurrence_interval=1,
            actor_id=user_id,
        )

    return risk


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
        # Coerce values outside the current vocabulary (e.g. the retired
        # pre-release 'ppm' source) to 'manual' instead of letting one
        # legacy row fail response validation and 500 the entire list.
        # Migration 127 rewrites such rows; this guards anything it missed.
        "source_type": risk.source_type
        if risk.source_type in ("manual", "compliance")
        else "manual",
        "source_ref": risk.source_ref,
        "initial_probability": risk.initial_probability,
        "initial_impact": risk.initial_impact,
        "initial_level": risk.initial_level,
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
