from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.fact_sheet_type import FactSheetType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import FactSheetTag, Tag, TagGroup
from app.models.user import User
from app.models.web_portal import WebPortal
from app.schemas.common import WebPortalCreate, WebPortalUpdate

router = APIRouter(prefix="/web-portals", tags=["web-portals"])

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _portal_to_dict(p: WebPortal) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "slug": p.slug,
        "description": p.description,
        "fact_sheet_type": p.fact_sheet_type,
        "filters": p.filters,
        "display_fields": p.display_fields,
        "card_config": p.card_config,
        "is_published": p.is_published,
        "created_by": str(p.created_by) if p.created_by else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ── Admin CRUD (auth required) ──────────────────────────────────────────


@router.get("")
async def list_portals(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WebPortal).order_by(WebPortal.created_at.desc())
    )
    return [_portal_to_dict(p) for p in result.scalars().all()]


@router.post("", status_code=201)
async def create_portal(
    body: WebPortalCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "admin":
        raise HTTPException(403, "Only admins can create web portals")
    if not _SLUG_RE.match(body.slug):
        raise HTTPException(
            400,
            "Slug must contain only lowercase letters, numbers, and hyphens",
        )
    # Check slug uniqueness
    existing = await db.execute(
        select(WebPortal).where(WebPortal.slug == body.slug)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "A portal with this slug already exists")
    # Validate fact sheet type exists
    fst = await db.execute(
        select(FactSheetType).where(FactSheetType.key == body.fact_sheet_type)
    )
    if not fst.scalar_one_or_none():
        raise HTTPException(400, f"Fact sheet type '{body.fact_sheet_type}' not found")

    portal = WebPortal(
        name=body.name,
        slug=body.slug,
        description=body.description,
        fact_sheet_type=body.fact_sheet_type,
        filters=body.filters,
        display_fields=body.display_fields,
        card_config=body.card_config,
        is_published=body.is_published,
        created_by=user.id,
    )
    db.add(portal)
    await db.commit()
    await db.refresh(portal)
    return _portal_to_dict(portal)


@router.get("/{portal_id}")
async def get_portal(
    portal_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WebPortal).where(WebPortal.id == uuid.UUID(portal_id))
    )
    portal = result.scalar_one_or_none()
    if not portal:
        raise HTTPException(404, "Portal not found")
    return _portal_to_dict(portal)


@router.patch("/{portal_id}")
async def update_portal(
    portal_id: str,
    body: WebPortalUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "admin":
        raise HTTPException(403, "Only admins can update web portals")
    result = await db.execute(
        select(WebPortal).where(WebPortal.id == uuid.UUID(portal_id))
    )
    portal = result.scalar_one_or_none()
    if not portal:
        raise HTTPException(404, "Portal not found")

    updates = body.model_dump(exclude_unset=True)

    if "slug" in updates:
        if not _SLUG_RE.match(updates["slug"]):
            raise HTTPException(
                400,
                "Slug must contain only lowercase letters, numbers, and hyphens",
            )
        dup = await db.execute(
            select(WebPortal).where(
                WebPortal.slug == updates["slug"],
                WebPortal.id != portal.id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(400, "A portal with this slug already exists")

    for field, value in updates.items():
        setattr(portal, field, value)

    await db.commit()
    await db.refresh(portal)
    return _portal_to_dict(portal)


@router.delete("/{portal_id}", status_code=204)
async def delete_portal(
    portal_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "admin":
        raise HTTPException(403, "Only admins can delete web portals")
    result = await db.execute(
        select(WebPortal).where(WebPortal.id == uuid.UUID(portal_id))
    )
    portal = result.scalar_one_or_none()
    if not portal:
        raise HTTPException(404, "Portal not found")
    await db.delete(portal)
    await db.commit()


# ── Public endpoints (no auth) ──────────────────────────────────────────


@router.get("/public/{slug}")
async def get_public_portal(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebPortal).where(WebPortal.slug == slug, WebPortal.is_published == True)  # noqa: E712
    )
    portal = result.scalar_one_or_none()
    if not portal:
        raise HTTPException(404, "Portal not found")

    # Also return the type metadata so frontend can render properly
    fst_result = await db.execute(
        select(FactSheetType).where(FactSheetType.key == portal.fact_sheet_type)
    )
    fst = fst_result.scalar_one_or_none()

    type_info = None
    if fst:
        type_info = {
            "key": fst.key,
            "label": fst.label,
            "icon": fst.icon,
            "color": fst.color,
            "fields_schema": fst.fields_schema,
            "subtypes": fst.subtypes,
        }

    # Fetch available relation types for this fact sheet type (for filter options)
    rel_types_result = await db.execute(
        select(RelationType).where(
            or_(
                RelationType.source_type_key == portal.fact_sheet_type,
                RelationType.target_type_key == portal.fact_sheet_type,
            ),
            RelationType.is_hidden == False,  # noqa: E712
        )
    )
    rel_types = [
        {
            "key": rt.key,
            "label": rt.label,
            "reverse_label": rt.reverse_label,
            "source_type_key": rt.source_type_key,
            "target_type_key": rt.target_type_key,
        }
        for rt in rel_types_result.scalars().all()
    ]

    # Fetch available tag groups
    tag_groups_result = await db.execute(
        select(TagGroup).order_by(TagGroup.name)
    )
    tag_groups = []
    for tg in tag_groups_result.scalars().all():
        tags_result = await db.execute(
            select(Tag).where(Tag.tag_group_id == tg.id).order_by(Tag.name)
        )
        tag_groups.append({
            "id": str(tg.id),
            "name": tg.name,
            "tags": [
                {"id": str(t.id), "name": t.name, "color": t.color}
                for t in tags_result.scalars().all()
            ],
        })

    return {
        "id": str(portal.id),
        "name": portal.name,
        "slug": portal.slug,
        "description": portal.description,
        "fact_sheet_type": portal.fact_sheet_type,
        "filters": portal.filters,
        "display_fields": portal.display_fields,
        "card_config": portal.card_config,
        "type_info": type_info,
        "relation_types": rel_types,
        "tag_groups": tag_groups,
    }


@router.get("/public/{slug}/fact-sheets")
async def get_public_portal_fact_sheets(
    slug: str,
    search: str | None = Query(None),
    subtype: str | None = Query(None),
    tag_ids: str | None = Query(None),
    related_type: str | None = Query(None),
    related_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: returns fact sheets for a published portal with optional filtering."""
    result = await db.execute(
        select(WebPortal).where(WebPortal.slug == slug, WebPortal.is_published == True)  # noqa: E712
    )
    portal = result.scalar_one_or_none()
    if not portal:
        raise HTTPException(404, "Portal not found")

    q = select(FactSheet).where(
        FactSheet.type == portal.fact_sheet_type,
        FactSheet.status == "ACTIVE",
    )
    count_q = select(func.count(FactSheet.id)).where(
        FactSheet.type == portal.fact_sheet_type,
        FactSheet.status == "ACTIVE",
    )

    # Apply portal-level preset filters
    portal_filters = portal.filters or {}
    if portal_filters.get("subtypes"):
        q = q.where(FactSheet.subtype.in_(portal_filters["subtypes"]))
        count_q = count_q.where(FactSheet.subtype.in_(portal_filters["subtypes"]))
    if portal_filters.get("quality_seals"):
        q = q.where(FactSheet.quality_seal.in_(portal_filters["quality_seals"]))
        count_q = count_q.where(FactSheet.quality_seal.in_(portal_filters["quality_seals"]))

    # Apply user-supplied search
    if search:
        like = f"%{search}%"
        q = q.where(
            or_(FactSheet.name.ilike(like), FactSheet.description.ilike(like))
        )
        count_q = count_q.where(
            or_(FactSheet.name.ilike(like), FactSheet.description.ilike(like))
        )

    # Filter by subtype (user)
    if subtype:
        q = q.where(FactSheet.subtype == subtype)
        count_q = count_q.where(FactSheet.subtype == subtype)

    # Filter by tags
    if tag_ids:
        ids = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if ids:
            tag_uuids = [uuid.UUID(tid) for tid in ids]
            tagged_fs = select(FactSheetTag.fact_sheet_id).where(
                FactSheetTag.tag_id.in_(tag_uuids)
            )
            q = q.where(FactSheet.id.in_(tagged_fs))
            count_q = count_q.where(FactSheet.id.in_(tagged_fs))

    # Filter by relationship to a specific fact sheet
    if related_type and related_id:
        rid = uuid.UUID(related_id)
        related_fs = select(Relation.target_id).where(
            Relation.type == related_type,
            Relation.source_id == rid,
        ).union(
            select(Relation.source_id).where(
                Relation.type == related_type,
                Relation.target_id == rid,
            )
        )
        q = q.where(FactSheet.id.in_(related_fs))
        count_q = count_q.where(FactSheet.id.in_(related_fs))

    # Sorting
    sort_col = getattr(FactSheet, sort_by, FactSheet.name)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    fs_result = await db.execute(q)
    fact_sheets = fs_result.scalars().all()

    # Collect tag data for the result fact sheets
    fs_ids = [fs.id for fs in fact_sheets]
    tags_map: dict[str, list] = {}
    if fs_ids:
        tag_rows = await db.execute(
            select(
                FactSheetTag.fact_sheet_id,
                Tag.id,
                Tag.name,
                Tag.color,
                TagGroup.name.label("group_name"),
            )
            .join(Tag, Tag.id == FactSheetTag.tag_id)
            .join(TagGroup, TagGroup.id == Tag.tag_group_id)
            .where(FactSheetTag.fact_sheet_id.in_(fs_ids))
        )
        for row in tag_rows.all():
            fsid = str(row[0])
            tags_map.setdefault(fsid, []).append({
                "id": str(row[1]),
                "name": row[2],
                "color": row[3],
                "group_name": row[4],
            })

    # Collect relations for the result fact sheets (to show related items)
    relations_map: dict[str, list] = {}
    if fs_ids:
        # Source relations
        src_rows = await db.execute(
            select(
                Relation.source_id,
                Relation.type,
                Relation.target_id,
                FactSheet.name.label("target_name"),
                FactSheet.type.label("target_type"),
            )
            .join(FactSheet, FactSheet.id == Relation.target_id)
            .where(Relation.source_id.in_(fs_ids))
        )
        for row in src_rows.all():
            fsid = str(row[0])
            relations_map.setdefault(fsid, []).append({
                "type": row[1],
                "related_id": str(row[2]),
                "related_name": row[3],
                "related_type": row[4],
                "direction": "outgoing",
            })
        # Target relations
        tgt_rows = await db.execute(
            select(
                Relation.target_id,
                Relation.type,
                Relation.source_id,
                FactSheet.name.label("source_name"),
                FactSheet.type.label("source_type"),
            )
            .join(FactSheet, FactSheet.id == Relation.source_id)
            .where(Relation.target_id.in_(fs_ids))
        )
        for row in tgt_rows.all():
            fsid = str(row[0])
            relations_map.setdefault(fsid, []).append({
                "type": row[1],
                "related_id": str(row[2]),
                "related_name": row[3],
                "related_type": row[4],
                "direction": "incoming",
            })

    items = []
    for fs in fact_sheets:
        fsid = str(fs.id)
        items.append({
            "id": fsid,
            "name": fs.name,
            "type": fs.type,
            "subtype": fs.subtype,
            "description": fs.description,
            "lifecycle": fs.lifecycle,
            "attributes": fs.attributes,
            "quality_seal": fs.quality_seal,
            "completion": fs.completion,
            "tags": tags_map.get(fsid, []),
            "relations": relations_map.get(fsid, []),
            "updated_at": fs.updated_at.isoformat() if fs.updated_at else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }
