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
# All four have source = BusinessProcess, target = the linked type.
ELEMENT_LINK_RELATION_MAP: dict[str, str] = {
    "application_id": "relProcessToApp",
    "data_object_id": "relProcessToDataObj",
    "it_component_id": "relProcessToITC",
    "organization_id": "relProcessToOrg",
}


def collect_effective_org_ids(
    elements: list,
    lane_links: dict[str, uuid.UUID | str | None],
) -> set[uuid.UUID]:
    """Compute the effective Organization ids for a set of process elements.

    A step's effective organization is its explicit ``organization_id`` when
    set, otherwise the Organization bound to its lane. Elements without either
    contribute nothing.

    Args:
        elements: ProcessElement rows (or any objects with ``organization_id``
                  and ``lane_name`` attributes).
        lane_links: Mapping of lane name → Organization card UUID (str or
                    UUID; ``None``/empty values are ignored).

    Returns:
        Set of Organization card UUIDs.
    """
    normalized: dict[str, uuid.UUID] = {}
    for lane_name, org_id in (lane_links or {}).items():
        if org_id:
            normalized[lane_name] = org_id if isinstance(org_id, uuid.UUID) else uuid.UUID(org_id)

    org_ids: set[uuid.UUID] = set()
    for el in elements:
        if el.organization_id:
            org_ids.add(el.organization_id)
        elif el.lane_name and el.lane_name in normalized:
            org_ids.add(normalized[el.lane_name])
    return org_ids


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
