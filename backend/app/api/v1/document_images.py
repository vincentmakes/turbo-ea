"""Pictures in the text of decisions and SoAWs: upload and fetch.

``POST /document-images/{kind}`` stores one picture (PNG, JPEG, GIF or WebP,
proven by its leading bytes; at most ``MAX_DOCUMENT_IMAGE_MB``) for an editor
of that kind (``adr.manage`` / ``soaw.manage``) while file uploads are on;
the answer carries the ``src`` the editor writes into the text.

``GET /document-images/{kind}/{image_id}`` serves it inline to anyone who
may read that kind of document (``adr.view`` / ``soaw.view``, checked before
any lookup). Reading a decision or a SoAW is a flat permission per kind, so a
kind-level gate is the same as a per-document one. The picture is served
with its stored MIME type, ``nosniff`` and a private cache; it is never a
download (no ``Content-Disposition``). An unknown id, a malformed one and
another kind's picture are all 404.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services import document_image_service
from app.services.attachment_upload import require_uploads_enabled
from app.services.attachment_validation import (
    MAX_DOCUMENT_IMAGE_BYTES,
    MAX_DOCUMENT_IMAGE_MB,
    SNIFF_BYTES,
    sniff_raster_image,
)
from app.services.document_image_markup import src_for
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/document-images", tags=["document-images"])

DocumentKind = Literal["adr", "soaw"]

NOT_FOUND = "Picture not found"
NOT_A_PICTURE = "Only PNG, JPEG, GIF and WebP pictures can be inserted"


async def _require_view(db: AsyncSession, user: User, kind: DocumentKind) -> None:
    if kind == "adr":
        await PermissionService.require_permission(db, user, "adr.view")
    else:
        await PermissionService.require_permission(db, user, "soaw.view")


async def _require_manage(db: AsyncSession, user: User, kind: DocumentKind) -> None:
    if kind == "adr":
        await PermissionService.require_permission(db, user, "adr.manage")
    else:
        await PermissionService.require_permission(db, user, "soaw.manage")


@router.post("/{kind}", status_code=201)
async def upload_document_image(
    kind: DocumentKind,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Store one picture for the text of a ``kind`` document."""
    await _require_manage(db, user, kind)
    await require_uploads_enabled(db)
    # One byte past the cap is enough to know it was exceeded, and bounds what
    # a single request can pull into memory without trusting Content-Length.
    data = await file.read(MAX_DOCUMENT_IMAGE_BYTES + 1)
    if not data:
        raise HTTPException(400, "File is empty")
    if len(data) > MAX_DOCUMENT_IMAGE_BYTES:
        raise HTTPException(400, f"Picture exceeds maximum size of {MAX_DOCUMENT_IMAGE_MB} MB")
    mime_type = sniff_raster_image(data[:SNIFF_BYTES])
    if mime_type is None:
        raise HTTPException(400, NOT_A_PICTURE)
    row = await document_image_service.store(
        db, kind, data, mime_type=mime_type, created_by=user.id
    )
    await db.commit()
    return {
        "id": str(row.id),
        "src": src_for(kind, str(row.id)),
        "mime_type": row.mime_type,
        "size": row.size,
    }


@router.get("/{kind}/{image_id}")
async def get_document_image(
    kind: DocumentKind,
    image_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """One picture of a ``kind`` document, inline."""
    await _require_view(db, user, kind)
    found = await document_image_service.load(db, kind, image_id)
    if found is None:
        raise HTTPException(404, NOT_FOUND)
    # The bytes are in memory: a plain response, nothing streamed while the
    # request's session is open.
    return Response(
        content=found.data,
        media_type=found.mime_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=86400",
        },
    )
