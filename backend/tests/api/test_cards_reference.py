"""Integration tests for human-readable card references (#811).

The number is always system-generated. `auto` uses a fixed admin prefix;
`custom` lets the caller pick the prefix per card. References are immutable.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def ref_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    admin = await create_user(db, email="refadmin@test.com", role="admin")
    member = await create_user(db, email="refmember@test.com", role="member")
    return {"admin": admin, "member": member}


async def _type(db, key, mode, prefix="APP-", start=10000, padding=0):
    ct = await create_card_type(db, key=key, label=key)
    ct.reference_config = {"mode": mode, "prefix": prefix, "start": start, "padding": padding}
    await db.flush()
    return ct


async def _create(client, admin, body):
    return await client.post("/api/v1/cards", json=body, headers=auth_headers(admin))


async def test_auto_type_assigns_sequential_reference(client, db, ref_env):
    admin = ref_env["admin"]
    await _type(db, "Application", "auto", prefix="APP-", start=10000)
    r1 = await _create(client, admin, {"type": "Application", "name": "One"})
    r2 = await _create(client, admin, {"type": "Application", "name": "Two"})
    assert r1.json()["reference"] == "APP-10000"
    assert r2.json()["reference"] == "APP-10001"


async def test_off_type_leaves_reference_null(client, db, ref_env):
    admin = ref_env["admin"]
    await _type(db, "Application", "off")
    r = await _create(client, admin, {"type": "Application", "name": "One"})
    assert r.json()["reference"] is None


async def test_reference_is_immutable_on_update(client, db, ref_env):
    admin = ref_env["admin"]
    await _type(db, "Application", "auto", prefix="APP-", start=10000)
    created = await _create(client, admin, {"type": "Application", "name": "One"})
    cid = created.json()["id"]
    # `reference` is not an accepted update field — silently ignored, stays put.
    upd = await client.patch(
        f"/api/v1/cards/{cid}",
        json={"reference": "HACK-1", "name": "One v2"},
        headers=auth_headers(admin),
    )
    assert upd.status_code == 200
    assert upd.json()["reference"] == "APP-10000"


async def test_shared_prefix_is_globally_unique_across_types(client, db, ref_env):
    """Two types configured with the same prefix share one contiguous series."""
    admin = ref_env["admin"]
    await _type(db, "Application", "auto", prefix="APP-", start=10000)
    await _type(db, "Interface", "auto", prefix="APP-", start=10000)
    a = await _create(client, admin, {"type": "Application", "name": "A"})
    b = await _create(client, admin, {"type": "Interface", "name": "B"})
    assert a.json()["reference"] == "APP-10000"
    assert b.json()["reference"] == "APP-10001"


async def test_save_does_not_backfill_generate_does(client, db, ref_env):
    """Enabling + saving the config must NOT backfill existing cards; the explicit
    Generate action does."""
    admin = ref_env["admin"]
    ct = await create_card_type(db, key="Application", label="Application")
    ct.reference_config = {}
    await db.flush()
    from datetime import datetime, timezone

    a = await create_card(db, card_type="Application", name="First", user_id=admin.id)
    b = await create_card(db, card_type="Application", name="Second", user_id=admin.id)
    a.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    b.created_at = datetime(2026, 1, 2, tzinfo=timezone.utc)
    await db.flush()

    # Save the config → existing cards stay ID-less (no implicit bulk mutation).
    resp = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"reference_config": {"mode": "auto", "prefix": "APP-", "start": 10000}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    assert (await client.get(f"/api/v1/cards/{a.id}", headers=auth_headers(admin))).json()[
        "reference"
    ] is None

    # Explicit Generate → existing cards get sequential IDs in creation order.
    gen = await client.post(
        "/api/v1/metamodel/types/Application/generate-references", headers=auth_headers(admin)
    )
    assert gen.status_code == 200
    assert gen.json()["generated"] == 2
    ga = await client.get(f"/api/v1/cards/{a.id}", headers=auth_headers(admin))
    gb = await client.get(f"/api/v1/cards/{b.id}", headers=auth_headers(admin))
    assert ga.json()["reference"] == "APP-10000"
    assert gb.json()["reference"] == "APP-10001"


async def test_generate_references_requires_enabled(client, db, ref_env):
    admin = ref_env["admin"]
    await _type(db, "Application", "off")
    resp = await client.post(
        "/api/v1/metamodel/types/Application/generate-references", headers=auth_headers(admin)
    )
    assert resp.status_code == 400


async def test_metamodel_format_locked_once_ids_exist(client, db, ref_env):
    """Prefix / start / padding are frozen once a card of the type has an ID."""
    admin = ref_env["admin"]
    await _type(db, "Application", "auto", prefix="APP-", start=10000, padding=0)
    await _create(client, admin, {"type": "Application", "name": "One"})
    for change in (
        {"mode": "auto", "prefix": "XXX-", "start": 10000, "padding": 0},  # prefix
        {"mode": "auto", "prefix": "APP-", "start": 500, "padding": 0},  # start
        {"mode": "auto", "prefix": "APP-", "start": 10000, "padding": 5},  # padding
    ):
        resp = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"reference_config": change},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


async def test_metamodel_can_turn_off_when_locked(client, db, ref_env):
    """Toggling the feature off is still allowed once IDs exist (format unchanged)."""
    admin = ref_env["admin"]
    await _type(db, "Application", "auto", prefix="APP-", start=10000, padding=0)
    await _create(client, admin, {"type": "Application", "name": "One"})
    resp = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"reference_config": {"mode": "off", "prefix": "APP-", "start": 10000, "padding": 0}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200


async def test_reference_usage_reports_lock_and_missing(client, db, ref_env):
    admin = ref_env["admin"]
    ct = await create_card_type(db, key="Application", label="Application")
    ct.reference_config = {"mode": "auto", "prefix": "APP-", "start": 10000, "padding": 0}
    await create_card(db, card_type="Application", name="Old", user_id=admin.id)  # no ID yet
    await db.flush()
    r0 = await client.get(
        "/api/v1/metamodel/types/Application/reference-usage", headers=auth_headers(admin)
    )
    assert r0.json() == {"count": 0, "missing": 1, "locked": False}
    # A newly created card auto-gets an ID → locked, and one card still missing.
    await _create(client, admin, {"type": "Application", "name": "New"})
    r1 = await client.get(
        "/api/v1/metamodel/types/Application/reference-usage", headers=auth_headers(admin)
    )
    body = r1.json()
    assert body["locked"] is True and body["count"] == 1 and body["missing"] == 1


async def test_metamodel_invalid_config_rejected(client, db, ref_env):
    admin = ref_env["admin"]
    await create_card_type(db, key="Application", label="Application")
    resp = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"reference_config": {"mode": "auto", "prefix": "bad space"}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 400


async def test_bulk_create_auto_sequential(client, db, ref_env):
    admin = ref_env["admin"]
    await _type(db, "Application", "auto", prefix="APP-", start=10000)
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "A"},
            {"row_index": 2, "type": "Application", "name": "B"},
            {"row_index": 3, "type": "Application", "name": "C"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    ids = [r["id"] for r in resp.json()["results"] if r["status"] == "created"]
    refs = []
    for cid in ids:
        got = await client.get(f"/api/v1/cards/{cid}", headers=auth_headers(admin))
        refs.append(got.json()["reference"])
    assert sorted(refs) == ["APP-10000", "APP-10001", "APP-10002"]
