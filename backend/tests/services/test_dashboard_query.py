"""The dashboard aggregation engine: pure rules first, then the database half.

The pure functions decide every number a chart or KPI shows, so they are
tested value by value; the database tests check the rows a real query hands
them (only ACTIVE cards, no hidden type, the read scope, each dimension).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.services.card_read_scope import CardReadScope
from app.services.dashboard_query import (
    DashboardQuery,
    DashboardQueryError,
    aggregate,
    data_quality_bucket,
    dimension_domain,
    dimension_key,
    find_field,
    is_dimension,
    last_months,
    lifecycle_key,
    metric_key,
    month_key,
    numeric_value,
    order_keys,
    query_problem,
    resolve_query,
    result_shape,
    run_query,
    tidy_number,
    value_key,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
)

Q = DashboardQuery


# ── metric_key: the string the frontend mirrors byte for byte ────────────


class TestMetricKey:
    def test_the_fixture_string_the_frontend_mirrors(self):
        query = Q(card_type="Application", group_by="approval_status")
        assert metric_key(query) == "card_type=Application&group_by=approval_status"

    def test_fields_are_sorted_and_the_default_metric_left_out(self):
        query = Q(group_by="type", card_type="Application", metric="count")
        assert metric_key(query) == "card_type=Application&group_by=type"

    def test_a_non_default_metric_is_kept_and_values_are_url_encoded(self):
        query = Q(
            card_type="Application",
            metric="sum",
            metric_field="costTotalAnnual",
            group_by="field:businessCriticality",
        )
        assert metric_key(query) == (
            "card_type=Application&group_by=field%3AbusinessCriticality"
            "&metric=sum&metric_field=costTotalAnnual"
        )

    def test_an_empty_query_is_the_empty_string(self):
        assert metric_key(Q()) == ""

    def test_a_space_is_encoded_as_plus(self):
        assert metric_key(Q(approval_status="A B")) == "approval_status=A+B"


# ── query_problem ────────────────────────────────────────────────────────


class TestQueryProblem:
    def test_a_plain_count_is_fine(self):
        assert query_problem(Q()) is None
        assert query_problem(Q(group_by="type")) is None

    def test_is_dimension(self):
        assert is_dimension("type")
        assert is_dimension("created_month")
        assert is_dimension("field:x")
        assert not is_dimension("field:")
        assert not is_dimension("name")

    @pytest.mark.parametrize(
        ("query", "code"),
        [
            (Q(group_by="name"), "unknown_dimension"),
            (Q(group_by="type", group_by_2="bogus"), "unknown_dimension"),
            (Q(metric="max"), "unknown_metric"),
            (Q(card_type="A", metric="sum"), "metric_field_required"),
            (Q(card_type="A", metric_field="cost"), "metric_field_unused"),
            (Q(lifecycle_phase="retired"), "unknown_lifecycle_phase"),
            (Q(relation_type="r", card_type="A"), "relation_type_conflict"),
            (Q(relation_type="r", subtype="s"), "relation_type_conflict"),
            (Q(relation_type="r", metric="sum", metric_field="c"), "relation_type_conflict"),
            (Q(group_by_2="type"), "group_by_2_requires_group_by"),
            (Q(group_by="subtype"), "card_type_required"),
            (Q(group_by="type", group_by_2="field:x"), "card_type_required"),
            (Q(metric="avg", metric_field="cost"), "card_type_required"),
            (Q(subtype="saas"), "card_type_required"),
            (
                Q(
                    card_type="A" * 100,
                    approval_status="B" * 20,
                    subtype="C" * 100,
                    group_by="type",
                    lifecycle_phase="active",
                    relation_type=None,
                    group_by_2="field:" + "x" * 100,
                ),
                "query_too_long",
            ),
        ],
    )
    def test_each_rule(self, query, code):
        assert query_problem(query) == code

    def test_a_lifecycle_filter_of_none_is_a_phase(self):
        assert query_problem(Q(lifecycle_phase="none")) is None

    def test_a_sankey_takes_side_dimensions_without_a_card_type(self):
        assert query_problem(Q(relation_type="r", group_by="subtype")) is None
        assert query_problem(Q(relation_type="r", group_by_2="field:x")) is None


# ── the arithmetic ───────────────────────────────────────────────────────


class TestPureHelpers:
    def test_last_months_crosses_the_year(self):
        assert last_months(date(2026, 2, 10), 4) == ["2025-11", "2025-12", "2026-01", "2026-02"]
        assert len(last_months(date(2026, 10, 28))) == 12
        assert last_months(date(2026, 10, 28))[-1] == "2026-10"
        assert last_months(date(2026, 10, 28))[0] == "2025-11"

    @pytest.mark.parametrize(
        ("score", "bucket"),
        [
            (0, "0-25"),
            (24.99, "0-25"),
            (25, "25-50"),
            (49.99, "25-50"),
            (50, "50-75"),
            (74.99, "50-75"),
            (75, "75-100"),
            (100, "75-100"),
            (None, "0-25"),
            (True, "0-25"),
        ],
    )
    def test_data_quality_bucket(self, score, bucket):
        assert data_quality_bucket(score) == bucket

    def test_lifecycle_key(self):
        past = (date.today() - timedelta(days=10)).isoformat()
        assert lifecycle_key({"active": past}) == "active"
        assert lifecycle_key({"active": past, "endOfLife": past}) == "endOfLife"
        assert lifecycle_key({}) == "none"
        assert lifecycle_key(None) == "none"
        assert lifecycle_key("garbage") == "none"

    def test_value_key(self):
        assert value_key(None) == "none"
        assert value_key("") == "none"
        assert value_key(True) == "true"
        assert value_key(False) == "false"
        assert value_key("high") == "high"
        assert value_key(3) == "3"

    def test_month_key(self):
        assert month_key(datetime(2026, 3, 31, 23, 30, tzinfo=timezone.utc)) == "2026-03"
        # A local midnight on April 1st east of UTC is still March in UTC.
        east = timezone(timedelta(hours=2))
        assert month_key(datetime(2026, 4, 1, 1, 0, tzinfo=east)) == "2026-03"
        assert month_key(datetime(2026, 4, 1, 1, 0)) == "2026-04"
        assert month_key("2026-04") is None

    def test_dimension_key(self):
        months = ["2026-09", "2026-10"]
        stamp = datetime(2026, 10, 2, tzinfo=timezone.utc)
        old = datetime(2025, 1, 2, tzinfo=timezone.utc)
        assert dimension_key("created_month", stamp, months) == "2026-10"
        assert dimension_key("created_month", old, months) is None
        assert dimension_key("data_quality_bucket", 80, months) == "75-100"
        assert dimension_key("lifecycle_phase", {}, months) == "none"
        assert dimension_key("type", "Application", months) == "Application"
        assert dimension_key("field:x", None, months) == "none"

    def test_dimension_domain(self):
        months = ["2026-10"]
        assert dimension_domain("lifecycle_phase", None, months) == [
            "plan",
            "phaseIn",
            "active",
            "phaseOut",
            "endOfLife",
            "none",
        ]
        assert dimension_domain("data_quality_bucket", None, months) == [
            "0-25",
            "25-50",
            "50-75",
            "75-100",
        ]
        assert dimension_domain("created_month", None, months) == ["2026-10"]
        assert dimension_domain("field:b", {"type": "boolean"}, months) == ["true", "false"]
        select = {"type": "single_select", "options": [{"key": "lo"}, {"key": "hi"}, "junk"]}
        assert dimension_domain("field:s", select, months) == ["lo", "hi"]
        assert dimension_domain("field:s", {"type": "single_select"}, months) == []
        assert dimension_domain("type", None, months) == []
        assert dimension_domain(None, None, months) == []

    @pytest.mark.parametrize(
        ("raw", "number"),
        [
            (3, 3),
            (2.5, 2.5),
            ("4.5", 4.5),
            (" 7 ", 7.0),
            (True, None),
            (None, None),
            ("abc", None),
            (float("inf"), None),
            ([1], None),
        ],
    )
    def test_numeric_value(self, raw, number):
        assert numeric_value(raw) == number

    def test_tidy_number(self):
        assert tidy_number(12.0) == 12
        assert isinstance(tidy_number(12.0), int)
        assert tidy_number(1 / 3) == 0.33
        assert tidy_number(2.005) == round(2.005, 2)

    def test_order_keys_puts_the_domain_first_then_largest(self):
        values = {"b": 1, "a": 5, "c": 5, "lo": 0}
        assert order_keys(values, ["lo", "hi"]) == ["lo", "hi", "a", "c", "b"]
        assert order_keys(values, []) == ["a", "c", "b", "lo"]

    def test_find_field(self):
        schema = [
            {"section": "A", "fields": [{"key": "x", "type": "number"}]},
            "junk",
            {"section": "B", "fields": [{"key": "y", "type": "boolean"}, "junk"]},
        ]
        assert find_field(schema, "y") == {"key": "y", "type": "boolean"}
        assert find_field(schema, "z") is None
        assert find_field(None, "x") is None


class TestAggregate:
    RECORDS = [("a", None, 10), ("a", None, "5"), ("b", None, None), ("b", None, 4)]

    def test_single_is_the_total_only(self):
        assert aggregate(self.RECORDS, metric="count", shape="single") == ([], 4)
        assert aggregate(self.RECORDS, metric="sum", shape="single") == ([], 19)
        # avg over the three numeric values only, not the four cards
        assert aggregate(self.RECORDS, metric="avg", shape="single") == ([], 6.33)

    def test_keyed_counts_sums_and_averages(self):
        rows, total = aggregate(self.RECORDS, metric="count", shape="keyed")
        assert rows == [{"key": "a", "value": 2}, {"key": "b", "value": 2}]
        assert total == 4
        rows, total = aggregate(self.RECORDS, metric="sum", shape="keyed")
        assert rows == [{"key": "a", "value": 15}, {"key": "b", "value": 4}]
        assert total == 19
        rows, _ = aggregate(self.RECORDS, metric="avg", shape="keyed")
        assert rows == [{"key": "a", "value": 7.5}, {"key": "b", "value": 4}]

    def test_keyed_zero_fills_the_domain_in_order(self):
        rows, _ = aggregate([("x", None, None)], metric="count", shape="keyed", domain_1=["y", "x"])
        assert rows == [{"key": "y", "value": 0}, {"key": "x", "value": 1}]

    def test_an_average_with_no_number_is_zero(self):
        rows, total = aggregate([("a", None, None)], metric="avg", shape="keyed")
        assert rows == [{"key": "a", "value": 0}]
        assert total == 0

    def test_flow_rows_sorted_largest_first(self):
        records = [("App", "IT", None), ("Org", "App", None), ("Org", "App", None)]
        rows, total = aggregate(records, metric="count", shape="flow")
        assert rows == [
            {"source": "Org", "target": "App", "value": 2},
            {"source": "App", "target": "IT", "value": 1},
        ]
        assert total == 3

    def test_grid_rows_follow_each_axis(self):
        records = [("b", "y", None), ("a", "x", None), ("a", "y", None), ("a", "y", None)]
        rows, total = aggregate(records, metric="count", shape="grid", domain_2=["x", "y"])
        assert rows == [
            {"x": "a", "y": "x", "value": 1},
            {"x": "a", "y": "y", "value": 2},
            {"x": "b", "y": "y", "value": 1},
        ]
        assert total == 4


class TestResultShape:
    def test_shapes(self):
        from app.services.dashboard_query import ResolvedQuery

        assert result_shape(ResolvedQuery(query=Q())) == "single"
        assert result_shape(ResolvedQuery(query=Q(group_by="type"))) == "keyed"
        both = Q(group_by="type", group_by_2="approval_status")
        assert result_shape(ResolvedQuery(query=both)) == "grid"
        assert result_shape(ResolvedQuery(query=Q(), relation=object())) == "flow"  # type: ignore[arg-type]


# ── against the database ─────────────────────────────────────────────────

FIELDS = [
    {
        "section": "General",
        "fields": [
            {
                "key": "criticality",
                "type": "single_select",
                "options": [{"key": "low"}, {"key": "high"}],
            },
            {"key": "internal", "type": "boolean"},
            {"key": "cost", "type": "cost"},
            {"key": "users", "type": "number"},
            {"key": "tags", "type": "multiple_select", "options": []},
        ],
    }
]


@pytest.fixture
async def landscape(db):
    await create_card_type(db, key="Application", label="Application", fields_schema=FIELDS)
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Ghost", label="Ghost", is_hidden=True)
    past = (date.today() - timedelta(days=30)).isoformat()
    a1 = await create_card(
        db,
        card_type="Application",
        name="A1",
        subtype="saas",
        approval_status="APPROVED",
        data_quality=80,
        lifecycle={"active": past},
        attributes={"criticality": "high", "internal": True, "cost": 100, "users": 10},
    )
    a2 = await create_card(
        db,
        card_type="Application",
        name="A2",
        approval_status="DRAFT",
        data_quality=30,
        attributes={"criticality": "high", "cost": "50", "users": 20},
    )
    await create_card(
        db,
        card_type="Application",
        name="A3",
        approval_status="BROKEN",
        data_quality=10,
        attributes={"criticality": "low", "internal": False},
    )
    await create_card(db, card_type="Application", name="Archived", status="ARCHIVED")
    it = await create_card(db, card_type="ITComponent", name="IT1", data_quality=60)
    await create_card(db, card_type="Ghost", name="G1")
    await create_relation_type(
        db,
        key="appToIt",
        label="uses",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    await create_relation(db, type_key="appToIt", source_id=a1.id, target_id=it.id)
    await create_relation(db, type_key="appToIt", source_id=a2.id, target_id=it.id)
    return {"a1": a1, "a2": a2, "it": it}


async def _run(db, scope=None, **kwargs):
    resolved = await resolve_query(db, Q(**kwargs))
    return await run_query(db, resolved, scope or CardReadScope.everything())


class TestRunQuery:
    async def test_by_type_counts_active_cards_of_visible_types(self, db, landscape):
        result = await _run(db, group_by="type")
        assert result == {
            "dimension": "type",
            "dimension_2": None,
            "rows": [{"key": "Application", "value": 3}, {"key": "ITComponent", "value": 1}],
            "total": 4,
        }

    async def test_total_only(self, db, landscape):
        assert (await _run(db))["total"] == 4
        assert (await _run(db, card_type="Application"))["total"] == 3

    async def test_filters(self, db, landscape):
        assert (await _run(db, approval_status="APPROVED"))["total"] == 1
        assert (await _run(db, card_type="Application", subtype="saas"))["total"] == 1
        assert (await _run(db, lifecycle_phase="active"))["total"] == 1
        assert (await _run(db, lifecycle_phase="none"))["total"] == 3

    async def test_approval_status_and_subtype(self, db, landscape):
        rows = (await _run(db, group_by="approval_status"))["rows"]
        assert rows == [
            {"key": "DRAFT", "value": 2},
            {"key": "APPROVED", "value": 1},
            {"key": "BROKEN", "value": 1},
        ]
        rows = (await _run(db, card_type="Application", group_by="subtype"))["rows"]
        assert rows == [{"key": "none", "value": 2}, {"key": "saas", "value": 1}]

    async def test_lifecycle_and_quality_buckets_are_zero_filled(self, db, landscape):
        rows = (await _run(db, group_by="lifecycle_phase"))["rows"]
        assert rows == [
            {"key": "plan", "value": 0},
            {"key": "phaseIn", "value": 0},
            {"key": "active", "value": 1},
            {"key": "phaseOut", "value": 0},
            {"key": "endOfLife", "value": 0},
            {"key": "none", "value": 3},
        ]
        rows = (await _run(db, group_by="data_quality_bucket"))["rows"]
        assert rows == [
            {"key": "0-25", "value": 1},
            {"key": "25-50", "value": 1},
            {"key": "50-75", "value": 1},
            {"key": "75-100", "value": 1},
        ]

    async def test_created_month_is_twelve_zero_filled_months(self, db, landscape):
        result = await _run(db, group_by="created_month")
        assert len(result["rows"]) == 12
        assert result["rows"][-1] == {
            "key": datetime.now(timezone.utc).strftime("%Y-%m"),
            "value": 4,
        }
        assert sum(r["value"] for r in result["rows"]) == 4

    async def test_select_and_boolean_fields(self, db, landscape):
        rows = (await _run(db, card_type="Application", group_by="field:criticality"))["rows"]
        assert rows == [{"key": "low", "value": 1}, {"key": "high", "value": 2}]
        rows = (await _run(db, card_type="Application", group_by="field:internal"))["rows"]
        assert rows == [
            {"key": "true", "value": 1},
            {"key": "false", "value": 1},
            {"key": "none", "value": 1},
        ]

    async def test_sum_and_average_of_a_field(self, db, landscape):
        result = await _run(
            db,
            card_type="Application",
            metric="sum",
            metric_field="cost",
            group_by="field:criticality",
        )
        assert result["rows"] == [{"key": "low", "value": 0}, {"key": "high", "value": 150}]
        assert result["total"] == 150
        result = await _run(db, card_type="Application", metric="avg", metric_field="users")
        assert result["total"] == 15

    async def test_heatmap(self, db, landscape):
        result = await _run(
            db, card_type="Application", group_by="field:criticality", group_by_2="approval_status"
        )
        assert result["dimension_2"] == "approval_status"
        # x follows the option order; y the statuses' own totals (ties by key).
        assert result["rows"] == [
            {"x": "low", "y": "BROKEN", "value": 1},
            {"x": "high", "y": "APPROVED", "value": 1},
            {"x": "high", "y": "DRAFT", "value": 1},
        ]
        assert result["total"] == 3

    async def test_sankey_counts_pairs_by_side(self, db, landscape):
        result = await _run(db, relation_type="appToIt")
        assert result == {
            "dimension": "type",
            "dimension_2": "type",
            "rows": [{"source": "Application", "target": "ITComponent", "value": 2}],
            "total": 2,
        }
        result = await _run(db, relation_type="appToIt", group_by="field:criticality")
        assert result["rows"] == [{"source": "high", "target": "ITComponent", "value": 2}]
        assert (await _run(db, relation_type="appToIt", lifecycle_phase="active"))["total"] == 0

    async def test_a_restricted_reader_does_not_count_a_hidden_type(self, db, landscape):
        scope = CardReadScope(
            role_key="r",
            wildcard=False,
            base_view=True,
            denied_types=frozenset({"ITComponent"}),
            allowed_types=frozenset(),
            stakeholder_card_ids=frozenset(),
        )
        result = await _run(db, scope, group_by="type")
        assert result["rows"] == [{"key": "Application", "value": 3}]
        assert result["total"] == 3
        assert (await _run(db, scope, relation_type="appToIt"))["total"] == 0


class TestResolve:
    @pytest.mark.parametrize(
        ("kwargs", "code"),
        [
            ({"card_type": "Nope"}, "unknown_card_type"),
            ({"card_type": "Ghost"}, "unknown_card_type"),
            ({"card_type": "Application", "group_by": "field:nope"}, "unknown_field"),
            ({"card_type": "Application", "group_by": "field:users"}, "unknown_field"),
            ({"card_type": "Application", "group_by": "field:tags"}, "unknown_field"),
            (
                {"card_type": "Application", "metric": "sum", "metric_field": "internal"},
                "unknown_field",
            ),
            (
                {"card_type": "Application", "metric": "sum", "metric_field": "nope"},
                "unknown_field",
            ),
            ({"relation_type": "nope"}, "unknown_relation_type"),
            ({"relation_type": "appToIt", "group_by_2": "field:criticality"}, "unknown_field"),
            ({"group_by": "bogus"}, "unknown_dimension"),
        ],
    )
    async def test_unknown_metamodel_keys(self, db, landscape, kwargs, code):
        with pytest.raises(DashboardQueryError) as exc:
            await resolve_query(db, Q(**kwargs))
        assert exc.value.code == code

    async def test_a_cost_metric_is_flagged(self, db, landscape):
        cost = await resolve_query(
            db, Q(card_type="Application", metric="sum", metric_field="cost")
        )
        assert cost.metric_is_cost is True
        users = await resolve_query(
            db, Q(card_type="Application", metric="sum", metric_field="users")
        )
        assert users.metric_is_cost is False

    async def test_a_hidden_relation_type_is_unknown(self, db, landscape):
        await create_relation_type(
            db,
            key="hiddenRel",
            label="h",
            source_type_key="Application",
            target_type_key="ITComponent",
            is_hidden=True,
        )
        with pytest.raises(DashboardQueryError) as exc:
            await resolve_query(db, Q(relation_type="hiddenRel"))
        assert exc.value.code == "unknown_relation_type"


# ── SQL fast path ────────────────────────────────────────────────────────


class TestFastPathRules:
    def test_aggregate_takes_weighted_records(self):
        records = [("a", None, None, 3), ("b", None, None), ("a", None, None, 2)]
        rows, total = aggregate(records, metric="count", shape="keyed")
        assert rows == [{"key": "a", "value": 5}, {"key": "b", "value": 1}]
        assert total == 6
        assert aggregate([(None, None, None, 0)], metric="count", shape="single") == ([], 0)
        assert aggregate([("a", None, 4, 2)], metric="sum", shape="single") == ([], 8)
        assert aggregate([("a", None, 4, 2), ("a", None, 1)], metric="avg", shape="single") == (
            [],
            3,
        )

    def test_value_key_spells_json_like_postgres(self):
        assert value_key(["a", "b"]) == '["a", "b"]'
        assert value_key({"k": "é"}) == '{"k": "é"}'

    @pytest.mark.parametrize(
        ("kwargs", "fast"),
        [
            ({}, True),
            ({"group_by": "type"}, True),
            ({"group_by": "data_quality_bucket", "group_by_2": "created_month"}, True),
            ({"card_type": "A", "group_by": "field:x", "group_by_2": "subtype"}, True),
            ({"group_by": "lifecycle_phase"}, False),
            ({"group_by": "type", "group_by_2": "lifecycle_phase"}, False),
            ({"lifecycle_phase": "active"}, False),
            ({"card_type": "A", "metric": "sum", "metric_field": "c"}, False),
        ],
    )
    def test_fast_path_applies(self, kwargs, fast):
        from app.services.dashboard_query import ResolvedQuery, fast_path_applies

        assert fast_path_applies(ResolvedQuery(query=Q(**kwargs))) is fast

    def test_a_sankey_is_never_fast(self):
        from app.services.dashboard_query import ResolvedQuery, fast_path_applies

        assert fast_path_applies(ResolvedQuery(query=Q(), relation=object())) is False  # type: ignore[arg-type]

    def test_sql_dimension_key(self):
        from app.services.dashboard_query import sql_dimension_key

        months = ["2026-10"]
        assert sql_dimension_key("data_quality_bucket", "25-50", months) == "25-50"
        assert sql_dimension_key("created_month", "2026-10", months) == "2026-10"
        assert sql_dimension_key("created_month", "2020-01", months) is None
        assert sql_dimension_key("created_month", None, months) is None
        assert sql_dimension_key("field:x", "", months) == "none"
        assert sql_dimension_key("field:x", None, months) == "none"
        assert sql_dimension_key("field:x", "true", months) == "true"


PARITY_FIELDS = [
    {
        "section": "General",
        "fields": [
            {
                "key": "criticality",
                "type": "single_select",
                "options": [{"key": "low"}, {"key": "mid"}, {"key": "high"}],
            },
            {"key": "internal", "type": "boolean"},
        ],
    }
]

PARITY_QUERIES = [
    {},
    {"card_type": "Application"},
    {"approval_status": "APPROVED"},
    {"group_by": "type"},
    {"group_by": "approval_status"},
    {"group_by": "data_quality_bucket"},
    {"group_by": "created_month"},
    {"card_type": "Application", "group_by": "subtype"},
    {"card_type": "Application", "subtype": "saas", "group_by": "approval_status"},
    {"card_type": "Application", "group_by": "field:criticality"},
    {"card_type": "Application", "group_by": "field:internal"},
    {"group_by": "type", "group_by_2": "approval_status"},
    {"group_by": "data_quality_bucket", "group_by_2": "created_month"},
    {"card_type": "Application", "group_by": "field:criticality", "group_by_2": "field:internal"},
    {"card_type": "Application", "group_by": "created_month", "group_by_2": "subtype"},
]


@pytest.fixture
async def parity_landscape(db):
    from app.models.card import Card

    await create_card_type(db, key="Application", label="Application", fields_schema=PARITY_FIELDS)
    await create_card_type(db, key="DataObject", label="Data Object")
    await create_card_type(db, key="Ghost", label="Ghost", is_hidden=True)
    now = datetime.now(timezone.utc)
    specs = [
        # (type, subtype, approval, dq, attributes, created_at)
        ("Application", "saas", "APPROVED", 0, {"criticality": "high", "internal": True}, now),
        ("Application", "saas", "DRAFT", 24.9, {"criticality": "low", "internal": False}, now),
        ("Application", None, "BROKEN", 25, {"criticality": "", "internal": None}, now),
        ("Application", "", "APPROVED", 49.99, {}, now - timedelta(days=40)),
        ("Application", "onprem", "APPROVED", 50, {"criticality": None}, now - timedelta(days=200)),
        (
            "Application",
            "onprem",
            "REJECTED",
            74.99,
            {"criticality": "mid"},
            now - timedelta(days=500),
        ),
        ("Application", "saas", "DRAFT", 75, {"criticality": "legacy"}, now - timedelta(days=400)),
        ("DataObject", None, "DRAFT", 100, {}, now - timedelta(days=10)),
        ("DataObject", "x", "APPROVED", 60, {}, now - timedelta(days=330)),
        ("Ghost", None, "DRAFT", 10, {}, now),
    ]
    for type_key, subtype, approval, dq, attrs, created in specs:
        card = await create_card(
            db,
            card_type=type_key,
            name=f"{type_key}-{dq}",
            subtype=subtype,
            approval_status=approval,
            data_quality=dq,
            attributes=attrs,
        )
        card.created_at = created
    await create_card(db, card_type="Application", name="Gone", status="ARCHIVED")
    await db.flush()
    # The ORM row must not hold a stale created_at for the Python path.
    db.expire_all()
    assert len((await db.execute(select(Card.id))).all()) == 11


class TestSqlFastPathParity:
    @pytest.mark.parametrize("kwargs", PARITY_QUERIES, ids=lambda k: metric_key(Q(**k)) or "all")
    async def test_both_paths_agree(self, db, parity_landscape, kwargs):
        from app.services.dashboard_query import fast_path_applies

        resolved = await resolve_query(db, Q(**kwargs))
        assert fast_path_applies(resolved)
        fast = await run_query(db, resolved, CardReadScope.everything())
        slow = await run_query(db, resolved, CardReadScope.everything(), force_python=True)
        assert fast == slow
        assert fast["total"] > 0

    async def test_the_paths_agree_for_a_restricted_reader(self, db, parity_landscape):
        scope = CardReadScope(
            role_key="r",
            wildcard=False,
            base_view=True,
            denied_types=frozenset({"DataObject"}),
            allowed_types=frozenset(),
            stakeholder_card_ids=frozenset(),
        )
        resolved = await resolve_query(db, Q(group_by="type"))
        fast = await run_query(db, resolved, scope)
        assert fast == await run_query(db, resolved, scope, force_python=True)
        assert fast["rows"] == [{"key": "Application", "value": 7}]

    async def test_a_few_exact_fast_path_answers(self, db, parity_landscape):
        everything = CardReadScope.everything()

        async def rows(**kwargs):
            return (await run_query(db, await resolve_query(db, Q(**kwargs)), everything))["rows"]

        assert await rows(group_by="data_quality_bucket") == [
            {"key": "0-25", "value": 2},
            {"key": "25-50", "value": 2},
            {"key": "50-75", "value": 3},
            {"key": "75-100", "value": 2},
        ]
        assert await rows(card_type="Application", group_by="field:criticality") == [
            {"key": "low", "value": 1},
            {"key": "mid", "value": 1},
            {"key": "high", "value": 1},
            {"key": "none", "value": 3},
            {"key": "legacy", "value": 1},
        ]
        assert await rows(card_type="Application", group_by="field:internal") == [
            {"key": "true", "value": 1},
            {"key": "false", "value": 1},
            {"key": "none", "value": 5},
        ]
        months = await rows(group_by="created_month")
        assert sum(r["value"] for r in months) == 7  # the 400- and 500-day-old cards drop out

    async def test_the_fast_path_groups_in_sql(self, db, parity_landscape):
        from sqlalchemy import event as sa_event

        statements: list[str] = []
        bind = db.sync_session.get_bind()

        def _record(conn, cursor, statement, parameters, context, executemany):
            if "FROM cards" in statement:
                statements.append(statement)

        everything = CardReadScope.everything()
        by_type = await resolve_query(db, Q(group_by="type", group_by_2="data_quality_bucket"))
        total = await resolve_query(db, Q())
        sa_event.listen(bind, "before_cursor_execute", _record)
        try:
            await run_query(db, by_type, everything)
            await run_query(db, total, everything)
            grouped, single = list(statements)
            statements.clear()
            await run_query(db, by_type, everything, force_python=True)
        finally:
            sa_event.remove(bind, "before_cursor_execute", _record)
        assert "GROUP BY" in grouped and "count(cards.id)" in grouped
        assert single.lstrip().startswith("SELECT count(cards.id)")
        assert "GROUP BY" not in single
        (per_card,) = statements
        assert "GROUP BY" not in per_card
