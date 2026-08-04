"""Integration tests for the /relations endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.api.v1.relations import MAX_CARD_IDS_PER_QUERY
from app.core.permissions import VIEWER_PERMISSIONS
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
async def rel_env(db):
    """Prerequisite data for relation tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    app_type = await create_card_type(db, key="Application", label="Application")
    itc_type = await create_card_type(db, key="ITComponent", label="IT Component")
    rt = await create_relation_type(
        db,
        key="app_to_itc",
        label="Uses",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    source = await create_card(
        db,
        card_type="Application",
        name="Source App",
        user_id=admin.id,
    )
    target = await create_card(
        db,
        card_type="ITComponent",
        name="Target ITC",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "app_type": app_type,
        "itc_type": itc_type,
        "rt": rt,
        "source": source,
        "target": target,
    }


# ---------------------------------------------------------------
# POST /relations  (create)
# ---------------------------------------------------------------


class TestCreateRelation:
    async def test_admin_can_create(self, client, db, rel_env):
        admin = rel_env["admin"]
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["type"] == "app_to_itc"
        assert data["source"]["name"] == "Source App"
        assert data["target"]["name"] == "Target ITC"

    async def test_create_with_attributes_round_trips(self, client, db, rel_env):
        """Creating a relation with `attributes` persists them as-is so the
        flowDirection editor in the UI can read the value back after a
        page reload. The endpoint does not need to know about the
        flowDirection key — it just stores the JSONB blob."""
        admin = rel_env["admin"]
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
                "attributes": {"flowDirection": "forward"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        rel_id = resp.json()["id"]

        get_resp = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        match = next(r for r in get_resp.json() if r["id"] == rel_id)
        assert match["attributes"] == {"flowDirection": "forward"}

    async def test_viewer_cannot_create(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_duplicate_create_reuses_the_existing_relation(self, client, db, rel_env):
        """Creating the same (type, source, target) twice must not fork the
        repository into two identical rows.

        Regression guard for discussion #905: the diagram editor POSTs here when
        the user draws an edge, so a pair of cards that were *already* related
        gained a second, phantom relation every time someone drew the link they
        could already see. `/relations/bulk` has always upserted on this key —
        the single-relation path now matches it."""
        admin = rel_env["admin"]
        payload = {
            "type": "app_to_itc",
            "source_id": str(rel_env["source"].id),
            "target_id": str(rel_env["target"].id),
        }

        first = await client.post("/api/v1/relations", json=payload, headers=auth_headers(admin))
        second = await client.post("/api/v1/relations", json=payload, headers=auth_headers(admin))

        assert first.status_code == 201
        assert second.status_code == 201
        assert second.json()["id"] == first.json()["id"]

        listing = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert len([r for r in listing.json() if r["type"] == "app_to_itc"]) == 1

    async def test_duplicate_create_merges_supplied_attributes(self, client, db, rel_env):
        """Reuse must not silently discard the second call's payload — the
        relation-attributes editor sends its values through this endpoint."""
        admin = rel_env["admin"]
        base = {
            "type": "app_to_itc",
            "source_id": str(rel_env["source"].id),
            "target_id": str(rel_env["target"].id),
        }

        first = await client.post(
            "/api/v1/relations",
            json={**base, "attributes": {"flowDirection": "forward"}},
            headers=auth_headers(admin),
        )
        second = await client.post(
            "/api/v1/relations",
            json={**base, "attributes": {"flowDirection": "bidirectional"}},
            headers=auth_headers(admin),
        )

        assert second.json()["id"] == first.json()["id"]
        listing = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        match = next(r for r in listing.json() if r["id"] == first.json()["id"])
        assert match["attributes"] == {"flowDirection": "bidirectional"}

    async def test_reverse_direction_is_still_its_own_relation(self, client, db, rel_env):
        """Dedup is keyed on the ORDERED (source, target) pair. A relation drawn
        the other way round is a different edge and must still be created."""
        admin = rel_env["admin"]
        await create_relation_type(
            db,
            key="itc_to_app",
            label="Used by",
            source_type_key="ITComponent",
            target_type_key="Application",
        )
        forward = await client.post(
            "/api/v1/relations",
            json={
                "type": "app_to_itc",
                "source_id": str(rel_env["source"].id),
                "target_id": str(rel_env["target"].id),
            },
            headers=auth_headers(admin),
        )
        backward = await client.post(
            "/api/v1/relations",
            json={
                "type": "itc_to_app",
                "source_id": str(rel_env["target"].id),
                "target_id": str(rel_env["source"].id),
            },
            headers=auth_headers(admin),
        )
        assert backward.json()["id"] != forward.json()["id"]


# ---------------------------------------------------------------
# GET /relations  (list)
# ---------------------------------------------------------------


class TestListRelations:
    async def test_list_returns_relations(self, client, db, rel_env):
        admin = rel_env["admin"]
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.get(
            "/api/v1/relations",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["type"] == "app_to_itc"

    async def test_filter_by_card_id(self, client, db, rel_env):
        admin = rel_env["admin"]
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    async def test_viewer_can_list(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        resp = await client.get(
            "/api/v1/relations",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200

    async def test_list_includes_target_subtype(self, client, db, rel_env):
        """The relation payload embeds the source/target card's `subtype` so
        the card-detail Relations panel can group related cards by subtype
        (#792). A target without a subtype still exposes the key as null."""
        admin = rel_env["admin"]
        typed_target = await create_card(
            db,
            card_type="ITComponent",
            name="Typed ITC",
            subtype="Software",
            user_id=admin.id,
        )
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=typed_target.id,
        )
        await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.get(
            f"/api/v1/relations?card_id={rel_env['source'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        by_name = {r["target"]["name"]: r["target"] for r in resp.json()}
        assert by_name["Typed ITC"]["subtype"] == "Software"
        # Card created without a subtype: key present, value null.
        assert "subtype" in by_name["Target ITC"]
        assert by_name["Target ITC"]["subtype"] is None


# ---------------------------------------------------------------
# GET /relations  — visibility guards + server-side filters
#
# `list_relations` joins both endpoint cards instead of excluding them with
# four `NOT IN (SELECT ...)` subqueries, and serves `card_type` / `types` /
# `card_ids` off those joins. The first block below pins the visibility
# semantics that rewrite had to preserve; the second covers the new filters.
# ---------------------------------------------------------------


@pytest.fixture
async def filter_env(db, rel_env):
    """Extends `rel_env` with a third card type, an archived card and a
    hidden-type card so the filters have something to include *and* exclude.

    Relation graph (visible edges marked ✓):

        app  ──app_to_itc──▶  itc              ✓
        app  ──app_to_do───▶  data             ✓
        data ──do_to_app───▶  app              ✓  (Application on the target side)
        app  ──app_to_itc──▶  archived_itc     ✗  (target archived)
        app  ──app_to_secret▶ secret           ✗  (target's type is hidden)
    """
    admin = rel_env["admin"]
    await create_card_type(db, key="DataObject", label="Data Object")
    await create_card_type(db, key="Secret", label="Secret", is_hidden=True)
    await create_relation_type(
        db,
        key="app_to_do",
        label="Uses data",
        source_type_key="Application",
        target_type_key="DataObject",
    )
    await create_relation_type(
        db,
        key="do_to_app",
        label="Consumed by",
        source_type_key="DataObject",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="app_to_secret",
        label="Hidden link",
        source_type_key="Application",
        target_type_key="Secret",
    )

    app = rel_env["source"]
    itc = rel_env["target"]
    data = await create_card(db, card_type="DataObject", name="Customer Data", user_id=admin.id)
    archived_itc = await create_card(
        db,
        card_type="ITComponent",
        name="Retired ITC",
        status="ARCHIVED",
        user_id=admin.id,
    )
    secret = await create_card(db, card_type="Secret", name="Secret Card", user_id=admin.id)

    r_app_itc = await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)
    r_app_data = await create_relation(
        db, type_key="app_to_do", source_id=app.id, target_id=data.id
    )
    r_data_app = await create_relation(
        db, type_key="do_to_app", source_id=data.id, target_id=app.id
    )
    r_archived = await create_relation(
        db, type_key="app_to_itc", source_id=app.id, target_id=archived_itc.id
    )
    r_secret = await create_relation(
        db, type_key="app_to_secret", source_id=app.id, target_id=secret.id
    )

    return {
        **rel_env,
        "data": data,
        "archived_itc": archived_itc,
        "secret": secret,
        "r_app_itc": r_app_itc,
        "r_app_data": r_app_data,
        "r_data_app": r_data_app,
        "r_archived": r_archived,
        "r_secret": r_secret,
    }


async def _ids(client, admin, query: str = "") -> set[str]:
    """GET /relations{query} → the set of returned relation ids."""
    resp = await client.get(f"/api/v1/relations{query}", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    return {r["id"] for r in resp.json()}


class TestListRelationsVisibility:
    """Guards for the join rewrite — these semantics predate it and must hold."""

    async def test_archived_and_hidden_type_edges_are_excluded(self, client, db, filter_env):
        ids = await _ids(client, filter_env["admin"])
        assert ids == {
            str(filter_env["r_app_itc"].id),
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }
        assert str(filter_env["r_archived"].id) not in ids
        assert str(filter_env["r_secret"].id) not in ids

    async def test_archived_source_is_excluded_too(self, client, db, filter_env):
        """The guard is symmetric — an archived card hides its edges whether it
        sits on the source or the target side."""
        admin = filter_env["admin"]
        archived_app = await create_card(
            db,
            card_type="Application",
            name="Retired App",
            status="ARCHIVED",
            user_id=admin.id,
        )
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=archived_app.id,
            target_id=filter_env["target"].id,
        )
        assert str(rel.id) not in await _ids(client, admin)

    async def test_hidden_type_on_source_side_is_excluded(self, client, db, filter_env):
        admin = filter_env["admin"]
        await create_relation_type(
            db,
            key="secret_to_app",
            label="Secret source",
            source_type_key="Secret",
            target_type_key="Application",
        )
        rel = await create_relation(
            db,
            type_key="secret_to_app",
            source_id=filter_env["secret"].id,
            target_id=filter_env["source"].id,
        )
        assert str(rel.id) not in await _ids(client, admin)

    async def test_card_refs_are_still_embedded(self, client, db, filter_env):
        """The joined-column path must produce the same `source`/`target`
        CardRef payload the eager-loaded relationships used to."""
        resp = await client.get(
            "/api/v1/relations?type=app_to_do", headers=auth_headers(filter_env["admin"])
        )
        assert resp.status_code == 200
        [row] = resp.json()
        assert row["source"] == {
            "id": str(filter_env["source"].id),
            "type": "Application",
            "name": "Source App",
            "subtype": None,
        }
        assert row["target"]["name"] == "Customer Data"
        assert row["target"]["type"] == "DataObject"
        assert row["source_id"] == str(filter_env["source"].id)
        assert row["target_id"] == str(filter_env["data"].id)

    async def test_type_and_card_id_params_unchanged(self, client, db, filter_env):
        admin = filter_env["admin"]
        assert await _ids(client, admin, "?type=app_to_itc") == {str(filter_env["r_app_itc"].id)}
        # `card_id` matches either side.
        assert await _ids(client, admin, f"?card_id={filter_env['data'].id}") == {
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }

    async def test_cost_attributes_still_redacted_for_viewer(self, client, db, rel_env):
        """Cost redaction reads the relation rows the query returns; the join
        rewrite changed how those rows are unpacked, so pin the behaviour."""
        await create_relation_type(
            db,
            key="costed_rel",
            label="Costed",
            source_type_key="Application",
            target_type_key="ITComponent",
            attributes_schema=[
                {"key": "costTotalAnnual", "label": "Annual cost", "type": "cost"},
                {"key": "note", "label": "Note", "type": "text"},
            ],
        )
        await create_relation(
            db,
            type_key="costed_rel",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
            attributes={"costTotalAnnual": 42000, "note": "keep me"},
        )
        for user, expect_cost in ((rel_env["admin"], True), (rel_env["viewer"], False)):
            resp = await client.get("/api/v1/relations?type=costed_rel", headers=auth_headers(user))
            assert resp.status_code == 200
            [row] = resp.json()
            assert row["attributes"].get("note") == "keep me"
            assert ("costTotalAnnual" in row["attributes"]) is expect_cost


class TestListRelationsFilters:
    async def test_card_type_matches_either_side(self, client, db, filter_env):
        admin = filter_env["admin"]
        # Application sits on the source side of two edges and the target side
        # of a third — all three must come back.
        assert await _ids(client, admin, "?card_type=Application") == {
            str(filter_env["r_app_itc"].id),
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }
        assert await _ids(client, admin, "?card_type=DataObject") == {
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }
        assert await _ids(client, admin, "?card_type=ITComponent") == {
            str(filter_env["r_app_itc"].id)
        }

    async def test_card_type_still_excludes_archived(self, client, db, filter_env):
        """`card_type=ITComponent` would match the archived edge on type alone —
        the visibility guard has to win."""
        ids = await _ids(client, filter_env["admin"], "?card_type=ITComponent")
        assert str(filter_env["r_archived"].id) not in ids

    async def test_card_type_unknown_returns_empty(self, client, db, filter_env):
        assert await _ids(client, filter_env["admin"], "?card_type=NoSuchType") == set()

    async def test_types_csv_is_a_union(self, client, db, filter_env):
        admin = filter_env["admin"]
        assert await _ids(client, admin, "?types=app_to_itc,app_to_do") == {
            str(filter_env["r_app_itc"].id),
            str(filter_env["r_app_data"].id),
        }

    async def test_single_types_value_matches_type_param(self, client, db, filter_env):
        admin = filter_env["admin"]
        assert await _ids(client, admin, "?types=app_to_itc") == await _ids(
            client, admin, "?type=app_to_itc"
        )

    async def test_empty_types_returns_nothing(self, client, db, filter_env):
        """An explicitly empty list means "no relation types", not "all of
        them" — otherwise a caller that computed an empty set client-side
        would silently get the whole instance back."""
        assert await _ids(client, filter_env["admin"], "?types=") == set()
        assert await _ids(client, filter_env["admin"], "?types=,,") == set()

    async def test_card_ids_matches_either_side(self, client, db, filter_env):
        admin = filter_env["admin"]
        assert await _ids(client, admin, f"?card_ids={filter_env['target'].id}") == {
            str(filter_env["r_app_itc"].id)
        }
        # `data` is a source once and a target once.
        assert await _ids(client, admin, f"?card_ids={filter_env['data'].id}") == {
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }

    async def test_card_ids_accepts_a_batch(self, client, db, filter_env):
        admin = filter_env["admin"]
        batch = f"{filter_env['target'].id},{filter_env['data'].id}"
        assert await _ids(client, admin, f"?card_ids={batch}") == {
            str(filter_env["r_app_itc"].id),
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }

    async def test_card_ids_skips_malformed_ids(self, client, db, filter_env):
        admin = filter_env["admin"]
        batch = f"not-a-uuid,{filter_env['target'].id}"
        assert await _ids(client, admin, f"?card_ids={batch}") == {str(filter_env["r_app_itc"].id)}

    async def test_card_ids_all_malformed_returns_empty(self, client, db, filter_env):
        assert await _ids(client, filter_env["admin"], "?card_ids=nope,nah") == set()

    async def test_card_ids_over_cap_is_rejected(self, client, db, filter_env):
        """Rejected, never truncated — a partial answer would read as complete."""
        too_many = ",".join(str(uuid.uuid4()) for _ in range(MAX_CARD_IDS_PER_QUERY + 1))
        resp = await client.get(
            f"/api/v1/relations?card_ids={too_many}",
            headers=auth_headers(filter_env["admin"]),
        )
        assert resp.status_code == 400
        assert "card_ids" in resp.json()["detail"]

    async def test_card_ids_at_cap_is_accepted(self, client, db, filter_env):
        ids = [str(filter_env["target"].id)] + [
            str(uuid.uuid4()) for _ in range(MAX_CARD_IDS_PER_QUERY - 1)
        ]
        assert await _ids(client, filter_env["admin"], f"?card_ids={','.join(ids)}") == {
            str(filter_env["r_app_itc"].id)
        }

    async def test_filters_combine(self, client, db, filter_env):
        admin = filter_env["admin"]
        # This is the inventory grid's request shape.
        assert await _ids(client, admin, "?card_type=DataObject&types=app_to_do,do_to_app") == {
            str(filter_env["r_app_data"].id),
            str(filter_env["r_data_app"].id),
        }
        assert await _ids(client, admin, "?card_type=DataObject&types=app_to_do") == {
            str(filter_env["r_app_data"].id)
        }
        assert await _ids(client, admin, "?card_type=ITComponent&types=app_to_do") == set()

    async def test_viewer_can_use_filters(self, client, db, filter_env):
        resp = await client.get(
            "/api/v1/relations?card_type=Application",
            headers=auth_headers(filter_env["viewer"]),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------
# PATCH /relations/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateRelation:
    async def test_update_attributes(self, client, db, rel_env):
        admin = rel_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"description": "Updated desc"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "Updated desc"

    async def test_patch_attributes_replaces_value(self, client, db, rel_env):
        """PATCH with attributes replaces the JSONB blob — the popover
        on the relation row uses this to flip flowDirection between
        bidirectional / forward / reverse."""
        admin = rel_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
            attributes={"flowDirection": "forward"},
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"attributes": {"flowDirection": "bidirectional"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"] == {"flowDirection": "bidirectional"}

    async def test_update_nonexistent_returns_404(self, client, db, rel_env):
        admin = rel_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/relations/{fake_id}",
            json={"description": "nope"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_update(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.patch(
            f"/api/v1/relations/{rel.id}",
            json={"description": "hack"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# DELETE /relations/{id}
# ---------------------------------------------------------------


class TestDeleteRelation:
    async def test_admin_can_delete(self, client, db, rel_env):
        admin = rel_env["admin"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.delete(
            f"/api/v1/relations/{rel.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, rel_env):
        admin = rel_env["admin"]
        resp = await client.delete(
            f"/api/v1/relations/{uuid.uuid4()}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, rel_env):
        viewer = rel_env["viewer"]
        rel = await create_relation(
            db,
            type_key="app_to_itc",
            source_id=rel_env["source"].id,
            target_id=rel_env["target"].id,
        )
        resp = await client.delete(
            f"/api/v1/relations/{rel.id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
