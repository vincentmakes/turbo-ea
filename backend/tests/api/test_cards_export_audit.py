"""``GET /cards/export/csv`` and ``/cards/export/json`` write an audit row.

Each bulk card export records ``access.export.cards`` (category ``access``)
with the format, the card types it was filtered to (by label, under
``context.card_type``) and the number of rows that left the instance, and
commits it before the response is built. A single exported type is also the
row's target; a type key that matches no card type is recorded as itself,
clipped to 255 characters.

Every read goes through ``_committed``, which rolls the session back first: the
``db`` fixture shares one session with the app, so a row that was only flushed
would still be visible and prove nothing. ORM instances are expired by the
rollback, so ids and auth headers are captured *before* the request.

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


async def _committed(db) -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "access.export.cards")
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    no_export = {k: v for k, v in VIEWER_PERMISSIONS.items() if k != "inventory.export"}
    await create_role(db, key="noexport", label="No export", permissions=no_export)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Organization", label="Organization")
    admin = await create_user(db, email="admin@test.com", role="admin")
    reader = await create_user(db, email="reader@test.com", role="noexport")
    await create_card(db, card_type="Application", name="App One", user_id=admin.id)
    await create_card(db, card_type="Application", name="App Two", user_id=admin.id)
    await create_card(db, card_type="Organization", name="Org One", user_id=admin.id)
    await create_card(db, card_type="Application", name="Gone", user_id=admin.id, status="ARCHIVED")
    return {
        "admin_id": admin.id,
        "admin_h": auth_headers(admin),
        "reader_h": auth_headers(reader),
    }


def _assert_admin_access_row(row, env):
    assert row.category == "access"
    assert row.outcome == "success"
    assert row.actor_user_id == env["admin_id"]
    assert row.actor_email == "admin@test.com"


class TestCsv:
    async def test_typed_export_records_format_type_and_rows(self, client, db, env):
        resp = await client.get("/api/v1/cards/export/csv?type=Application", headers=env["admin_h"])
        assert resp.status_code == 200
        body = resp.text
        assert "App One" in body and "App Two" in body
        assert "Org One" not in body and "Gone" not in body
        assert len(body.strip().splitlines()) == 3  # header + two rows

        [row] = await _committed(db)
        _assert_admin_access_row(row, env)
        assert (row.target_type, row.target_id, row.target_label) == (
            "card_type",
            "Application",
            "Application",
        )
        assert row.details == {
            "context": {"format": "csv", "rows": 2, "card_type": ["Application"]}
        }

    async def test_unfiltered_export_has_no_target(self, client, db, env):
        resp = await client.get("/api/v1/cards/export/csv", headers=env["admin_h"])
        assert resp.status_code == 200

        [row] = await _committed(db)
        _assert_admin_access_row(row, env)
        assert row.target_type is None and row.target_id is None
        assert row.details == {"context": {"format": "csv", "rows": 3}}

    async def test_single_type_target_carries_the_type_label(self, client, db, env):
        await create_card_type(db, key="itAsset", label="IT Asset")
        resp = await client.get("/api/v1/cards/export/csv?type=itAsset", headers=env["admin_h"])
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert (row.target_type, row.target_id, row.target_label) == (
            "card_type",
            "itAsset",
            "IT Asset",
        )
        # The label, never the key.
        assert row.details == {"context": {"format": "csv", "rows": 0, "card_type": ["IT Asset"]}}

    async def test_unknown_type_falls_back_to_the_key_as_label(self, client, db, env):
        resp = await client.get("/api/v1/cards/export/csv?type=NoSuchType", headers=env["admin_h"])
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert (row.target_id, row.target_label) == ("NoSuchType", "NoSuchType")
        assert row.details == {"context": {"format": "csv", "rows": 0, "card_type": ["NoSuchType"]}}

    async def test_an_over_long_type_filter_is_clipped_in_details(self, client, db, env):
        long_type = "x" * 1000
        resp = await client.get(
            f"/api/v1/cards/export/csv?type={long_type}", headers=env["admin_h"]
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.details == {"context": {"format": "csv", "rows": 0, "card_type": ["x" * 255]}}
        assert len(row.target_id) <= 100
        assert len(row.target_label) <= 255

    async def test_without_inventory_export_is_refused_and_records_nothing(self, client, db, env):
        resp = await client.get("/api/v1/cards/export/csv", headers=env["reader_h"])
        assert resp.status_code == 403
        assert await _committed(db) == []


class TestJson:
    async def test_single_type_export_records_format_type_and_rows(self, client, db, env):
        resp = await client.get(
            "/api/v1/cards/export/json?types=Application", headers=env["admin_h"]
        )
        assert resp.status_code == 200
        assert sorted(item["name"] for item in resp.json()) == ["App One", "App Two"]

        [row] = await _committed(db)
        _assert_admin_access_row(row, env)
        assert (row.target_type, row.target_id, row.target_label) == (
            "card_type",
            "Application",
            "Application",
        )
        assert row.details == {
            "context": {"format": "json", "rows": 2, "card_type": ["Application"]}
        }

    async def test_single_type_target_carries_the_type_label(self, client, db, env):
        await create_card_type(db, key="itAsset", label="IT Asset")
        resp = await client.get("/api/v1/cards/export/json?types=itAsset", headers=env["admin_h"])
        assert resp.status_code == 200
        assert resp.json() == []

        [row] = await _committed(db)
        assert (row.target_id, row.target_label) == ("itAsset", "IT Asset")
        assert row.details == {"context": {"format": "json", "rows": 0, "card_type": ["IT Asset"]}}

    async def test_a_long_types_list_names_every_type(self, client, db, env):
        keys = [f"Type{i:02d}{'y' * 20}" for i in range(20)]
        types = ",".join(keys)
        resp = await client.get(f"/api/v1/cards/export/json?types={types}", headers=env["admin_h"])
        assert resp.status_code == 200

        [row] = await _committed(db)
        # Unknown keys read as themselves, one list entry each.
        assert row.details == {"context": {"format": "json", "rows": 0, "card_type": keys}}
        assert row.target_type is None

    async def test_multi_type_export_names_every_type_and_no_single_target(self, client, db, env):
        resp = await client.get(
            "/api/v1/cards/export/json?types=Application, Organization",
            headers=env["admin_h"],
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 3

        [row] = await _committed(db)
        assert row.target_type is None
        assert row.details == {
            "context": {
                "format": "json",
                "rows": 3,
                "card_type": ["Application", "Organization"],
            }
        }

    async def test_multi_type_export_records_labels(self, client, db, env):
        await create_card_type(db, key="itAsset", label="IT Asset")
        resp = await client.get(
            "/api/v1/cards/export/json?types=itAsset,Application", headers=env["admin_h"]
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.target_type is None
        # In the order asked for, each by its label.
        assert row.details == {
            "context": {"format": "json", "rows": 2, "card_type": ["IT Asset", "Application"]}
        }

    async def test_without_inventory_export_is_refused_and_records_nothing(self, client, db, env):
        resp = await client.get(
            "/api/v1/cards/export/json?types=Application", headers=env["reader_h"]
        )
        assert resp.status_code == 403
        assert await _committed(db) == []

    async def test_rejected_input_records_nothing(self, client, db, env):
        resp = await client.get("/api/v1/cards/export/json?types=,", headers=env["admin_h"])
        assert resp.status_code == 400
        assert await _committed(db) == []
