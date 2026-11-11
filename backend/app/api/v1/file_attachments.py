from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.file_attachment import FileAttachment
from app.models.user import User
from app.schemas.common import FileAttachmentUpdate
from app.services.attachment_upload import (
    content_disposition,
    read_validated_upload,
    require_uploads_enabled,
)
from app.services.attachment_validation import extension_of, extensions_for_mime
from app.services.card_read_scope import require_card_readable
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(tags=["file-attachments"])

# The fields a PATCH may change; also the keys a ``file.updated`` event's
# ``changes`` dict can carry. The bytes themselves go through PUT …/content.
_EDITABLE_FIELDS = ("name", "category")


def _attachment_row(a: FileAttachment, creator_name: str | None = None) -> dict:
    """The one wire shape for an attachment — list rows, upload, replace, edit."""
    return {
        "id": str(a.id),
        "card_id": str(a.card_id),
        "name": a.name,
        "mime_type": a.mime_type,
        "size": a.size,
        "category": a.category,
        "created_by": str(a.created_by) if a.created_by else None,
        "creator_name": creator_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


async def _load_for_manage(db: AsyncSession, user: User, attachment_id: str) -> FileAttachment:
    """The attachment, once the caller may change it: 404 when missing, 403
    without ``documents.manage`` or the card-level ``card.manage_documents``."""
    result = await db.execute(
        select(FileAttachment).where(FileAttachment.id == uuid.UUID(attachment_id))
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(404, "File attachment not found")
    if not await PermissionService.check_permission(
        db, user, "documents.manage", attachment.card_id, "card.manage_documents"
    ):
        raise HTTPException(403, "Not enough permissions")
    return attachment


@router.get("/cards/{card_id}/file-attachments")
async def list_file_attachments(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "documents.view")
    await require_card_readable(db, user, uuid.UUID(card_id), mode="module")
    result = await db.execute(
        select(FileAttachment)
        .where(FileAttachment.card_id == uuid.UUID(card_id))
        .order_by(FileAttachment.created_at.desc())
    )
    files = result.scalars().all()

    # Batch-resolve creator names
    creator_ids = {f.created_by for f in files if f.created_by}
    creator_names: dict[uuid.UUID, str] = {}
    if creator_ids:
        user_result = await db.execute(select(User).where(User.id.in_(creator_ids)))
        for u in user_result.scalars().all():
            creator_names[u.id] = u.display_name

    return [
        _attachment_row(f, creator_names.get(f.created_by) if f.created_by else None) for f in files
    ]


@router.post("/cards/{card_id}/file-attachments", status_code=201)
async def upload_file_attachment(
    card_id: str,
    file: UploadFile,
    category: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "documents.manage", card_uuid, "card.manage_documents"
    ):
        raise HTTPException(403, "Not enough permissions")

    await require_uploads_enabled(db)
    fmt, data = await read_validated_upload(file)

    attachment = FileAttachment(
        card_id=card_uuid,
        name=file.filename or "untitled",
        mime_type=fmt.mime,
        size=len(data),
        data=data,
        category=category,
        created_by=user.id,
    )
    db.add(attachment)
    await db.flush()
    await event_bus.publish(
        "file.uploaded",
        {
            "attachment_id": str(attachment.id),
            "name": attachment.name,
            "mime_type": attachment.mime_type,
            "size": attachment.size,
            "category": attachment.category,
            "summary": attachment.name,
        },
        db=db,
        card_id=card_uuid,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(attachment)
    return _attachment_row(attachment, user.display_name)


@router.put("/file-attachments/{attachment_id}/content")
async def replace_file_attachment(
    attachment_id: str,
    file: UploadFile,
    category: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a new version of a file into the same attachment.

    The row keeps its id, so every reference to it survives, but otherwise it
    reads as a fresh upload: name, MIME, size and bytes come from the new
    file, ``category`` from the form exactly as on an upload (absent means
    none — a multipart field cannot say "clear" any other way, FastAPI reads
    an empty form value as omitted), and ``created_at`` / ``created_by`` are
    reset to now and the person replacing it. The version it supersedes lives
    on only in the card's History, as ``previous`` on the ``file.replaced``
    event (#1166). Same checks as an upload, and refused for the same reason
    while uploads are switched off.
    """
    attachment = await _load_for_manage(db, user, attachment_id)
    await require_uploads_enabled(db)
    fmt, data = await read_validated_upload(file)

    previous = {
        "name": attachment.name,
        "mime_type": attachment.mime_type,
        "size": attachment.size,
        "created_by": str(attachment.created_by) if attachment.created_by else None,
        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
    }
    attachment.name = file.filename or "untitled"
    attachment.mime_type = fmt.mime
    attachment.size = len(data)
    attachment.data = data
    attachment.created_by = user.id
    attachment.created_at = datetime.now(UTC)
    attachment.category = (category or "").strip() or None
    await db.flush()
    await event_bus.publish(
        "file.replaced",
        {
            "attachment_id": str(attachment.id),
            "name": attachment.name,
            "mime_type": attachment.mime_type,
            "size": attachment.size,
            "category": attachment.category,
            "summary": attachment.name,
            "previous": previous,
        },
        db=db,
        card_id=attachment.card_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(attachment)
    return _attachment_row(attachment, user.display_name)


@router.patch("/file-attachments/{attachment_id}")
async def update_file_attachment(
    attachment_id: str,
    body: FileAttachmentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Rename a file attachment or change its category.

    The bytes are untouched, so the new name must keep an extension that
    maps to the stored format (``.jpg`` ↔ ``.jpeg`` is fine, ``.pdf`` →
    ``.docx`` is not — that is a replace). Only the fields that move are
    written and recorded as ``changes`` on a ``file.updated`` event; a
    no-op PATCH writes nothing and emits nothing (#1166). Not gated on the
    uploads toggle: like a delete, it moves no bytes.
    """
    attachment = await _load_for_manage(db, user, attachment_id)

    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        allowed = set(extensions_for_mime(attachment.mime_type)) or {extension_of(attachment.name)}
        if extension_of(data["name"]) not in allowed:
            raise HTTPException(
                400,
                f"Keep the file's extension ({', '.join(sorted(allowed))}); "
                "use Replace to store a different format.",
            )

    changes = {
        field: {"old": getattr(attachment, field), "new": value}
        for field, value in data.items()
        if field in _EDITABLE_FIELDS and getattr(attachment, field) != value
    }
    if not changes:
        return _attachment_row(attachment)

    for field, change in changes.items():
        setattr(attachment, field, change["new"])
    await db.flush()
    await event_bus.publish(
        "file.updated",
        {
            "attachment_id": str(attachment.id),
            "name": attachment.name,
            "mime_type": attachment.mime_type,
            "size": attachment.size,
            "category": attachment.category,
            "summary": attachment.name,
            "changes": changes,
        },
        db=db,
        card_id=attachment.card_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(attachment)
    return _attachment_row(attachment)


@router.get("/file-attachments/{attachment_id}/download")
async def download_file_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "documents.view")
    result = await db.execute(
        select(FileAttachment).where(FileAttachment.id == uuid.UUID(attachment_id))
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(404, "File attachment not found")
    # An attachment of a card hidden from the caller does not exist for them.
    await require_card_readable(db, user, attachment.card_id, mode="module")

    return Response(
        content=attachment.data,
        media_type=attachment.mime_type,
        headers={"Content-Disposition": content_disposition(attachment.name)},
    )


@router.delete("/file-attachments/{attachment_id}", status_code=204)
async def delete_file_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    attachment = await _load_for_manage(db, user, attachment_id)
    await event_bus.publish(
        "file.deleted",
        {
            "attachment_id": str(attachment.id),
            "name": attachment.name,
            "mime_type": attachment.mime_type,
            "size": attachment.size,
            "summary": attachment.name,
        },
        db=db,
        card_id=attachment.card_id,
        user_id=user.id,
    )
    await db.delete(attachment)
    await db.commit()
