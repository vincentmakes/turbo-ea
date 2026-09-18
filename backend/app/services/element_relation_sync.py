"""Sync ProcessElement EA links to the relations table.

When a user links an Application, DataObject, or ITComponent to a process
element, the corresponding EA relation should also exist in the `relations`
table so it shows up in the Relations tab, reports, and dependency graphs.

This module provides a single helper that ensures relations exist (additive
only — never auto-deletes, since the relation may have been created
independently).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relation import Relation

# Mapping from ProcessElement FK field → relation type key
# All three have source = BusinessProcess, target = the linked type.
# The M:N step ↔ Organization links are deliberately NOT in this map:
# they are informative only and never create card-to-card relations
# (process ↔ Organization relations are managed on the card itself).
# One canonical relation type per FK field. Several relation types may now share an
# ordered card-type pair, so this is a *convention* (which type a flow element mints)
# rather than the fact it used to be — a second BusinessProcess→Application type is
# legal and simply cannot be created from the element table. Read paths must not
# inherit this narrowing: process_map_service dispatches by endpoint card type.
ELEMENT_LINK_RELATION_MAP: dict[str, str] = {
    "application_id": "relProcessToApp",
    "data_object_id": "relProcessToDataObj",
    "it_component_id": "relProcessToITC",
    # A call activity's callee — a self-pair, so the loop below skips the
    # process itself: a process that "calls" itself is a modelling error, not
    # a relation.
    "business_process_id": "relProcessCalls",
}

# The FK columns on ``process_elements`` that mint a relation — the key set
# every write path collects from, in one place.
ELEMENT_LINK_KEYS: tuple[str, ...] = tuple(ELEMENT_LINK_RELATION_MAP)


def element_link_ids(elements) -> dict[str, set[uuid.UUID]]:
    """Collect the linked card ids of ``elements`` per FK field, in the shape
    :func:`sync_element_relations` takes."""
    link_ids: dict[str, set[uuid.UUID]] = {key: set() for key in ELEMENT_LINK_KEYS}
    for elem in elements:
        for key in ELEMENT_LINK_KEYS:
            value = getattr(elem, key, None)
            if value:
                link_ids[key].add(value)
    return link_ids


async def sync_element_relations(
    db: AsyncSession,
    process_id: uuid.UUID,
    linked_ids: dict[str, set[uuid.UUID]],
) -> int:
    """Ensure relations exist between a BusinessProcess and linked cards.

    Args:
        db: Async database session (caller is responsible for commit).
        process_id: The BusinessProcess card UUID.
        linked_ids: Dict mapping element FK field name to a set of target
                    card UUIDs.  e.g.
                    {"application_id": {uuid1, uuid2}, "data_object_id": {uuid3}}

    Returns:
        Number of new relations created.
    """
    created = 0

    for field, target_ids in linked_ids.items():
        rel_type = ELEMENT_LINK_RELATION_MAP.get(field)
        if not rel_type or not target_ids:
            continue

        # Load existing relations of this type for this process in one query
        existing = await db.execute(
            select(Relation.target_id).where(
                Relation.type == rel_type,
                Relation.source_id == process_id,
                Relation.target_id.in_(target_ids),
            )
        )
        already_linked = {row[0] for row in existing.all()}

        for tid in target_ids:
            if tid == process_id:
                continue
            if tid not in already_linked:
                db.add(
                    Relation(
                        type=rel_type,
                        source_id=process_id,
                        target_id=tid,
                        description="Auto-created from process flow element table",
                    )
                )
                created += 1

    return created
