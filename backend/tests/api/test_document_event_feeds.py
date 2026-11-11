"""Decision and SoAW events reach an activity feed only for a reader who may
open the document.

Once the review events are stored (``test_document_event_persistence.py``)
they show in every feed that lists events: the dashboard's Recent Activity,
the admin summary, My Workspace (``/events/my-cards``) and a card's History
(``adr.linked`` / ``adr.unlinked`` carry the card). Each event names the
document — reference, title, who signed or rejected — so ``adr.*`` needs
``adr.view`` and ``soaw.*`` needs ``soaw.view``. The filter reads the role
cache the route's own permission check filled: a reader who holds both
permissions costs no extra query.
"""

from __future__ import annotations

import pytest
from sqlalchemy import event as sa_event

from app.models.event import Event
from app.models.user_favorite import UserFavorite
from app.services.permission_service import PermissionService
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

BASE = {"reports.ea_dashboard": True, "inventory.view": True, "admin.users": True}
READERS = {
    "neither": {},
    "adr_only": {"adr.view": True},
    "soaw_only": {"soaw.view": True},
    "both": {"adr.view": True, "soaw.view": True},
}
EXPECTED = {
    "neither": {"card.updated"},
    "adr_only": {"card.updated", "adr.signed", "adr.linked"},
    "soaw_only": {"card.updated", "soaw.signed"},
    "both": {"card.updated", "adr.signed", "adr.linked", "soaw.signed"},
}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    users = {}
    for key, extra in READERS.items():
        await create_role(db, key=key, label=key, permissions={**BASE, **extra})
        users[key] = await create_user(db, email=f"{key}@test.com", role=key)
    users["admin"] = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing")
    for user in users.values():
        db.add(UserFavorite(user_id=user.id, card_id=card.id))
    db.add(Event(card_id=card.id, event_type="card.updated", data={"name": "Billing"}))
    db.add(Event(card_id=card.id, event_type="adr.linked", data={"title": "Use Postgres"}))
    db.add(Event(card_id=None, event_type="adr.signed", data={"title": "Use Postgres"}))
    db.add(Event(card_id=None, event_type="soaw.signed", data={"name": "Cloud SoAW"}))
    await db.flush()
    return {"users": users, "card": card}


async def _types(client, user, url, key=None) -> set[str]:
    resp = await client.get(url, headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    rows = resp.json()[key] if key else resp.json()
    return {row["event_type"] for row in rows}


@pytest.mark.parametrize("reader", list(READERS))
async def test_dashboard_recent_activity(client, env, reader):
    got = await _types(client, env["users"][reader], "/api/v1/reports/dashboard", "recent_events")
    assert got == EXPECTED[reader]


@pytest.mark.parametrize("reader", list(READERS))
async def test_admin_dashboard_recent_activity(client, env, reader):
    got = await _types(
        client, env["users"][reader], "/api/v1/reports/admin-dashboard", "recent_activity"
    )
    assert got == EXPECTED[reader]


@pytest.mark.parametrize("reader", list(READERS))
async def test_my_workspace_feed(client, env, reader):
    """Card-less document events never reach My Workspace; a decision linked
    to a favourite card does, for a reader who may open decisions."""
    got = await _types(client, env["users"][reader], "/api/v1/events/my-cards")
    assert got == EXPECTED[reader] - {"adr.signed", "soaw.signed"}


@pytest.mark.parametrize("reader", list(READERS))
async def test_card_history(client, env, reader):
    card_id = env["card"].id
    got = await _types(client, env["users"][reader], f"/api/v1/cards/{card_id}/history")
    assert got == EXPECTED[reader] - {"adr.signed", "soaw.signed"}


async def test_the_wildcard_role_sees_everything(client, env):
    got = await _types(client, env["users"]["admin"], "/api/v1/reports/dashboard", "recent_events")
    assert got == EXPECTED["both"]


@pytest.mark.parametrize(
    "url",
    [
        "/api/v1/reports/dashboard",
        "/api/v1/reports/admin-dashboard",
        "/api/v1/events/my-cards",
        "card-history",
    ],
)
@pytest.mark.parametrize("reader", ["both", "admin"])
async def test_a_full_reader_pays_no_extra_query(client, db, env, monkeypatch, url, reader):
    """The filter reads the role the route already loaded: for a reader who
    holds both permissions the feed runs exactly the queries it ran without
    the filter."""
    import app.api.v1.cards as cards_api
    import app.api.v1.events as events_api
    import app.api.v1.reports as reports_api

    if url == "card-history":
        url = f"/api/v1/cards/{env['card'].id}/history"
    user = env["users"][reader]
    headers = auth_headers(user)

    async def count() -> int:
        # Both requests start cold, so neither borrows the other's caches.
        PermissionService._role_cache.clear()
        PermissionService._srd_cache.clear()
        PermissionService.invalidate_type_permission_cache()
        statements: list[str] = []
        bind = db.sync_session.get_bind()

        def _record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        sa_event.listen(bind, "before_cursor_execute", _record)
        try:
            resp = await client.get(url, headers=headers)
        finally:
            sa_event.remove(bind, "before_cursor_execute", _record)
        assert resp.status_code == 200, resp.text
        return len(statements)

    with_filter = await count()

    async def _no_filter(db, user):
        return ()

    for module in (reports_api, events_api, cards_api):
        monkeypatch.setattr(module, "document_event_read_filters", _no_filter)
    without_filter = await count()

    assert with_filter == without_filter
    assert with_filter > 0
