"""``card_query_matches``: node keys, cells, the statement, and the property
that the matches at a step are exactly what the query written from that step
lists."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.models.card import Card
from app.services.card_query import (
    CardQueryError,
    ResolvedHop,
    ResolvedNode,
    compile_groups,
    parse_card_query,
    resolve_card_query,
)
from app.services.card_query_matches import (
    MATCH_LIMIT,
    card_query_matches,
    cells,
    match_node,
    match_nodes,
    matches_statement,
    numbered_lines,
)
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_query import RelationSide
from tests.api.test_cards_query_matches import (
    AFFECTED,
    ON,
    TWO_HOPS,
    USES,
    build_landscape,
)


def _node(type_key: str, *hops: ResolvedHop) -> ResolvedNode:
    return ResolvedNode(type_key, None, {}, list(hops))


def _hop(node: ResolvedNode, *, negate: bool = False) -> ResolvedHop:
    return ResolvedHop(RelationSide("rel", True), negate, node)


#: Two groups: [[A → (B → C, not D)], [E, F → G]] — lines 0, 1 and 2.
GROUPS = [
    [_node("A", _hop(_node("B", _hop(_node("C")), _hop(_node("D"), negate=True))))],
    [_node("E"), _node("E", _hop(_node("G")))],
]


class TestNodeKeys:
    def test_lines_are_numbered_across_groups(self):
        lines = numbered_lines(GROUPS)
        assert [line.type for _group, line in lines] == ["A", "E", "E"]
        assert [len(group) for group, _line in lines] == [1, 2, 2]
        assert lines[2][0] is GROUPS[1]

    @pytest.mark.parametrize(
        ("key", "group", "line", "path", "types"),
        [
            ("0:0", 0, 0, (0,), ["B"]),
            ("0:0.0", 0, 0, (0, 0), ["B", "C"]),
            ("2:0", 1, 1, (0,), ["G"]),
        ],
    )
    def test_a_key_names_its_node(self, key, group, line, path, types):
        node = match_node(GROUPS, key)
        assert node.key == key
        assert node.group is GROUPS[group]
        assert node.line is GROUPS[group][line]
        assert node.path == path
        assert [hop.node.type for hop in node.hops()] == types

    @pytest.mark.parametrize(
        "key",
        [
            "",
            "0",
            "0:",
            ":0",
            "0:0.",
            "0.0",
            "00:0",
            "0:00",
            "0:0 ",
            " 0:0",
            "a:0",
            "3:0",  # line 3 does not exist
            "1:0",  # line 1 has no hop
            "0:1",
            "0:0.2",
            "0:0.0.0",
            "0:0.1",  # negated
            "100:0",
        ],
    )
    def test_unknown_node(self, key):
        with pytest.raises(CardQueryError) as exc:
            match_node(GROUPS, key)
        assert exc.value.code == "unknown_node"
        assert exc.value.status == 400

    def test_below_a_negated_hop(self):
        groups = [[_node("A", _hop(_node("B", _hop(_node("C"))), negate=True))]]
        for key in ("0:0", "0:0.0"):
            with pytest.raises(CardQueryError):
                match_node(groups, key)

    def test_two_digit_indices(self):
        hops = [_hop(_node(f"T{i}")) for i in range(11)]
        assert match_node([[_node("A", *hops)]], "0:10").hops()[0].node.type == "T10"

    def test_nodes_are_deduplicated_in_order(self):
        assert [n.key for n in match_nodes(GROUPS, ["2:0", "0:0", "2:0"])] == ["2:0", "0:0"]


class TestCells:
    def test_cards_in_order_and_the_cut(self):
        rows = [("r1", "a", "A"), ("r1", "b", "B"), ("r1", "c", "C"), ("r2", "d", "D")]
        assert cells(rows, 2) == {
            "r1": {"cards": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}], "more": True},
            "r2": {"cards": [{"id": "d", "name": "D"}], "more": False},
        }

    def test_exactly_the_limit_is_not_more(self):
        rows = [("r", "a", "A"), ("r", "b", "B")]
        assert cells(rows, 2)["r"]["more"] is False

    def test_no_limit_keeps_everything(self):
        rows = [("r", str(i), str(i)) for i in range(150)]
        assert len(cells(rows, None)["r"]["cards"]) == 150
        assert cells(rows, None)["r"]["more"] is False

    def test_ids_are_strings(self):
        row_id, card_id = uuid.uuid4(), uuid.uuid4()
        assert cells([(row_id, card_id, "X")], 5) == {
            str(row_id): {"cards": [{"id": str(card_id), "name": "X"}], "more": False}
        }

    def test_the_default_cut_is_100(self):
        assert MATCH_LIMIT == 100


class TestStatement:
    def _target(self):
        side = RelationSide("orgUsesApp", True)
        line = ResolvedNode("Organization", None, {}, [ResolvedHop(side, False, _node("App"))])
        return match_node([[line]], "0:0")

    def test_ten_thousand_ids_travel_as_one_parameter(self):
        scope = SimpleNamespace(where=lambda card, mode: ())
        ids = [uuid.uuid4() for _ in range(10000)]
        statement = matches_statement(self._target(), ids, scope)
        compiled = statement.compile(dialect=postgresql.dialect())
        assert sum(1 for v in compiled.params.values() if v == ids) == 1
        assert len(compiled.params) < 20
        assert "ANY" in str(compiled)

    def test_the_cut_fetches_one_more_and_none_lifts_it(self):
        scope = SimpleNamespace(where=lambda card, mode: ())
        ids = [uuid.uuid4()]
        cut = matches_statement(self._target(), ids, scope, limit=7).compile(
            dialect=postgresql.dialect()
        )
        assert 8 in cut.params.values()
        free = matches_statement(self._target(), ids, scope, limit=None)
        assert "rank <=" not in str(free.compile(dialect=postgresql.dialect()))
        assert "rank <=" in str(cut)


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------


async def _listed(db, raw, scope) -> set[str]:
    """The names ``GET /cards?query=`` lists for ``raw`` (ACTIVE start cards)."""
    groups = await resolve_card_query(db, parse_card_query(raw))
    rows = await db.execute(
        select(Card.name).where(Card.status == "ACTIVE", *compile_groups(groups, scope))
    )
    return set(rows.scalars().all())


async def _union(db, raw, key, scope) -> set[str]:
    """The names of ``key``'s matches over every row ``raw`` lists, uncut."""
    groups = await resolve_card_query(db, parse_card_query(raw))
    rows = await db.execute(
        select(Card.id).where(Card.status == "ACTIVE", *compile_groups(groups, scope))
    )
    ids = list(rows.scalars().all())
    found = await card_query_matches(db, match_nodes(groups, [key]), ids, scope, limit=None)
    return {card["name"] for cells_ in found.values() for card in cells_[key]["cards"]}


#: The same chain written from the far end, by hand.
FROM_ITC = {
    "type": "ITComponent",
    "related": [
        {
            "relation": "appUsesItc",
            "type": "Application",
            "related": [{"relation": "orgUsesApp", "type": "Organization"}],
        }
    ],
}
FROM_APP = {
    "type": "Application",
    "related": [
        {"relation": "orgUsesApp", "type": "Organization"},
        {"relation": "appUsesItc", "type": "ITComponent"},
    ],
}
#: Organization → Application (affected by no Initiative) → IT Component,
#: and the same from each end.
NEGATED = {
    "type": "Organization",
    "related": [{**USES, "related": [ON, {**AFFECTED, "negate": True}]}],
}
NEGATED_FROM_APP = {
    "type": "Application",
    "related": [
        {"relation": "orgUsesApp", "type": "Organization"},
        {"relation": "appUsesItc", "type": "ITComponent"},
        {"relation": "initAffectsApp", "type": "Initiative", "negate": True},
    ],
}
NEGATED_FROM_ITC = {
    "type": "ITComponent",
    "related": [
        {
            "relation": "appUsesItc",
            "type": "Application",
            "related": [
                {"relation": "orgUsesApp", "type": "Organization"},
                {"relation": "initAffectsApp", "type": "Initiative", "negate": True},
            ],
        }
    ],
}


@pytest.mark.parametrize(
    ("query", "key", "reversed_query", "expected"),
    [
        (TWO_HOPS, "0:0.0", FROM_ITC, {"Linux", "Oracle", "Postgres"}),
        (TWO_HOPS, "0:0", FROM_APP, {"Alpha", "Beta", "Gamma"}),
        (NEGATED, "0:0", NEGATED_FROM_APP, {"Alpha", "Gamma"}),
        (NEGATED, "0:0.0", NEGATED_FROM_ITC, {"Linux", "Oracle"}),
    ],
)
async def test_the_matches_are_what_the_query_from_m_lists(
    db, query, key, reversed_query, expected
):
    land = await build_landscape(db)
    scope = await CardReadScope.load(db, land["admin"])
    listed = await _listed(db, reversed_query, scope)
    assert listed == expected
    assert await _union(db, query, key, scope) == listed


async def test_the_service_cuts_and_never_commits(db):
    land = await build_landscape(db)
    groups = await resolve_card_query(db, parse_card_query(TWO_HOPS))
    scope = await CardReadScope.load(db, land["admin"])
    ids = [land["cards"]["Corp"].id]
    found = await card_query_matches(db, match_nodes(groups, ["0:0.0"]), ids, scope, limit=2)
    corp = str(land["cards"]["Corp"].id)
    assert found == {
        corp: {
            "0:0.0": {
                "cards": [
                    {"id": str(land["cards"]["Linux"].id), "name": "Linux"},
                    {"id": str(land["cards"]["Oracle"].id), "name": "Oracle"},
                ],
                "more": True,
            }
        }
    }
    assert db.in_transaction()
