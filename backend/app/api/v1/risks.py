"""Risk register API — CRUD + promote-from-finding + card-linking.

All routes live under ``/api/v1/risks`` except ``GET /cards/{id}/risks``
which is co-located on the cards namespace for intuitive discoverability.

TOGAF Phase G reference: ``status`` is the risk-register lifecycle;
``initial_*`` and ``residual_*`` pairs are the before/after assessment;
``acceptance_rationale`` is required to move to ``accepted``.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.risk import Risk, RiskCard
from app.models.todo import Todo
from app.models.user import User
from app.schemas.risk import (
    RiskCardLinkRequest,
    RiskCreate,
    RiskListPage,
    RiskMetricsOut,
    RiskOut,
    RiskPromoteRequest,
    RiskUpdate,
)
from app.services import notification_service
from app.services.permission_service import PermissionService
from app.services.risk_service import (
    STATUS_VALUES,
    compute_metrics,
    derive_level,
    link_cards,
    next_reference,
    promote_compliance_finding,
    promote_cve_finding,
    risk_to_dict,
    validate_status_transition,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risks", tags=["Risks"])

# Cards sub-route — mounted separately via the main router, see
# `cards_risks_router` at the bottom of this file.
cards_risks_router = APIRouter(prefix="/cards", tags=["Risks"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_risk(db: AsyncSession, risk_id: str) -> Risk:
    try:
        uid = uuid.UUID(risk_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid risk id") from exc
    risk = await db.get(Risk, uid)
    if risk is None:
        raise HTTPException(404, "Risk not found")
    return risk


def _parse_card_ids(raw: list[str]) -> list[uuid.UUID]:
    out: list[uuid.UUID] = []
    for cid in raw:
        try:
            out.append(uuid.UUID(cid))
        except ValueError:
            # Silently skip — the UI can send stale ids after a refresh.
            continue
    return out


def _risk_link(risk: Risk) -> str:
    return f"/ea-delivery/risks/{risk.id}"


async def sync_owner_todo(
    db: AsyncSession,
    risk: Risk,
    *,
    actor_id: uuid.UUID,
    previous_owner: uuid.UUID | None,
) -> None:
    """Mirror the PPM task pattern: keep a single ``is_system`` Todo on
    the current owner and fire a notification when the owner changes.

    * Owner assigned (new or changed) → create/update a Todo + notify.
    * Owner cleared → delete the existing system Todo. No notification.
    * Idempotent: the Todo's ``link`` doubles as its identity.
    """
    link = _risk_link(risk)
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


# ---------------------------------------------------------------------------
# List + metrics
# ---------------------------------------------------------------------------


_LEVEL_WEIGHT = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _level_weight(level: str | None) -> int:
    return _LEVEL_WEIGHT.get(level or "", 9)


async def _load_filtered_risks(
    db: AsyncSession,
    *,
    status: list[str] | None,
    category: list[str] | None,
    level: list[str] | None,
    owner_id: str | None,
    card_id: str | None,
    source_type: list[str] | None,
    search: str | None,
    overdue: bool,
) -> list[Risk]:
    """Shared filter pipeline used by both ``GET /risks`` and
    ``GET /risks/metrics`` so the KPI tiles + matrix always reflect
    whatever the user has filtered to.
    """
    stmt = select(Risk)
    if status:
        stmt = stmt.where(Risk.status.in_(status))
    if category:
        stmt = stmt.where(Risk.category.in_(category))
    if level:
        # A risk's current level is its residual_level when set, otherwise
        # initial_level. The multi-select OR expands across both.
        stmt = stmt.where(
            or_(
                Risk.residual_level.in_(level),
                (Risk.residual_level.is_(None)) & (Risk.initial_level.in_(level)),
            )
        )
    if owner_id:
        try:
            stmt = stmt.where(Risk.owner_id == uuid.UUID(owner_id))
        except ValueError as exc:
            raise HTTPException(400, "Invalid owner_id") from exc
    if source_type:
        stmt = stmt.where(Risk.source_type.in_(source_type))
    if search:
        needle = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                Risk.title.ilike(needle),
                Risk.description.ilike(needle),
                Risk.reference.ilike(needle),
            )
        )
    if card_id:
        try:
            cid = uuid.UUID(card_id)
        except ValueError as exc:
            raise HTTPException(400, "Invalid card_id") from exc
        stmt = stmt.where(Risk.id.in_(select(RiskCard.risk_id).where(RiskCard.card_id == cid)))

    rows = list((await db.execute(stmt)).scalars().all())

    if overdue:
        today = datetime.now(timezone.utc).date()
        rows = [
            r
            for r in rows
            if r.target_resolution_date
            and r.target_resolution_date < today
            and r.status not in ("closed", "accepted", "mitigated")
        ]
    return rows


@router.get("", response_model=RiskListPage)
async def list_risks(
    status: list[str] | None = Query(None),
    category: list[str] | None = Query(None),
    level: list[str] | None = Query(None),
    owner_id: str | None = None,
    card_id: str | None = None,
    source_type: list[str] | None = Query(None),
    search: str | None = None,
    overdue: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    sort_by: str = "updated_at",
    sort_dir: str = "desc",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskListPage:
    """Paginated, filterable risk list. ``status`` / ``category`` /
    ``level`` / ``source_type`` are repeatable query params (e.g.
    ``?status=identified&status=analysed``).
    """
    await PermissionService.require_permission(db, user, "risks.view")

    rows = await _load_filtered_risks(
        db,
        status=status,
        category=category,
        level=level,
        owner_id=owner_id,
        card_id=card_id,
        source_type=source_type,
        search=search,
        overdue=overdue,
    )

    # Sort server-side for consistent pagination.
    sort_key = {
        "updated_at": lambda r: r.updated_at or datetime.min.replace(tzinfo=timezone.utc),
        "target_resolution_date": lambda r: r.target_resolution_date or datetime.max.date(),
        "level": lambda r: _level_weight(r.residual_level or r.initial_level),
        "reference": lambda r: r.reference,
    }.get(sort_by, lambda r: r.updated_at or datetime.min.replace(tzinfo=timezone.utc))
    rows.sort(key=sort_key, reverse=(sort_dir == "desc"))

    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]
    items = [RiskOut.model_validate(await risk_to_dict(db, r)) for r in page_rows]
    return RiskListPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/metrics", response_model=RiskMetricsOut)
async def risk_metrics(
    status: list[str] | None = Query(None),
    category: list[str] | None = Query(None),
    level: list[str] | None = Query(None),
    owner_id: str | None = None,
    card_id: str | None = None,
    source_type: list[str] | None = Query(None),
    search: str | None = None,
    overdue: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskMetricsOut:
    """KPI payload. Accepts the same filters as ``GET /risks`` so the
    matrix + tiles follow the user's selected view.
    """
    await PermissionService.require_permission(db, user, "risks.view")
    rows = await _load_filtered_risks(
        db,
        status=status,
        category=category,
        level=level,
        owner_id=owner_id,
        card_id=card_id,
        source_type=source_type,
        search=search,
        overdue=overdue,
    )
    return RiskMetricsOut.model_validate(compute_metrics(rows))


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get("/{risk_id}", response_model=RiskOut)
async def get_risk(
    risk_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.view")
    risk = await _load_risk(db, risk_id)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


@router.post("", response_model=RiskOut)
async def create_risk(
    body: RiskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")

    owner_uid: uuid.UUID | None = None
    if body.owner_id:
        try:
            owner_uid = uuid.UUID(body.owner_id)
        except ValueError as exc:
            raise HTTPException(400, "Invalid owner_id") from exc

    risk = Risk(
        id=uuid.uuid4(),
        reference=await next_reference(db),
        title=body.title,
        description=body.description or "",
        category=body.category,
        source_type="manual",
        source_ref=None,
        initial_probability=body.initial_probability,
        initial_impact=body.initial_impact,
        initial_level=derive_level(body.initial_probability, body.initial_impact) or "medium",
        mitigation=body.mitigation,
        owner_id=owner_uid,
        target_resolution_date=body.target_resolution_date,
        status="identified",
        created_by=user.id,
    )
    db.add(risk)
    await db.flush()

    if body.card_ids:
        await link_cards(db, risk.id, _parse_card_ids(body.card_ids))

    await sync_owner_todo(db, risk, actor_id=user.id, previous_owner=None)

    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


@router.patch("/{risk_id}", response_model=RiskOut)
async def update_risk(
    risk_id: str,
    body: RiskUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")
    risk = await _load_risk(db, risk_id)
    previous_owner = risk.owner_id

    data = body.model_dump(exclude_unset=True)

    # Closed risks are read-only — the only accepted PATCH is the
    # reopen transition itself (``status: in_progress``). Any other
    # field edit is rejected with 409 so the UI matches what the user
    # sees (all fields greyed out, only the Reopen button active).
    if risk.status == "closed":
        allowed_keys = {"status"}
        disallowed = set(data.keys()) - allowed_keys
        if disallowed:
            raise HTTPException(
                409,
                "Risk is closed and read-only. Reopen it first to edit "
                f"these fields: {sorted(disallowed)}",
            )
        if data.get("status") not in {None, "in_progress", "closed"}:
            raise HTTPException(
                409,
                "Closed risks can only be reopened (status → in_progress).",
            )

    # Scalar field updates.
    for key in (
        "title",
        "description",
        "category",
        "initial_probability",
        "initial_impact",
        "mitigation",
        "residual_probability",
        "residual_impact",
        "target_resolution_date",
        "acceptance_rationale",
    ):
        if key in data:
            setattr(risk, key, data[key])

    if "owner_id" in data:
        value = data["owner_id"]
        if value is None:
            risk.owner_id = None
        else:
            try:
                risk.owner_id = uuid.UUID(value)
            except ValueError as exc:
                raise HTTPException(400, "Invalid owner_id") from exc

    # Recompute derived levels from possibly-updated probability / impact.
    risk.initial_level = derive_level(risk.initial_probability, risk.initial_impact) or "medium"
    risk.residual_level = derive_level(risk.residual_probability, risk.residual_impact)

    if "status" in data:
        new_status = data["status"]
        try:
            validate_status_transition(risk.status, new_status)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if new_status == "accepted":
            if not (risk.acceptance_rationale or "").strip():
                raise HTTPException(400, "acceptance_rationale is required to accept a risk")
            risk.accepted_by = user.id
            risk.accepted_at = datetime.now(timezone.utc)
        elif new_status != "accepted" and risk.status == "accepted":
            # Reopening an accepted risk — clear acceptance attribution.
            risk.accepted_by = None
            risk.accepted_at = None
        risk.status = new_status

        # Notify the owner on meaningful state changes.
        if risk.owner_id and risk.owner_id != user.id:
            background_tasks.add_task(
                _notify_status_change,
                str(risk.owner_id),
                str(risk.id),
                risk.reference,
                risk.title,
                new_status,
                str(user.id),
            )

    # Keep the owner's system Todo aligned with the current state.
    # Runs on every patch so status / target-date edits stay reflected
    # on the assignee's Todos page; notification only fires on owner change.
    await sync_owner_todo(db, risk, actor_id=user.id, previous_owner=previous_owner)

    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


async def _notify_status_change(
    user_id: str,
    risk_id: str,
    reference: str,
    title: str,
    new_status: str,
    actor_id: str,
) -> None:
    """Fire a notification out-of-band from the request lifecycle."""
    from app.database import async_session

    async with async_session() as db:
        try:
            await notification_service.create_notification(
                db,
                user_id=uuid.UUID(user_id),
                notif_type="risk_status_changed",
                title=f"Risk {reference} moved to {new_status.replace('_', ' ')}",
                message=title,
                link=f"/ea-delivery/risks/{risk_id}",
                data={"risk_id": risk_id, "status": new_status},
                actor_id=uuid.UUID(actor_id),
            )
            await db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("Risk status-change notification failed")


@router.delete("/{risk_id}")
async def delete_risk(
    risk_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    await PermissionService.require_permission(db, user, "risks.manage")
    risk = await _load_risk(db, risk_id)
    link = _risk_link(risk)
    # Clean up the owner's system Todo before removing the risk row.
    todo_res = await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True)))
    for t in todo_res.scalars().all():
        await db.delete(t)
    await db.delete(risk)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Card linking
# ---------------------------------------------------------------------------


@router.post("/{risk_id}/cards", response_model=RiskOut)
async def link_risk_cards(
    risk_id: str,
    body: RiskCardLinkRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")
    risk = await _load_risk(db, risk_id)
    if risk.status == "closed":
        raise HTTPException(
            409,
            "Risk is closed and read-only. Reopen it first to link cards.",
        )
    await link_cards(db, risk.id, _parse_card_ids(body.card_ids), body.role)
    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


@router.delete("/{risk_id}/cards/{card_id}", response_model=RiskOut)
async def unlink_risk_card(
    risk_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")
    risk = await _load_risk(db, risk_id)
    if risk.status == "closed":
        raise HTTPException(
            409,
            "Risk is closed and read-only. Reopen it first to unlink cards.",
        )
    try:
        cid = uuid.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid card_id") from exc
    await db.execute(delete(RiskCard).where(RiskCard.risk_id == risk.id, RiskCard.card_id == cid))
    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


# ---------------------------------------------------------------------------
# Promote from TurboLens findings
# ---------------------------------------------------------------------------


def _overrides_from_promote(body: RiskPromoteRequest | None) -> dict | None:
    if body is None:
        return None
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "owner_id" in data:
        try:
            data["owner_id"] = uuid.UUID(data["owner_id"])
        except ValueError as exc:
            raise HTTPException(400, "Invalid owner_id") from exc
    return data


@router.post("/promote/cve/{finding_id}", response_model=RiskOut)
async def promote_cve(
    finding_id: str,
    body: RiskPromoteRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")
    await PermissionService.require_permission(db, user, "security_compliance.view")
    try:
        fid = uuid.UUID(finding_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid finding id") from exc
    try:
        risk = await promote_cve_finding(db, fid, user.id, overrides=_overrides_from_promote(body))
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    await sync_owner_todo(db, risk, actor_id=user.id, previous_owner=None)
    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


@router.post("/promote/compliance/{finding_id}", response_model=RiskOut)
async def promote_compliance(
    finding_id: str,
    body: RiskPromoteRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")
    await PermissionService.require_permission(db, user, "security_compliance.view")
    try:
        fid = uuid.UUID(finding_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid finding id") from exc
    try:
        risk = await promote_compliance_finding(
            db, fid, user.id, overrides=_overrides_from_promote(body)
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    await sync_owner_todo(db, risk, actor_id=user.id, previous_owner=None)
    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


# ---------------------------------------------------------------------------
# Cards → risks sub-route
# ---------------------------------------------------------------------------


@cards_risks_router.get("/{card_id}/risks", response_model=list[RiskOut])
async def risks_for_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RiskOut]:
    """All risks linked to a given card (used by the CardDetail → Risks tab)."""
    await PermissionService.require_permission(db, user, "risks.view")
    try:
        cid = uuid.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid card id") from exc
    result = await db.execute(
        select(Risk)
        .join(RiskCard, RiskCard.risk_id == Risk.id)
        .where(RiskCard.card_id == cid)
        .order_by(Risk.updated_at.desc())
    )
    risks = list(result.scalars().all())
    return [RiskOut.model_validate(await risk_to_dict(db, r)) for r in risks]


# Explicit re-exports to keep ruff happy on module-level imports that
# are only used for side-effects (status vocabulary list).
__all__ = ["router", "cards_risks_router", "STATUS_VALUES"]
