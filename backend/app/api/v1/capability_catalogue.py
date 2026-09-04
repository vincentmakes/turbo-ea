"""Public-facing routes for the Business Capability reference catalogue browser.

Visibility:
- `GET /capability-catalogue` — any user with `inventory.view`.
- `POST /capability-catalogue/import` — `inventory.create` on `BusinessCapability`
  (matches the regular card-creation permission, per the product brief).
- `GET /capability-catalogue/update-status` and
  `POST /capability-catalogue/update-fetch` — `admin.metamodel`. The catalogue
  is metamodel-adjacent reference data and updating it changes what users see
  org-wide, so admin-only is appropriate.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.user import User
from app.services import capability_catalogue_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/capability-catalogue", tags=["capability-catalogue"])


class ImportRequest(BaseModel):
    catalogue_ids: list[str] = Field(..., min_length=1, max_length=2000)
    # Locale the user was browsing the catalogue in when they triggered the
    # import. Cards land with `name`, `description`, and `aliases` in this
    # language so a French catalogue produces French cards. Identity stays
    # locale-agnostic via `catalogueId`, so a green tick survives a language
    # switch and there's no risk of duplicate cards across languages.
    locale: str | None = None


@router.get("")
async def get_catalogue(
    locale: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.view")),
):
    """Return the full active catalogue with `existing_card_id` annotations.

    The optional `locale` query param overrides the user's saved locale —
    used by the frontend to follow live UI language switches without waiting
    for the `user.locale` PATCH to land. Falls back to `user.locale`, then
    English. Translations themselves come from the bundled package; missing
    per-field translations degrade silently to English.
    """
    effective_locale = (locale or user.locale or "en").strip() or "en"
    return await svc.get_catalogue_payload(db, locale=effective_locale)


@router.post("/import")
async def import_capabilities(
    payload: ImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(
        require_permission("inventory.create", card_type_key="BusinessCapability")
    ),
):
    """Create BusinessCapability cards for the selected catalogue entries.

    Idempotent: catalogue entries whose name already exists as a non-archived
    BusinessCapability are skipped (and reported in the `skipped` list).
    Hierarchy is preserved automatically when both parent and child are
    selected, or when the parent already exists.

    The optional `locale` in the request body controls which language the
    new cards are written in (`name`, `description`, `aliases`); falls back
    to the user's saved locale, then English. Existing-card matching is
    always English-anchored so a localized import never duplicates a card.
    """
    effective_locale = (payload.locale or user.locale or "en").strip() or "en"
    return await svc.import_capabilities(
        db,
        user=user,
        catalogue_ids=payload.catalogue_ids,
        locale=effective_locale,
    )


@router.get("/update-status")
async def update_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    """Compare the bundled/cached catalogue against the public site."""
    return await svc.check_remote_version(db)


@router.post("/update-fetch")
async def update_fetch(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    """Download the latest catalogue from the public site and cache it."""
    try:
        return await svc.fetch_remote_catalogue(db)
    except Exception:
        logger.exception("Capability catalogue fetch failed")
        raise HTTPException(status_code=502, detail="Catalogue fetch failed")
