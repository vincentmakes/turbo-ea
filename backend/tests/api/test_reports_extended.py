"""Integration tests for extended /reports endpoints.

Covers: landscape, portfolio, matrix, roadmap, cost, cost-treemap,
capability-heatmap, dependencies, and data-quality.

These endpoints require a PostgreSQL test database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Application fields_schema with all fields needed by portfolio tests
APP_FIELDS_SCHEMA = [
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
                "key": "functionalFit",
                "label": "Functional Fit",
                "type": "single_select",
                "weight": 1,
                "options": [
                    {"key": "excellent", "label": "Excellent"},
                    {"key": "adequate", "label": "Adequate"},
                    {"key": "insufficient", "label": "Insufficient"},
                ],
            },
            {
                "key": "technicalFit",
                "label": "Technical Fit",
                "type": "single_select",
                "weight": 1,
                "options": [
                    {"key": "excellent", "label": "Excellent"},
                    {"key": "adequate", "label": "Adequate"},
                    {"key": "insufficient", "label": "Insufficient"},
                ],
            },
            {
                "key": "businessCriticality",
                "label": "Business Criticality",
                "type": "single_select",
                "weight": 1,
                "options": [
                    {"key": "mission_critical", "label": "Mission Critical"},
                    {"key": "business_critical", "label": "Business Critical"},
                    {"key": "business_operational", "label": "Business Operational"},
                    {"key": "administrative", "label": "Administrative"},
                ],
            },
        ],
    }
]


@pytest.fixture
async def env(db):
    """Prerequisite data shared by all extended report tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="noreports",
        label="No Reports",
        permissions={
            "inventory.view": True,
            "reports.ea_dashboard": False,
            "reports.portfolio": False,
        },
    )

    app_type = await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=APP_FIELDS_SCHEMA,
    )
    bc_type = await create_card_type(
        db,
        key="BusinessCapability",
        label="Business Capability",
        has_hierarchy=True,
    )
    itc_type = await create_card_type(
        db,
        key="ITComponent",
        label="IT Component",
    )

    await create_relation_type(
        db,
        key="app_to_bc",
        label="Application to Business Capability",
        source_type_key="Application",
        target_type_key="BusinessCapability",
        reverse_label="Business Capability to Application",
    )
    await create_relation_type(
        db,
        key="app_to_itc",
        label="Application to IT Component",
        source_type_key="Application",
        target_type_key="ITComponent",
        reverse_label="IT Component to Application",
    )
    await create_relation_type(
        db,
        key="app_to_app",
        label="Application to Application",
        source_type_key="Application",
        target_type_key="Application",
        reverse_label="Application to Application (reverse)",
    )

    admin = await create_user(db, email="admin@reports-ext.com", role="admin")
    noreports = await create_user(db, email="noreports@reports-ext.com", role="noreports")

    return {
        "admin": admin,
        "noreports": noreports,
        "app_type": app_type,
        "bc_type": bc_type,
        "itc_type": itc_type,
    }


# ---------------------------------------------------------------------------
# Landscape
# ---------------------------------------------------------------------------


class TestLandscape:
    async def test_landscape_empty(self, client, db, env):
        """Landscape returns empty groups/ungrouped with no cards."""
        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["groups"] == []
        assert data["ungrouped"] == []

    async def test_landscape_with_data(self, client, db, env):
        """Cards are grouped by related type; ungrouped catches the rest."""
        admin = env["admin"]
        bc = await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)
        app1 = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        # Link only app1 to bc
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)

        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        # One group with one item
        assert len(data["groups"]) == 1
        assert data["groups"][0]["name"] == "Sales"
        assert len(data["groups"][0]["items"]) == 1
        assert data["groups"][0]["items"][0]["name"] == "CRM"
        # ERP is ungrouped
        assert len(data["ungrouped"]) == 1
        assert data["ungrouped"][0]["name"] == "ERP"

    async def test_landscape_reverse_relation(self, client, db, env):
        """Relation in reverse direction (target=app, source=bc) is still grouped."""
        admin = env["admin"]
        bc = await create_card(db, card_type="BusinessCapability", name="Finance", user_id=admin.id)
        app = await create_card(db, card_type="Application", name="Ledger", user_id=admin.id)
        # Reverse direction: source=bc, target=app
        await create_relation(db, type_key="app_to_bc", source_id=bc.id, target_id=app.id)

        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["groups"]) == 1
        assert len(data["groups"][0]["items"]) == 1
        assert data["groups"][0]["items"][0]["name"] == "Ledger"

    async def test_landscape_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/landscape",
            params={"type": "Application", "group_by": "BusinessCapability"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------


class TestPortfolio:
    async def test_portfolio_empty(self, client, db, env):
        """Portfolio returns empty items list with no cards."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["x_axis"] == "functionalFit"
        assert data["y_axis"] == "technicalFit"

    async def test_portfolio_with_data(self, client, db, env):
        """Portfolio returns card attributes mapped to axes."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={
                "functionalFit": "excellent",
                "technicalFit": "adequate",
                "costTotalAnnual": 50000,
                "businessCriticality": "mission_critical",
            },
        )
        await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={
                "functionalFit": "adequate",
                "technicalFit": "insufficient",
                "costTotalAnnual": 120000,
                "businessCriticality": "business_critical",
            },
        )

        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        names = {item["name"] for item in data["items"]}
        assert names == {"CRM", "ERP"}
        # Verify axis mapping
        crm = next(i for i in data["items"] if i["name"] == "CRM")
        assert crm["x"] == "excellent"
        assert crm["y"] == "adequate"
        assert crm["size"] == 50000
        assert crm["color"] == "mission_critical"

    async def test_portfolio_invalid_field_400(self, client, db, env):
        """Invalid/unknown field name returns 400."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "nonExistentField",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_portfolio_unsafe_field_format_400(self, client, db, env):
        """Field name with special characters is rejected."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "field; DROP TABLE",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_portfolio_permission_denied(self, client, db, env):
        """User without reports.portfolio gets 403."""
        resp = await client.get(
            "/api/v1/reports/portfolio",
            params={
                "type": "Application",
                "x_axis": "functionalFit",
                "y_axis": "technicalFit",
                "size_field": "costTotalAnnual",
                "color_field": "businessCriticality",
            },
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Matrix
# ---------------------------------------------------------------------------


class TestMatrix:
    async def test_matrix_empty(self, client, db, env):
        """Matrix returns empty rows/columns/intersections with no cards."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "BusinessCapability"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rows"] == []
        assert data["columns"] == []
        assert data["intersections"] == []

    async def test_matrix_with_data(self, client, db, env):
        """Matrix returns rows, columns, and intersections from relations."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="App A", user_id=admin.id)
        app2 = await create_card(db, card_type="Application", name="App B", user_id=admin.id)
        bc1 = await create_card(db, card_type="BusinessCapability", name="Cap X", user_id=admin.id)
        bc2 = await create_card(db, card_type="BusinessCapability", name="Cap Y", user_id=admin.id)
        # App A -> Cap X, App B -> Cap Y
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc1.id)
        await create_relation(db, type_key="app_to_bc", source_id=app2.id, target_id=bc2.id)

        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) == 2
        assert len(data["columns"]) == 2
        assert len(data["intersections"]) == 2

        # Verify specific intersections
        row_names = {r["name"] for r in data["rows"]}
        col_names = {c["name"] for c in data["columns"]}
        assert row_names == {"App A", "App B"}
        assert col_names == {"Cap X", "Cap Y"}

    async def test_matrix_same_type_diagonal(self, client, db, env):
        """When row_type == col_type, self-relations appear on the diagonal."""
        admin = env["admin"]
        await create_card(db, card_type="Application", name="Solo App", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["rows"]) == 1
        assert len(data["columns"]) == 1
        # Self-relation on diagonal
        assert len(data["intersections"]) == 1
        ix = data["intersections"][0]
        assert ix["row_id"] == ix["col_id"]

    async def test_matrix_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "BusinessCapability"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403

    async def test_matrix_unknown_card_type(self, client, db, env):
        """An axis naming a card type that does not exist is a 400, not an empty grid."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "NoSuchType"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Matrix — relation semantics (type, direction, attributes) and filtering
# ---------------------------------------------------------------------------


@pytest.fixture
async def matrix_env(db, env):
    """Adds attributed relation types and a small App x DataObject landscape.

    The attribute keys here are deliberately arbitrary: the endpoint reads them
    out of each relation type's ``attributes_schema``, so these tests would pass
    just the same with any other admin-defined dimension.
    """
    admin = env["admin"]
    await create_card_type(db, key="DataObject", label="Data Object")

    await create_relation_type(
        db,
        key="app_to_do",
        label="uses",
        source_type_key="Application",
        target_type_key="DataObject",
        attributes_schema=[
            {"key": "flagA", "label": "Flag A", "type": "boolean"},
            {"key": "flagB", "label": "Flag B", "type": "boolean"},
            {
                "key": "usage",
                "label": "Usage",
                "type": "single_select",
                "options": [{"key": "owner", "label": "Owner"}, {"key": "user", "label": "User"}],
            },
        ],
    )
    # The reverse ordered pair is a distinct relation type — the metamodel
    # allows one per *ordered* pair, so an axis pair can involve two.
    await create_relation_type(
        db,
        key="do_to_app",
        label="feeds",
        source_type_key="DataObject",
        target_type_key="Application",
    )

    app_a = await create_card(db, card_type="Application", name="App A", user_id=admin.id)
    app_b = await create_card(db, card_type="Application", name="App B", user_id=admin.id)
    do_x = await create_card(db, card_type="DataObject", name="DO X", user_id=admin.id)
    do_y = await create_card(db, card_type="DataObject", name="DO Y", user_id=admin.id)
    return {**env, "app_a": app_a, "app_b": app_b, "do_x": do_x, "do_y": do_y}


async def _matrix(client, user, **params):
    resp = await client.get(
        "/api/v1/reports/matrix",
        params={"row_type": "Application", "col_type": "DataObject", **params},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _cell(data, row_id, col_id):
    for ix in data["intersections"]:
        if ix["row_id"] == str(row_id) and ix["col_id"] == str(col_id):
            return ix
    raise AssertionError(f"no cell for {row_id} x {col_id}")


class TestMatrixRelationSemantics:
    async def test_edge_carries_relation_type_direction_and_attributes(
        self, client, db, matrix_env
    ):
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"flagA": True, "usage": "owner"},
        )

        data = await _matrix(client, e["admin"])

        assert data["relation_types"] == ["app_to_do", "do_to_app"]
        edges = _cell(data, e["app_a"].id, e["do_x"].id)["e"]
        assert len(edges) == 1
        rt_idx, orientation, attr_idx = edges[0]
        assert data["relation_types"][rt_idx] == "app_to_do"
        assert orientation == "f"  # the row card is the relation's source
        assert data["attr_sets"][attr_idx] == {"flagA": True, "usage": "owner"}

    async def test_reverse_orientation_when_row_card_is_the_target(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db, type_key="do_to_app", source_id=e["do_x"].id, target_id=e["app_a"].id
        )

        data = await _matrix(client, e["admin"])

        _, orientation, attr_idx = _cell(data, e["app_a"].id, e["do_x"].id)["e"][0]
        assert orientation == "r"
        assert data["attr_sets"][attr_idx] == {}

    async def test_counts_every_relation_between_the_same_pair(self, client, db, matrix_env):
        """Two relation types linking the same two cards are two edges, not one.

        The endpoint used to collapse intersections into a set, so a cell could
        never report more than one relation.
        """
        e = matrix_env
        await create_relation(
            db, type_key="app_to_do", source_id=e["app_a"].id, target_id=e["do_x"].id
        )
        await create_relation(
            db, type_key="do_to_app", source_id=e["do_x"].id, target_id=e["app_a"].id
        )

        data = await _matrix(client, e["admin"])

        assert len(_cell(data, e["app_a"].id, e["do_x"].id)["e"]) == 2

    async def test_attribute_sets_are_interned(self, client, db, matrix_env):
        """Repeated attribute bags are stored once and referenced by index."""
        e = matrix_env
        for target in (e["do_x"].id, e["do_y"].id):
            await create_relation(
                db,
                type_key="app_to_do",
                source_id=e["app_a"].id,
                target_id=target,
                attributes={"usage": "owner"},
            )
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_b"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "owner"},
        )

        data = await _matrix(client, e["admin"])

        # index 0 is the always-present empty bag, index 1 the shared one
        assert data["attr_sets"] == [{}, {"usage": "owner"}]
        indices = {ix["e"][0][2] for ix in data["intersections"] if ix["e"]}
        assert indices == {1}

    async def test_attributes_not_declared_in_the_schema_are_dropped(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "user", "strayKey": "leftover"},
        )

        data = await _matrix(client, e["admin"])

        attr_idx = _cell(data, e["app_a"].id, e["do_x"].id)["e"][0][2]
        assert data["attr_sets"][attr_idx] == {"usage": "user"}

    async def test_self_matrix_diagonal_carries_no_edges(self, client, db, env):
        """The diagonal of a same-type matrix is structure, not a relationship."""
        admin = env["admin"]
        solo = await create_card(db, card_type="Application", name="Solo", user_id=admin.id)

        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "Application"},
            headers=auth_headers(admin),
        )
        data = resp.json()

        assert _cell(data, solo.id, solo.id)["e"] == []


class TestMatrixFilters:
    async def test_filter_by_relation_type(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db, type_key="app_to_do", source_id=e["app_a"].id, target_id=e["do_x"].id
        )
        await create_relation(
            db, type_key="do_to_app", source_id=e["do_y"].id, target_id=e["app_b"].id
        )

        data = await _matrix(client, e["admin"], relation_types="app_to_do")

        # `relation_types` is the index space the edges refer into, not the
        # filtered set — it always lists the types declared for the pair.
        assert data["relation_types"] == ["app_to_do", "do_to_app"]
        edges = _cell(data, e["app_a"].id, e["do_x"].id)["e"]
        assert len(edges) == 1
        assert data["relation_types"][edges[0][0]] == "app_to_do"
        assert all(
            not ix["e"] for ix in data["intersections"] if ix["row_id"] == str(e["app_b"].id)
        )

    async def test_filter_by_select_value(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "owner"},
        )
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_b"].id,
            target_id=e["do_y"].id,
            attributes={"usage": "user"},
        )

        data = await _matrix(client, e["admin"], attr="app_to_do.usage:owner")

        rows_with_edges = {ix["row_id"] for ix in data["intersections"] if ix["e"]}
        assert rows_with_edges == {str(e["app_a"].id)}

    async def test_filter_by_several_values_of_one_field_ors_them(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "owner"},
        )
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_b"].id,
            target_id=e["do_y"].id,
            attributes={"usage": "user"},
        )

        resp = await client.get(
            "/api/v1/reports/matrix",
            params=[
                ("row_type", "Application"),
                ("col_type", "DataObject"),
                ("attr", "app_to_do.usage:owner"),
                ("attr", "app_to_do.usage:user"),
            ],
            headers=auth_headers(e["admin"]),
        )
        data = resp.json()

        rows_with_edges = {ix["row_id"] for ix in data["intersections"] if ix["e"]}
        assert rows_with_edges == {str(e["app_a"].id), str(e["app_b"].id)}

    async def test_filter_by_boolean_value(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"flagA": True},
        )
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_b"].id,
            target_id=e["do_x"].id,
            attributes={"flagA": False},
        )

        data = await _matrix(client, e["admin"], attr="app_to_do.flagA:true")

        rows_with_edges = {ix["row_id"] for ix in data["intersections"] if ix["e"]}
        assert rows_with_edges == {str(e["app_a"].id)}

    async def test_filter_on_unset_value(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "owner"},
        )
        await create_relation(
            db, type_key="app_to_do", source_id=e["app_b"].id, target_id=e["do_x"].id
        )

        data = await _matrix(client, e["admin"], attr="app_to_do.usage:__empty__")

        rows_with_edges = {ix["row_id"] for ix in data["intersections"] if ix["e"]}
        assert rows_with_edges == {str(e["app_b"].id)}

    async def test_filter_is_scoped_to_its_own_relation_type(self, client, db, matrix_env):
        """A filter on one relation type must not discard the other type's edges."""
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "user"},
        )
        await create_relation(
            db, type_key="do_to_app", source_id=e["do_y"].id, target_id=e["app_b"].id
        )

        data = await _matrix(client, e["admin"], attr="app_to_do.usage:owner")

        rows_with_edges = {ix["row_id"] for ix in data["intersections"] if ix["e"]}
        assert rows_with_edges == {str(e["app_b"].id)}

    async def test_filter_by_direction(self, client, db, matrix_env):
        e = matrix_env
        await create_relation(
            db, type_key="app_to_do", source_id=e["app_a"].id, target_id=e["do_x"].id
        )
        await create_relation(
            db, type_key="do_to_app", source_id=e["do_y"].id, target_id=e["app_b"].id
        )

        forward = await _matrix(client, e["admin"], direction="forward")
        reverse = await _matrix(client, e["admin"], direction="reverse")

        assert {ix["row_id"] for ix in forward["intersections"] if ix["e"]} == {str(e["app_a"].id)}
        assert {ix["row_id"] for ix in reverse["intersections"] if ix["e"]} == {str(e["app_b"].id)}

    async def test_filters_never_prune_the_card_lists(self, client, db, matrix_env):
        """Cards always ship in full — pruning them would break the parent chain.

        The client hides cards with no surviving edge; it cannot rebuild a
        hierarchy whose intermediate nodes the server dropped.
        """
        e = matrix_env
        await create_relation(
            db,
            type_key="app_to_do",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"usage": "owner"},
        )

        data = await _matrix(client, e["admin"], attr="app_to_do.usage:user")

        assert len(data["rows"]) == 2
        assert len(data["columns"]) == 2
        assert all(not ix["e"] for ix in data["intersections"])

    @pytest.mark.parametrize(
        "bad",
        [
            "no-separators",
            "app_to_do.usage",  # missing :value
            "usage:owner",  # missing relation-type prefix
            "not_a_type.usage:owner",  # relation type not on these axes
            "app_to_do.notAField:owner",  # field not declared on that type
        ],
    )
    async def test_malformed_attribute_filter_is_rejected(self, client, db, matrix_env, bad):
        """A typo must fail loudly — silently widening the result set is worse."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "Application", "col_type": "DataObject", "attr": bad},
            headers=auth_headers(matrix_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_relation_type_filter_naming_no_real_type_is_rejected(
        self, client, db, matrix_env
    ):
        """A key that exists nowhere is a typo; one declared elsewhere is not."""
        resp = await client.get(
            "/api/v1/reports/matrix",
            params={
                "row_type": "Application",
                "col_type": "DataObject",
                "relation_types": "not_a_real_relation_type",
            },
            headers=auth_headers(matrix_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_relation_type_filter_accepts_a_type_declared_for_another_pair(
        self, client, db, matrix_env
    ):
        # `app_to_itc` is declared Application -> ITComponent, but a relation of
        # that type between an Application and a Data Object still connects the
        # two axes, so filtering on it is a legitimate question, not an error.
        e = matrix_env
        await create_relation(
            db, type_key="app_to_itc", source_id=e["app_a"].id, target_id=e["do_x"].id
        )

        data = await _matrix(client, e["admin"], relation_types="app_to_itc")

        assert sum(len(ix["e"]) for ix in data["intersections"]) == 1


class TestMatrixRelationTypeCoverage:
    """Which relations belong in the grid is decided by the cards they connect.

    Restricting to the relation types the metamodel declares for the axis pair
    silently drops relations whose type was renamed, imported, or declared for
    another pair — they connect the two cards all the same.
    """

    async def test_includes_a_relation_whose_type_is_not_declared_for_the_pair(
        self, client, db, matrix_env
    ):
        e = matrix_env
        await create_relation(
            db, type_key="app_to_itc", source_id=e["app_a"].id, target_id=e["do_x"].id
        )

        data = await _matrix(client, e["admin"])

        edges = _cell(data, e["app_a"].id, e["do_x"].id)["e"]
        assert len(edges) == 1
        assert data["relation_types"][edges[0][0]] == "app_to_itc"

    async def test_lists_declared_types_first_then_the_ones_found_in_the_data(
        self, client, db, matrix_env
    ):
        e = matrix_env
        await create_relation(
            db, type_key="app_to_itc", source_id=e["app_a"].id, target_id=e["do_x"].id
        )

        data = await _matrix(client, e["admin"])

        assert data["relation_types"][:2] == ["app_to_do", "do_to_app"]
        assert "app_to_itc" in data["relation_types"]

    async def test_includes_relations_when_the_metamodel_declares_none_for_the_pair(
        self, client, db, env
    ):
        """A pair the metamodel says nothing about still shows what is there."""
        admin = env["admin"]
        app = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="Component", user_id=admin.id)
        # ITComponent has no declared relation type back to Application.
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        resp = await client.get(
            "/api/v1/reports/matrix",
            params={"row_type": "ITComponent", "col_type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()

        edges = _cell(data, itc.id, app.id)["e"]
        assert len(edges) == 1
        assert data["relation_types"][edges[0][0]] == "app_to_itc"
        # The row card is the relation's target, so the row reads as reverse.
        assert edges[0][1] == "r"

    async def test_attributes_are_read_through_the_relations_own_schema(
        self, client, db, matrix_env
    ):
        """Even for a type not declared for this pair."""
        e = matrix_env
        await create_relation_type(
            db,
            key="app_to_do_legacy",
            label="legacy",
            source_type_key="Application",
            target_type_key="ITComponent",
            attributes_schema=[{"key": "legacyFlag", "label": "Legacy", "type": "boolean"}],
        )
        await create_relation(
            db,
            type_key="app_to_do_legacy",
            source_id=e["app_a"].id,
            target_id=e["do_x"].id,
            attributes={"legacyFlag": True, "unknownKey": "x"},
        )

        data = await _matrix(client, e["admin"])

        edges = _cell(data, e["app_a"].id, e["do_x"].id)["e"]
        assert data["attr_sets"][edges[0][2]] == {"legacyFlag": True}


# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------


class TestRoadmap:
    async def test_roadmap_empty(self, client, db, env):
        """Roadmap returns empty items with no cards."""
        resp = await client.get(
            "/api/v1/reports/roadmap",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []

    async def test_roadmap_with_lifecycle(self, client, db, env):
        """Cards with lifecycle dates appear in roadmap."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Legacy App",
            user_id=admin.id,
            lifecycle={
                "plan": "2020-01-01",
                "phaseIn": "2020-06-01",
                "active": "2021-01-01",
                "phaseOut": "2025-01-01",
                "endOfLife": "2026-01-01",
            },
        )
        # Card without lifecycle should not appear
        await create_card(
            db,
            card_type="Application",
            name="New App",
            user_id=admin.id,
            lifecycle={},
        )

        resp = await client.get(
            "/api/v1/reports/roadmap",
            params={"type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["name"] == "Legacy App"
        assert data["items"][0]["lifecycle"]["active"] == "2021-01-01"

    async def test_roadmap_no_type_filter(self, client, db, env):
        """Without type filter, all types with lifecycle are returned."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="App With LC",
            user_id=admin.id,
            lifecycle={"active": "2022-01-01"},
        )
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Cap With LC",
            user_id=admin.id,
            lifecycle={"active": "2023-01-01"},
        )

        resp = await client.get(
            "/api/v1/reports/roadmap",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        types = {item["type"] for item in data["items"]}
        assert types == {"Application", "BusinessCapability"}

    async def test_roadmap_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/roadmap",
            params={"type": "Application"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


class TestCost:
    async def test_cost_empty(self, client, db, env):
        """Cost report returns empty items and zero total with no cards."""
        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    async def test_cost_with_data(self, client, db, env):
        """Cost report aggregates cost fields and sorts descending."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Expensive App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 200000},
        )
        await create_card(
            db,
            card_type="Application",
            name="Cheap App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 5000},
        )
        # Card with no cost should not appear
        await create_card(
            db,
            card_type="Application",
            name="Free App",
            user_id=admin.id,
            attributes={},
        )

        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 205000
        # Sorted descending by cost
        assert data["items"][0]["name"] == "Expensive App"
        assert data["items"][0]["cost"] == 200000
        assert data["items"][1]["name"] == "Cheap App"
        assert data["items"][1]["cost"] == 5000

    async def test_cost_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/cost",
            params={"type": "Application"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Cost Treemap
# ---------------------------------------------------------------------------


class TestCostTreemap:
    async def test_cost_treemap_empty(self, client, db, env):
        """Cost treemap returns empty items and zero total with no cards."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "costTotalAnnual"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["groups"] is None

    async def test_cost_treemap_with_data(self, client, db, env):
        """Cost treemap returns items sorted by cost descending."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Big App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 100000},
        )
        await create_card(
            db,
            card_type="Application",
            name="Small App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 15000},
        )

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 115000
        assert data["items"][0]["name"] == "Big App"
        assert data["items"][0]["cost"] == 100000

    async def test_cost_treemap_with_group_by(self, client, db, env):
        """Cost treemap with group_by adds group labels to items."""
        admin = env["admin"]
        bc = await create_card(
            db, card_type="BusinessCapability", name="Marketing", user_id=admin.id
        )
        app1 = await create_card(
            db,
            card_type="Application",
            name="Ad Platform",
            user_id=admin.id,
            attributes={"costTotalAnnual": 75000},
        )
        await create_card(
            db,
            card_type="Application",
            name="Standalone",
            user_id=admin.id,
            attributes={"costTotalAnnual": 20000},
        )
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Application",
                "cost_field": "costTotalAnnual",
                "group_by": "BusinessCapability",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["groups"] is not None
        assert len(data["groups"]) == 2  # Marketing + Ungrouped

        # Verify group assignment
        ad_item = next(i for i in data["items"] if i["name"] == "Ad Platform")
        standalone_item = next(i for i in data["items"] if i["name"] == "Standalone")
        assert ad_item["group"] == "Marketing"
        assert standalone_item["group"] == "Ungrouped"

    async def test_cost_treemap_invalid_cost_field_400(self, client, db, env):
        """Invalid cost_field format returns 400."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "cost;DROP TABLE"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_treemap_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={"type": "Application", "cost_field": "costTotalAnnual"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403

    async def test_cost_treemap_aggregate_from_related_type(self, client, db, env):
        """Aggregation rolls up costs from related cards (Provider via Application)."""
        admin = env["admin"]
        await create_card_type(
            db,
            key="Provider",
            label="Provider",
            fields_schema=[],
        )
        await create_relation_type(
            db,
            key="provider_to_app",
            label="Provider offers Application",
            source_type_key="Provider",
            target_type_key="Application",
        )
        provider_a = await create_card(db, card_type="Provider", name="Vendor A", user_id=admin.id)
        provider_b = await create_card(db, card_type="Provider", name="Vendor B", user_id=admin.id)
        # Vendor C offers no apps; should not appear in items.
        await create_card(db, card_type="Provider", name="Vendor C", user_id=admin.id)
        app1 = await create_card(
            db,
            card_type="Application",
            name="App 1",
            user_id=admin.id,
            attributes={"costTotalAnnual": 50000},
        )
        app2 = await create_card(
            db,
            card_type="Application",
            name="App 2",
            user_id=admin.id,
            attributes={"costTotalAnnual": 30000},
        )
        app3 = await create_card(
            db,
            card_type="Application",
            name="App 3",
            user_id=admin.id,
            attributes={"costTotalAnnual": 10000},
        )
        # Vendor A → App1, App2 (=80000); Vendor B → App3 (=10000); Vendor C → none.
        await create_relation(
            db, type_key="provider_to_app", source_id=provider_a.id, target_id=app1.id
        )
        # Reverse direction must also be picked up.
        await create_relation(
            db, type_key="provider_to_app", source_id=app2.id, target_id=provider_a.id
        )
        await create_relation(
            db, type_key="provider_to_app", source_id=provider_b.id, target_id=app3.id
        )

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Provider",
                "aggregate": ["Application:costTotalAnnual"],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = [i["name"] for i in data["items"]]
        assert names == ["Vendor A", "Vendor B"]  # sorted desc, Vendor C excluded
        assert data["items"][0]["cost"] == 80000
        assert data["items"][1]["cost"] == 10000
        assert data["total"] == 90000

    async def test_cost_treemap_aggregate_dedupes_parallel_relations(self, client, db, env):
        """Two relations between the same pair must not double-count the related cost."""
        admin = env["admin"]
        await create_card_type(db, key="Provider", label="Provider", fields_schema=[])
        await create_relation_type(
            db,
            key="provider_to_app",
            label="Provider offers Application",
            source_type_key="Provider",
            target_type_key="Application",
        )
        provider = await create_card(db, card_type="Provider", name="V", user_id=admin.id)
        app = await create_card(
            db,
            card_type="Application",
            name="A",
            user_id=admin.id,
            attributes={"costTotalAnnual": 12345},
        )
        await create_relation(
            db, type_key="provider_to_app", source_id=provider.id, target_id=app.id
        )
        await create_relation(
            db, type_key="provider_to_app", source_id=app.id, target_id=provider.id
        )

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Provider",
                "aggregate": ["Application:costTotalAnnual"],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["cost"] == 12345

    async def test_cost_treemap_aggregate_multi_type_sums_cleanly(self, client, db, env):
        """Aggregating across two related types sums per-type roll-ups without overlap."""
        admin = env["admin"]
        await create_card_type(db, key="Provider", label="Provider", fields_schema=[])
        # Reuse the env's ITComponent type but give it a cost field.
        itc = (
            (await db.execute(select(CardType).where(CardType.key == "ITComponent")))
            .scalars()
            .first()
        )
        itc.fields_schema = [
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    }
                ],
            }
        ]
        await db.flush()
        await create_relation_type(
            db,
            key="provider_to_app",
            label="Provider offers Application",
            source_type_key="Provider",
            target_type_key="Application",
        )
        await create_relation_type(
            db,
            key="provider_to_itc",
            label="Provider offers IT Component",
            source_type_key="Provider",
            target_type_key="ITComponent",
        )
        microsoft = await create_card(db, card_type="Provider", name="Microsoft", user_id=admin.id)
        teams = await create_card(
            db,
            card_type="Application",
            name="Teams",
            user_id=admin.id,
            attributes={"costTotalAnnual": 60000},
        )
        azure = await create_card(
            db,
            card_type="ITComponent",
            name="Azure",
            user_id=admin.id,
            attributes={"costTotalAnnual": 200000},
        )
        await create_relation(
            db, type_key="provider_to_app", source_id=microsoft.id, target_id=teams.id
        )
        await create_relation(
            db, type_key="provider_to_itc", source_id=microsoft.id, target_id=azure.id
        )

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Provider",
                "aggregate": [
                    "Application:costTotalAnnual",
                    "ITComponent:costTotalAnnual",
                ],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["name"] == "Microsoft"
        assert data["items"][0]["cost"] == 260000

    async def test_cost_treemap_aggregate_duplicate_pair_400(self, client, db, env):
        """Repeating the same (type, field) pair must be rejected."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Application",
                "aggregate": [
                    "Application:costTotalAnnual",
                    "Application:costTotalAnnual",
                ],
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_treemap_aggregate_invalid_field_400(self, client, db, env):
        """Aggregating a non-cost field returns 400."""
        admin = env["admin"]
        await create_card_type(db, key="Provider", label="Provider", fields_schema=[])
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Provider",
                "aggregate": ["Application:functionalFit"],  # not a cost field
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_cost_treemap_aggregate_unknown_type_400(self, client, db, env):
        """Aggregating from an unknown type returns 400."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Application",
                "aggregate": ["DoesNotExist:costTotalAnnual"],
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_treemap_aggregate_malformed_spec_400(self, client, db, env):
        """Malformed aggregate spec (no colon) returns 400."""
        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "Application",
                "aggregate": ["bogus"],
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_treemap_parent_card_id_filters_to_related(self, client, db, env):
        """parent_card_id restricts the result to cards related to that parent.

        Powers the treemap drill-down: clicking a parent rectangle (e.g. an
        Application) re-queries with ``type=ITComponent`` and the parent's id
        to reveal the components contributing to that parent's roll-up.
        """
        admin = env["admin"]
        # ITComponent + app_to_itc relation already exist in the env fixture.
        parent = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        other_parent = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
        comp1 = await create_card(
            db,
            card_type="ITComponent",
            name="DB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 5000},
        )
        comp2 = await create_card(
            db,
            card_type="ITComponent",
            name="Web",
            user_id=admin.id,
            attributes={"costTotalAnnual": 3000},
        )
        # comp3 belongs to the other parent — must be excluded.
        comp3 = await create_card(
            db,
            card_type="ITComponent",
            name="Cache",
            user_id=admin.id,
            attributes={"costTotalAnnual": 9999},
        )
        await create_relation(db, type_key="app_to_itc", source_id=parent.id, target_id=comp1.id)
        # Reverse direction must also be picked up.
        await create_relation(db, type_key="app_to_itc", source_id=comp2.id, target_id=parent.id)
        await create_relation(
            db, type_key="app_to_itc", source_id=other_parent.id, target_id=comp3.id
        )

        resp = await client.get(
            "/api/v1/reports/cost-treemap",
            params={
                "type": "ITComponent",
                "cost_field": "costTotalAnnual",
                "parent_card_id": str(parent.id),
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = sorted(i["name"] for i in data["items"])
        assert names == ["DB", "Web"]
        assert data["total"] == 8000


# ---------------------------------------------------------------------------
# Capability Heatmap
# ---------------------------------------------------------------------------


class TestCapabilityHeatmap:
    async def test_capability_heatmap_empty(self, client, db, env):
        """Capability heatmap returns empty items with no capabilities."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["metric"] == "app_count"

    async def test_capability_heatmap_with_data(self, client, db, env):
        """Capabilities with linked apps show correct app_count."""
        admin = env["admin"]
        bc1 = await create_card(db, card_type="BusinessCapability", name="Sales", user_id=admin.id)
        bc2 = await create_card(db, card_type="BusinessCapability", name="HR", user_id=admin.id)
        app1 = await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={"costTotalAnnual": 50000},
        )
        app2 = await create_card(
            db,
            card_type="Application",
            name="ATS",
            user_id=admin.id,
            attributes={"costTotalAnnual": 30000},
        )
        # CRM -> Sales, ATS -> HR
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc1.id)
        await create_relation(db, type_key="app_to_bc", source_id=app2.id, target_id=bc2.id)

        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2

        sales = next(i for i in data["items"] if i["name"] == "Sales")
        hr = next(i for i in data["items"] if i["name"] == "HR")
        assert sales["app_count"] == 1
        assert hr["app_count"] == 1
        # total_cost should reflect linked app costs
        assert sales["total_cost"] == 50000
        assert hr["total_cost"] == 30000

    async def test_capability_heatmap_hierarchy(self, client, db, env):
        """Parent capabilities include parent_id field."""
        admin = env["admin"]
        parent = await create_card(
            db, card_type="BusinessCapability", name="Enterprise", user_id=admin.id
        )
        await create_card(
            db,
            card_type="BusinessCapability",
            name="Operations",
            user_id=admin.id,
            parent_id=parent.id,
        )

        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2

        child_item = next(i for i in data["items"] if i["name"] == "Operations")
        parent_item = next(i for i in data["items"] if i["name"] == "Enterprise")
        assert child_item["parent_id"] == str(parent.id)
        assert parent_item["parent_id"] is None

    async def test_capability_heatmap_invalid_metric_400(self, client, db, env):
        """Invalid metric value returns 400."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "invalid_metric"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_capability_heatmap_total_cost_metric(self, client, db, env):
        """total_cost metric is accepted (whitelisted)."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "total_cost"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["metric"] == "total_cost"

    async def test_capability_heatmap_risk_count_metric(self, client, db, env):
        """risk_count metric is accepted (whitelisted)."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "risk_count"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["metric"] == "risk_count"

    async def test_capability_heatmap_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "app_count"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


class TestDependencies:
    async def test_dependencies_empty(self, client, db, env):
        """Dependencies returns empty nodes/edges with no cards."""
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["edges"] == []

    async def test_dependencies_with_data(self, client, db, env):
        """Dependencies returns nodes and edges from relations."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="App A", user_id=admin.id)
        app2 = await create_card(db, card_type="Application", name="App B", user_id=admin.id)
        app3 = await create_card(db, card_type="Application", name="App C", user_id=admin.id)
        await create_relation(db, type_key="app_to_app", source_id=app1.id, target_id=app2.id)
        await create_relation(db, type_key="app_to_app", source_id=app2.id, target_id=app3.id)

        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 3
        assert len(data["edges"]) == 2

        node_names = {n["name"] for n in data["nodes"]}
        assert node_names == {"App A", "App B", "App C"}

        # Edges should have label and type from relation type
        for edge in data["edges"]:
            assert "source" in edge
            assert "target" in edge
            assert "type" in edge
            assert "label" in edge

    async def test_dependencies_with_center_id_bfs(self, client, db, env):
        """BFS from center_id limits nodes to given depth."""
        admin = env["admin"]
        # Create a chain: A -> B -> C -> D
        app_a = await create_card(db, card_type="Application", name="Center", user_id=admin.id)
        app_b = await create_card(db, card_type="Application", name="Depth 1", user_id=admin.id)
        app_c = await create_card(db, card_type="Application", name="Depth 2", user_id=admin.id)
        app_d = await create_card(db, card_type="Application", name="Depth 3", user_id=admin.id)
        await create_relation(db, type_key="app_to_app", source_id=app_a.id, target_id=app_b.id)
        await create_relation(db, type_key="app_to_app", source_id=app_b.id, target_id=app_c.id)
        await create_relation(db, type_key="app_to_app", source_id=app_c.id, target_id=app_d.id)

        # BFS depth=1 from Center: should get Center + Depth 1
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"center_id": str(app_a.id), "depth": 1},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        node_names = {n["name"] for n in data["nodes"]}
        assert "Center" in node_names
        assert "Depth 1" in node_names
        assert "Depth 3" not in node_names

        # BFS depth=2 from Center: should get Center + Depth 1 + Depth 2
        resp2 = await client.get(
            "/api/v1/reports/dependencies",
            params={"center_id": str(app_a.id), "depth": 2},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        node_names2 = {n["name"] for n in data2["nodes"]}
        assert "Center" in node_names2
        assert "Depth 1" in node_names2
        assert "Depth 2" in node_names2
        assert "Depth 3" not in node_names2

    async def test_dependencies_type_filter(self, client, db, env):
        """Type filter limits nodes to the specified card type."""
        admin = env["admin"]
        app = await create_card(db, card_type="Application", name="My App", user_id=admin.id)
        itc = await create_card(db, card_type="ITComponent", name="My Server", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=itc.id)

        # Filter to Application only
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"type": "Application", "depth": 2},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        node_types = {n["type"] for n in data["nodes"]}
        assert node_types == {"Application"}

    async def test_dependencies_ancestor_path(self, client, db, env):
        """Nodes include ancestor path for hierarchical cards."""
        admin = env["admin"]
        parent = await create_card(db, card_type="Application", name="Parent App", user_id=admin.id)
        await create_card(
            db,
            card_type="Application",
            name="Child App",
            user_id=admin.id,
            parent_id=parent.id,
        )

        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        child_node = next(n for n in data["nodes"] if n["name"] == "Child App")
        assert child_node["path"] == ["Parent App"]
        assert child_node["parent_id"] == str(parent.id)

    async def test_dependencies_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/dependencies",
            params={"depth": 2},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Data Quality
# ---------------------------------------------------------------------------


class TestDataQuality:
    async def test_data_quality_empty(self, client, db, env):
        """Data quality returns zero summary with no cards."""
        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_data_quality"] == 0
        assert data["total_items"] == 0
        assert data["with_lifecycle"] == 0
        assert data["orphaned"] == 0
        assert data["stale"] == 0
        assert data["by_type"] == []
        assert data["worst_items"] == []

    async def test_data_quality_with_data(self, client, db, env):
        """Data quality correctly categorizes cards into buckets."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Complete App",
            user_id=admin.id,
            data_quality=90.0,
            lifecycle={"active": "2023-01-01"},
        )
        await create_card(
            db,
            card_type="Application",
            name="Partial App",
            user_id=admin.id,
            data_quality=55.0,
        )
        await create_card(
            db,
            card_type="Application",
            name="Minimal App",
            user_id=admin.id,
            data_quality=10.0,
        )

        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_items"] == 3
        assert data["with_lifecycle"] == 1
        # All are orphaned (no relations)
        assert data["orphaned"] == 3

        # By type breakdown
        assert len(data["by_type"]) == 1
        app_stats = data["by_type"][0]
        assert app_stats["type"] == "Application"
        assert app_stats["total"] == 3
        assert app_stats["complete"] == 1  # >= 80
        assert app_stats["partial"] == 1  # >= 40 and < 80
        assert app_stats["minimal"] == 1  # < 40

        # Worst items
        assert len(data["worst_items"]) == 3
        # Sorted by data_quality ascending
        assert data["worst_items"][0]["name"] == "Minimal App"

    async def test_data_quality_orphaned_vs_connected(self, client, db, env):
        """Cards with relations are not counted as orphaned."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="Connected", user_id=admin.id)
        await create_card(db, card_type="Application", name="Orphan", user_id=admin.id)
        bc = await create_card(db, card_type="BusinessCapability", name="Cap", user_id=admin.id)
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)

        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_items"] == 3  # 2 apps + 1 bc
        # app1 and bc are connected; app2 is orphaned
        assert data["orphaned"] == 1

    async def test_data_quality_overall_average(self, client, db, env):
        """Overall data quality is the average of all scores."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="App 100",
            user_id=admin.id,
            data_quality=100.0,
        )
        await create_card(
            db,
            card_type="Application",
            name="App 0",
            user_id=admin.id,
            data_quality=0.0,
        )

        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_data_quality"] == 50.0

    async def test_data_quality_permission_denied(self, client, db, env):
        """User without reports.ea_dashboard gets 403."""
        resp = await client.get(
            "/api/v1/reports/data-quality",
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403
