from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/metamodel", tags=["metamodel"])


# ── Helpers ────────────────────────────────────────────────────────────

def _serialize_type(t: CardType) -> dict:
    return {
        "key": t.key,
        "label": t.label,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "category": t.category,
        "has_hierarchy": t.has_hierarchy,
        "subtypes": t.subtypes or [],
        "fields_schema": t.fields_schema or [],
        "stakeholder_roles": t.stakeholder_roles or [],
        "built_in": t.built_in,
        "is_hidden": t.is_hidden,
        "sort_order": t.sort_order,
    }


def _serialize_relation_type(r: RelationType) -> dict:
    return {
        "key": r.key,
        "label": r.label,
        "reverse_label": r.reverse_label,
        "description": r.description,
        "source_type_key": r.source_type_key,
        "target_type_key": r.target_type_key,
        "cardinality": r.cardinality,
        "attributes_schema": r.attributes_schema or [],
        "built_in": r.built_in,
        "is_hidden": r.is_hidden,
        "sort_order": r.sort_order,
    }


# ── Card Types ─────────────────────────────────────────────────────────

@router.get("/types")
async def list_types(
    include_hidden: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(CardType).order_by(CardType.sort_order)
    if not include_hidden:
        q = q.where(CardType.is_hidden == False)  # noqa: E712
    result = await db.execute(q)
    return [_serialize_type(t) for t in result.scalars().all()]


@router.get("/types/{key}")
async def get_type(key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Card type not found")
    return _serialize_type(t)


@router.post("/types", status_code=201)
async def create_type(body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    existing = await db.execute(
        select(CardType).where(CardType.key == body.get("key", ""))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Type key already exists")

    # Determine next sort_order
    max_order = await db.execute(select(func.max(CardType.sort_order)))
    next_order = (max_order.scalar() or 0) + 1

    default_roles = [
        {"key": "responsible", "label": "Responsible"},
        {"key": "observer", "label": "Observer"},
    ]
    t = CardType(
        key=body["key"],
        label=body["label"],
        description=body.get("description"),
        icon=body.get("icon", "category"),
        color=body.get("color", "#1976d2"),
        category=body.get("category"),
        has_hierarchy=body.get("has_hierarchy", False),
        subtypes=body.get("subtypes", []),
        fields_schema=body.get("fields_schema", []),
        stakeholder_roles=body.get("stakeholder_roles", default_roles),
        built_in=False,
        is_hidden=False,
        sort_order=body.get("sort_order", next_order),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _serialize_type(t)


@router.patch("/types/{key}")
async def update_type(key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")

    # Prevent removing stakeholder roles that are in use
    if "stakeholder_roles" in body:
        old_keys = {r["key"] for r in (t.stakeholder_roles or [])}
        new_keys = {r["key"] for r in (body["stakeholder_roles"] or [])}
        removed = old_keys - new_keys
        if removed:
            # Check if any stakeholders use the removed roles on cards of this type
            in_use = (
                await db.execute(
                    select(Stakeholder.role, func.count(Stakeholder.id))
                    .join(Card, Stakeholder.card_id == Card.id)
                    .where(Card.type == key, Stakeholder.role.in_(removed))
                    .group_by(Stakeholder.role)
                )
            ).all()
            if in_use:
                details = ", ".join(f"'{r}' ({c} stakeholder(s))" for r, c in in_use)
                raise HTTPException(
                    400,
                    f"Cannot remove roles that are in use: {details}. "
                    "Remove the stakeholder assignments first.",
                )

    updatable = [
        "label", "description", "icon", "color", "category",
        "has_hierarchy", "subtypes", "fields_schema", "stakeholder_roles",
        "sort_order", "is_hidden",
    ]
    for field in updatable:
        if field in body:
            setattr(t, field, body[field])

    await db.commit()
    await db.refresh(t)
    return _serialize_type(t)


@router.delete("/types/{key}")
async def delete_type(key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")

    # Check for existing cards of this type
    count_result = await db.execute(
        select(func.count()).select_from(Card).where(Card.type == key)
    )
    instance_count = count_result.scalar() or 0

    if t.built_in:
        # Soft-delete built-in types
        t.is_hidden = True
        await db.commit()
        return {"status": "hidden", "key": key, "instance_count": instance_count}

    if instance_count > 0:
        raise HTTPException(
            400,
            f"Cannot delete type '{key}': {instance_count} card(s) exist. "
            "Delete them first or hide the type instead.",
        )

    # Also delete relation types that reference this type
    await db.execute(
        select(RelationType).where(
            (RelationType.source_type_key == key)
            | (RelationType.target_type_key == key)
        )
    )
    rel_result = await db.execute(
        select(RelationType).where(
            (RelationType.source_type_key == key)
            | (RelationType.target_type_key == key)
        )
    )
    for rt in rel_result.scalars().all():
        await db.delete(rt)

    await db.delete(t)
    await db.commit()
    return {"status": "deleted", "key": key}


# ── Relation Types ─────────────────────────────────────────────────────

@router.get("/relation-types")
async def list_relation_types(
    type_key: str | None = Query(None, description="Filter relations connected to this type"),
    include_hidden: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(RelationType).order_by(RelationType.sort_order)
    if not include_hidden:
        q = q.where(RelationType.is_hidden == False)  # noqa: E712
    if type_key:
        q = q.where(
            (RelationType.source_type_key == type_key)
            | (RelationType.target_type_key == type_key)
        )
    result = await db.execute(q)
    return [_serialize_relation_type(r) for r in result.scalars().all()]


@router.get("/relation-types/{key}")
async def get_relation_type(key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")
    return _serialize_relation_type(r)


@router.post("/relation-types", status_code=201)
async def create_relation_type(body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    existing = await db.execute(
        select(RelationType).where(RelationType.key == body.get("key", ""))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Relation type key already exists")

    # Validate source and target types exist
    for fk in ("source_type_key", "target_type_key"):
        type_key = body.get(fk)
        if not type_key:
            raise HTTPException(400, f"{fk} is required")
        exists = await db.execute(
            select(CardType.key).where(CardType.key == type_key)
        )
        if not exists.scalar_one_or_none():
            raise HTTPException(400, f"Type '{type_key}' does not exist")

    # Prevent duplicate source+target pair (ignore hidden/soft-deleted)
    dup = await db.execute(
        select(RelationType).where(
            RelationType.source_type_key == body["source_type_key"],
            RelationType.target_type_key == body["target_type_key"],
            RelationType.is_hidden == False,  # noqa: E712
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(
            400,
            f"A relation type from '{body['source_type_key']}' to "
            f"'{body['target_type_key']}' already exists.",
        )

    max_order = await db.execute(select(func.max(RelationType.sort_order)))
    next_order = (max_order.scalar() or 0) + 1

    rt = RelationType(
        key=body["key"],
        label=body["label"],
        reverse_label=body.get("reverse_label"),
        description=body.get("description"),
        source_type_key=body["source_type_key"],
        target_type_key=body["target_type_key"],
        cardinality=body.get("cardinality", "n:m"),
        attributes_schema=body.get("attributes_schema", []),
        built_in=False,
        is_hidden=False,
        sort_order=body.get("sort_order", next_order),
    )
    db.add(rt)
    await db.commit()
    await db.refresh(rt)
    return _serialize_relation_type(rt)


@router.patch("/relation-types/{key}")
async def update_relation_type(key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")

    # Allow changing source/target only when no instances exist
    changing_endpoints = (
        ("source_type_key" in body and body["source_type_key"] != r.source_type_key)
        or ("target_type_key" in body and body["target_type_key"] != r.target_type_key)
    )
    if changing_endpoints:
        count_result = await db.execute(
            select(func.count()).select_from(Relation).where(Relation.type == key)
        )
        if (count_result.scalar() or 0) > 0:
            raise HTTPException(
                400,
                "Cannot change source/target types: relation instances exist. "
                "Delete them first.",
            )
        # Validate new types exist
        for fk in ("source_type_key", "target_type_key"):
            if fk in body:
                exists = await db.execute(
                    select(CardType.key).where(CardType.key == body[fk])
                )
                if not exists.scalar_one_or_none():
                    raise HTTPException(400, f"Type '{body[fk]}' does not exist")
        # Check for duplicate source+target
        new_src = body.get("source_type_key", r.source_type_key)
        new_tgt = body.get("target_type_key", r.target_type_key)
        dup = await db.execute(
            select(RelationType).where(
                RelationType.source_type_key == new_src,
                RelationType.target_type_key == new_tgt,
                RelationType.key != key,
                RelationType.is_hidden == False,  # noqa: E712
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                400,
                f"A relation type from '{new_src}' to '{new_tgt}' already exists.",
            )

    updatable = [
        "label", "reverse_label", "description", "cardinality",
        "attributes_schema", "sort_order", "is_hidden",
        "source_type_key", "target_type_key",
    ]
    for field in updatable:
        if field in body:
            setattr(r, field, body[field])

    await db.commit()
    await db.refresh(r)
    return _serialize_relation_type(r)


@router.get("/relation-types/{key}/instance-count")
async def get_relation_type_instance_count(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the number of relation instances using this relation type."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Relation type not found")
    count_result = await db.execute(
        select(func.count()).select_from(Relation).where(Relation.type == key)
    )
    return {"key": key, "instance_count": count_result.scalar() or 0}


@router.delete("/relation-types/{key}")
async def delete_relation_type(
    key: str,
    force: bool = Query(False, description="Force-delete even with existing instances"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")

    # Check for existing relation instances
    count_result = await db.execute(
        select(func.count()).select_from(Relation).where(Relation.type == key)
    )
    instance_count = count_result.scalar() or 0

    if instance_count > 0 and not force:
        raise HTTPException(
            409,
            detail={
                "message": f"Relation type '{key}' has {instance_count} relation instance(s). "
                "Deleting it will remove all of them.",
                "instance_count": instance_count,
                "key": key,
            },
        )

    # Delete all relation instances first
    if instance_count > 0:
        await db.execute(
            Relation.__table__.delete().where(Relation.type == key)
        )

    if r.built_in:
        # Soft-delete built-in types so they can be restored from the seed
        r.is_hidden = True
        await db.commit()
        return {"status": "hidden", "key": key, "instances_removed": instance_count}

    await db.delete(r)
    await db.commit()
    return {"status": "deleted", "key": key, "instances_removed": instance_count}


@router.post("/relation-types/{key}/restore")
async def restore_relation_type(key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Restore a soft-deleted (hidden) built-in relation type."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")
    if not r.is_hidden:
        raise HTTPException(400, "Relation type is not hidden")

    # Check for duplicate source+target before restoring
    dup = await db.execute(
        select(RelationType).where(
            RelationType.source_type_key == r.source_type_key,
            RelationType.target_type_key == r.target_type_key,
            RelationType.key != key,
            RelationType.is_hidden == False,  # noqa: E712
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(
            400,
            f"Cannot restore: a relation type from '{r.source_type_key}' to "
            f"'{r.target_type_key}' already exists.",
        )

    r.is_hidden = False
    await db.commit()
    await db.refresh(r)
    return _serialize_relation_type(r)
