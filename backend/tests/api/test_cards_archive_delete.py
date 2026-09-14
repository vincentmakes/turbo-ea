"""Integration tests for archive/delete child-strategy + related-card flows.

Covers:
- 409 when children exist and `child_strategy` is omitted.
- The three child strategies (cascade / disconnect / reparent) for both archive
  and delete.
- Reparent fallback when the primary has no parent.
- Approval-status break on direct children whose `parent_id` mutates.
- BusinessCapability `capabilityLevel` recompute after disconnect/reparent.
- Related-card ticking + dedup against descendants.
- All-or-nothing permission gate.
- archive-impact endpoint shape.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card import Card
from app.models.relation import Relation
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    app_type = await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=[{"section": "General", "fields": []}],
    )
    cap_type = await create_card_type(
        db,
        key="BusinessCapability",
        label="Business Capability",
        has_hierarchy=True,
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {"key": "capabilityLevel", "label": "Level", "type": "text", "weight": 0}
                ],
            }
        ],
    )
    itc_type = await create_card_type(
        db,
        key="ITComponent",
        label="IT Component",
        has_hierarchy=False,
        fields_schema=[{"section": "General", "fields": []}],
    )
    await create_relation_type(
        db,
        key="app_to_itc",
        label="uses",
        reverse_label="used by",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "app_type": app_type,
        "cap_type": cap_type,
        "itc_type": itc_type,
    }


# ---------------------------------------------------------------------------
# 409 when no strategy + children exist
# ---------------------------------------------------------------------------


class TestStrategyRequired:
    async def test_archive_with_children_no_strategy_returns_409(self, client, db, env):
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(f"/api/v1/cards/{parent.id}/archive", headers=auth_headers(admin))
        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"]["error"] == "children_present"
        assert body["detail"]["child_count"] == 1

    async def test_delete_with_children_no_strategy_returns_409(self, client, db, env):
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.delete(f"/api/v1/cards/{parent.id}", headers=auth_headers(admin))
        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "children_present"


# ---------------------------------------------------------------------------
# Cascade strategy
# ---------------------------------------------------------------------------


class TestCascade:
    async def test_archive_cascade_archives_subtree(self, client, db, env):
        admin = env["admin"]
        gp = await create_card(db, name="GP", user_id=admin.id)
        p = await create_card(db, name="P", parent_id=gp.id, user_id=admin.id)
        c1 = await create_card(db, name="C1", parent_id=p.id, user_id=admin.id)
        c2 = await create_card(db, name="C2", parent_id=p.id, user_id=admin.id)
        gc = await create_card(db, name="GC", parent_id=c1.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["primary"]["status"] == "ARCHIVED"
        affected = set(body["affected_children_ids"])
        assert {str(c1.id), str(c2.id), str(gc.id)} <= affected

        for cid in (p.id, c1.id, c2.id, gc.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ARCHIVED"
        # Grandparent untouched
        gp_row = (await db.execute(select(Card).where(Card.id == gp.id))).scalar_one()
        assert gp_row.status == "ACTIVE"

    async def test_delete_cascade_removes_subtree(self, client, db, env):
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(db, name="C", parent_id=p.id, user_id=admin.id)
        gc = await create_card(db, name="GC", parent_id=c.id, user_id=admin.id)

        resp = await client.request(
            "DELETE",
            f"/api/v1/cards/{p.id}",
            json={"child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert set(body["deleted_card_ids"]) == {str(p.id), str(c.id), str(gc.id)}

        for cid in (p.id, c.id, gc.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one_or_none()
            assert row is None


# ---------------------------------------------------------------------------
# Disconnect strategy
# ---------------------------------------------------------------------------


class TestDisconnect:
    async def test_archive_disconnect_clears_parent_id(self, client, db, env):
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        c1 = await create_card(db, name="C1", parent_id=p.id, user_id=admin.id)
        c2 = await create_card(db, name="C2", parent_id=p.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "disconnect"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        for cid in (c1.id, c2.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.parent_id is None
            assert row.status == "ACTIVE"

    async def test_archive_disconnect_clears_the_hierarchy_link_label(self, client, db, env):
        """A link label describes an edge — landing at the top level ends it."""
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(
            db, name="C", parent_id=p.id, parent_label="commercial", user_id=admin.id
        )

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "disconnect"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert row.parent_id is None
        assert row.parent_label is None

    async def test_archive_disconnect_breaks_approved_children(self, client, db, env):
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(
            db,
            name="C",
            parent_id=p.id,
            user_id=admin.id,
            approval_status="APPROVED",
        )

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "disconnect"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert row.parent_id is None
        assert row.approval_status == "BROKEN"


# ---------------------------------------------------------------------------
# Reparent strategy
# ---------------------------------------------------------------------------


class TestReparent:
    async def test_archive_reparent_lifts_children_to_grandparent(self, client, db, env):
        admin = env["admin"]
        gp = await create_card(db, name="GP", user_id=admin.id)
        p = await create_card(db, name="P", parent_id=gp.id, user_id=admin.id)
        c = await create_card(db, name="C", parent_id=p.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "reparent"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        c_row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert c_row.parent_id == gp.id
        assert c_row.status == "ACTIVE"

    async def test_archive_reparent_keeps_the_hierarchy_link_label(self, client, db, env):
        """Handed to the grandparent is still a parent, so the label survives."""
        admin = env["admin"]
        gp = await create_card(db, name="GP", user_id=admin.id)
        p = await create_card(db, name="P", parent_id=gp.id, user_id=admin.id)
        c = await create_card(
            db, name="C", parent_id=p.id, parent_label="commercial", user_id=admin.id
        )

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "reparent"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert row.parent_id == gp.id
        assert row.parent_label == "commercial"

    async def test_archive_reparent_without_a_grandparent_clears_the_label(self, client, db, env):
        """No grandparent means this reparent IS a disconnect — label included."""
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(
            db, name="C", parent_id=p.id, parent_label="commercial", user_id=admin.id
        )

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "reparent"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert row.parent_id is None
        assert row.parent_label is None

    async def test_archive_cascade_leaves_the_link_label_alone(self, client, db, env):
        """Cascade leaves `parent_id` intact by design, so the label stands too."""
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(
            db, name="C", parent_id=p.id, parent_label="commercial", user_id=admin.id
        )

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert row.parent_id == p.id
        assert row.parent_label == "commercial"

    async def test_archive_reparent_no_grandparent_falls_back_to_disconnect(self, client, db, env):
        admin = env["admin"]
        # Primary has no parent.
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(db, name="C", parent_id=p.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "reparent"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        c_row = (await db.execute(select(Card).where(Card.id == c.id))).scalar_one()
        assert c_row.parent_id is None

    async def test_capability_level_recomputed_on_reparent(self, client, db, env):
        admin = env["admin"]
        l1 = await create_card(
            db,
            card_type="BusinessCapability",
            name="L1",
            user_id=admin.id,
            attributes={"capabilityLevel": "L1"},
        )
        l2 = await create_card(
            db,
            card_type="BusinessCapability",
            name="L2",
            parent_id=l1.id,
            user_id=admin.id,
            attributes={"capabilityLevel": "L2"},
        )
        l3 = await create_card(
            db,
            card_type="BusinessCapability",
            name="L3",
            parent_id=l2.id,
            user_id=admin.id,
            attributes={"capabilityLevel": "L3"},
        )

        resp = await client.post(
            f"/api/v1/cards/{l2.id}/archive",
            json={"child_strategy": "reparent"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        l3_row = (await db.execute(select(Card).where(Card.id == l3.id))).scalar_one()
        # L3 used to be at L3 (under L2 under L1); reparented to L1, now at L2.
        assert l3_row.parent_id == l1.id
        assert (l3_row.attributes or {}).get("capabilityLevel") == "L2"


# ---------------------------------------------------------------------------
# Related cards
# ---------------------------------------------------------------------------


class TestRelatedCards:
    async def test_archive_with_related_card_ids_archives_those_cards(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        itc1 = await create_card(db, card_type="ITComponent", name="ITC1", user_id=admin.id)
        itc2 = await create_card(db, card_type="ITComponent", name="ITC2", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc1.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc2.id)

        resp = await client.post(
            f"/api/v1/cards/{app.id}/archive",
            json={"related_card_ids": [str(itc1.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        itc1_row = (await db.execute(select(Card).where(Card.id == itc1.id))).scalar_one()
        itc2_row = (await db.execute(select(Card).where(Card.id == itc2.id))).scalar_one()
        # Ticked → archived, untouched → still active.
        assert itc1_row.status == "ARCHIVED"
        assert itc2_row.status == "ACTIVE"

    async def test_archive_related_dedup_against_descendants(self, client, db, env):
        admin = env["admin"]
        # P has a child C; C is also linked via a peer relation. Cascade should
        # archive C exactly once even when the user also tickes it as related.
        p = await create_card(db, name="P", user_id=admin.id)
        c = await create_card(
            db,
            card_type="ITComponent",
            name="C",
            parent_id=p.id,
            user_id=admin.id,
        )
        await create_relation_type(
            db,
            key="app_to_itc_self",
            label="references",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        await create_relation(db, type_key="app_to_itc_self", source_id=p.id, target_id=c.id)

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "cascade", "related_card_ids": [str(c.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        # C appears in affected_children_ids (via cascade), not duplicated as
        # a related_card_id in the response payload.
        assert str(c.id) in body["affected_children_ids"]
        assert str(c.id) not in body["affected_related_card_ids"]

    async def test_archive_does_not_recurse_into_related_cards_relations(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        # ITC has its own relation to a third card; that card should NOT be archived.
        await create_relation_type(
            db,
            key="itc_to_itc",
            label="depends",
            source_type_key="ITComponent",
            target_type_key="ITComponent",
        )
        downstream = await create_card(
            db, card_type="ITComponent", name="Downstream", user_id=admin.id
        )
        await create_relation(db, type_key="itc_to_itc", source_id=itc.id, target_id=downstream.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        resp = await client.post(
            f"/api/v1/cards/{app.id}/archive",
            json={"related_card_ids": [str(itc.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        downstream_row = (
            await db.execute(select(Card).where(Card.id == downstream.id))
        ).scalar_one()
        assert downstream_row.status == "ACTIVE"

    async def test_archive_ticked_related_uses_disconnect_for_its_children(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        # Ticked related card has its own child (via parent_id, not relation).
        itc_parent = await create_card(
            db, card_type="ITComponent", name="ITC-Parent", user_id=admin.id
        )
        itc_child = await create_card(
            db,
            card_type="ITComponent",
            name="ITC-Child",
            parent_id=itc_parent.id,
            user_id=admin.id,
        )
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc_parent.id)

        resp = await client.post(
            f"/api/v1/cards/{app.id}/archive",
            json={"related_card_ids": [str(itc_parent.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        itc_parent_row = (
            await db.execute(select(Card).where(Card.id == itc_parent.id))
        ).scalar_one()
        itc_child_row = (await db.execute(select(Card).where(Card.id == itc_child.id))).scalar_one()
        assert itc_parent_row.status == "ARCHIVED"
        # Child is orphaned (disconnect), not archived, not pointing at archived parent.
        assert itc_child_row.parent_id is None
        assert itc_child_row.status == "ACTIVE"

    async def test_cascade_all_related_resolves_server_side(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        itc1 = await create_card(db, card_type="ITComponent", name="ITC1", user_id=admin.id)
        itc2 = await create_card(db, card_type="ITComponent", name="ITC2", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc1.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc2.id)

        resp = await client.post(
            f"/api/v1/cards/{app.id}/archive",
            json={"cascade_all_related": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        for cid in (itc1.id, itc2.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ARCHIVED"


# ---------------------------------------------------------------------------
# Permission gating
# ---------------------------------------------------------------------------


class TestPermissions:
    async def test_viewer_cannot_archive_with_strategy(self, client, db, env):
        viewer = env["viewer"]
        admin = env["admin"]
        p = await create_card(db, name="P", user_id=admin.id)
        await create_card(db, name="C", parent_id=p.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{p.id}/archive",
            json={"child_strategy": "cascade"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# archive-impact endpoint
# ---------------------------------------------------------------------------


class TestArchiveImpact:
    async def test_returns_children_grandparent_and_relations(self, client, db, env):
        admin = env["admin"]
        gp = await create_card(db, name="GP", user_id=admin.id)
        p = await create_card(db, name="P", parent_id=gp.id, user_id=admin.id)
        c = await create_card(db, name="C", parent_id=p.id, user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=p.id, target_id=itc.id)

        resp = await client.get(f"/api/v1/cards/{p.id}/archive-impact", headers=auth_headers(admin))
        assert resp.status_code == 200
        body = resp.json()
        assert body["child_count"] == 1
        assert body["descendant_count"] == 1
        assert body["grandparent"]["id"] == str(gp.id)
        assert len(body["children"]) == 1
        assert body["children"][0]["id"] == str(c.id)
        assert len(body["related_cards"]) == 1
        rel = body["related_cards"][0]
        assert rel["id"] == str(itc.id)
        assert rel["direction"] == "outgoing"
        assert rel["relation_label"] == "uses"

    async def test_empty_when_card_has_no_children_or_relations(self, client, db, env):
        admin = env["admin"]
        card = await create_card(db, name="Solo", user_id=admin.id)

        resp = await client.get(
            f"/api/v1/cards/{card.id}/archive-impact", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["child_count"] == 0
        assert body["descendant_count"] == 0
        assert body["grandparent"] is None
        assert body["children"] == []
        assert body["related_cards"] == []


# ---------------------------------------------------------------------------
# Hide-on-archive: peer relations crossing the archived/active boundary are
# kept in the database but hidden from active views via the GET /relations
# filter; restoring either end re-exposes them automatically.
# ---------------------------------------------------------------------------


class TestArchiveHidesPeerRelations:
    async def test_archive_keeps_unticked_peer_relation_hidden(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        peer = await create_card(db, card_type="ITComponent", name="Peer", user_id=admin.id)
        rel = await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=peer.id)

        resp = await client.post(f"/api/v1/cards/{app.id}/archive", headers=auth_headers(admin))
        assert resp.status_code == 200

        # Relation row still in the database.
        kept = (
            await db.execute(select(Relation).where(Relation.id == rel.id))
        ).scalar_one_or_none()
        assert kept is not None
        # …but hidden from GET /relations because the source is archived.
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={peer.id}", headers=auth_headers(admin)
        )
        assert rels_resp.status_code == 200
        assert rels_resp.json() == []
        # Peer card still active.
        peer_row = (await db.execute(select(Card).where(Card.id == peer.id))).scalar_one()
        assert peer_row.status == "ACTIVE"

    async def test_archive_keeps_relation_inside_cascade_bubble(self, client, db, env):
        admin = env["admin"]
        # Bubble: primary cascade-archived along with peer that's also ticked.
        app = await create_card(db, name="App", user_id=admin.id)
        peer = await create_card(db, card_type="ITComponent", name="BubblePeer", user_id=admin.id)
        rel = await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=peer.id)

        resp = await client.post(
            f"/api/v1/cards/{app.id}/archive",
            json={"related_card_ids": [str(peer.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Both archived together.
        for cid in (app.id, peer.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ARCHIVED"
        # Relation row preserved inside the bubble.
        kept = (
            await db.execute(select(Relation).where(Relation.id == rel.id))
        ).scalar_one_or_none()
        assert kept is not None

    async def test_archive_keeps_cascade_descendant_external_relations_hidden(
        self, client, db, env
    ):
        admin = env["admin"]
        # Parent → child (cascade-archived together). Child also has a peer
        # that stays active. Parent has its own external peer.
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)
        outside_peer = await create_card(
            db, card_type="ITComponent", name="Outside", user_id=admin.id
        )
        await create_relation_type(
            db,
            key="app_self_ref",
            label="depends",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        child_rel = await create_relation(
            db, type_key="app_self_ref", source_id=child.id, target_id=outside_peer.id
        )
        parent_rel = await create_relation(
            db, type_key="app_to_itc", source_id=parent.id, target_id=outside_peer.id
        )

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/archive",
            json={"child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Both crossing-boundary relations are kept in the database.
        for rid in (child_rel.id, parent_rel.id):
            row = (
                await db.execute(select(Relation).where(Relation.id == rid))
            ).scalar_one_or_none()
            assert row is not None
        # …but hidden from the surviving peer's view of GET /relations.
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={outside_peer.id}", headers=auth_headers(admin)
        )
        assert rels_resp.status_code == 200
        assert rels_resp.json() == []
        # Outside peer still active.
        op_row = (await db.execute(select(Card).where(Card.id == outside_peer.id))).scalar_one()
        assert op_row.status == "ACTIVE"

    async def test_restore_reveals_hidden_peer_relations(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        peer = await create_card(db, card_type="ITComponent", name="Peer", user_id=admin.id)
        rel = await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=peer.id)

        # Archive: relation row stays in DB but hidden from active views.
        resp = await client.post(f"/api/v1/cards/{app.id}/archive", headers=auth_headers(admin))
        assert resp.status_code == 200
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={peer.id}", headers=auth_headers(admin)
        )
        assert rels_resp.json() == []

        # Restore: the row reappears in GET /relations because both ends are ACTIVE.
        resp = await client.post(f"/api/v1/cards/{app.id}/restore", headers=auth_headers(admin))
        assert resp.status_code == 200
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={app.id}", headers=auth_headers(admin)
        )
        body = rels_resp.json()
        assert len(body) == 1
        assert body[0]["id"] == str(rel.id)
        assert body[0]["target_id"] == str(peer.id)

    async def test_restore_reattaches_cascade_bubble_relations(self, client, db, env):
        admin = env["admin"]
        # Bubble: app + peer ticked together → relation preserved.
        app = await create_card(db, name="App", user_id=admin.id)
        peer = await create_card(db, card_type="ITComponent", name="Peer", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=peer.id)

        resp = await client.post(
            f"/api/v1/cards/{app.id}/archive",
            json={"related_card_ids": [str(peer.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # While both archived, GET /relations hides the row.
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={app.id}", headers=auth_headers(admin)
        )
        assert rels_resp.status_code == 200
        assert rels_resp.json() == []

        # Restore the app only — relation still hidden because peer is archived.
        resp = await client.post(f"/api/v1/cards/{app.id}/restore", headers=auth_headers(admin))
        assert resp.status_code == 200
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={app.id}", headers=auth_headers(admin)
        )
        assert rels_resp.json() == []

        # Restore the peer — bubble relation comes back.
        resp = await client.post(f"/api/v1/cards/{peer.id}/restore", headers=auth_headers(admin))
        assert resp.status_code == 200
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={app.id}", headers=auth_headers(admin)
        )
        body = rels_resp.json()
        assert len(body) == 1
        assert body[0]["target_id"] == str(peer.id)


# ---------------------------------------------------------------------------
# Defensive filter on GET /relations and on archive-impact for archived peers
# ---------------------------------------------------------------------------


class TestRelationsArchivedFilter:
    async def test_list_relations_excludes_archived_peers(self, client, db, env):
        """Defends against historical or manual rows that survive sever-at-archive."""
        admin = env["admin"]
        a = await create_card(db, name="A", user_id=admin.id)
        b = await create_card(db, card_type="ITComponent", name="B", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=a.id, target_id=b.id)

        # Manually flip B to ARCHIVED (bypasses the sever logic, simulates
        # historical data) to prove the GET filter is defensive.
        b.status = "ARCHIVED"
        from datetime import datetime, timezone

        b.archived_at = datetime.now(timezone.utc)
        await db.flush()
        await db.commit()

        rels_resp = await client.get(
            f"/api/v1/relations?card_id={a.id}", headers=auth_headers(admin)
        )
        assert rels_resp.status_code == 200
        assert rels_resp.json() == []

    async def test_archive_impact_excludes_archived_peers(self, client, db, env):
        admin = env["admin"]
        app = await create_card(db, name="App", user_id=admin.id)
        archived_peer = await create_card(
            db,
            card_type="ITComponent",
            name="OldPeer",
            user_id=admin.id,
            status="ARCHIVED",
        )
        await create_relation(
            db, type_key="app_to_itc", source_id=app.id, target_id=archived_peer.id
        )

        resp = await client.get(
            f"/api/v1/cards/{app.id}/archive-impact", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["related_cards"] == []


# ---------------------------------------------------------------------------
# Restore-impact endpoint + cascade-restore via also_restore_card_ids
# ---------------------------------------------------------------------------


class TestCascadeRestore:
    async def test_restore_impact_lists_cascade_children_and_ticked_peers(self, client, db, env):
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)
        peer = await create_card(db, card_type="ITComponent", name="Peer", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=parent.id, target_id=peer.id)

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/archive",
            json={"child_strategy": "cascade", "related_card_ids": [str(peer.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        impact_resp = await client.get(
            f"/api/v1/cards/{parent.id}/restore-impact", headers=auth_headers(admin)
        )
        assert impact_resp.status_code == 200
        body = impact_resp.json()
        ids_to_role = {p["id"]: p["role"] for p in body["passengers"]}
        assert ids_to_role.get(str(child.id)) == "child"
        assert ids_to_role.get(str(peer.id)) == "related"

    async def test_restore_with_also_restore_card_ids_flips_passengers(self, client, db, env):
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)
        peer = await create_card(db, card_type="ITComponent", name="Peer", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=parent.id, target_id=peer.id)

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/archive",
            json={"child_strategy": "cascade", "related_card_ids": [str(peer.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/restore",
            json={"also_restore_card_ids": [str(child.id), str(peer.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["primary"]["status"] == "ACTIVE"
        assert set(body["restored_passenger_ids"]) == {str(child.id), str(peer.id)}

        for cid in (parent.id, child.id, peer.id):
            row = (await db.execute(select(Card).where(Card.id == cid))).scalar_one()
            assert row.status == "ACTIVE"

        # Bubble relation reappears in active views.
        rels_resp = await client.get(
            f"/api/v1/relations?card_id={parent.id}", headers=auth_headers(admin)
        )
        assert rels_resp.status_code == 200
        assert len(rels_resp.json()) == 1

    async def test_restore_skips_already_restored_passengers(self, client, db, env):
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        c1 = await create_card(db, name="C1", parent_id=parent.id, user_id=admin.id)
        c2 = await create_card(db, name="C2", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/archive",
            json={"child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Individually restore C1 first.
        resp = await client.post(f"/api/v1/cards/{c1.id}/restore", headers=auth_headers(admin))
        assert resp.status_code == 200

        # Now batch-restore parent with both passengers; C1 is silently skipped.
        resp = await client.post(
            f"/api/v1/cards/{parent.id}/restore",
            json={"also_restore_card_ids": [str(c1.id), str(c2.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["restored_passenger_ids"] == [str(c2.id)]

    async def test_restore_impact_empty_when_no_batch(self, client, db, env):
        admin = env["admin"]
        card = await create_card(db, name="Solo", user_id=admin.id, status="ARCHIVED")
        from datetime import datetime, timezone

        card.archived_at = datetime.now(timezone.utc)
        await db.flush()

        resp = await client.get(
            f"/api/v1/cards/{card.id}/restore-impact", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["passengers"] == []

    async def test_restore_passenger_permission_failure_aborts(self, client, db, env):
        """If the user can't archive one of the passengers, the whole call fails."""
        admin = env["admin"]
        parent = await create_card(db, name="Parent", user_id=admin.id)
        child = await create_card(db, name="Child", parent_id=parent.id, user_id=admin.id)

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/archive",
            json={"child_strategy": "cascade"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        viewer = env["viewer"]
        resp = await client.post(
            f"/api/v1/cards/{parent.id}/restore",
            json={"also_restore_card_ids": [str(child.id)]},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
