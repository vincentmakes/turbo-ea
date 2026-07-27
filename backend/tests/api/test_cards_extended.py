"""Integration tests for card sub-endpoints: hierarchy, history, bulk update, CSV export.

These endpoints are NOT covered by test_cards.py and require a PostgreSQL test database.
"""

from __future__ import annotations

import re
import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# Shared fixture: roles + users + a hierarchical card type
# ---------------------------------------------------------------------------


@pytest.fixture
async def env(db):
    """Prerequisite data shared by all extended card tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)

    # A card type with has_hierarchy=True for hierarchy tests
    hier_type = await create_card_type(
        db,
        key="Organization",
        label="Organization",
        has_hierarchy=True,
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "headcount",
                        "label": "Headcount",
                        "type": "number",
                        "weight": 1,
                    },
                ],
            }
        ],
    )

    # A flat card type for non-hierarchy tests
    flat_type = await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=False,
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "low", "label": "Low"},
                            {"key": "high", "label": "High"},
                        ],
                    },
                ],
            }
        ],
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "hier_type": hier_type,
        "flat_type": flat_type,
    }


# ===========================================================================
# GET /cards/{id}/hierarchy
# ===========================================================================


class TestGetHierarchy:
    async def test_root_card_no_parent_no_children(self, client, db, env):
        """A card without parent or children returns level=1, empty ancestors and children."""
        admin = env["admin"]
        card = await create_card(db, card_type="Organization", name="Root Org", user_id=admin.id)

        response = await client.get(
            f"/api/v1/cards/{card.id}/hierarchy",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["level"] == 1
        assert data["ancestors"] == []
        assert data["children"] == []

    async def test_hierarchy_with_parent_and_children(self, client, db, env):
        """A card with a parent and children returns correct ancestors and children lists."""
        admin = env["admin"]

        # Create grandparent -> parent -> child structure
        grandparent = await create_card(
            db, card_type="Organization", name="Grandparent Org", user_id=admin.id
        )
        parent = await create_card(
            db,
            card_type="Organization",
            name="Parent Org",
            user_id=admin.id,
            parent_id=grandparent.id,
        )
        await create_card(
            db,
            card_type="Organization",
            name="Child A",
            user_id=admin.id,
            parent_id=parent.id,
        )
        await create_card(
            db,
            card_type="Organization",
            name="Child B",
            user_id=admin.id,
            parent_id=parent.id,
        )

        # Query hierarchy for the parent card
        response = await client.get(
            f"/api/v1/cards/{parent.id}/hierarchy",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()

        # Parent is level 2 (grandparent is level 1)
        assert data["level"] == 2

        # Ancestors list should contain grandparent (root-first order)
        assert len(data["ancestors"]) == 1
        assert data["ancestors"][0]["id"] == str(grandparent.id)
        assert data["ancestors"][0]["name"] == "Grandparent Org"

        # Children should include both child cards
        child_names = sorted([c["name"] for c in data["children"]])
        assert child_names == ["Child A", "Child B"]
        assert len(data["children"]) == 2

    async def test_hierarchy_card_not_found(self, client, db, env):
        """Requesting hierarchy for a non-existent card returns 404."""
        admin = env["admin"]
        fake_id = uuid.uuid4()

        response = await client.get(
            f"/api/v1/cards/{fake_id}/hierarchy",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ===========================================================================
# GET /cards/{id}/history
# ===========================================================================


class TestGetHistory:
    async def test_history_empty_for_new_card(self, client, db, env):
        """A freshly created card (via direct DB insert) has no events."""
        admin = env["admin"]
        card = await create_card(
            db, card_type="Application", name="No History App", user_id=admin.id
        )

        response = await client.get(
            f"/api/v1/cards/{card.id}/history",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    async def test_history_after_update(self, client, db, env):
        """Updating a card via the API creates events visible in history."""
        admin = env["admin"]

        # Create card via API (generates card.created event)
        create_resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "History App"},
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 201
        card_id = create_resp.json()["id"]

        # Update the card (generates card.updated event)
        update_resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"name": "History App Updated"},
            headers=auth_headers(admin),
        )
        assert update_resp.status_code == 200

        # Fetch history
        response = await client.get(
            f"/api/v1/cards/{card_id}/history",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # card.created + card.updated

        event_types = [e["event_type"] for e in data]
        assert "card.created" in event_types
        assert "card.updated" in event_types

    async def test_history_pagination(self, client, db, env):
        """History endpoint respects page and page_size parameters."""
        admin = env["admin"]

        # Create card via API
        create_resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Paginated App"},
            headers=auth_headers(admin),
        )
        assert create_resp.status_code == 201
        card_id = create_resp.json()["id"]

        # Make several updates to generate multiple events
        for i in range(3):
            await client.patch(
                f"/api/v1/cards/{card_id}",
                json={"name": f"Paginated App v{i + 1}"},
                headers=auth_headers(admin),
            )

        # Total events: 1 create + 3 updates = 4

        # Request page 1 with page_size=2
        resp_p1 = await client.get(
            f"/api/v1/cards/{card_id}/history?page=1&page_size=2",
            headers=auth_headers(admin),
        )
        assert resp_p1.status_code == 200
        page1 = resp_p1.json()
        assert len(page1) == 2

        # Request page 2 with page_size=2
        resp_p2 = await client.get(
            f"/api/v1/cards/{card_id}/history?page=2&page_size=2",
            headers=auth_headers(admin),
        )
        assert resp_p2.status_code == 200
        page2 = resp_p2.json()
        assert len(page2) == 2

        # Pages should not overlap
        page1_ids = {e["id"] for e in page1}
        page2_ids = {e["id"] for e in page2}
        assert page1_ids.isdisjoint(page2_ids)


# ===========================================================================
# PATCH /cards/bulk
# ===========================================================================


class TestBulkUpdate:
    async def test_bulk_update_names(self, client, db, env):
        """Admin can bulk-update the name of multiple cards."""
        admin = env["admin"]
        card_a = await create_card(db, card_type="Application", name="Bulk A", user_id=admin.id)
        card_b = await create_card(db, card_type="Application", name="Bulk B", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card_a.id), str(card_b.id)],
                "updates": {"name": "Bulk Updated"},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        for card in data:
            assert card["name"] == "Bulk Updated"

    async def test_bulk_update_attributes(self, client, db, env):
        """Admin can bulk-update attributes on multiple cards."""
        admin = env["admin"]
        card_a = await create_card(db, card_type="Application", name="Attr A", user_id=admin.id)
        card_b = await create_card(db, card_type="Application", name="Attr B", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card_a.id), str(card_b.id)],
                "updates": {"attributes": {"riskLevel": "high"}},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        for card in data:
            assert card["attributes"]["riskLevel"] == "high"

    async def test_bulk_update_recomputes_data_quality(self, client, db, env):
        """Bulk-filling a scored attribute refreshes data_quality (#760).

        Factory-created cards start at data_quality == 0.0. A bulk PATCH that
        populates a weighted attribute must rescore them, just like the
        single-card PATCH path does.
        """
        admin = env["admin"]
        card_a = await create_card(db, card_type="Application", name="Score A", user_id=admin.id)
        card_b = await create_card(db, card_type="Application", name="Score B", user_id=admin.id)
        assert card_a.data_quality == 0.0
        assert card_b.data_quality == 0.0

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card_a.id), str(card_b.id)],
                "updates": {"attributes": {"costTotalAnnual": 1000, "riskLevel": "high"}},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        for card in data:
            assert card["data_quality"] > 0.0

    async def test_bulk_update_viewer_forbidden(self, client, db, env):
        """Viewer role lacks inventory.bulk_edit and gets 403."""
        admin = env["admin"]
        viewer = env["viewer"]
        card = await create_card(
            db, card_type="Application", name="Protected Card", user_id=admin.id
        )

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card.id)],
                "updates": {"name": "Hacked"},
            },
            headers=auth_headers(viewer),
        )
        assert response.status_code == 403


# ===========================================================================
# PATCH /cards/bulk — parent / hierarchy
# ===========================================================================


class TestBulkUpdateParent:
    """Bulk re-parenting must clear the same bar as the per-card PATCH.

    The endpoint has always accepted `parent_id` (it is a plain `CardUpdate`
    field) but used to apply it with no validation at all — no cycle check, no
    depth check, no sibling-name check, and no level re-sync. It is reachable
    from the MCP `update_cards_bulk` tool as well as the inventory Mass Edit
    dialog, so a bad payload could silently corrupt the tree.
    """

    async def test_bulk_reparent_sets_parent_and_syncs_levels(self, client, db, env):
        """Re-parenting refreshes hierarchyLevel on the moved card and its subtree."""
        admin = env["admin"]
        root = await create_card(db, card_type="Organization", name="Root", user_id=admin.id)
        mover = await create_card(db, card_type="Organization", name="Mover", user_id=admin.id)
        child = await create_card(
            db,
            card_type="Organization",
            name="Child",
            user_id=admin.id,
            parent_id=mover.id,
        )

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(mover.id)], "updates": {"parent_id": str(root.id)}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        await db.refresh(mover)
        await db.refresh(child)
        assert mover.parent_id == root.id
        # Mover drops from L1 to L2, and the cascade must carry its child to L3.
        assert (mover.attributes or {}).get("hierarchyLevel") == 2
        assert (child.attributes or {}).get("hierarchyLevel") == 3

    async def test_bulk_reparent_clears_parent(self, client, db, env):
        """parent_id: null detaches the selected cards to the top level."""
        admin = env["admin"]
        root = await create_card(db, card_type="Organization", name="Root", user_id=admin.id)
        child = await create_card(
            db, card_type="Organization", name="Child", user_id=admin.id, parent_id=root.id
        )

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(child.id)], "updates": {"parent_id": None}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        await db.refresh(child)
        assert child.parent_id is None
        assert (child.attributes or {}).get("hierarchyLevel") == 1

    async def test_bulk_reparent_rejects_self_as_parent(self, client, db, env):
        """A card in the selection can never be its own parent."""
        admin = env["admin"]
        card = await create_card(db, card_type="Organization", name="Solo", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"parent_id": str(card.id)}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400
        assert "own parent" in response.json()["detail"]

        await db.refresh(card)
        assert card.parent_id is None

    async def test_bulk_reparent_rejects_cycle(self, client, db, env):
        """Moving a card under its own descendant would orphan the branch."""
        admin = env["admin"]
        parent = await create_card(db, card_type="Organization", name="Parent", user_id=admin.id)
        child = await create_card(
            db, card_type="Organization", name="Child", user_id=admin.id, parent_id=parent.id
        )
        grandchild = await create_card(
            db, card_type="Organization", name="Grandchild", user_id=admin.id, parent_id=child.id
        )

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(parent.id)], "updates": {"parent_id": str(grandchild.id)}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400
        assert "cycle" in response.json()["detail"].lower()

        await db.refresh(parent)
        assert parent.parent_id is None

    async def test_bulk_reparent_rejects_existing_sibling_name(self, client, db, env):
        """Landing next to a same-named sibling already in the DB is a 409."""
        admin = env["admin"]
        target = await create_card(db, card_type="Organization", name="Target", user_id=admin.id)
        await create_card(
            db, card_type="Organization", name="Finance", user_id=admin.id, parent_id=target.id
        )
        mover = await create_card(db, card_type="Organization", name="Finance", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(mover.id)], "updates": {"parent_id": str(target.id)}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

        await db.refresh(mover)
        assert mover.parent_id is None

    async def test_bulk_reparent_rejects_in_batch_sibling_name(self, client, db, env):
        """Two selected cards of the same name cannot become siblings.

        `check_sibling_name_unique` only sees committed rows, so this collision
        is invisible to it — the handler needs its own in-batch check.
        """
        admin = env["admin"]
        target = await create_card(db, card_type="Organization", name="Target", user_id=admin.id)
        a_parent = await create_card(db, card_type="Organization", name="A", user_id=admin.id)
        b_parent = await create_card(db, card_type="Organization", name="B", user_id=admin.id)
        dup_a = await create_card(
            db, card_type="Organization", name="Ops", user_id=admin.id, parent_id=a_parent.id
        )
        dup_b = await create_card(
            db, card_type="Organization", name="Ops", user_id=admin.id, parent_id=b_parent.id
        )

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(dup_a.id), str(dup_b.id)],
                "updates": {"parent_id": str(target.id)},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

        await db.refresh(dup_a)
        await db.refresh(dup_b)
        assert dup_a.parent_id == a_parent.id
        assert dup_b.parent_id == b_parent.id

    async def test_bulk_reparent_checks_the_incoming_name(self, client, db, env):
        """A rename in the same payload is what the collision check must use."""
        admin = env["admin"]
        target = await create_card(db, card_type="Organization", name="Target", user_id=admin.id)
        await create_card(
            db, card_type="Organization", name="Shared", user_id=admin.id, parent_id=target.id
        )
        mover = await create_card(db, card_type="Organization", name="Distinct", user_id=admin.id)

        # The card's current name would not collide; the name it is being
        # renamed to does.
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(mover.id)],
                "updates": {"name": "Shared", "parent_id": str(target.id)},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

        await db.refresh(mover)
        assert mover.parent_id is None
        assert mover.name == "Distinct"

    async def test_bulk_reparent_breaks_approval(self, client, db, env):
        """An approved card that moves in the tree drops to BROKEN."""
        admin = env["admin"]
        root = await create_card(db, card_type="Organization", name="Root", user_id=admin.id)
        mover = await create_card(
            db,
            card_type="Organization",
            name="Mover",
            user_id=admin.id,
            approval_status="APPROVED",
        )

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(mover.id)], "updates": {"parent_id": str(root.id)}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        await db.refresh(mover)
        assert mover.approval_status == "BROKEN"

    async def test_bulk_reparent_dry_run_persists_nothing(self, client, db, env):
        """dry_run previews the diff without touching the tree."""
        admin = env["admin"]
        root = await create_card(db, card_type="Organization", name="Root", user_id=admin.id)
        mover = await create_card(db, card_type="Organization", name="Mover", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(mover.id)],
                "updates": {"parent_id": str(root.id)},
                "dry_run": True,
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["dry_run"] is True
        assert body["would_update"] == 1
        assert body["results"][0]["after"]["parent_id"] == str(root.id)

        refetched = await client.get(f"/api/v1/cards/{mover.id}", headers=auth_headers(admin))
        assert refetched.json()["parent_id"] is None

    async def test_bulk_reparent_enforces_capability_depth(self, client, db, env):
        """The L1..L5 capability limit applies in bulk, not just per card."""
        admin = env["admin"]
        await create_card_type(db, key="BusinessCapability", label="Business Capability")

        # Build a 5-deep chain: L1 → L2 → L3 → L4 → L5
        parent_id = None
        chain = []
        for level in range(1, 6):
            node = await create_card(
                db,
                card_type="BusinessCapability",
                name=f"L{level}",
                user_id=admin.id,
                parent_id=parent_id,
            )
            chain.append(node)
            parent_id = node.id

        orphan = await create_card(
            db, card_type="BusinessCapability", name="Extra", user_id=admin.id
        )

        # Hanging Extra off L5 would make it L6.
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(orphan.id)], "updates": {"parent_id": str(chain[-1].id)}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400
        assert "maximum depth" in response.json()["detail"]

        await db.refresh(orphan)
        assert orphan.parent_id is None

    async def test_bulk_update_emits_card_updated_events(self, client, db, env):
        """Bulk edits must land in the event log, or History and audit go blind."""
        from sqlalchemy import select

        from app.models.event import Event

        admin = env["admin"]
        card = await create_card(db, card_type="Application", name="Evented", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"name": "Renamed"}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == card.id, Event.event_type == "card.updated"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].data["changes"]["name"]["new"] == "Renamed"

    async def test_bulk_update_dry_run_emits_no_events(self, client, db, env):
        """A preview must not leak events."""
        from sqlalchemy import select

        from app.models.event import Event

        admin = env["admin"]
        card = await create_card(db, card_type="Application", name="Quiet", user_id=admin.id)

        response = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card.id)],
                "updates": {"name": "Renamed"},
                "dry_run": True,
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == card.id, Event.event_type == "card.updated"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert events == []


# ===========================================================================
# GET /cards/export/csv
# ===========================================================================


class TestExportCsv:
    async def test_export_csv_returns_csv_content_type(self, client, db, env):
        """CSV export returns text/csv media type and Content-Disposition header."""
        admin = env["admin"]
        await create_card(db, card_type="Application", name="Export App", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards/export/csv",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]
        assert "Content-Disposition" in response.headers
        assert "attachment" in response.headers["Content-Disposition"]
        # Filename now includes a YYYY-MM-DD_HHMM stamp so multiple same-day
        # exports don't collide; the prefix is still `cards` (with a `_<type>`
        # segment when the request filters by card type).
        disposition = response.headers["Content-Disposition"]
        assert re.search(r"filename=cards(?:_[^_]+)?_\d{4}-\d{2}-\d{2}_\d{4}\.csv", disposition), (
            f"unexpected filename in Content-Disposition: {disposition}"
        )

    async def test_export_csv_with_type_filter(self, client, db, env):
        """CSV export with type filter only includes cards of that type."""
        admin = env["admin"]
        await create_card(db, card_type="Application", name="App For Export", user_id=admin.id)
        await create_card(db, card_type="Organization", name="Org For Export", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards/export/csv?type=Application",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        body = response.text
        lines = body.strip().split("\n")
        # First line is the header
        assert len(lines) >= 2  # header + at least one data row

        # Every data row should have type "Application"
        for line in lines[1:]:
            # CSV columns: id, type, name, description, status, lifecycle, attributes
            # The type is the second column
            assert ",Application," in line

        # The Organization card should NOT appear
        assert "Org For Export" not in body

    async def test_export_csv_has_correct_headers(self, client, db, env):
        """CSV export first row contains the expected column headers."""
        admin = env["admin"]
        await create_card(db, card_type="Application", name="Header Test App", user_id=admin.id)

        response = await client.get(
            "/api/v1/cards/export/csv",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        body = response.text
        lines = body.strip().split("\n")
        header_line = lines[0]
        expected_columns = [
            "id",
            "type",
            "name",
            "description",
            "status",
            "lifecycle",
            "attributes",
        ]
        for col in expected_columns:
            assert col in header_line

    async def test_export_csv_viewer_can_export(self, client, db, env):
        """Viewer role has inventory.export permission and can export CSV."""
        viewer = env["viewer"]

        response = await client.get(
            "/api/v1/cards/export/csv",
            headers=auth_headers(viewer),
        )
        # Viewers have inventory.export=True
        assert response.status_code == 200
