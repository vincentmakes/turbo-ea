"""Public-facing routes for the EA Principles reference catalogue browser.

Visibility:
- `GET /principles-catalogue` — any user with `admin.metamodel` (principles
  are admin-managed reference data).
- `POST /principles-catalogue/import` — `admin.metamodel` (creating
  principles is admin-only via the existing `/metamodel/principles` route).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.user import User
from app.services import audit_log
from app.services import principles_catalogue_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/principles-catalogue", tags=["principles-catalogue"])


class ImportPrinciplesRequest(BaseModel):
    catalogue_ids: list[str] = Field(..., min_length=1, max_length=200)


@router.get("")
async def get_catalogue(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    """Return the bundled principles catalogue with `existing_principle_id`
    annotations so the frontend can render a green tick on already-imported
    entries."""
    return await svc.get_catalogue_payload(db)


@router.post("/import")
async def import_principles(
    payload: ImportPrinciplesRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    """Create EAPrinciple rows for the selected catalogue entries.

    Idempotent: catalogue ids that already exist as a principle (matched by
    `catalogue_id`) are skipped and reported in the `skipped` list.
    """
    result = await svc.import_principles(db, catalogue_ids=payload.catalogue_ids)
    # The service commits the import; the audit row is a second, small commit.
    await audit_log.record(
        db,
        action="admin.principle.imported",
        category="admin",
        actor=user,
        target=("principles_catalogue", result.get("catalogue_version"), None),
        details={
            "count": len(result["created"]),
            "skipped": len(result["skipped"]),
            "catalogue_ids": [row["catalogue_id"] for row in result["created"]],
        },
    )
    await db.commit()
    return result
