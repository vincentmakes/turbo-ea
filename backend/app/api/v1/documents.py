from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.document import Document
from app.models.user import User
from app.schemas.common import DocumentCreate
from app.services.permission_service import PermissionService

router = APIRouter(tags=["documents"])


@router.get("/cards/{card_id}/documents")
async def list_documents(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "documents.view")
    result = await db.execute(
        select(Document).where(Document.card_id == uuid.UUID(card_id))
    )
    docs = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "card_id": str(d.card_id),
            "name": d.name,
            "url": d.url,
            "type": d.type,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


@router.post("/cards/{card_id}/documents", status_code=201)
async def create_document(
    card_id: str,
    body: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(db, user, "documents.manage", card_uuid, "card.manage_documents"):
        raise HTTPException(403, "Not enough permissions")
    doc = Document(
        card_id=card_uuid,
        name=body.name,
        url=body.url,
        type=body.type,
        created_by=user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return {"id": str(doc.id), "name": doc.name, "url": doc.url}


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Document).where(Document.id == uuid.UUID(doc_id)))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if not await PermissionService.check_permission(db, user, "documents.manage", doc.card_id, "card.manage_documents"):
        raise HTTPException(403, "Not enough permissions")
    await db.delete(doc)
    await db.commit()
