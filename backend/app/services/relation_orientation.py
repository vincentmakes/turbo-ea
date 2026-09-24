"""Every relation is stored in its relation type's direction.

A relation type declares a direction — ``relAppToInterface`` runs from an
Application to an Interface — and a relation row is only meaningful stored that
way round. Its attributes are read on the type's axis too: ``flowDirection`` is
offered in card detail as the *Application's* role (``forward`` = Provider,
``reverse`` = Consumer), and every surface that shows a relation — card detail,
the inventory grid, the reports, the dependency view, diagrams — reads the row
as source-of-the-type → target-of-the-type.

A row stored the other way round (Interface as source, Application as target)
therefore breaks all of them at once: card detail and the inventory list it on
neither card, and an arrow drawn from it shows a provider as a consumer
(discussion #1140). The UI always sends the ends the right way round, but the
API accepts card ids without checking them against the type, so every backend
write path turns a swapped pair round here before it looks anything up or
inserts — silently, keeping the attributes exactly as sent, so an import or an
integration that got the order wrong still lands what it meant. Migration
``153_orient_relations_to_their_type`` repaired the rows written before this.

``test_relation_orientation.py::test_every_relation_writer_orients`` fails on
any module that constructs a ``Relation`` without going through this module
(or being listed there with the reason its direction is fixed).
"""

from __future__ import annotations

import uuid
from typing import Protocol, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation_type import RelationType

_Id = TypeVar("_Id")


class _TypedEnds(Protocol):
    source_type_key: str
    target_type_key: str


def runs_against_type(
    rt: _TypedEnds | None,
    source_type: str | None,
    target_type: str | None,
) -> bool:
    """True when a relation whose source card is of ``source_type`` and whose
    target card is of ``target_type`` runs against ``rt``'s direction.

    Never true for a self-referencing type — there the stored direction *is*
    the meaning — and false whenever anything is unknown, so a pair this module
    cannot judge is left exactly as it was sent. Mirrors ``runsAgainstType`` in
    ``frontend/src/lib/relationSort.ts``.
    """
    if rt is None or not source_type or not target_type:
        return False
    if rt.source_type_key == rt.target_type_key:
        return False
    return source_type == rt.target_type_key and target_type == rt.source_type_key


def oriented(
    rt: _TypedEnds | None,
    source_id: _Id,
    target_id: _Id,
    source_type: str | None,
    target_type: str | None,
) -> tuple[_Id, _Id]:
    """``(source_id, target_id)`` in ``rt``'s direction, for a caller that
    already knows both card types."""
    if runs_against_type(rt, source_type, target_type):
        return target_id, source_id
    return source_id, target_id


def direction_for(rt: _TypedEnds | None, card_type: str, requested: str) -> str:
    """``"outgoing"`` when a card of ``card_type`` sits at the source end of
    ``rt``, ``"incoming"`` at the target end — whatever ``requested`` says.

    Only a self-referencing type (either end fits) or an unknown one keeps the
    requested direction, because there the direction is the caller's to say.
    For a caller that looks rows up per side before writing, so the lookup and
    the insert agree on which end the card is.
    """
    if rt is not None and rt.source_type_key != rt.target_type_key:
        if card_type == rt.source_type_key:
            return "outgoing"
        if card_type == rt.target_type_key:
            return "incoming"
    return requested


async def orient_endpoints(
    db: AsyncSession,
    rt: _TypedEnds | str | None,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> tuple[uuid.UUID, uuid.UUID]:
    """``(source_id, target_id)`` in the relation type's direction.

    ``rt`` is the relation type or its key. Loads the two cards' types in one
    query; a missing card or an unknown relation type returns the pair
    unchanged, so the caller's own error handling still decides what happens
    to it.
    """
    if isinstance(rt, str):
        rt = (
            await db.execute(select(RelationType).where(RelationType.key == rt))
        ).scalar_one_or_none()
    if rt is None or rt.source_type_key == rt.target_type_key:
        return source_id, target_id
    rows = await db.execute(select(Card.id, Card.type).where(Card.id.in_([source_id, target_id])))
    type_by_id = {row[0]: row[1] for row in rows.all()}
    return oriented(rt, source_id, target_id, type_by_id.get(source_id), type_by_id.get(target_id))
