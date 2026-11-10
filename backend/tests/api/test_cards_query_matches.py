"""``POST /cards/query/matches``: the cards behind a match, per row and step
(``services/card_query_matches.py``)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

URL = "/api/v1/cards/query/matches"

USES = {"relation": "orgUsesApp", "type": "Application"}
ON = {"relation": "appUsesItc", "type": "ITComponent"}
AFFECTED = {"relation": "initAffectsApp", "type": "Initiative"}
DEPENDS = {"relation": "itcDependsOn__out", "type": "ITComponent"}

#: Organization → Application.
ONE_HOP = {"type": "Organization", "related": [USES]}
#: Organization → Application → IT Component.
TWO_HOPS = {"type": "Organization", "related": [{**USES, "related": [ON]}]}
#: Organization → Application → IT Component → (depends on) IT Component.
THREE_HOPS = {
    "type": "Organization",
    "related": [{**USES, "related": [{**ON, "related": [DEPENDS]}]}],
}


async def build_landscape(db) -> dict:
    """Corp uses Alpha, Beta and the archived Delta; Team uses Gamma; Solo
    uses nothing; the archived Old Corp uses Alpha. Alpha runs on Linux and
    Oracle, Beta on Postgres, Gamma on Linux, Delta on Kernel; Linux depends
    on Kernel. Rocket affects Beta; Alpha calls Beta. Alpha and Postgres are
    APPROVED."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    for key in ("Organization", "Application", "ITComponent", "Initiative"):
        await create_card_type(db, key=key, label=key)
    for key, source, target in (
        ("orgUsesApp", "Organization", "Application"),
        ("appUsesItc", "Application", "ITComponent"),
        ("initAffectsApp", "Initiative", "Application"),
        ("appCallsApp", "Application", "Application"),
        ("itcDependsOn", "ITComponent", "ITComponent"),
    ):
        await create_relation_type(db, key=key, source_type_key=source, target_type_key=target)
    cards: dict[str, Card] = {}
    for name, type_key, extra in (
        ("Corp", "Organization", {}),
        ("Team", "Organization", {}),
        ("Solo", "Organization", {}),
        ("Old Corp", "Organization", {"status": "ARCHIVED"}),
        ("Alpha", "Application", {"approval_status": "APPROVED"}),
        ("Beta", "Application", {}),
        ("Gamma", "Application", {}),
        ("Delta", "Application", {"status": "ARCHIVED"}),
        ("Linux", "ITComponent", {}),
        ("Oracle", "ITComponent", {}),
        ("Postgres", "ITComponent", {"approval_status": "APPROVED"}),
        ("Kernel", "ITComponent", {}),
        ("Rocket", "Initiative", {}),
    ):
        cards[name] = await create_card(db, card_type=type_key, name=name, **extra)
    for type_key, source, target in (
        ("orgUsesApp", "Corp", "Alpha"),
        ("orgUsesApp", "Corp", "Beta"),
        ("orgUsesApp", "Corp", "Delta"),
        ("orgUsesApp", "Team", "Gamma"),
        ("orgUsesApp", "Old Corp", "Alpha"),
        ("appUsesItc", "Alpha", "Linux"),
        ("appUsesItc", "Alpha", "Oracle"),
        ("appUsesItc", "Beta", "Postgres"),
        ("appUsesItc", "Gamma", "Linux"),
        ("appUsesItc", "Delta", "Kernel"),
        ("itcDependsOn", "Linux", "Kernel"),
        ("initAffectsApp", "Rocket", "Beta"),
        ("appCallsApp", "Alpha", "Beta"),
    ):
        await create_relation(
            db, type_key=type_key, source_id=cards[source].id, target_id=cards[target].id
        )
    admin = await create_user(db, email="admin@matches.test", role="admin")
    return {"cards": cards, "admin": admin}


@pytest.fixture
async def land(db):
    return await build_landscape(db)


async def _post(client, user, query, nodes, ids):
    return await client.post(
        URL,
        json={"query": query, "nodes": nodes, "ids": [str(i) for i in ids]},
        headers=auth_headers(user),
    )


def _ids(land, *names):
    return [land["cards"][name].id for name in names]


def _named(land, body) -> dict:
    """``rows`` with the row ids turned into names and each cell into its
    names (``more`` dropped; the cut tests read it themselves)."""
    by_id = {str(card.id): name for name, card in land["cards"].items()}
    return {
        by_id[row_id]: {key: [c["name"] for c in cell["cards"]] for key, cell in cells.items()}
        for row_id, cells in body["rows"].items()
    }


async def _matches(client, land, query, nodes, rows, user=None):
    resp = await _post(client, user or land["admin"], query, nodes, _ids(land, *rows))
    assert resp.status_code == 200, resp.text
    return _named(land, resp.json())


class TestChains:
    async def test_one_hop(self, client, land):
        got = await _matches(client, land, ONE_HOP, ["0:0"], ["Corp", "Team", "Solo"])
        # Delta is archived: never a match. Solo matches nothing: no row.
        assert got == {"Corp": {"0:0": ["Alpha", "Beta"]}, "Team": {"0:0": ["Gamma"]}}

    async def test_the_cell_carries_id_name_and_more(self, client, land):
        resp = await _post(client, land["admin"], ONE_HOP, ["0:0"], _ids(land, "Team"))
        team, gamma = land["cards"]["Team"], land["cards"]["Gamma"]
        assert resp.json() == {
            "rows": {
                str(team.id): {
                    "0:0": {"cards": [{"id": str(gamma.id), "name": "Gamma"}], "more": False}
                }
            }
        }

    async def test_two_hops(self, client, land):
        got = await _matches(client, land, TWO_HOPS, ["0:0", "0:0.0"], ["Corp", "Team"])
        assert got == {
            "Corp": {"0:0": ["Alpha", "Beta"], "0:0.0": ["Linux", "Oracle", "Postgres"]},
            "Team": {"0:0": ["Gamma"], "0:0.0": ["Linux"]},
        }

    async def test_three_hops(self, client, land):
        nodes = ["0:0.0.0", "0:0.0", "0:0"]
        got = await _matches(client, land, THREE_HOPS, nodes, ["Corp", "Team"])
        # Only Linux depends on something, so only Alpha and Gamma carry it;
        # Kernel under the archived Delta does not count.
        assert got == {
            "Corp": {"0:0": ["Alpha"], "0:0.0": ["Linux"], "0:0.0.0": ["Kernel"]},
            "Team": {"0:0": ["Gamma"], "0:0.0": ["Linux"], "0:0.0.0": ["Kernel"]},
        }

    async def test_a_repeated_node_and_row_are_answered_once(self, client, land):
        corp = land["cards"]["Corp"].id
        resp = await _post(client, land["admin"], ONE_HOP, ["0:0", "0:0"], [corp, corp])
        assert _named(land, resp.json()) == {"Corp": {"0:0": ["Alpha", "Beta"]}}

    async def test_a_target_reached_through_two_middle_cards_is_named_once(self, client, db, land):
        """A diamond: Corp → Alpha → Linux and Corp → Beta → Linux."""
        await create_relation(
            db,
            type_key="appUsesItc",
            source_id=land["cards"]["Beta"].id,
            target_id=land["cards"]["Linux"].id,
        )
        got = await _matches(client, land, TWO_HOPS, ["0:0.0"], ["Corp"])
        assert got == {"Corp": {"0:0.0": ["Linux", "Oracle", "Postgres"]}}

    async def test_a_row_the_query_does_not_list_has_no_cells(self, client, land):
        """Alpha is an Application, not a row of an Organization query."""
        got = await _matches(client, land, ONE_HOP, ["0:0"], ["Alpha", "Solo"])
        assert got == {}


class TestRelationTypes:
    async def test_two_relation_types_on_one_card_type_pair_answer_apart(self, client, db, land):
        """Organization → Application by ``orgUsesApp`` and by ``orgOwnsApp``:
        each hop lists only the cards its own relation type reaches."""
        await create_relation_type(
            db, key="orgOwnsApp", source_type_key="Organization", target_type_key="Application"
        )
        for source, target in (("Corp", "Gamma"), ("Team", "Alpha")):
            await create_relation(
                db,
                type_key="orgOwnsApp",
                source_id=land["cards"][source].id,
                target_id=land["cards"][target].id,
            )
        owns = {"relation": "orgOwnsApp", "type": "Application"}
        query = {"type": "Organization", "related": [USES, owns]}
        got = await _matches(client, land, query, ["0:0", "0:1"], ["Corp", "Team"])
        assert got == {
            "Corp": {"0:0": ["Alpha", "Beta"], "0:1": ["Gamma"]},
            "Team": {"0:0": ["Gamma"], "0:1": ["Alpha"]},
        }


class TestSelfReference:
    async def test_the_edge_reads_one_way_only(self, client, land):
        rows = ["Linux", "Kernel"]
        out = {"type": "ITComponent", "related": [DEPENDS]}
        assert await _matches(client, land, out, ["0:0"], rows) == {"Linux": {"0:0": ["Kernel"]}}
        back = {"type": "ITComponent", "related": [{**DEPENDS, "relation": "itcDependsOn__in"}]}
        assert await _matches(client, land, back, ["0:0"], rows) == {"Kernel": {"0:0": ["Linux"]}}

    async def test_a_self_referencing_hop_in_a_chain(self, client, land):
        calls = {"relation": "appCallsApp__out", "type": "Application"}
        query = {"type": "Organization", "related": [{**USES, "related": [calls]}]}
        got = await _matches(client, land, query, ["0:0", "0:0.0"], ["Corp", "Team"])
        assert got == {"Corp": {"0:0": ["Alpha"], "0:0.0": ["Beta"]}}


class TestConditions:
    async def test_a_middle_card_failing_a_sibling_hop_carries_no_match(self, client, land):
        query = {"type": "Organization", "related": [{**USES, "related": [ON, AFFECTED]}]}
        got = await _matches(client, land, query, ["0:0", "0:0.0", "0:0.1"], ["Corp", "Team"])
        # Only Beta is affected by an Initiative.
        assert got == {"Corp": {"0:0": ["Beta"], "0:0.0": ["Postgres"], "0:0.1": ["Rocket"]}}

    async def test_a_middle_card_failing_a_negated_sibling_carries_no_match(self, client, land):
        query = {
            "type": "Organization",
            "related": [{**USES, "related": [ON, {**AFFECTED, "negate": True}]}],
        }
        got = await _matches(client, land, query, ["0:0", "0:0.0"], ["Corp", "Team"])
        assert got == {
            "Corp": {"0:0": ["Alpha"], "0:0.0": ["Linux", "Oracle"]},
            "Team": {"0:0": ["Gamma"], "0:0.0": ["Linux"]},
        }

    async def test_a_sibling_of_the_line_root_stays_on_the_row(self, client, land):
        """A hop beside the path at the first card filters the rows only."""
        query = {
            "type": "Organization",
            "related": [{**USES, "related": [AFFECTED]}, {**USES, "related": [ON]}],
        }
        got = await _matches(client, land, query, ["0:1", "0:1.0"], ["Corp", "Team"])
        assert got == {"Corp": {"0:1": ["Alpha", "Beta"], "0:1.0": ["Linux", "Oracle", "Postgres"]}}

    @pytest.mark.parametrize(
        ("app_where", "itc_where", "expected"),
        [
            # A condition on the middle card.
            (
                {"approval_status": ["APPROVED"]},
                None,
                {"Corp": {"0:0": ["Alpha"], "0:0.0": ["Linux", "Oracle"]}},
            ),
            # The same condition on M instead: a different answer.
            (
                None,
                {"approval_status": ["APPROVED"]},
                {"Corp": {"0:0": ["Beta"], "0:0.0": ["Postgres"]}},
            ),
            # On both: no Application reaches an approved component.
            ({"approval_status": ["APPROVED"]}, {"approval_status": ["APPROVED"]}, {}),
        ],
    )
    async def test_conditions_on_the_middle_card_and_on_m(
        self, client, land, app_where, itc_where, expected
    ):
        itc = {**ON, "where": itc_where} if itc_where else ON
        app = {**USES, "related": [itc], **({"where": app_where} if app_where else {})}
        query = {"type": "Organization", "related": [app]}
        assert await _matches(client, land, query, ["0:0", "0:0.0"], ["Corp", "Team"]) == expected


class TestStacks:
    async def test_all_of_keys_on_the_second_line(self, client, land):
        approved = {**ON, "where": {"approval_status": ["APPROVED"]}}
        query = {
            "all_of": [
                ONE_HOP,
                {"type": "Organization", "related": [{**USES, "related": [approved]}]},
            ]
        }
        got = await _matches(client, land, query, ["0:0", "1:0", "1:0.0"], ["Corp", "Team"])
        # Team fails the second line, so it is no row of the stack.
        assert got == {"Corp": {"0:0": ["Alpha", "Beta"], "1:0": ["Beta"], "1:0.0": ["Postgres"]}}

    async def test_any_of_a_row_has_no_cell_for_a_line_it_does_not_satisfy(self, client, land):
        approved = {**ON, "where": {"approval_status": ["APPROVED"]}}
        query = {
            "any_of": [
                {"type": "Organization", "related": [{**USES, "related": [approved]}]},
                THREE_HOPS,
            ]
        }
        got = await _matches(client, land, query, ["0:0.0", "1:0.0.0"], ["Corp", "Team"])
        assert got == {
            "Corp": {"0:0.0": ["Postgres"], "1:0.0.0": ["Kernel"]},
            "Team": {"1:0.0.0": ["Kernel"]},
        }

    async def test_any_of_numbers_the_lines_across_groups(self, client, land):
        query = {"any_of": [{"all_of": [ONE_HOP, ONE_HOP]}, TWO_HOPS]}
        got = await _matches(client, land, query, ["2:0.0", "1:0"], ["Team"])
        assert got == {"Team": {"1:0": ["Gamma"], "2:0.0": ["Linux"]}}
        resp = await _post(client, land["admin"], query, ["3:0"], _ids(land, "Team"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_node"


class TestStatus:
    async def test_an_archived_row_still_gets_its_cells(self, client, land):
        got = await _matches(client, land, TWO_HOPS, ["0:0", "0:0.0"], ["Old Corp"])
        assert got == {"Old Corp": {"0:0": ["Alpha"], "0:0.0": ["Linux", "Oracle"]}}

    async def test_an_archived_middle_or_target_card_is_never_a_match(self, client, db, land):
        land["cards"]["Alpha"].status = "ARCHIVED"
        land["cards"]["Postgres"].status = "ARCHIVED"
        await db.flush()
        got = await _matches(client, land, TWO_HOPS, ["0:0", "0:0.0"], ["Corp", "Team", "Old Corp"])
        # Alpha (middle) takes Linux and Oracle with it; Postgres (target)
        # leaves Beta with nothing below it, so Corp no longer matches.
        assert got == {"Team": {"0:0": ["Gamma"], "0:0.0": ["Linux"]}}


class TestCut:
    @pytest.fixture
    async def many(self, db, land):
        """Big uses 101 Applications, Even the first 100 of them, Pair two
        Applications both named Twin."""
        for name in ("Big", "Even", "Pair"):
            land["cards"][name] = await create_card(db, card_type="Organization", name=name)
        for n in range(1, 102):
            app = await create_card(db, card_type="Application", name=f"Item {n:03d}")
            land["cards"][app.name] = app
            await create_relation(
                db, type_key="orgUsesApp", source_id=land["cards"]["Big"].id, target_id=app.id
            )
            if n <= 100:
                await create_relation(
                    db, type_key="orgUsesApp", source_id=land["cards"]["Even"].id, target_id=app.id
                )
        twins = [await create_card(db, card_type="Application", name="Twin") for _ in range(2)]
        for twin in twins:
            await create_relation(
                db, type_key="orgUsesApp", source_id=land["cards"]["Pair"].id, target_id=twin.id
            )
        return {**land, "twins": twins}

    async def test_101_matches_give_the_first_100_and_more(self, client, many):
        resp = await _post(client, many["admin"], ONE_HOP, ["0:0"], _ids(many, "Big", "Even"))
        rows = resp.json()["rows"]
        big = rows[str(many["cards"]["Big"].id)]["0:0"]
        assert [c["name"] for c in big["cards"]] == [f"Item {n:03d}" for n in range(1, 101)]
        assert big["more"] is True
        even = rows[str(many["cards"]["Even"].id)]["0:0"]
        assert len(even["cards"]) == 100
        assert even["more"] is False

    @pytest.fixture
    async def doubled(self, db, land):
        """101 IT Components; Overflow uses two Applications that each run on
        all 101, Hundred two that each run on the first 100: every component
        is reached twice."""
        itcs = [
            await create_card(db, card_type="ITComponent", name=f"Box {n:03d}")
            for n in range(1, 102)
        ]
        for org, count in (("Overflow", 101), ("Hundred", 100)):
            land["cards"][org] = await create_card(db, card_type="Organization", name=org)
            for side in ("A", "B"):
                app = await create_card(db, card_type="Application", name=f"{org} {side}")
                await create_relation(
                    db, type_key="orgUsesApp", source_id=land["cards"][org].id, target_id=app.id
                )
                for itc in itcs[:count]:
                    await create_relation(
                        db, type_key="appUsesItc", source_id=app.id, target_id=itc.id
                    )
        return land

    @pytest.mark.parametrize(("org", "more"), [("Hundred", False), ("Overflow", True)])
    async def test_a_card_reached_twice_counts_once_toward_the_cut(
        self, client, doubled, org, more
    ):
        resp = await _post(client, doubled["admin"], TWO_HOPS, ["0:0.0"], _ids(doubled, org))
        cell = resp.json()["rows"][str(doubled["cards"][org].id)]["0:0.0"]
        assert [c["name"] for c in cell["cards"]] == [f"Box {n:03d}" for n in range(1, 101)]
        assert cell["more"] is more

    async def test_equal_names_are_ordered_by_id(self, client, many):
        resp = await _post(client, many["admin"], ONE_HOP, ["0:0"], _ids(many, "Pair"))
        cell = resp.json()["rows"][str(many["cards"]["Pair"].id)]["0:0"]
        assert [c["id"] for c in cell["cards"]] == sorted(str(t.id) for t in many["twins"])
        assert cell["more"] is False


class TestUnknownNode:
    @pytest.mark.parametrize(
        "key",
        [
            "x",
            "0",  # the first card of a line has no key
            "0:",
            ":0",
            "0:0.",
            "00:0",
            "0:01",
            "-1:0",
            "1:0",  # a missing line
            "0:1",  # a missing hop
            "0:0.1",  # a missing sub-hop
            "0:0.0.0",  # past the end of the line
        ],
    )
    async def test_a_key_that_names_no_node(self, client, land, key):
        resp = await _post(client, land["admin"], TWO_HOPS, ["0:0", key], _ids(land, "Corp"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_node"

    @pytest.mark.parametrize("key", ["0:0", "0:0.0"])
    async def test_a_negated_hop_and_a_hop_below_one(self, client, land, key):
        query = {"type": "Organization", "related": [{**USES, "negate": True, "related": [ON]}]}
        resp = await _post(client, land["admin"], query, [key], _ids(land, "Solo"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_node"

    async def test_a_negated_sibling_has_no_key(self, client, land):
        query = {
            "type": "Organization",
            "related": [{**USES, "related": [ON, {**AFFECTED, "negate": True}]}],
        }
        resp = await _post(client, land["admin"], query, ["0:0.1"], _ids(land, "Corp"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_node"


class TestValidation:
    @pytest.mark.parametrize(
        ("nodes", "ids"),
        [
            ([], 1),
            ([f"0:{i}" for i in range(13)], 1),
            (["0:0"], 0),
            (["0:0"], 10001),
            (["0:" + "0." * 20 + "0"], 1),
        ],
    )
    async def test_sizes_are_refused(self, client, land, nodes, ids):
        resp = await client.post(
            URL,
            json={"query": ONE_HOP, "nodes": nodes, "ids": [str(uuid.uuid4()) for _ in range(ids)]},
            headers=auth_headers(land["admin"]),
        )
        assert resp.status_code == 422

    async def test_the_largest_request_is_accepted(self, client, land):
        ids = [land["cards"]["Corp"].id, *(uuid.uuid4() for _ in range(9999))]
        resp = await _post(client, land["admin"], ONE_HOP, ["0:0"] * 12, ids)
        assert resp.status_code == 200
        assert _named(land, resp.json()) == {"Corp": {"0:0": ["Alpha", "Beta"]}}

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            ({"nope": 1}, "invalid_query"),
            ({"type": "Nowhere"}, "unknown_card_type"),
            (
                {"type": "Organization", "related": [{"relation": "x", "type": "Application"}]},
                "unknown_relation_type",
            ),
        ],
    )
    async def test_a_bad_query_answers_the_list_codes(self, client, land, query, code):
        resp = await _post(client, land["admin"], query, ["0:0"], _ids(land, "Corp"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == code

    async def test_a_hidden_card_type_is_refused(self, client, db, land):
        """The matches statement has no hidden-type filter of its own: a query
        starting from (or stepping to) a hidden type never reaches it."""
        ct = (await db.execute(select(CardType).where(CardType.key == "Organization"))).scalar_one()
        ct.is_hidden = True
        await db.flush()
        resp = await _post(client, land["admin"], ONE_HOP, ["0:0"], _ids(land, "Corp"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card_type"
        back = {
            "type": "Application",
            "related": [{"relation": "orgUsesApp", "type": "Organization"}],
        }
        resp = await _post(client, land["admin"], back, ["0:0"], _ids(land, "Alpha"))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "unknown_card_type"


class TestPermissions:
    async def _reader(self, db, key, permissions):
        await create_role(db, key=key, label=key, permissions=permissions)
        return await create_user(db, email=f"{key}@matches.test", role=key)

    async def _deny(self, db, type_key, overrides):
        ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
        ct.role_permissions = overrides
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

    async def test_403_without_the_inventory(self, client, db, land):
        reader = await self._reader(db, "none", {"inventory.view": False})
        resp = await _post(client, reader, ONE_HOP, ["0:0"], _ids(land, "Corp"))
        assert resp.status_code == 403

    async def test_a_hidden_row_is_absent(self, client, db, land):
        reader = await self._reader(db, "r", {"inventory.view": True})
        await self._deny(db, "Organization", {"r": {"inventory.view": False}})
        resp = await _post(client, reader, ONE_HOP, ["0:0"], _ids(land, "Corp", "Team"))
        assert resp.json() == {"rows": {}}

    async def test_a_hidden_target_is_absent(self, client, db, land):
        reader = await self._reader(db, "r", {"inventory.view": True})
        await self._deny(db, "ITComponent", {"r": {"inventory.view": False}})
        query = {"type": "Organization", "related": [USES]}
        got = await _matches(client, land, query, ["0:0"], ["Corp"], user=reader)
        assert got == {"Corp": {"0:0": ["Alpha", "Beta"]}}
        # The two-hop query lists nothing for this reader: the components
        # are hidden, so no row matches and nothing is named.
        resp = await _post(client, reader, TWO_HOPS, ["0:0.0", "0:0"], _ids(land, "Corp"))
        assert resp.json() == {"rows": {}}
        assert "Linux" not in resp.text

    async def test_a_hidden_middle_card_removes_the_match(self, client, db, land):
        reader = await self._reader(db, "r", {"inventory.view": True})
        await self._deny(db, "Application", {"r": {"inventory.view": False}})
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", permissions={"card.view": True}
        )
        db.add(Stakeholder(card_id=land["cards"]["Beta"].id, user_id=reader.id, role="responsible"))
        await db.flush()
        got = await _matches(
            client, land, TWO_HOPS, ["0:0", "0:0.0"], ["Corp", "Team"], user=reader
        )
        # Beta is held through a stakeholder role and stays; Alpha and Gamma
        # are hidden, so Linux and Oracle (reached only through them) drop.
        assert got == {"Corp": {"0:0": ["Beta"], "0:0.0": ["Postgres"]}}

    async def test_matches_are_read_in_inventory_mode(self, client, db, land):
        """A role holding the inventory only through an Allow cell on
        Organization reads Applications in module mode, not in the
        inventory: the Applications are no match for it."""
        reader = await self._reader(db, "allow", {"inventory.view": False})
        await self._deny(db, "Organization", {"allow": {"inventory.view": True}})
        resp = await _post(client, reader, ONE_HOP, ["0:0"], _ids(land, "Corp"))
        assert resp.status_code == 200
        assert resp.json() == {"rows": {}}

    async def test_more_is_false_when_only_the_101st_is_hidden(self, client, db, land):
        reader = await self._reader(db, "r", {"inventory.view": True})
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", permissions={"card.view": True}
        )
        big = await create_card(db, card_type="Organization", name="Big")
        for n in range(1, 102):
            app = await create_card(db, card_type="Application", name=f"Item {n:03d}")
            await create_relation(db, type_key="orgUsesApp", source_id=big.id, target_id=app.id)
            if n <= 100:
                db.add(Stakeholder(card_id=app.id, user_id=reader.id, role="responsible"))
        await db.flush()
        await self._deny(db, "Application", {"r": {"inventory.view": False}})
        resp = await _post(client, reader, ONE_HOP, ["0:0"], [big.id])
        cell = resp.json()["rows"][str(big.id)]["0:0"]
        assert [c["name"] for c in cell["cards"]] == [f"Item {n:03d}" for n in range(1, 101)]
        assert cell["more"] is False
        assert "Item 101" not in resp.text
        # Control: the admin sees the 101st as ``more``.
        admin = await _post(client, land["admin"], ONE_HOP, ["0:0"], [big.id])
        assert admin.json()["rows"][str(big.id)]["0:0"]["more"] is True


class TestEndOfLife:
    @pytest.fixture
    async def eol(self, db, land, monkeypatch):
        """Linux is linked to an end-of-life nginx cycle; the upstream fetch
        answers from a fixed list and records whether the request's session
        was still in a transaction."""
        from app.services import eol_service

        linux = land["cards"]["Linux"]
        linux.attributes = {"eol_product": "nginx", "eol_cycle": "1.0"}
        await db.flush()
        held: list[bool] = []

        async def fake(products):
            held.append(db.in_transaction())
            cycles = {"nginx": [{"cycle": "1.0", "eol": "2020-01-01", "support": False}]}
            return {p: cycles[p] for p in products if p in cycles}

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake)
        return {**land, "held": held}

    QUERY = {
        "type": "Organization",
        "related": [{**USES, "related": [{**ON, "where": {"eol_status": ["eol"]}}]}],
    }

    async def test_an_eol_condition_on_m(self, client, eol):
        got = await _matches(client, eol, self.QUERY, ["0:0", "0:0.0"], ["Corp", "Team"])
        assert got == {
            "Corp": {"0:0": ["Alpha"], "0:0.0": ["Linux"]},
            "Team": {"0:0": ["Gamma"], "0:0.0": ["Linux"]},
        }
        # The connection was handed back before the outbound fetch.
        assert eol["held"] == [False]

    async def test_eol_view_is_required(self, client, db, eol):
        await create_role(
            db, key="no_eol", label="No EOL", permissions={**MEMBER_PERMISSIONS, "eol.view": False}
        )
        reader = await create_user(db, email="no-eol@matches.test", role="no_eol")
        resp = await _post(client, reader, self.QUERY, ["0:0"], _ids(eol, "Corp"))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "eol_view_required"
        assert eol["held"] == []
        # The same reader asks a query without the condition.
        assert (
            await _post(client, reader, TWO_HOPS, ["0:0"], _ids(eol, "Corp"))
        ).status_code == 200
