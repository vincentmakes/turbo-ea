"""The time-travel payloads carry each relation's own dates.

The Dependencies report, the Portfolio report (and the inventory, which reads
the same portfolio payload's relations) and the Capability Map travel in time
on the client, so their payloads return EVERY relation and say, per relation,
when it is in effect: ``lifecycle`` on a dependency edge and on an
``app_relations`` entry, ``app_link_lifecycles`` on a heatmap capability. An
undated relation is always in effect and carries nothing, so an undated
landscape pays nothing for the feature. ``GET /reports/dependencies`` can also
be asked for the landscape today only (``in_effect_only``), which is what the
MCP impact analysis does. A published portal shows relations in effect today
and never ships a relation's dates to an anonymous reader.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.web_portal import WebPortal
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)
from tests.relation_windows import COUNTING, FUTURE, PAST, WINDOWS


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="nobody", label="Nobody", permissions={})
    await create_role(
        db,
        key="analyst",
        label="Analyst",
        permissions={"reports.ea_dashboard": True, "reports.portfolio": True},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    nobody = await create_user(db, email="nobody@test.com", role="nobody")
    analyst = await create_user(db, email="analyst@test.com", role="analyst")
    for key in ("Application", "ITComponent", "Organization"):
        await create_card_type(db, key=key, label=key)
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_relation_type(
        db, key="relAppToITC", source_type_key="Application", target_type_key="ITComponent"
    )
    await create_relation_type(
        db, key="relOrgToApp", source_type_key="Organization", target_type_key="Application"
    )
    await create_relation_type(
        db,
        key="relCapToApp",
        source_type_key="BusinessCapability",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relCapToAppAlso",
        source_type_key="BusinessCapability",
        target_type_key="Application",
    )
    return SimpleNamespace(admin=admin, nobody=nobody, analyst=analyst)


async def _fan(db, *, hub_type="Application", peer_type="ITComponent", rel_type="relAppToITC"):
    """One hub linked to one peer per window, the peers named after them."""
    hub = await create_card(db, card_type=hub_type, name="Hub")
    peers = {}
    for name, lifecycle in WINDOWS.items():
        peers[name] = await create_card(db, card_type=peer_type, name=name)
        await create_relation(
            db, type_key=rel_type, source_id=hub.id, target_id=peers[name].id, lifecycle=lifecycle
        )
    return hub, peers


async def _hide_it_components_from_the_analyst(db):
    itc = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    itc.role_permissions = {"analyst": {"inventory.view": False}}
    await db.flush()


async def _get(client, user, url, **params):
    resp = await client.get(url, params=params, headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── GET /reports/dependencies ────────────────────────────────────────────────


class TestDependencies:
    URL = "/api/v1/reports/dependencies"

    async def test_every_edge_and_only_a_dated_one_carries_its_lifecycle(self, client, db, env):
        hub, peers = await _fan(db)
        data = await _get(client, env.admin, self.URL)
        by_peer = {
            next(n["name"] for n in data["nodes"] if n["id"] == e["target"]): e
            for e in data["edges"]
        }
        # All four relations are there: the client filters at the travelled date.
        assert sorted(by_peer) == sorted(WINDOWS)
        assert "lifecycle" not in by_peer["undated"]
        for name in ("current", "planned", "ended"):
            assert by_peer[name]["lifecycle"] == WINDOWS[name]
        assert all(e["source"] == str(hub.id) for e in data["edges"])

    async def test_in_effect_only_keeps_the_relations_in_effect_today(self, client, db, env):
        await _fan(db)
        data = await _get(client, env.admin, self.URL, in_effect_only="true")
        names = {n["id"]: n["name"] for n in data["nodes"]}
        assert sorted(names[e["target"]] for e in data["edges"]) == COUNTING

    async def test_in_effect_only_off_is_the_default(self, client, db, env):
        await _fan(db)
        data = await _get(client, env.admin, self.URL, in_effect_only="false")
        assert len(data["edges"]) == len(WINDOWS)

    async def test_the_bfs_does_not_walk_a_relation_not_in_effect(self, client, db, env):
        hub, peers = await _fan(db)
        centred = await _get(
            client, env.admin, self.URL, center_id=str(hub.id), depth=1, in_effect_only="true"
        )
        assert sorted(n["name"] for n in centred["nodes"]) == sorted(["Hub", *COUNTING])
        # Without the flag the neighbourhood reaches every peer, dated or not.
        everything = await _get(client, env.admin, self.URL, center_id=str(hub.id), depth=1)
        assert sorted(n["name"] for n in everything["nodes"]) == sorted(["Hub", *WINDOWS])

    async def test_a_hidden_card_takes_its_edge_and_dates_with_it(self, client, db, env):
        await _fan(db)
        await _hide_it_components_from_the_analyst(db)
        data = await _get(client, env.analyst, self.URL)
        assert data["edges"] == []
        assert PAST not in str(data) and FUTURE not in str(data)

    async def test_permission_is_unchanged(self, client, env):
        resp = await client.get(self.URL, headers=auth_headers(env.nobody))
        assert resp.status_code == 403

    async def test_a_malformed_flag_is_rejected(self, client, env):
        resp = await client.get(
            self.URL, params={"in_effect_only": "maybe"}, headers=auth_headers(env.admin)
        )
        assert resp.status_code == 422

    @pytest.mark.parametrize("ended_first", [True, False])
    async def test_two_rows_of_one_type_collapse_to_the_widest_dates(
        self, client, db, env, ended_first
    ):
        # A self-referencing type: A→B ended, B→A undated. The two rows are one
        # edge, and it must be undated whichever row the query returns first —
        # carrying the ended row's dates would drop a relation in effect.
        await create_relation_type(
            db, key="relAppToApp", source_type_key="Application", target_type_key="Application"
        )
        a = await create_card(db, card_type="Application", name="A")
        b = await create_card(db, card_type="Application", name="B")
        rows = [(a, b, WINDOWS["ended"]), (b, a, {})]
        for source, target, lifecycle in rows if ended_first else rows[::-1]:
            await create_relation(
                db,
                type_key="relAppToApp",
                source_id=source.id,
                target_id=target.id,
                lifecycle=lifecycle,
            )
        data = await _get(client, env.admin, self.URL)
        (edge,) = [e for e in data["edges"] if e["type"] == "relAppToApp"]
        assert "lifecycle" not in edge
        assert {edge["source"], edge["target"]} == {str(a.id), str(b.id)}
        # The landscape today keeps the edge too (only the undated row survives).
        today = await _get(client, env.admin, self.URL, in_effect_only="true")
        assert [e for e in today["edges"] if e["type"] == "relAppToApp"] != []


# ── GET /reports/app-portfolio (build_portfolio_payload) ─────────────────────


class TestPortfolioPayload:
    URL = "/api/v1/reports/app-portfolio"

    async def test_each_relation_entry_carries_only_its_own_dates(self, client, db, env):
        await _fan(db)
        data = await _get(client, env.admin, self.URL, type="Application")
        (hub,) = data["items"]
        by_peer = {r["related_name"]: r for r in hub["relations"]}
        assert sorted(by_peer) == sorted(WINDOWS)
        assert "lifecycle" not in by_peer["undated"]
        for name in ("current", "planned", "ended"):
            assert by_peer[name]["lifecycle"] == WINDOWS[name]

    async def test_both_sides_of_a_relation_carry_its_dates(self, client, db, env):
        org = await create_card(db, card_type="Organization", name="Org")
        app = await create_card(db, card_type="Application", name="App")
        await create_relation(
            db,
            type_key="relOrgToApp",
            source_id=org.id,
            target_id=app.id,
            lifecycle=WINDOWS["planned"],
        )
        from_app = await _get(client, env.admin, self.URL, type="Application")
        (rel,) = from_app["items"][0]["relations"]
        assert rel["direction"] == "incoming"
        assert rel["lifecycle"] == WINDOWS["planned"]
        from_org = await _get(client, env.admin, self.URL, type="Organization")
        (rel,) = from_org["items"][0]["relations"]
        assert rel["direction"] == "outgoing"
        assert rel["lifecycle"] == WINDOWS["planned"]

    async def test_a_hidden_related_card_is_still_withheld(self, client, db, env):
        await _fan(db)
        await _hide_it_components_from_the_analyst(db)
        data = await _get(client, env.analyst, self.URL, type="Application")
        assert data["items"][0]["relations"] == []

    async def test_permission_is_unchanged(self, client, env):
        resp = await client.get(self.URL, headers=auth_headers(env.nobody))
        assert resp.status_code == 403


# ── GET /reports/capability-heatmap ──────────────────────────────────────────


class TestCapabilityHeatmap:
    URL = "/api/v1/reports/capability-heatmap"

    async def _cap(self, data, name):
        return next(i for i in data["items"] if i["name"] == name)

    async def test_a_dated_link_carries_its_dates_and_an_undated_one_nothing(self, client, db, env):
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        apps = {}
        for name, lifecycle in WINDOWS.items():
            apps[name] = await create_card(db, card_type="Application", name=name)
            await create_relation(
                db,
                type_key="relCapToApp",
                source_id=cap.id,
                target_id=apps[name].id,
                lifecycle=lifecycle,
            )
        data = await _get(client, env.admin, self.URL)
        item = await self._cap(data, "Cap")
        # Every linked application is listed: the client places it at the date.
        assert sorted(a["name"] for a in item["apps"]) == sorted(WINDOWS)
        assert item["app_link_lifecycles"] == {
            str(apps[name].id): [WINDOWS[name]] for name in ("current", "planned", "ended")
        }

    async def test_an_undated_landscape_carries_no_key(self, client, db, env):
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        app = await create_card(db, card_type="Application", name="App")
        await create_relation(db, type_key="relCapToApp", source_id=cap.id, target_id=app.id)
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        assert "app_link_lifecycles" not in item

    async def test_an_undated_second_link_keeps_the_pair_always_linked(self, client, db, env):
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        app = await create_card(db, card_type="Application", name="App")
        await create_relation(
            db,
            type_key="relCapToApp",
            source_id=cap.id,
            target_id=app.id,
            lifecycle=WINDOWS["ended"],
        )
        await create_relation(db, type_key="relCapToAppAlso", source_id=cap.id, target_id=app.id)
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        assert [a["name"] for a in item["apps"]] == ["App"]
        assert "app_link_lifecycles" not in item

    async def test_two_dated_links_send_both_windows(self, client, db, env):
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        app = await create_card(db, card_type="Application", name="App")
        for key, window in (("relCapToApp", "ended"), ("relCapToAppAlso", "planned")):
            await create_relation(
                db, type_key=key, source_id=cap.id, target_id=app.id, lifecycle=WINDOWS[window]
            )
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        assert sorted(item["app_link_lifecycles"][str(app.id)], key=str) == sorted(
            [WINDOWS["ended"], WINDOWS["planned"]], key=str
        )

    async def test_aggregates_count_only_the_links_in_effect_today(self, client, db, env):
        # The aggregates are what an assistant reads verbatim: a capability
        # counts an application only while a relation linking them is in effect
        # today. Every application keeps its end-of-life date so risk_count
        # follows the same pairs, and costs 100 each.
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        for name, lifecycle in WINDOWS.items():
            app = await create_card(
                db,
                card_type="Application",
                name=name,
                attributes={"costTotalAnnual": 100},
                lifecycle={"endOfLife": "2999-01-01"},
            )
            await create_relation(
                db, type_key="relCapToApp", source_id=cap.id, target_id=app.id, lifecycle=lifecycle
            )
        await self._cost_field(db)
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        assert item["app_count"] == len(COUNTING)
        assert item["risk_count"] == len(COUNTING)
        assert item["total_cost"] == 100 * len(COUNTING)
        # The client still receives every application for its own time travel.
        assert sorted(a["name"] for a in item["apps"]) == sorted(WINDOWS)

    async def test_split_shares_only_between_capabilities_linked_today(self, client, db, env):
        await self._cost_field(db)
        app = await create_card(
            db, card_type="Application", name="App", attributes={"costTotalAnnual": 90}
        )
        caps = {}
        for name, lifecycle in WINDOWS.items():
            caps[name] = await create_card(db, card_type="BusinessCapability", name=name)
            await create_relation(
                db,
                type_key="relCapToApp",
                source_id=caps[name].id,
                target_id=app.id,
                lifecycle=lifecycle,
            )
        data = await _get(client, env.admin, self.URL, metric="total_cost", attribution="split")
        costs = {i["name"]: i["total_cost"] for i in data["items"]}
        # Two capabilities are linked today: each carries half, the others none.
        assert costs == {"undated": 45, "current": 45, "planned": 0, "ended": 0}
        counts = {i["name"]: i["app_count"] for i in data["items"]}
        assert counts == {"undated": 1, "current": 1, "planned": 0, "ended": 0}
        # The denominator the client splits by at another date is unchanged.
        listed = next(i for i in data["items"] if i["name"] == "planned")["apps"][0]
        assert sorted(listed["capability_ids"]) == sorted(str(c.id) for c in caps.values())

    async def test_a_dated_and_an_undated_link_count_the_pair_once(self, client, db, env):
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        app = await create_card(db, card_type="Application", name="App")
        await create_relation(
            db,
            type_key="relCapToApp",
            source_id=cap.id,
            target_id=app.id,
            lifecycle=WINDOWS["ended"],
        )
        await create_relation(db, type_key="relCapToAppAlso", source_id=cap.id, target_id=app.id)
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        assert item["app_count"] == 1

    async def test_filter_maps_carry_the_dates_of_dated_links_only(self, client, db, env):
        # The Capability Map filters applications by related card at the
        # travelled date: per relation-type key and related card, the dates of a
        # link whose every relation is dated ride with the application.
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        app = await create_card(db, card_type="Application", name="App")
        await create_relation(db, type_key="relCapToApp", source_id=cap.id, target_id=app.id)
        orgs = {}
        for name, lifecycle in WINDOWS.items():
            orgs[name] = await create_card(db, card_type="Organization", name=name)
            await create_relation(
                db,
                type_key="relOrgToApp",
                source_id=orgs[name].id,
                target_id=app.id,
                lifecycle=lifecycle,
            )
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        (listed,) = item["apps"]
        # Every related card is still in the maps — the client decides at the date.
        all_orgs = sorted(str(o.id) for o in orgs.values())
        assert listed["related_by_type"]["Organization"] == all_orgs
        assert listed["related_by_rel_type"]["relOrgToApp"] == all_orgs
        assert listed["related_link_lifecycles"] == {
            "relOrgToApp": {
                str(orgs[name].id): [WINDOWS[name]] for name in ("current", "planned", "ended")
            }
        }

    async def test_an_undated_landscape_sends_no_filter_dates(self, client, db, env):
        cap = await create_card(db, card_type="BusinessCapability", name="Cap")
        app = await create_card(db, card_type="Application", name="App")
        org = await create_card(db, card_type="Organization", name="Org")
        await create_relation(db, type_key="relCapToApp", source_id=cap.id, target_id=app.id)
        await create_relation(db, type_key="relOrgToApp", source_id=org.id, target_id=app.id)
        item = await self._cap(await _get(client, env.admin, self.URL), "Cap")
        assert "related_link_lifecycles" not in item["apps"][0]

    async def _cost_field(self, db):
        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        app_type.fields_schema = [
            {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost"}]}
        ]
        await db.flush()

    async def test_permission_is_unchanged(self, client, env):
        resp = await client.get(self.URL, headers=auth_headers(env.nobody))
        assert resp.status_code == 403


# ── a published portal: today only, and no dates ─────────────────────────────


class TestPublicPortalShipsNoDates:
    async def test_relations_in_effect_today_without_their_dates(self, client, db, env):
        db.add(
            WebPortal(
                name="Apps",
                slug="apps",
                card_type="Application",
                is_published=True,
                created_by=env.admin.id,
                card_config={"toggles": {"rel:relAppToITC": {"card": True, "detail": True}}},
            )
        )
        await db.flush()
        await _fan(db)
        resp = await client.get("/api/v1/web-portals/public/apps/cards")
        assert resp.status_code == 200
        (hub,) = resp.json()["items"]
        assert sorted(r["related_name"] for r in hub["relations"]) == COUNTING
        assert all("lifecycle" not in r for r in hub["relations"])
        # Neither the in-effect relation's window nor a hidden one's leaks.
        assert PAST not in resp.text and FUTURE not in resp.text
