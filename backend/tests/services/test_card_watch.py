"""Live card updates: the watch registry and its after-commit delivery.

The registry half needs no database. The delivery half is proved against
PostgreSQL twice: on a fresh session of the test engine (the production shape:
a session that owns its transaction) and on the shared ``db`` fixture, whose
session is joined to a connection-level savepoint — the shape every API test
runs in, so an API test can observe a ping after a route's ``commit()``.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import card_watch
from app.services.event_bus import EventBus


@pytest.fixture(autouse=True)
def _clean_registry():
    card_watch._reset_for_tests()
    yield
    card_watch._reset_for_tests()


def _drain(q: asyncio.Queue) -> list[dict]:
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def _watching(card_id: uuid.UUID, *, user="u1", maxsize=256, now=None):
    inbox: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
    sid = card_watch.open_stream(user, inbox)
    assert card_watch.set_watch(sid, user, [card_id], now=now) == [card_id]
    return sid, inbox


# ── Registry ──────────────────────────────────────────────────────────────


class TestRegistry:
    def test_stream_ids_are_unguessable_and_distinct(self):
        a = card_watch.open_stream("u1", asyncio.Queue())
        b = card_watch.open_stream("u1", asyncio.Queue())
        assert a != b
        assert len(a) >= 40

    def test_hello_carries_the_stream_id_and_ttl(self):
        msg = card_watch.hello("abc")
        assert set(msg) == {"event", "stream_id", "watch_ttl_seconds", "timestamp"}
        assert msg["event"] == "event.stream.hello"
        assert msg["stream_id"] == "abc"
        assert msg["watch_ttl_seconds"] == 1800

    def test_notify_puts_exactly_the_reduced_ping(self):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        assert card_watch.notify(cid) == 1
        (ping,) = _drain(inbox)
        assert isinstance(ping, card_watch.CardChangedPing)
        assert set(ping) == {"event", "card_id", "timestamp"}
        assert ping["event"] == "event.stream.card_changed"
        assert ping["card_id"] == str(cid)

    def test_unwatched_card_costs_nothing(self):
        assert card_watch.watchers_exist(uuid.uuid4()) is False
        assert card_watch.watchers_exist(None) is False
        assert card_watch.notify(uuid.uuid4()) == 0

    def test_note_change_without_watchers_touches_no_session(self):
        class Exploding:
            @property
            def sync_session(self):
                raise AssertionError("looked at the session for an unwatched card")

        card_watch.note_change(Exploding(), uuid.uuid4())

    def test_only_watching_streams_are_pinged(self):
        watched, other = uuid.uuid4(), uuid.uuid4()
        _sid, inbox = _watching(watched)
        _sid2, inbox2 = _watching(other, user="u2")
        card_watch.notify(watched)
        assert [p["card_id"] for p in _drain(inbox)] == [str(watched)]
        assert _drain(inbox2) == []

    def test_a_burst_is_one_ping_until_forwarded(self):
        cid = uuid.uuid4()
        sid, inbox = _watching(cid)
        assert card_watch.notify(cid) == 1
        assert card_watch.notify(cid) == 0
        assert len(_drain(inbox)) == 1
        card_watch.mark_forwarded(sid, str(cid))
        assert card_watch.notify(cid) == 1
        assert len(_drain(inbox)) == 1

    def test_full_inbox_drops_the_ping_never_the_stream(self):
        cid = uuid.uuid4()
        sid, inbox = _watching(cid, maxsize=1)
        inbox.put_nowait({"event": "something.else"})
        assert card_watch.notify(cid) == 0
        assert card_watch.owns_stream(sid, "u1")
        assert card_watch.watchers_exist(cid)
        # Not marked as queued: once there is room the next change gets through.
        inbox.get_nowait()
        assert card_watch.notify(cid) == 1

    def test_close_removes_the_entry_and_the_reverse_index(self):
        cid = uuid.uuid4()
        sid, _inbox = _watching(cid)
        card_watch.close_stream(sid)
        assert card_watch.owns_stream(sid, "u1") is False
        assert card_watch.watchers_exist(cid) is False
        assert card_watch._watchers == {}
        card_watch.close_stream(sid)  # idempotent

    def test_close_keeps_other_streams_watching_the_same_card(self):
        cid = uuid.uuid4()
        sid, _ = _watching(cid)
        _sid2, inbox2 = _watching(cid, user="u2")
        card_watch.close_stream(sid)
        assert card_watch.notify(cid) == 1
        assert len(_drain(inbox2)) == 1

    def test_a_watch_expires_and_a_refresh_keeps_it(self):
        cid = uuid.uuid4()
        sid, inbox = _watching(cid, now=1000.0)
        ttl = card_watch.WATCH_TTL_SECONDS
        # Refreshed just before it lapsed: still alive past the first expiry.
        card_watch.set_watch(sid, "u1", [cid], now=1000.0 + ttl - 1)
        assert card_watch.notify(cid, now=1000.0 + ttl + 1) == 1
        _drain(inbox)
        card_watch.mark_forwarded(sid, cid)
        # Never refreshed again: past its expiry it is dropped.
        assert card_watch.notify(cid, now=1000.0 + 2 * ttl) == 0
        assert _drain(inbox) == []
        assert card_watch.watchers_exist(cid) is False

    def test_set_watch_replaces_the_set(self):
        a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        inbox: asyncio.Queue = asyncio.Queue()
        sid = card_watch.open_stream("u1", inbox)
        assert card_watch.set_watch(sid, "u1", [a, b, a]) == [a, b]
        assert card_watch.set_watch(sid, "u1", [b, c]) == [b, c]
        assert card_watch.watchers_exist(a) is False
        assert card_watch.watchers_exist(b) and card_watch.watchers_exist(c)
        assert card_watch.set_watch(sid, "u1", []) == []
        assert card_watch._watchers == {}

    def test_replacing_forgets_a_queued_mark_of_a_dropped_card(self):
        a = uuid.uuid4()
        sid, inbox = _watching(a)
        card_watch.notify(a)
        card_watch.set_watch(sid, "u1", [])
        card_watch.set_watch(sid, "u1", [a])
        assert card_watch.notify(a) == 1

    def test_another_user_cannot_configure_a_stream(self):
        cid = uuid.uuid4()
        inbox: asyncio.Queue = asyncio.Queue()
        sid = card_watch.open_stream("alice", inbox)
        assert card_watch.owns_stream(sid, "bob") is False
        assert card_watch.set_watch(sid, "bob", [cid]) is None
        assert card_watch.watchers_exist(cid) is False
        assert card_watch.set_watch("no-such-stream", "alice", [cid]) is None

    def test_user_ids_compare_as_strings(self):
        uid = uuid.uuid4()
        sid = card_watch.open_stream(uid, asyncio.Queue())
        assert card_watch.owns_stream(sid, str(uid))
        assert card_watch.set_watch(sid, str(uid), []) == []


# ── Bus wiring ────────────────────────────────────────────────────────────


class TestBusWiring:
    async def test_publish_without_a_session_delivers_at_once(self):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        bus = EventBus()
        await bus.publish("card.updated", {"secret": "x"}, card_id=cid)
        (ping,) = _drain(inbox)
        assert dict(ping).keys() == {"event", "card_id", "timestamp"}
        assert "secret" not in str(ping)

    async def test_pings_do_not_go_through_the_fan_out(self):
        cid = uuid.uuid4()
        _watching(cid)
        bus = EventBus()
        other: asyncio.Queue = asyncio.Queue(maxsize=8)
        bus._subscribers.append(other)
        await bus.publish("card.updated", {}, card_id=cid)
        (msg,) = _drain(other)
        assert msg["event"] == "card.updated"
        assert not isinstance(msg, card_watch.CardChangedPing)

    async def test_publish_without_a_card_id_pings_nobody(self):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await EventBus().publish("notification.created", {"card_id": str(cid)})
        assert _drain(inbox) == []

    async def test_subscribe_uses_a_caller_owned_queue(self):
        bus = EventBus()
        inbox: asyncio.Queue = asyncio.Queue(maxsize=4)
        gen = bus.subscribe(inbox=inbox)
        task = asyncio.ensure_future(gen.__anext__())
        await asyncio.sleep(0)
        assert bus._subscribers == [inbox]
        inbox.put_nowait({"event": "direct"})
        assert (await task) == {"event": "direct"}
        await gen.aclose()
        assert bus._subscribers == []


async def _real_card(db) -> uuid.UUID:
    from tests.conftest import create_card, create_card_type

    await create_card_type(db, key="WatchedThing", label="Watched thing")
    card = await create_card(db, card_type="WatchedThing", name="Watched")
    await db.commit()
    return card.id


# ── After-commit delivery (PostgreSQL) ────────────────────────────────────


@pytest.fixture
async def owned_session(test_engine):
    """A session that owns its transaction, as ``async_session()`` hands out."""
    session = AsyncSession(test_engine, expire_on_commit=False)
    yield session
    await session.close()


class TestAfterCommitOwnedSession:
    async def test_ping_only_after_commit(self, owned_session):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        card_watch.note_change(owned_session, cid)
        assert _drain(inbox) == []
        await owned_session.commit()
        assert [p["card_id"] for p in _drain(inbox)] == [str(cid)]

    async def test_no_ping_on_rollback(self, owned_session):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        card_watch.note_change(owned_session, cid)
        await owned_session.rollback()
        await owned_session.commit()
        assert _drain(inbox) == []

    async def test_no_ping_when_the_session_closes_without_commit(self, owned_session):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        card_watch.note_change(owned_session, cid)
        await owned_session.close()
        await owned_session.commit()
        assert _drain(inbox) == []
        assert card_watch._PENDING_KEY not in owned_session.sync_session.info

    async def test_savepoint_release_waits_for_the_outer_commit(self, owned_session):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        async with owned_session.begin_nested():
            card_watch.note_change(owned_session, cid)
        # The savepoint is released (after_commit fired) but nothing is visible yet.
        assert _drain(inbox) == []
        await owned_session.commit()
        assert [p["card_id"] for p in _drain(inbox)] == [str(cid)]

    async def test_released_savepoint_dropped_on_outer_rollback(self, owned_session):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        async with owned_session.begin_nested():
            card_watch.note_change(owned_session, cid)
        await owned_session.rollback()
        await owned_session.commit()
        assert _drain(inbox) == []

    async def test_rolled_back_savepoint_drops_only_its_own_changes(self, owned_session):
        kept, dropped, inner = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        streams = {cid: _watching(cid)[1] for cid in (kept, dropped, inner)}
        await owned_session.execute(text("select 1"))
        card_watch.note_change(owned_session, kept)
        outer_sp = await owned_session.begin_nested()
        card_watch.note_change(owned_session, dropped)
        async with owned_session.begin_nested():
            card_watch.note_change(owned_session, inner)
        await outer_sp.rollback()
        await owned_session.commit()
        assert len(_drain(streams[kept])) == 1
        assert _drain(streams[dropped]) == []
        assert _drain(streams[inner]) == []

    async def test_sibling_savepoint_rollback_keeps_a_released_one(self, owned_session):
        kept, dropped = uuid.uuid4(), uuid.uuid4()
        streams = {cid: _watching(cid)[1] for cid in (kept, dropped)}
        await owned_session.execute(text("select 1"))
        async with owned_session.begin_nested():
            card_watch.note_change(owned_session, kept)
        try:
            async with owned_session.begin_nested():
                card_watch.note_change(owned_session, dropped)
                raise ValueError
        except ValueError:
            pass
        await owned_session.commit()
        assert len(_drain(streams[kept])) == 1
        assert _drain(streams[dropped]) == []

    async def test_many_changes_to_one_card_are_one_ping(self, owned_session):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        for _ in range(5):
            card_watch.note_change(owned_session, cid)
        await owned_session.commit()
        assert len(_drain(inbox)) == 1

    async def test_the_next_transaction_starts_clean(self, owned_session):
        cid = uuid.uuid4()
        sid, inbox = _watching(cid)
        await owned_session.execute(text("select 1"))
        card_watch.note_change(owned_session, cid)
        await owned_session.commit()
        _drain(inbox)
        card_watch.mark_forwarded(sid, cid)
        await owned_session.execute(text("select 1"))
        await owned_session.commit()
        assert _drain(inbox) == []


class TestAfterCommitTestFixtureSession:
    """The shared ``db`` fixture's commits release a connection savepoint; the
    session's own transaction is still its root, so a route's ``commit()``
    delivers — which is what lets API tests observe a ping."""

    async def test_commit_delivers(self, db):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await db.execute(text("select 1"))
        card_watch.note_change(db, cid)
        assert _drain(inbox) == []
        await db.commit()
        assert len(_drain(inbox)) == 1

    async def test_nested_then_commit_delivers_once(self, db):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await db.execute(text("select 1"))
        async with db.begin_nested():
            card_watch.note_change(db, cid)
        assert _drain(inbox) == []
        await db.commit()
        assert len(_drain(inbox)) == 1

    async def test_rollback_drops(self, db):
        cid = uuid.uuid4()
        _sid, inbox = _watching(cid)
        await db.execute(text("select 1"))
        card_watch.note_change(db, cid)
        await db.rollback()
        await db.commit()
        assert _drain(inbox) == []

    async def test_a_persisted_publish_pings_after_commit(self, db):
        """The bus records the change on the session; the commit delivers it."""
        cid = await _real_card(db)
        _sid, inbox = _watching(cid)
        await EventBus().publish("card.updated", {"changes": {"name": {}}}, db=db, card_id=cid)
        assert _drain(inbox) == []
        await db.commit()
        (ping,) = _drain(inbox)
        assert dict(ping).keys() == {"event", "card_id", "timestamp"}
        assert ping["card_id"] == str(cid)

    async def test_a_persisted_publish_rolled_back_pings_nobody(self, db):
        cid = await _real_card(db)
        _sid, inbox = _watching(cid)
        await EventBus().publish("card.updated", {}, db=db, card_id=cid)
        await db.rollback()
        await db.commit()
        assert _drain(inbox) == []
