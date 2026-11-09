"""Multi-hop card queries (``services/card_query.py``) and the SQL twin of the
lifecycle phase (``lifecycle.current_lifecycle_phase_sql``).

Every semantic case asserts the exact set of start cards kept, with a control
card that must not match. Integration tests requiring a PostgreSQL test
database; ``TestParse`` / ``TestQueryProblem`` / ``TestViewFields`` /
``TestViewPatch`` need none.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.services.card_query import (
    LIFECYCLE_PHASES,
    MAX_QUERY_CHARS,
    MAX_TOTAL_HOPS,
    CardQuery,
    CardQueryError,
    base_view_filters,
    compile_card_query,
    parse_card_query,
    query_problem,
    resolve_card_query,
    stored_query,
    view_fields_for_query,
    view_patch,
)
from app.services.card_read_scope import CardReadScope
from app.services.lifecycle import current_lifecycle_phase, current_lifecycle_phase_sql
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_tag,
    create_tag_group,
    create_user,
)

TODAY = datetime.now(timezone.utc).date()
PAST = (TODAY - timedelta(days=30)).isoformat()
FUTURE = (TODAY + timedelta(days=30)).isoformat()
TOMORROW = (TODAY + timedelta(days=1)).isoformat()

APP_FIELDS = [
    {
        "section": "Main",
        "fields": [
            {
                "key": "criticality",
                "type": "single_select",
                "options": [{"key": "high"}, {"key": "low"}],
            },
            {"key": "regions", "type": "multiple_select", "options": [{"key": "eu"}]},
            {"key": "cloud", "type": "boolean"},
            {"key": "code", "type": "text"},
        ],
    }
]
INIT_FIELDS = [
    {
        "section": "Main",
        "fields": [
            {
                "key": "initiativeStatus",
                "type": "single_select",
                "options": [{"key": "onTrack"}, {"key": "atRisk"}],
            }
        ],
    }
]
SUBTYPES = [{"key": "business"}, {"key": "micro"}]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _q(start: str = "Organization", *hops: dict, where: dict | None = None) -> dict:
    out: dict = {"type": start}
    if where is not None:
        out["where"] = where
    if hops:
        out["related"] = list(hops)
    return out


def _hop(relation: str, type_: str, *hops: dict, where=None, negate=False) -> dict:
    out: dict = {"relation": relation, "type": type_}
    if where is not None:
        out["where"] = where
    if negate:
        out["negate"] = True
    if hops:
        out["related"] = list(hops)
    return out


async def _names(db, raw: dict, scope: CardReadScope | None = None) -> set[str]:
    query = parse_card_query(raw)
    clauses = await compile_card_query(db, query, scope or CardReadScope.everything())
    rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
    return set(rows.scalars().all())


async def _code(db, raw: dict) -> str:
    with pytest.raises(CardQueryError) as exc:
        await resolve_card_query(db, parse_card_query(raw))
    return exc.value.code


def _parse_code(raw) -> str:
    with pytest.raises(CardQueryError) as exc:
        parse_card_query(raw)
    return exc.value.code


async def _deny(db, type_key: str, role: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {role: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


@pytest.fixture
async def land(db):
    """Organizations, Applications and Initiatives:

    - Corp uses Alpha (active, approved, business, high, cloud "yes"), which
      the on-track initiative Rocket affects;
    - Team uses Beta (only future dates: plan), which the at-risk Drag affects;
    - Lone uses Gamma (active), which nothing affects;
    - Zed uses Old (archived, active), which Rocket affects;
    - Solo uses nothing.
    Alpha calls Beta (self-referencing ``appCallsApp``). ``Ghost`` is a hidden
    type with a relation type from Organization.

    Tags: group Domain (every type) holds Finance (on Alpha) and Sales (on
    Beta); Tier (Application only) holds Gold (on Alpha and Gamma); OrgOnly
    (Organization only) holds Hq (on Corp); Open (restricted to ``[]``, i.e.
    every type) holds Any (on no card).
    """
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application", fields_schema=APP_FIELDS, subtypes=SUBTYPES)
    await create_card_type(db, key="Initiative", fields_schema=INIT_FIELDS)
    await create_card_type(db, key="Ghost", is_hidden=True)
    await create_relation_type(
        db, key="orgUsesApp", source_type_key="Organization", target_type_key="Application"
    )
    await create_relation_type(
        db, key="initAffectsApp", source_type_key="Initiative", target_type_key="Application"
    )
    await create_relation_type(
        db, key="appCallsApp", source_type_key="Application", target_type_key="Application"
    )
    await create_relation_type(
        db, key="orgToGhost", source_type_key="Organization", target_type_key="Ghost"
    )
    await create_relation_type(
        db,
        key="hiddenRel",
        source_type_key="Organization",
        target_type_key="Application",
        is_hidden=True,
    )

    orgs = {
        n: await create_card(db, card_type="Organization", name=n)
        for n in ("Corp", "Team", "Lone", "Zed", "Solo")
    }
    alpha = await create_card(
        db,
        name="Alpha",
        subtype="business",
        approval_status="APPROVED",
        lifecycle={"plan": PAST, "active": PAST},
        attributes={"criticality": "high", "regions": ["eu"], "cloud": "yes", "code": "A1"},
    )
    beta = await create_card(
        db,
        name="Beta",
        subtype="micro",
        lifecycle={"plan": FUTURE},
        attributes={"criticality": "low", "cloud": False},
    )
    gamma = await create_card(db, name="Gamma", lifecycle={"active": PAST}, attributes={})
    old = await create_card(db, name="Old", status="ARCHIVED", lifecycle={"active": PAST})
    rocket = await create_card(
        db, card_type="Initiative", name="Rocket", attributes={"initiativeStatus": "onTrack"}
    )
    drag = await create_card(
        db, card_type="Initiative", name="Drag", attributes={"initiativeStatus": "atRisk"}
    )
    ghost = await create_card(db, card_type="Ghost", name="Spook")

    for org, app in (("Corp", alpha), ("Team", beta), ("Lone", gamma), ("Zed", old)):
        await create_relation(db, type_key="orgUsesApp", source_id=orgs[org].id, target_id=app.id)
    for init, app in ((rocket, alpha), (drag, beta), (rocket, old)):
        await create_relation(db, type_key="initAffectsApp", source_id=init.id, target_id=app.id)
    await create_relation(db, type_key="appCallsApp", source_id=alpha.id, target_id=beta.id)
    await create_relation(db, type_key="orgToGhost", source_id=orgs["Solo"].id, target_id=ghost.id)

    domain = await create_tag_group(db, name="Domain")
    tier = await create_tag_group(db, name="Tier", restrict_to_types=["Application"])
    org_only = await create_tag_group(db, name="OrgOnly", restrict_to_types=["Organization"])
    open_group = await create_tag_group(db, name="Open", restrict_to_types=[])
    tags = {
        "Finance": await create_tag(db, group=domain, name="Finance", cards=[alpha]),
        "Sales": await create_tag(db, group=domain, name="Sales", cards=[beta]),
        "Gold": await create_tag(db, group=tier, name="Gold", cards=[alpha, gamma]),
        "Hq": await create_tag(db, group=org_only, name="Hq", cards=[orgs["Corp"]]),
        "Any": await create_tag(db, group=open_group, name="Any"),
    }
    groups = {"Domain": domain, "Tier": tier, "OrgOnly": org_only, "Open": open_group}
    return {"orgs": orgs, "alpha": alpha, "beta": beta, "tags": tags, "groups": groups}


def _tags(land, *names: str) -> list[str]:
    """The ids of the ``land`` tags ``names``, as a query holds them."""
    return [str(land["tags"][n].id) for n in names]


#: Two arbitrary UUIDs, standing for tag ids in the structural tests.
TAG_1 = "0b7d9a6e-1f1c-4a52-9b8a-3c2d1e0f9a8b"
TAG_2 = "1c8e0b7f-2a2d-4b63-8c9b-4d3e2f1a0b9c"


ALL_ORGS = {"Corp", "Team", "Lone", "Zed", "Solo"}
USES = "orgUsesApp"
AFFECTS = "initAffectsApp"


# ---------------------------------------------------------------------------
# The lifecycle twin
# ---------------------------------------------------------------------------

LIFECYCLES: list[dict | None] = [
    None,
    {},
    {p: None for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")},
    {"active": ""},
    {"active": "not-a-date"},
    {"active": "not-a-date", "plan": PAST},
    {"active": f"{PAST}T10:00:00"},
    {"phaseOut": f"{PAST}T23:59:59+05:00"},
    {"active": f"{FUTURE}T10:00:00"},
    {"active": 0},
    {"phaseIn": 0.0},
    {"active": False},
    {"active": []},
    {"active": {}},
    {"active": 5},
    {"active": True},
    {"active": [1]},
    {"active": {"a": 1}},
    {"plan": FUTURE, "phaseIn": FUTURE},
    {"phaseIn": FUTURE, "endOfLife": FUTURE},
    {"endOfLife": FUTURE},
    {"phaseOut": FUTURE},
    {"active": PAST, "endOfLife": PAST},
    {"plan": PAST, "phaseOut": PAST},
    {"plan": PAST, "phaseIn": PAST},
    {"plan": PAST},
    {"endOfLife": PAST, "active": FUTURE},
    {"plan": FUTURE, "active": PAST},
    {"plan": PAST, "active": TODAY.isoformat()},
    {"plan": PAST, "active": TOMORROW},
    {"plan": "", "phaseIn": FUTURE},
]


class TestLifecycleSql:
    async def _parity(self, db, card_entity) -> dict[str, str | None]:
        await create_card_type(db, key="Application")
        for i, lifecycle in enumerate(LIFECYCLES):
            await create_card(db, name=f"c{i}", lifecycle=lifecycle)
        rows = await db.execute(
            select(card_entity.name, current_lifecycle_phase_sql(card_entity, today=TODAY))
        )
        return dict(rows.all())

    async def test_matches_python_for_every_shape(self, db):
        got = await self._parity(db, Card)
        expected = {f"c{i}": current_lifecycle_phase(lc) for i, lc in enumerate(LIFECYCLES)}
        assert got == expected
        # The matrix reaches every phase and "no phase".
        assert set(expected.values()) == {*LIFECYCLE_PHASES[:-1], None}

    async def test_matches_python_on_an_alias(self, db):
        got = await self._parity(db, aliased(Card))
        expected = {f"c{i}": current_lifecycle_phase(lc) for i, lc in enumerate(LIFECYCLES)}
        assert got == expected

    async def test_today_defaults_to_the_utc_clock(self, db):
        await create_card_type(db, key="Application")
        await create_card(db, name="t", lifecycle={"plan": PAST, "active": TODAY.isoformat()})
        phase = await db.scalar(select(current_lifecycle_phase_sql()).where(Card.name == "t"))
        assert phase == "active"

    async def test_an_explicit_today_moves_the_phase(self, db):
        await create_card_type(db, key="Application")
        await create_card(db, name="t", lifecycle={"plan": PAST, "active": TOMORROW})
        later = TODAY + timedelta(days=2)
        phase = await db.scalar(
            select(current_lifecycle_phase_sql(Card, today=later)).where(Card.name == "t")
        )
        assert phase == "active"

    @pytest.mark.parametrize("phase", LIFECYCLE_PHASES)
    async def test_where_lifecycle_phase_matches_python(self, db, phase):
        await create_card_type(db, key="Application")
        for i, lifecycle in enumerate(LIFECYCLES):
            await create_card(db, name=f"c{i}", lifecycle=lifecycle)
        expected = {
            f"c{i}"
            for i, lc in enumerate(LIFECYCLES)
            if (current_lifecycle_phase(lc) or "none") == phase
        }
        assert expected
        got = await _names(db, _q("Application", where={"lifecycle_phase": [phase]}))
        assert got == expected

    async def test_where_several_phases_is_or(self, db):
        await create_card_type(db, key="Application")
        await create_card(db, name="p", lifecycle={"plan": FUTURE})
        await create_card(db, name="a", lifecycle={"active": PAST})
        await create_card(db, name="n", lifecycle={})
        got = await _names(db, _q("Application", where={"lifecycle_phase": ["plan", "none"]}))
        assert got == {"p", "n"}


# ---------------------------------------------------------------------------
# Parsing and structure (no database)
# ---------------------------------------------------------------------------


class TestParse:
    def test_text_and_object_parse_alike(self):
        raw = _q("Organization", _hop(USES, "Application", where={"subtype": ["micro"]}))
        assert parse_card_query(json.dumps(raw)) == parse_card_query(raw)

    def test_too_long_text(self):
        raw = json.dumps(_q("Organization", where={"attributes": {"code": ["x" * 199] * 50}}))
        assert len(raw) > MAX_QUERY_CHARS
        assert _parse_code(raw) == "query_too_long"

    def test_too_long_object(self):
        raw = _q("Organization", where={"attributes": {"code": ["x" * 199] * 50}})
        assert _parse_code(raw) == "query_too_long"

    def _sized(self, total: int) -> str:
        """A valid query exactly ``total`` characters long."""
        values = ["x" * 180] * 44
        raw = json.dumps(_q("Organization", where={"attributes": {"code": values}}))
        values[-1] = "x" * (180 - (len(raw) - total))
        return json.dumps(_q("Organization", where={"attributes": {"code": values}}))

    def test_at_the_limit_is_accepted(self):
        raw = self._sized(MAX_QUERY_CHARS)
        assert len(raw) == MAX_QUERY_CHARS
        assert parse_card_query(raw).type == "Organization"
        compact = json.loads(raw)
        assert parse_card_query(compact).type == "Organization"

    def test_one_past_the_limit(self):
        raw = self._sized(MAX_QUERY_CHARS + 1)
        assert _parse_code(raw) == "query_too_long"

    def test_a_value_longer_than_a_key_is_a_shape_error(self):
        assert _parse_code(_q("A", where={"attributes": {"code": ["x" * 201]}})) == (
            "invalid_query"
        )

    def test_invalid_json(self):
        assert _parse_code("{not json") == "invalid_query_json"

    @pytest.mark.parametrize(
        "raw",
        [
            [],
            {},
            {"type": "A", "extra": 1},
            {"type": ""},
            {"type": "A", "related": [{"type": "B"}]},
            {"type": "A", "where": {"colour": ["red"]}},
            {"type": "A", "related": [{"relation": "r", "type": "B"}] * 11},
            {"type": "A", "where": {"lifecycle_phase": "active"}},
        ],
    )
    def test_invalid_shape(self, raw):
        assert _parse_code(raw) == "invalid_query"

    def test_ten_sibling_hops_are_accepted(self):
        query = parse_card_query({"type": "A", "related": [{"relation": "r", "type": "B"}] * 10})
        assert len(query.related or []) == 10

    def test_stored_query_leaves_defaults_out(self):
        raw = _q("Organization", _hop(USES, "Application", negate=False))
        assert stored_query(parse_card_query(raw)) == {
            "type": "Organization",
            "related": [{"relation": USES, "type": "Application"}],
        }

    def test_fifty_tags_are_accepted(self):
        tags = [str(uuid.UUID(int=i + 1)) for i in range(50)]
        assert parse_card_query(_q("A", where={"tags": tags})).where.tags == tags

    def test_fifty_one_tags_are_a_shape_error(self):
        tags = [str(uuid.UUID(int=i + 1)) for i in range(51)]
        assert _parse_code(_q("A", where={"tags": tags})) == "invalid_query"

    def test_a_tag_list_must_be_a_list(self):
        assert _parse_code(_q("A", where={"tags": TAG_1})) == "invalid_query"

    def test_stored_query_keeps_tags(self):
        raw = _q("A", _hop("r", "B", where={"tags": [TAG_2]}), where={"tags": [TAG_1]})
        assert stored_query(parse_card_query(raw)) == raw

    def test_stored_query_keeps_negate(self):
        raw = _q("Organization", _hop(USES, "Application", negate=True))
        assert stored_query(parse_card_query(raw))["related"][0]["negate"] is True


class TestQueryProblem:
    def _problem(self, raw: dict) -> str | None:
        return query_problem(CardQuery.model_validate(raw))

    def test_three_levels_are_fine(self):
        raw = _q("A", _hop("r", "B", _hop("r", "C", _hop("r", "D"))))
        assert self._problem(raw) is None

    def test_too_deep(self):
        raw = _q("A", _hop("r", "B", _hop("r", "C", _hop("r", "D", _hop("r", "E")))))
        assert self._problem(raw) == "too_deep"
        assert _parse_code(raw) == "too_deep"

    def test_too_deep_on_a_later_sibling(self):
        deep = _hop("r", "B", _hop("r", "C", _hop("r", "D", _hop("r", "E"))))
        assert self._problem(_q("A", _hop("r", "X"), deep)) == "too_deep"

    def test_twelve_hops_in_all_are_fine(self):
        # Four branches of three nested hops: depth 3, 12 hops in all.
        branch = _hop("r", "B", _hop("r", "C", _hop("r", "D")))
        raw = _q("A", *[branch] * 4)
        assert MAX_TOTAL_HOPS == 12
        assert self._problem(raw) is None

    def test_thirteen_hops_in_all_are_too_many(self):
        branch = _hop("r", "B", _hop("r", "C", _hop("r", "D")))
        raw = _q("A", *[branch] * 4, _hop("r", "X"))
        assert self._problem(raw) == "too_many_hops"
        assert _parse_code(raw) == "too_many_hops"

    def test_nested_siblings_count_toward_the_total(self):
        # One top hop carrying 10 siblings, then grandchildren: 1 + 10 + n.
        def tree(grandchildren: int) -> dict:
            kids = [_hop("r", "C") for _ in range(10)]
            kids[0] = _hop("r", "C", *[_hop("r", "D")] * grandchildren)
            return _q("A", _hop("r", "B", *kids))

        assert self._problem(tree(1)) is None
        assert self._problem(tree(2)) == "too_many_hops"

    def test_holds_an_id(self):
        raw = _q("A", where={"attributes": {"code": ["0b7d9a6e-1f1c-4a52-9b8a-3c2d1e0f9a8b"]}})
        assert self._problem(raw) == "query_holds_an_id"

    def test_holds_an_id_in_a_key(self):
        raw = _q("A", where={"attributes": {"0b7d9a6e-1f1c-4a52-9b8a-3c2d1e0f9a8b": ["x"]}})
        assert self._problem(raw) == "query_holds_an_id"

    @pytest.mark.parametrize(
        "where",
        [
            {"lifecycle_phase": []},
            {"subtype": []},
            {"approval_status": []},
            {"attributes": {"code": []}},
            {"tags": []},
        ],
    )
    def test_empty_values(self, where):
        assert self._problem(_q("A", where=where)) == "empty_values"

    def test_empty_values_at_a_hop(self):
        raw = _q("A", _hop("r", "B", _hop("r", "C", where={"subtype": []})))
        assert self._problem(raw) == "empty_values"

    def test_tag_ids_are_the_one_uuid_allowed(self):
        raw = _q(
            "A",
            _hop("r", "B", _hop("r", "C", where={"tags": [TAG_2, TAG_1]})),
            where={"tags": [TAG_1]},
        )
        assert self._problem(raw) is None
        assert parse_card_query(raw).where.tags == [TAG_1]

    def test_a_card_id_beside_tags_still_holds_an_id(self):
        raw = _q("A", where={"tags": [TAG_1], "attributes": {"code": [TAG_2]}})
        assert self._problem(raw) == "query_holds_an_id"

    def test_a_card_id_at_a_hop_beside_tags_still_holds_an_id(self):
        raw = _q(
            "A",
            _hop("r", "B", where={"subtype": [TAG_2]}),
            where={"tags": [TAG_1]},
        )
        assert self._problem(raw) == "query_holds_an_id"
        nested = _q(
            "A",
            _hop(
                "r",
                "B",
                _hop("r", "C", where={"tags": [TAG_1]}),
                where={"approval_status": [TAG_2]},
            ),
        )
        assert self._problem(nested) == "query_holds_an_id"

    def test_an_attribute_named_tags_is_no_tag_list(self):
        raw = _q("A", where={"attributes": {"tags": [TAG_1]}})
        assert self._problem(raw) == "query_holds_an_id"

    def test_a_uuid_as_a_hop_key_still_holds_an_id(self):
        raw = _q("A", _hop(TAG_2, "B", where={"tags": [TAG_1]}))
        assert self._problem(raw) == "query_holds_an_id"

    def test_unknown_phase(self):
        assert self._problem(_q("A", where={"lifecycle_phase": ["retired"]})) == "unknown_phase"

    def test_unknown_phase_at_a_hop(self):
        raw = _q("A", _hop("r", "B", where={"lifecycle_phase": ["active", "later"]}))
        assert self._problem(raw) == "unknown_phase"

    def test_every_phase_is_known(self):
        assert self._problem(_q("A", where={"lifecycle_phase": list(LIFECYCLE_PHASES)})) is None
        assert LIFECYCLE_PHASES == ("plan", "phaseIn", "active", "phaseOut", "endOfLife", "none")

    def test_an_empty_where_is_fine(self):
        assert self._problem(_q("A", where={})) is None


# ---------------------------------------------------------------------------
# The metamodel
# ---------------------------------------------------------------------------


class TestResolve:
    async def test_a_valid_query_resolves(self, db, land):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                _hop("appCallsApp__out", "Application"),
                _hop(
                    AFFECTS, "Initiative", where={"attributes": {"initiativeStatus": ["onTrack"]}}
                ),
                where={
                    "subtype": ["business", "__empty__"],
                    "attributes": {
                        "criticality": ["high", "__empty__"],
                        "cloud": ["true", "false"],
                        "code": ["anything at all"],
                    },
                },
            ),
        )
        root = await resolve_card_query(db, parse_card_query(raw))
        assert root.type == "Organization"
        app = root.hops[0]
        assert (app.side.relation_type, app.side.card_is_source) == (USES, True)
        assert app.node.field_types["cloud"] == "boolean"
        calls, affects = app.node.hops
        assert (calls.side.relation_type, calls.side.card_is_source) == ("appCallsApp", True)
        assert (affects.side.relation_type, affects.side.card_is_source) == (AFFECTS, False)
        assert affects.node.type == "Initiative"

    async def test_does_not_recheck_the_structure(self, db, land):
        # ``parse_card_query`` is the one place the structural rules run: a
        # query built past it is checked against the metamodel only.
        raw = _q("Organization", where={"lifecycle_phase": []})
        assert _parse_code(raw) == "empty_values"
        root = await resolve_card_query(db, CardQuery.model_validate(raw))
        assert root.type == "Organization"

    async def test_unknown_start_type(self, db, land):
        assert await _code(db, _q("Nope")) == "unknown_card_type"

    async def test_hidden_start_type(self, db, land):
        assert await _code(db, _q("Ghost")) == "unknown_card_type"

    async def test_hidden_hop_type(self, db, land):
        assert await _code(db, _q("Organization", _hop("orgToGhost", "Ghost"))) == (
            "unknown_card_type"
        )

    async def test_unknown_relation_type(self, db, land):
        assert await _code(db, _q("Organization", _hop("nope", "Application"))) == (
            "unknown_relation_type"
        )

    async def test_hidden_relation_type(self, db, land):
        assert await _code(db, _q("Organization", _hop("hiddenRel", "Application"))) == (
            "unknown_relation_type"
        )

    async def test_relation_type_not_touching_the_card(self, db, land):
        assert await _code(db, _q("Initiative", _hop(USES, "Application"))) == (
            "unknown_relation_type"
        )

    async def test_side_suffix_on_a_cross_type_relation(self, db, land):
        assert await _code(db, _q("Organization", _hop(f"{USES}__out", "Application"))) == (
            "unknown_relation_type"
        )

    async def test_relation_side_required(self, db, land):
        assert await _code(db, _q("Application", _hop("appCallsApp", "Application"))) == (
            "relation_side_required"
        )

    async def test_hop_type_mismatch(self, db, land):
        assert await _code(db, _q("Organization", _hop(USES, "Initiative"))) == (
            "hop_type_mismatch"
        )

    async def test_hop_type_mismatch_from_the_target_side(self, db, land):
        assert await _code(db, _q("Application", _hop(USES, "Application"))) == (
            "hop_type_mismatch"
        )

    async def test_unknown_subtype(self, db, land):
        raw = _q("Application", where={"subtype": ["business", "mega"]})
        assert await _code(db, raw) == "unknown_subtype"

    async def test_unknown_field(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"attributes": {"x": ["1"]}}))
        assert await _code(db, raw) == "unknown_field"

    async def test_unknown_select_option(self, db, land):
        raw = _q("Application", where={"attributes": {"criticality": ["high", "mid"]}})
        assert await _code(db, raw) == "unknown_option"

    async def test_unknown_multi_select_option(self, db, land):
        raw = _q("Application", where={"attributes": {"regions": ["us"]}})
        assert await _code(db, raw) == "unknown_option"

    async def test_unknown_boolean_value(self, db, land):
        raw = _q("Application", where={"attributes": {"cloud": ["yes"]}})
        assert await _code(db, raw) == "unknown_option"

    async def test_tag_groups_group_the_tags_and_drop_repeats(self, db, land):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                where={"tags": _tags(land, "Finance", "Gold", "Sales", "Finance")},
            ),
            where={"tags": _tags(land, "Hq", "Any")},
        )
        root = await resolve_card_query(db, parse_card_query(raw))
        t, g = land["tags"], land["groups"]
        assert root.tag_groups == {g["OrgOnly"].id: [t["Hq"].id], g["Open"].id: [t["Any"].id]}
        assert root.hops[0].node.tag_groups == {
            g["Domain"].id: [t["Finance"].id, t["Sales"].id],
            g["Tier"].id: [t["Gold"].id],
        }

    async def test_a_node_without_tags_has_no_tag_groups(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"tags": _tags(land, "Gold")}))
        root = await resolve_card_query(db, parse_card_query(raw))
        assert root.tag_groups == {}
        assert root.hops[0].node.tag_groups == {
            land["groups"]["Tier"].id: [land["tags"]["Gold"].id]
        }

    async def test_an_upper_case_tag_id_resolves(self, db, land):
        raw = _q("Organization", where={"tags": [str(land["tags"]["Hq"].id).upper()]})
        root = await resolve_card_query(db, parse_card_query(raw))
        assert root.tag_groups == {land["groups"]["OrgOnly"].id: [land["tags"]["Hq"].id]}

    async def test_unknown_tag(self, db, land):
        raw = _q("Organization", where={"tags": [*_tags(land, "Hq"), TAG_1]})
        assert await _code(db, raw) == "unknown_tag"

    async def test_a_tag_that_is_no_uuid_is_unknown(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"tags": ["Finance"]}))
        assert await _code(db, raw) == "unknown_tag"

    async def test_unknown_tag_at_a_nested_hop(self, db, land):
        raw = _q(
            "Organization",
            _hop(USES, "Application", _hop(AFFECTS, "Initiative", where={"tags": [TAG_2]})),
        )
        assert await _code(db, raw) == "unknown_tag"

    async def test_tag_not_for_type_at_the_start(self, db, land):
        raw = _q("Organization", where={"tags": _tags(land, "Gold")})
        assert await _code(db, raw) == "tag_not_for_type"

    async def test_tag_not_for_type_at_a_hop(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"tags": _tags(land, "Hq")}))
        assert await _code(db, raw) == "tag_not_for_type"

    async def test_an_open_or_empty_restriction_is_every_type(self, db, land):
        for type_key in ("Organization", "Application", "Initiative"):
            raw = _q(type_key, where={"tags": _tags(land, "Finance", "Any")})
            root = await resolve_card_query(db, parse_card_query(raw))
            assert len(root.tag_groups) == 2

    async def _statements(self, db, monkeypatch, raw) -> list[str]:
        seen: list[str] = []
        execute = db.execute

        async def spy(statement, *args, **kwargs):
            seen.append(str(statement))
            return await execute(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", spy)
        await resolve_card_query(db, parse_card_query(raw))
        return seen

    async def test_a_tagless_query_loads_no_tag(self, db, land, monkeypatch):
        raw = _q("Organization", _hop(USES, "Application", where={"subtype": ["micro"]}))
        seen = await self._statements(db, monkeypatch, raw)
        assert len(seen) == 2
        assert not [s for s in seen if "tag" in s]

    async def test_every_tag_in_the_tree_loads_in_one_query(self, db, land, monkeypatch):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"tags": _tags(land, "Gold")}),
            where={"tags": _tags(land, "Hq")},
        )
        seen = await self._statements(db, monkeypatch, raw)
        assert len(seen) == 3
        assert len([s for s in seen if "tag_groups" in s]) == 1

    async def test_unknown_option_at_a_nested_hop(self, db, land):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                _hop(AFFECTS, "Initiative", where={"attributes": {"initiativeStatus": ["late"]}}),
            ),
        )
        assert await _code(db, raw) == "unknown_option"


# ---------------------------------------------------------------------------
# Semantics
# ---------------------------------------------------------------------------


class TestHopSemantics:
    async def test_no_hop_keeps_every_card_of_the_start_type(self, db, land):
        assert await _names(db, _q("Organization")) == ALL_ORGS

    async def test_one_hop(self, db, land):
        assert await _names(db, _q("Organization", _hop(USES, "Application"))) == {
            "Corp",
            "Team",
            "Lone",
        }

    async def test_one_hop_with_a_where(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"lifecycle_phase": ["active"]}))
        assert await _names(db, raw) == {"Corp", "Lone"}

    async def test_two_hops_with_a_where_at_each(self, db, land):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                _hop(
                    AFFECTS, "Initiative", where={"attributes": {"initiativeStatus": ["onTrack"]}}
                ),
                where={"lifecycle_phase": ["active"]},
            ),
        )
        assert await _names(db, raw) == {"Corp"}

    async def test_the_far_condition_must_hold_on_the_same_chain(self, db, land):
        """Team's app is affected by an at-risk initiative; Corp's by an
        on-track one: each chain is judged on its own cards."""
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                _hop(AFFECTS, "Initiative", where={"attributes": {"initiativeStatus": ["atRisk"]}}),
            ),
        )
        assert await _names(db, raw) == {"Team"}

    async def test_a_where_on_the_start_card(self, db, land):
        raw = _q("Application", where={"approval_status": ["APPROVED"]})
        assert await _names(db, raw) == {"Alpha"}

    async def test_negate(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", negate=True))
        assert await _names(db, raw) == {"Zed", "Solo"}

    async def test_negate_with_a_where(self, db, land):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"lifecycle_phase": ["active"]}, negate=True),
        )
        assert await _names(db, raw) == {"Team", "Zed", "Solo"}

    async def test_sibling_hops_are_and(self, db, land):
        raw = _q(
            "Application",
            _hop(AFFECTS, "Initiative"),
            _hop("appCallsApp__out", "Application"),
        )
        assert await _names(db, raw) == {"Alpha"}
        only_affected = await _names(db, _q("Application", _hop(AFFECTS, "Initiative")))
        assert only_affected == {"Alpha", "Beta"}

    async def test_out_and_in_differ_on_a_self_referencing_type(self, db, land):
        assert await _names(db, _q("Application", _hop("appCallsApp__out", "Application"))) == {
            "Alpha"
        }
        assert await _names(db, _q("Application", _hop("appCallsApp__in", "Application"))) == {
            "Beta"
        }

    async def test_reverse_side_of_a_cross_type_relation(self, db, land):
        raw = _q("Application", _hop(USES, "Organization"))
        assert await _names(db, raw) == {"Alpha", "Beta", "Gamma"}

    async def test_archived_middle_card_breaks_the_chain(self, db, land):
        """Zed uses only the archived Old, which Rocket affects."""
        raw = _q("Organization", _hop(USES, "Application", _hop(AFFECTS, "Initiative")))
        assert await _names(db, raw) == {"Corp", "Team"}

    async def test_a_hidden_type_is_never_a_hop(self, db, land):
        """A card of a hidden type cannot sit in a chain: naming its type is
        refused, so Solo (related only to a Ghost) matches nothing."""
        with pytest.raises(CardQueryError) as exc:
            await _names(db, _q("Organization", _hop("orgToGhost", "Ghost")))
        assert exc.value.code == "unknown_card_type"

    async def test_hiding_a_type_after_saving_refuses_the_query(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", _hop(AFFECTS, "Initiative")))
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.is_hidden = True
        await db.flush()
        with pytest.raises(CardQueryError) as exc:
            await _names(db, raw)
        assert exc.value.code == "unknown_card_type"

    async def test_a_view_denied_middle_card_breaks_the_chain(self, db, land):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        admin = await create_user(db, email="a@t.com", role="admin")
        reader = await create_user(db, email="r@t.com", role="r")
        await _deny(db, "Initiative", "r")
        raw = _q("Organization", _hop(USES, "Application", _hop(AFFECTS, "Initiative")))
        admin_scope = await CardReadScope.load(db, admin)
        reader_scope = await CardReadScope.load(db, reader)
        assert await _names(db, raw, admin_scope) == {"Corp", "Team"}
        assert await _names(db, raw, reader_scope) == set()
        # The first hop alone is still visible to the reader.
        assert await _names(db, _q("Organization", _hop(USES, "Application")), reader_scope) == {
            "Corp",
            "Team",
            "Lone",
        }

    async def test_a_negated_hop_over_a_denied_card_reads_as_absent(self, db, land):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        reader = await create_user(db, email="r@t.com", role="r")
        await _deny(db, "Application", "r")
        scope = await CardReadScope.load(db, reader)
        raw = _q("Organization", _hop(USES, "Application", negate=True))
        assert await _names(db, raw, scope) == ALL_ORGS

    async def test_empty_attribute(self, db, land):
        raw = _q("Application", where={"attributes": {"criticality": ["__empty__"]}})
        assert await _names(db, raw) == {"Gamma"}

    async def test_select_attribute(self, db, land):
        raw = _q("Application", where={"attributes": {"criticality": ["low"]}})
        assert await _names(db, raw) == {"Beta"}

    async def test_multi_select_attribute(self, db, land):
        raw = _q("Application", where={"attributes": {"regions": ["eu"]}})
        assert await _names(db, raw) == {"Alpha"}

    async def test_legacy_boolean_yes(self, db, land):
        raw = _q("Application", where={"attributes": {"cloud": ["true"]}})
        assert await _names(db, raw) == {"Alpha"}
        no = _q("Application", where={"attributes": {"cloud": ["false"]}})
        assert await _names(db, no) == {"Beta"}

    async def test_text_attribute_is_an_exact_match(self, db, land):
        assert await _names(db, _q("Application", where={"attributes": {"code": ["A1"]}})) == {
            "Alpha"
        }
        assert await _names(db, _q("Application", where={"attributes": {"code": ["A"]}})) == set()

    async def test_two_attributes_are_and(self, db, land):
        raw = _q(
            "Application",
            where={"attributes": {"criticality": ["high", "low"], "cloud": ["false"]}},
        )
        assert await _names(db, raw) == {"Beta"}

    async def test_subtype(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"subtype": ["micro"]}))
        assert await _names(db, raw) == {"Team"}

    async def test_empty_subtype(self, db, land):
        raw = _q("Application", where={"subtype": ["__empty__"]})
        assert await _names(db, raw) == {"Gamma"}

    async def test_approval_status_at_a_hop(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"approval_status": ["DRAFT"]}))
        assert await _names(db, raw) == {"Team", "Lone"}

    async def test_unknown_approval_status_matches_nothing(self, db, land):
        raw = _q("Application", where={"approval_status": ["MAYBE"]})
        assert await _names(db, raw) == set()

    async def test_where_keys_are_and(self, db, land):
        raw = _q(
            "Application",
            where={"lifecycle_phase": ["active"], "approval_status": ["DRAFT"]},
        )
        assert await _names(db, raw) == {"Gamma"}

    async def test_tags_in_one_group_are_or(self, db, land):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"tags": _tags(land, "Finance", "Sales")}),
        )
        assert await _names(db, raw) == {"Corp", "Team"}

    async def test_tags_across_groups_are_and(self, db, land):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"tags": _tags(land, "Finance", "Gold")}),
        )
        assert await _names(db, raw) == {"Corp"}

    async def test_one_tag(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"tags": _tags(land, "Gold")}))
        assert await _names(db, raw) == {"Corp", "Lone"}

    async def test_tags_and_another_condition_are_and(self, db, land):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                where={"tags": _tags(land, "Finance", "Sales"), "lifecycle_phase": ["plan"]},
            ),
        )
        assert await _names(db, raw) == {"Team"}

    async def test_tags_on_the_start_card(self, db, land):
        assert await _names(db, _q("Organization", where={"tags": _tags(land, "Hq")})) == {"Corp"}
        raw = _q("Application", where={"tags": _tags(land, "Gold")})
        assert await _names(db, raw) == {"Alpha", "Gamma"}

    async def test_a_tag_no_card_carries_matches_nothing(self, db, land):
        assert await _names(db, _q("Organization", where={"tags": _tags(land, "Any")})) == set()

    async def test_negated_hop_with_tags(self, db, land):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"tags": _tags(land, "Gold")}, negate=True),
        )
        assert await _names(db, raw) == {"Team", "Zed", "Solo"}

    async def test_tags_compile_against_an_alias(self, db, land):
        start = aliased(Card)
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"tags": _tags(land, "Sales", "Finance")}),
            where={"tags": _tags(land, "Hq")},
        )
        clauses = await compile_card_query(
            db, parse_card_query(raw), CardReadScope.everything(), start
        )
        rows = await db.execute(select(start.name).where(start.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Corp"}
        no_start_tag = _q(
            "Organization",
            _hop(USES, "Application", where={"tags": _tags(land, "Sales", "Finance")}),
        )
        clauses = await compile_card_query(
            db, parse_card_query(no_start_tag), CardReadScope.everything(), start
        )
        rows = await db.execute(select(start.name).where(start.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Corp", "Team"}

    async def test_compiles_against_an_alias(self, db, land):
        start = aliased(Card)
        query = parse_card_query(_q("Organization", _hop(USES, "Application")))
        clauses = await compile_card_query(db, query, CardReadScope.everything(), start)
        rows = await db.execute(select(start.name).where(start.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Corp", "Team", "Lone"}


# ---------------------------------------------------------------------------
# Saved views (no database)
# ---------------------------------------------------------------------------

ORG_QUERY = {"type": "Organization", "related": [{"relation": USES, "type": "Application"}]}


def _mismatch(fn) -> None:
    with pytest.raises(CardQueryError) as exc:
        fn()
    assert exc.value.code == "query_type_mismatch"


class TestViewFields:
    def test_fills_in_absent_values(self):
        query = parse_card_query(ORG_QUERY)
        assert view_fields_for_query(query, None, None) == (
            "Organization",
            {"types": ["Organization"]},
        )

    def test_keeps_other_filter_keys(self):
        query = parse_card_query(ORG_QUERY)
        filters = {"types": ["Organization"], "groupBy": "subtype", "search": ""}
        card_type, out = view_fields_for_query(query, "Organization", filters)
        assert card_type == "Organization"
        assert out == filters
        assert out is not filters

    def test_empty_types_are_filled(self):
        query = parse_card_query(ORG_QUERY)
        assert view_fields_for_query(query, None, {"types": []})[1] == {"types": ["Organization"]}

    def test_card_type_mismatch(self):
        query = parse_card_query(ORG_QUERY)
        _mismatch(lambda: view_fields_for_query(query, "Application", None))

    def test_types_mismatch(self):
        query = parse_card_query(ORG_QUERY)
        _mismatch(lambda: view_fields_for_query(query, None, {"types": ["Application"]}))

    def test_types_with_more_than_the_start(self):
        query = parse_card_query(ORG_QUERY)
        filters = {"types": ["Organization", "Application"]}
        _mismatch(lambda: view_fields_for_query(query, None, filters))


class TestViewPatch:
    STORED_FILTERS = {"types": ["Application"], "groupBy": "subtype"}

    def test_null_query_clears_and_touches_nothing_else(self):
        out = view_patch(
            {"query": None, "name": "n"},
            new_query=None,
            current_query=ORG_QUERY,
            current_filters={"types": ["Organization"]},
        )
        assert out == {"query": None, "name": "n"}

    def test_plain_view_patch_is_unchanged(self):
        data = {"name": "n", "filters": {"types": ["Application"]}}
        out = view_patch(data, new_query=None, current_query=None, current_filters=None)
        assert out == data

    def test_new_query_on_another_type_resets_the_stored_facets(self):
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY},
            new_query=new,
            current_query=None,
            current_filters={
                **self.STORED_FILTERS,
                "subtypes": ["business"],
                "groupTree": True,
                "groupTreeLevel": 2,
            },
            current_card_type="Application",
        )
        assert out == {
            "query": stored_query(new),
            "card_type": "Organization",
            "filters": base_view_filters("Organization"),
        }
        assert base_view_filters("Organization") == {
            "types": ["Organization"],
            "search": "",
            "subtypes": [],
            "lifecyclePhases": [],
            "dataQualityMin": None,
            "approvalStatuses": [],
            "showArchived": False,
            "attributes": {},
            "relations": {},
            "tagIds": [],
        }

    def test_another_type_read_from_a_lone_filters_type(self):
        # No stored ``card_type``: the view's one ``filters.types`` entry names it.
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY},
            new_query=new,
            current_query=None,
            current_filters=self.STORED_FILTERS,
        )
        assert out["filters"] == base_view_filters("Organization")

    def test_new_query_on_the_same_type_keeps_the_stored_facets(self):
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY},
            new_query=new,
            current_query=None,
            current_filters={"types": ["Organization"], "groupBy": "subtype", "search": "x"},
            current_card_type="Organization",
        )
        assert out == {
            "query": stored_query(new),
            "card_type": "Organization",
            "filters": {"types": ["Organization"], "groupBy": "subtype", "search": "x"},
        }

    def test_a_view_on_no_single_type_keeps_its_facets(self):
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY},
            new_query=new,
            current_query=None,
            current_filters={"types": ["Application", "Initiative"], "groupBy": "subtype"},
        )
        assert out["filters"] == {"types": ["Organization"], "groupBy": "subtype"}

    def test_sent_filters_win_over_the_reset(self):
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY, "filters": {"groupBy": "name"}},
            new_query=new,
            current_query=None,
            current_filters=self.STORED_FILTERS,
            current_card_type="Application",
        )
        assert out["filters"] == {"groupBy": "name", "types": ["Organization"]}

    def test_new_query_with_a_matching_card_type(self):
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY, "card_type": "Organization"},
            new_query=new,
            current_query=None,
            current_filters=None,
        )
        assert out["card_type"] == "Organization"
        assert out["filters"] == {"types": ["Organization"]}

    def test_new_query_with_a_contradicting_card_type(self):
        new = parse_card_query(ORG_QUERY)
        _mismatch(
            lambda: view_patch(
                {"query": ORG_QUERY, "card_type": "Application"},
                new_query=new,
                current_query=None,
                current_filters=None,
            )
        )

    def test_filters_on_a_query_view_are_checked_against_the_stored_query(self):
        _mismatch(
            lambda: view_patch(
                {"filters": {"types": ["Application"]}},
                new_query=None,
                current_query=ORG_QUERY,
                current_filters={"types": ["Organization"]},
            )
        )

    def test_filters_on_a_query_view_are_pinned(self):
        out = view_patch(
            {"filters": {"groupBy": "name"}},
            new_query=None,
            current_query=ORG_QUERY,
            current_filters={"types": ["Organization"]},
        )
        assert out == {
            "filters": {"groupBy": "name", "types": ["Organization"]},
            "card_type": "Organization",
        }
        assert "query" not in out

    def test_a_rename_of_a_query_view_keeps_the_view_in_sync(self):
        out = view_patch(
            {"name": "n"},
            new_query=None,
            current_query=ORG_QUERY,
            current_filters={"types": ["Organization"], "groupBy": "subtype"},
        )
        assert out == {
            "name": "n",
            "card_type": "Organization",
            "filters": {"types": ["Organization"], "groupBy": "subtype"},
        }
