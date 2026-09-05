"""Shared decision-record (ADR) creation — one writer for every caller.

Three paths create an ``ArchitectureDecision`` row: ``POST /adr``, the
analysis commit flow (``turbolens_commit``) and, since SDK 1.8, the
extension decisions bridge. Until this module existed the first two each
carried their own copy of the reference-number generator, which is exactly
how two writers drift apart. This is the B0-style extraction the card routes
already have in ``card_write_service``: callers own the transaction, helpers
flush and NEVER commit, and HTTP-flavoured errors stay ``HTTPException`` so
the REST route's status codes are byte-identical (non-HTTP callers translate).

Creation publishes one ``adr.created`` event (no ``card_id`` — a decision is
not a card, so it never lands on a card's History tab), carrying the id,
reference and linked cards: that is what lets a mutation batch that filed a
draft be rolled back from the Audit Log. Nothing else about the event is
load-bearing; the ``updated_at`` invariant does not apply to decisions.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card import Card
from app.services.event_bus import event_bus


async def next_reference_number(db: AsyncSession) -> str:
    """The next ``ADR-NNN`` reference (``ADR-001`` on an empty table)."""
    result = await db.execute(select(func.max(ArchitectureDecision.reference_number)))
    max_ref = result.scalar_one_or_none()
    if max_ref:
        num = int(max_ref.replace("ADR-", "")) + 1
    else:
        num = 1
    return f"ADR-{num:03d}"


async def resolve_card_ids(db: AsyncSession, card_ids: Sequence[str]) -> list[uuid.UUID]:
    """Parse and verify a list of card UUIDs, raising 400/404 with the
    offending values so a bad link list never silently no-ops."""
    parsed: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for cid in card_ids:
        try:
            parsed_id = uuid.UUID(cid)
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(400, f"Invalid card id: {cid!r}") from None
        if parsed_id not in seen:
            seen.add(parsed_id)
            parsed.append(parsed_id)
    if parsed:
        result = await db.execute(select(Card.id).where(Card.id.in_(parsed)))
        found = set(result.scalars().all())
        missing = [str(cid) for cid in parsed if cid not in found]
        if missing:
            raise HTTPException(404, f"Cards not found: {', '.join(missing)}")
    return parsed


async def create_decision(
    db: AsyncSession,
    *,
    title: str,
    context: str | None = None,
    decision: str | None = None,
    consequences: str | None = None,
    alternatives_considered: str | None = None,
    related_decisions: list[Any] | None = None,
    attributes: dict[str, Any] | None = None,
    linked_card_ids: Sequence[uuid.UUID] = (),
    created_by: uuid.UUID | None = None,
) -> ArchitectureDecision:
    """Insert a draft decision and its card links; flush, never commit.

    ``status`` is not a parameter on purpose — a new decision is always a
    draft; signing and status transitions have their own routes. Linked
    card ids are expected to be resolved already (``resolve_card_ids`` or
    the caller's own check); duplicates link once.
    """
    adr = ArchitectureDecision(
        reference_number=await next_reference_number(db),
        title=title,
        context=context,
        decision=decision,
        consequences=consequences,
        alternatives_considered=alternatives_considered,
        related_decisions=list(related_decisions or []),
        attributes=dict(attributes or {}),
        created_by=created_by,
    )
    db.add(adr)
    await db.flush()
    seen: set[uuid.UUID] = set()
    for cid in linked_card_ids:
        if cid in seen:
            continue
        seen.add(cid)
        db.add(ArchitectureDecisionCard(architecture_decision_id=adr.id, card_id=cid))
    await db.flush()
    await event_bus.publish(
        "adr.created",
        {
            "adr_id": str(adr.id),
            "reference_number": adr.reference_number,
            "title": adr.title,
            "status": adr.status,
            "linked_card_ids": [str(cid) for cid in seen],
        },
        db=db,
        user_id=created_by,
    )
    return adr
