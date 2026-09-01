"""Reports with several relation types on one ordered card-type pair.

The metamodel allows any number of relation types between the same ordered
``(source_type_key, target_type_key)`` pair — an Organization that *owns* an
Application and one that *uses* it are different relationships. Every report that
walks relations therefore has to key by relation type (or dedup by card), not by
card-type pair. These are the tripwires for the consumers that used to assume
one type per pair.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import pytest

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
async def multi_rel_env(db):
    """Two relation types connecting Organization → Application."""
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")

    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Organization", label="Organization")

    await create_relation_type(
        db,
        key="relOrgToApp",
        label="uses",
        reverse_label="is used by",
        source_type_key="Organization",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relOrgToAppOwns",
        label="owns",
        reverse_label="is owned by",
        source_type_key="Organization",
        target_type_key="Application",
    )

    org = await create_card(db, card_type="Organization", name="Finance", user_id=admin.id)
    app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
    # The SAME two cards, connected through BOTH relation types.
    await create_relation(db, type_key="relOrgToApp", source_id=org.id, target_id=app.id)
    await create_relation(db, type_key="relOrgToAppOwns", source_id=org.id, target_id=app.id)

    return {"admin": admin, "org": org, "app": app}


class TestAppPortfolioMultiRelationTypes:
    async def test_both_relation_types_are_returned(self, client, multi_rel_env):
        """Both types must reach the grid; it groups them into one column itself.

        The payload used to dedup by ``other_type_key``, which dropped the second
        relation type outright — its data then existed but was unreachable.
        """
        resp = await client.get(
            "/api/v1/reports/app-portfolio?type=Organization",
            headers=auth_headers(multi_rel_env["admin"]),
        )
        assert resp.status_code == 200
        rel_types = resp.json()["relation_types"]

        to_app = [rt for rt in rel_types if rt["other_type_key"] == "Application"]
        assert {rt["key"] for rt in to_app} == {"relOrgToApp", "relOrgToAppOwns"}
        # Each keeps its own verb — that is what the editor sections are titled by.
        assert {rt["label"] for rt in to_app} == {"uses", "owns"}


class TestLandscapeMultiRelationTypes:
    async def test_card_listed_once_per_group(self, client, multi_rel_env):
        """A card reachable through two relation types is listed once."""
        resp = await client.get(
            "/api/v1/reports/landscape?type=Application&group_by=Organization",
            headers=auth_headers(multi_rel_env["admin"]),
        )
        assert resp.status_code == 200
        groups = resp.json()["groups"]

        finance = next(g for g in groups if g["name"] == "Finance")
        assert [item["name"] for item in finance["items"]] == ["CRM"]


class TestDependenciesMultiRelationTypes:
    async def test_one_edge_per_relation_type(self, client, multi_rel_env):
        """Each relation type contributes its own edge, carrying its own verb."""
        resp = await client.get(
            f"/api/v1/reports/dependencies?center_id={multi_rel_env['org'].id}",
            headers=auth_headers(multi_rel_env["admin"]),
        )
        assert resp.status_code == 200
        edges = resp.json()["edges"]

        org_id, app_id = str(multi_rel_env["org"].id), str(multi_rel_env["app"].id)
        pair_edges = [e for e in edges if {e["source"], e["target"]} == {org_id, app_id}]
        assert {e["type"] for e in pair_edges} == {"relOrgToApp", "relOrgToAppOwns"}
        assert {e["label"] for e in pair_edges} == {"uses", "owns"}

    async def test_same_type_still_collapses_to_one_edge(self, client, db, multi_rel_env):
        """Dedup by (pair, type) — a duplicate of ONE type is still one edge."""
        admin = multi_rel_env["admin"]
        other = await create_card(db, card_type="Application", name="Billing", user_id=admin.id)
        # Two rows of the same type between the same cards (reverse direction).
        await create_relation(
            db,
            type_key="relOrgToApp",
            source_id=multi_rel_env["org"].id,
            target_id=other.id,
        )
        await create_relation(
            db,
            type_key="relOrgToApp",
            source_id=other.id,
            target_id=multi_rel_env["org"].id,
        )

        resp = await client.get(
            f"/api/v1/reports/dependencies?center_id={multi_rel_env['org'].id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        org_id, other_id = str(multi_rel_env["org"].id), str(other.id)
        pair_edges = [
            e for e in resp.json()["edges"] if {e["source"], e["target"]} == {org_id, other_id}
        ]
        assert len(pair_edges) == 1


class TestEolMultiRelationTypes:
    """The EOL report's per-item app list must agree with its own summary."""

    async def test_affected_apps_listed_once(self, client, db, multi_rel_env):
        admin = multi_rel_env["admin"]
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="relITCToApp",
            label="supports",
            source_type_key="ITComponent",
            target_type_key="Application",
        )
        await create_relation_type(
            db,
            key="relITCToAppRuns",
            label="runs",
            source_type_key="ITComponent",
            target_type_key="Application",
        )
        # The report includes a card only via an API link or a manual
        # `lifecycle.endOfLife` — use the manual path.
        itc = await create_card(
            db,
            card_type="ITComponent",
            name="Postgres 12",
            user_id=admin.id,
            lifecycle={"endOfLife": "2024-11-14"},
        )
        app = multi_rel_env["app"]
        await create_relation(db, type_key="relITCToApp", source_id=itc.id, target_id=app.id)
        await create_relation(db, type_key="relITCToAppRuns", source_id=itc.id, target_id=app.id)

        resp = await client.get("/api/v1/reports/eol", headers=auth_headers(admin))
        assert resp.status_code == 200
        data = resp.json()

        item = next(i for i in data["items"] if i["name"] == "Postgres 12")
        names = [a["name"] for a in item["affected_apps"]]
        assert names.count("CRM") == 1, names


class TestCardJsonExportMultiRelationTypes:
    async def test_provider_names_listed_once(self, client, db, multi_rel_env):
        """The integration export must not repeat a provider per relation."""
        admin = multi_rel_env["admin"]
        await create_card_type(db, key="Provider", label="Provider")
        await create_relation_type(
            db,
            key="relAppToProvider",
            label="supplied by",
            source_type_key="Application",
            target_type_key="Provider",
        )
        await create_relation_type(
            db,
            key="relAppToProviderSupports",
            label="supported by",
            source_type_key="Application",
            target_type_key="Provider",
        )
        prov = await create_card(db, card_type="Provider", name="Acme", user_id=admin.id)
        app = multi_rel_env["app"]
        await create_relation(db, type_key="relAppToProvider", source_id=app.id, target_id=prov.id)
        await create_relation(
            db, type_key="relAppToProviderSupports", source_id=app.id, target_id=prov.id
        )

        resp = await client.get(
            "/api/v1/cards/export/json?types=Application&include_relations=true",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        # The endpoint returns a bare list of card dicts.
        item = next(i for i in resp.json() if i["name"] == "CRM")
        assert item["provider_names"] == ["Acme"]
