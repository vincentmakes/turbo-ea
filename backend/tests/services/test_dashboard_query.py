"""The dashboard aggregation engine: pure rules first, then the database half.

The pure functions decide every number a chart or KPI shows, so they are
tested value by value; the database tests check the rows a real query hands
them (only ACTIVE cards, no hidden type, the read scope, each dimension).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.stakeholder import Stakeholder
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_query import (
    OTHER_KEY,
    DashboardQuery,
    DashboardQueryError,
    RelationSide,
    ResolvedQuery,
    age_days,
    aggregate,
    base_query,
    canonical_flags,
    data_quality_bucket,
    dimension_domain,
    dimension_key,
    eol_coverage_key,
    find_field,
    flags_problem,
    fold_flows,
    fold_keyed,
    fold_rows,
    is_card_keyed,
    is_dimension,
    is_narrowed,
    last_months,
    lifecycle_key,
    measure_value,
    metric_key,
    month_key,
    numeric_value,
    order_keys,
    percent,
    phase_month_key,
    phase_months,
    query_problem,
    relation_specs,
    resolve_query,
    resolve_side,
    result_shape,
    row_keys,
    run_query,
    share_rows,
    split_side,
    tidy_number,
    value_key,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_user,
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

    def test_flags_the_frontend_mirrors(self):
        # Sorted, comma-joined, then URL-encoded like every other value.
        query = Q(card_type="Application", flags="stale,orphaned")
        assert metric_key(query) == "card_type=Application&flags=orphaned%2Cstale"

    def test_relation_dimensions_flags_and_measures(self):
        query = Q(
            card_type="Application",
            group_by="related:relAppToITC",
            flags="related:relAppToITC__out,eol_missing",
        )
        assert metric_key(query) == (
            "card_type=Application&flags=eol_missing%2Crelated%3ArelAppToITC__out"
            "&group_by=related%3ArelAppToITC"
        )
        query = Q(card_type="Application", metric="sum", metric_field="@relations:relAppToITC")
        assert metric_key(query) == (
            "card_type=Application&metric=sum&metric_field=%40relations%3ArelAppToITC"
        )

    def test_a_share_keeps_its_metric(self):
        query = Q(card_type="Application", metric="share", approval_status="APPROVED")
        assert metric_key(query) == "approval_status=APPROVED&card_type=Application&metric=share"

    def test_a_stored_widget_without_new_fields_keeps_its_key(self):
        stored = {"card_type": "Application", "group_by": "approval_status", "metric": "count"}
        assert metric_key(Q.model_validate(stored)) == (
            "card_type=Application&group_by=approval_status"
        )


class TestFlags:
    def test_canonical_flags(self):
        assert canonical_flags(" stale ,orphaned,,stale") == "orphaned,stale"
        assert canonical_flags("b,a,c") == "a,b,c"
        assert canonical_flags(" , ") is None
        assert canonical_flags("") is None
        assert canonical_flags(None) is None

    def test_the_query_canonicalises_on_validation(self):
        assert Q(flags="stale, orphaned").flags == "orphaned,stale"
        assert Q(flags=",").flags is None
        assert Q.model_validate({"flags": "eol_missing,eol_missing"}).flags == "eol_missing"
        assert Q(flags="x" * 300).flags == "x" * 300
        with pytest.raises(ValidationError):
            Q(flags="x" * 301)

    @pytest.mark.parametrize(
        ("flags", "problem"),
        [
            (None, None),
            ("orphaned,stale,with_stakeholders,eol_manual", None),
            ("without_stakeholders,eol_linked", None),
            ("eol_missing", None),
            ("bogus", "unknown_flag"),
            ("stale,bogus", "unknown_flag"),
            ("related:", "unknown_flag"),
            ("unrelated:", "unknown_flag"),
            ("Stale", "unknown_flag"),
            ("with_stakeholders,without_stakeholders", "flags_conflict"),
            ("eol_linked,eol_missing", "flags_conflict"),
            ("eol_linked,eol_manual", "flags_conflict"),
            ("eol_manual,eol_missing", "flags_conflict"),
            ("related:r,unrelated:r", "flags_conflict"),
            ("related:r__in,unrelated:r__out", None),
            ("related:r,unrelated:s", None),
            ("related:r,related:s", None),
        ],
    )
    def test_flags_problem(self, flags, problem):
        assert flags_problem(canonical_flags(flags)) == problem

    def test_relation_specs(self):
        query = Q(
            card_type="A",
            group_by="related:r",
            group_by_2="related:s__in",
            metric="sum",
            metric_field="@relations:t",
            flags="unrelated:u,related:v,stale",
        )
        # The flags are canonical (sorted) by then: related:v before unrelated:u.
        assert relation_specs(query) == ["r", "s__in", "t", "v", "u"]
        assert relation_specs(Q(card_type="A", group_by="type")) == []

    def test_narrowing_and_the_base_query(self):
        assert not is_narrowed(Q(card_type="A", group_by="type"))
        assert is_narrowed(Q(approval_status="APPROVED"))
        assert is_narrowed(Q(lifecycle_phase="active"))
        assert is_narrowed(Q(flags="stale"))
        query = Q(
            card_type="A",
            group_by="type",
            metric="share",
            approval_status="APPROVED",
            lifecycle_phase="active",
            flags="stale",
            subtype="saas",
        )
        assert base_query(query).model_dump(exclude_none=True) == {
            "card_type": "A",
            "group_by": "type",
            "metric": "count",
            "subtype": "saas",
        }


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
        assert is_dimension("eol_coverage")
        assert is_dimension("stakeholders")
        assert is_dimension("card")
        assert is_dimension("related:r")
        assert is_dimension("related:r__in")
        assert not is_dimension("related:")
        for phase in ("plan", "phaseIn", "active", "phaseOut", "endOfLife"):
            assert is_dimension(f"phase_month:{phase}")
        assert not is_dimension("phase_month:none")
        assert not is_dimension("phase_month:")

    def test_is_card_keyed(self):
        assert is_card_keyed("card")
        assert is_card_keyed("related:r")
        assert not is_card_keyed("related:")
        assert not is_card_keyed("type")
        assert not is_card_keyed(None)

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
            (Q(group_by="phase_month:retired"), "unknown_phase"),
            (Q(group_by="type", group_by_2="phase_month:"), "unknown_phase"),
            (Q(group_by="related:"), "unknown_dimension"),
            (Q(group_by="card"), "card_dimension_needs_card_type"),
            (Q(group_by="card", group_by_2="subtype"), "card_dimension_needs_card_type"),
            (Q(group_by="card", flags="related:r"), "card_dimension_needs_card_type"),
            (Q(group_by="type", group_by_2="card"), "card_dimension_not_second"),
            (Q(card_type="A", group_by="type", group_by_2="card"), "card_dimension_not_second"),
            (Q(card_type="A", group_by="card", group_by_2="card"), "card_dimension_not_second"),
            (Q(group_by="related:r"), "related_needs_card_type"),
            (Q(flags="related:r"), "related_needs_card_type"),
            (Q(flags="unrelated:r__in"), "related_needs_card_type"),
            (Q(metric="sum", metric_field="@relations:r"), "related_needs_card_type"),
            (Q(relation_type="r", group_by="related:x"), "relation_type_conflict"),
            (Q(relation_type="r", flags="related:x"), "relation_type_conflict"),
            (Q(relation_type="r", metric="share", flags="stale"), "relation_type_conflict"),
            (Q(metric="share"), "share_needs_filter"),
            (Q(card_type="A", metric="share", group_by="type"), "share_needs_filter"),
            (Q(card_type="A", metric="share", metric_field="c", flags="x"), "metric_field_unused"),
            (Q(metric="count", metric_field="@data_quality"), "metric_field_unused"),
            (Q(metric="sum", metric_field="@bogus"), "unknown_field"),
            (Q(metric="sum", metric_field="@relations:"), "unknown_field"),
            (Q(metric="avg", metric_field="@"), "unknown_field"),
            (Q(flags="bogus"), "unknown_flag"),
            (Q(flags="eol_linked,eol_missing"), "flags_conflict"),
            (Q(card_type="A", flags="related:r,unrelated:r"), "flags_conflict"),
            (Q(metric="share", flags="bogus"), "unknown_flag"),
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

    @pytest.mark.parametrize(
        "query",
        [
            Q(relation_type="r", group_by="card", group_by_2="card"),
            Q(relation_type="r", group_by="card", flags="stale,with_stakeholders"),
            Q(relation_type="r", group_by="type", group_by_2="card"),
            Q(card_type="A", group_by="card"),
            Q(card_type="A", group_by="card", metric="sum", metric_field="cost"),
            Q(card_type="A", group_by="card", metric="sum", metric_field="@relations:r"),
            Q(card_type="A", group_by="card", metric="avg", metric_field="@data_quality"),
            Q(card_type="A", group_by="card", group_by_2="lifecycle_phase"),
            Q(relation_type="r", group_by="eol_coverage", group_by_2="phase_month:active"),
            Q(group_by="eol_coverage"),
            Q(group_by="stakeholders", group_by_2="type"),
            Q(group_by="phase_month:endOfLife"),
            Q(card_type="A", group_by="related:r"),
            Q(card_type="A", group_by="related:r__out", group_by_2="related:s"),
            Q(card_type="A", flags="related:r__in,unrelated:r__out"),
            Q(card_type="A", metric="sum", metric_field="@relations:r"),
            Q(metric="avg", metric_field="@data_quality"),
            Q(metric="sum", metric_field="@age_days", group_by="type"),
            Q(metric="share", approval_status="APPROVED"),
            Q(metric="share", lifecycle_phase="active", group_by="type"),
            Q(metric="share", flags="orphaned"),
            Q(flags="orphaned,stale,without_stakeholders,eol_missing"),
        ],
    )
    def test_the_new_shapes_are_fine(self, query):
        assert query_problem(query) is None


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


class TestNewPureHelpers:
    def test_phase_months_is_six_back_and_eleven_ahead(self):
        assert phase_months(date(2026, 10, 29)) == [
            "2026-04",
            "2026-05",
            "2026-06",
            "2026-07",
            "2026-08",
            "2026-09",
            "2026-10",
            "2026-11",
            "2026-12",
            "2027-01",
            "2027-02",
            "2027-03",
            "2027-04",
            "2027-05",
            "2027-06",
            "2027-07",
            "2027-08",
            "2027-09",
        ]

    def test_phase_months_crosses_years_both_ways(self):
        months = phase_months(date(2026, 1, 1))
        assert len(months) == 18
        assert months[0] == "2025-07"
        assert months[6] == "2026-01"
        assert months[-1] == "2026-12"
        assert phase_months(date(2026, 12, 31))[-1] == "2027-11"

    def test_phase_month_key(self):
        window = phase_months(date(2026, 10, 29))
        assert phase_month_key({"active": "2026-11-03"}, "active", window) == "2026-11"
        assert phase_month_key({"active": "2026-04-01T08:00:00"}, "active", window) == "2026-04"
        assert phase_month_key({"active": "2026-03-31"}, "active", window) is None
        assert phase_month_key({"active": "2027-10-01"}, "active", window) is None
        assert phase_month_key({"active": "2027-09-30"}, "active", window) == "2027-09"
        assert phase_month_key({"plan": "2026-11-03"}, "active", window) is None
        assert phase_month_key({"active": "soon"}, "active", window) is None
        assert phase_month_key(None, "active", window) is None
        assert phase_month_key(["2026-11-03"], "active", window) is None

    def test_eol_coverage_key(self):
        link = {"eol_product": "nginx", "eol_cycle": "1.25"}
        assert eol_coverage_key(["Application", link, {}]) == "linked"
        assert eol_coverage_key(["ITComponent", link, {"endOfLife": "2027-01-01"}]) == "linked"
        assert (
            eol_coverage_key(["ITComponent", {"eol_product": "x"}, {"endOfLife": "2027-01-01"}])
            == "manual"
        )
        assert eol_coverage_key(["ITComponent", {}, {}]) == "missing"
        assert eol_coverage_key(["ITComponent", None, None]) == "missing"
        assert eol_coverage_key(["ITComponent", ["x"], ["y"]]) == "missing"
        assert eol_coverage_key(["Organization", link, {}]) is None
        assert eol_coverage_key(None) is None
        assert eol_coverage_key(["ITComponent", {}]) is None

    def test_age_days(self):
        today = date(2026, 10, 29)
        assert age_days(datetime(2026, 10, 1, 23, 30, tzinfo=timezone.utc), today) == 28
        assert age_days(datetime(2026, 10, 29, 0, 0, tzinfo=timezone.utc), today) == 0
        # Read in UTC: 01:00 on the 2nd at +02:00 is 23:00 on the 1st in UTC.
        plus_two = timezone(timedelta(hours=2))
        assert age_days(datetime(2026, 10, 2, 1, 0, tzinfo=plus_two), today) == 28
        assert age_days(datetime(2026, 10, 2, 1, 0), today) == 27
        assert age_days(None, today) is None
        assert age_days("2026-10-01", today) is None

    def test_measure_value(self):
        today = date(2026, 10, 29)
        created = datetime(2026, 10, 19, tzinfo=timezone.utc)
        assert measure_value("@age_days", created, today) == 10
        assert measure_value("@data_quality", 55.5, today) == 55.5
        assert measure_value("cost", "12", today) == "12"
        assert measure_value(None, 3, today) is None

    def test_new_dimension_keys(self):
        window = phase_months(date(2026, 10, 29))
        assert dimension_key("eol_coverage", ["ITComponent", {}, {}], [], window) == "missing"
        assert dimension_key("eol_coverage", ["Organization", {}, {}], [], window) is None
        assert dimension_key("stakeholders", True, []) == "true"
        assert dimension_key("stakeholders", False, []) == "false"
        assert dimension_key("card", "abc", []) == "abc"
        assert dimension_key("related:r", None, []) == "none"
        lifecycle = {"phaseOut": "2027-02-14"}
        assert dimension_key("phase_month:phaseOut", lifecycle, [], window) == "2027-02"
        assert dimension_key("phase_month:phaseOut", lifecycle, []) is None

    def test_new_dimension_domains(self):
        window = ["2026-10", "2026-11"]
        assert dimension_domain("eol_coverage", None, []) == ["linked", "manual", "missing"]
        assert dimension_domain("stakeholders", None, []) == ["true", "false"]
        assert dimension_domain("phase_month:active", None, [], window) == window
        assert dimension_domain("related:r", None, [], window) == []
        assert dimension_domain("card", None, [], window) == []

    def test_percent(self):
        assert percent(1, 3) == 33.33
        assert percent(2, 2) == 100
        assert isinstance(percent(2, 2), int)
        assert percent(0, 5) == 0
        assert percent(3, 0) == 0
        assert percent(1, 8) == 12.5

    def test_share_rows_keyed(self):
        full = [{"key": "a", "value": 1}, {"key": "c", "value": 2}]
        base = [{"key": "a", "value": 4}, {"key": "b", "value": 0}, {"key": "c", "value": 3}]
        rows, total = share_rows(full, base, 3, 7)
        assert rows == [
            {"key": "a", "value": 25},
            {"key": "b", "value": 0},
            {"key": "c", "value": 66.67},
        ]
        assert total == 42.86
        assert share_rows([], [], 0, 0) == ([], 0)

    def test_share_rows_grid_matches_both_axes(self):
        full = [{"x": "a", "y": "p", "value": 1}]
        base = [{"x": "a", "y": "p", "value": 2}, {"x": "a", "y": "q", "value": 2}]
        rows, total = share_rows(full, base, 1, 4)
        assert rows == [{"x": "a", "y": "p", "value": 50}, {"x": "a", "y": "q", "value": 0}]
        assert total == 25

    def test_fold_keyed(self):
        rows = [
            {"key": "a", "value": 5},
            {"key": "none", "value": 4},
            {"key": "c", "value": 3},
            {"key": "b", "value": 3},
            {"key": "d", "value": 1.5},
        ]
        # Ties go to the smaller key; ``none`` is never folded nor counted.
        assert fold_keyed(rows, 2) == [
            {"key": "a", "value": 5},
            {"key": "none", "value": 4},
            {"key": "b", "value": 3},
            {"key": OTHER_KEY, "value": 4.5},
        ]
        assert fold_keyed(rows, 2, merge=False) == [
            {"key": "a", "value": 5},
            {"key": "none", "value": 4},
            {"key": "b", "value": 3},
        ]
        assert fold_keyed(rows, 4) == rows
        assert fold_keyed(rows, 3)[-1] == {"key": OTHER_KEY, "value": 1.5}
        assert fold_keyed([], 1) == []

    def test_fold_flows(self):
        rows = [
            {"source": "s1", "target": "t1", "value": 3},
            {"source": "s2", "target": "t1", "value": 2},
            {"source": "s3", "target": "t2", "value": 2},
            {"source": "s2", "target": "t2", "value": 1},
        ]
        # Sources: s1 = 3, s2 = 3, s3 = 2 → keep s1 (tie by key); targets t1.
        # Re-sorted like ``aggregate``: largest first, then by source, target.
        assert fold_flows(rows, 1) == [
            {"source": OTHER_KEY, "target": OTHER_KEY, "value": 3},
            {"source": "s1", "target": "t1", "value": 3},
            {"source": OTHER_KEY, "target": "t1", "value": 2},
        ]
        # Only the source side is card-keyed: targets stay as they are.
        assert fold_flows(rows, 2, sides=["source"]) == [
            {"source": "s1", "target": "t1", "value": 3},
            {"source": OTHER_KEY, "target": "t2", "value": 2},
            {"source": "s2", "target": "t1", "value": 2},
            {"source": "s2", "target": "t2", "value": 1},
        ]
        assert fold_flows(rows, 2, sides=["target"]) == rows
        assert fold_flows(rows, 3, sides=[]) == rows

    def test_fold_rows_only_folds_card_keyed_results(self):
        keyed = [{"key": "a", "value": 2}, {"key": "b", "value": 1}]
        related = ResolvedQuery(query=Q(card_type="A", group_by="related:r"))
        assert fold_rows(keyed, related, 1) == (
            [{"key": "a", "value": 2}, {"key": OTHER_KEY, "value": 1}],
            1,
        )
        averaged = ResolvedQuery(
            query=Q(card_type="A", group_by="related:r", metric="avg", metric_field="x")
        )
        assert fold_rows(keyed, averaged, 1) == ([{"key": "a", "value": 2}], 1)
        summed = ResolvedQuery(
            query=Q(card_type="A", group_by="related:r", metric="sum", metric_field="x")
        )
        assert fold_rows(keyed, summed, 1)[0][-1] == {"key": OTHER_KEY, "value": 1}
        by_type = ResolvedQuery(query=Q(group_by="type"))
        assert fold_rows(keyed, by_type, 1) == (keyed, 0)
        # Each card of a type folds like a related card: a count or a sum
        # merges the rest, an average or a share drops it.
        each = {"card_type": "A", "group_by": "card"}
        for metric, extra, merged in (
            ("count", {}, True),
            ("sum", {"metric_field": "x"}, True),
            ("avg", {"metric_field": "x"}, False),
            ("share", {"flags": "stale"}, False),
        ):
            resolved = ResolvedQuery(query=Q(**each, metric=metric, **extra))
            folded, count = fold_rows(keyed, resolved, 1)
            assert folded[0] == {"key": "a", "value": 2}
            assert (folded[-1] == {"key": OTHER_KEY, "value": 1}) is merged
            assert len(folded) == (2 if merged else 1)
            assert count == 1
        flows = [
            {"source": "a", "target": "x", "value": 2},
            {"source": "b", "target": "y", "value": 1},
        ]
        rel = object()
        cards = ResolvedQuery(query=Q(group_by="card"), relation=rel)  # type: ignore[arg-type]
        assert fold_rows(flows, cards, 1) == (
            [
                {"source": "a", "target": "x", "value": 2},
                {"source": OTHER_KEY, "target": "y", "value": 1},
            ],
            1,
        )
        targets = ResolvedQuery(query=Q(group_by_2="card"), relation=rel)  # type: ignore[arg-type]
        assert fold_rows(flows, targets, 1)[0][-1] == {
            "source": "b",
            "target": OTHER_KEY,
            "value": 1,
        }
        types = ResolvedQuery(query=Q(), relation=rel)  # type: ignore[arg-type]
        assert fold_rows(flows, types, 1) == (flows, 0)

    def test_fold_rows_counts_the_cards_not_kept(self):
        # 25 cards valued 25..1 (and ``none``, never a card): the top 20 stay,
        # the 5 smallest (5+4+3+2+1) fold into Other.
        keyed = [{"key": f"c{n:02d}", "value": n} for n in range(25, 0, -1)]
        keyed.append({"key": "none", "value": 100})
        each = ResolvedQuery(query=Q(card_type="A", group_by="card"))
        rows, folded = fold_rows(keyed, each, 20)
        assert folded == 5
        assert rows[-1] == {"key": OTHER_KEY, "value": 15}
        assert len(rows) == 22
        assert {"key": "none", "value": 100} in rows
        # An average drops the same 5 instead of merging them.
        averaged = ResolvedQuery(
            query=Q(card_type="A", group_by="card", metric="avg", metric_field="x")
        )
        rows, folded = fold_rows(keyed, averaged, 20)
        assert folded == 5
        assert OTHER_KEY not in {r["key"] for r in rows}
        assert len(rows) == 21
        # Under ``top`` nothing folds and nothing is counted.
        assert fold_rows(keyed, each, 25) == (keyed, 0)
        assert fold_rows(keyed[:3], each, 20) == (keyed[:3], 0)

    def test_fold_rows_counts_each_folded_sankey_end(self):
        # 30 sources over 3 targets; the source with value n flows to t{n % 3}.
        flows = [{"source": f"s{n:02d}", "target": f"t{n % 3}", "value": n} for n in range(1, 31)]
        rel = object()
        sources = ResolvedQuery(query=Q(group_by="card"), relation=rel)  # type: ignore[arg-type]
        rows, folded = fold_rows(flows, sources, 20)
        assert folded == 10
        assert {r["target"] for r in rows} == {"t0", "t1", "t2"}
        assert sum(r["value"] for r in rows if r["source"] == OTHER_KEY) == sum(range(1, 11))
        # Both ends card-keyed: the sources' 10 and the targets' 1 (top=2).
        both = ResolvedQuery(
            query=Q(group_by="card", group_by_2="card"),
            relation=rel,  # type: ignore[arg-type]
        )
        assert fold_rows(flows, both, 20)[1] == 10
        assert fold_rows(flows, both, 2)[1] == 28 + 1
        # A card at both ends counts once per end.
        loop = [
            {"source": "a", "target": "a", "value": 1},
            {"source": "b", "target": "c", "value": 2},
        ]
        assert fold_rows(loop, both, 1)[1] == 2
        assert fold_rows(flows, both, 30) == (fold_flows(flows, 30), 0)

    def test_row_keys(self):
        rows = [{"key": "a", "value": 1}, {"source": "b", "target": "c", "value": 1}]
        assert row_keys(rows) == {"a", "b", "c"}
        assert row_keys([{"x": 1, "y": "d", "value": 2}]) == {"1", "d"}

    def test_split_side(self):
        assert split_side("rel__out") == ("rel", "out")
        assert split_side("rel__in") == ("rel", "in")
        assert split_side("rel") == ("rel", None)
        assert split_side("rel__up") == ("rel__up", None)
        assert split_side("__out") == ("__out", None)
        assert split_side("a__b__in") == ("a__b", "in")


def _rt(source, target, hidden=False):
    return SimpleNamespace(source_type_key=source, target_type_key=target, is_hidden=hidden)


class TestResolveSide:
    RTS = {
        "appToIt": _rt("Application", "ITComponent"),
        "dependsOn": _rt("Application", "Application"),
        "hidden": _rt("Application", "ITComponent", hidden=True),
        "odd__out": _rt("Application", "ITComponent"),
    }

    def _side(self, spec, card_type="Application", code="unknown_dimension"):
        return resolve_side(spec, card_type, self.RTS, bad_suffix=code)

    def test_a_cross_type_relation_by_its_bare_key(self):
        assert self._side("appToIt") == RelationSide("appToIt", True)
        assert self._side("appToIt", "ITComponent") == RelationSide("appToIt", False)
        # A key that merely looks suffixed is still a bare key.
        assert self._side("odd__out") == RelationSide("odd__out", True)

    def test_a_self_referencing_relation_by_side(self):
        assert self._side("dependsOn__out") == RelationSide("dependsOn", True)
        assert self._side("dependsOn__in") == RelationSide("dependsOn", False)

    @pytest.mark.parametrize(
        ("spec", "card_type", "code"),
        [
            ("dependsOn", "Application", "relation_side_required"),
            ("appToIt__out", "Application", "unknown_dimension"),
            ("appToIt__in", "ITComponent", "unknown_dimension"),
            ("nope", "Application", "unknown_relation_type"),
            ("hidden", "Application", "unknown_relation_type"),
            ("appToIt", "Organization", "unknown_relation_type"),
            ("dependsOn__out", "ITComponent", "unknown_relation_type"),
        ],
    )
    def test_refusals(self, spec, card_type, code):
        with pytest.raises(DashboardQueryError) as exc:
            self._side(spec, card_type)
        assert exc.value.code == code

    def test_the_context_names_its_own_suffix_code(self):
        for code in ("unknown_flag", "unknown_field"):
            with pytest.raises(DashboardQueryError) as exc:
                self._side("appToIt__out", code=code)
            assert exc.value.code == code


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


RESTRICTED_NO_IT = CardReadScope(
    role_key="r",
    wildcard=False,
    base_view=True,
    denied_types=frozenset({"ITComponent"}),
    allowed_types=frozenset(),
    stakeholder_card_ids=frozenset(),
)


async def _add_it2(db, landscape):
    """A second IT component that only A1 uses: A1 now has two related cards."""
    it2 = await create_card(db, card_type="ITComponent", name="IT2")
    await create_relation(db, type_key="appToIt", source_id=landscape["a1"].id, target_id=it2.id)
    return it2


def _flow_set(rows):
    return {(r["source"], r["target"], r["value"]) for r in rows}


class TestRelatedCards:
    async def test_rows_labels_and_an_unduplicated_total(self, db, landscape):
        it1, it2 = landscape["it"], await _add_it2(db, landscape)
        result = await _run(db, card_type="Application", group_by="related:appToIt")
        assert result == {
            "dimension": "related:appToIt",
            "dimension_2": None,
            "rows": [
                {"key": str(it1.id), "value": 2},
                {"key": str(it2.id), "value": 1},
                {"key": "none", "value": 1},
            ],
            # A1 sits under both IT components but is one card.
            "total": 3,
            "labels": {str(it1.id): "IT1", str(it2.id): "IT2"},
        }

    async def test_a_sum_counts_each_card_once_in_the_total(self, db, landscape):
        it1, it2 = landscape["it"], await _add_it2(db, landscape)
        result = await _run(
            db,
            card_type="Application",
            group_by="related:appToIt",
            metric="sum",
            metric_field="cost",
        )
        assert result["rows"] == [
            {"key": str(it1.id), "value": 150},
            {"key": str(it2.id), "value": 100},
            {"key": "none", "value": 0},
        ]
        assert result["total"] == 150

    async def test_the_target_end_reads_its_sources(self, db, landscape):
        await _add_it2(db, landscape)
        a1, a2 = landscape["a1"], landscape["a2"]
        result = await _run(db, card_type="ITComponent", group_by="related:appToIt")
        assert result["rows"] == [{"key": str(a1.id), "value": 2}, {"key": str(a2.id), "value": 1}]
        assert result["total"] == 2
        assert result["labels"] == {str(a1.id): "A1", str(a2.id): "A2"}

    async def test_an_unreadable_related_card_leaves_the_card_in_none(self, db, landscape):
        it2 = await _add_it2(db, landscape)
        result = await _run(
            db, RESTRICTED_NO_IT, card_type="Application", group_by="related:appToIt"
        )
        assert result["rows"] == [{"key": "none", "value": 3}]
        assert result["total"] == 3
        assert result["labels"] == {}
        text = repr(result)
        for hidden in (landscape["it"], it2):
            assert str(hidden.id) not in text
            assert hidden.name not in text

    async def test_an_archived_related_card_does_not_count(self, db, landscape):
        it2 = await _add_it2(db, landscape)
        it2.status = "ARCHIVED"
        await db.flush()
        result = await _run(db, card_type="Application", group_by="related:appToIt")
        assert result["rows"] == [
            {"key": str(landscape["it"].id), "value": 2},
            {"key": "none", "value": 1},
        ]
        assert result["labels"] == {str(landscape["it"].id): "IT1"}

    async def test_top_folds_the_smaller_cards(self, db, landscape):
        it1 = landscape["it"]
        await _add_it2(db, landscape)
        resolved = await resolve_query(db, Q(card_type="Application", group_by="related:appToIt"))
        result = await run_query(db, resolved, CardReadScope.everything(), top=1)
        assert result["rows"] == [
            {"key": str(it1.id), "value": 2},
            {"key": "none", "value": 1},
            {"key": OTHER_KEY, "value": 1},
        ]
        assert result["labels"] == {str(it1.id): "IT1"}
        assert result["total"] == 3

    async def test_a_heatmap_with_a_related_axis_is_labelled(self, db, landscape):
        it1 = landscape["it"]
        result = await _run(
            db, card_type="Application", group_by="approval_status", group_by_2="related:appToIt"
        )
        assert result["rows"] == [
            {"x": "APPROVED", "y": str(it1.id), "value": 1},
            {"x": "BROKEN", "y": "none", "value": 1},
            {"x": "DRAFT", "y": str(it1.id), "value": 1},
        ]
        assert result["labels"] == {str(it1.id): "IT1"}

    async def test_a_plain_dimension_has_no_labels(self, db, landscape):
        assert "labels" not in await _run(db, group_by="type")
        assert "labels" not in await _run(db, relation_type="appToIt")


class TestSankeyCards:
    async def test_card_on_both_ends(self, db, landscape):
        a1, a2, it1 = landscape["a1"], landscape["a2"], landscape["it"]
        it2 = await _add_it2(db, landscape)
        result = await _run(db, relation_type="appToIt", group_by="card", group_by_2="card")
        assert result["dimension"] == "card"
        assert result["dimension_2"] == "card"
        assert _flow_set(result["rows"]) == {
            (str(a1.id), str(it1.id), 1),
            (str(a1.id), str(it2.id), 1),
            (str(a2.id), str(it1.id), 1),
        }
        assert result["total"] == 3
        assert result["labels"] == {
            str(a1.id): "A1",
            str(a2.id): "A2",
            str(it1.id): "IT1",
            str(it2.id): "IT2",
        }

    async def test_top_folds_each_card_end(self, db, landscape):
        a1, it1 = landscape["a1"], landscape["it"]
        await _add_it2(db, landscape)
        resolved = await resolve_query(
            db, Q(relation_type="appToIt", group_by="card", group_by_2="card")
        )
        result = await run_query(db, resolved, CardReadScope.everything(), top=1)
        assert _flow_set(result["rows"]) == {
            (str(a1.id), str(it1.id), 1),
            (str(a1.id), OTHER_KEY, 1),
            (OTHER_KEY, str(it1.id), 1),
        }
        assert result["labels"] == {str(a1.id): "A1", str(it1.id): "IT1"}
        assert result["total"] == 3
        # One application and one IT component folded, one per end.
        assert result["folded"] == {"top": 1, "cards": 2}
        unfolded = await run_query(db, resolved, CardReadScope.everything(), top=2)
        assert "folded" not in unfolded

    async def test_a_type_end_is_never_folded_nor_labelled(self, db, landscape):
        a1, a2 = landscape["a1"], landscape["a2"]
        await _add_it2(db, landscape)
        resolved = await resolve_query(db, Q(relation_type="appToIt", group_by="card"))
        result = await run_query(db, resolved, CardReadScope.everything(), top=1)
        assert result["rows"] == [
            {"source": str(a1.id), "target": "ITComponent", "value": 2},
            {"source": OTHER_KEY, "target": "ITComponent", "value": 1},
        ]
        assert result["labels"] == {str(a1.id): "A1"}
        unfolded = await run_query(db, resolved, CardReadScope.everything())
        assert unfolded["labels"] == {str(a1.id): "A1", str(a2.id): "A2"}

    async def test_a_restricted_reader_sees_no_pair_with_a_hidden_end(self, db, landscape):
        result = await _run(
            db, RESTRICTED_NO_IT, relation_type="appToIt", group_by="card", group_by_2="card"
        )
        assert result["rows"] == []
        assert result["labels"] == {}

    async def test_flags_hold_for_both_ends(self, db, landscape):
        # IT1 has no stakeholder, so no pair survives "with stakeholders".
        assert (await _run(db, relation_type="appToIt", flags="without_stakeholders"))["total"] == 2
        assert (await _run(db, relation_type="appToIt", flags="with_stakeholders"))["total"] == 0


class TestEachCardOfAType:
    """``group_by="card"`` with a ``card_type`` and no relation: one row per
    card (cost per application, applications by IT components)."""

    async def _a3(self, db):
        from app.models.card import Card

        return (await db.execute(select(Card).where(Card.name == "A3"))).scalar_one()

    async def test_one_row_per_readable_card_named_in_labels(self, db, landscape):
        a1, a2, a3 = landscape["a1"], landscape["a2"], await self._a3(db)
        resolved = await resolve_query(db, Q(card_type="Application", group_by="card"))
        assert resolved.dimension == "card"
        result = await run_query(db, resolved, CardReadScope.everything())
        # Equal counts order by key; the archived card and the IT component
        # are not Applications that count.
        ids = sorted(str(c.id) for c in (a1, a2, a3))
        assert result == {
            "dimension": "card",
            "dimension_2": None,
            "rows": [{"key": k, "value": 1} for k in ids],
            "total": 3,
            "labels": {str(a1.id): "A1", str(a2.id): "A2", str(a3.id): "A3"},
        }
        # The same answer whichever path is asked for (it is never SQL-grouped).
        assert await run_query(db, resolved, CardReadScope.everything(), force_python=True) == (
            result
        )

    async def test_relations_per_card(self, db, landscape):
        a1, a2, a3 = landscape["a1"], landscape["a2"], await self._a3(db)
        await _add_it2(db, landscape)
        result = await _run(
            db,
            card_type="Application",
            group_by="card",
            metric="sum",
            metric_field="@relations:appToIt",
        )
        assert result["rows"] == [
            {"key": str(a1.id), "value": 2},
            {"key": str(a2.id), "value": 1},
            {"key": str(a3.id), "value": 0},
        ]
        assert result["total"] == 3
        assert result["labels"] == {str(a1.id): "A1", str(a2.id): "A2", str(a3.id): "A3"}

    async def test_a_cost_treemap_counts_the_fiscal_year_only(self, db, landscape):
        a1, a2, a3 = landscape["a1"], landscape["a2"], await self._a3(db)
        today = datetime.now(timezone.utc).date()
        await create_card(
            db,
            card_type="Application",
            name="Next year",
            attributes={"cost": 1000},
            lifecycle={"active": (today + timedelta(days=400)).isoformat()},
        )
        await create_card(
            db,
            card_type="Application",
            name="Retired",
            attributes={"cost": 7},
            lifecycle={"endOfLife": (today - timedelta(days=800)).isoformat()},
        )
        result = await _run(
            db, card_type="Application", group_by="card", metric="sum", metric_field="cost"
        )
        # A1 (active last month) and A2 (no lifecycle) carry their cost, A3
        # has none; the card going live next year and the retired one are
        # not tiles at all, nor named.
        assert result == {
            "dimension": "card",
            "dimension_2": None,
            "rows": [
                {"key": str(a1.id), "value": 100},
                {"key": str(a2.id), "value": 50},
                {"key": str(a3.id), "value": 0},
            ],
            "total": 150,
            "labels": {str(a1.id): "A1", str(a2.id): "A2", str(a3.id): "A3"},
            "fiscal_year": today.year,
            "fiscal_year_start": 1,
        }

    async def test_top_folds_the_rest_into_other(self, db, landscape):
        a1 = landscape["a1"]
        resolved = await resolve_query(
            db, Q(card_type="Application", group_by="card", metric="sum", metric_field="cost")
        )
        result = await run_query(db, resolved, CardReadScope.everything(), top=1)
        assert result["rows"] == [
            {"key": str(a1.id), "value": 100},
            {"key": OTHER_KEY, "value": 50},
        ]
        assert result["labels"] == {str(a1.id): "A1"}
        assert result["total"] == 150

        counted = await resolve_query(db, Q(card_type="Application", group_by="card"))
        result = await run_query(db, counted, CardReadScope.everything(), top=2)
        assert [r["value"] for r in result["rows"]] == [1, 1, 1]
        assert result["rows"][-1]["key"] == OTHER_KEY
        assert len(result["labels"]) == 2
        assert set(result["labels"]) == {r["key"] for r in result["rows"][:2]}

    async def test_an_average_drops_the_rest(self, db, landscape):
        a1 = landscape["a1"]
        resolved = await resolve_query(
            db, Q(card_type="Application", group_by="card", metric="avg", metric_field="cost")
        )
        result = await run_query(db, resolved, CardReadScope.everything(), top=1)
        assert result["rows"] == [{"key": str(a1.id), "value": 100}]
        assert result["labels"] == {str(a1.id): "A1"}
        assert result["total"] == 75

    async def test_an_unreadable_card_never_appears(self, db, landscape):
        a1 = landscape["a1"]
        only_a1 = CardReadScope(
            role_key="r",
            wildcard=False,
            base_view=True,
            denied_types=frozenset({"Application"}),
            allowed_types=frozenset(),
            stakeholder_card_ids=frozenset({a1.id}),
        )
        result = await _run(db, only_a1, card_type="Application", group_by="card")
        assert result["rows"] == [{"key": str(a1.id), "value": 1}]
        assert result["labels"] == {str(a1.id): "A1"}
        assert result["total"] == 1
        result = await _run(db, RESTRICTED_NO_IT, card_type="ITComponent", group_by="card")
        assert result == {
            "dimension": "card",
            "dimension_2": None,
            "rows": [],
            "total": 0,
            "labels": {},
        }

    async def test_a_hidden_type_is_unknown(self, db, landscape):
        with pytest.raises(DashboardQueryError) as exc:
            await resolve_query(db, Q(card_type="Ghost", group_by="card"))
        assert exc.value.code == "unknown_card_type"


class TestMeasures:
    async def test_relations_counts_the_cards_side(self, db, landscape):
        await _add_it2(db, landscape)
        result = await _run(
            db,
            card_type="Application",
            metric="sum",
            metric_field="@relations:appToIt",
            group_by="field:criticality",
        )
        assert result["rows"] == [{"key": "low", "value": 0}, {"key": "high", "value": 3}]
        assert result["total"] == 3
        avg = await _run(
            db, card_type="Application", metric="avg", metric_field="@relations:appToIt"
        )
        assert avg["total"] == 1
        target = await _run(
            db, card_type="ITComponent", metric="sum", metric_field="@relations:appToIt"
        )
        assert target["total"] == 3

    async def test_relations_skip_an_unreadable_other_end(self, db, landscape):
        result = await _run(
            db,
            RESTRICTED_NO_IT,
            card_type="Application",
            metric="sum",
            metric_field="@relations:appToIt",
        )
        assert result["total"] == 0

    async def test_relations_on_a_self_referencing_type(self, db, landscape):
        await create_relation_type(
            db,
            key="dependsOn",
            label="depends on",
            source_type_key="Application",
            target_type_key="Application",
        )
        a1, a2 = landscape["a1"], landscape["a2"]
        await create_relation(db, type_key="dependsOn", source_id=a1.id, target_id=a2.id)
        out = await _run(
            db,
            card_type="Application",
            metric="sum",
            metric_field="@relations:dependsOn__out",
            group_by="approval_status",
        )
        assert out["rows"] == [
            {"key": "APPROVED", "value": 1},
            {"key": "BROKEN", "value": 0},
            {"key": "DRAFT", "value": 0},
        ]
        inbound = await _run(
            db,
            card_type="Application",
            metric="sum",
            metric_field="@relations:dependsOn__in",
            group_by="approval_status",
        )
        assert inbound["rows"][0] == {"key": "DRAFT", "value": 1}
        related = await _run(db, card_type="Application", group_by="related:dependsOn__in")
        assert related["rows"] == [{"key": "none", "value": 2}, {"key": str(a1.id), "value": 1}]
        assert related["labels"] == {str(a1.id): "A1"}

    async def test_data_quality(self, db, landscape):
        avg = await _run(db, card_type="Application", metric="avg", metric_field="@data_quality")
        assert avg["total"] == 40
        everywhere = await _run(db, metric="avg", metric_field="@data_quality")
        assert everywhere["total"] == 45
        total = await _run(db, metric="sum", metric_field="@data_quality", group_by="type")
        assert total["rows"] == [
            {"key": "Application", "value": 120},
            {"key": "ITComponent", "value": 60},
        ]

    async def test_age_days(self, db, landscape):
        now = datetime.now(timezone.utc)
        for name, days in (("a1", 10), ("a2", 20), ("it", 33)):
            landscape[name].created_at = now - timedelta(days=days)
        await db.flush()
        result = await _run(
            db,
            metric="avg",
            metric_field="@age_days",
            group_by="type",
            approval_status="DRAFT",
        )
        assert result["rows"] == [
            {"key": "ITComponent", "value": 33},
            {"key": "Application", "value": 20},
        ]
        assert result["total"] == 26.5


class TestFlagsAndShares:
    async def test_relation_flags(self, db, landscape):
        assert (await _run(db, card_type="Application", flags="related:appToIt"))["total"] == 2
        assert (await _run(db, card_type="Application", flags="unrelated:appToIt"))["total"] == 1
        assert (await _run(db, card_type="ITComponent", flags="related:appToIt"))["total"] == 1
        hidden = await _run(db, RESTRICTED_NO_IT, card_type="Application", flags="related:appToIt")
        assert hidden["total"] == 0

    async def test_health_flags(self, db, landscape):
        landscape["a2"].updated_at = datetime.now(timezone.utc) - timedelta(days=200)
        await db.flush()
        assert (await _run(db, flags="stale"))["total"] == 1
        assert (await _run(db, flags="orphaned", group_by="type"))["rows"] == [
            {"key": "Application", "value": 1}
        ]
        assert (await _run(db, flags="without_stakeholders"))["total"] == 4

    async def test_a_keyed_share(self, db, landscape):
        result = await _run(
            db,
            card_type="Application",
            metric="share",
            approval_status="APPROVED",
            group_by="field:criticality",
        )
        assert result == {
            "dimension": "field:criticality",
            "dimension_2": None,
            "rows": [{"key": "low", "value": 0}, {"key": "high", "value": 50}],
            "total": 33.33,
        }

    async def test_a_share_by_type_and_a_single_share(self, db, landscape):
        result = await _run(db, metric="share", approval_status="DRAFT", group_by="type")
        assert result["rows"] == [
            {"key": "Application", "value": 33.33},
            {"key": "ITComponent", "value": 100},
        ]
        assert result["total"] == 50
        flagged = await _run(db, card_type="Application", metric="share", flags="related:appToIt")
        assert flagged["rows"] == []
        assert flagged["total"] == 66.67
        phase = await _run(db, card_type="Application", metric="share", lifecycle_phase="active")
        assert phase["total"] == 33.33


class TestPhaseMonths:
    async def test_the_active_month_in_an_eighteen_month_window(self, db, landscape):
        today = datetime.now(timezone.utc).date()
        result = await _run(db, group_by="phase_month:active")
        assert [r["key"] for r in result["rows"]] == phase_months(today)
        active = date.fromisoformat(landscape["a1"].lifecycle["active"])
        expected = f"{active.year:04d}-{active.month:02d}"
        assert [r for r in result["rows"] if r["value"]] == [{"key": expected, "value": 1}]
        assert result["total"] == 1


class TestCostsCountInTheFiscalYear:
    async def _future_and_retired(self, db):
        today = datetime.now(timezone.utc).date()
        await create_card(
            db,
            card_type="Application",
            name="Next year",
            attributes={"criticality": "high", "cost": 1000},
            lifecycle={"active": (today + timedelta(days=400)).isoformat()},
        )
        await create_card(
            db,
            card_type="Application",
            name="Retired",
            attributes={"criticality": "low", "cost": 7},
            lifecycle={"endOfLife": (today - timedelta(days=800)).isoformat()},
        )

    async def test_a_card_outside_the_fiscal_year_does_not_count(self, db, landscape):
        await self._future_and_retired(db)
        result = await _run(
            db,
            card_type="Application",
            metric="sum",
            metric_field="cost",
            group_by="field:criticality",
        )
        # A1 (active last month) and A2 (no lifecycle at all) count; the card
        # going live next year and the one retired two years ago do not.
        assert result["rows"] == [{"key": "low", "value": 0}, {"key": "high", "value": 150}]
        assert result["total"] == 150
        assert result["fiscal_year"] == datetime.now(timezone.utc).date().year
        assert result["fiscal_year_start"] == 1

    async def test_the_rule_is_for_costs_only(self, db, landscape):
        await self._future_and_retired(db)
        count = await _run(db, card_type="Application")
        assert count["total"] == 5
        assert "fiscal_year" not in count
        users = await _run(db, card_type="Application", metric="sum", metric_field="users")
        assert "fiscal_year" not in users
        assert "fiscal_year_start" not in users

    async def test_the_fiscal_year_start_setting_names_the_year(self, db, landscape):
        from app.models.app_settings import AppSettings
        from app.services.fiscal_year import fiscal_year_for

        row = await db.get(AppSettings, "default")
        if row is None:
            db.add(AppSettings(id="default", general_settings={"fiscalYearStart": 7}))
        else:
            row.general_settings = {**(row.general_settings or {}), "fiscalYearStart": 7}
        await db.flush()
        today = date(2026, 10, 29)
        resolved = await resolve_query(
            db, Q(card_type="Application", metric="avg", metric_field="cost")
        )
        result = await run_query(db, resolved, CardReadScope.everything(), today=today)
        assert fiscal_year_for(today, 7) == 2027
        assert result["fiscal_year"] == 2027
        assert result["fiscal_year_start"] == 7
        assert result["total"] == 75


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
            ({"card_type": "Application", "group_by": "related:nope"}, "unknown_relation_type"),
            (
                {"card_type": "Application", "group_by": "related:appToIt__out"},
                "unknown_dimension",
            ),
            ({"card_type": "Application", "flags": "related:appToIt__in"}, "unknown_flag"),
            (
                {
                    "card_type": "Application",
                    "metric": "sum",
                    "metric_field": "@relations:appToIt__out",
                },
                "unknown_field",
            ),
            ({"card_type": "Ghost", "group_by": "related:appToIt"}, "unknown_card_type"),
            (
                {"card_type": "Application", "flags": "unrelated:selfRel"},
                "relation_side_required",
            ),
            (
                {"card_type": "ITComponent", "flags": "related:selfRel__out"},
                "unknown_relation_type",
            ),
        ],
    )
    async def test_unknown_metamodel_keys(self, db, landscape, kwargs, code):
        await create_relation_type(
            db,
            key="selfRel",
            label="self",
            source_type_key="Application",
            target_type_key="Application",
        )
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

    async def test_relation_sides_and_measures_resolve(self, db, landscape):
        resolved = await resolve_query(
            db,
            Q(
                card_type="ITComponent",
                group_by="related:appToIt",
                metric="avg",
                metric_field="@relations:appToIt",
                flags="related:appToIt",
            ),
        )
        assert resolved.sides == {"appToIt": RelationSide("appToIt", False)}
        assert resolved.metric_is_cost is False
        plain = await resolve_query(db, Q(metric="avg", metric_field="@data_quality"))
        assert plain.sides == {}
        assert plain.metric_is_cost is False

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
        with pytest.raises(DashboardQueryError) as exc:
            await resolve_query(db, Q(card_type="Application", flags="related:hiddenRel"))
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
            ({"card_type": "A", "group_by": "card"}, False),
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
    {"group_by": "eol_coverage"},
    {"group_by": "stakeholders"},
    {"group_by": "type", "group_by_2": "stakeholders"},
    {"card_type": "Application", "group_by": "eol_coverage", "group_by_2": "stakeholders"},
    {"group_by": "stakeholders", "group_by_2": "eol_coverage", "approval_status": "APPROVED"},
    {"group_by": "type", "flags": "orphaned"},
    {"group_by": "type", "flags": "stale"},
    {"group_by": "type", "flags": "with_stakeholders"},
    {"group_by": "type", "flags": "without_stakeholders"},
    {"flags": "eol_linked"},
    {"flags": "eol_manual"},
    {"group_by": "approval_status", "flags": "eol_missing"},
    {"group_by": "eol_coverage", "flags": "without_stakeholders,orphaned"},
    {"card_type": "Application", "flags": "related:appToData", "group_by": "approval_status"},
    {"card_type": "Application", "flags": "unrelated:appToData", "group_by": "eol_coverage"},
    {"card_type": "Application", "flags": "related:dependsOn__out"},
    {"card_type": "Application", "flags": "related:dependsOn__in,stale"},
    {"card_type": "Application", "flags": "unrelated:dependsOn__in,with_stakeholders"},
    {"card_type": "DataObject", "flags": "related:appToData", "group_by": "stakeholders"},
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
    cards = []
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
        cards.append(card)
    apps, data, ghost = cards[:7], cards[7:9], cards[9]
    # EOL coverage: a link, half a link with a manual date, an empty half link.
    apps[0].attributes = {**apps[0].attributes, "eol_product": "python", "eol_cycle": "3.12"}
    apps[1].attributes = {**apps[1].attributes, "eol_product": "python"}
    apps[1].lifecycle = {"endOfLife": "2027-01-01"}
    apps[2].attributes = {**apps[2].attributes, "eol_product": "", "eol_cycle": "1"}
    # Stale: last touched long ago (set on the row; the flush keeps it).
    apps[4].updated_at = now - timedelta(days=200)
    # Stakeholders: two roles on one card count once.
    user = await create_user(db)
    db.add(Stakeholder(card_id=apps[0].id, user_id=user.id, role="responsible"))
    db.add(Stakeholder(card_id=apps[0].id, user_id=user.id, role="observer"))
    db.add(Stakeholder(card_id=data[0].id, user_id=user.id, role="responsible"))
    # Relations: apps[2] only reaches a hidden-type card, which does not count.
    await create_relation_type(
        db,
        key="appToData",
        label="reads",
        source_type_key="Application",
        target_type_key="DataObject",
    )
    await create_relation_type(
        db,
        key="dependsOn",
        label="depends on",
        source_type_key="Application",
        target_type_key="Application",
    )
    await create_relation(db, type_key="appToData", source_id=apps[0].id, target_id=data[0].id)
    await create_relation(db, type_key="appToData", source_id=apps[1].id, target_id=data[1].id)
    await create_relation(db, type_key="appToData", source_id=apps[2].id, target_id=ghost.id)
    await create_relation(db, type_key="dependsOn", source_id=apps[3].id, target_id=apps[4].id)
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
        # A related card the reader cannot see is no relation for them.
        related = await resolve_query(db, Q(card_type="Application", flags="related:appToData"))
        fast = await run_query(db, related, scope)
        assert fast == await run_query(db, related, scope, force_python=True)
        assert fast["total"] == 0

    async def test_exact_flag_and_coverage_answers(self, db, parity_landscape):
        everything = CardReadScope.everything()

        async def result(**kwargs):
            return await run_query(db, await resolve_query(db, Q(**kwargs)), everything)

        assert (await result(group_by="eol_coverage"))["rows"] == [
            {"key": "linked", "value": 1},
            {"key": "manual", "value": 1},
            {"key": "missing", "value": 5},
        ]
        assert (await result(group_by="stakeholders"))["rows"] == [
            {"key": "true", "value": 2},
            {"key": "false", "value": 7},
        ]
        totals = {
            "orphaned": 2,
            "stale": 1,
            "with_stakeholders": 2,
            "without_stakeholders": 7,
            "eol_linked": 1,
            "eol_manual": 1,
            "eol_missing": 5,
        }
        for flag, total in totals.items():
            assert (await result(flags=flag))["total"] == total, flag
        assert (await result(card_type="Application", flags="related:appToData"))["total"] == 2
        assert (await result(card_type="Application", flags="unrelated:appToData"))["total"] == 5
        assert (await result(card_type="DataObject", flags="related:appToData"))["total"] == 2
        out = await result(card_type="Application", flags="related:dependsOn__out")
        assert out["total"] == 1
        stale_target = await result(card_type="Application", flags="related:dependsOn__in,stale")
        assert stale_target["total"] == 1

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

    async def test_a_flagged_count_still_groups_in_sql(self, db, parity_landscape):
        from sqlalchemy import event as sa_event

        statements: list[str] = []
        bind = db.sync_session.get_bind()

        def _record(conn, cursor, statement, parameters, context, executemany):
            if "FROM cards" in statement:
                statements.append(statement)

        flagged = await resolve_query(
            db,
            Q(
                card_type="Application",
                group_by="eol_coverage",
                group_by_2="stakeholders",
                flags="stale,with_stakeholders,unrelated:appToData,eol_missing,orphaned",
            ),
        )
        sa_event.listen(bind, "before_cursor_execute", _record)
        try:
            await run_query(db, flagged, CardReadScope.everything())
        finally:
            sa_event.remove(bind, "before_cursor_execute", _record)
        (grouped,) = statements
        assert "GROUP BY" in grouped and "count(cards.id)" in grouped

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
