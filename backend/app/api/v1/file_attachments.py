from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.file_attachment import FileAttachment
from app.models.user import User
from app.services.attachment_validation import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_MB,
    SNIFF_BYTES,
    InvalidAttachmentError,
    resolve_format,
    validate_content,
)
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(tags=["file-attachments"])


@router.get("/cards/{card_id}/file-attachments")
async def list_file_attachments(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "documents.view")
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
        {
            "id": str(f.id),
            "card_id": str(f.card_id),
            "name": f.name,
            "mime_type": f.mime_type,
            "size": f.size,
            "category": f.category,
            "created_by": str(f.created_by) if f.created_by else None,
            "creator_name": creator_names.get(f.created_by) if f.created_by else None,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in files
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

    settings_result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings_row = settings_result.scalar_one_or_none()
    general = (settings_row.general_settings if settings_row else None) or {}
    if not general.get("fileUploadsEnabled", True):
        raise HTTPException(403, "File uploads are disabled by the administrator")

    # The declared content type is client-written multipart metadata and
    # decides nothing: the extension picks the format and the bytes prove it.
    # Resolving first costs nothing and refuses a bad name before any read.
    try:
        fmt = resolve_format(file.filename or "")
    except InvalidAttachmentError as exc:
        raise HTTPException(400, str(exc)) from exc

    # One byte past the cap is enough to know it was exceeded, and bounds what
    # a single request can pull into memory without trusting Content-Length.
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(400, f"File exceeds maximum size of {MAX_ATTACHMENT_MB} MB")

    try:
        validate_content(fmt, data[:SNIFF_BYTES])
    except InvalidAttachmentError as exc:
        raise HTTPException(400, str(exc)) from exc

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

    return {
        "id": str(attachment.id),
        "card_id": str(attachment.card_id),
        "name": attachment.name,
        "mime_type": attachment.mime_type,
        "size": attachment.size,
        "category": attachment.category,
        "created_by": str(attachment.created_by),
        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
    }


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

    # RFC 6266 / RFC 5987: HTTP header values must be Latin-1 encodable, so a
    # raw filename with non-Latin-1 characters (Cyrillic, CJK, emoji, ...) would
    # crash the response serializer with UnicodeEncodeError. Emit an ASCII
    # fallback plus a percent-encoded UTF-8 form that modern browsers prefer.
    ascii_fallback = attachment.name.encode("ascii", "replace").decode("ascii")
    ascii_fallback = ascii_fallback.replace("\\", "_").replace('"', "_")
    encoded_name = quote(attachment.name, safe="")
    disposition = f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded_name}"
    return Response(
        content=attachment.data,
        media_type=attachment.mime_type,
        headers={"Content-Disposition": disposition},
    )


@router.delete("/file-attachments/{attachment_id}", status_code=204)
async def delete_file_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FileAttachment).where(FileAttachment.id == uuid.UUID(attachment_id))
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(404, "File attachment not found")

    if not await PermissionService.check_permission(
        db,
        user,
        "documents.manage",
        attachment.card_id,
        "card.manage_documents",
    ):
        raise HTTPException(403, "Not enough permissions")
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
