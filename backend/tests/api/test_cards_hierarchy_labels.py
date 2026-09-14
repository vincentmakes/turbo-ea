"""A parent/child link can carry a label (discussion #1100).

Two Organizations already in a hierarchy could not say *what kind* of link they
had: ``cards.parent_id`` is a bare self-FK and carried no payload at all. The
label lives on the CHILD row, drawn from the card type's ``hierarchy_labels``
vocabulary — the same shape a ``single_select``'s options have, so it is
translatable, colourable and renders as the familiar option chip.

The rules pinned here, in order of how easy they are to break:

* the label is refused unless it is a declared option, and unless there is
  actually a parent for it to describe;
* an unchanged legacy value is grandfathered, so deleting a vocabulary entry
  never bricks the cards that used it;
* losing the parent takes the label with it, on every write path;
* ``children[].parent_label`` and the response's top-level ``parent_label`` are
  DIFFERENT edges — getting them the wrong way round is the obvious bug.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.permissions import MEMBER_PERMISSIONS
from app.services.card_write_service import _check_hierarchy_label
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

VOCAB = [
    {"key": "commercial", "label": "Commercial", "color": "#2889ff"},
    {"key": "sales", "label": "Sales", "color": "#33cc58"},
]


# ---------------------------------------------------------------------------
# Pure checker — no database
# ---------------------------------------------------------------------------


class TestCheckHierarchyLabel:
    def test_accepts_a_declared_option(self):
        _check_hierarchy_label("Organization", VOCAB, "commercial", None, True)

    def test_rejects_an_undeclared_option(self):
        with pytest.raises(HTTPException) as exc:
            _check_hierarchy_label("Organization", VOCAB, "marketing", None, True)
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "invalid_hierarchy_label"
        assert exc.value.detail["valid_labels"] == ["commercial", "sales"]

    def test_rejects_a_label_on_a_card_with_no_parent(self):
        with pytest.raises(HTTPException) as exc:
            _check_hierarchy_label("Organization", VOCAB, "commercial", None, False)
        assert exc.value.detail["code"] == "hierarchy_label_without_parent"

    @pytest.mark.parametrize("empty", [None, ""])
    def test_clearing_always_passes(self, empty):
        # Even on a rootless card: clearing is never a validation failure.
        _check_hierarchy_label("Organization", VOCAB, empty, "commercial", False)

    def test_unchanged_legacy_value_is_grandfathered(self):
        """An admin deleting a vocabulary entry must not brick its cards."""
        _check_hierarchy_label("Organization", VOCAB, "retired", "retired", True)

    def test_changing_a_legacy_value_to_another_bad_one_still_fails(self):
        with pytest.raises(HTTPException):
            _check_hierarchy_label("Organization", VOCAB, "worse", "retired", True)

    def test_empty_vocabulary_rejects_everything(self):
        with pytest.raises(HTTPException) as exc:
            _check_hierarchy_label("Organization", [], "commercial", None, True)
        assert exc.value.detail["valid_labels"] == []


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(
        db,
        key="Organization",
        label="Organization",
        has_hierarchy=True,
        hierarchy_labels=VOCAB,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    parent = await create_card(db, card_type="Organization", name="Company A")
    return {"admin": admin, "parent": parent}


class TestCreateCard:
    async def test_accepts_a_declared_label(self, client, db, env):
        response = await client.post(
            "/api/v1/cards",
            json={
                "type": "Organization",
                "name": "Company B",
                "parent_id": str(env["parent"].id),
                "parent_label": "commercial",
            },
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 201
        assert response.json()["parent_label"] == "commercial"

    async def test_rejects_an_undeclared_label(self, client, db, env):
        response = await client.post(
            "/api/v1/cards",
            json={
                "type": "Organization",
                "name": "Company B",
                "parent_id": str(env["parent"].id),
                "parent_label": "marketing",
            },
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_hierarchy_label"

    async def test_rejects_a_label_with_no_parent(self, client, db, env):
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Organization", "name": "Rootless", "parent_label": "commercial"},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "hierarchy_label_without_parent"


class TestPatchCard:
    async def test_sets_and_changes_the_label(self, client, db, env):
        child = await create_card(
            db, card_type="Organization", name="Company B", parent_id=env["parent"].id
        )
        response = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_label": "commercial"},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["parent_label"] == "commercial"

        response = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_label": "sales"},
            headers=auth_headers(env["admin"]),
        )
        assert response.json()["parent_label"] == "sales"

    async def test_rejects_an_undeclared_label(self, client, db, env):
        child = await create_card(
            db, card_type="Organization", name="Company B", parent_id=env["parent"].id
        )
        response = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_label": "marketing"},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422

    async def test_setting_parent_and_label_in_one_patch(self, client, db, env):
        """The picker names the parent and the link in one action."""
        orphan = await create_card(db, card_type="Organization", name="Company C")
        response = await client.patch(
            f"/api/v1/cards/{orphan.id}",
            json={"parent_id": str(env["parent"].id), "parent_label": "sales"},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["parent_label"] == "sales"

    async def test_clearing_the_parent_clears_the_label(self, client, db, env):
        child = await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=env["parent"].id,
            parent_label="commercial",
        )
        response = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_id": None},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        # The caller never mentioned the label; the server drops it anyway,
        # because there is no longer an edge for it to describe.
        assert response.json()["parent_label"] is None

    async def test_reparenting_keeps_the_label(self, client, db, env):
        """The label is the child's role, not a property of one specific parent."""
        other = await create_card(db, card_type="Organization", name="Company Z")
        child = await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=env["parent"].id,
            parent_label="commercial",
        )
        response = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_id": str(other.id)},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["parent_label"] == "commercial"

    async def test_a_legacy_value_stays_editable_after_its_option_is_deleted(self, client, db, env):
        """The card must not become unsaveable because an admin tidied the list."""
        child = await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=env["parent"].id,
            parent_label="retired",
        )
        response = await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"name": "Company B Renamed"},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["parent_label"] == "retired"


class TestHierarchyEndpoint:
    async def test_children_carry_their_own_labels(self, client, db, env):
        await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=env["parent"].id,
            parent_label="commercial",
        )
        await create_card(
            db,
            card_type="Organization",
            name="Company C",
            parent_id=env["parent"].id,
            parent_label="sales",
        )
        await create_card(
            db, card_type="Organization", name="Company D", parent_id=env["parent"].id
        )
        response = await client.get(
            f"/api/v1/cards/{env['parent'].id}/hierarchy", headers=auth_headers(env["admin"])
        )
        assert response.status_code == 200
        body = response.json()
        assert {c["name"]: c["parent_label"] for c in body["children"]} == {
            "Company B": "commercial",
            "Company C": "sales",
            "Company D": None,
        }
        # The parent itself is a root, so it has no link of its own.
        assert body["parent_label"] is None

    async def test_the_two_label_slots_are_different_edges(self, client, db, env):
        """Top-level `parent_label` is the card's OWN link; `children[]` are theirs.

        Reading the parent chip off the last ancestor instead would show the
        grandparent's link here — the whole point of the separate slot.
        """
        child = await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=env["parent"].id,
            parent_label="commercial",
        )
        await create_card(
            db,
            card_type="Organization",
            name="Company B1",
            parent_id=child.id,
            parent_label="sales",
        )
        response = await client.get(
            f"/api/v1/cards/{child.id}/hierarchy", headers=auth_headers(env["admin"])
        )
        body = response.json()
        assert body["parent_label"] == "commercial"  # B's link up to A
        assert body["children"][0]["parent_label"] == "sales"  # B1's link up to B


class TestBulkPaths:
    async def test_bulk_create_accepts_and_validates_the_label(self, client, db, env):
        response = await client.post(
            "/api/v1/cards/bulk-create",
            json={
                "cards": [
                    {
                        "row_index": 0,
                        "type": "Organization",
                        "name": "Company B",
                        "parent_id": str(env["parent"].id),
                        "parent_label": "commercial",
                    },
                    {
                        "row_index": 1,
                        "type": "Organization",
                        "name": "Company C",
                        "parent_id": str(env["parent"].id),
                        "parent_label": "marketing",
                    },
                ]
            },
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        results = {r["row_index"]: r for r in response.json()["results"]}
        assert results[0]["status"] == "created"
        assert results[1]["status"] == "failed"

    async def test_bulk_update_clears_labels_when_the_parent_goes(self, client, db, env):
        a = await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=env["parent"].id,
            parent_label="commercial",
        )
        b = await create_card(
            db,
            card_type="Organization",
            name="Company C",
            parent_id=env["parent"].id,
            parent_label="sales",
        )
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(a.id), str(b.id)], "updates": {"parent_id": None}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        for card_id in (a.id, b.id):
            got = await client.get(f"/api/v1/cards/{card_id}", headers=auth_headers(env["admin"]))
            assert got.json()["parent_label"] is None

    async def test_bulk_update_rejects_an_undeclared_label(self, client, db, env):
        child = await create_card(
            db, card_type="Organization", name="Company B", parent_id=env["parent"].id
        )
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(child.id)], "updates": {"parent_label": "marketing"}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 422

    async def test_bulk_update_sets_the_label_on_many_cards(self, client, db, env):
        a = await create_card(
            db, card_type="Organization", name="Company B", parent_id=env["parent"].id
        )
        b = await create_card(
            db, card_type="Organization", name="Company C", parent_id=env["parent"].id
        )
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(a.id), str(b.id)], "updates": {"parent_label": "commercial"}},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 200
        for card_id in (a.id, b.id):
            got = await client.get(f"/api/v1/cards/{card_id}", headers=auth_headers(env["admin"]))
            assert got.json()["parent_label"] == "commercial"


class TestHistory:
    async def test_a_label_change_is_recorded(self, client, db, env):
        """Modified date and History tab are two renderings of one fact."""
        child = await create_card(
            db, card_type="Organization", name="Company B", parent_id=env["parent"].id
        )
        await client.patch(
            f"/api/v1/cards/{child.id}",
            json={"parent_label": "commercial"},
            headers=auth_headers(env["admin"]),
        )
        history = await client.get(
            f"/api/v1/cards/{child.id}/history", headers=auth_headers(env["admin"])
        )
        assert history.status_code == 200
        changes = [
            e["data"]["changes"]
            for e in history.json()
            if e["event_type"] == "card.updated" and "changes" in (e.get("data") or {})
        ]
        assert any("parent_label" in c for c in changes)
        entry = next(c["parent_label"] for c in changes if "parent_label" in c)
        # The scalar {old, new} shape `parseChanges` renders.
        assert entry == {"old": None, "new": "commercial"}
