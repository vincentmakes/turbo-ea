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
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.risk import Risk, RiskCard
from app.models.todo import Todo
from app.models.user import User
from app.schemas.risk import (
    RiskCardLinkRequest,
    RiskCreate,
    RiskImportRequest,
    RiskImportResponse,
    RiskImportResult,
    RiskListPage,
    RiskMetricsOut,
    RiskOut,
    RiskPromoteRequest,
    RiskUpdate,
)
from app.services import notification_service
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService
from app.services.risk_service import (
    _REFERENCE_RE,
    CATEGORY_VALUES,
    IMPACT_VALUES,
    PROBABILITY_VALUES,
    STATUS_VALUES,
    compute_metrics,
    derive_level,
    link_cards,
    next_reference,
    promote_compliance_finding,
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


async def _linked_card_ids(db: AsyncSession, risk_id: uuid.UUID) -> list[uuid.UUID]:
    res = await db.execute(select(RiskCard.card_id).where(RiskCard.risk_id == risk_id))
    return [cid for (cid,) in res.all()]


def _risk_summary(risk: Risk) -> str:
    level = (risk.residual_level or risk.initial_level or "").lower()
    parts = [risk.reference]
    if level:
        parts.append(level.capitalize())
    parts.append(risk.title or "")
    return " · ".join(p for p in parts if p)


async def _publish_risk_event(
    db: AsyncSession,
    risk: Risk,
    event_type: str,
    card_ids: list[uuid.UUID],
    *,
    actor_id: uuid.UUID,
    extra: dict | None = None,
) -> None:
    """Fan-out a risk-related event to every affected card so the
    register changes show up in the per-card history timeline."""
    if not card_ids:
        return
    payload: dict = {
        "risk_id": str(risk.id),
        "reference": risk.reference,
        "title": risk.title,
        "level": risk.residual_level or risk.initial_level,
        "status": risk.status,
        "category": risk.category,
        "link": _risk_link(risk),
        "summary": _risk_summary(risk),
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


async def load_filtered_risks(
    db: AsyncSession,
    *,
    status: list[str] | None,
    category: list[str] | None,
    level: list[str] | None,
    owner_id: str | None,
    card_ids: list[str] | None,
    card_types: list[str] | None,
    source_type: list[str] | None,
    search: str | None,
    overdue: bool,
) -> list[Risk]:
    """Shared filter pipeline used by ``GET /risks``, ``GET /risks/metrics``
    and the mitigation-task export so the KPI tiles + matrix + both export
    sheets always reflect whatever the user has filtered to.

    ``card_ids`` and ``card_types`` are OR-ed within themselves and AND-ed
    with each other (and with every other dimension), matching how the
    status / category / level multi-selects already behave.
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
    if card_ids:
        try:
            cids = [uuid.UUID(c) for c in card_ids]
        except ValueError as exc:
            raise HTTPException(400, "Invalid card_id") from exc
        stmt = stmt.where(Risk.id.in_(select(RiskCard.risk_id).where(RiskCard.card_id.in_(cids))))
    if card_types:
        # "Every risk touching at least one card of these types." Unknown
        # type keys simply match nothing — card types are data, not an enum.
        stmt = stmt.where(
            Risk.id.in_(
                select(RiskCard.risk_id)
                .join(Card, Card.id == RiskCard.card_id)
                .where(Card.type.in_(card_types))
            )
        )

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
    card_id: list[str] | None = Query(None),
    card_type: list[str] | None = Query(None),
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
    ``level`` / ``source_type`` / ``card_id`` / ``card_type`` are repeatable
    query params (e.g. ``?status=identified&status=analysed``). Repeated
    values OR within a dimension and AND across dimensions, so
    ``?card_id=a&card_id=b&card_type=Application`` reads as "risks affecting
    card a or b, that also touch at least one Application".
    """
    await PermissionService.require_permission(db, user, "risks.view")

    rows = await load_filtered_risks(
        db,
        status=status,
        category=category,
        level=level,
        owner_id=owner_id,
        card_ids=card_id,
        card_types=card_type,
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
    card_id: list[str] | None = Query(None),
    card_type: list[str] | None = Query(None),
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
    rows = await load_filtered_risks(
        db,
        status=status,
        category=category,
        level=level,
        owner_id=owner_id,
        card_ids=card_id,
        card_types=card_type,
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

    linked = await _linked_card_ids(db, risk.id)
    await _publish_risk_event(db, risk, "risk.added", linked, actor_id=user.id)

    await db.commit()
    await db.refresh(risk)
    return RiskOut.model_validate(await risk_to_dict(db, risk))


async def _load_reference_state(db: AsyncSession) -> tuple[int, set[str]]:
    """Read every existing risk reference once.

    Returns ``(highest, existing)`` where ``highest`` is the largest
    ``R-NNNNNN`` integer (bulk import allocates sequentially from
    ``highest + 1`` instead of calling :func:`next_reference` per row, which
    would re-read the same max until the first flush and hand out duplicates)
    and ``existing`` is the set of upper-cased references already in use, so
    the importer can skip rows whose reference matches an existing risk.
    """
    result = await db.execute(select(Risk.reference))
    highest = 0
    existing: set[str] = set()
    for (ref,) in result.all():
        if not ref:
            continue
        existing.add(ref.strip().upper())
        match = _REFERENCE_RE.match(ref)
        if match:
            highest = max(highest, int(match.group(1)))
    return highest, existing


@router.post("/bulk-import", response_model=RiskImportResponse)
async def bulk_import_risks(
    body: RiskImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskImportResponse:
    """Spreadsheet importer for the Risk Register — create-only.

    Each row carries its own ``row_index`` so the caller can pair the
    response back to its spreadsheet row. A row whose ``reference`` matches
    an existing risk is **skipped** — the importer never updates existing
    risks, so re-importing a previously exported register is idempotent.
    Every other row creates a brand-new risk with a freshly generated
    ``R-NNNNNN`` reference. Owner is resolved best-effort by email
    (preferred) or exact display name; cards are linked best-effort by exact
    name. Unresolved / ambiguous values produce a non-blocking warning and
    are skipped — the risk still imports.

    ``dry_run=True`` runs every validator and resolver, then rolls back so
    the UI can preview the outcome without persisting anything (and without
    emitting owner Todos, notifications, or card-timeline events).
    Permission: ``risks.manage``.
    """
    await PermissionService.require_permission(db, user, "risks.manage")

    # Dry-run isolation: wrap the whole batch in our own savepoint so the
    # discard at the end only undoes our work and never reaches a wrapping
    # transaction (e.g. the savepoint backing the integration-test fixture).
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None

    base, existing_refs = await _load_reference_state(db)
    results: list[RiskImportResult] = []
    created_count = 0
    skipped_count = 0
    next_seq = base

    for item in body.items:
        # Skip rows whose reference already belongs to a risk — the importer
        # never updates existing risks. Checked before the savepoint/creation
        # so a skipped row consumes nothing.
        existing_ref = (item.reference or "").strip().upper()
        if existing_ref and existing_ref in existing_refs:
            skipped_count += 1
            results.append(
                RiskImportResult(
                    row_index=item.row_index,
                    status="skipped",
                    reference=existing_ref,
                )
            )
            continue

        warnings: list[str] = []
        # Per-row savepoint so a single bad row can't poison the batch.
        row_savepoint = await db.begin_nested()
        try:
            # --- enum validation -------------------------------------------
            category = (item.category or "operational").strip().lower()
            if category not in CATEGORY_VALUES:
                raise ValueError(f"Invalid category: {item.category!r}")
            probability = (item.initial_probability or "medium").strip().lower()
            if probability not in PROBABILITY_VALUES:
                raise ValueError(f"Invalid initial_probability: {item.initial_probability!r}")
            impact = (item.initial_impact or "medium").strip().lower()
            if impact not in IMPACT_VALUES:
                raise ValueError(f"Invalid initial_impact: {item.initial_impact!r}")
            status = (item.status or "identified").strip().lower()
            if status not in STATUS_VALUES:
                raise ValueError(f"Invalid status: {item.status!r}")

            residual_prob: str | None = None
            residual_impact: str | None = None
            if item.residual_probability:
                residual_prob = item.residual_probability.strip().lower()
                if residual_prob not in PROBABILITY_VALUES:
                    raise ValueError(f"Invalid residual_probability: {item.residual_probability!r}")
            if item.residual_impact:
                residual_impact = item.residual_impact.strip().lower()
                if residual_impact not in IMPACT_VALUES:
                    raise ValueError(f"Invalid residual_impact: {item.residual_impact!r}")

            # --- owner resolution (best-effort) ----------------------------
            owner_uid: uuid.UUID | None = None
            if item.owner_email:
                email = item.owner_email.strip().lower()
                res = await db.execute(select(User.id).where(func.lower(User.email) == email))
                row = res.first()
                if row is not None:
                    owner_uid = row[0]
                else:
                    warnings.append(f"Owner email not found: {item.owner_email}")
            elif item.owner_name:
                name = item.owner_name.strip()
                res = await db.execute(select(User.id).where(User.display_name == name))
                rows = res.all()
                if len(rows) == 1:
                    owner_uid = rows[0][0]
                elif len(rows) == 0:
                    warnings.append(f"Owner not found: {item.owner_name}")
                else:
                    warnings.append(f"Owner name is ambiguous: {item.owner_name}")

            # --- card resolution (best-effort, by exact name) -------------
            card_ids: list[uuid.UUID] = []
            for raw_name in item.card_names:
                cname = raw_name.strip()
                if not cname:
                    continue
                res = await db.execute(select(Card.id).where(Card.name == cname))
                matches = res.all()
                if len(matches) == 1:
                    card_ids.append(matches[0][0])
                elif len(matches) == 0:
                    warnings.append(f"Card not found: {cname}")
                else:
                    warnings.append(f"Card name is ambiguous: {cname}")

            # --- create ----------------------------------------------------
            next_seq += 1
            reference = f"R-{next_seq:06d}"
            risk = Risk(
                id=uuid.uuid4(),
                reference=reference,
                title=item.title,
                description=item.description or "",
                category=category,
                source_type="manual",
                source_ref=None,
                initial_probability=probability,
                initial_impact=impact,
                initial_level=derive_level(probability, impact) or "medium",
                residual_probability=residual_prob,
                residual_impact=residual_impact,
                residual_level=derive_level(residual_prob, residual_impact),
                owner_id=owner_uid,
                target_resolution_date=item.target_resolution_date,
                # Import sets status directly — this is a data load, not a
                # workflow transition, so validate_status_transition is bypassed.
                status=status,
                created_by=user.id,
            )
            db.add(risk)
            await db.flush()

            if card_ids:
                await link_cards(db, risk.id, card_ids)

            if not body.dry_run:
                await sync_owner_todo(db, risk, actor_id=user.id, previous_owner=None)
                linked = await _linked_card_ids(db, risk.id)
                await _publish_risk_event(db, risk, "risk.added", linked, actor_id=user.id)

            await row_savepoint.commit()
            created_count += 1
            results.append(
                RiskImportResult(
                    row_index=item.row_index,
                    status="created",
                    id=str(risk.id),
                    reference=reference,
                    warnings=warnings,
                )
            )
        except (ValueError, HTTPException) as exc:
            await row_savepoint.rollback()
            # A row that fails at flush leaves a gap in the reference
            # sequence — that's fine, references only need to be unique.
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            results.append(
                RiskImportResult(
                    row_index=item.row_index,
                    status="failed",
                    error=str(detail),
                    warnings=warnings,
                )
            )

    failed_count = sum(1 for r in results if r.status == "failed")

    if body.dry_run:
        assert dry_run_savepoint is not None
        await dry_run_savepoint.rollback()
    elif created_count == 0:
        await db.rollback()
    else:
        await db.commit()

    return RiskImportResponse(
        results=results,
        created=created_count,
        skipped=skipped_count,
        failed=failed_count,
        dry_run=body.dry_run,
    )


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
    previous_status = risk.status

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

    # Back-propagate to linked Compliance findings on status change so the
    # finding lifecycle stays in sync with the Risk lifecycle.
    if risk.status != previous_status:
        from app.services.compliance_risk_sync import propagate_risk_to_findings

        await propagate_risk_to_findings(db, risk, actor_user_id=user.id)

    if data:
        linked = await _linked_card_ids(db, risk.id)
        await _publish_risk_event(
            db,
            risk,
            "risk.updated",
            linked,
            actor_id=user.id,
            extra={"fields": sorted(data.keys())},
        )

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
    # Capture linked cards before cascade-delete wipes the junction rows.
    linked = await _linked_card_ids(db, risk.id)
    await _publish_risk_event(db, risk, "risk.removed", linked, actor_id=user.id)
    # Re-open any Compliance findings linked to this Risk so the owner
    # re-decides what to do. Must run before the deletion (and the FK
    # SET NULL) so the propagator can still see the linkage.
    from app.services.compliance_risk_sync import propagate_risk_to_findings

    await propagate_risk_to_findings(db, risk, deleted=True, actor_user_id=user.id)
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
    requested = _parse_card_ids(body.card_ids)
    existing = set(await _linked_card_ids(db, risk.id))
    await link_cards(db, risk.id, requested, body.role)
    # Re-query to get the actually-inserted set (link_cards skips invalid ids).
    new_links = [cid for cid in await _linked_card_ids(db, risk.id) if cid not in existing]
    await _publish_risk_event(db, risk, "risk.added", new_links, actor_id=user.id)
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
    # Look up the junction row first so we can emit the history event only
    # when an actual unlink happens (idempotent unlinks stay silent).
    existing_res = await db.execute(
        select(RiskCard).where(RiskCard.risk_id == risk.id, RiskCard.card_id == cid)
    )
    link_row = existing_res.scalar_one_or_none()
    if link_row is not None:
        await db.delete(link_row)
        await _publish_risk_event(db, risk, "risk.removed", [cid], actor_id=user.id)
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


@router.post("/promote/compliance/{finding_id}", response_model=RiskOut)
async def promote_compliance(
    finding_id: str,
    body: RiskPromoteRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RiskOut:
    await PermissionService.require_permission(db, user, "risks.manage")
    await PermissionService.require_permission(db, user, "compliance.view")
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
    linked = await _linked_card_ids(db, risk.id)
    await _publish_risk_event(
        db, risk, "risk.added", linked, actor_id=user.id, extra={"promoted_from": "compliance"}
    )
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
