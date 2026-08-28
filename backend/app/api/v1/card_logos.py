from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.card_logo import CardLogo
from app.models.card_type import CardType
from app.models.user import User
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(tags=["card-logos"])

MAX_CARD_LOGO_SIZE = 1 * 1024 * 1024  # 1 MB — a logo, not an attachment

# Deliberately excludes SVG. There is no SVG sanitiser anywhere in this
# codebase, and a logo is served same-origin to every viewer including
# anonymous portal visitors, so a scriptable image format has no place here.
# Same allow-list as the branding logo in settings.py.
ALLOWED_CARD_LOGO_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

# Browsers send "image/jpg" for JPEGs often enough that rejecting it would read
# as a bug rather than a policy.
_MIME_ALIASES = {"image/jpg": "image/jpeg"}


def sniff_image_mime(head: bytes) -> str | None:
    """Identify an image from its leading bytes, or return None.

    The declared content type is attacker-controlled — it travels in the
    multipart part header — so it decides nothing on its own. This is what
    actually establishes that the upload is the image format it claims to be.
    Needs 12 bytes for WebP, whose marker sits at offset 8.
    """
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _parse_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        return None


@router.get("/cards/{card_id}/logo")
async def get_card_logo(card_id: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns a card's logo image bytes, or 404.

    Unauthenticated on purpose. An ``<img>`` tag cannot carry the bearer token
    (it lives in sessionStorage), and published web portals are viewed with no
    account at all, so a gated route would mean either blob-fetching through
    the API client on every surface or a second portal-scoped copy of this
    endpoint. What is returned is the artefact and nothing else — no card name,
    type, or any other field — keyed by an unguessable UUID, the same posture
    ``GET /diagrams/public/{slug}`` and ``/ext-assets`` take.

    A missing card, a card with no logo, and a malformed id all answer 404
    identically, so this cannot be used to probe which card ids exist. The
    per-type ``allow_card_logo`` switch deliberately does not gate this: it
    governs upload and display, and enforcing it here would 404 images that
    are still on screen in a portal the moment an admin flips it off.
    """
    card_uuid = _parse_uuid(card_id)
    if card_uuid is None:
        raise HTTPException(404, "Not found")

    # `data` is deferred on the model; select the columns directly so this stays
    # the only read that transfers the bytes.
    row = (
        await db.execute(
            select(CardLogo.data, CardLogo.mime_type).where(CardLogo.card_id == card_uuid)
        )
    ).one_or_none()

    if not row or not row.data:
        raise HTTPException(404, "Not found")

    return Response(
        content=row.data,
        media_type=row.mime_type or "image/png",
        headers={
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def _load_card_for_write(db: AsyncSession, card_id: str, user: User) -> Card:
    """Resolve the card and authorise a logo write on it."""
    card_uuid = _parse_uuid(card_id)
    if card_uuid is None:
        raise HTTPException(404, "Card not found")

    card = (await db.execute(select(Card).where(Card.id == card_uuid))).scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    # A logo is card content, so it rides on the card's own edit authority
    # rather than introducing a permission key of its own.
    if not await PermissionService.check_permission(
        db, user, "inventory.edit", card_uuid, "card.edit"
    ):
        raise HTTPException(403, "Not enough permissions")

    return card


@router.post("/cards/{card_id}/logo")
async def upload_card_logo(
    card_id: str,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload or replace the card's logo."""
    card = await _load_card_for_write(db, card_id, user)

    settings_result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings_row = settings_result.scalar_one_or_none()
    general = (settings_row.general_settings if settings_row else None) or {}
    if not general.get("fileUploadsEnabled", True):
        raise HTTPException(403, "File uploads are disabled by the administrator")

    allowed = (
        await db.execute(select(CardType.allow_card_logo).where(CardType.key == card.type))
    ).scalar_one_or_none()
    if not allowed:
        raise HTTPException(
            400,
            f"Custom logos are not enabled for card type '{card.type}'. "
            f"An administrator can enable them under Admin → Meta Model.",
        )

    content_type = _MIME_ALIASES.get(file.content_type or "", file.content_type or "")
    if content_type not in ALLOWED_CARD_LOGO_MIMES:
        raise HTTPException(
            400,
            f"Image type '{file.content_type or 'unknown'}' is not allowed. "
            f"Accepted: PNG, JPEG, WebP, GIF.",
        )

    data = await file.read()
    if len(data) > MAX_CARD_LOGO_SIZE:
        raise HTTPException(
            400, f"Image exceeds maximum size of {MAX_CARD_LOGO_SIZE // (1024 * 1024)} MB"
        )
    if not data:
        raise HTTPException(400, "Image is empty")

    sniffed = sniff_image_mime(data[:16])
    if sniffed is None or sniffed != content_type:
        raise HTTPException(400, "File content does not match its declared image type.")

    logo = (
        await db.execute(select(CardLogo).where(CardLogo.card_id == card.id))
    ).scalar_one_or_none()
    if logo:
        logo.data = data
        logo.mime_type = content_type
        logo.size = len(data)
        logo.created_by = user.id
        logo.updated_at = func.now()
    else:
        logo = CardLogo(
            card_id=card.id,
            mime_type=content_type,
            size=len(data),
            data=data,
            created_by=user.id,
        )
        db.add(logo)

    # Published with `db=` so it lands in the card's History tab. Deliberately
    # not routed through the card update path: that builds an old/new diff of
    # every changed field, which would put image bytes in the event payload.
    await event_bus.publish(
        "card_logo.updated",
        {
            "mime_type": content_type,
            "size": len(data),
            "summary": file.filename or "logo",
        },
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(logo)

    return {
        "ok": True,
        "logo_updated_at": logo.updated_at.isoformat() if logo.updated_at else None,
    }


@router.delete("/cards/{card_id}/logo", status_code=204)
async def delete_card_logo(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove the card's logo, falling the card back to its type icon.

    Allowed even when the type's ``allow_card_logo`` switch is off, so turning
    the feature off for a type never strands existing images as undeletable.
    """
    card = await _load_card_for_write(db, card_id, user)

    logo = (
        await db.execute(select(CardLogo).where(CardLogo.card_id == card.id))
    ).scalar_one_or_none()
    if not logo:
        raise HTTPException(404, "This card has no logo")

    await db.delete(logo)
    await event_bus.publish(
        "card_logo.deleted",
        {"summary": "logo"},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    return Response(status_code=204)
