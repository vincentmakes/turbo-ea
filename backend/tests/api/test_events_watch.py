"""Live card updates over the event stream.

``PUT /events/stream/{stream_id}/watch`` and the stream's ``hello`` / ping
messages. The stream is driven by calling the route function directly and
iterating its body: the ASGI test transport buffers a response until it ends,
and an event stream never ends. The stream's own short session is the test's
session (``session_factory_for``), and so is every request's, so a route's
``commit()`` is what delivers a ping here, exactly as in production.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.core.security import create_access_token
from app.models.card_type import CardType
from app.services import card_watch
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture(autouse=True)
def _clean_registry():
    card_watch._reset_for_tests()
    yield
    card_watch._reset_for_tests()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="ppm_only",
        label="PPM only",
        permissions={"ppm.view": True, "inventory.view": False},
    )
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(
        db,
        key="Vault",
        label="Vault",
        role_permissions={"viewer": {"inventory.view": False}},
    )
    PermissionService.invalidate_type_permission_cache()
    admin = await create_user(db, email="admin@watch.test", role="admin")
    member = await create_user(db, email="member@watch.test", role="member")
    viewer = await create_user(db, email="viewer@watch.test", role="viewer")
    ppm_user = await create_user(db, email="ppm@watch.test", role="ppm_only")
    app_card = await create_card(db, card_type="Application", name="Watched App")
    initiative = await create_card(db, card_type="Initiative", name="Watched Initiative")
    vault = await create_card(db, card_type="Vault", name="Hidden Vault")
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "ppm_user": ppm_user,
        "app": app_card,
        "initiative": initiative,
        "vault": vault,
    }


class _FakeRequest:
    def __init__(self) -> None:
        self.cookies: dict[str, str] = {}

    async def is_disconnected(self) -> bool:
        return False


async def _open_stream(db, monkeypatch, user):
    """Open the real event stream for ``user``; returns (body iterator, hello)."""
    from app.api.v1 import events
    from tests.seams import session_factory_for

    monkeypatch.setattr(events, "async_session", session_factory_for(db))
    token = create_access_token(user.id, user.role)
    response = await events.event_stream(_FakeRequest(), token=token)
    body = response.body_iterator
    hello = await _next(body)
    return body, hello


async def _next(body) -> dict:
    chunk = await asyncio.wait_for(body.__anext__(), timeout=5)
    text = chunk if isinstance(chunk, str) else chunk.decode()
    assert text.startswith("data: ") and text.endswith("\n\n")
    return json.loads(text[len("data: ") : -2])


def _stream_for(user) -> str:
    """A stream id registered for ``user`` without opening a connection."""
    return card_watch.open_stream(user.id, asyncio.Queue())


async def _watch(client, user, stream_id, card_ids):
    return await client.put(
        f"/api/v1/events/stream/{stream_id}/watch",
        json={"card_ids": [str(c) for c in card_ids]},
        headers=auth_headers(user),
    )


# ── PUT /events/stream/{stream_id}/watch ──────────────────────────────────


class TestWatchRoute:
    async def test_accepts_readable_cards(self, client, env):
        sid = _stream_for(env["viewer"])
        resp = await _watch(client, env["viewer"], sid, [env["app"].id])
        assert resp.status_code == 200
        assert resp.json() == {
            "card_ids": [str(env["app"].id)],
            "expires_in": card_watch.WATCH_TTL_SECONDS,
        }
        assert card_watch.watchers_exist(env["app"].id)

    async def test_replaces_the_set_and_dedupes(self, client, env):
        sid = _stream_for(env["member"])
        await _watch(client, env["member"], sid, [env["app"].id])
        resp = await _watch(
            client, env["member"], sid, [env["initiative"].id, env["initiative"].id]
        )
        assert resp.json()["card_ids"] == [str(env["initiative"].id)]
        assert not card_watch.watchers_exist(env["app"].id)
        empty = await _watch(client, env["member"], sid, [])
        assert empty.status_code == 200
        assert empty.json() == {"card_ids": [], "expires_in": card_watch.WATCH_TTL_SECONDS}
        assert not card_watch.watchers_exist(env["initiative"].id)

    async def test_unreadable_hidden_and_unknown_cards_are_left_out(self, client, env):
        sid = _stream_for(env["viewer"])
        unknown = uuid.uuid4()
        resp = await _watch(
            client,
            env["viewer"],
            sid,
            [env["vault"].id, unknown, env["app"].id],
        )
        assert resp.status_code == 200
        assert resp.json()["card_ids"] == [str(env["app"].id)]
        assert not card_watch.watchers_exist(env["vault"].id)
        assert not card_watch.watchers_exist(unknown)

    async def test_a_card_type_the_caller_may_not_read_is_left_out(self, client, env):
        sid = _stream_for(env["ppm_user"])
        resp = await _watch(client, env["ppm_user"], sid, [env["app"].id])
        assert resp.status_code == 200
        assert resp.json()["card_ids"] == []

    async def test_an_initiative_readable_through_ppm_view_is_accepted(self, client, env):
        sid = _stream_for(env["ppm_user"])
        resp = await _watch(client, env["ppm_user"], sid, [env["initiative"].id])
        assert resp.json()["card_ids"] == [str(env["initiative"].id)]

    async def test_someone_elses_stream_is_404(self, client, env):
        sid = _stream_for(env["admin"])
        resp = await _watch(client, env["viewer"], sid, [env["app"].id])
        assert resp.status_code == 404
        assert not card_watch.watchers_exist(env["app"].id)

    async def test_unknown_stream_is_404(self, client, env):
        resp = await _watch(client, env["viewer"], "not-a-stream", [env["app"].id])
        assert resp.status_code == 404

    async def test_more_than_ten_ids_is_422(self, client, env):
        sid = _stream_for(env["viewer"])
        resp = await _watch(client, env["viewer"], sid, [uuid.uuid4() for _ in range(11)])
        assert resp.status_code == 422
        ten = await _watch(client, env["viewer"], sid, [uuid.uuid4() for _ in range(10)])
        assert ten.status_code == 200

    async def test_a_malformed_id_is_422(self, client, env):
        sid = _stream_for(env["viewer"])
        resp = await client.put(
            f"/api/v1/events/stream/{sid}/watch",
            json={"card_ids": ["not-a-uuid"]},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 422

    async def test_unauthenticated_is_401(self, client, env):
        sid = _stream_for(env["viewer"])
        resp = await client.put(
            f"/api/v1/events/stream/{sid}/watch", json={"card_ids": [str(env["app"].id)]}
        )
        assert resp.status_code == 401
        assert not card_watch.watchers_exist(env["app"].id)

    async def test_accepted_exactly_when_the_card_detail_opens(self, client, db, env):
        """The watch gate is the ``GET /cards/{id}`` gate, user by user and card by card."""
        users = ("admin", "member", "viewer", "ppm_only")
        cards = ("app", "initiative", "vault")
        by_role = {"ppm_only": "ppm_user"}
        compared = 0
        for role in users:
            user = env[by_role.get(role, role)]
            sid = _stream_for(user)
            for name in cards:
                card = env[name]
                detail = await client.get(f"/api/v1/cards/{card.id}", headers=auth_headers(user))
                watch = await _watch(client, user, sid, [card.id])
                accepted = watch.json()["card_ids"] == [str(card.id)]
                assert accepted is (detail.status_code == 200), (role, name, detail.status_code)
                compared += 1
        assert compared == 12

    async def test_the_card_detail_answers_403_and_404_with_their_messages(self, client, env):
        """The detail route's two refusals, as the shared verdict maps them."""
        forbidden = await client.get(
            f"/api/v1/cards/{env['app'].id}", headers=auth_headers(env["ppm_user"])
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["detail"] == "Insufficient permissions"
        hidden = await client.get(
            f"/api/v1/cards/{env['vault'].id}", headers=auth_headers(env["viewer"])
        )
        assert hidden.status_code == 404
        assert hidden.json()["detail"] == "Card not found"

    async def test_a_view_deny_set_after_registering_is_honoured_on_refresh(self, client, db, env):
        sid = _stream_for(env["member"])
        first = await _watch(client, env["member"], sid, [env["app"].id])
        assert first.json()["card_ids"] == [str(env["app"].id)]
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        refresh = await _watch(client, env["member"], sid, [env["app"].id])
        assert refresh.json()["card_ids"] == []
        assert not card_watch.watchers_exist(env["app"].id)


# ── The stream ────────────────────────────────────────────────────────────


class TestStream:
    async def test_the_first_message_is_the_hello(self, db, monkeypatch, env):
        body, hello = await _open_stream(db, monkeypatch, env["viewer"])
        try:
            assert set(hello) == {"event", "stream_id", "watch_ttl_seconds", "timestamp"}
            assert hello["event"] == "event.stream.hello"
            assert hello["watch_ttl_seconds"] == card_watch.WATCH_TTL_SECONDS == 300
            assert card_watch.owns_stream(hello["stream_id"], env["viewer"].id)
            assert not card_watch.owns_stream(hello["stream_id"], env["admin"].id)
        finally:
            await body.aclose()
        assert not card_watch.owns_stream(hello["stream_id"], env["viewer"].id)

    async def test_non_admin_gets_the_ping_and_no_card_payload(self, client, db, monkeypatch, env):
        viewer = env["viewer"]
        body, hello = await _open_stream(db, monkeypatch, viewer)
        try:
            resp = await _watch(client, viewer, hello["stream_id"], [env["app"].id])
            assert resp.json()["card_ids"] == [str(env["app"].id)]

            patch = await client.patch(
                f"/api/v1/cards/{env['app'].id}",
                json={"description": "changed by another user"},
                headers=auth_headers(env["admin"]),
            )
            assert patch.status_code == 200

            ping = await _next(body)
            assert ping.keys() == {"event", "card_id", "timestamp"}
            assert ping["event"] == "event.stream.card_changed"
            assert ping["card_id"] == str(env["app"].id)

            # A sentinel addressed to the viewer: whatever the stream yields
            # before it is everything else it let through from that write.
            await event_bus.publish("notification.created", {"user_id": str(viewer.id)})
            after = await _next(body)
            assert after["event"] == "notification.created"
        finally:
            await body.aclose()

    async def test_admin_gets_the_payload_and_the_ping(self, client, db, monkeypatch, env):
        admin = env["admin"]
        body, hello = await _open_stream(db, monkeypatch, admin)
        try:
            await _watch(client, admin, hello["stream_id"], [env["app"].id])
            patch = await client.patch(
                f"/api/v1/cards/{env['app'].id}",
                json={"description": "changed"},
                headers=auth_headers(env["member"]),
            )
            assert patch.status_code == 200
            seen: list[dict] = []
            while not any(m["event"] == "event.stream.card_changed" for m in seen):
                seen.append(await _next(body))
            events_seen = [m["event"] for m in seen]
            assert "card.updated" in events_seen
            # The ping comes after the commit, so after the payload published before it.
            assert events_seen.index("card.updated") < events_seen.index(
                "event.stream.card_changed"
            )
        finally:
            await body.aclose()

    async def test_a_burst_of_writes_is_one_ping_until_forwarded(
        self, client, db, monkeypatch, env
    ):
        viewer = env["viewer"]
        body, hello = await _open_stream(db, monkeypatch, viewer)
        try:
            await _watch(client, viewer, hello["stream_id"], [env["app"].id])
            for i in range(3):
                patch = await client.patch(
                    f"/api/v1/cards/{env['app'].id}",
                    json={"description": f"edit {i}"},
                    headers=auth_headers(env["admin"]),
                )
                assert patch.status_code == 200
            ping = await _next(body)
            assert ping["event"] == "event.stream.card_changed"
            await event_bus.publish("notification.created", {"user_id": str(viewer.id)})
            assert (await _next(body))["event"] == "notification.created"
        finally:
            await body.aclose()

    async def test_a_bus_message_named_like_a_ping_is_still_filtered(self, db, monkeypatch, env):
        viewer = env["viewer"]
        body, _hello = await _open_stream(db, monkeypatch, viewer)
        try:
            await event_bus.publish(
                "event.stream.card_changed",
                {"name": "not for the viewer"},
                card_id=env["vault"].id,
            )
            await event_bus.publish("notification.created", {"user_id": str(viewer.id)})
            assert (await _next(body))["event"] == "notification.created"
        finally:
            await body.aclose()
