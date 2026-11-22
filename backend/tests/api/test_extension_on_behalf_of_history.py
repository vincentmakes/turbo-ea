"""A card's History tab names the person an extension wrote for (SDK 1.19).

``ctx.on_behalf_of(user)`` sets the event's ``user_id``; this pins that
``GET /cards/{id}/history`` turns it into the person's display name while the
origin stays ``ext`` (the Extension chip), and that a write outside the scope
still reads as System (no name).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.services.extensions import data_service
from app.services.extensions.data_service import ExtensionData, on_behalf_of
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

KEY = "sample-connector"


@pytest.fixture(autouse=True)
def _extension(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(data_service, "async_session", fake_session)
    extension_registry.clear()
    data_service.reset_rate_limiter()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Connector",
                version="1.0.0",
                status="installed",
                enabled=True,
                manifest={"grants": ["core.cards.write"]},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=datetime.now(timezone.utc) - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )
    yield
    extension_registry.clear()
    data_service.reset_rate_limiter()


async def test_history_names_the_person_and_keeps_the_extension_origin(client, db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application")
    person = await create_user(db, email="alice@test.com", role="admin", display_name="Alice")
    card = await create_card(db, card_type="Application", name="Billing")
    bridge = ExtensionData(KEY)

    with on_behalf_of(person):
        await bridge.update_card(str(card.id), {"name": "For Alice"})
    await bridge.update_card(str(card.id), {"name": "On its own"})

    resp = await client.get(f"/api/v1/cards/{card.id}/history", headers=auth_headers(person))
    assert resp.status_code == 200
    updates = {
        e["data"]["changes"]["name"]["new"]: e
        for e in resp.json()
        if e["event_type"] == "card.updated"
    }
    mine = updates["For Alice"]
    assert mine["user_id"] == str(person.id)
    assert mine["user_display_name"] == "Alice"
    assert mine["data"]["origin"] == "ext"
    assert mine["data"]["ext"] == KEY
    unattributed = updates["On its own"]
    assert unattributed["user_id"] is None
    assert unattributed["user_display_name"] is None
    assert unattributed["data"]["origin"] == "ext"
