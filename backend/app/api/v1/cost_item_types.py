"""The cost-item catalogue routes. Logic: ``services/cost_item_types``."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.metamodel import _clean_translations, _label_translation_items
from app.database import get_db
from app.models.user import User
from app.schemas.cost_items import CostItemTypeCreate, CostItemTypeUpdate
from app.services import audit_log, cost_import_template, cost_item_types
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/metamodel", tags=["metamodel"])

_COST_ITEM_AUDIT_SCALARS = ("label", "archived", "sort_order")
logger = logging.getLogger(__name__)


async def _warm_template(db: AsyncSession) -> None:
    try:
        snapshot = await cost_import_template.catalogue_snapshot(db)
        await db.commit()
        await cost_import_template.template_bytes(snapshot)
    except Exception:
        logger.exception("Could not warm cost import template")


@router.get("/cost-item-types")
async def list_cost_item_types(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The whole catalogue (archived lines included, flagged). Any signed-in
    user may read it: card cost sections need the labels."""
    rows = await cost_item_types.list_items(db)
    return [cost_item_types.serialize(r) for r in rows]


@router.post("/cost-item-types", status_code=201)
async def create_cost_item_type(
    body: CostItemTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    try:
        row = await cost_item_types.create_item(
            db, body.key, body.label.strip(), _clean_translations(body.translations)
        )
    except cost_item_types.CostItemError as exc:
        status = 409 if exc.code == "duplicate_key" else 422
        raise HTTPException(status, detail={"error": exc.code, "message": str(exc)}) from exc
    await audit_log.record(
        db,
        action="admin.metamodel.cost_item_type.created",
        category="admin",
        actor=user,
        target=("cost_item_type", row.key, row.label),
    )
    await db.commit()
    await db.refresh(row)
    result = cost_item_types.serialize(row)
    await _warm_template(db)
    return result


@router.patch("/cost-item-types/{key}")
async def update_cost_item_type(
    key: str,
    body: CostItemTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    row = await cost_item_types.get_item(db, key)
    if row is None:
        raise HTTPException(404, "Cost item not found")
    # A null means "leave as is" (update_item ignores it); keep it out of the audit diff too.
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "label" in updates:
        updates["label"] = updates["label"].strip()
    if "translations" in updates:
        updates["translations"] = _clean_translations(updates["translations"])
    changes = audit_log.diff(row, updates, keys=_COST_ITEM_AUDIT_SCALARS)
    items = _label_translation_items(
        row.translations, updates.get("translations", row.translations)
    )
    await cost_item_types.update_item(db, key, **updates)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.cost_item_type.updated",
            category="admin",
            actor=user,
            target=("cost_item_type", row.key, row.label),
            changes=changes,
            items=items,
        )
    await db.commit()
    await db.refresh(row)
    result = cost_item_types.serialize(row)
    if changes or items:
        await _warm_template(db)
    return result
