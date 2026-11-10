"""Where a decision or a card is mentioned ("Mentioned in").

``GET /mentions/decisions/{adr_id}`` answers the decisions and SoAWs whose
text mentions the decision, limited to what the reader may open. Behind
``adr.view``; an unknown decision is 404. The search arrives with the
mention service; until then the lists are empty.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services import document_collab as collab
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/mentions", tags=["document-collaboration"])


@router.get("/decisions/{adr_id}")
async def decision_mentioned_in(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """``{decisions: [...], soaws: [...]}`` that mention the decision."""
    await PermissionService.require_permission(db, user, "adr.view")
    await collab.load_document(db, collab.ADR, adr_id)
    return collab.mentioned_in_payload()
