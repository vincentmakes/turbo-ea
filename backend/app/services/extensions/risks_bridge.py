"""The SDK risks bridge — extensions' sanctioned path to the risk register,
SDK 1.9.

Design invariants (mirroring ``adr_bridge`` and ``data_service``):

* **Grant-gated per call.** Every method re-evaluates
  ``extension_registry.grants_for(key)``; reads need ``core.risks.read`` (or
  ``core.risks.write``, which implies it), ``create`` / ``update`` need
  ``core.risks.write``. Access revokes the moment the extension is
  disabled, removed, pending restart, or its licence stops being usable.
* **No status transitions.** ``update`` touches title, description, owner,
  target date and linked cards — never ``status``, ``acceptance_rationale``
  or the residual assessment. Moving a risk through its workflow, accepting
  it and closing it stay human acts in the app, the same posture as the
  decisions bridge's drafts-only rule.
* **Own rows only for updates.** An extension may update only risks it
  filed itself (``source_type == "extension"`` and a ``source_ref`` under
  its own key prefix). A person's risk is never edited by a program.
* **Provenance without a synthetic author.** Every risk it files carries
  ``source_type="extension"`` and ``source_ref="{key}:{ref}"``, ``created_by``
  stays NULL, and the write runs in a committed ``MutationBatch(
  tool_name="ext:{key}", origin="ext")`` with the ``request_origin``
  contextvar set to ``"ext"``. The ``risk.added`` events fanned out to the
  linked cards carry ``ext: {key}`` like every other bridge write, so the
  extension's own event handler filters them by default. Honours the
  instance-wide ``EXTENSION_WRITES_ENABLED`` kill switch.
* **One writer.** The row comes from ``risk_service.create_risk`` — the same
  function ``POST /risks`` calls — so the reference sequence, the owner's
  system Todo, the ``risk_assigned`` notification and the card events are
  identical whichever path raised the risk.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Sequence
from datetime import date
from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.card import Card
from app.models.risk import Risk, RiskCard
from app.models.user import User
from app.services import mutation_batch_service, risk_service
from app.services.event_bus import request_batch_id, request_origin
from app.services.extensions import data_service
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtensionDataError,
    ExtensionPermissionError,
    ExtRisk,
    RisksBridge,
)

READ_GRANTS = frozenset({"core.risks.read", "core.risks.write"})
WRITE_GRANT = "core.risks.write"

SOURCE_TYPE = "extension"
MAX_TITLE_LENGTH = 500  # mirrors RiskCreate.title
MAX_SOURCE_REF_LENGTH = 64  # risks.source_ref column, prefix included

_T = TypeVar("_T")


def _strip_prefix(key: str, source_ref: str | None) -> str | None:
    prefix = f"{key}:"
    if source_ref and source_ref.startswith(prefix):
        return source_ref[len(prefix) :]
    return source_ref


def _to_ext_risk(key: str, risk: Risk, linked: Sequence[uuid.UUID]) -> ExtRisk:
    return ExtRisk(
        id=str(risk.id),
        reference=risk.reference,
        title=risk.title,
        description=risk.description or "",
        category=risk.category,
        status=risk.status,
        source_type=risk.source_type,
        source_ref=_strip_prefix(key, risk.source_ref),
        initial_probability=risk.initial_probability,
        initial_impact=risk.initial_impact,
        initial_level=risk.initial_level,
        residual_level=risk.residual_level,
        owner_id=str(risk.owner_id) if risk.owner_id else None,
        target_resolution_date=(
            risk.target_resolution_date.isoformat() if risk.target_resolution_date else None
        ),
        linked_card_ids=tuple(str(cid) for cid in linked),
        created_at=risk.created_at.isoformat() if risk.created_at else None,
    )


def _parse_uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as e:
        raise ExtensionDataError(f"Invalid {what}: {value!r}") from e


def _parse_date(value: str | None, what: str) -> date | None:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as e:
        raise ExtensionDataError(f"Invalid {what}: {value!r} (expected YYYY-MM-DD)") from e


def _check_choice(value: str, allowed: Sequence[str], what: str) -> str:
    if value not in allowed:
        raise ExtensionDataError(f"Invalid {what} {value!r} (one of: {', '.join(allowed)})")
    return value


class ExtensionRisks(RisksBridge):
    """Per-extension bridge instance attached to ``ExtensionContext.risks``."""

    def __init__(self, key: str):
        self._key = key

    # -- gating ------------------------------------------------------------

    def _require(self, *, write: bool) -> None:
        grants = set(extension_registry.grants_for(self._key))
        allowed = WRITE_GRANT in grants if write else bool(READ_GRANTS & grants)
        if not allowed:
            needed = WRITE_GRANT if write else "core.risks.read"
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {needed} grant "
                "(and an enabled, licensed install) for this call"
            )

    def _require_writes_enabled(self) -> None:
        if not settings.EXTENSION_WRITES_ENABLED:
            raise ExtensionPermissionError(
                "Extension writes are disabled on this instance (EXTENSION_WRITES_ENABLED=false)"
            )

    def _prefixed_ref(self, source_ref: str | None) -> str | None:
        if source_ref is None:
            return None
        ref = str(source_ref).strip()
        if not ref:
            return None
        full = f"{self._key}:{ref}"
        if len(full) > MAX_SOURCE_REF_LENGTH:
            raise ExtensionDataError(
                f"source_ref too long: {len(full)} characters with the {self._key}: prefix "
                f"(limit {MAX_SOURCE_REF_LENGTH})"
            )
        return full

    def _owns(self, risk: Risk) -> bool:
        return risk.source_type == SOURCE_TYPE and bool(
            (risk.source_ref or "").startswith(f"{self._key}:")
        )

    # -- reads -------------------------------------------------------------

    async def get(self, risk_id: str) -> ExtRisk | None:
        self._require(write=False)
        try:
            rid = uuid.UUID(risk_id)
        except (TypeError, ValueError):
            return None
        async with async_session() as db:
            risk = (await db.execute(select(Risk).where(Risk.id == rid))).scalar_one_or_none()
            if risk is None:
                return None
            return _to_ext_risk(self._key, risk, await risk_service.linked_card_ids(db, risk.id))

    async def list_for_card(self, card_id: str) -> list[ExtRisk]:
        self._require(write=False)
        try:
            cid = uuid.UUID(card_id)
        except (TypeError, ValueError):
            return []
        async with async_session() as db:
            rows = await db.execute(
                select(Risk)
                .join(RiskCard, RiskCard.risk_id == Risk.id)
                .where(RiskCard.card_id == cid)
                .order_by(Risk.reference.asc())
            )
            out: list[ExtRisk] = []
            for risk in rows.scalars().all():
                out.append(
                    _to_ext_risk(self._key, risk, await risk_service.linked_card_ids(db, risk.id))
                )
            return out

    async def find_by_source_ref(self, source_ref: str) -> ExtRisk | None:
        """The risk this extension filed under ``source_ref``, if any — the
        dedupe lookup a re-firing rule performs before raising another."""
        self._require(write=False)
        full = self._prefixed_ref(source_ref)
        if full is None:
            return None
        async with async_session() as db:
            risk = (
                await db.execute(
                    select(Risk)
                    .where(Risk.source_type == SOURCE_TYPE, Risk.source_ref == full)
                    .order_by(Risk.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if risk is None:
                return None
            return _to_ext_risk(self._key, risk, await risk_service.linked_card_ids(db, risk.id))

    # -- writes ------------------------------------------------------------

    async def _resolve_cards(self, db: AsyncSession, card_ids: Sequence[str]) -> list[uuid.UUID]:
        parsed: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for raw in card_ids:
            cid = _parse_uuid(raw, "card id")
            if cid not in seen:
                seen.add(cid)
                parsed.append(cid)
        if not parsed:
            return []
        rows = await db.execute(select(Card.id, Card.status).where(Card.id.in_(parsed)))
        status_by_id = {row[0]: row[1] for row in rows}
        missing = [str(cid) for cid in parsed if cid not in status_by_id]
        if missing:
            raise ExtensionDataError(f"Cards not found: {', '.join(missing)}")
        archived = [str(cid) for cid in parsed if status_by_id[cid] == "ARCHIVED"]
        if archived:
            raise ExtensionDataError(f"Cannot link archived card(s): {', '.join(archived)}")
        return parsed

    async def _resolve_owner(self, db: AsyncSession, owner_id: str | None) -> uuid.UUID | None:
        if owner_id is None:
            return None
        uid = _parse_uuid(owner_id, "owner_id")
        row = (await db.execute(select(User.id, User.is_active).where(User.id == uid))).first()
        if row is None:
            raise ExtensionDataError(f"Owner {owner_id} not found")
        if not row[1]:
            raise ExtensionDataError(f"Owner {owner_id} is deactivated")
        return uid

    async def _write(
        self,
        op: Callable[[AsyncSession], Awaitable[_T]],
        *,
        summary: Callable[[_T], dict[str, Any]] | None = None,
    ) -> _T:
        self._require(write=True)
        self._require_writes_enabled()
        if data_service.active_batch_id() is not None:
            # Inside ``ctx.data.batch(...)``: join it — the batch scope already
            # set the origin and batch contextvars, so the write lands in the
            # same audit row as the card writes around it.
            data_service.count_write_in_active_batch()
            async with async_session() as db:
                try:
                    result = await op(db)
                except HTTPException as e:
                    raise ExtensionDataError(str(e.detail)) from e
                await db.commit()
                return result
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
                except HTTPException as e:  # defensive: service helpers are HTTP-flavoured
                    raise ExtensionDataError(str(e.detail)) from e
                await mutation_batch_service.commit_batch(
                    db, batch, summary=summary(result) if summary else None
                )
                await db.commit()
                return result
        finally:
            if batch_token is not None:
                request_batch_id.reset(batch_token)
            request_origin.reset(origin_token)

    async def create(
        self,
        *,
        title: str,
        description: str = "",
        category: str = "operational",
        probability: str = "medium",
        impact: str = "medium",
        owner_id: str | None = None,
        target_resolution_date: str | None = None,
        card_ids: Sequence[str] = (),
        source_ref: str | None = None,
    ) -> ExtRisk:
        clean_title = str(title or "").strip()
        if not clean_title:
            raise ExtensionDataError("A risk needs a title")
        if len(clean_title) > MAX_TITLE_LENGTH:
            raise ExtensionDataError(f"Risk title exceeds {MAX_TITLE_LENGTH} characters")
        # Validate what needs no session BEFORE opening one.
        _check_choice(category, risk_service.CATEGORY_VALUES, "category")
        _check_choice(probability, risk_service.PROBABILITY_VALUES, "probability")
        _check_choice(impact, risk_service.IMPACT_VALUES, "impact")
        target = _parse_date(target_resolution_date, "target_resolution_date")
        full_ref = self._prefixed_ref(source_ref)

        async def op(db: AsyncSession) -> ExtRisk:
            linked = await self._resolve_cards(db, card_ids)
            owner = await self._resolve_owner(db, owner_id)
            risk = await risk_service.create_risk(
                db,
                title=clean_title,
                description=str(description or ""),
                category=category,
                initial_probability=probability,
                initial_impact=impact,
                owner_id=owner,
                target_resolution_date=target,
                card_ids=linked,
                source_type=SOURCE_TYPE,
                source_ref=full_ref,
                actor_id=None,
                event_extra={"ext": self._key},
            )
            await db.refresh(risk)
            return _to_ext_risk(self._key, risk, linked)

        return await self._write(
            op,
            summary=lambda out: {"risk_id": out.id, "reference": out.reference},
        )

    async def update(
        self,
        risk_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        owner_id: str | None = None,
        clear_owner: bool = False,
        target_resolution_date: str | None = None,
        clear_target_resolution_date: bool = False,
        add_card_ids: Sequence[str] = (),
    ) -> ExtRisk:
        """Keep a risk this extension filed current. ``None`` means "not
        provided" throughout (the todos-bridge convention), so clearing the
        owner or the target date takes the explicit ``clear_*`` flag."""
        rid = _parse_uuid(risk_id, "risk id")
        if title is not None:
            title = str(title).strip()
            if not title:
                raise ExtensionDataError("A risk needs a title")
            if len(title) > MAX_TITLE_LENGTH:
                raise ExtensionDataError(f"Risk title exceeds {MAX_TITLE_LENGTH} characters")
        if owner_id is not None and clear_owner:
            raise ExtensionDataError("Pass either owner_id or clear_owner, not both")
        if target_resolution_date is not None and clear_target_resolution_date:
            raise ExtensionDataError(
                "Pass either target_resolution_date or clear_target_resolution_date, not both"
            )
        target = _parse_date(target_resolution_date, "target_resolution_date")

        async def op(db: AsyncSession) -> ExtRisk:
            risk = (await db.execute(select(Risk).where(Risk.id == rid))).scalar_one_or_none()
            if risk is None:
                raise ExtensionDataError(f"Risk {risk_id} not found")
            if not self._owns(risk):
                raise ExtensionDataError(
                    f"Risk {risk.reference} was not filed by extension {self._key}; "
                    "an extension may only update risks it created"
                )
            previous_owner = risk.owner_id
            before = risk_service.risk_snapshot(risk)
            if title is not None:
                risk.title = title
            if description is not None:
                risk.description = str(description)
            if clear_owner:
                risk.owner_id = None
            elif owner_id is not None:
                risk.owner_id = await self._resolve_owner(db, owner_id)
            if clear_target_resolution_date:
                risk.target_resolution_date = None
            elif target is not None:
                risk.target_resolution_date = target
            await db.flush()
            new_links: list[uuid.UUID] = []
            if add_card_ids:
                wanted = await self._resolve_cards(db, add_card_ids)
                existing = set(await risk_service.linked_card_ids(db, risk.id))
                new_links = [cid for cid in wanted if cid not in existing]
                await risk_service.link_cards(db, risk.id, new_links)
            await risk_service.sync_owner_todo(
                db, risk, actor_id=None, previous_owner=previous_owner
            )
            linked = await risk_service.linked_card_ids(db, risk.id)
            if new_links:
                await risk_service.publish_risk_event(
                    db, risk, "risk.added", new_links, actor_id=None, extra={"ext": self._key}
                )
            changes = risk_service.risk_changes(before, risk)
            await risk_service.publish_risk_event(
                db,
                risk,
                "risk.updated",
                [cid for cid in linked if cid not in new_links],
                actor_id=None,
                extra={"ext": self._key, "fields": sorted(changes), "changes": changes},
            )
            await db.refresh(risk)
            return _to_ext_risk(self._key, risk, linked)

        return await self._write(
            op,
            summary=lambda out: {"risk_id": out.id, "reference": out.reference},
        )
