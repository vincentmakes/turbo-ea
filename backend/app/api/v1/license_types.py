"""The license-type catalogue routes. Logic: ``services/license_types``."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.metamodel import _clean_translations, _label_translation_items
from app.database import get_db
from app.models.user import User
from app.schemas.licenses import LicenseTypeCreate, LicenseTypeUpdate
from app.services import audit_log, license_types
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/metamodel", tags=["metamodel"])

_LICENSE_TYPE_AUDIT_SCALARS = ("label", "archived", "sort_order")


@router.get("/license-types")
async def list_license_types(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The whole catalogue (archived lines included, flagged). Any signed-in
    user may read it: card license sections need the labels."""
    rows = await license_types.list_items(db)
    return [license_types.serialize(r) for r in rows]


@router.post("/license-types", status_code=201)
async def create_license_type(
    body: LicenseTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    try:
        row = await license_types.create_item(
            db,
            body.metric_key,
            body.key,
            body.label.strip(),
            _clean_translations(body.translations),
        )
    except license_types.CatalogueError as exc:
        status = 409 if exc.code == "duplicate_key" else 422
        raise HTTPException(status, detail={"error": exc.code, "message": str(exc)}) from exc
    await audit_log.record(
        db,
        action="admin.metamodel.license_type.created",
        category="admin",
        actor=user,
        target=("license_type", row.key, row.label),
    )
    await db.commit()
    await db.refresh(row)
    return license_types.serialize(row)


@router.patch("/license-types/{key}")
async def update_license_type(
    key: str,
    metric_key: str,
    body: LicenseTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    row = await license_types.get_item(db, metric_key, key)
    if row is None:
        raise HTTPException(404, "License type not found")
    # A null means "leave as is" (update_item ignores it); keep it out of the audit diff too.
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "label" in updates:
        updates["label"] = updates["label"].strip()
    if "translations" in updates:
        updates["translations"] = _clean_translations(updates["translations"])
    changes = audit_log.diff(row, updates, keys=_LICENSE_TYPE_AUDIT_SCALARS)
    items = _label_translation_items(
        row.translations, updates.get("translations", row.translations)
    )
    await license_types.update_item(db, metric_key, key, **updates)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.license_type.updated",
            category="admin",
            actor=user,
            target=("license_type", row.key, row.label),
            changes=changes,
            items=items,
        )
    await db.commit()
    await db.refresh(row)
    return license_types.serialize(row)
