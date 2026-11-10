"""Multi-hop card queries (``services/card_query.py``) and the SQL twin of the
lifecycle phase (``lifecycle.current_lifecycle_phase_sql``).

Every semantic case asserts the exact set of start cards kept, with a control
card that must not match. Integration tests requiring a PostgreSQL test
database; ``TestParse`` / ``TestQueryProblem`` / ``TestViewFields`` /
``TestViewPatch`` need none.
"""

from __future__ import annotations

import dataclasses
import json
import uuid
from datetime import date, datetime, timedelta, timezone

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
    CardQueryAll,
    CardQueryAny,
    CardQueryError,
    base_view_filters,
    compile_card_query,
    names_cards,
    parse_card_query,
    query_groups,
    query_lines,
    query_problem,
    resolve_card_query,
    start_types,
    stored_card_ids,
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


async def _resolve_root(db, query, **kwargs):
    """The start node of a plain query: ``resolve_card_query``'s ``[[node]]``."""
    return (await resolve_card_query(db, query, **kwargs))[0][0]


async def _code(db, raw: dict) -> str:
    with pytest.raises(CardQueryError) as exc:
        await resolve_card_query(db, parse_card_query(raw))
    return exc.value.code


async def _write_code(db, raw: dict, scope: CardReadScope | None = None) -> str:
    """The code a *write* path (a writer's scope given) answers ``raw`` with."""
    with pytest.raises(CardQueryError) as exc:
        await resolve_card_query(
            db, parse_card_query(raw), read_scope=scope or CardReadScope.everything()
        )
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


#: A reader whose role holds a module permission but not ``inventory.view``,
#: with no per-type cell: module mode reads every card, inventory mode none.
MODULE_ONLY = CardReadScope(
    role_key="module_only",
    wildcard=False,
    base_view=False,
    denied_types=frozenset(),
    allowed_types=frozenset(),
    stakeholder_card_ids=frozenset(),
)


async def _names_on(db, raw: dict, today: date) -> set[str]:
    """``_names`` with the query compiled as of ``today``."""
    clauses = await compile_card_query(
        db, parse_card_query(raw), CardReadScope.everything(), today=today
    )
    rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
    return set(rows.scalars().all())


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
    type with a relation type from Organization. Organization and Application
    are hierarchical (``has_hierarchy``), Initiative is not.

    Tags: group Domain (every type) holds Finance (on Alpha) and Sales (on
    Beta); Tier (Application only) holds Gold (on Alpha and Gamma); OrgOnly
    (Organization only) holds Hq (on Corp); Open (restricted to ``[]``, i.e.
    every type) holds Any (on no card).
    """
    await create_card_type(db, key="Organization", has_hierarchy=True)
    await create_card_type(
        db, key="Application", fields_schema=APP_FIELDS, subtypes=SUBTYPES, has_hierarchy=True
    )
    await create_card_type(db, key="Initiative", fields_schema=INIT_FIELDS, has_hierarchy=False)
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
    # A timestamp on today's date: its DATE (the first ten characters) has
    # arrived, though the full text sorts after "today".
    {"plan": PAST, "active": f"{TODAY.isoformat()}T09:00:00"},
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

    async def test_an_explicit_today_reaches_the_start_card_and_every_hop(self, db, land):
        """Sixty days ago Alpha's dates (thirty days ago) were all ahead, so it
        read as ``plan``; today it is ``active``. ``today`` must reach the
        start card's condition and a hop's alike."""
        early = TODAY - timedelta(days=60)
        start = _q("Application", where={"lifecycle_phase": ["plan"]})
        assert await _names_on(db, start, early) == {"Alpha", "Beta"}
        assert await _names(db, start) == {"Beta"}
        hop = _q("Organization", _hop(USES, "Application", where={"lifecycle_phase": ["plan"]}))
        assert await _names_on(db, hop, early) == {"Corp", "Team"}
        assert await _names(db, hop) == {"Team"}

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

    def _compact_sized(self, total: int) -> dict:
        """A valid query object whose compact JSON is exactly ``total`` long."""
        values = ["x" * 180] * 44

        def size() -> int:
            raw = _q("Organization", where={"attributes": {"code": values}})
            return len(json.dumps(raw, separators=(",", ":")))

        values[-1] = "x" * (180 - (size() - total))
        assert size() == total
        return _q("Organization", where={"attributes": {"code": values}})

    def test_an_object_at_the_limit_is_accepted(self):
        raw = self._compact_sized(MAX_QUERY_CHARS)
        assert parse_card_query(raw).type == "Organization"

    def test_an_object_one_past_the_limit(self):
        assert _parse_code(self._compact_sized(MAX_QUERY_CHARS + 1)) == "query_too_long"

    def test_the_error_carries_its_code_as_its_message(self):
        exc = CardQueryError("query_too_long")
        assert exc.code == "query_too_long"
        assert str(exc) == "query_too_long"

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
            {"data_quality_band": []},
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

    def test_unknown_band(self):
        assert self._problem(_q("A", where={"data_quality_band": ["good"]})) == "unknown_band"

    def test_unknown_band_beside_a_known_one_at_a_hop(self):
        raw = _q("A", _hop("r", "B", where={"data_quality_band": ["complete", "Complete"]}))
        assert self._problem(raw) == "unknown_band"
        assert _parse_code(raw) == "unknown_band"

    def test_every_band_is_known(self):
        raw = _q("A", where={"data_quality_band": ["complete", "partial", "minimal"]})
        assert self._problem(raw) is None
        assert parse_card_query(raw).where.data_quality_band == ["complete", "partial", "minimal"]


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
        root = await _resolve_root(db, parse_card_query(raw))
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
        root = await _resolve_root(db, CardQuery.model_validate(raw))
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
        root = await _resolve_root(db, parse_card_query(raw))
        t, g = land["tags"], land["groups"]
        assert root.tag_groups == {g["OrgOnly"].id: [t["Hq"].id], g["Open"].id: [t["Any"].id]}
        assert root.hops[0].node.tag_groups == {
            g["Domain"].id: [t["Finance"].id, t["Sales"].id],
            g["Tier"].id: [t["Gold"].id],
        }

    async def test_a_node_without_tags_has_no_tag_groups(self, db, land):
        raw = _q("Organization", _hop(USES, "Application", where={"tags": _tags(land, "Gold")}))
        root = await _resolve_root(db, parse_card_query(raw))
        assert root.tag_groups == {}
        assert root.hops[0].node.tag_groups == {
            land["groups"]["Tier"].id: [land["tags"]["Gold"].id]
        }

    async def test_an_upper_case_tag_id_resolves(self, db, land):
        raw = _q("Organization", where={"tags": [str(land["tags"]["Hq"].id).upper()]})
        root = await _resolve_root(db, parse_card_query(raw))
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
            root = await _resolve_root(db, parse_card_query(raw))
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

    async def test_another_relation_type_on_the_same_pair_is_not_the_hop(self, db, land):
        """Solo *owns* Gamma but uses nothing: an ``orgOwnsApp`` row is no
        ``orgUsesApp`` hop, though it joins the same two card types."""
        await create_relation_type(
            db, key="orgOwnsApp", source_type_key="Organization", target_type_key="Application"
        )
        gamma = (await db.execute(select(Card).where(Card.name == "Gamma"))).scalar_one()
        await create_relation(
            db, type_key="orgOwnsApp", source_id=land["orgs"]["Solo"].id, target_id=gamma.id
        )
        assert await _names(db, _q("Organization", _hop(USES, "Application"))) == {
            "Corp",
            "Team",
            "Lone",
        }
        assert await _names(db, _q("Organization", _hop("orgOwnsApp", "Application"))) == {"Solo"}

    async def test_a_relation_row_to_a_card_of_another_type_is_no_hop(self, db, land):
        """A mis-typed ``orgUsesApp`` row (a bad import: Solo "uses" the
        initiative Rocket) does not make Solo an organization using an
        application."""
        rocket = (await db.execute(select(Card).where(Card.name == "Rocket"))).scalar_one()
        await create_relation(
            db, type_key=USES, source_id=land["orgs"]["Solo"].id, target_id=rocket.id
        )
        assert await _names(db, _q("Organization", _hop(USES, "Application"))) == {
            "Corp",
            "Team",
            "Lone",
        }

    async def test_a_hop_needs_inventory_not_module_reading(self, db, land):
        """A hop's far card is read in inventory mode: a reader who may read
        every card in module mode but none in the inventory gets no chain."""
        raw = _q("Organization", _hop(USES, "Application"))
        assert MODULE_ONLY.readable(land["alpha"].id, "Application", mode="module") is True
        assert await _names(db, raw) == {"Corp", "Team", "Lone"}
        assert await _names(db, raw, MODULE_ONLY) == set()

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
# Data-quality bands (``where.data_quality_band``)
# ---------------------------------------------------------------------------


@pytest.fixture
async def scores(db):
    """Applications on each side of every band edge, and Organizations using
    them: ``OrgMinimal`` uses ``Dq39``, ``OrgPartial`` uses ``Dq40``,
    ``OrgComplete`` uses ``Dq80``, ``OrgArchived`` uses only the archived
    ``Dq90``, ``OrgNone`` uses nothing. ``Unscored`` keeps the default score."""
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    await create_relation_type(
        db, key=USES, source_type_key="Organization", target_type_key="Application"
    )
    apps = {
        name: await create_card(db, name=name, data_quality=score)
        for name, score in (
            ("Dq0", 0.0),
            ("Dq39", 39.9),
            ("Dq40", 40.0),
            ("Dq79", 79.9),
            ("Dq80", 80.0),
        )
    }
    await create_card(db, name="Unscored")
    apps["Dq90"] = await create_card(db, name="Dq90", data_quality=90.0, status="ARCHIVED")
    for org, app in (
        ("OrgMinimal", "Dq39"),
        ("OrgPartial", "Dq40"),
        ("OrgComplete", "Dq80"),
        ("OrgArchived", "Dq90"),
    ):
        card = await create_card(db, card_type="Organization", name=org)
        await create_relation(db, type_key=USES, source_id=card.id, target_id=apps[app].id)
    await create_card(db, card_type="Organization", name="OrgNone")


class TestDataQualityBand:
    @pytest.mark.parametrize(
        ("bands", "expected"),
        [
            (["complete"], {"Dq80"}),
            (["partial"], {"Dq40", "Dq79"}),
            (["minimal"], {"Dq0", "Dq39", "Unscored"}),
            (["complete", "minimal"], {"Dq80", "Dq0", "Dq39", "Unscored"}),
            (["partial", "complete"], {"Dq40", "Dq79", "Dq80"}),
        ],
    )
    async def test_at_the_start_card(self, db, scores, bands, expected):
        raw = _q("Application", where={"data_quality_band": bands})
        assert await _names(db, raw) == expected

    @pytest.mark.parametrize(
        ("bands", "expected"),
        [
            (["complete"], {"OrgComplete"}),
            (["partial"], {"OrgPartial"}),
            (["minimal"], {"OrgMinimal"}),
            (["minimal", "complete"], {"OrgMinimal", "OrgComplete"}),
        ],
    )
    async def test_at_a_hop(self, db, scores, bands, expected):
        raw = _q("Organization", _hop(USES, "Application", where={"data_quality_band": bands}))
        assert await _names(db, raw) == expected

    async def test_negated_at_a_hop(self, db, scores):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"data_quality_band": ["minimal"]}, negate=True),
        )
        assert await _names(db, raw) == {"OrgPartial", "OrgComplete", "OrgArchived", "OrgNone"}

    async def test_ands_with_the_other_conditions(self, db, scores):
        raw = _q("Application", where={"data_quality_band": ["partial"], "cards": []})
        assert _parse_code(raw) == "empty_values"
        both = _q(
            "Application",
            where={"data_quality_band": ["minimal"], "approval_status": ["DRAFT"]},
        )
        assert await _names(db, both) == {"Dq0", "Dq39", "Unscored"}
        none = _q(
            "Application",
            where={"data_quality_band": ["minimal"], "approval_status": ["APPROVED"]},
        )
        assert await _names(db, none) == set()

    async def test_compiles_against_an_alias(self, db, scores):
        start = aliased(Card)
        raw = _q("Application", where={"data_quality_band": ["partial"]})
        clauses = await compile_card_query(
            db, parse_card_query(raw), CardReadScope.everything(), start
        )
        rows = await db.execute(select(start.name).where(start.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Dq40", "Dq79"}

    async def test_resolves_without_a_metamodel_lookup(self, db, scores):
        raw = _q("Application", where={"data_quality_band": ["complete"]})
        resolved = await _resolve_root(db, parse_card_query(raw))
        assert resolved.where.data_quality_band == ["complete"]


# ---------------------------------------------------------------------------
# Specific cards (``where.cards``, ``include_descendants``)
# ---------------------------------------------------------------------------

#: Two arbitrary UUIDs, standing for card ids in the structural tests.
CARD_1 = "2d9f1c80-3b3e-4c74-9dac-5e4f30b1c0da"
CARD_2 = "3e0a2d91-4c4f-4d85-8ebd-6f5041c2d1eb"


class TestCardPickStructure:
    def _problem(self, raw: dict) -> str | None:
        return query_problem(CardQuery.model_validate(raw))

    def test_card_ids_are_kept_verbatim_at_every_node(self):
        raw = _q(
            "A",
            _hop("r", "B", where={"cards": [CARD_2.upper(), CARD_1]}),
            where={"cards": [CARD_1], "include_descendants": True, "tags": [TAG_1]},
        )
        assert self._problem(raw) is None
        assert stored_query(parse_card_query(raw)) == raw

    def test_include_descendants_off_is_left_out_of_the_stored_query(self):
        raw = _q("A", where={"cards": [CARD_1], "include_descendants": False})
        assert stored_query(parse_card_query(raw)) == _q("A", where={"cards": [CARD_1]})
        assert parse_card_query(raw).where.include_descendants is False

    def test_fifty_cards_are_accepted(self):
        cards = [str(uuid.UUID(int=i + 1)) for i in range(50)]
        assert parse_card_query(_q("A", where={"cards": cards})).where.cards == cards

    def test_fifty_one_cards_are_a_shape_error(self):
        cards = [str(uuid.UUID(int=i + 1)) for i in range(51)]
        assert _parse_code(_q("A", where={"cards": cards})) == "invalid_query"

    @pytest.mark.parametrize(
        "where",
        [{"cards": CARD_1}, {"cards": [CARD_1], "include_descendants": [True]}],
    )
    def test_shape_errors(self, where):
        assert _parse_code(_q("A", where=where)) == "invalid_query"

    def test_an_empty_card_list_is_empty_values(self):
        assert self._problem(_q("A", where={"cards": []})) == "empty_values"
        assert _parse_code(_q("A", where={"cards": []})) == "empty_values"

    def test_an_empty_card_list_with_the_flag_is_empty_values(self):
        raw = _q("A", where={"cards": [], "include_descendants": True})
        assert self._problem(raw) == "empty_values"

    def test_the_flag_without_cards(self):
        raw = _q("A", where={"include_descendants": True})
        assert self._problem(raw) == "descendants_without_cards"
        assert _parse_code(raw) == "descendants_without_cards"

    def test_the_flag_without_cards_at_a_nested_hop(self):
        raw = _q(
            "A",
            _hop("r", "B", _hop("r", "C", where={"tags": [TAG_1], "include_descendants": True})),
            where={"cards": [CARD_1], "include_descendants": True},
        )
        assert self._problem(raw) == "descendants_without_cards"

    def test_the_flag_off_without_cards_is_fine(self):
        assert self._problem(_q("A", where={"include_descendants": False})) is None

    def test_a_uuid_in_an_attribute_beside_cards_still_holds_an_id(self):
        raw = _q("A", where={"cards": [CARD_1], "attributes": {"code": [CARD_2]}})
        assert self._problem(raw) == "query_holds_an_id"

    def test_a_uuid_in_a_subtype_at_a_hop_beside_cards_still_holds_an_id(self):
        raw = _q("A", _hop("r", "B", where={"subtype": [CARD_2]}), where={"cards": [CARD_1]})
        assert self._problem(raw) == "query_holds_an_id"

    def test_a_uuid_as_a_hop_key_beside_cards_still_holds_an_id(self):
        raw = _q("A", _hop(CARD_2, "B", where={"cards": [CARD_1]}))
        assert self._problem(raw) == "query_holds_an_id"

    def test_an_attribute_named_cards_is_no_card_list(self):
        raw = _q("A", where={"attributes": {"cards": [CARD_1]}})
        assert self._problem(raw) == "query_holds_an_id"


class TestQueryCardIds:
    def test_names_cards(self):
        assert names_cards(parse_card_query(_q("A", where={"cards": [CARD_1]}))) is True
        nested = _q("A", _hop("r", "B", _hop("s", "C", where={"cards": [CARD_2]})))
        assert names_cards(parse_card_query(nested)) is True
        assert names_cards(parse_card_query(_q("A", _hop("r", "B")))) is False
        tags = _q("A", where={"tags": [TAG_1], "subtype": ["x"]})
        assert names_cards(parse_card_query(tags)) is False

    def test_stored_card_ids_walks_past_a_malformed_node(self):
        # The walk pops from the end: the junk hop is met first, the valid one after.
        stored = {"type": "A", "related": [{"where": {"cards": [CARD_2]}}, "junk"]}
        assert stored_card_ids(stored) == {uuid.UUID(CARD_2)}

    def test_stored_card_ids_walks_every_node(self):
        stored = _q(
            "A",
            _hop("r", "B", _hop("s", "C", where={"cards": [CARD_2.upper()]})),
            where={"cards": [CARD_1, "junk"], "tags": [TAG_1]},
        )
        assert stored_card_ids(stored) == {uuid.UUID(CARD_1), uuid.UUID(CARD_2)}

    @pytest.mark.parametrize(
        "stored",
        [
            None,
            "junk",
            {"type": "A"},
            {"type": "A", "where": "junk", "related": "junk"},
            {"type": "A", "where": {"cards": "junk"}},
            {"type": "A", "related": ["junk", None, {"where": None}]},
        ],
    )
    def test_stored_card_ids_tolerates_a_malformed_query(self, stored):
        assert stored_card_ids(stored) == set()


@pytest.fixture
async def picks(db, land):
    """On top of ``land``: Child (under Corp) uses Alpha, Grand (under Child)
    uses Module; the application Suite is the parent of Module, which Team also
    uses; nobody uses Suite itself. Returns ``{name: card id as text}`` for
    every card."""
    corp = land["orgs"]["Corp"]
    child = await create_card(db, card_type="Organization", name="Child", parent_id=corp.id)
    grand = await create_card(db, card_type="Organization", name="Grand", parent_id=child.id)
    suite = await create_card(db, name="Suite", lifecycle={"active": PAST})
    module = await create_card(db, name="Module", parent_id=suite.id)
    for org, app in (
        (child, land["alpha"]),
        (grand, module),
        (land["orgs"]["Team"], module),
    ):
        await create_relation(db, type_key=USES, source_id=org.id, target_id=app.id)
    rows = await db.execute(select(Card.name, Card.id))
    return {name: str(card_id) for name, card_id in rows.all()}


PICK_ORGS = ALL_ORGS | {"Child", "Grand"}


async def _reader_scope(db, denied: str) -> CardReadScope:
    """The scope of a reader whose role denies View on ``denied``."""
    await create_role(db, key="r", label="R", permissions={"inventory.view": True})
    reader = await create_user(db, email="r@t.com", role="r")
    await _deny(db, denied, "r")
    return await CardReadScope.load(db, reader)


class TestCardPickResolve:
    async def test_picks_resolve_deduplicated_in_order(self, db, picks):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                where={
                    "cards": [picks["Beta"], picks["Alpha"], picks["Beta"].upper()],
                    "include_descendants": True,
                },
            ),
            where={"cards": [picks["Corp"]]},
        )
        root = await _resolve_root(db, parse_card_query(raw))
        assert root.card_ids == [uuid.UUID(picks["Corp"])]
        assert root.include_descendants is False
        app = root.hops[0].node
        assert app.card_ids == [uuid.UUID(picks["Beta"]), uuid.UUID(picks["Alpha"])]
        assert app.include_descendants is True

    async def test_a_node_without_cards_has_none(self, db, picks):
        root = await _resolve_root(db, parse_card_query(_q("Organization")))
        assert root.card_ids == []
        assert root.include_descendants is False

    async def test_an_archived_pick_resolves(self, db, picks):
        raw = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Old"]]}))
        root = await _resolve_root(db, parse_card_query(raw))
        assert root.hops[0].node.card_ids == [uuid.UUID(picks["Old"])]

    async def test_a_card_that_does_not_exist(self, db, picks):
        raw = _q("Organization", where={"cards": [picks["Corp"], CARD_1]})
        assert await _write_code(db, raw) == "unknown_card"

    async def test_a_card_that_is_no_uuid(self, db, picks):
        raw = _q("Organization", _hop(USES, "Application", where={"cards": ["Alpha"]}))
        assert await _write_code(db, raw) == "unknown_card"

    async def test_a_card_of_another_type(self, db, picks):
        raw = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Corp"]]}))
        assert await _write_code(db, raw) == "unknown_card"

    async def test_a_card_of_a_hidden_type_at_a_visible_node(self, db, picks):
        raw = _q("Organization", where={"cards": [picks["Spook"]]})
        assert await _write_code(db, raw) == "unknown_card"

    async def test_a_card_hidden_from_the_writer_is_unknown(self, db, picks):
        scope = await _reader_scope(db, "Application")
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"cards": [picks["Alpha"]]}),
            where={"cards": [picks["Corp"]]},
        )
        query = parse_card_query(raw)
        with pytest.raises(CardQueryError) as exc:
            await resolve_card_query(db, query, read_scope=scope)
        assert exc.value.code == "unknown_card"
        # Without a scope — the evaluation paths — the same query resolves.
        root = await _resolve_root(db, query)
        assert root.hops[0].node.card_ids == [uuid.UUID(picks["Alpha"])]

    async def test_a_card_readable_by_the_writer_resolves_with_their_scope(self, db, picks):
        scope = await _reader_scope(db, "Application")
        raw = _q("Organization", where={"cards": [picks["Corp"], picks["Team"]]})
        root = await _resolve_root(db, parse_card_query(raw), read_scope=scope)
        assert root.card_ids == [uuid.UUID(picks["Corp"]), uuid.UUID(picks["Team"])]

    async def test_a_stakeholder_reads_a_card_of_a_denied_type(self, db, picks):
        scope = dataclasses.replace(
            await _reader_scope(db, "Application"),
            stakeholder_card_ids=frozenset({uuid.UUID(picks["Alpha"])}),
        )
        ok = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Alpha"]]}))
        root = await _resolve_root(db, parse_card_query(ok), read_scope=scope)
        assert root.hops[0].node.card_ids == [uuid.UUID(picks["Alpha"])]
        hidden = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Beta"]]}))
        with pytest.raises(CardQueryError) as exc:
            await resolve_card_query(db, parse_card_query(hidden), read_scope=scope)
        assert exc.value.code == "unknown_card"

    async def _statements(self, db, monkeypatch, raw, scope=None) -> list[str]:
        seen: list[str] = []
        execute = db.execute

        async def spy(statement, *args, **kwargs):
            seen.append(str(statement))
            return await execute(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", spy)
        await resolve_card_query(db, parse_card_query(raw), read_scope=scope)
        return seen

    async def test_a_query_naming_no_card_loads_no_card(self, db, picks, monkeypatch):
        raw = _q("Organization", _hop(USES, "Application", where={"subtype": ["micro"]}))
        for scope in (None, CardReadScope.everything()):
            seen = await self._statements(db, monkeypatch, raw, scope)
            assert len(seen) == 2
            assert not [s for s in seen if "FROM cards" in s]
            monkeypatch.undo()

    async def test_the_evaluation_path_loads_no_card_even_with_picks(self, db, picks, monkeypatch):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"cards": [picks["Alpha"], CARD_1]}),
            where={"cards": [picks["Corp"]]},
        )
        seen = await self._statements(db, monkeypatch, raw)
        assert len(seen) == 2
        assert not [s for s in seen if "FROM cards" in s]

    async def test_every_card_in_the_tree_loads_in_one_query(self, db, picks, monkeypatch):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"cards": [picks["Alpha"], picks["Beta"]]}),
            where={"cards": [picks["Corp"]]},
        )
        seen = await self._statements(db, monkeypatch, raw, CardReadScope.everything())
        assert len(seen) == 3
        loads = [s for s in seen if "FROM cards" in s]
        assert len(loads) == 1
        assert "status" not in loads[0]

    @pytest.mark.parametrize("pick", ["missing", "not-a-uuid", "Corp", "Spook"])
    async def test_the_evaluation_path_checks_no_pick(self, db, picks, pick):
        """No scope, no check: the pick is kept (a non-UUID dropped) and it
        is SQL that matches nothing."""
        value = {"missing": CARD_1, "not-a-uuid": "Alpha"}.get(pick) or picks[pick]
        raw = _q("Organization", _hop(USES, "Application", where={"cards": [value]}))
        root = await _resolve_root(db, parse_card_query(raw))
        expected = [] if pick == "not-a-uuid" else [uuid.UUID(value)]
        assert root.hops[0].node.card_ids == expected

    async def test_a_pick_needs_inventory_not_module_reading(self, db, picks):
        """A writer checks a pick in inventory mode: one who may read every card
        in module mode but none in the inventory cannot pin a card."""
        raw = _q("Organization", where={"cards": [picks["Corp"]]})
        assert MODULE_ONLY.readable(uuid.UUID(picks["Corp"]), "Organization", mode="module")
        assert await _write_code(db, raw, MODULE_ONLY) == "unknown_card"
        resolved = await _resolve_root(
            db, parse_card_query(raw), read_scope=CardReadScope.everything()
        )
        assert resolved.card_ids == [uuid.UUID(picks["Corp"])]

    async def test_a_trusted_pick_skips_the_scope_check_only(self, db, picks):
        scope = await _reader_scope(db, "Application")
        alpha = uuid.UUID(picks["Alpha"])
        raw = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Alpha"]]}))
        root = await _resolve_root(
            db, parse_card_query(raw), read_scope=scope, trusted_card_ids=[alpha]
        )
        assert root.hops[0].node.card_ids == [alpha]
        # Another hidden pick beside it is still refused.
        both = _q(
            "Organization",
            _hop(USES, "Application", where={"cards": [picks["Alpha"], picks["Beta"]]}),
        )
        with pytest.raises(CardQueryError) as exc:
            await resolve_card_query(
                db, parse_card_query(both), read_scope=scope, trusted_card_ids=[alpha]
            )
        assert exc.value.code == "unknown_card"
        # Trust never excuses a missing card or one of another type.
        for value in (CARD_1, picks["Corp"]):
            bad = _q("Organization", _hop(USES, "Application", where={"cards": [value]}))
            with pytest.raises(CardQueryError) as exc:
                await resolve_card_query(
                    db,
                    parse_card_query(bad),
                    read_scope=scope,
                    trusted_card_ids=[uuid.UUID(value)],
                )
            assert exc.value.code == "unknown_card"


class TestDescendantsNeedAHierarchy:
    async def test_on_a_type_without_hierarchy(self, db, picks):
        raw = _q(
            "Application",
            _hop(
                AFFECTS,
                "Initiative",
                where={"cards": [picks["Rocket"]], "include_descendants": True},
            ),
        )
        assert await _code(db, raw) == "descendants_without_hierarchy"
        assert await _write_code(db, raw) == "descendants_without_hierarchy"

    async def test_on_an_application_once_it_has_no_hierarchy(self, db, picks):
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.has_hierarchy = False
        await db.flush()
        raw = _q(
            "Organization",
            _hop(
                USES, "Application", where={"cards": [picks["Suite"]], "include_descendants": True}
            ),
        )
        assert await _code(db, raw) == "descendants_without_hierarchy"
        # Without the flag the same pick resolves.
        off = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Suite"]]}))
        root = await _resolve_root(db, parse_card_query(off))
        assert root.hops[0].node.card_ids == [uuid.UUID(picks["Suite"])]

    async def test_on_the_start_card(self, db, picks):
        ct = (await db.execute(select(CardType).where(CardType.key == "Organization"))).scalar_one()
        ct.has_hierarchy = False
        await db.flush()
        raw = _q("Organization", where={"cards": [picks["Corp"]], "include_descendants": True})
        assert await _code(db, raw) == "descendants_without_hierarchy"

    async def test_on_a_hierarchical_type_resolves(self, db, picks):
        raw = _q("Organization", where={"cards": [picks["Corp"]], "include_descendants": True})
        root = await _resolve_root(db, parse_card_query(raw))
        assert root.include_descendants is True
        assert root.card_ids == [uuid.UUID(picks["Corp"])]


class TestCardPickSemantics:
    async def test_orgs_using_one_of_the_picked_apps(self, db, picks):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"cards": [picks["Alpha"], picks["Beta"]]}),
        )
        assert await _names(db, raw) == {"Corp", "Team", "Child"}

    async def test_a_pick_on_the_start_card(self, db, picks):
        raw = _q("Organization", where={"cards": [picks["Corp"], picks["Zed"]]})
        assert await _names(db, raw) == {"Corp", "Zed"}

    async def test_a_start_pick_meets_the_chain(self, db, picks):
        """Zed uses only the archived Old."""
        raw = _q(
            "Organization",
            _hop(USES, "Application"),
            where={"cards": [picks["Corp"], picks["Zed"]]},
        )
        assert await _names(db, raw) == {"Corp"}

    async def test_include_descendants_at_the_start(self, db, picks):
        on = _q("Organization", where={"cards": [picks["Corp"]], "include_descendants": True})
        assert await _names(db, on) == {"Corp", "Child", "Grand"}
        off = _q("Organization", where={"cards": [picks["Corp"]]})
        assert await _names(db, off) == {"Corp"}

    async def test_include_descendants_stays_in_the_picked_tree(self, db, picks):
        """Stray sits under Solo, in another tree: Corp's descendants never
        include it."""
        solo = uuid.UUID(picks["Solo"])
        await create_card(db, card_type="Organization", name="Stray", parent_id=solo)
        on = _q("Organization", where={"cards": [picks["Corp"]], "include_descendants": True})
        assert await _names(db, on) == {"Corp", "Child", "Grand"}
        around = _q("Organization", where={"cards": [picks["Solo"]], "include_descendants": True})
        assert await _names(db, around) == {"Solo", "Stray"}

    async def test_include_descendants_from_a_middle_card(self, db, picks):
        raw = _q("Organization", where={"cards": [picks["Child"]], "include_descendants": True})
        assert await _names(db, raw) == {"Child", "Grand"}

    async def test_include_descendants_at_a_hop(self, db, picks):
        on = _q(
            "Organization",
            _hop(
                USES, "Application", where={"cards": [picks["Suite"]], "include_descendants": True}
            ),
        )
        assert await _names(db, on) == {"Team", "Grand"}
        off = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Suite"]]}))
        assert await _names(db, off) == set()

    async def test_two_flagged_nodes_in_one_tree(self, db, picks):
        """Corp's subtree is {Corp, Child, Grand}; Suite's users (through
        Module) are {Team, Grand}: only Grand is in both."""
        raw = _q(
            "Organization",
            _hop(
                USES, "Application", where={"cards": [picks["Suite"]], "include_descendants": True}
            ),
            where={"cards": [picks["Corp"]], "include_descendants": True},
        )
        assert await _names(db, raw) == {"Grand"}

    async def test_an_archived_pick_at_a_hop_matches_nothing(self, db, picks):
        raw = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Old"]]}))
        assert await _names(db, raw) == set()

    async def test_negate_with_cards(self, db, picks):
        raw = _q(
            "Organization",
            _hop(USES, "Application", where={"cards": [picks["Alpha"]]}, negate=True),
        )
        assert await _names(db, raw) == PICK_ORGS - {"Corp", "Child"}

    async def test_cards_and_another_condition_are_and(self, db, picks):
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                where={"cards": [picks["Alpha"], picks["Beta"]], "lifecycle_phase": ["plan"]},
            ),
        )
        assert await _names(db, raw) == {"Team"}

    async def test_a_pick_hidden_from_the_reader_narrows_by_the_hop_scope(self, db, picks):
        scope = await _reader_scope(db, "Application")
        raw = _q("Organization", _hop(USES, "Application", where={"cards": [picks["Alpha"]]}))
        assert await _names(db, raw, scope) == set()
        assert await _names(db, raw) == {"Corp", "Child"}

    async def test_unknown_wrong_type_and_hidden_picks_read_alike(self, db, picks):
        """No existence oracle: for a reader who cannot see Applications, a
        pick naming no card, a card of another type and a hidden card give
        the same answer — and at the start card, the same narrowed rows."""
        scope = await _reader_scope(db, "Application")
        answers = {}
        for label, value in (
            ("missing", CARD_1),
            ("wrong type", picks["Corp"]),
            ("hidden", picks["Alpha"]),
            ("no uuid", "Alpha"),
        ):
            hop = _q("Organization", _hop(USES, "Application", where={"cards": [value]}))
            negated = _q(
                "Organization", _hop(USES, "Application", where={"cards": [value]}, negate=True)
            )
            answers[label] = (await _names(db, hop, scope), await _names(db, negated, scope))
        assert all(a == (set(), PICK_ORGS) for a in answers.values())

    async def test_unknown_and_wrong_type_start_picks_narrow_to_the_known_ones(self, db, picks):
        for extra in (CARD_1, picks["Alpha"], "Alpha"):
            raw = _q("Organization", where={"cards": [picks["Team"], extra]})
            assert await _names(db, raw) == {"Team"}
        for lone in (CARD_1, picks["Alpha"], "Alpha"):
            raw = _q("Organization", where={"cards": [lone], "include_descendants": True})
            assert await _names(db, raw) == set()

    async def test_cards_compile_against_an_alias(self, db, picks):
        start = aliased(Card)
        raw = _q(
            "Organization",
            _hop(
                USES, "Application", where={"cards": [picks["Suite"]], "include_descendants": True}
            ),
            where={"cards": [picks["Child"], picks["Team"]], "include_descendants": True},
        )
        clauses = await compile_card_query(
            db, parse_card_query(raw), CardReadScope.everything(), start
        )
        rows = await db.execute(select(start.name).where(start.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Team", "Grand"}


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

    def test_a_stored_card_type_alone_names_the_old_type(self):
        """No ``filters.types`` stored: the view's ``card_type`` alone says it
        was on Applications, so its facets go when the query starts at
        Organization."""
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY},
            new_query=new,
            current_query=None,
            current_filters={"groupBy": "subtype"},
            current_card_type="Application",
        )
        assert out["filters"] == base_view_filters("Organization")

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


# ---------------------------------------------------------------------------
# Stacked queries: all_of (AND) / any_of (OR)
# ---------------------------------------------------------------------------

ORG_LINE = _q("Organization", _hop(USES, "Application"))
APP_ACTIVE = _q("Application", where={"lifecycle_phase": ["active"]})
APP_AFFECTED = _q("Application", _hop(AFFECTS, "Initiative"))


def _all(*lines: dict) -> dict:
    return {"all_of": list(lines)}


def _any(*groups: dict) -> dict:
    return {"any_of": list(groups)}


def _wide(n: int) -> dict:
    """An Organization line of ``n`` sibling hops."""
    return _q("Organization", *[_hop(USES, "Application")] * n)


class TestStackStructure:
    @pytest.mark.parametrize(
        "raw, code",
        [
            (_all(APP_ACTIVE), "all_of_needs_two"),
            (_all(), "all_of_needs_two"),
            (_any(ORG_LINE), "any_of_needs_two"),
            (_any(), "any_of_needs_two"),
            (_any(_all(APP_ACTIVE), ORG_LINE), "all_of_needs_two"),
            (_all(ORG_LINE, APP_ACTIVE), "all_of_type_mismatch"),
            (_any(ORG_LINE, _all(APP_ACTIVE, ORG_LINE)), "all_of_type_mismatch"),
            # The stack's own rules come before any line's.
            (_any(_q("A", where={"lifecycle_phase": ["soon"]})), "any_of_needs_two"),
        ],
    )
    def test_stack_codes(self, raw, code):
        assert _parse_code(raw) == code

    @pytest.mark.parametrize(
        "raw",
        [
            {"foo": 1},
            {"type": "Organization", "any_of": [ORG_LINE, ORG_LINE]},
            {"all_of": [ORG_LINE, ORG_LINE], "any_of": [ORG_LINE, ORG_LINE]},
            {"all_of": [ORG_LINE, ORG_LINE], "extra": 1},
            _any(_any(ORG_LINE, ORG_LINE), ORG_LINE),
            _all(_any(ORG_LINE, ORG_LINE), ORG_LINE),
            _all(_all(ORG_LINE, ORG_LINE), ORG_LINE),
            _any(_all(_any(ORG_LINE, ORG_LINE), ORG_LINE), ORG_LINE),
            {"all_of": ORG_LINE},
        ],
    )
    def test_nesting_beyond_the_grammar_is_a_shape_error(self, raw):
        assert _parse_code(raw) == "invalid_query"

    def test_six_lines_are_accepted(self):
        raw = _any(_all(APP_ACTIVE, APP_ACTIVE), _all(ORG_LINE, ORG_LINE), _all(ORG_LINE, ORG_LINE))
        assert len(parse_card_query(raw).any_of) == 3

    def test_seven_lines_are_refused(self):
        raw = _any(
            _all(APP_ACTIVE, APP_ACTIVE),
            _all(ORG_LINE, ORG_LINE),
            _all(ORG_LINE, ORG_LINE),
            ORG_LINE,
        )
        assert _parse_code(raw) == "too_many_lines"

    def test_seven_lines_in_one_all_of_are_refused(self):
        assert _parse_code(_all(*[ORG_LINE] * 7)) == "too_many_lines"
        assert parse_card_query(_all(*[ORG_LINE] * 6)) is not None

    def test_hops_count_over_every_line(self):
        assert parse_card_query(_any(_wide(6), _wide(6))) is not None
        assert _parse_code(_any(_wide(6), _wide(7))) == "too_many_hops"
        assert _parse_code(_all(_wide(7), _wide(6))) == "too_many_hops"
        assert _parse_code(_any(_all(_wide(5), _wide(5)), _wide(3))) == "too_many_hops"

    @pytest.mark.parametrize(
        "line, code",
        [
            (_q("Organization", where={"lifecycle_phase": ["soon"]}), "unknown_phase"),
            (
                _q("Organization", _hop("r", "B", _hop("r", "C", _hop("r", "D", _hop("r", "E"))))),
                "too_deep",
            ),
            (_q("Organization", where={"subtype": [TAG_1]}), "query_holds_an_id"),
            (_q("Organization", where={"subtype": []}), "empty_values"),
        ],
    )
    def test_a_line_problem_is_found_on_a_later_line(self, line, code):
        assert _parse_code(_all(ORG_LINE, line)) == code
        assert _parse_code(_any(APP_ACTIVE, line)) == code
        assert _parse_code(_any(APP_ACTIVE, _all(ORG_LINE, line))) == code

    def test_the_first_failing_line_answers(self):
        bad_phase = _q("Organization", where={"lifecycle_phase": ["soon"]})
        bad_band = _q("Organization", where={"data_quality_band": ["great"]})
        assert _parse_code(_all(bad_band, bad_phase)) == "unknown_band"
        assert _parse_code(_all(bad_phase, bad_band)) == "unknown_phase"

    def test_query_problem_on_a_valid_stack(self):
        stack = parse_card_query(_any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE))
        assert query_problem(stack) is None

    def test_a_plain_query_parses_as_a_card_query(self):
        assert isinstance(parse_card_query(ORG_LINE), CardQuery)
        assert isinstance(parse_card_query(_all(ORG_LINE, ORG_LINE)), CardQueryAll)
        assert isinstance(parse_card_query(_any(ORG_LINE, APP_ACTIVE)), CardQueryAny)

    def test_text_and_object_parse_alike(self):
        raw = _any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE)
        assert parse_card_query(json.dumps(raw)) == parse_card_query(raw)

    def test_a_long_stack_is_too_long(self):
        line = _q("Organization", where={"attributes": {"code": ["x" * 199] * 25}})
        assert _parse_code(_all(line, line)) == "query_too_long"


class TestStackHelpers:
    STACK = _any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE)

    def test_groups_lines_and_start_types(self):
        stack = parse_card_query(self.STACK)
        assert [[stored_query(line) for line in g] for g in query_groups(stack)] == [
            [APP_ACTIVE, APP_AFFECTED],
            [ORG_LINE],
        ]
        assert [stored_query(line) for line in query_lines(stack)] == [
            APP_ACTIVE,
            APP_AFFECTED,
            ORG_LINE,
        ]
        assert start_types(stack) == ["Application", "Organization"]

    def test_a_plain_query_is_one_group_of_one_line(self):
        query = parse_card_query(ORG_LINE)
        assert query_groups(query) == [[query]]
        assert query_lines(query) == [query]
        assert start_types(query) == ["Organization"]

    def test_an_all_of_is_one_group(self):
        stack = parse_card_query(_all(APP_ACTIVE, APP_AFFECTED))
        assert [[stored_query(line) for line in g] for g in query_groups(stack)] == [
            [APP_ACTIVE, APP_AFFECTED]
        ]
        assert start_types(stack) == ["Application"]

    def test_start_types_keep_the_first_order(self):
        stack = parse_card_query(_any(ORG_LINE, APP_ACTIVE, ORG_LINE))
        assert start_types(stack) == ["Organization", "Application"]

    def test_stored_query_keeps_the_shape_and_leaves_defaults_out(self):
        raw = _any(
            _all(APP_ACTIVE, _q("Application", _hop(AFFECTS, "Initiative", negate=False))),
            _q("Organization", _hop(USES, "Application", negate=True)),
        )
        assert stored_query(parse_card_query(raw)) == {
            "any_of": [
                {
                    "all_of": [
                        {"type": "Application", "where": {"lifecycle_phase": ["active"]}},
                        {
                            "type": "Application",
                            "related": [{"relation": AFFECTS, "type": "Initiative"}],
                        },
                    ]
                },
                {
                    "type": "Organization",
                    "related": [{"relation": USES, "type": "Application", "negate": True}],
                },
            ]
        }
        assert stored_query(parse_card_query(_all(ORG_LINE, ORG_LINE))) == {
            "all_of": [ORG_LINE, ORG_LINE]
        }

    def test_names_cards_on_a_later_line(self):
        picked = _q("Organization", _hop(USES, "Application", where={"cards": [CARD_1]}))
        assert names_cards(parse_card_query(_any(APP_ACTIVE, picked))) is True
        assert names_cards(parse_card_query(_any(APP_ACTIVE, _all(ORG_LINE, picked)))) is True
        assert names_cards(parse_card_query(_any(APP_ACTIVE, ORG_LINE))) is False

    def test_stored_card_ids_walk_every_line(self):
        one, two, three = (str(uuid.UUID(int=i)) for i in (1, 2, 3))
        stored = _any(
            _all(
                _q("Application", where={"cards": [one]}),
                _q("Application", _hop(AFFECTS, "Initiative", where={"cards": [two]})),
            ),
            _q("Organization", _hop(USES, "Application", where={"cards": [three]})),
        )
        assert stored_card_ids(stored) == {uuid.UUID(v) for v in (one, two, three)}
        assert stored_card_ids(_all(stored["any_of"][1], {"where": "x"}, 5)) == {uuid.UUID(three)}


class TestStackResolve:
    async def test_every_line_resolves_in_the_stack_shape(self, db, land):
        stack = parse_card_query(_any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE))
        groups = await resolve_card_query(db, stack)
        assert [[node.type for node in group] for group in groups] == [
            ["Application", "Application"],
            ["Organization"],
        ]
        assert [h.node.type for h in groups[0][1].hops] == ["Initiative"]
        assert [h.node.type for h in groups[1][0].hops] == ["Application"]

    async def test_an_all_of_resolves_as_one_group(self, db, land):
        groups = await resolve_card_query(db, parse_card_query(_all(APP_ACTIVE, APP_AFFECTED)))
        assert [[node.type for node in group] for group in groups] == [
            ["Application", "Application"]
        ]

    @pytest.mark.parametrize(
        "line, code",
        [
            (_q("Nope"), "unknown_card_type"),
            (_q("Ghost"), "unknown_card_type"),
            (_q("Organization", _hop("nope", "Application")), "unknown_relation_type"),
            (_q("Organization", _hop(AFFECTS, "Application")), "unknown_relation_type"),
            (_q("Application", _hop(AFFECTS, "Organization")), "hop_type_mismatch"),
            (_q("Organization", where={"subtype": ["nope"]}), "unknown_subtype"),
        ],
    )
    async def test_a_metamodel_problem_on_a_later_line(self, db, land, line, code):
        assert await _code(db, _any(ORG_LINE, line)) == code
        assert await _code(db, _any(ORG_LINE, _all(line, line))) == code

    async def test_a_later_line_of_an_all_of(self, db, land):
        bad = _q("Application", where={"attributes": {"criticality": ["mid"]}})
        assert await _code(db, _all(APP_ACTIVE, bad)) == "unknown_option"

    async def _statements(self, db, monkeypatch, raw, scope=None) -> list[str]:
        seen: list[str] = []
        execute = db.execute

        async def spy(statement, *args, **kwargs):
            seen.append(str(statement))
            return await execute(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", spy)
        await resolve_card_query(db, parse_card_query(raw), read_scope=scope)
        return seen

    async def test_one_tag_load_and_one_card_load_for_the_whole_stack(self, db, land, monkeypatch):
        alpha, corp = str(land["alpha"].id), str(land["orgs"]["Corp"].id)
        raw = _any(
            _all(
                _q("Application", where={"tags": _tags(land, "Gold"), "cards": [alpha]}),
                _q("Application", where={"tags": _tags(land, "Finance")}),
            ),
            _q("Organization", where={"tags": _tags(land, "Hq"), "cards": [corp]}),
        )
        seen = await self._statements(db, monkeypatch, raw, CardReadScope.everything())
        assert len(seen) == 4
        assert len([s for s in seen if "tag_groups" in s]) == 1
        assert len([s for s in seen if "FROM cards" in s]) == 1

    async def test_nothing_named_loads_neither(self, db, land, monkeypatch):
        raw = _any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE)
        seen = await self._statements(db, monkeypatch, raw, CardReadScope.everything())
        assert len(seen) == 2
        assert not [s for s in seen if "tag" in s or "FROM cards" in s]

    async def test_the_tags_of_every_line_resolve(self, db, land):
        raw = _any(
            _q("Application", where={"tags": _tags(land, "Gold")}),
            _q("Organization", where={"tags": _tags(land, "Hq")}),
        )
        groups = await resolve_card_query(db, parse_card_query(raw))
        assert groups[0][0].tag_groups == {land["groups"]["Tier"].id: [land["tags"]["Gold"].id]}
        assert groups[1][0].tag_groups == {land["groups"]["OrgOnly"].id: [land["tags"]["Hq"].id]}

    async def test_a_tag_not_for_a_later_lines_type(self, db, land):
        raw = _any(APP_ACTIVE, _q("Organization", where={"tags": _tags(land, "Gold")}))
        assert await _code(db, raw) == "tag_not_for_type"

    async def test_a_bad_pick_on_a_later_line_is_refused_on_write(self, db, land):
        corp, alpha = str(land["orgs"]["Corp"].id), str(land["alpha"].id)
        good = _q("Organization", where={"cards": [corp]})
        wrong_type = _q("Organization", _hop(USES, "Application", where={"cards": [corp]}))
        assert await _write_code(db, _any(good, wrong_type)) == "unknown_card"
        assert await _write_code(db, _all(good, _q("Organization", where={"cards": [CARD_1]}))) == (
            "unknown_card"
        )
        ok = _any(good, _q("Organization", _hop(USES, "Application", where={"cards": [alpha]})))
        groups = await resolve_card_query(
            db, parse_card_query(ok), read_scope=CardReadScope.everything()
        )
        assert groups[1][0].hops[0].node.card_ids == [land["alpha"].id]

    async def test_a_hidden_pick_on_a_later_line_is_refused_unless_trusted(self, db, land):
        scope = await _reader_scope(db, "Application")
        alpha = land["alpha"].id
        raw = _any(
            _q("Organization"),
            _q("Organization", _hop(USES, "Application", where={"cards": [str(alpha)]})),
        )
        assert await _write_code(db, raw, scope) == "unknown_card"
        groups = await resolve_card_query(
            db, parse_card_query(raw), read_scope=scope, trusted_card_ids=[alpha]
        )
        assert groups[1][0].hops[0].node.card_ids == [alpha]


async def _scoped_names(db, raw: dict, scope: CardReadScope, card=Card) -> set[str]:
    """``_names`` with the start card's own read scope added, as every card
    list adds it."""
    clauses = await compile_card_query(db, parse_card_query(raw), scope, card)
    rows = await db.execute(
        select(card.name).where(
            card.status == "ACTIVE", *scope.where(card, mode="inventory"), *clauses
        )
    )
    return set(rows.scalars().all())


class TestStackSemantics:
    async def test_an_all_of_keeps_the_intersection(self, db, land):
        assert await _names(db, APP_ACTIVE) == {"Alpha", "Gamma"}
        assert await _names(db, APP_AFFECTED) == {"Alpha", "Beta"}
        assert await _names(db, _all(APP_ACTIVE, APP_AFFECTED)) == {"Alpha"}

    async def test_an_all_of_of_disjoint_lines_is_empty(self, db, land):
        beta_only = _q("Application", where={"subtype": ["micro"]})
        assert await _names(db, _all(APP_ACTIVE, beta_only)) == set()

    async def test_an_any_of_over_two_card_types_is_the_union(self, db, land):
        team = _q("Organization", _hop(USES, "Application", where={"subtype": ["micro"]}))
        assert await _names(db, team) == {"Team"}
        assert await _names(db, _any(APP_ACTIVE, team)) == {"Alpha", "Gamma", "Team"}

    async def test_a_group_keeps_to_its_own_card_type(self, db, land):
        """An Organization that matches no Application line is not listed by
        it, and an Application never by the Organization line."""
        rows = await db.execute(
            select(Card.type, Card.name).where(
                Card.status == "ACTIVE",
                *await compile_card_query(
                    db,
                    parse_card_query(_any(APP_ACTIVE, ORG_LINE)),
                    CardReadScope.everything(),
                ),
            )
        )
        assert set(rows.all()) == {
            ("Application", "Alpha"),
            ("Application", "Gamma"),
            ("Organization", "Corp"),
            ("Organization", "Team"),
            ("Organization", "Lone"),
        }

    async def test_an_and_group_inside_an_or(self, db, land):
        raw = _any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE)
        assert await _names(db, raw) == {"Alpha", "Corp", "Team", "Lone"}

    async def test_a_negated_line_in_an_and_group(self, db, land):
        unaffected = _q("Application", _hop(AFFECTS, "Initiative", negate=True))
        assert await _names(db, _all(APP_ACTIVE, unaffected)) == {"Gamma"}

    async def test_a_reader_denied_one_groups_start_type(self, db, land):
        raw = _any(APP_ACTIVE, ORG_LINE)
        everything = CardReadScope.everything()
        assert await _scoped_names(db, raw, everything) == {
            "Alpha",
            "Gamma",
            "Corp",
            "Team",
            "Lone",
        }
        scope = await _reader_scope(db, "Organization")
        assert await _scoped_names(db, raw, scope) == {"Alpha", "Gamma"}

    async def test_a_reader_denied_a_hop_type_inside_one_line(self, db, land):
        on_track = _q("Initiative", where={"attributes": {"initiativeStatus": ["onTrack"]}})
        raw = _any(ORG_LINE, on_track)
        assert await _scoped_names(db, raw, CardReadScope.everything()) == {
            "Corp",
            "Team",
            "Lone",
            "Rocket",
        }
        scope = await _reader_scope(db, "Application")
        assert await _scoped_names(db, raw, scope) == {"Rocket"}

    async def test_a_pinned_today_reaches_every_line(self, db, land):
        """Sixty days ago Alpha read as ``plan``. The ``plan`` conditions sit on
        the second line of the AND group and on the second group only, so
        ``today`` must reach past the first line and the first group."""
        early = TODAY - timedelta(days=60)
        app_plan = _q("Application", where={"lifecycle_phase": ["plan"]})
        org_plan = _q(
            "Organization", _hop(USES, "Application", where={"lifecycle_phase": ["plan"]})
        )
        raw = _any(_all(APP_AFFECTED, app_plan), org_plan)
        assert await _names_on(db, raw, early) == {"Alpha", "Beta", "Corp", "Team"}
        assert await _names(db, raw) == {"Beta", "Team"}
        assert await _names_on(db, _all(APP_AFFECTED, app_plan), early) == {"Alpha", "Beta"}

    async def test_compiles_against_an_alias(self, db, land):
        start = aliased(Card)
        raw = _any(_all(APP_ACTIVE, APP_AFFECTED), ORG_LINE)
        assert await _scoped_names(db, raw, CardReadScope.everything(), start) == {
            "Alpha",
            "Corp",
            "Team",
            "Lone",
        }

    async def test_every_query_compiles_to_one_clause(self, db, land):
        for raw in (_any(APP_ACTIVE, ORG_LINE), _all(APP_ACTIVE, APP_AFFECTED), ORG_LINE):
            clauses = await compile_card_query(
                db, parse_card_query(raw), CardReadScope.everything()
            )
            assert len(clauses) == 1

    async def test_a_plain_query_resolves_as_one_group_of_one_line(self, db, land):
        groups = await resolve_card_query(db, parse_card_query(ORG_LINE))
        assert [[node.type for node in group] for group in groups] == [["Organization"]]
        assert [h.node.type for h in groups[0][0].hops] == ["Application"]


TWO_TYPES = _any(APP_ACTIVE, ORG_LINE)


class TestViewFieldsOnTypeSets:
    def test_one_start_type_sets_the_card_type(self):
        query = parse_card_query(_all(APP_ACTIVE, APP_AFFECTED))
        assert view_fields_for_query(query, None, None) == (
            "Application",
            {"types": ["Application"]},
        )
        assert view_fields_for_query(query, "Application", {"types": ["Application"]}) == (
            "Application",
            {"types": ["Application"]},
        )

    def test_two_start_types_set_no_card_type(self):
        query = parse_card_query(TWO_TYPES)
        assert view_fields_for_query(query, None, {"groupBy": "x"}) == (
            None,
            {"types": ["Application", "Organization"], "groupBy": "x"},
        )

    def test_the_same_types_in_another_order_are_no_mismatch(self):
        query = parse_card_query(TWO_TYPES)
        filters = {"types": ["Organization", "Application"]}
        assert view_fields_for_query(query, None, filters) == (
            None,
            {"types": ["Application", "Organization"]},
        )

    @pytest.mark.parametrize(
        "card_type, filters",
        [
            ("Application", None),
            ("Organization", None),
            (None, {"types": ["Application"]}),
            (None, {"types": ["Application", "Organization", "Initiative"]}),
            (None, {"types": ["Application", "Initiative"]}),
            (None, {"types": "Application"}),
            (None, {"types": [["Application"], "Organization"]}),
        ],
    )
    def test_a_contradiction_is_a_mismatch(self, card_type, filters):
        query = parse_card_query(TWO_TYPES)
        _mismatch(lambda: view_fields_for_query(query, card_type, filters))

    def test_base_view_filters_on_several_types(self):
        assert base_view_filters(["Application", "Organization"]) == {
            **base_view_filters("Application"),
            "types": ["Application", "Organization"],
        }
        assert base_view_filters(("Initiative",))["types"] == ["Initiative"]


class TestViewPatchOnTypeSets:
    def test_one_type_to_two_resets_the_facets(self):
        new = parse_card_query(TWO_TYPES)
        out = view_patch(
            {"query": TWO_TYPES},
            new_query=new,
            current_query=ORG_QUERY,
            current_filters={"types": ["Organization"], "groupBy": "subtype"},
            current_card_type="Organization",
        )
        assert out == {
            "query": stored_query(new),
            "card_type": None,
            "filters": base_view_filters(["Application", "Organization"]),
        }

    def test_two_types_to_one_resets_the_facets(self):
        new = parse_card_query(ORG_QUERY)
        out = view_patch(
            {"query": ORG_QUERY},
            new_query=new,
            current_query=TWO_TYPES,
            current_filters={"types": ["Application", "Organization"], "groupBy": "x"},
        )
        assert out == {
            "query": stored_query(new),
            "card_type": "Organization",
            "filters": base_view_filters("Organization"),
        }

    def test_the_same_type_set_keeps_the_facets(self):
        other = _any(ORG_LINE, _q("Application", where={"subtype": ["micro"]}))
        new = parse_card_query(other)
        out = view_patch(
            {"query": other},
            new_query=new,
            current_query=TWO_TYPES,
            current_filters={"types": ["Application", "Organization"], "groupBy": "x"},
        )
        assert out == {
            "query": stored_query(new),
            "card_type": None,
            "filters": {"types": ["Organization", "Application"], "groupBy": "x"},
        }

    def test_a_rename_keeps_a_two_type_view_in_sync(self):
        out = view_patch(
            {"name": "n"},
            new_query=None,
            current_query=TWO_TYPES,
            current_filters={"types": ["Application", "Organization"], "groupBy": "x"},
        )
        assert out == {
            "name": "n",
            "card_type": None,
            "filters": {"types": ["Application", "Organization"], "groupBy": "x"},
        }

    def test_a_card_type_on_a_two_type_view_is_a_mismatch(self):
        _mismatch(
            lambda: view_patch(
                {"card_type": "Application"},
                new_query=None,
                current_query=TWO_TYPES,
                current_filters={"types": ["Application", "Organization"]},
            )
        )

    def test_a_plain_multi_type_view_gaining_a_query_keeps_its_facets(self):
        """A view with no query was on no single type: nothing to reset, as
        before stacks."""
        new = parse_card_query(TWO_TYPES)
        out = view_patch(
            {"query": TWO_TYPES},
            new_query=new,
            current_query=None,
            current_filters={"types": ["Application", "Initiative"], "groupBy": "x"},
        )
        assert out["filters"] == {"types": ["Application", "Organization"], "groupBy": "x"}


# ---------------------------------------------------------------------------
# End-of-life status (``where.eol_status``)
# ---------------------------------------------------------------------------

#: Upstream cycles the EOL tests answer from: 1.0 is past its end of life,
#: 1.3 is supported.
EOL_UPSTREAM = {
    "nginx": [
        {"cycle": "1.0", "eol": PAST, "support": PAST},
        {"cycle": "1.3", "eol": (TODAY + timedelta(days=400)).isoformat(), "support": FUTURE},
    ]
}
NEAR_EOL = (TODAY + timedelta(days=60)).isoformat()
#: ``where_conditions``' error for an ``eol_status`` compiled unprepared, whole.
EOL_UNPREPARED = r"^an eol_status condition needs prepared pair statuses$"
#: A day by which Retiring's manual end of life (``NEAR_EOL``) has passed.
LATER = TODAY + timedelta(days=90)


@pytest.fixture
def eol_upstream(monkeypatch):
    """``fetch_cycles_for_products`` answering from ``EOL_UPSTREAM``."""
    from app.services import eol_service

    async def fake(products):
        return {p: EOL_UPSTREAM[p] for p in products if p in EOL_UPSTREAM}

    monkeypatch.setattr(eol_service, "fetch_cycles_for_products", fake)


@pytest.fixture
async def eol_chain(db):
    """Organizations using Applications in each EOL status:

    - UsesDead → Dead (linked, end of life; lifecycle active);
    - UsesFresh → Fresh (linked, supported; lifecycle active);
    - UsesPlain → Plain (nothing recorded; lifecycle plan);
    - UsesRetiring → Retiring (manual end of life in 60 days; active);
    - UsesNothing uses nothing. Organization does not track EOL.
    """
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="eol-admin@test.com", role="admin")
    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    await create_relation_type(
        db, key=USES, source_type_key="Organization", target_type_key="Application"
    )
    apps = {
        "Dead": ({"eol_product": "nginx", "eol_cycle": "1.0"}, {"active": PAST}),
        "Fresh": ({"eol_product": "nginx", "eol_cycle": "1.3"}, {"active": PAST}),
        "Plain": ({}, {"plan": FUTURE}),
        "Retiring": ({}, {"active": PAST, "endOfLife": NEAR_EOL}),
    }
    for name, (attributes, lifecycle) in apps.items():
        app = await create_card(db, name=name, attributes=attributes, lifecycle=lifecycle)
        org = await create_card(db, card_type="Organization", name=f"Uses{name}")
        await create_relation(db, type_key=USES, source_id=org.id, target_id=app.id)
    await create_card(db, card_type="Organization", name="UsesNothing")
    return admin


async def _eol_names(db, user, raw: dict) -> set[str]:
    """The start cards ``raw`` keeps, through the routes' prepare / compile."""
    from app.services.card_query import prepare_card_query

    prepared = await prepare_card_query(db, user, parse_card_query(raw))
    clauses = await prepared.compile(CardReadScope.everything())
    rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
    return set(rows.scalars().all())


class TestEolStatusStructure:
    def test_an_empty_list_is_refused(self):
        assert _parse_code(_q("A", where={"eol_status": []})) == "empty_values"

    @pytest.mark.parametrize("value", ["retired", "EOL", "none", ""])
    def test_an_unknown_status_is_refused(self, value):
        raw = _q("A", _hop("r", "B", where={"eol_status": ["eol", value]}))
        assert _parse_code(raw) == "unknown_eol_status"

    def test_every_status_parses_and_is_stored_verbatim(self):
        raw = _q(
            "A",
            where={"eol_status": ["eol", "approaching", "supported", "unknown", "__empty__"]},
        )
        assert stored_query(parse_card_query(raw)) == raw

    def test_at_most_fifty_values(self):
        assert _parse_code(_q("A", where={"eol_status": ["eol"] * 51})) == "invalid_query"
        assert parse_card_query(_q("A", where={"eol_status": ["eol"] * 50})).where


class TestEolStatusResolve:
    async def test_a_type_that_does_not_track_eol_is_refused(self, db, eol_chain):
        assert await _code(db, _q("Organization", where={"eol_status": ["eol"]})) == (
            "eol_not_tracked"
        )
        hop = _q("Application", where={"eol_status": ["eol"]})
        assert (await _resolve_root(db, parse_card_query(hop))).eol_status == ("eol",)

    async def test_hiding_the_eol_section_takes_the_type_out(self, db):
        await create_card_type(db, key="Application", section_config={"eol": {"hidden": True}})
        await create_card_type(db, key="Widget", section_config={"eol": {"hidden": False}})
        await create_relation_type(
            db, key="appToWidget", source_type_key="Application", target_type_key="Widget"
        )
        raw = _q("Application", where={"eol_status": ["eol"]})
        assert await _code(db, raw) == "eol_not_tracked"
        at_hop = _q("Application", _hop("appToWidget", "Widget", where={"eol_status": ["eol"]}))
        root = await _resolve_root(db, parse_card_query(at_hop))
        assert root.eol_status == ()
        assert root.hops[0].node.eol_status == ("eol",)

    async def test_values_are_deduplicated_in_order(self, db, eol_chain):
        raw = _q("Application", where={"eol_status": ["unknown", "eol", "unknown"]})
        root = await _resolve_root(db, parse_card_query(raw))
        assert root.eol_status == ("unknown", "eol")

    async def test_a_node_without_where_has_none(self, db, eol_chain):
        root = await _resolve_root(db, parse_card_query(_q("Application")))
        assert root.eol_status == ()


class TestEolStatusSemantics:
    async def test_at_the_start_card(self, db, eol_chain, eol_upstream):
        assert await _eol_names(
            db, eol_chain, _q("Application", where={"eol_status": ["eol"]})
        ) == {"Dead"}
        empty = _q("Application", where={"eol_status": ["__empty__"]})
        assert await _eol_names(db, eol_chain, empty) == {"Plain"}

    async def test_at_a_hop(self, db, eol_chain, eol_upstream):
        hop = _hop(USES, "Application", where={"eol_status": ["eol", "approaching"]})
        assert await _eol_names(db, eol_chain, _q("Organization", hop)) == {
            "UsesDead",
            "UsesRetiring",
        }
        negated = _hop(USES, "Application", where={"eol_status": ["supported"]}, negate=True)
        assert await _eol_names(db, eol_chain, _q("Organization", negated)) == {
            "UsesDead",
            "UsesPlain",
            "UsesRetiring",
            "UsesNothing",
        }

    async def test_inside_an_or_group_of_a_stack(self, db, eol_chain, eol_upstream):
        raw = {
            "any_of": [
                _q("Application", where={"eol_status": ["eol"]}),
                {
                    "all_of": [
                        _q(
                            "Organization",
                            _hop(USES, "Application", where={"eol_status": ["__empty__"]}),
                        ),
                        _q("Organization", _hop(USES, "Application")),
                    ]
                },
            ]
        }
        assert await _eol_names(db, eol_chain, raw) == {"Dead", "UsesPlain"}

    @pytest.mark.parametrize(
        ("where", "expected"),
        [
            ({"eol_status": ["eol"], "lifecycle_phase": ["active"]}, {"Dead"}),
            ({"eol_status": ["approaching"], "lifecycle_phase": ["active"]}, {"Retiring"}),
            ({"eol_status": ["eol"], "lifecycle_phase": ["endOfLife"]}, set()),
            ({"eol_status": ["__empty__"], "lifecycle_phase": ["plan"]}, {"Plain"}),
        ],
    )
    async def test_independent_of_the_lifecycle(self, db, eol_chain, eol_upstream, where, expected):
        """A card's EOL status and its own lifecycle phase are two facts: an
        Application can be active while its component is end of life."""
        assert await _eol_names(db, eol_chain, _q("Application", where=where)) == expected

    async def test_compiling_without_prepared_statuses_raises(self, db, eol_chain):
        raw = _q("Organization", _hop(USES, "Application", where={"eol_status": ["eol"]}))
        with pytest.raises(RuntimeError, match=EOL_UNPREPARED):
            await compile_card_query(db, parse_card_query(raw), CardReadScope.everything())

    async def test_compiling_empty_alone_needs_no_statuses(self, db, eol_chain):
        raw = _q("Organization", _hop(USES, "Application", where={"eol_status": ["__empty__"]}))
        clauses = await compile_card_query(db, parse_card_query(raw), CardReadScope.everything())
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"UsesPlain"}

    async def test_compile_card_query_takes_prepared_statuses(self, db, eol_chain):
        raw = _q("Application", where={"eol_status": ["supported"]})
        clauses = await compile_card_query(
            db,
            parse_card_query(raw),
            CardReadScope.everything(),
            pair_statuses={("nginx", "1.0"): "supported", ("nginx", "1.3"): "eol"},
        )
        rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Dead"}


class TestEolCompileInputs:
    """What ``compile`` is handed reaches the end-of-life condition: the
    pinned ``today``, the card (or alias) the clauses are over, and the
    custom products' cycles."""

    @pytest.mark.parametrize(
        ("today", "eol", "approaching"),
        [(TODAY, {"Dead"}, {"Retiring"}), (LATER, {"Dead", "Retiring"}, set())],
    )
    async def test_compile_card_query_pins_today(self, db, eol_chain, today, eol, approaching):
        """Retiring's manual end of life is 60 days out: ``approaching`` today,
        ``eol`` 90 days on — so the pinned day reaches the manual branch."""
        statuses = {("nginx", "1.0"): "eol", ("nginx", "1.3"): "supported"}
        for values, expected in ((["eol"], eol), (["approaching"], approaching)):
            raw = _q("Application", where={"eol_status": values})
            clauses = await compile_card_query(
                db,
                parse_card_query(raw),
                CardReadScope.everything(),
                today=today,
                pair_statuses=statuses,
            )
            rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
            assert set(rows.scalars().all()) == expected

    @pytest.mark.parametrize(
        ("today", "eol", "approaching"),
        [(TODAY, {"Dead"}, {"Retiring"}), (LATER, {"Dead", "Retiring"}, set())],
    )
    async def test_prepared_compile_pins_today(
        self, db, eol_chain, eol_upstream, today, eol, approaching
    ):
        from app.services.card_query import prepare_card_query

        for values, expected in ((["eol"], eol), (["approaching"], approaching)):
            raw = _q("Application", where={"eol_status": values})
            prepared = await prepare_card_query(db, eol_chain, parse_card_query(raw))
            clauses = await prepared.compile(CardReadScope.everything(), today=today)
            rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
            assert set(rows.scalars().all()) == expected

    async def test_prepared_compile_is_over_the_card_it_is_given(self, db, eol_chain, eol_upstream):
        """Compiled against an alias, the clauses are over the alias: selecting
        from it alone keeps exactly the matching cards."""
        from app.services.card_query import prepare_card_query

        raw = _q("Application", where={"eol_status": ["eol"]})
        prepared = await prepare_card_query(db, eol_chain, parse_card_query(raw))
        other = aliased(Card)
        clauses = await prepared.compile(CardReadScope.everything(), other, today=LATER)
        rows = await db.execute(select(other.name).where(other.status == "ACTIVE", *clauses))
        assert set(rows.scalars().all()) == {"Dead", "Retiring"}

    async def test_prepared_compile_reads_the_custom_cycles(self, db, eol_chain, monkeypatch):
        """With upstream answering nothing, only the custom product's own cycle
        row can make Acme ``eol`` — and the nginx links read ``unknown``."""
        from app.models.eol_custom_cycle import EolCustomCycle
        from app.models.eol_custom_product import EolCustomProduct
        from app.services import eol_service
        from app.services.card_query import prepare_card_query

        async def nothing(products):
            return {}

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", nothing)
        db.add(EolCustomProduct(key="acme", title="Acme"))
        await db.flush()
        db.add(EolCustomCycle(product_key="acme", cycle="7", eol=PAST, support=False))
        await create_card(
            db, name="Acme", attributes={"eol_product": "custom:acme", "eol_cycle": "7"}
        )
        for values, expected in ((["eol"], {"Acme"}), (["unknown"], {"Dead", "Fresh"})):
            raw = _q("Application", where={"eol_status": values})
            prepared = await prepare_card_query(db, eol_chain, parse_card_query(raw))
            clauses = await prepared.compile(CardReadScope.everything())
            rows = await db.execute(select(Card.name).where(Card.status == "ACTIVE", *clauses))
            assert set(rows.scalars().all()) == expected

    async def test_prepared_without_eol_inputs_raises_for_a_status(self, db, eol_chain):
        """A ``PreparedCardQuery`` holding a status condition but no EOL inputs
        is a programming error: ``compile`` raises rather than dropping the
        condition."""
        from app.services.card_query import PreparedCardQuery

        raw = _q("Application", where={"eol_status": ["eol"]})
        groups = await resolve_card_query(db, parse_card_query(raw))
        with pytest.raises(RuntimeError, match=EOL_UNPREPARED):
            await PreparedCardQuery(groups).compile(CardReadScope.everything())


class TestPrepareCardQuery:
    async def test_a_query_without_eol_reads_nothing_more(self, db, eol_chain):
        from app.services.card_query import prepare_card_query

        prepared = await prepare_card_query(db, eol_chain, parse_card_query(_q("Application")))
        assert prepared.eol is None
        assert prepared.needs_release is False

    async def test_an_eol_query_reads_the_pairs_first(self, db, eol_chain):
        from app.models.eol_custom_cycle import EolCustomCycle
        from app.models.eol_custom_product import EolCustomProduct
        from app.services.card_query import prepare_card_query

        db.add(EolCustomProduct(key="acme", title="Acme"))
        await db.flush()
        db.add(EolCustomCycle(product_key="acme", cycle="7", eol=PAST, support=False))
        await create_card(
            db, name="Acme", attributes={"eol_product": "custom:acme", "eol_cycle": "7"}
        )
        raw = _q("Organization", _hop(USES, "Application", where={"eol_status": ["eol"]}))
        prepared = await prepare_card_query(db, eol_chain, parse_card_query(raw))
        assert prepared.needs_release is True
        assert prepared.eol is not None
        assert prepared.eol.pairs == {("nginx", "1.0"), ("nginx", "1.3"), ("custom:acme", "7")}
        assert list(prepared.eol.custom_cycles) == ["custom:acme"]
        assert [c["cycle"] for c in prepared.eol.custom_cycles["custom:acme"]] == ["7"]

    async def test_needs_eol_view(self, db, eol_chain):
        from app.services.card_query import prepare_card_query

        await create_role(db, key="no_eol", label="No EOL", permissions={"inventory.view": True})
        reader = await create_user(db, email="no-eol@test.com", role="no_eol")
        raw = _q("Application", where={"eol_status": ["eol"]})
        with pytest.raises(CardQueryError) as exc:
            await prepare_card_query(db, reader, parse_card_query(raw))
        assert (exc.value.code, exc.value.status) == ("eol_view_required", 403)
        # Without the condition the same reader is not asked for it.
        plain = await prepare_card_query(db, reader, parse_card_query(_q("Application")))
        assert plain.eol is None

    async def test_empty_alone_reads_no_pair_and_fetches_nothing(self, db, eol_chain, monkeypatch):
        """``__empty__`` is pure SQL: no pair read, no custom cycles, no
        commit and no outbound fetch — and the answer is still exact."""
        from app.services import card_query, eol_service
        from app.services.card_query import prepare_card_query

        async def refuse(*args, **kwargs):
            raise AssertionError("an __empty__-only query must not read or fetch")

        monkeypatch.setattr(eol_service, "fetch_cycles_for_products", refuse)
        monkeypatch.setattr(card_query, "eol_pairs_for_types", refuse)
        monkeypatch.setattr(card_query, "load_custom_cycles", refuse)
        monkeypatch.setattr(db, "commit", refuse)
        raw = _q("Organization", _hop(USES, "Application", where={"eol_status": ["__empty__"]}))
        prepared = await prepare_card_query(db, eol_chain, parse_card_query(raw))
        assert prepared.eol is None
        assert prepared.needs_release is False
        assert await _eol_names(db, eol_chain, raw) == {"UsesPlain"}
        at_start = _q("Application", where={"eol_status": ["__empty__", "__empty__"]})
        assert await _eol_names(db, eol_chain, at_start) == {"Plain"}

    async def test_only_the_nodes_asking_a_status_read_pairs(self, db, eol_chain, monkeypatch):
        from app.services import card_query
        from app.services.card_query import prepare_card_query

        asked: list[set[str]] = []
        real = card_query.eol_pairs_for_types

        async def record(db_, types):
            asked.append(set(types))
            return await real(db_, types)

        monkeypatch.setattr(card_query, "eol_pairs_for_types", record)
        await create_card_type(db, key="ITComponent")
        await create_relation_type(
            db, key="appUsesItc", source_type_key="Application", target_type_key="ITComponent"
        )
        raw = _q(
            "Organization",
            _hop(
                USES,
                "Application",
                _hop("appUsesItc", "ITComponent", where={"eol_status": ["unknown"]}),
                where={"eol_status": ["__empty__"]},
            ),
        )
        prepared = await prepare_card_query(db, eol_chain, parse_card_query(raw))
        assert asked == [{"ITComponent"}]
        assert prepared.needs_release is True

    async def test_empty_alone_still_needs_eol_view(self, db, eol_chain):
        from app.services.card_query import prepare_card_query

        await create_role(db, key="no_eol", label="No EOL", permissions={"inventory.view": True})
        reader = await create_user(db, email="no-eol@test.com", role="no_eol")
        raw = _q("Application", where={"eol_status": ["__empty__"]})
        with pytest.raises(CardQueryError) as exc:
            await prepare_card_query(db, reader, parse_card_query(raw))
        assert (exc.value.code, exc.value.status) == ("eol_view_required", 403)

    def test_a_query_error_is_a_400_by_default(self):
        assert CardQueryError("unknown_band").status == 400
