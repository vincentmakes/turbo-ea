"""The SDK inventory data bridge — extensions' sanctioned path to core cards,
relations, and the metamodel (SDK 1.5).

Design invariants (mirroring ``todos_bridge``):

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
* **Writes are guarded in depth.** Every write delegates to the shared
  ``card_write_service`` (identical validation and side effects to the
  REST routes), runs in its own short session with origin ``"ext"`` and an
  ``ext:{key}`` mutation batch (grouped under ``batch(label)`` when the
  caller opens one), is size-capped per batch and rate-capped per
  extension, honours the instance-wide ``EXTENSION_WRITES_ENABLED`` kill
  switch, and supports ``dry_run`` (validate, then discard — no commit, no
  events). ``update_card`` MERGES the attributes patch so an enrichment
  write never wipes keys it does not carry; there is no hard delete and no
  relation delete.
"""

from __future__ import annotations

import time
import uuid
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings
from app.database import async_session
from app.models.card import Card
from app.models.card_type import CardType
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services import card_lifecycle, card_write_service, mutation_batch_service
from app.services.card_write_service import WriteActor
from app.services.event_bus import request_batch_id, request_origin
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtCard,
    ExtCardPage,
    ExtensionDataError,
    ExtensionPermissionError,
    ExtRelation,
)
from app.services.search_rank import search_filter, search_rank

READ_GRANTS = frozenset({"core.cards.read", "core.cards.write"})
WRITE_GRANT = "core.cards.write"

MAX_PAGE_SIZE = 500

# Card fields an extension update may touch. Everything else — reference,
# external_id (import identity), status / approval_status (workflow-owned),
# audit columns — is refused with an explicit error rather than ignored.
UPDATABLE_CARD_FIELDS = frozenset(
    {"name", "description", "subtype", "parent_id", "lifecycle", "attributes", "alias"}
)

_T = TypeVar("_T")


@dataclass
class _ActiveBatch:
    """Task-local state for an explicit ``batch(label)`` scope."""

    id: uuid.UUID
    label: str
    writes: int = 0


# ContextVar (not instance state): jobs, event handlers, and route tasks may
# share one memoized bridge instance concurrently — the active batch must be
# scoped to the task that opened it.
_active_batch: ContextVar[_ActiveBatch | None] = ContextVar("ext_active_batch", default=None)

# Sliding one-minute window of batch openings per extension key (implicit
# single-write batches included). In-process by design — the deployment is a
# single uvicorn worker.
_batch_times: dict[str, deque[float]] = {}
_RATE_WINDOW_SECONDS = 60.0


def reset_rate_limiter() -> None:
    """Test helper — drop the sliding-window state."""
    _batch_times.clear()


def _parse_uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (TypeError, ValueError) as e:
        raise ExtensionDataError(f"Invalid {what}: {value!r}") from e


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

        if search:
            q = q.order_by(search_rank(Card.name, search).asc(), Card.name.asc(), Card.id.asc())
        else:
            q = q.order_by(Card.name.asc(), Card.id.asc())
        q = q.offset((page - 1) * page_size).limit(page_size)

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

    # -- write plumbing ------------------------------------------------------

    def _actor(self) -> WriteActor:
        info = extension_registry.get(self._key)
        display = (info.name if info else None) or self._key
        return WriteActor(user_id=None, display_name=display, ext_key=self._key)

    def _require_writes_enabled(self) -> None:
        if not settings.EXTENSION_WRITES_ENABLED:
            raise ExtensionPermissionError(
                "Extension writes are disabled on this instance (EXTENSION_WRITES_ENABLED=false)"
            )

    def _count_batch_against_rate(self) -> None:
        """Sliding-window cap on batch openings (implicit ones included) so a
        looping extension cannot flood the audit log or the inventory."""
        now = time.monotonic()
        window = _batch_times.setdefault(self._key, deque())
        while window and now - window[0] > _RATE_WINDOW_SECONDS:
            window.popleft()
        if len(window) >= settings.EXTENSION_MAX_BATCHES_PER_MINUTE:
            raise ExtensionDataError(
                f"Extension {self._key} exceeded the write rate cap "
                f"({settings.EXTENSION_MAX_BATCHES_PER_MINUTE} batches/minute)"
            )
        window.append(now)

    def _count_write_in_batch(self) -> None:
        active = _active_batch.get()
        if active is None:
            return
        active.writes += 1
        if active.writes > settings.EXTENSION_MAX_WRITES_PER_BATCH:
            raise ExtensionDataError(
                f"Batch {active.label!r} exceeded the per-batch write cap "
                f"({settings.EXTENSION_MAX_WRITES_PER_BATCH})"
            )

    def batch(self, label: str):
        """Group several writes into one audited ``ext:{key}`` mutation batch.

        Usage: ``async with ctx.data.batch("nightly sync"): ...``. Without an
        open batch every write opens its own single-op batch. Batches never
        nest, and a dry-run write inside a batch still joins nothing (a
        preview leaves no audit trail).
        """
        return self._batch_cm(label)

    @asynccontextmanager
    async def _batch_cm(self, label: str) -> AsyncIterator[None]:
        self._require(write=True)
        self._require_writes_enabled()
        if _active_batch.get() is not None:
            raise ExtensionDataError("Extension write batches cannot nest")
        self._count_batch_against_rate()
        async with async_session() as db:
            batch = await mutation_batch_service.create_batch(
                db,
                tool_name=f"ext:{self._key}"[:100],
                actor=None,
                origin="ext",
                dry_run=False,
            )
            await db.commit()
            batch_id = batch.id
        state = _ActiveBatch(id=batch_id, label=label)
        active_token = _active_batch.set(state)
        origin_token = request_origin.set("ext")
        batch_token = request_batch_id.set(batch_id)
        try:
            yield
            async with async_session() as db:
                row = await db.get(MutationBatch, batch_id)
                if row is not None:
                    await mutation_batch_service.commit_batch(
                        db, row, summary={"label": label, "writes": state.writes}
                    )
                    await db.commit()
        finally:
            request_batch_id.reset(batch_token)
            request_origin.reset(origin_token)
            _active_batch.reset(active_token)

    async def _write(
        self, op: Callable[[AsyncSession], Awaitable[_T]], *, dry_run: bool = False
    ) -> _T:
        """Run ``op(db)`` in a fresh short session with ext provenance.

        Inside an open ``batch()`` scope the write joins that batch;
        otherwise it opens (and commits) its own single-op batch. A dry-run
        write validates and then discards the session without committing —
        no rows, no events, no audit trail.
        """
        self._require(write=True)
        self._require_writes_enabled()
        if dry_run:
            # Validate + resolve, then roll the savepoint back: no rows, no
            # events (the service gates emission on dry_run), no audit batch.
            # expire_all clears the in-memory ORM mutations the rollback
            # cannot undo, so nothing from the preview can leak into a later
            # flush on the same connection.
            async with async_session() as db:
                sp = await db.begin_nested()
                try:
                    result = await op(db)
                except HTTPException as e:
                    raise ExtensionDataError(str(e.detail)) from e
                finally:
                    if sp.is_active:
                        await sp.rollback()
                    db.expire_all()
                return result

        active = _active_batch.get()
        if active is not None:
            self._count_write_in_batch()
            async with async_session() as db:
                try:
                    result = await op(db)
                except HTTPException as e:
                    raise ExtensionDataError(str(e.detail)) from e
                await db.commit()
                return result

        # Implicit single-op batch (todos-bridge shape).
        self._count_batch_against_rate()
        origin_token = request_origin.set("ext")
        batch_token = None
        try:
            async with async_session() as db:
                batch = await mutation_batch_service.create_batch(
                    db,
                    tool_name=f"ext:{self._key}"[:100],
                    actor=None,
                    origin="ext",
                    dry_run=False,
                )
                batch_token = request_batch_id.set(batch.id)
                try:
                    result = await op(db)
                except HTTPException as e:
                    raise ExtensionDataError(str(e.detail)) from e
                await mutation_batch_service.commit_batch(db, batch)
                await db.commit()
                return result
        finally:
            if batch_token is not None:
                request_batch_id.reset(batch_token)
            request_origin.reset(origin_token)

    # -- writes --------------------------------------------------------------

    async def create_card(
        self,
        *,
        type: str,  # noqa: A002 - mirrors POST /cards
        name: str,
        subtype: str | None = None,
        description: str | None = None,
        parent_id: str | None = None,
        lifecycle: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        alias: str | None = None,
        dry_run: bool = False,
    ) -> ExtCard:
        parent_uuid = _parse_uuid(parent_id, "parent_id") if parent_id else None

        async def op(db: AsyncSession) -> ExtCard:
            card = await card_write_service.create_card(
                db,
                self._actor(),
                type_key=type,
                name=name,
                subtype=subtype,
                description=description,
                parent_id=parent_uuid,
                lifecycle=lifecycle,
                attributes=attributes,
                alias=alias,
                dry_run=dry_run,
            )
            # Server-side timestamp defaults are expired after the flush;
            # refresh so the wire mapping below never lazy-loads.
            await db.refresh(card)
            return _to_ext_card(card)

        return await self._write(op, dry_run=dry_run)

    async def update_card(
        self,
        card_id: str,
        patch: dict[str, Any],
        *,
        dry_run: bool = False,
    ) -> ExtCard:
        """Apply ``patch`` to a card. ``attributes`` is MERGED onto the stored
        dict (a key set to ``None`` is removed) — unlike REST's full replace —
        so an enrichment write can never wipe keys it does not carry. Fields
        outside :data:`UPDATABLE_CARD_FIELDS` are refused."""
        cid = _parse_uuid(card_id, "card id")
        refused = sorted(set(patch) - UPDATABLE_CARD_FIELDS)
        if refused:
            raise ExtensionDataError(
                f"Field(s) not writable via the extension bridge: {', '.join(refused)} "
                f"(writable: {', '.join(sorted(UPDATABLE_CARD_FIELDS))})"
            )

        async def op(db: AsyncSession) -> ExtCard:
            card = (await db.execute(select(Card).where(Card.id == cid))).scalar_one_or_none()
            if card is None:
                raise ExtensionDataError(f"Card {card_id} not found")
            updates = dict(patch)
            if "attributes" in updates:
                incoming = updates["attributes"] or {}
                if not isinstance(incoming, dict):
                    raise ExtensionDataError("attributes patch must be a dict")
                merged = dict(card.attributes or {})
                for k, v in incoming.items():
                    if v is None:
                        merged.pop(k, None)
                    else:
                        merged[k] = v
                updates["attributes"] = merged
            await card_write_service.update_card(db, self._actor(), card, updates, dry_run=dry_run)
            await db.flush()
            await db.refresh(card)
            return _to_ext_card(card)

        return await self._write(op, dry_run=dry_run)

    async def archive_card(self, card_id: str, *, cascade_children: bool = False) -> None:
        """Archive (soft-delete) a card — the bridge's only removal; there is
        no hard delete. A card with children requires ``cascade_children=True``
        (peer relations are never cascaded from the bridge)."""
        cid = _parse_uuid(card_id, "card id")

        async def op(db: AsyncSession) -> None:
            card = (await db.execute(select(Card).where(Card.id == cid))).scalar_one_or_none()
            if card is None:
                raise ExtensionDataError(f"Card {card_id} not found")
            if card.status == "ARCHIVED":
                raise ExtensionDataError(f"Card {card_id} is already archived")
            direct_children = await card_lifecycle.direct_children(db, card.id)
            if direct_children and not cascade_children:
                raise ExtensionDataError(
                    f"Card {card_id} has {len(direct_children)} child card(s); "
                    "pass cascade_children=True to archive the subtree"
                )
            strategy: card_lifecycle.ChildStrategy | None = (
                "cascade" if (direct_children and cascade_children) else None
            )
            descendants, related, full = await card_write_service.resolve_archive_delete_set(
                db,
                card,
                child_strategy=strategy,
                related_card_ids=[],
                cascade_all_related=False,
            )
            await card_write_service.archive_card_set(
                db,
                self._actor(),
                card,
                child_strategy=strategy,
                descendants=descendants,
                related_card_ids=related,
                full_affected=full,
                direct_children=direct_children,
            )
            return None

        return await self._write(op)

    async def upsert_relation(
        self,
        *,
        type: str,  # noqa: A002 - mirrors POST /relations
        source_id: str,
        target_id: str,
        attributes: dict[str, Any] | None = None,
        description: str | None = None,
        dry_run: bool = False,
    ) -> ExtRelation:
        """Idempotent upsert on ``(type, source, target)`` — POST /relations
        semantics: an existing relation is reused and supplied attributes /
        description merge onto it. There is no relation delete on the bridge."""
        src = _parse_uuid(source_id, "source_id")
        tgt = _parse_uuid(target_id, "target_id")

        async def op(db: AsyncSession) -> ExtRelation:
            source = (await db.execute(select(Card).where(Card.id == src))).scalar_one_or_none()
            target = (await db.execute(select(Card).where(Card.id == tgt))).scalar_one_or_none()
            if source is None or target is None:
                missing = source_id if source is None else target_id
                raise ExtensionDataError(f"Card {missing} not found")
            rel, _, _ = await card_write_service.upsert_relation(
                db,
                self._actor(),
                type_key=type,
                source_id=src,
                target_id=tgt,
                attributes=attributes,
                description=description,
                dry_run=dry_run,
            )
            await db.refresh(rel)
            return _to_ext_relation(rel)

        return await self._write(op, dry_run=dry_run)
