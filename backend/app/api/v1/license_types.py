"""The license metric and license type catalogue routes (a type belongs to one metric, and
never moves). Logic: ``services/license_metrics`` and ``services/license_types``."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.metamodel import _clean_translations, _label_translation_items
from app.database import get_db
from app.models.user import User
from app.schemas.licenses import (
    LicenseMetricCreate,
    LicenseMetricOut,
    LicenseMetricUpdate,
    LicenseTypeCreate,
    LicenseTypeOut,
    LicenseTypeUpdate,
)
from app.services import audit_log, license_metrics, license_types
from app.services.item_catalogue import CatalogueError
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/metamodel", tags=["metamodel"])

_AUDIT_SCALARS = ("label", "archived", "sort_order")


def _refuse(exc: CatalogueError) -> HTTPException:
    # The routes resolve the metric (404) first, so a create only refuses a key.
    status = 409 if exc.code == "duplicate_key" else 422
    return HTTPException(status, detail={"error": exc.code, "message": str(exc)})


def _clean(updates: dict) -> dict:
    # A null means "leave as is" (update_item ignores it); keep it out of the audit diff too.
    updates = {k: v for k, v in updates.items() if v is not None}
    if "translations" in updates:
        updates["translations"] = _clean_translations(updates["translations"])
    return updates


async def _metric_or_404(db: AsyncSession, key: str):
    metric = await license_metrics.get_item(db, key)
    if metric is None:
        raise HTTPException(404, "License metric not found")
    return metric


def _type_target(metric, row) -> tuple[str, str, str]:
    """Names the metric as well as the type: a type key is only unique inside its metric."""
    return ("license_type", f"{metric.key}/{row.key}", f"{metric.label} / {row.label}")


@router.get("/license-metrics", response_model=list[LicenseMetricOut])
async def list_license_metrics(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The whole catalogue, types nested (archived lines included, flagged). Any signed-in
    user may read it: card license sections need the labels."""
    types = await license_types.list_items(db)
    return [
        license_metrics.serialize(m, [t for t in types if t.metric_key == m.key])
        for m in await license_metrics.list_items(db)
    ]


@router.post("/license-metrics", status_code=201, response_model=LicenseMetricOut)
async def create_license_metric(
    body: LicenseMetricCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    try:
        row = await license_metrics.create_item(
            db, body.key, body.label, _clean_translations(body.translations)
        )
    except CatalogueError as exc:
        raise _refuse(exc) from exc
    await audit_log.record(
        db,
        action="admin.metamodel.license_metric.created",
        category="admin",
        actor=user,
        target=("license_metric", row.key, row.label),
    )
    await db.commit()
    await db.refresh(row)
    return license_metrics.serialize(row)


@router.patch("/license-metrics/{key}", response_model=LicenseMetricOut)
async def update_license_metric(
    key: str,
    body: LicenseMetricUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    row = await _metric_or_404(db, key)
    updates = _clean(body.model_dump(exclude_unset=True))
    changes = audit_log.diff(row, updates, keys=_AUDIT_SCALARS)
    items = _label_translation_items(
        row.translations, updates.get("translations", row.translations)
    )
    label = row.label
    await license_metrics.update_item(db, key, **updates)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.license_metric.updated",
            category="admin",
            actor=user,
            target=("license_metric", key, label),
            changes=changes,
            items=items,
        )
    await db.commit()
    await db.refresh(row)
    return license_metrics.serialize(row, await license_types.list_items(db, key))


@router.post("/license-metrics/{metric_key}/types", status_code=201, response_model=LicenseTypeOut)
async def create_license_type(
    metric_key: str,
    body: LicenseTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    metric = await _metric_or_404(db, metric_key)
    try:
        row = await license_types.create_item(
            db,
            metric_key,
            body.key,
            body.label,
            _clean_translations(body.translations),
        )
    except CatalogueError as exc:
        raise _refuse(exc) from exc
    await audit_log.record(
        db,
        action="admin.metamodel.license_type.created",
        category="admin",
        actor=user,
        target=_type_target(metric, row),
    )
    await db.commit()
    await db.refresh(row)
    return license_types.serialize(row)


@router.patch("/license-metrics/{metric_key}/types/{key}", response_model=LicenseTypeOut)
async def update_license_type(
    metric_key: str,
    key: str,
    body: LicenseTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    metric = await _metric_or_404(db, metric_key)
    row = await license_types.get_item(db, metric_key, key)
    if row is None:
        raise HTTPException(404, "License type not found")
    updates = _clean(body.model_dump(exclude_unset=True))
    changes = audit_log.diff(row, updates, keys=_AUDIT_SCALARS)
    items = _label_translation_items(
        row.translations, updates.get("translations", row.translations)
    )
    target = _type_target(metric, row)
    await license_types.update_item(db, metric_key, key, **updates)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.license_type.updated",
            category="admin",
            actor=user,
            target=target,
            changes=changes,
            items=items,
        )
    await db.commit()
    await db.refresh(row)
    return license_types.serialize(row)
