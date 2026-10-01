from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.document import Document
from app.models.user import User
from app.schemas.common import DocumentCreate, DocumentUpdate
from app.services.card_read_scope import require_card_readable
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(tags=["documents"])

# The fields a PATCH may change; also the keys a ``document.updated`` event's
# ``changes`` dict can carry.
_EDITABLE_FIELDS = ("name", "url", "type")


def _doc_row(d: Document) -> dict:
    """The one wire shape for a document link — list rows and PATCH alike."""
    return {
        "id": str(d.id),
        "card_id": str(d.card_id),
        "name": d.name,
        "url": d.url,
        "type": d.type,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


@router.get("/cards/{card_id}/documents")
async def list_documents(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "documents.view")
    await require_card_readable(db, user, uuid.UUID(card_id), mode="module")
    result = await db.execute(select(Document).where(Document.card_id == uuid.UUID(card_id)))
    docs = result.scalars().all()
    return [_doc_row(d) for d in docs]


@router.post("/cards/{card_id}/documents", status_code=201)
async def create_document(
    card_id: str,
    body: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "documents.manage", card_uuid, "card.manage_documents"
    ):
        raise HTTPException(403, "Not enough permissions")
    doc = Document(
        card_id=card_uuid,
        name=body.name,
        url=body.url,
        type=body.type,
        created_by=user.id,
    )
    db.add(doc)
    await db.flush()
    await event_bus.publish(
        "document.added",
        {
            "document_id": str(doc.id),
            "name": doc.name,
            "url": doc.url,
            "type": doc.type,
            "summary": doc.name or doc.url,
        },
        db=db,
        card_id=card_uuid,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(doc)
    return {"id": str(doc.id), "name": doc.name, "url": doc.url}


@router.patch("/documents/{doc_id}")
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit a document link's name, URL or type.

    Same authority as deleting it (``documents.manage`` or the card-level
    ``card.manage_documents``). Only the fields that actually move are
    written and recorded, as ``changes = {field: {"old", "new"}}`` on a
    ``document.updated`` event — the shape the card's History tab renders.
    A PATCH that changes nothing writes nothing and emits nothing, so a
    re-saved dialog never moves the card's Modified date (#1166).
    """
    result = await db.execute(select(Document).where(Document.id == uuid.UUID(doc_id)))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if not await PermissionService.check_permission(
        db, user, "documents.manage", doc.card_id, "card.manage_documents"
    ):
        raise HTTPException(403, "Not enough permissions")

    data = body.model_dump(exclude_unset=True)
    changes = {
        field: {"old": getattr(doc, field), "new": value}
        for field, value in data.items()
        if field in _EDITABLE_FIELDS and getattr(doc, field) != value
    }
    if not changes:
        return _doc_row(doc)

    for field, change in changes.items():
        setattr(doc, field, change["new"])
    await db.flush()
    await event_bus.publish(
        "document.updated",
        {
            "document_id": str(doc.id),
            "name": doc.name,
            "url": doc.url,
            "type": doc.type,
            "summary": doc.name or doc.url,
            "changes": changes,
        },
        db=db,
        card_id=doc.card_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(doc)
    return _doc_row(doc)


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
    if not await PermissionService.check_permission(
        db, user, "documents.manage", doc.card_id, "card.manage_documents"
    ):
        raise HTTPException(403, "Not enough permissions")
    await event_bus.publish(
        "document.removed",
        {
            "document_id": str(doc.id),
            "name": doc.name,
            "url": doc.url,
            "type": doc.type,
            "summary": doc.name or doc.url,
        },
        db=db,
        card_id=doc.card_id,
        user_id=user.id,
    )
    await db.delete(doc)
    await db.commit()
