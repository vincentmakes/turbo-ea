"""Public-facing routes for the Business Process reference catalogue browser.

Mirrors the capability catalogue:

- `GET /process-catalogue` — `inventory.view`
- `POST /process-catalogue/import` — `inventory.create` on `BusinessProcess`
- `GET /process-catalogue/update-status` — `admin.metamodel`
- `POST /process-catalogue/update-fetch` — `admin.metamodel`

The fetch endpoint hydrates the capability and value-stream caches at the
same time (one wheel download covers all three artefact types).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.user import User
from app.services import process_catalogue_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/process-catalogue", tags=["process-catalogue"])


class ImportRequest(BaseModel):
    catalogue_ids: list[str] = Field(..., min_length=1, max_length=2000)
    locale: str | None = None


@router.get("")
async def get_catalogue(
    locale: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.view")),
):
    """Return the full active process catalogue with `existing_card_id`
    annotations.
    """
    effective_locale = (locale or user.locale or "en").strip() or "en"
    return await svc.get_catalogue_payload(db, locale=effective_locale)


@router.post("/import")
async def import_processes(
    payload: ImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.create", card_type_key="BusinessProcess")),
):
    """Create BusinessProcess cards for the selected catalogue entries.

    Idempotent and hierarchy-preserving. Auto-creates `relProcessToBC`
    relations to any matching BusinessCapability cards (skipped silently
    if the target capability hasn't been imported yet).
    """
    effective_locale = (payload.locale or user.locale or "en").strip() or "en"
    return await svc.import_processes(
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
    """Compare the bundled/cached process catalogue against PyPI."""
    return await svc.check_remote_version(db)


@router.post("/update-fetch")
async def update_fetch(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    """Download the latest wheel from PyPI. Hydrates all three caches."""
    try:
        return await svc.fetch_remote_catalogue(db)
    except Exception:
        logger.exception("Process catalogue fetch failed")
        raise HTTPException(status_code=502, detail="Catalogue fetch failed")
