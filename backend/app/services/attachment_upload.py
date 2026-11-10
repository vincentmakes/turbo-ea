"""Reading an uploaded file the way every upload route must.

Shared by the card attachments (``api/v1/file_attachments.py``) and the
files on a decision (``api/v1/adr.py``): the uploads switch, the bounded
read and the content check, and the ``Content-Disposition`` value a download
sends. HTTP-flavoured on purpose — each refusal is the exact 400 / 403 the
routes have always answered.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.services.attachment_validation import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_MB,
    SNIFF_BYTES,
    AttachmentFormat,
    InvalidAttachmentError,
    resolve_format,
    validate_content,
)

UPLOADS_DISABLED_MESSAGE = "File uploads are disabled by the administrator"


async def require_uploads_enabled(db: AsyncSession) -> None:
    """403 when the administrator switched file uploads off."""
    settings_result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings_row = settings_result.scalar_one_or_none()
    general = (settings_row.general_settings if settings_row else None) or {}
    if not general.get("fileUploadsEnabled", True):
        raise HTTPException(403, UPLOADS_DISABLED_MESSAGE)


async def read_validated_upload(file: UploadFile) -> tuple[AttachmentFormat, bytes]:
    """Read an upload the way every write path must: the extension picks the
    format, the size is bounded before trusting Content-Length, and the bytes
    prove the format. The declared content type decides nothing."""
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
    return fmt, data


def content_disposition(name: str) -> str:
    """The ``Content-Disposition`` value that downloads ``name`` as an attachment.

    RFC 6266 / RFC 5987: HTTP header values must be Latin-1 encodable, so a
    raw filename with non-Latin-1 characters (Cyrillic, CJK, emoji, ...) would
    crash the response serializer with UnicodeEncodeError. Emit an ASCII
    fallback plus a percent-encoded UTF-8 form that modern browsers prefer.
    """
    ascii_fallback = name.encode("ascii", "replace").decode("ascii")
    ascii_fallback = ascii_fallback.replace("\\", "_").replace('"', "_")
    encoded_name = quote(name, safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded_name}"
