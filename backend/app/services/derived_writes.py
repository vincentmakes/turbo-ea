"""Derived-value maintenance: writes that must not move ``cards.updated_at``.

A data-quality rescore, a calculated-field re-run, a hierarchy-level or card-ID
backfill changes a *derived* value, not the card's content, and has no per-card
user intent behind it. The Inventory's **Modified** column and a card's
**History** tab are two views of the same fact (see the invariant in
``CLAUDE.md``), so rather than inventing a per-card event nobody asked for —
one metamodel weight change would write an event for every card of the type —
these paths pin ``updated_at`` to its stored value
(`#995 <https://github.com/vincentmakes/turbo-ea/discussions/995>`_).

Mechanism: ``TimestampMixin.updated_at`` carries ``onupdate=func.now()``, which
SQLAlchemy applies only to columns *absent* from the UPDATE's SET clause. A
plain ``card.updated_at = card.updated_at`` is compared by equality, found
unchanged and dropped from the statement — letting ``onupdate`` fire after all.
``flag_modified`` is what forces the column in, at its currently-loaded value,
so ``now()`` is never rendered.

The pin is applied from **both** ends, because the write and the flush that
carries it are routinely in different places:

* a ``before_flush`` listener, for an autoflush *inside* the block — by the time
  the block exits, that statement has already gone to the database;
* on block exit, for the far more common case of a helper that deliberately
  never flushes (``rescore_cards``, ``backfill_references_for_type``) and leaves
  the UPDATE to whatever the caller does next.

Cards already dirty when the block opens are left alone: those carry a real edit
the caller made, and that edit must keep its timestamp.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from sqlalchemy import event, inspect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.card import Card

__all__ = ["derived_maintenance", "pin_updated_at"]

# None when no block is active; otherwise the cards that were already dirty when
# the innermost block opened, which must keep their real timestamps.
_preexisting_dirty: ContextVar[set[Card] | None] = ContextVar(
    "derived_preexisting_dirty", default=None
)


def _sync_session(session: AsyncSession | Session) -> Session:
    """Accept either an ``AsyncSession`` or a plain ``Session``."""
    return session.sync_session if isinstance(session, AsyncSession) else session


def pin_updated_at(card: Card) -> None:
    """Force ``card``'s stored ``updated_at`` into the pending UPDATE.

    No-op for a card whose ``updated_at`` is not loaded — ``flag_modified``
    raises on an unloaded attribute, and there is nothing to preserve anyway.
    """
    state = inspect(card)
    if "updated_at" not in state.dict:
        return
    flag_modified(card, "updated_at")


def _pin_dirty_cards(sync: Session, exclude: set[Card]) -> None:
    for obj in list(sync.dirty):
        if not isinstance(obj, Card) or obj in exclude:
            continue
        if not sync.is_modified(obj):
            continue
        pin_updated_at(obj)


@contextmanager
def derived_maintenance(session: AsyncSession | Session) -> Iterator[None]:
    """Recompute derived values without re-dating the cards they belong to.

    Wrap only work that has no per-card user intent behind it. A write the user
    actually asked for must move ``updated_at`` — and, per ``CLAUDE.md``, must
    also publish a card event.
    """
    sync = _sync_session(session)
    preexisting = {obj for obj in sync.dirty if isinstance(obj, Card)}
    token = _preexisting_dirty.set(preexisting)
    try:
        yield
    finally:
        try:
            _pin_dirty_cards(sync, preexisting)
        finally:
            _preexisting_dirty.reset(token)


@event.listens_for(Session, "before_flush")
def _pin_card_timestamps(session: Session, flush_context, instances) -> None:
    preexisting = _preexisting_dirty.get()
    if preexisting is None:
        return
    _pin_dirty_cards(session, preexisting)
