"""The SDK decisions bridge — extensions' sanctioned path to core decision
records (ADRs), SDK 1.8.

Design invariants (mirroring ``todos_bridge`` and ``data_service``):

* **Grant-gated per call.** Every method re-evaluates
  ``extension_registry.grants_for(key)`` — access revokes the moment the
  extension is disabled, removed, pending restart, or its license
  entitlement stops being usable. ``get`` needs ``core.adr.read`` (or
  ``core.adr.write``, which implies it); ``create_draft`` needs
  ``core.adr.write``.
* **Drafts only.** ``create_draft`` files a decision in ``draft`` status and
  status is never a parameter: sending for review, signing and revising stay
  human-only through the app, the same posture as the todos bridge's
  system-todo carve-out. An extension records the decision it produced; it
  never approves it.
* **Own namespace only.** ``attributes`` keys must start with the calling
  extension's own ``ext.{key}.`` prefix — stricter than ``PATCH /adr``'s
  ``ext.*`` (which trusts a human holding ``adr.manage``) so one extension
  can never write into another extension's bag.
* **Active linked cards only.** A linked card must exist and not be archived
  (the bridge's read side cannot even see archived cards, so a link to one
  would be inconsistent data). Hidden-type cards are not refused — parity
  with the REST route.
* **Full audit provenance, no synthetic author.** Each filing runs in its
  own short session with the ``request_origin`` contextvar set to ``"ext"``
  and a committed ``MutationBatch(tool_name="ext:{key}", origin="ext")``
  whose summary carries the reference number; ``created_by`` stays NULL —
  stamping a user would lie about who decided. Honours the instance-wide
  ``EXTENSION_WRITES_ENABLED`` kill switch. No event is published on
  create, matching ``POST /adr``.
* **One writer.** The row itself comes from ``app.services.adr_service`` —
  the same generator and insert the REST route and the analysis commit flow
  use, so every path shares one reference-number sequence.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card import Card
from app.services import adr_service, mutation_batch_service
from app.services.event_bus import request_batch_id, request_origin
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    DecisionsBridge,
    ExtDecision,
    ExtensionDataError,
    ExtensionPermissionError,
)

READ_GRANTS = frozenset({"core.adr.read", "core.adr.write"})
WRITE_GRANT = "core.adr.write"

MAX_TITLE_LENGTH = 500  # mirrors ADRCreate.title

_T = TypeVar("_T")


def _to_ext_decision(adr: ArchitectureDecision, linked: Sequence[uuid.UUID]) -> ExtDecision:
    return ExtDecision(
        id=str(adr.id),
        reference_number=adr.reference_number,
        title=adr.title,
        status=adr.status,
        revision_number=int(adr.revision_number or 1),
        linked_card_ids=tuple(str(cid) for cid in linked),
        attributes=dict(adr.attributes or {}),
        created_at=adr.created_at.isoformat() if adr.created_at else None,
    )


async def _linked_ids(db: AsyncSession, adr_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(
        select(ArchitectureDecisionCard.card_id)
        .where(ArchitectureDecisionCard.architecture_decision_id == adr_id)
        .order_by(ArchitectureDecisionCard.card_id.asc())
    )
    return list(rows.scalars().all())


class ExtensionDecisions(DecisionsBridge):
    """Per-extension bridge instance attached to ``ExtensionContext.decisions``."""

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
            needed = WRITE_GRANT if write else "core.adr.read"
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {needed} grant "
                "(and an enabled, licensed install) for this call"
            )

    def _require_writes_enabled(self) -> None:
        if not settings.EXTENSION_WRITES_ENABLED:
            raise ExtensionPermissionError(
                "Extension writes are disabled on this instance (EXTENSION_WRITES_ENABLED=false)"
            )

    def _namespace(self) -> str:
        return f"ext.{self._key}."

    def _validate_attributes(self, attributes: dict[str, Any] | None) -> dict[str, Any]:
        """Every key under the extension's own ``ext.{key}.`` prefix; a
        ``None`` value is dropped (there is nothing to delete on a new row)."""
        if not attributes:
            return {}
        if not isinstance(attributes, dict):
            raise ExtensionDataError("attributes must be a dict")
        prefix = self._namespace()
        out: dict[str, Any] = {}
        for key, value in attributes.items():
            if not isinstance(key, str) or not key.startswith(prefix):
                raise ExtensionDataError(
                    f"Decision attribute keys must be namespaced {prefix}* (got {key!r})"
                )
            if value is None:
                continue
            out[key] = value
        return out

    async def _resolve_active_cards(
        self, db: AsyncSession, card_ids: Sequence[str]
    ) -> list[uuid.UUID]:
        parsed: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for raw in card_ids:
            try:
                cid = uuid.UUID(str(raw))
            except (TypeError, ValueError) as e:
                raise ExtensionDataError(f"Invalid card id: {raw!r}") from e
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

    # -- reads -------------------------------------------------------------

    async def get(self, decision_id: str) -> ExtDecision | None:
        self._require(write=False)
        try:
            did = uuid.UUID(decision_id)
        except (TypeError, ValueError):
            return None
        async with async_session() as db:
            adr = (
                await db.execute(select(ArchitectureDecision).where(ArchitectureDecision.id == did))
            ).scalar_one_or_none()
            if adr is None:
                return None
            return _to_ext_decision(adr, await _linked_ids(db, adr.id))

    # -- writes ------------------------------------------------------------

    async def _write(
        self,
        op: Callable[[AsyncSession], Awaitable[_T]],
        *,
        summary: Callable[[_T], dict[str, Any]] | None = None,
    ) -> _T:
        """Run ``op(db)`` inside a fresh session with ext provenance: origin
        contextvar ``"ext"`` plus an explicit committed mutation batch."""
        self._require(write=True)
        self._require_writes_enabled()
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
                except HTTPException as e:  # defensive: adr_service is HTTP-flavoured
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

    async def create_draft(
        self,
        *,
        title: str,
        context: str | None = None,
        decision: str | None = None,
        consequences: str | None = None,
        alternatives_considered: str | None = None,
        linked_card_ids: Sequence[str] = (),
        attributes: dict[str, Any] | None = None,
        related_decisions: Sequence[Any] | None = None,
    ) -> ExtDecision:
        """File a DRAFT decision record. Status is never a parameter."""
        clean_title = str(title or "").strip()
        if not clean_title:
            raise ExtensionDataError("A decision needs a title")
        if len(clean_title) > MAX_TITLE_LENGTH:
            raise ExtensionDataError(f"Decision title exceeds {MAX_TITLE_LENGTH} characters")
        # Validate what needs no session BEFORE opening one.
        attrs = self._validate_attributes(attributes)

        async def op(db: AsyncSession) -> ExtDecision:
            card_ids = await self._resolve_active_cards(db, linked_card_ids)
            adr = await adr_service.create_decision(
                db,
                title=clean_title,
                context=context,
                decision=decision,
                consequences=consequences,
                alternatives_considered=alternatives_considered,
                related_decisions=list(related_decisions or []),
                attributes=attrs,
                linked_card_ids=card_ids,
                created_by=None,
            )
            # Server-side timestamp defaults are expired after the flush;
            # refresh so the wire mapping never lazy-loads.
            await db.refresh(adr)
            return _to_ext_decision(adr, card_ids)

        return await self._write(
            op,
            summary=lambda out: {
                "decision_id": out.id,
                "reference_number": out.reference_number,
            },
        )
