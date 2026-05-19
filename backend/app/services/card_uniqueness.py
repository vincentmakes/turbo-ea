"""Sibling-name uniqueness enforcement.

The LeanIX-style spreadsheet format identifies cards by their human-readable
`(type, parent_path, name)` tuple — UUIDs are intentionally absent so users
can edit exports in Excel without copy-pasting opaque ids. That format
collapses when two cards of the same type sit under the same parent with
the same name: every relation cell pointing at either of them becomes
ambiguous on import.

This module guards card writes against introducing new such duplicates.
Application-level only — we deliberately do **not** add a unique index on
the `cards` table, because doing so would require a migration that would
fail against databases carrying pre-existing duplicates from earlier
releases (and from the demo seed). Existing duplicates therefore stay
in place; the check only rejects writes that would *worsen* the situation.

Matching rules mirror `CardResolver.resolve()` in `card_resolver.py`:
case-insensitive after `.strip()`, so the importer and the validator can
never disagree about what counts as the same name.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card


async def check_sibling_name_unique(
    db: AsyncSession,
    *,
    type_key: str,
    parent_id: uuid.UUID | None,
    name: str,
    exclude_card_id: uuid.UUID | None = None,
) -> None:
    """Raise `HTTPException(409)` when another active card of `type_key`
    already sits at the same `(parent_id, name)` slot.

    `parent_id=None` means the implicit root — two root-level siblings with
    the same name are still a collision. `exclude_card_id` lets PATCH callers
    skip the card they're updating (so renaming a card to its own current
    name doesn't fire). Active cards only — archived ones never collide,
    mirroring the resolver's `status == "ACTIVE"` filter.
    """
    normalised = name.strip().lower()
    if not normalised:
        # An empty name isn't unique to anything; let the existing
        # not-null validator deal with that case.
        return

    q = select(Card.id, Card.name).where(
        Card.type == type_key,
        Card.status == "ACTIVE",
        func.lower(func.trim(Card.name)) == normalised,
    )
    if parent_id is None:
        q = q.where(Card.parent_id.is_(None))
    else:
        q = q.where(Card.parent_id == parent_id)
    if exclude_card_id is not None:
        q = q.where(Card.id != exclude_card_id)

    result = await db.execute(q.limit(1))
    row = result.first()
    if row is None:
        return

    existing_id, existing_name = row
    raise HTTPException(
        status_code=409,
        detail=(
            f'A {type_key} named "{existing_name}" already exists at this level '
            f"(existing card: {existing_id})."
        ),
    )
