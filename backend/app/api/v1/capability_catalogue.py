"""Public-facing routes for the Business Capability reference catalogue browser.

Visibility:
- `GET /capability-catalogue` — any user with `inventory.view`.
- `POST /capability-catalogue/import` — `inventory.create` (matches the regular
  card-creation permission, per the product brief).
- `GET /capability-catalogue/update-status` and
  `POST /capability-catalogue/update-fetch` — `admin.metamodel`. The catalogue
  is metamodel-adjacent reference data and updating it changes what users see
  org-wide, so admin-only is appropriate.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.user import User
from app.services import capability_catalogue_service as svc

router = APIRouter(prefix="/capability-catalogue", tags=["capability-catalogue"])


class ImportRequest(BaseModel):
    catalogue_ids: list[str] = Field(..., min_length=1, max_length=2000)


@router.get("")
async def get_catalogue(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.view")),
):
    """Return the full active catalogue with `existing_card_id` annotations."""
    return await svc.get_catalogue_payload(db)


@router.post("/import")
async def import_capabilities(
    payload: ImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.create")),
):
    """Create BusinessCapability cards for the selected catalogue entries.

    Idempotent: catalogue entries whose name already exists as a non-archived
    BusinessCapability are skipped (and reported in the `skipped` list).
    Hierarchy is preserved automatically when both parent and child are
    selected, or when the parent already exists.
    """
    return await svc.import_capabilities(db, user=user, catalogue_ids=payload.catalogue_ids)


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
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Catalogue fetch failed: {exc}")
