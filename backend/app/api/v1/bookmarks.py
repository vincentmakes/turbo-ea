from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.bookmark import Bookmark, bookmark_shares
from app.models.card import Card
from app.models.card_type import CardType
from app.models.user import User
from app.schemas.common import BookmarkCreate, BookmarkUpdate
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])

VALID_VISIBILITY = {"private", "public", "shared"}


async def _load_bookmark(db: AsyncSession, bookmark_id: uuid.UUID) -> Bookmark | None:
    result = await db.execute(
        select(Bookmark)
        .options(selectinload(Bookmark.shared_with_users))
        .where(Bookmark.id == bookmark_id)
    )
    bm = result.scalar_one_or_none()
    if bm:
        owner_result = await db.execute(select(User).where(User.id == bm.user_id))
        bm._owner = owner_result.scalar_one_or_none()  # type: ignore[attr-defined]
    return bm


async def _get_share_permissions(db: AsyncSession, bookmark_id: uuid.UUID) -> dict[uuid.UUID, bool]:
    """Return {user_id: can_edit} for all shares of a bookmark."""
    result = await db.execute(
        select(bookmark_shares.c.user_id, bookmark_shares.c.can_edit).where(
            bookmark_shares.c.bookmark_id == bookmark_id
        )
    )
    return {row.user_id: row.can_edit for row in result.all()}


def _serialize(
    bm: Bookmark,
    current_user_id: uuid.UUID,
    share_perms: dict | None = None,
    base_url: str = "",
) -> dict:
    is_owner = bm.user_id == current_user_id
    owner = getattr(bm, "_owner", None)

    # Build shared_with list with can_edit flag
    shared_with_list = []
    if bm.shared_with_users:
        perms = share_perms or {}
        for u in bm.shared_with_users:
            shared_with_list.append(
                {
                    "user_id": str(u.id),
                    "display_name": u.display_name,
                    "email": u.email,
                    "can_edit": perms.get(u.id, False),
                }
            )

    # Determine can_edit for the current user
    if is_owner:
        can_edit = True
    elif share_perms and current_user_id in share_perms:
        can_edit = share_perms[current_user_id]
    else:
        can_edit = False

    result = {
        "id": str(bm.id),
        "name": bm.name,
        "card_type": bm.card_type,
        "filters": bm.filters,
        "columns": bm.columns,
        "sort": bm.sort,
        "is_default": bm.is_default,
        "visibility": bm.visibility or "private",
        "odata_enabled": bm.odata_enabled or False,
        "owner_id": str(bm.user_id),
        "owner_name": owner.display_name if owner else None,
        "is_owner": is_owner,
        "can_edit": can_edit,
        "shared_with": shared_with_list,
        "created_at": bm.created_at.isoformat() if bm.created_at else None,
    }

    if bm.odata_enabled and base_url:
        result["odata_url"] = f"{base_url}/api/v1/bookmarks/{bm.id}/odata"
    else:
        result["odata_url"] = None

    return result


async def _sync_shares(
    db: AsyncSession,
    bm: Bookmark,
    shared_with: list | None,
) -> None:
    """Sync bookmark_shares junction table with can_edit flag.

    Accepts list of BookmarkShareEntry objects or dicts with
    user_id / can_edit keys.
    """
    # Clear existing shares
    await db.execute(bookmark_shares.delete().where(bookmark_shares.c.bookmark_id == bm.id))

    if not shared_with or bm.visibility != "shared":
        return

    user_ids: list[uuid.UUID] = []
    can_edit_map: dict[uuid.UUID, bool] = {}
    for entry in shared_with:
        try:
            if isinstance(entry, dict):
                uid = uuid.UUID(entry["user_id"])
                can_edit_map[uid] = entry.get("can_edit", False)
            else:
                uid = uuid.UUID(entry.user_id)
                can_edit_map[uid] = entry.can_edit
            user_ids.append(uid)
        except (ValueError, AttributeError, KeyError):
            continue

    if not user_ids:
        return

    # Verify users exist
    user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    valid_users = list(user_result.scalars().all())

    # Insert share rows with can_edit
    for u in valid_users:
        await db.execute(
            bookmark_shares.insert().values(
                bookmark_id=bm.id,
                user_id=u.id,
                can_edit=can_edit_map.get(u.id, False),
            )
        )


@router.get("")
async def list_bookmarks(
    request: Request,
    filter: str = Query("all", pattern="^(all|my|shared|public)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bookmarks.manage")

    base = select(Bookmark).options(selectinload(Bookmark.shared_with_users))

    if filter == "my":
        stmt = base.where(Bookmark.user_id == user.id)
    elif filter == "public":
        stmt = base.where(Bookmark.visibility == "public")
    elif filter == "shared":
        stmt = base.where(
            Bookmark.id.in_(
                select(bookmark_shares.c.bookmark_id).where(bookmark_shares.c.user_id == user.id)
            )
        )
    else:
        # "all" — own + shared with me + public
        stmt = base.where(
            or_(
                Bookmark.user_id == user.id,
                Bookmark.visibility == "public",
                Bookmark.id.in_(
                    select(bookmark_shares.c.bookmark_id).where(
                        bookmark_shares.c.user_id == user.id
                    )
                ),
            )
        )

    stmt = stmt.order_by(Bookmark.created_at.desc())
    result = await db.execute(stmt)
    bookmarks = result.scalars().unique().all()

    # Load owners
    owner_ids = {b.user_id for b in bookmarks}
    owners: dict[uuid.UUID, User] = {}
    if owner_ids:
        owner_result = await db.execute(select(User).where(User.id.in_(owner_ids)))
        for u in owner_result.scalars().all():
            owners[u.id] = u
    for b in bookmarks:
        b._owner = owners.get(b.user_id)  # type: ignore[attr-defined]

    # Load share permissions for all bookmarks
    bm_ids = [b.id for b in bookmarks]
    all_perms: dict[uuid.UUID, dict[uuid.UUID, bool]] = {}
    if bm_ids:
        perm_result = await db.execute(
            select(
                bookmark_shares.c.bookmark_id,
                bookmark_shares.c.user_id,
                bookmark_shares.c.can_edit,
            ).where(bookmark_shares.c.bookmark_id.in_(bm_ids))
        )
        for row in perm_result.all():
            all_perms.setdefault(row.bookmark_id, {})[row.user_id] = row.can_edit

    base_url = str(request.base_url).rstrip("/")
    return [_serialize(b, user.id, all_perms.get(b.id, {}), base_url) for b in bookmarks]


@router.post("", status_code=201)
async def create_bookmark(
    body: BookmarkCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bookmarks.manage")

    if body.visibility not in VALID_VISIBILITY:
        raise HTTPException(400, "visibility must be private, public, or shared")

    # Check sharing permission
    if body.visibility in ("public", "shared"):
        await PermissionService.require_permission(
            db,
            user,
            "bookmarks.share",
        )

    # Check OData permission
    if body.odata_enabled:
        await PermissionService.require_permission(
            db,
            user,
            "bookmarks.odata",
        )

    bm = Bookmark(
        user_id=user.id,
        name=body.name,
        card_type=body.card_type,
        filters=body.filters,
        columns=body.columns,
        sort=body.sort,
        is_default=body.is_default,
        visibility=body.visibility,
        odata_enabled=body.odata_enabled,
    )
    db.add(bm)
    await db.flush()

    # Handle sharing
    await _sync_shares(db, bm, body.shared_with)

    await db.commit()

    # Reload cleanly
    fresh = await _load_bookmark(db, bm.id)
    perms = await _get_share_permissions(db, bm.id)
    base_url = str(request.base_url).rstrip("/")
    return _serialize(fresh, user.id, perms, base_url)  # type: ignore[arg-type]


@router.patch("/{bm_id}")
async def update_bookmark(
    bm_id: str,
    body: BookmarkUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bookmarks.manage")

    bid = uuid.UUID(bm_id)
    result = await db.execute(
        select(Bookmark).options(selectinload(Bookmark.shared_with_users)).where(Bookmark.id == bid)
    )
    bm = result.scalar_one_or_none()
    if not bm:
        raise HTTPException(404, "Bookmark not found")

    is_owner = bm.user_id == user.id

    # Check access: owner or shared-with-can_edit
    if not is_owner:
        perms = await _get_share_permissions(db, bid)
        if user.id not in perms or not perms[user.id]:
            raise HTTPException(403, "You don't have permission to edit this view")

    data = body.model_dump(exclude_unset=True)

    # Only owner can change visibility, sharing, and odata settings
    if not is_owner:
        for restricted in ("visibility", "shared_with", "odata_enabled"):
            if restricted in data:
                raise HTTPException(
                    403,
                    "Only the owner can change visibility, sharing, or OData settings",
                )

    if "visibility" in data and data["visibility"] not in VALID_VISIBILITY:
        raise HTTPException(400, "visibility must be private, public, or shared")

    # Check sharing permission when changing to public/shared
    new_vis = data.get("visibility", bm.visibility)
    if new_vis in ("public", "shared"):
        await PermissionService.require_permission(
            db,
            user,
            "bookmarks.share",
        )

    # Check OData permission when enabling
    new_odata = data.get("odata_enabled", bm.odata_enabled)
    if new_odata:
        await PermissionService.require_permission(
            db,
            user,
            "bookmarks.odata",
        )

    shared_with = data.pop("shared_with", None)

    for field, value in data.items():
        setattr(bm, field, value)

    # Sync shares if provided (owner only, already guarded above)
    if shared_with is not None:
        await _sync_shares(db, bm, shared_with)

    await db.commit()

    fresh = await _load_bookmark(db, bid)
    perms = await _get_share_permissions(db, bid)
    base_url = str(request.base_url).rstrip("/")
    return _serialize(fresh, user.id, perms, base_url)  # type: ignore[arg-type]


@router.delete("/{bm_id}", status_code=204)
async def delete_bookmark(
    bm_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bookmarks.manage")
    result = await db.execute(select(Bookmark).where(Bookmark.id == uuid.UUID(bm_id)))
    bm = result.scalar_one_or_none()
    if not bm:
        raise HTTPException(404, "Bookmark not found")
    # Only owner can delete
    if bm.user_id != user.id:
        raise HTTPException(403, "Only the owner can delete this view")
    await db.delete(bm)
    await db.commit()


@router.get("/{bm_id}/odata")
async def bookmark_odata_feed(
    bm_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(1000, ge=1, le=10000),
):
    """OData-style JSON feed for a bookmark's filtered cards.
    Requires authentication. Returns data matching the bookmark's saved filters."""
    await PermissionService.require_permission(db, user, "inventory.view")

    bid = uuid.UUID(bm_id)
    result = await db.execute(
        select(Bookmark).options(selectinload(Bookmark.shared_with_users)).where(Bookmark.id == bid)
    )
    bm = result.scalar_one_or_none()
    if not bm:
        raise HTTPException(404, "Bookmark not found")

    if not bm.odata_enabled:
        raise HTTPException(403, "OData feed is not enabled for this view")

    # Access check: owner, public, or shared with user
    is_owner = bm.user_id == user.id
    is_public = bm.visibility == "public"
    is_shared = any(u.id == user.id for u in (bm.shared_with_users or []))
    if not (is_owner or is_public or is_shared):
        raise HTTPException(403, "Access denied")

    # Build query from bookmark filters
    from sqlalchemy import func

    q = select(Card)
    filters = bm.filters or {}

    # Exclude hidden types
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    q = q.where(Card.type.not_in(hidden_types_sq))

    # Type filter
    bm_types = filters.get("types", [])
    if bm_types:
        q = q.where(Card.type.in_(bm_types))

    # Status filter
    show_archived = filters.get("showArchived", False)
    if show_archived:
        q = q.where(Card.status == "ARCHIVED")
    else:
        q = q.where(Card.status == "ACTIVE")

    # Search
    search = filters.get("search", "")
    if search:
        like = f"%{search}%"
        q = q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))

    # Approval statuses
    approval_statuses = filters.get("approvalStatuses", [])
    if approval_statuses:
        q = q.where(Card.approval_status.in_(approval_statuses))

    # Subtypes
    subtypes = filters.get("subtypes", [])
    if subtypes:
        q = q.where(Card.subtype.in_(subtypes))

    # Data quality min
    dq_min = filters.get("dataQualityMin")
    if dq_min is not None:
        q = q.where(Card.data_quality >= dq_min)

    # Sorting from bookmark
    sort_config = bm.sort or {}
    sort_field = sort_config.get("field", "name")
    sort_dir = sort_config.get("direction", "asc")
    sort_col = getattr(Card, sort_field, Card.name)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())

    # Pagination
    count_q = select(func.count()).select_from(q.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    cards = result.scalars().all()

    # Build OData-style response
    values = []
    for card in cards:
        entry: dict = {
            "id": str(card.id),
            "type": card.type,
            "subtype": card.subtype,
            "name": card.name,
            "description": card.description,
            "status": card.status,
            "approval_status": card.approval_status,
            "data_quality": card.data_quality,
            "lifecycle": card.lifecycle,
            "attributes": card.attributes,
            "external_id": card.external_id,
            "alias": card.alias,
            "created_at": card.created_at.isoformat() if card.created_at else None,
            "updated_at": card.updated_at.isoformat() if card.updated_at else None,
        }
        values.append(entry)

    return {
        "@odata.context": f"/api/v1/bookmarks/{bm_id}/odata",
        "@odata.count": total,
        "value": values,
        "@odata.nextLink": f"/api/v1/bookmarks/{bm_id}/odata?page={page + 1}&page_size={page_size}"
        if (page * page_size) < total
        else None,
    }
