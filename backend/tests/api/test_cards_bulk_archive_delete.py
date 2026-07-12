"""Tests for the bulk archive + bulk delete endpoints.

These cover the bulk-specific behaviour the per-card endpoints can't:
the cascade-race that bites a frontend worker pool (parent + descendant
together in one input both end up at the desired end state, not "400 already
archived"), and the aggregated `skipped` reporting for idempotent inputs.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.card import Card
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=[{"section": "General", "fields": []}],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


class TestBulkArchive:
    async def test_archives_independent_cards(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id)
        b = await create_card(db, name="B", user_id=admin.id)
        c = await create_card(db, name="C", user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(a.id), str(b.id), str(c.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["requested"] == 3
        assert set(body["archived_card_ids"]) == {str(a.id), str(b.id), str(c.id)}
        assert body["cascaded_card_ids"] == []
        assert body["skipped"] == []

        for cid in (a.id, b.id, c.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ARCHIVED"

    async def test_already_archived_returned_as_skipped(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id, status="ARCHIVED")
        b = await create_card(db, name="B", user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(a.id), str(b.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["archived_card_ids"] == [str(b.id)]
        assert body["skipped"] == [{"card_id": str(a.id), "reason": "already_archived"}]

    async def test_unknown_id_returned_as_skipped(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id)
        ghost_id = "00000000-0000-0000-0000-000000000001"

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(a.id), ghost_id]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["archived_card_ids"] == [str(a.id)]
        assert body["skipped"] == [{"card_id": ghost_id, "reason": "not_found"}]

    async def test_cascade_race_fixed_parent_and_descendant_in_input(self, client, db, env):
        """Regression: the bug that motivated the bulk endpoint.

        With per-card workers in the frontend, sending parent+child in the
        same selection (with child_strategy='cascade') used to crash because
        the parent's request cascaded the child to ARCHIVED before the
        child's own request fired, which then 400'd "already archived".
        The bulk endpoint resolves the union once and flips it atomically.
        """
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={
                "card_ids": [str(parent.id), str(child.id)],
                "child_strategy": "cascade",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # Both end archived. The child appears in archived_card_ids (it was
        # explicitly in the input), not in cascaded_card_ids.
        assert set(body["archived_card_ids"]) == {str(parent.id), str(child.id)}
        assert body["cascaded_card_ids"] == []
        assert body["skipped"] == []

    async def test_cascade_with_descendant_only_in_subtree(self, client, db, env):
        """Descendants not in the input but reached via cascade end up in `cascaded_card_ids`."""
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(parent.id)], "child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["archived_card_ids"] == [str(parent.id)]
        assert body["cascaded_card_ids"] == [str(child.id)]

        for cid in (parent.id, child.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ARCHIVED"

    async def test_children_present_409_when_no_strategy(self, client, db, env):
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(parent.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["error"] == "children_present"
        assert detail["card_id"] == str(parent.id)

    async def test_min_length_validation(self, client, db, env):
        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": []},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422

    async def test_reason_recorded_on_archive_events(self, client, db, env):
        # `reason` used to be accepted-and-dropped; it must land in the
        # card.archived event data (the MCP archive_cards tool sends it).
        admin = env["admin"]
        a = await create_card(db, name="Reasoned", user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(a.id)], "reason": "superseded by NexaCore"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text

        from app.models.event import Event

        events = (
            (
                await db.execute(
                    select(Event).where(Event.card_id == a.id, Event.event_type == "card.archived")
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].data.get("reason") == "superseded by NexaCore"


class TestBulkDelete:
    async def test_deletes_independent_cards(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id)
        b = await create_card(db, name="B", user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-delete",
            json={"card_ids": [str(a.id), str(b.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body["deleted_card_ids"]) == {str(a.id), str(b.id)}
        assert body["skipped"] == []

        for cid in (a.id, b.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one_or_none()
            assert row is None

    async def test_unknown_id_returned_as_skipped(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id)
        ghost_id = "00000000-0000-0000-0000-000000000002"

        resp = await client.post(
            "/api/v1/cards/bulk-delete",
            json={"card_ids": [str(a.id), ghost_id]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["deleted_card_ids"] == [str(a.id)]
        assert body["skipped"] == [{"card_id": ghost_id, "reason": "not_found"}]

    async def test_parent_and_descendant_in_input_with_cascade(self, client, db, env):
        """The delete-mode equivalent of the cascade-race regression test.

        Parent + child both in the input, cascade strategy. Per-card delete
        used to 404 the child after the parent's cascade. Bulk endpoint
        deletes both in one transaction, leaves-first.
        """
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-delete",
            json={
                "card_ids": [str(parent.id), str(child.id)],
                "child_strategy": "cascade",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body["deleted_card_ids"]) == {str(parent.id), str(child.id)}
        assert body["skipped"] == []

        for cid in (parent.id, child.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one_or_none()
            assert row is None


class TestBulkRestore:
    async def test_restores_archived_cards(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id, status="ARCHIVED")
        b = await create_card(db, name="B", user_id=admin.id, status="ARCHIVED")

        resp = await client.post(
            "/api/v1/cards/bulk-restore",
            json={"card_ids": [str(a.id), str(b.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body["restored_card_ids"]) == {str(a.id), str(b.id)}
        assert body["skipped"] == []

        for cid in (a.id, b.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ACTIVE"
            assert row.archived_at is None

    async def test_already_active_returned_as_skipped(self, client, db, env):
        admin = env["admin"]
        archived = await create_card(db, name="Archived", user_id=admin.id, status="ARCHIVED")
        active = await create_card(db, name="Active", user_id=admin.id)

        resp = await client.post(
            "/api/v1/cards/bulk-restore",
            json={"card_ids": [str(archived.id), str(active.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["restored_card_ids"] == [str(archived.id)]
        assert body["skipped"] == [{"card_id": str(active.id), "reason": "already_active"}]

    async def test_unknown_id_returned_as_skipped(self, client, db, env):
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id, status="ARCHIVED")
        ghost_id = "00000000-0000-0000-0000-000000000003"

        resp = await client.post(
            "/api/v1/cards/bulk-restore",
            json={"card_ids": [str(a.id), ghost_id]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["restored_card_ids"] == [str(a.id)]
        assert body["skipped"] == [{"card_id": ghost_id, "reason": "not_found"}]
