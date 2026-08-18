"""The SDK inventory data bridge — extensions' sanctioned path to core cards,
relations, and the metamodel (SDK 1.5).

Read half. Design invariants (mirroring ``todos_bridge``):

* **Grant-gated per call.** Every method re-evaluates
  ``extension_registry.grants_for(key)`` — access revokes the moment the
  extension is disabled, removed, pending restart, or its license
  entitlement stops being usable. Reads need ``core.cards.read`` (or
  ``core.cards.write``, which implies it).
* **Short sessions.** Each call opens its own ``async_session`` and closes
  it before returning — the bridge never hands an extension a session and
  never holds one across non-DB work.
* **Wire-shaped payloads, never ORM rows.** Results are frozen dataclasses
  (:class:`~app.services.extensions.sdk.ExtCard`,
  :class:`~app.services.extensions.sdk.ExtRelation`) or plain dicts with
  string ids and ISO timestamps, safe to serialize as-is and impossible to
  lazy-load from.
* **Read posture is system-level.** The bridge is not a user: RBAC row
  shaping (cost redaction, stakeholder scoping) does not apply. What gates
  it instead is the operator-visible manifest grant. Archived cards and
  hidden-type cards are excluded by default, matching what the UI treats
  as the live inventory.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from app.database import async_session
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtCard,
    ExtCardPage,
    ExtensionPermissionError,
    ExtRelation,
)
from app.services.search_rank import search_filter, search_rank

READ_GRANTS = frozenset({"core.cards.read", "core.cards.write"})
WRITE_GRANT = "core.cards.write"

MAX_PAGE_SIZE = 500


def _to_ext_card(card: Card) -> ExtCard:
    return ExtCard(
        id=str(card.id),
        type=card.type,
        subtype=card.subtype,
        name=card.name,
        description=card.description,
        parent_id=str(card.parent_id) if card.parent_id else None,
        status=card.status,
        approval_status=card.approval_status,
        reference=card.reference,
        alias=card.alias,
        lifecycle=dict(card.lifecycle or {}),
        attributes=dict(card.attributes or {}),
        data_quality=card.data_quality,
        created_at=card.created_at.isoformat() if card.created_at else None,
        updated_at=card.updated_at.isoformat() if card.updated_at else None,
    )


def _to_ext_relation(rel: Relation) -> ExtRelation:
    return ExtRelation(
        id=str(rel.id),
        type=rel.type,
        source_id=str(rel.source_id),
        target_id=str(rel.target_id),
        attributes=dict(rel.attributes or {}),
        description=rel.description,
        created_at=rel.created_at.isoformat() if rel.created_at else None,
    )


def _card_type_to_dict(ct: CardType) -> dict:
    return {
        "key": ct.key,
        "label": ct.label,
        "category": ct.category,
        "icon": ct.icon,
        "color": ct.color,
        "has_hierarchy": ct.has_hierarchy,
        "built_in": ct.built_in,
        "is_hidden": ct.is_hidden,
        "subtypes": list(ct.subtypes or []),
        "fields_schema": list(ct.fields_schema or []),
    }


def _relation_type_to_dict(rt: RelationType) -> dict:
    return {
        "key": rt.key,
        "label": rt.label,
        "reverse_label": rt.reverse_label,
        "source_type_key": rt.source_type_key,
        "target_type_key": rt.target_type_key,
        "cardinality": rt.cardinality,
        "attributes_schema": list(rt.attributes_schema or []),
        "built_in": rt.built_in,
        "is_hidden": rt.is_hidden,
    }


class ExtensionData:
    """Per-extension bridge instance attached to ``ExtensionContext.data``."""

    def __init__(self, key: str):
        self._key = key

    # -- gating ------------------------------------------------------------

    def _require(self, *, write: bool) -> None:
        grants = set(extension_registry.grants_for(self._key))
        if write:
            allowed = WRITE_GRANT in grants
        else:
            allowed = bool(READ_GRANTS & grants)
        if not allowed:
            needed = WRITE_GRANT if write else "core.cards.read"
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {needed} grant "
                "(and an enabled, licensed install) for this call"
            )

    # -- reads -------------------------------------------------------------

    async def get_card(self, card_id: str) -> ExtCard | None:
        self._require(write=False)
        try:
            cid = uuid.UUID(card_id)
        except ValueError:
            return None
        async with async_session() as db:
            card = (await db.execute(select(Card).where(Card.id == cid))).scalar_one_or_none()
            return _to_ext_card(card) if card else None

    async def search_cards(
        self,
        *,
        type: str | None = None,  # noqa: A002 - mirrors GET /cards
        subtype: str | None = None,
        search: str | None = None,
        parent_id: str | None = None,
        include_archived: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> ExtCardPage:
        """List cards with ``GET /cards`` filter semantics.

        Hidden-type cards are always excluded; archived cards only when
        ``include_archived``. Ordered by search relevance (when searching)
        then name, with the id as a stable pagination tiebreaker.
        """
        self._require(write=False)
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), MAX_PAGE_SIZE))

        q = select(Card)
        count_q = select(func.count(Card.id))
        hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
        q = q.where(Card.type.not_in(hidden_types_sq))
        count_q = count_q.where(Card.type.not_in(hidden_types_sq))

        if type:
            q = q.where(Card.type == type)
            count_q = count_q.where(Card.type == type)
        if subtype:
            q = q.where(Card.subtype == subtype)
            count_q = count_q.where(Card.subtype == subtype)
        if not include_archived:
            q = q.where(Card.status == "ACTIVE")
            count_q = count_q.where(Card.status == "ACTIVE")
        if search:
            match = or_(search_filter(Card.name, search), search_filter(Card.description, search))
            q = q.where(match)
            count_q = count_q.where(match)
        if parent_id:
            pid = uuid.UUID(parent_id)
            q = q.where(Card.parent_id == pid)
            count_q = count_q.where(Card.parent_id == pid)

        order = [Card.name.asc(), Card.id.asc()]
        if search:
            order.insert(0, search_rank(Card.name, search).asc())
        q = q.order_by(*order).offset((page - 1) * page_size).limit(page_size)

        async with async_session() as db:
            total = (await db.execute(count_q)).scalar() or 0
            cards = (await db.execute(q)).scalars().all()
            return ExtCardPage(
                items=tuple(_to_ext_card(c) for c in cards),
                total=int(total),
                page=page,
                page_size=page_size,
            )

    async def get_relations(self, card_id: str) -> list[ExtRelation]:
        """Every relation touching ``card_id`` in either direction, excluding
        relations whose other endpoint is archived (matching ``GET
        /relations`` — those rows reappear on restore)."""
        self._require(write=False)
        try:
            cid = uuid.UUID(card_id)
        except ValueError:
            return []
        src = aliased(Card)
        tgt = aliased(Card)
        q = (
            select(Relation)
            .join(src, Relation.source_id == src.id)
            .join(tgt, Relation.target_id == tgt.id)
            .where(or_(Relation.source_id == cid, Relation.target_id == cid))
            .where(src.status != "ARCHIVED", tgt.status != "ARCHIVED")
            .order_by(Relation.type.asc(), Relation.id.asc())
        )
        async with async_session() as db:
            rels = (await db.execute(q)).scalars().all()
            return [_to_ext_relation(r) for r in rels]

    async def get_card_types(self) -> list[dict]:
        self._require(write=False)
        async with async_session() as db:
            rows = (
                (
                    await db.execute(
                        select(CardType)
                        .where(CardType.is_hidden == False)  # noqa: E712
                        .order_by(CardType.sort_order.asc(), CardType.key.asc())
                    )
                )
                .scalars()
                .all()
            )
            return [_card_type_to_dict(ct) for ct in rows]

    async def get_relation_types(self) -> list[dict]:
        self._require(write=False)
        async with async_session() as db:
            rows = (
                (
                    await db.execute(
                        select(RelationType)
                        .where(RelationType.is_hidden == False)  # noqa: E712
                        .order_by(RelationType.sort_order.asc(), RelationType.key.asc())
                    )
                )
                .scalars()
                .all()
            )
            return [_relation_type_to_dict(rt) for rt in rows]
