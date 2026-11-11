"""Where a card or a decision is mentioned ("Mentioned in").

Both routes answer ``{decisions: [...], soaws: [...]}``: the decisions
(``{id, reference_number, revision_number, title, status, standing, via}``;
``via`` is ``text`` or ``comment``) and the SoAWs (``{id, name,
revision_number, status}``) whose text or discussion mentions the target,
limited to what the reader may open (decisions with ``adr.view``, SoAWs with
``soaw.view``). Each revision chain is listed once, when the mention is in its
current revision or its open draft, and the entry is the revision that holds
it; a mention left only in an earlier revision lists nothing. The search runs
over the stored canonical marker and parses every hit before it counts
(:mod:`app.services.mention_service`).

* ``GET /mentions/cards/{card_id}`` — the card must be readable in module
  mode: a hidden or unknown card is 404.
* ``GET /mentions/decisions/{adr_id}`` — behind ``adr.view``; a mention of
  any revision of the decision's chain counts; an unknown decision is 404.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services import document_collab as collab
from app.services import mention_service
from app.services.card_read_scope import require_card_readable
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/mentions", tags=["document-collaboration"])


@router.get("/cards/{card_id}")
async def card_mentioned_in(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """``{decisions: [...], soaws: [...]}`` that mention the card."""
    try:
        cid = uuid.UUID(card_id)
    except ValueError:
        raise HTTPException(404, "Card not found") from None
    await require_card_readable(db, user, cid, mode="module")
    return await mention_service.mentioned_in_card(db, cid, user=user)


@router.get("/decisions/{adr_id}")
async def decision_mentioned_in(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """``{decisions: [...], soaws: [...]}`` that mention the decision."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await collab.load_document(db, collab.ADR, adr_id)
    return await mention_service.mentioned_in_decision(db, adr.id, user=user)
