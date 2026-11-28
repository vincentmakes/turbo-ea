"""Live card updates: a browser watches the cards it has open.

Card events are withheld from non-admin subscribers of the event stream
(``_event_visible_to`` in ``app/api/v1/events.py``): their payloads name
fields, values, actors and peer cards the viewer may not read. A card page
still needs to learn that the card it shows was changed by someone else — an
integration, an automation, another user — so this module carries a second,
much smaller signal beside the stream:

1. Every stream connection opens an entry here (``open_stream``) and tells the
   browser its ``stream_id`` in the first message (``event.stream.hello``).
2. The browser registers the cards it has open
   (``PUT /events/stream/{stream_id}/watch``). The route admits only cards the
   caller may open through ``GET /cards/{id}`` — the same read gate — and the
   watch expires after ``WATCH_TTL_SECONDS`` unless the browser refreshes it.
3. When ``event_bus.publish`` carries a ``card_id``, every stream watching
   that card when the change becomes visible receives
   ``{"event": "event.stream.card_changed", "card_id", "timestamp"}`` — never
   the payload, the changes, the actor, the batch or the original event type.
   The browser then re-reads the card through the normal, permission-checked
   ``GET /cards/{id}``.

**Delivered after commit, to whoever watches at commit.** ``publish`` runs
before the writer commits, so a ping sent from inside it would let the browser
re-read data that is not committed yet (and may never be). ``note_change``
therefore only records the card id on the session — always, whether or not
anybody watches yet: a browser that opens the card during a long transaction
(a bulk import, a sync, an extension's batch) reads the row as it was before,
registers, and must still hear about the commit. The ids are a set per
transaction level, so a 50,000-row import holding the same card many times
records it once. Listeners on the ``Session`` class look the watchers up and
deliver when the *outermost* transaction commits (one dict lookup per distinct
id, none at all while nobody watches anything) and drop the ids when the
transaction rolls back or the session closes without committing. A change recorded inside a SAVEPOINT
(``begin_nested``) is delivered only when the outer transaction commits — a
savepoint release fires ``after_commit`` too, which is why the listener checks
``in_nested_transaction()`` — and dropped when that savepoint, or any
transaction around it, rolls back. A ``publish`` without a session (not
persisted) delivers at once.

**Never through the general bus.** Pings are written straight into each
watching stream's own queue, one per card per stream until the stream has
forwarded it (a burst of writes to one card is one ping). A bulk import of
thousands of cards would otherwise overflow every subscriber's queue, and the
bus drops a subscriber whose queue is full. Here a full queue drops the ping,
never the subscriber.

**What a watcher can learn.** Only that a card it could read when it
registered the watch changed at some moment — at most for
``WATCH_TTL_SECONDS`` (five minutes) after its last registration, after which
a lost read right also ends the signal (re-registering re-checks it; the
browser re-registers at 80 % of the announced lifetime, one request per tab). A change to a
relation whose other end the viewer may not read still pings the visible end
(relation events are published once per end); the re-read then shows nothing
the viewer could not already see. A stream belongs to the user who opened it:
``set_watch`` refuses any other user, and the id is unguessable.

The registry is in memory: core runs a single backend process. This module
imports nothing from ``app.services`` (``event_bus`` imports it).
"""

from __future__ import annotations

import asyncio
import secrets
import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import event as sa_event
from sqlalchemy.orm import Session, SessionTransaction

HELLO_EVENT = "event.stream.hello"
PING_EVENT = "event.stream.card_changed"
WATCH_TTL_SECONDS = 300
MAX_WATCHED_CARDS = 10

_PENDING_KEY = "card_watch.pending"


class StreamMessage(dict):
    """A message this module writes into a stream's own queue (the hello, a
    ping). A ``dict`` subclass so the stream can tell it from a bus message by
    type, not by its ``event`` name — a bus message published under the same
    name is still filtered like every other bus message."""


class CardChangedPing(StreamMessage):
    """The reduced message a watching stream receives."""


@dataclass
class _Stream:
    user_id: str
    inbox: asyncio.Queue
    watched: dict[uuid.UUID, float] = field(default_factory=dict)
    queued: set[uuid.UUID] = field(default_factory=set)


_streams: dict[str, _Stream] = {}
_watchers: dict[uuid.UUID, set[str]] = {}


def _clock(now: float | None) -> float:
    return time.monotonic() if now is None else now


def _as_uuid(card_id: uuid.UUID | str) -> uuid.UUID | None:
    if isinstance(card_id, uuid.UUID):
        return card_id
    try:
        return uuid.UUID(str(card_id))
    except ValueError:
        return None


def _unindex(stream_id: str, card_id: uuid.UUID) -> None:
    ids = _watchers.get(card_id)
    if ids is None:
        return
    ids.discard(stream_id)
    if not ids:
        del _watchers[card_id]


# ── Streams ───────────────────────────────────────────────────────────────


def open_stream(user_id: uuid.UUID | str, inbox: asyncio.Queue) -> str:
    """Register a stream connection; returns its unguessable id."""
    stream_id = secrets.token_urlsafe(32)
    _streams[stream_id] = _Stream(user_id=str(user_id), inbox=inbox)
    return stream_id


def close_stream(stream_id: str) -> None:
    """Forget a stream and every watch it held. Unknown ids are ignored."""
    entry = _streams.pop(stream_id, None)
    if entry is None:
        return
    for card_id in entry.watched:
        _unindex(stream_id, card_id)


def owns_stream(stream_id: str, user_id: uuid.UUID | str) -> bool:
    """True when ``stream_id`` is an open stream of ``user_id``."""
    entry = _streams.get(stream_id)
    return entry is not None and entry.user_id == str(user_id)


def set_watch(
    stream_id: str,
    user_id: uuid.UUID | str,
    card_ids: Iterable[uuid.UUID],
    *,
    now: float | None = None,
) -> list[uuid.UUID] | None:
    """Replace the stream's watch set with ``card_ids``, each expiring
    ``WATCH_TTL_SECONDS`` from ``now``.

    The caller has already checked that the user may read every id it passes.
    Returns the ids now watched (in the order given, duplicates removed), or
    ``None`` when the stream does not exist or belongs to another user.
    """
    entry = _streams.get(stream_id)
    if entry is None or entry.user_id != str(user_id):
        return None
    accepted = list(dict.fromkeys(card_ids))
    expires_at = _clock(now) + WATCH_TTL_SECONDS
    for card_id in list(entry.watched):
        if card_id not in accepted:
            _unindex(stream_id, card_id)
    entry.watched = {card_id: expires_at for card_id in accepted}
    entry.queued &= set(accepted)
    for card_id in accepted:
        _watchers.setdefault(card_id, set()).add(stream_id)
    return accepted


def watchers_exist(card_id: uuid.UUID | str | None) -> bool:
    """One dict lookup: does any stream watch this card?"""
    if card_id is None or not _watchers:
        return False
    cid = _as_uuid(card_id)
    return cid is not None and cid in _watchers


def mark_forwarded(stream_id: str, card_id: uuid.UUID | str) -> None:
    """The stream sent a ping for ``card_id``: the next change pings again."""
    entry = _streams.get(stream_id)
    cid = _as_uuid(card_id)
    if entry is not None and cid is not None:
        entry.queued.discard(cid)


def hello(stream_id: str) -> StreamMessage:
    """The first message of every stream connection."""
    return StreamMessage(
        event=HELLO_EVENT,
        stream_id=stream_id,
        watch_ttl_seconds=WATCH_TTL_SECONDS,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


# ── Delivery ──────────────────────────────────────────────────────────────


def notify(card_id: uuid.UUID | str, *, now: float | None = None) -> int:
    """Put one ping for ``card_id`` into every stream watching it.

    A stream that already holds an unforwarded ping for the card gets none (a
    burst is one ping), an expired watch is dropped here, and a full queue
    drops the ping, never the stream. Returns how many pings were queued.
    """
    cid = _as_uuid(card_id)
    if cid is None:
        return 0
    stream_ids = _watchers.get(cid)
    if not stream_ids:
        return 0
    moment = _clock(now)
    sent = 0
    for stream_id in list(stream_ids):
        entry = _streams.get(stream_id)
        if entry is None:
            _unindex(stream_id, cid)
            continue
        expires_at = entry.watched.get(cid)
        if expires_at is None or expires_at <= moment:
            entry.watched.pop(cid, None)
            entry.queued.discard(cid)
            _unindex(stream_id, cid)
            continue
        if cid in entry.queued:
            continue
        ping = CardChangedPing(
            event=PING_EVENT,
            card_id=str(cid),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        try:
            entry.inbox.put_nowait(ping)
        except asyncio.QueueFull:
            continue
        entry.queued.add(cid)
        sent += 1
    return sent


def note_change(db: Any, card_id: uuid.UUID | str | None) -> None:
    """Record that ``card_id`` changed in ``db``'s transaction.

    Recorded whether or not anybody watches the card yet: the watchers are
    looked up when the outermost transaction commits, so a watch registered
    while the transaction runs still hears about it. Dropped when the
    transaction it was recorded in (or one around it) rolls back. ``db`` is an
    ``AsyncSession`` or a ``Session``; ``None`` delivers at once. Costs one set
    insertion.
    """
    if card_id is None:
        return
    cid = _as_uuid(card_id)
    if cid is None:
        return
    if db is None:
        notify(cid)
        return
    session: Session = getattr(db, "sync_session", db)
    txn = session.get_nested_transaction() or session.get_transaction()
    if txn is None:
        # Nothing is pending on this session: what changed is already visible.
        notify(cid)
        return
    pending: dict[SessionTransaction, set[uuid.UUID]] = session.info.setdefault(
        _PENDING_KEY, {}
    )
    pending.setdefault(txn, set()).add(cid)


def _within(txn: SessionTransaction | None, ancestor: SessionTransaction) -> bool:
    while txn is not None:
        if txn is ancestor:
            return True
        txn = txn.parent
    return False


@sa_event.listens_for(Session, "after_commit")
def _deliver_after_commit(session: Session) -> None:
    # A savepoint release fires after_commit too; only the outermost commit
    # makes the change visible to another connection.
    if session.in_nested_transaction():
        return
    pending: dict[SessionTransaction, set[uuid.UUID]] | None = session.info.pop(
        _PENDING_KEY, None
    )
    # Nobody watches anything: nothing to look up.
    if not pending or not _watchers:
        return
    delivered: set[uuid.UUID] = set()
    for ids in pending.values():
        for cid in ids:
            if cid in delivered:
                continue
            delivered.add(cid)
            notify(cid)


@sa_event.listens_for(Session, "after_soft_rollback")
def _drop_rolled_back(session: Session, previous_transaction: SessionTransaction) -> None:
    pending: dict[SessionTransaction, set[uuid.UUID]] | None = session.info.get(_PENDING_KEY)
    if not pending:
        return
    if previous_transaction.parent is None:
        session.info.pop(_PENDING_KEY, None)
        return
    for txn in [txn for txn in pending if _within(txn, previous_transaction)]:
        del pending[txn]
    if not pending:
        session.info.pop(_PENDING_KEY, None)


@sa_event.listens_for(Session, "after_transaction_end")
def _drop_on_close(session: Session, transaction: SessionTransaction) -> None:
    # The outermost transaction ended without the commit above having taken
    # the pending ids (a rollback, or a close without commit): they never
    # became visible, so they are not changes.
    if transaction.parent is None and transaction.nested is False:
        session.info.pop(_PENDING_KEY, None)


def _reset_for_tests() -> None:
    _streams.clear()
    _watchers.clear()
