"""Card lifecycle helpers — descendant collection and child/relation strategies.

Centralises the graph logic used by archive, hard-delete, and the auto-purge
loop. Keeps `app/api/v1/cards.py` focused on HTTP concerns.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType

ChildStrategy = Literal["cascade", "disconnect", "reparent"]

# Mirrors the existing approval-break rule in update_card. Direct children whose
# `parent_id` is mutated by `disconnect` / `reparent` get `approval_status` flipped
# to BROKEN if they were previously APPROVED — same semantics as a manual edit.
STATUS_BREAKING_FIELDS: frozenset[str] = frozenset(
    {"name", "description", "lifecycle", "attributes", "subtype", "alias", "parent_id"}
)

# Defensive cap so a corrupted parent_id chain or a typo can't blow up the worker.
_MAX_DESCENDANTS = 10_000

_RECURSIVE_DESCENDANTS_SQL = text(
    """
    WITH RECURSIVE descendants(id, parent_id, depth) AS (
        SELECT c.id, c.parent_id, 1
        FROM cards c
        WHERE c.parent_id = :root_id
        UNION ALL
        SELECT c.id, c.parent_id, d.depth + 1
        FROM cards c
        JOIN descendants d ON c.parent_id = d.id
        WHERE d.depth < 64
    )
    SELECT id, depth FROM descendants
    """
)


@dataclass
class ChildStrategyResult:
    strategy: ChildStrategy
    direct_children_ids: list[uuid.UUID] = field(default_factory=list)
    descendants_affected: int = 0  # cascade only
    disconnected_ids: list[uuid.UUID] = field(default_factory=list)
    reparent_target_id: uuid.UUID | None = None
    approval_broken_ids: list[uuid.UUID] = field(default_factory=list)


async def collect_descendants(
    db: AsyncSession, root_id: uuid.UUID, *, max_nodes: int = _MAX_DESCENDANTS
) -> list[uuid.UUID]:
    """Return all descendant card IDs of `root_id` ordered deepest-first.

    Uses a recursive CTE so the cost is one round-trip even for deep trees.
    Cycle-safe via the recursive `WHERE depth < 64` cap and by the underlying
    `parent_id` graph being a DAG (the FK is self-referential and one-direction).
    Raises 400 if the subtree exceeds `max_nodes`.
    """
    rows = await db.execute(_RECURSIVE_DESCENDANTS_SQL, {"root_id": root_id})
    pairs = [(uuid.UUID(str(row[0])), int(row[1])) for row in rows.all()]
    if len(pairs) > max_nodes:
        raise HTTPException(
            400,
            f"subtree_too_large: {len(pairs)} descendants exceeds the {max_nodes} cap",
        )
    pairs.sort(key=lambda p: p[1], reverse=True)
    return [pid for pid, _ in pairs]


async def direct_children(db: AsyncSession, parent_id: uuid.UUID) -> list[Card]:
    """Return direct children (any status) so disconnect/reparent also tidies archived rows.

    The dialog only lists ACTIVE children, but a reparent on a parent that holds
    archived children should still mutate them — otherwise the FK would still
    point at a card that's about to be archived/deleted.
    """
    res = await db.execute(select(Card).where(Card.parent_id == parent_id))
    return list(res.scalars().all())


async def apply_child_strategy(
    db: AsyncSession,
    primary: Card,
    strategy: ChildStrategy,
    user_id: uuid.UUID | None,
) -> ChildStrategyResult:
    """Mutate direct children per `strategy`. Caller owns the transaction.

    - `cascade`: caller is responsible for archiving/deleting the descendants
      collected via `collect_descendants` — we leave `parent_id` intact so the
      child rows are still walkable while the cascade is being applied.
    - `disconnect`: each direct child's `parent_id` becomes NULL.
    - `reparent`: each direct child's `parent_id` becomes `primary.parent_id`.
      Falls back to `disconnect` if the primary has no parent.

    Mirrors the manual-edit approval-break rule: APPROVED direct children whose
    `parent_id` is mutated become BROKEN.
    """
    result = ChildStrategyResult(strategy=strategy)
    children = await direct_children(db, primary.id)
    result.direct_children_ids = [c.id for c in children]

    if strategy == "cascade" or not children:
        return result

    new_parent_id: uuid.UUID | None = None
    if strategy == "reparent":
        new_parent_id = primary.parent_id  # may be None → effective disconnect
        result.reparent_target_id = new_parent_id

    for child in children:
        old = child.parent_id
        if old == new_parent_id:
            continue
        child.parent_id = new_parent_id
        if user_id is not None:
            child.updated_by = user_id
        if child.approval_status == "APPROVED":
            child.approval_status = "BROKEN"
            result.approval_broken_ids.append(child.id)
        result.disconnected_ids.append(child.id)

    # Recompute hierarchy levels for reparented children (hierarchyLevel for any
    # hierarchical type, capabilityLevel for BusinessCapability) and re-run
    # calculations for every card whose level moved, so hierarchy_level / parent
    # formulas stay correct after the subtree move. Imported lazily to avoid a
    # circular import with the cards router module.
    from app.api.v1.cards import (  # noqa: PLC0415
        _recalc_changed_descendants,
        _sync_hierarchy_levels,
    )

    for child in children:
        changed = await _sync_hierarchy_levels(db, child)
        await _recalc_changed_descendants(db, changed, primary.id)

    return result


async def gather_archive_impact(
    db: AsyncSession, primary: Card
) -> tuple[
    list[Card],
    Card | None,
    list[tuple[Relation, Card, str, str]],  # rel, peer, direction, label
]:
    """Build the data the archive-impact endpoint and dialog need.

    Returns (active direct children, grandparent_card_or_none, related_rows).
    Each related row is `(relation, peer_card, direction, localised_label)`.
    Hidden card-types are filtered out, mirroring the relations list endpoint.
    """
    children_res = await db.execute(
        select(Card)
        .where(Card.parent_id == primary.id, Card.status == "ACTIVE")
        .order_by(Card.name)
    )
    active_children = list(children_res.scalars().all())

    grandparent: Card | None = None
    if primary.parent_id:
        gp_res = await db.execute(select(Card).where(Card.id == primary.parent_id))
        grandparent = gp_res.scalar_one_or_none()

    # Exclude peers that are hidden by type OR already archived. Archived peers
    # should never appear in an active card's archive-impact dialog because
    # they're no longer part of the active landscape (sever-on-archive rule).
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden.is_(True))
    excluded_card_ids_sq = select(Card.id).where(
        or_(Card.type.in_(hidden_types_sq), Card.status == "ARCHIVED")
    )
    rel_res = await db.execute(
        select(Relation).where(
            or_(Relation.source_id == primary.id, Relation.target_id == primary.id),
            Relation.source_id.not_in(excluded_card_ids_sq),
            Relation.target_id.not_in(excluded_card_ids_sq),
        )
    )
    relations = list(rel_res.scalars().all())

    peer_ids: set[uuid.UUID] = set()
    for rel in relations:
        peer_ids.add(rel.target_id if rel.source_id == primary.id else rel.source_id)
    peers_res = await db.execute(select(Card).where(Card.id.in_(peer_ids))) if peer_ids else None
    peers_by_id: dict[uuid.UUID, Card] = (
        {c.id: c for c in peers_res.scalars().all()} if peers_res else {}
    )

    rel_type_keys = {rel.type for rel in relations}
    rt_rows = await db.execute(select(RelationType).where(RelationType.key.in_(rel_type_keys)))
    rel_types_by_key = {rt.key: rt for rt in rt_rows.scalars().all()}

    related_rows: list[tuple[Relation, Card, str, str]] = []
    for rel in relations:
        is_outgoing = rel.source_id == primary.id
        peer_id = rel.target_id if is_outgoing else rel.source_id
        peer = peers_by_id.get(peer_id)
        if peer is None:
            continue
        rt = rel_types_by_key.get(rel.type)
        if rt is None:
            label = rel.type
        else:
            label = rt.label if is_outgoing else (rt.reverse_label or rt.label)
        related_rows.append((rel, peer, "outgoing" if is_outgoing else "incoming", label))

    related_rows.sort(key=lambda row: (row[3].lower(), row[1].name.lower()))
    return active_children, grandparent, related_rows


async def expand_cascade_all_related(db: AsyncSession, primary_id: uuid.UUID) -> list[uuid.UUID]:
    """Resolve direct peer-card IDs for `cascade_all_related=true` (bulk mode).

    Hidden types are filtered, matching `gather_archive_impact`.
    """
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden.is_(True))
    excluded_card_ids_sq = select(Card.id).where(Card.type.in_(hidden_types_sq))
    res = await db.execute(
        select(Relation.source_id, Relation.target_id).where(
            or_(Relation.source_id == primary_id, Relation.target_id == primary_id),
            Relation.source_id.not_in(excluded_card_ids_sq),
            Relation.target_id.not_in(excluded_card_ids_sq),
        )
    )
    peers: set[uuid.UUID] = set()
    for source_id, target_id in res.all():
        peers.add(target_id if source_id == primary_id else source_id)
    peers.discard(primary_id)
    return list(peers)


def archive_cards_in_place(cards: list[Card], user_id: uuid.UUID | None) -> list[Card]:
    """Flip ACTIVE cards to ARCHIVED in-place. Returns the cards that changed."""
    now = datetime.now(timezone.utc)
    changed: list[Card] = []
    for card in cards:
        if card.status == "ARCHIVED":
            continue
        card.status = "ARCHIVED"
        card.archived_at = now
        if user_id is not None:
            card.updated_by = user_id
        changed.append(card)
    return changed


async def find_latest_archive_batch(db: AsyncSession, card_id: uuid.UUID) -> dict | None:
    """Return the most recent `card.archived.batch` event payload keyed to `card_id`.

    The batch event records `affected_children_ids` and `affected_related_card_ids`
    — i.e. the passengers archived alongside this card. None if the card has
    never been the root of a batch archive.
    """
    from app.models.event import Event  # local import — avoids cycle

    res = await db.execute(
        select(Event.data)
        .where(Event.card_id == card_id, Event.event_type == "card.archived.batch")
        .order_by(Event.created_at.desc())
        .limit(1)
    )
    row = res.first()
    return row[0] if row else None


async def gather_restore_impact(db: AsyncSession, primary: Card) -> list[tuple[Card, str]]:
    """Return passengers (still-archived cards from the latest batch) with role."""
    batch = await find_latest_archive_batch(db, primary.id)
    if not batch:
        return []
    child_ids = [uuid.UUID(x) for x in batch.get("affected_children_ids") or []]
    related_ids = [uuid.UUID(x) for x in batch.get("affected_related_card_ids") or []]
    all_ids = list({*child_ids, *related_ids})
    if not all_ids:
        return []
    res = await db.execute(
        select(Card).where(Card.id.in_(all_ids), Card.status == "ARCHIVED").order_by(Card.name)
    )
    rows = list(res.scalars().all())
    role_for: dict[uuid.UUID, str] = {}
    for cid in child_ids:
        role_for[cid] = "child"
    for cid in related_ids:
        role_for.setdefault(cid, "related")
    return [(c, role_for.get(c.id, "related")) for c in rows]
