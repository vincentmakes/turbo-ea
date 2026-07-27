"""Repository-wide Resource management.

Card resources — uploaded file attachments (``file_attachments``, binary
blobs) and document links (``documents``, URLs) — are created and managed
per card from the card's Resources tab. This module adds the missing
repository-wide view: one searchable, filterable list across every card,
plus a storage/usage rollup and a mixed-kind bulk delete. It backs the
**Admin → Settings → Resources** tab.

Design notes
------------

*The list is a UNION over two tables.* Both branches are built from
**column-level** selects, never ``select(FileAttachment)`` — the entity
select would pull ``file_attachments.data`` (a ``LargeBinary``) into
memory for every row. Omitting the column keeps Postgres from
de-TOASTing the payload at all, so a page of 10 MB PDFs costs the same as
a page of links.

*Placeholders are cast.* A bare bind parameter in a ``UNION`` SELECT list
makes Postgres raise ``could not determine data type of parameter``, so
every literal / NULL placeholder is wrapped in ``cast()``.

*Ordering carries an id tie-break.* ``created_at`` collides routinely
(bulk import, workspace transfer); without a deterministic secondary sort
rows would duplicate or vanish across pages.

*Permissions mirror the per-card routes exactly.* Reading requires the
app-level ``documents.view`` — the same permission that already lets a
caller enumerate any card's resources via
``GET /cards/{id}/file-attachments``, so this endpoint grants no new
authority. Deleting requires ``documents.manage`` **or** the card-level
``card.manage_documents``, identical to the single-row DELETE endpoints.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Integer, Select, String, Text, cast, func, literal, null, or_, select
from sqlalchemy import union_all as sa_union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.document import Document
from app.models.file_attachment import FileAttachment
from app.models.user import User
from app.schemas.resource import (
    ResourceBucket,
    ResourceBulkDelete,
    ResourceBulkDeleteResult,
    ResourceCardTypeBucket,
    ResourceLargestFile,
    ResourceListPage,
    ResourceOut,
    ResourceSkipped,
    ResourceStats,
)
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/resources", tags=["resources"])

# Sort keys the caller may pass, matched against the union subquery's
# columns. Anything else silently falls back to the default rather than
# 500ing — and, critically, an unvalidated value must never reach
# ``getattr`` on a column collection (H9, mirrors ``cards.py``).
_SORTABLE = frozenset(
    {"created_at", "name", "size", "card_name", "card_type", "kind", "category", "mime_type"}
)
_DEFAULT_SORT = "created_at"

# Guard rails on the bulk path. The Pydantic model caps ``refs`` at 500;
# this constant documents the same number for the docstring/tests.
MAX_BULK_REFS = 500

_LARGEST_FILES_LIMIT = 10


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------


@dataclass
class _Filters:
    """Parsed query filters, shared by the list and stats endpoints so the
    two can never drift apart."""

    search: str | None = None
    kinds: set[str] = field(default_factory=set)
    card_id: uuid.UUID | None = None
    card_types: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    mime_types: list[str] = field(default_factory=list)
    created_by: uuid.UUID | None = None
    since: datetime | None = None
    until: datetime | None = None
    archived: str = "any"

    @property
    def want_files(self) -> bool:
        return not self.kinds or "file" in self.kinds

    @property
    def want_links(self) -> bool:
        # A MIME-type filter can only ever match a file, so the link
        # branch is dropped wholesale rather than evaluated and discarded.
        return (not self.kinds or "link" in self.kinds) and not self.mime_types


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so a search for ``100%`` doesn't match
    everything. Paired with ``escape="\\"`` on the ``ilike()`` call."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _parse_filters(
    search: str | None,
    kind: list[str] | None,
    card_id: uuid.UUID | None,
    card_type: list[str] | None,
    category: list[str] | None,
    mime_type: list[str] | None,
    created_by: uuid.UUID | None,
    since: datetime | None,
    until: datetime | None,
    archived: str,
) -> _Filters:
    return _Filters(
        search=(search or "").strip() or None,
        kinds={k for k in (kind or []) if k in {"file", "link"}},
        card_id=card_id,
        card_types=[c for c in (card_type or []) if c],
        categories=[c for c in (category or []) if c],
        mime_types=[m for m in (mime_type or []) if m],
        created_by=created_by,
        since=since,
        until=until,
        archived=archived,
    )


def _apply_card_filters(stmt: Select, f: _Filters) -> Select:
    """Filters that live on the joined ``cards`` row — identical for both
    branches."""
    if f.card_id:
        stmt = stmt.where(Card.id == f.card_id)
    if f.card_types:
        stmt = stmt.where(Card.type.in_(f.card_types))
    if f.archived == "active":
        stmt = stmt.where(Card.archived_at.is_(None))
    elif f.archived == "archived":
        stmt = stmt.where(Card.archived_at.isnot(None))
    return stmt


def _apply_file_filters(stmt: Select, f: _Filters) -> Select:
    stmt = _apply_card_filters(stmt, f)
    if f.categories:
        stmt = stmt.where(FileAttachment.category.in_(f.categories))
    if f.mime_types:
        stmt = stmt.where(FileAttachment.mime_type.in_(f.mime_types))
    if f.created_by:
        stmt = stmt.where(FileAttachment.created_by == f.created_by)
    if f.since:
        stmt = stmt.where(FileAttachment.created_at >= f.since)
    if f.until:
        stmt = stmt.where(FileAttachment.created_at <= f.until)
    if f.search:
        like = _escape_like(f.search)
        stmt = stmt.where(
            or_(
                FileAttachment.name.ilike(like, escape="\\"),
                Card.name.ilike(like, escape="\\"),
            )
        )
    return stmt


def _apply_link_filters(stmt: Select, f: _Filters) -> Select:
    stmt = _apply_card_filters(stmt, f)
    if f.categories:
        stmt = stmt.where(Document.type.in_(f.categories))
    if f.created_by:
        stmt = stmt.where(Document.created_by == f.created_by)
    if f.since:
        stmt = stmt.where(Document.created_at >= f.since)
    if f.until:
        stmt = stmt.where(Document.created_at <= f.until)
    if f.search:
        like = _escape_like(f.search)
        stmt = stmt.where(
            or_(
                Document.name.ilike(like, escape="\\"),
                Document.url.ilike(like, escape="\\"),
                Card.name.ilike(like, escape="\\"),
            )
        )
    return stmt


# ---------------------------------------------------------------------------
# Union branches
# ---------------------------------------------------------------------------


def _file_branch() -> Select:
    """Column-level select over ``file_attachments``.

    ``FileAttachment.data`` is deliberately absent — see the module
    docstring. ``size`` is a plain integer column, so byte totals never
    need the blob.
    """
    return select(
        FileAttachment.id.label("id"),
        cast(literal("file"), String(10)).label("kind"),
        FileAttachment.card_id.label("card_id"),
        Card.name.label("card_name"),
        Card.type.label("card_type"),
        Card.archived_at.isnot(None).label("card_archived"),
        FileAttachment.name.label("name"),
        FileAttachment.category.label("category"),
        FileAttachment.mime_type.label("mime_type"),
        FileAttachment.size.label("size"),
        cast(null(), Text).label("url"),
        FileAttachment.created_by.label("created_by"),
        FileAttachment.created_at.label("created_at"),
    ).join(Card, Card.id == FileAttachment.card_id)


def _link_branch() -> Select:
    """Column-level select over ``documents``. A link's ``type`` shares
    the ``category`` slot so both kinds filter through one param."""
    return select(
        Document.id.label("id"),
        cast(literal("link"), String(10)).label("kind"),
        Document.card_id.label("card_id"),
        Card.name.label("card_name"),
        Card.type.label("card_type"),
        Card.archived_at.isnot(None).label("card_archived"),
        Document.name.label("name"),
        Document.type.label("category"),
        cast(null(), String(200)).label("mime_type"),
        cast(null(), Integer).label("size"),
        Document.url.label("url"),
        Document.created_by.label("created_by"),
        Document.created_at.label("created_at"),
    ).join(Card, Card.id == Document.card_id)


def _branches(f: _Filters) -> list[Select]:
    out: list[Select] = []
    if f.want_files:
        out.append(_apply_file_filters(_file_branch(), f))
    if f.want_links:
        out.append(_apply_link_filters(_link_branch(), f))
    return out


async def _creator_names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Batch-resolve display names — one query, never N+1."""
    if not ids:
        return {}
    result = await db.execute(select(User.id, User.display_name).where(User.id.in_(ids)))
    return {row.id: row.display_name for row in result}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ResourceListPage)
async def list_resources(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: str | None = Query(None, max_length=200),
    kind: list[str] | None = Query(None, description='Repeatable: "file" and/or "link"'),
    card_id: uuid.UUID | None = Query(None),
    card_type: list[str] | None = Query(None, description="Repeatable card-type keys"),
    category: list[str] | None = Query(
        None, description="Repeatable file-category / link-type keys"
    ),
    mime_type: list[str] | None = Query(None, description="Repeatable, files only"),
    created_by: uuid.UUID | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    archived: str = Query("any", pattern="^(any|active|archived)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query(_DEFAULT_SORT),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
) -> ResourceListPage:
    """Every file attachment and document link in the repository, paginated.

    Returns the ``{items, total, page, page_size}`` envelope used by the
    other paginated read endpoints. Binary payloads are never included —
    fetch a file from ``GET /file-attachments/{id}/download``.
    """
    await PermissionService.require_permission(db, user, "documents.view")

    f = _parse_filters(
        search, kind, card_id, card_type, category, mime_type, created_by, since, until, archived
    )
    branches = _branches(f)
    if not branches:
        return ResourceListPage(items=[], total=0, page=page, page_size=page_size)

    sub = (
        branches[0].subquery("resources")
        if len(branches) == 1
        else sa_union_all(*branches).subquery("resources")
    )

    total = int((await db.execute(select(func.count()).select_from(sub))).scalar_one() or 0)

    col = sub.c[sort_by if sort_by in _SORTABLE else _DEFAULT_SORT]
    ordering = col.desc() if sort_dir == "desc" else col.asc()
    rows = (
        (
            await db.execute(
                select(sub)
                # nulls_last keeps links (null size / mime) out of the way
                # when sorting on a file-only column; the id tie-break makes
                # pagination stable when created_at collides.
                .order_by(ordering.nulls_last(), sub.c.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .mappings()
        .all()
    )

    names = await _creator_names(db, {r["created_by"] for r in rows if r["created_by"]})

    return ResourceListPage(
        items=[
            ResourceOut(
                id=r["id"],
                kind=r["kind"],
                card_id=r["card_id"],
                card_name=r["card_name"],
                card_type=r["card_type"],
                card_archived=bool(r["card_archived"]),
                name=r["name"],
                category=r["category"],
                mime_type=r["mime_type"],
                size=r["size"],
                url=r["url"],
                created_by=r["created_by"],
                creator_name=names.get(r["created_by"]) if r["created_by"] else None,
                created_at=r["created_at"],
            )
            for r in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/stats", response_model=ResourceStats)
async def resource_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: str | None = Query(None, max_length=200),
    kind: list[str] | None = Query(None),
    card_id: uuid.UUID | None = Query(None),
    card_type: list[str] | None = Query(None),
    category: list[str] | None = Query(None),
    mime_type: list[str] | None = Query(None),
    created_by: uuid.UUID | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    archived: str = Query("any", pattern="^(any|active|archived)$"),
) -> ResourceStats:
    """Storage and usage rollup over the *same* filter set as the list, so
    the KPI tiles always describe what the admin is looking at (the
    pattern ``GET /risks/metrics`` uses for the Risk Register)."""
    await PermissionService.require_permission(db, user, "documents.view")

    f = _parse_filters(
        search, kind, card_id, card_type, category, mime_type, created_by, since, until, archived
    )

    stats = ResourceStats()
    card_ids: set[uuid.UUID] = set()

    if f.want_files:
        totals = (
            await db.execute(
                _apply_file_filters(
                    select(
                        func.count(FileAttachment.id),
                        func.coalesce(func.sum(FileAttachment.size), 0),
                    ).join(Card, Card.id == FileAttachment.card_id),
                    f,
                )
            )
        ).one()
        stats.file_count = int(totals[0] or 0)
        stats.total_bytes = int(totals[1] or 0)

        by_cat = await db.execute(
            _apply_file_filters(
                select(
                    FileAttachment.category,
                    func.count(FileAttachment.id),
                    func.coalesce(func.sum(FileAttachment.size), 0),
                ).join(Card, Card.id == FileAttachment.card_id),
                f,
            ).group_by(FileAttachment.category)
        )
        stats.by_category = [
            ResourceBucket(key=row[0], count=int(row[1] or 0), bytes=int(row[2] or 0))
            for row in by_cat
        ]

        by_type = await db.execute(
            _apply_file_filters(
                select(
                    Card.type,
                    func.count(FileAttachment.id),
                    func.coalesce(func.sum(FileAttachment.size), 0),
                ).join(Card, Card.id == FileAttachment.card_id),
                f,
            ).group_by(Card.type)
        )
        by_card_type: dict[str, ResourceCardTypeBucket] = {}
        for row in by_type:
            by_card_type[row[0]] = ResourceCardTypeBucket(
                key=row[0], file_count=int(row[1] or 0), bytes=int(row[2] or 0)
            )

        largest = await db.execute(
            _apply_file_filters(
                select(
                    FileAttachment.id,
                    FileAttachment.name,
                    FileAttachment.size,
                    FileAttachment.card_id,
                    Card.name,
                ).join(Card, Card.id == FileAttachment.card_id),
                f,
            )
            .order_by(FileAttachment.size.desc())
            .limit(_LARGEST_FILES_LIMIT)
        )
        stats.largest_files = [
            ResourceLargestFile(
                id=row[0], name=row[1], size=int(row[2] or 0), card_id=row[3], card_name=row[4]
            )
            for row in largest
        ]

        cards_q = await db.execute(
            _apply_file_filters(
                select(FileAttachment.card_id).join(Card, Card.id == FileAttachment.card_id), f
            ).distinct()
        )
        card_ids.update(row[0] for row in cards_q)
    else:
        by_card_type = {}

    if f.want_links:
        link_total = (
            await db.execute(
                _apply_link_filters(
                    select(func.count(Document.id)).join(Card, Card.id == Document.card_id), f
                )
            )
        ).scalar_one()
        stats.link_count = int(link_total or 0)

        by_link = await db.execute(
            _apply_link_filters(
                select(Document.type, func.count(Document.id)).join(
                    Card, Card.id == Document.card_id
                ),
                f,
            ).group_by(Document.type)
        )
        stats.by_link_type = [
            ResourceBucket(key=row[0], count=int(row[1] or 0), bytes=0) for row in by_link
        ]

        by_type = await db.execute(
            _apply_link_filters(
                select(Card.type, func.count(Document.id)).join(Card, Card.id == Document.card_id),
                f,
            ).group_by(Card.type)
        )
        for row in by_type:
            bucket = by_card_type.get(row[0])
            if bucket is None:
                bucket = ResourceCardTypeBucket(key=row[0])
                by_card_type[row[0]] = bucket
            bucket.link_count = int(row[1] or 0)

        cards_q = await db.execute(
            _apply_link_filters(
                select(Document.card_id).join(Card, Card.id == Document.card_id), f
            ).distinct()
        )
        card_ids.update(row[0] for row in cards_q)

    stats.by_card_type = sorted(by_card_type.values(), key=lambda b: b.key)
    stats.by_category.sort(key=lambda b: (b.key is None, b.key or ""))
    stats.by_link_type.sort(key=lambda b: (b.key is None, b.key or ""))
    stats.card_count = len(card_ids)
    return stats


@router.post("/bulk-delete", response_model=ResourceBulkDeleteResult)
async def bulk_delete_resources(
    body: ResourceBulkDelete,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResourceBulkDeleteResult:
    """Delete a mixed selection of file attachments and document links.

    Each row is checked with the *same* gate the single-row DELETE
    endpoints use (``documents.manage`` or the card-level
    ``card.manage_documents``), so this endpoint can never do what the
    caller could not already do one row at a time. Rows the caller may
    not touch are reported in ``skipped`` rather than failing the whole
    request — the contract ``POST /users/bulk-delete`` already uses.
    """
    await PermissionService.require_permission(db, user, "documents.view")

    file_ids = [r.id for r in body.refs if r.kind == "file"]
    link_ids = [r.id for r in body.refs if r.kind == "link"]

    files: dict[uuid.UUID, FileAttachment] = {}
    if file_ids:
        # Entity load is required here (we delete the ORM object), but the
        # set is capped at 500 refs and only the selected rows are touched.
        file_result = await db.execute(
            select(FileAttachment).where(FileAttachment.id.in_(file_ids))
        )
        files = {f.id: f for f in file_result.scalars().all()}

    links: dict[uuid.UUID, Document] = {}
    if link_ids:
        link_result = await db.execute(select(Document).where(Document.id.in_(link_ids)))
        links = {d.id: d for d in link_result.scalars().all()}

    # Fast path: a holder of the app-level permission needs no per-card
    # lookups at all. Otherwise memoise per card, not per row, so deleting
    # 200 files off one card costs one permission query.
    manage_all = await PermissionService.has_app_permission(db, user, "documents.manage")
    card_ok: dict[uuid.UUID, bool] = {}

    async def _may_delete(card_id: uuid.UUID) -> bool:
        if manage_all:
            return True
        if card_id not in card_ok:
            card_ok[card_id] = await PermissionService.has_card_permission(
                db, user, card_id, "card.manage_documents"
            )
        return card_ok[card_id]

    skipped: list[ResourceSkipped] = []
    deleted = 0

    for ref in body.refs:
        row = files.get(ref.id) if ref.kind == "file" else links.get(ref.id)
        if row is None:
            skipped.append(ResourceSkipped(id=ref.id, kind=ref.kind, reason="Not found"))
            continue
        if not await _may_delete(row.card_id):
            skipped.append(
                ResourceSkipped(
                    id=ref.id, kind=ref.kind, reason="Insufficient permissions on this card"
                )
            )
            continue

        # Emit the identical event the single-row DELETE emits so the
        # card's History timeline stays complete and any consumer keyed on
        # these payload names keeps working. Branch on the row's own type
        # rather than ``ref.kind`` — the two always agree (each dict only
        # holds one model), but only isinstance narrows the union.
        if isinstance(row, FileAttachment):
            await event_bus.publish(
                "file.deleted",
                {
                    "attachment_id": str(row.id),
                    "name": row.name,
                    "mime_type": row.mime_type,
                    "size": row.size,
                    "summary": row.name,
                },
                db=db,
                card_id=row.card_id,
                user_id=user.id,
            )
        else:
            await event_bus.publish(
                "document.removed",
                {
                    "document_id": str(row.id),
                    "name": row.name,
                    "url": row.url,
                    "type": row.type,
                    "summary": row.name or row.url,
                },
                db=db,
                card_id=row.card_id,
                user_id=user.id,
            )
        await db.delete(row)
        deleted += 1

    # One commit for the whole selection — the bulk delete is atomic and
    # lands as a single batch in the audit log.
    await db.commit()
    return ResourceBulkDeleteResult(deleted=deleted, skipped=skipped)
