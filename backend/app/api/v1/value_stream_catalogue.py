"""Public-facing routes for the Value Stream reference catalogue browser.

Mirrors the capability catalogue:

- `GET /value-stream-catalogue` — `inventory.view`
- `POST /value-stream-catalogue/import` — `inventory.create` on `ValueStream`
- `GET /value-stream-catalogue/update-status` — `admin.metamodel`
- `POST /value-stream-catalogue/update-fetch` — `admin.metamodel`
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.user import User
from app.services import value_stream_catalogue_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/value-stream-catalogue", tags=["value-stream-catalogue"])


class ImportRequest(BaseModel):
    catalogue_ids: list[str] = Field(..., min_length=1, max_length=2000)
    locale: str | None = None


@router.get("")
async def get_catalogue(
    locale: str | None = None,
    db: AsyncSession = Depends(get_db),
    # The catalogue marks which entries already exist as BusinessContext cards, so a
    # role denied View on that type may not open it.
    user: User = Depends(require_permission("inventory.view", card_type_key="BusinessContext")),
):
    """Return the full active value-stream catalogue, flattened to a
    parent-stream + child-stage tree so the existing browser UI can render
    it. Each node is annotated with `existing_card_id`.
    """
    effective_locale = (locale or user.locale or "en").strip() or "en"
    return await svc.get_catalogue_payload(db, locale=effective_locale)


@router.post("/import")
async def import_value_streams(
    payload: ImportRequest,
    db: AsyncSession = Depends(get_db),
    # Gated on the type the import creates. It named a `ValueStream` type that
    # does not exist, so a per-type Create deny on Business Context never applied.
    user: User = Depends(require_permission("inventory.create", card_type_key="BusinessContext")),
):
    """Create BusinessContext / valueStream cards for selected streams or
    stages. Selecting a stage automatically pulls in its parent stream so
    `parent_id` is wired correctly. Auto-creates relBizCtxToBC and
    relProcessToBizCtx relations to any matching capability/process cards.
    """
    effective_locale = (payload.locale or user.locale or "en").strip() or "en"
    result = await svc.import_value_streams(
        db,
        user=user,
        catalogue_ids=payload.catalogue_ids,
        locale=effective_locale,
    )
    # The service stages its rows and never commits a session it was handed.
    await db.commit()
    return result


@router.get("/update-status")
async def update_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    # The permission check used this request's session, so a pooled connection
    # is already checked out. Hand it back before the PyPI round-trip:
    # ``get_db`` is a yield-dependency that would otherwise pin it until the
    # response is sent.
    await db.commit()
    return await svc.check_remote_version(db)


@router.post("/update-fetch")
async def update_fetch(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admin.metamodel")),
):
    # The permission check used this request's session, so a pooled connection
    # is already checked out. Hand it back before the PyPI round-trip:
    # ``get_db`` is a yield-dependency that would otherwise pin it until the
    # response is sent.
    await db.commit()
    try:
        result = await svc.fetch_remote_catalogue(db)
        # The helper stages the cache rows and never commits a session it was
        # handed; the write is committed here, once the download is over.
        await db.commit()
        return result
    except Exception:
        logger.exception("Value-stream catalogue fetch failed")
        raise HTTPException(status_code=502, detail="Catalogue fetch failed")
