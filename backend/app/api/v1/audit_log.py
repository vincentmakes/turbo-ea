"""Security & admin audit log — read and export (Admin → Settings → Audit log).

Rows are written only by ``services/audit_log.record``; this module reads them.
There is deliberately no create, update or delete route: the log is immutable,
and only the daily retention purge in ``app.main`` removes rows.

Every handler requires ``admin.events`` — the permission that already gates the
landscape audit trail and the event stream.

Routes:

- ``GET /admin/audit-log`` — filtered, paginated, newest first.
- ``GET /admin/audit-log/actions`` — the distinct actions present, for the
  filter sidebar.
- ``GET /admin/audit-log/export`` — the same filters as CSV, capped at
  ``AUDIT_EXPORT_MAX_ROWS``. The export is itself recorded
  (``access.audit_log.exported``) and committed **before** the response is
  built, and the body is built in memory and returned as a plain
  ``Response``: a ``StreamingResponse`` would hold the request's database
  session for as long as the client takes to read it (CLAUDE.md, *never hold
  a database session across work that is not database work*).

The filter and CSV logic are plain module-level functions so they carry a
mutation score; the route bodies only wire them together.
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.audit_log import AuditLogEntry
from app.models.user import User
from app.services import audit_log
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/admin/audit-log", tags=["audit-log"])

AUDIT_EXPORT_MAX_ROWS = 50_000

CSV_COLUMNS: tuple[str, ...] = (
    "created_at",
    "category",
    "action",
    "outcome",
    "actor_email",
    "subject_email",
    "target_type",
    "target_id",
    "target_label",
    "ip",
    "user_agent",
    "origin",
    "impersonator_user_id",
    "impersonated_role",
    "details",
)

# A cell starting with one of these is read as a formula by Excel / Sheets.
# ``subject_email`` on a failed sign-in is whatever the visitor typed, so an
# exported log must never hand a spreadsheet an attacker-written formula.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class AuditLogEntryOut(BaseModel):
    id: uuid.UUID
    created_at: datetime | None
    category: str
    action: str
    outcome: str
    actor_user_id: uuid.UUID | None = None
    actor_email: str | None = None
    subject_email: str | None = None
    target_type: str | None = None
    target_id: str | None = None
    target_label: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    origin: str | None = None
    impersonator_user_id: uuid.UUID | None = None
    impersonated_role: str | None = None
    details: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class AuditLogPage(BaseModel):
    items: list[AuditLogEntryOut]
    total: int
    page: int
    page_size: int


def build_filters(
    *,
    category: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    q: str | None = None,
    ip: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[Any]:
    """The ``WHERE`` clauses for one set of list / export filters.

    ``action`` is a prefix (``auth.login`` matches every sign-in action), ``q``
    a case-insensitive substring over the actor email, the subject email and
    the target label; both escape ``%`` / ``_`` so user input is never a LIKE
    pattern. ``since`` / ``until`` are inclusive.
    """
    filters: list[Any] = []
    if category:
        filters.append(AuditLogEntry.category == category)
    if action:
        filters.append(AuditLogEntry.action.startswith(action, autoescape=True))
    if outcome:
        filters.append(AuditLogEntry.outcome == outcome)
    if actor_user_id:
        filters.append(AuditLogEntry.actor_user_id == actor_user_id)
    term = (q or "").strip()
    if term:
        filters.append(
            or_(
                AuditLogEntry.actor_email.icontains(term, autoescape=True),
                AuditLogEntry.subject_email.icontains(term, autoescape=True),
                AuditLogEntry.target_label.icontains(term, autoescape=True),
            )
        )
    if ip:
        filters.append(AuditLogEntry.ip == ip.strip())
    if since:
        filters.append(AuditLogEntry.created_at >= since)
    if until:
        filters.append(AuditLogEntry.created_at <= until)
    return filters


def filtered_query(filters: list[Any]):
    """Rows matching ``filters``, newest first (``id`` breaks a tie)."""
    query = select(AuditLogEntry)
    for clause in filters:
        query = query.where(clause)
    return query.order_by(AuditLogEntry.created_at.desc(), AuditLogEntry.id.desc())


def count_query(filters: list[Any]):
    query = select(func.count()).select_from(AuditLogEntry)
    for clause in filters:
        query = query.where(clause)
    return query


def csv_safe(value: Any) -> str:
    """Render one CSV cell: ``None`` as empty, a formula-looking string
    prefixed with ``'`` so a spreadsheet shows it as text."""
    if value is None:
        return ""
    text = value.isoformat() if isinstance(value, datetime) else str(value)
    if text.startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def entry_row(entry: Any) -> list[str]:
    """One CSV row for ``entry``, in ``CSV_COLUMNS`` order; ``details`` as JSON."""
    row: list[str] = []
    for column in CSV_COLUMNS:
        value = getattr(entry, column, None)
        if column == "details":
            value = json.dumps(value, default=str, sort_keys=True) if value is not None else None
        row.append(csv_safe(value))
    return row


def build_csv(entries: list[Any]) -> str:
    """The whole export as one CSV string: a header row, then one row per entry."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)
    for entry in entries:
        writer.writerow(entry_row(entry))
    return output.getvalue()


@router.get("", response_model=AuditLogPage)
async def list_audit_log(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    category: str | None = Query(None),
    action: str | None = Query(None),
    outcome: str | None = Query(None),
    actor_user_id: uuid.UUID | None = Query(None),
    q: str | None = Query(None),
    ip: str | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> AuditLogPage:
    """Security & admin audit log rows, newest first, in a
    ``{items, total, page, page_size}`` envelope."""
    await PermissionService.require_permission(db, user, "admin.events")
    filters = build_filters(
        category=category,
        action=action,
        outcome=outcome,
        actor_user_id=actor_user_id,
        q=q,
        ip=ip,
        since=since,
        until=until,
    )
    total = int((await db.execute(count_query(filters))).scalar_one() or 0)
    rows = (
        (await db.execute(filtered_query(filters).offset((page - 1) * page_size).limit(page_size)))
        .scalars()
        .all()
    )
    return AuditLogPage(
        items=[AuditLogEntryOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/actions", response_model=list[str])
async def list_audit_log_actions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[str]:
    """Every distinct action present in the log, sorted — the sidebar's options."""
    await PermissionService.require_permission(db, user, "admin.events")
    result = await db.execute(
        select(AuditLogEntry.action).distinct().order_by(AuditLogEntry.action)
    )
    return [a for a in result.scalars().all() if a]


@router.get("/export")
async def export_audit_log(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    category: str | None = Query(None),
    action: str | None = Query(None),
    outcome: str | None = Query(None),
    actor_user_id: uuid.UUID | None = Query(None),
    q: str | None = Query(None),
    ip: str | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
) -> Response:
    """The filtered log as CSV (newest first, at most ``AUDIT_EXPORT_MAX_ROWS``).

    Records ``access.audit_log.exported`` and commits it before building the
    body, so the export is on the record even if the client never reads it.
    """
    await PermissionService.require_permission(db, user, "admin.events")
    filters = build_filters(
        category=category,
        action=action,
        outcome=outcome,
        actor_user_id=actor_user_id,
        q=q,
        ip=ip,
        since=since,
        until=until,
    )
    entries = list(
        (await db.execute(filtered_query(filters).limit(AUDIT_EXPORT_MAX_ROWS))).scalars().all()
    )
    body = build_csv(entries)
    await audit_log.record(
        db,
        action="access.audit_log.exported",
        category="access",
        actor=user,
        target=("audit_log", None, "audit_log"),
        details={"rows": len(entries)},
    )
    await db.commit()
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'},
    )
