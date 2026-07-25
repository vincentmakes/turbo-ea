"""Integration tests for the descendant relation roll-up (discussion #863).

Covers the three rules agreed on the discussion: the roll-up walks the *full*
descendant subtree (not just direct children), suppresses peers the root is
already directly linked to, and never surfaces peers that live inside the
subtree itself. Plus the usual archived / hidden-type / permission guards.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
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
async def rollup_env(db):
    """A three-level capability tree with applications hanging off the leaves.

    Cap (root)
     ├─ SubA
     │   └─ LeafA   ── supports ──> App1, App2
     └─ SubB        ── supports ──> App2 (shared), App3
    """
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        # Declared in metamodel order — the roll-up sorts subtype buckets by
        # this order, not alphabetically.
        subtypes=[{"key": "biz", "label": "Business"}, {"key": "micro", "label": "Micro"}],
    )
    await create_relation_type(
        db,
        key="capToApp",
        label="is supported by",
        source_type_key="BusinessCapability",
        target_type_key="Application",
    )

    admin = await create_user(db, email="admin@test.com", role="admin")

    root = await create_card(db, card_type="BusinessCapability", name="Cap")
    sub_a = await create_card(db, card_type="BusinessCapability", name="SubA", parent_id=root.id)
    leaf_a = await create_card(db, card_type="BusinessCapability", name="LeafA", parent_id=sub_a.id)
    sub_b = await create_card(db, card_type="BusinessCapability", name="SubB", parent_id=root.id)

    app1 = await create_card(db, card_type="Application", name="App1")
    app2 = await create_card(db, card_type="Application", name="App2")
    app3 = await create_card(db, card_type="Application", name="App3")

    await create_relation(db, type_key="capToApp", source_id=leaf_a.id, target_id=app1.id)
    await create_relation(db, type_key="capToApp", source_id=leaf_a.id, target_id=app2.id)
    await create_relation(db, type_key="capToApp", source_id=sub_b.id, target_id=app2.id)
    await create_relation(db, type_key="capToApp", source_id=sub_b.id, target_id=app3.id)

    return {
        "admin": admin,
        "root": root,
        "sub_a": sub_a,
        "leaf_a": leaf_a,
        "sub_b": sub_b,
        "app1": app1,
        "app2": app2,
        "app3": app3,
    }


def _summary(client, card, user):
    return client.get(
        f"/api/v1/cards/{card.id}/descendant-relations/summary",
        headers=auth_headers(user),
    )


def _rows(client, card, user, rel_type="capToApp"):
    return client.get(
        f"/api/v1/cards/{card.id}/descendant-relations?relation_type={rel_type}",
        headers=auth_headers(user),
    )


class TestDescendantRelationSummary:
    async def test_rolls_up_full_subtree_not_just_direct_children(self, client, db, rollup_env):
        """App1/App2 hang off a *grandchild*; they must still be counted."""
        r = await _summary(client, rollup_env["root"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body) == 1
        assert body[0]["relation_type_key"] == "capToApp"
        # App1 + App2 + App3, deduped — App2 is linked by two descendants.
        assert body[0]["count"] == 3

    async def test_leaf_card_returns_empty(self, client, db, rollup_env):
        r = await _summary(client, rollup_env["leaf_a"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        assert r.json() == []

    async def test_excludes_peers_already_linked_to_root(self, client, db, rollup_env):
        """Rule #2 — the chip only advertises rows not already in the list."""
        await create_relation(
            db,
            type_key="capToApp",
            source_id=rollup_env["root"].id,
            target_id=rollup_env["app1"].id,
        )
        r = await _summary(client, rollup_env["root"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        # App1 is now directly visible on the root, so only App2 + App3 remain.
        assert r.json()[0]["count"] == 2

    async def test_excludes_peers_inside_the_subtree(self, client, db, rollup_env):
        """A descendant-to-descendant edge is internal, not an extra card."""
        await create_relation_type(
            db,
            key="capToCap",
            label="relates to",
            source_type_key="BusinessCapability",
            target_type_key="BusinessCapability",
        )
        await create_relation(
            db,
            type_key="capToCap",
            source_id=rollup_env["leaf_a"].id,
            target_id=rollup_env["sub_b"].id,
        )
        r = await _summary(client, rollup_env["root"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        keys = {e["relation_type_key"] for e in r.json()}
        assert "capToCap" not in keys

    async def test_excludes_archived_peer(self, client, db, rollup_env):
        rollup_env["app3"].status = "ARCHIVED"
        await db.flush()
        r = await _summary(client, rollup_env["root"], rollup_env["admin"])
        assert r.json()[0]["count"] == 2

    async def test_excludes_archived_descendant(self, client, db, rollup_env):
        """An archived sub-capability takes its relations out of the roll-up."""
        rollup_env["sub_b"].status = "ARCHIVED"
        await db.flush()
        r = await _summary(client, rollup_env["root"], rollup_env["admin"])
        # SubB contributed App3 alone (App2 is also reached via LeafA).
        assert r.json()[0]["count"] == 2

    async def test_excludes_hidden_peer_type(self, client, db, rollup_env):
        await create_card_type(db, key="Secret", label="Secret", is_hidden=True)
        await create_relation_type(
            db,
            key="capToSecret",
            label="uses",
            source_type_key="BusinessCapability",
            target_type_key="Secret",
        )
        hidden = await create_card(db, card_type="Secret", name="Hidden")
        await create_relation(
            db, type_key="capToSecret", source_id=rollup_env["sub_b"].id, target_id=hidden.id
        )
        r = await _summary(client, rollup_env["root"], rollup_env["admin"])
        keys = {e["relation_type_key"] for e in r.json()}
        assert "capToSecret" not in keys

    async def test_requires_view_permission(self, client, db, rollup_env):
        await create_role(db, key="nobody", label="Nobody", permissions={})
        user = await create_user(db, email="nobody@test.com", role="nobody")
        r = await _summary(client, rollup_env["root"], user)
        assert r.status_code == 403

    async def test_404_for_unknown_card(self, client, db, rollup_env):
        r = await client.get(
            "/api/v1/cards/00000000-0000-0000-0000-000000000000/descendant-relations/summary",
            headers=auth_headers(rollup_env["admin"]),
        )
        assert r.status_code == 404


class TestDescendantRelationRows:
    async def test_rows_carry_deduped_provenance(self, client, db, rollup_env):
        r = await _rows(client, rollup_env["root"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 3
        by_name = {row["name"]: row for row in body["rows"]}
        assert set(by_name) == {"App1", "App2", "App3"}

        # App2 is linked by both LeafA and SubB — one row, two `via` entries.
        assert [v["name"] for v in by_name["App2"]["via"]] == ["LeafA", "SubB"]
        assert [v["name"] for v in by_name["App1"]["via"]] == ["LeafA"]
        assert by_name["App1"]["type"] == "Application"

    async def test_via_total_counts_whole_result_set(self, client, db, rollup_env):
        """The header count must not be a per-page number."""
        r = await client.get(
            f"/api/v1/cards/{rollup_env['root'].id}/descendant-relations"
            "?relation_type=capToApp&page=1&page_size=1",
            headers=auth_headers(rollup_env["admin"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["rows"]) == 1  # one row on this page…
        assert body["total"] == 3
        # …but LeafA + SubB both contribute across the full set.
        assert body["via_total"] == 2

    async def test_rows_carry_lifecycle(self, client, db, rollup_env):
        rollup_env["app1"].lifecycle = {"active": "2020-01-01"}
        await db.flush()
        r = await _rows(client, rollup_env["root"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        by_name = {row["name"]: row for row in r.json()["rows"]}
        assert by_name["App1"]["lifecycle"] == {"active": "2020-01-01"}
        # Cards without lifecycle data serialise as {}, never null.
        assert by_name["App2"]["lifecycle"] == {}

    async def test_rows_sort_by_subtype_then_lifecycle_then_name(self, client, db, rollup_env):
        """Ordering contract the drawer's grouping relies on.

        Subtype in metamodel order first (so buckets stay contiguous across
        pages), then lifecycle urgency (end-of-life first), then name.
        """
        # App1: 2nd subtype. App2/App3: 1st subtype, differing lifecycle.
        rollup_env["app1"].subtype = "micro"
        rollup_env["app2"].subtype = "biz"
        rollup_env["app2"].lifecycle = {"active": "2020-01-01"}
        rollup_env["app3"].subtype = "biz"
        rollup_env["app3"].lifecycle = {"endOfLife": "2020-01-01"}
        await db.flush()

        r = await _rows(client, rollup_env["root"], rollup_env["admin"])
        assert r.status_code == 200, r.text
        names = [row["name"] for row in r.json()["rows"]]
        # biz bucket first (App3 end-of-life above App2 active), then micro.
        assert names == ["App3", "App2", "App1"]

    async def test_cards_without_subtype_sort_last(self, client, db, rollup_env):
        rollup_env["app2"].subtype = "biz"
        await db.flush()
        r = await _rows(client, rollup_env["root"], rollup_env["admin"])
        names = [row["name"] for row in r.json()["rows"]]
        # App2 carries the only subtype, so it leads; the rest trail by name.
        assert names[0] == "App2"

    async def test_rows_are_paginated(self, client, db, rollup_env):
        r = await client.get(
            f"/api/v1/cards/{rollup_env['root'].id}/descendant-relations"
            "?relation_type=capToApp&page=2&page_size=2",
            headers=auth_headers(rollup_env["admin"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 3
        assert len(body["rows"]) == 1
        assert body["rows"][0]["name"] == "App3"

    async def test_unknown_relation_type_returns_empty(self, client, db, rollup_env):
        r = await _rows(client, rollup_env["root"], rollup_env["admin"], rel_type="nope")
        assert r.status_code == 200, r.text
        assert r.json() == {"rows": [], "total": 0, "via_total": 0}

    async def test_viewer_can_read(self, client, db, rollup_env):
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        r = await _rows(client, rollup_env["root"], viewer)
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 3
