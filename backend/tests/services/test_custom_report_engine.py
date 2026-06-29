"""Unit tests for the freeform Custom Report engine.

Covers aggregation correctness, relation traversal, and the security boundary
(metamodel validation, cost RBAC, malicious-spec rejection).
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.permissions import VIEWER_PERMISSIONS
from app.schemas.custom_report import CustomReportSpec
from app.services.custom_report_engine import run_custom_report
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

APP_SCHEMA = [
    {
        "section": "g",
        "fields": [
            {"key": "costTotalAnnual", "type": "cost", "weight": 1},
            {"key": "headcount", "type": "number", "weight": 0},
            {"key": "isCore", "type": "boolean", "weight": 0},
            {
                "key": "businessCriticality",
                "type": "single_select",
                "weight": 0,
                "options": [
                    {"key": "high", "label": "High"},
                    {"key": "low", "label": "Low"},
                ],
            },
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", fields_schema=APP_SCHEMA)
    await create_card_type(
        db,
        key="ITComponent",
        fields_schema=[
            {"section": "g", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 1}]}
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    a1 = await create_card(
        db,
        card_type="Application",
        name="A1",
        attributes={"businessCriticality": "high", "headcount": 10, "costTotalAnnual": 100},
    )
    a2 = await create_card(
        db,
        card_type="Application",
        name="A2",
        attributes={"businessCriticality": "high", "headcount": 30, "costTotalAnnual": 300},
    )
    a3 = await create_card(
        db,
        card_type="Application",
        name="A3",
        attributes={"businessCriticality": "low", "headcount": 5, "costTotalAnnual": 50},
    )
    return {"admin": admin, "viewer": viewer, "a1": a1, "a2": a2, "a3": a3}


def _spec(**over) -> CustomReportSpec:
    base = {
        "title": "T",
        "source": {"card_type": "Application"},
        "measures": [{"agg": "count"}],
        "visualization": {"kind": "bar"},
    }
    base.update(over)
    return CustomReportSpec.model_validate(base)


class TestAggregation:
    async def test_count_group_by_attribute_resolves_option_label(self, db, env):
        spec = _spec(dimensions=[{"kind": "attribute", "key": "businessCriticality"}])
        out = await run_custom_report(db, env["admin"], spec)
        buckets = {r["d0"]: r["m0"] for r in out["rows"]}
        assert buckets == {"High": 2, "Low": 1}
        assert (
            out["columns"][0]["label"] == "Business Criticality" or out["columns"][0]["key"] == "d0"
        )

    async def test_sum_and_avg_measures(self, db, env):
        spec = _spec(
            dimensions=[{"kind": "attribute", "key": "businessCriticality"}],
            measures=[
                {"agg": "sum", "field": "headcount", "label": "HC"},
                {"agg": "avg", "field": "headcount"},
            ],
        )
        out = await run_custom_report(db, env["admin"], spec)
        high = next(r for r in out["rows"] if r["d0"] == "High")
        assert high["m0"] == 40
        assert high["m1"] == 20

    async def test_filter_narrows_working_set(self, db, env):
        spec = _spec(
            source={
                "card_type": "Application",
                "filters": [
                    {
                        "target": "attribute",
                        "key": "businessCriticality",
                        "op": "eq",
                        "value": "high",
                    }
                ],
            },
            measures=[{"agg": "count"}],
        )
        out = await run_custom_report(db, env["admin"], spec)
        assert out["rows"][0]["m0"] == 2

    async def test_kpi_total(self, db, env):
        spec = _spec(measures=[{"agg": "sum", "field": "headcount"}], visualization={"kind": "kpi"})
        out = await run_custom_report(db, env["admin"], spec)
        assert out["rows"][0]["m0"] == 45

    async def test_eq_filter_is_case_insensitive(self, db, env):
        # The builder may send a differently-cased value; eq must still match.
        spec = _spec(
            source={
                "card_type": "Application",
                "filters": [
                    {
                        "target": "attribute",
                        "key": "businessCriticality",
                        "op": "eq",
                        "value": "HIGH",
                    }
                ],
            },
            measures=[{"agg": "count"}],
        )
        out = await run_custom_report(db, env["admin"], spec)
        assert out["rows"][0]["m0"] == 2

    async def test_boolean_filter_matches_string_value(self, db, env):
        await create_card(db, card_type="Application", name="Flagged", attributes={"isCore": True})
        spec = _spec(
            source={
                "card_type": "Application",
                "filters": [{"target": "attribute", "key": "isCore", "op": "eq", "value": "true"}],
            },
            measures=[{"agg": "count"}],
        )
        out = await run_custom_report(db, env["admin"], spec)
        assert out["rows"][0]["m0"] == 1


class TestTraversal:
    async def test_one_hop_traversal(self, db, env):
        await create_relation_type(
            db, key="app_to_itc", source_type_key="Application", target_type_key="ITComponent"
        )
        itc = await create_card(db, card_type="ITComponent", name="DB", subtype="SaaS")
        await create_relation(db, type_key="app_to_itc", source_id=env["a1"].id, target_id=itc.id)
        spec = _spec(
            source={
                "card_type": "Application",
                "traverse": {
                    "relation_type": "app_to_itc",
                    "direction": "out",
                    "target_type": "ITComponent",
                },
            },
            dimensions=[{"kind": "subtype"}],
            measures=[{"agg": "count"}],
        )
        out = await run_custom_report(db, env["admin"], spec)
        assert out["meta"]["effective_type"] == "ITComponent"
        assert {r["d0"]: r["m0"] for r in out["rows"]} == {"SaaS": 1}


class TestSecurity:
    async def test_unknown_card_type_rejected(self, db, env):
        spec = _spec(source={"card_type": "Nope"})
        with pytest.raises(HTTPException) as e:
            await run_custom_report(db, env["admin"], spec)
        assert e.value.status_code == 400

    async def test_unknown_attribute_rejected(self, db, env):
        spec = _spec(dimensions=[{"kind": "attribute", "key": "bogusField"}])
        with pytest.raises(HTTPException) as e:
            await run_custom_report(db, env["admin"], spec)
        assert e.value.status_code == 400

    async def test_non_numeric_measure_rejected(self, db, env):
        spec = _spec(measures=[{"agg": "sum", "field": "businessCriticality"}])
        with pytest.raises(HTTPException) as e:
            await run_custom_report(db, env["admin"], spec)
        assert e.value.status_code == 400

    async def test_unknown_relation_type_rejected(self, db, env):
        spec = _spec(
            source={
                "card_type": "Application",
                "traverse": {"relation_type": "ghost", "target_type": "ITComponent"},
            }
        )
        with pytest.raises(HTTPException) as e:
            await run_custom_report(db, env["admin"], spec)
        assert e.value.status_code == 400

    async def test_cost_measure_requires_costs_view(self, db, env):
        spec = _spec(measures=[{"agg": "sum", "field": "costTotalAnnual"}])
        with pytest.raises(HTTPException) as e:
            await run_custom_report(db, env["viewer"], spec)
        assert e.value.status_code == 403

    async def test_cost_filter_also_requires_costs_view(self, db, env):
        # A filter on a cost field leaks cost data via inclusion — must be gated too.
        spec = _spec(
            source={
                "card_type": "Application",
                "filters": [
                    {"target": "attribute", "key": "costTotalAnnual", "op": "gt", "value": 100}
                ],
            }
        )
        with pytest.raises(HTTPException) as e:
            await run_custom_report(db, env["viewer"], spec)
        assert e.value.status_code == 403

    async def test_admin_passes_cost_gate(self, db, env):
        spec = _spec(
            measures=[{"agg": "sum", "field": "costTotalAnnual"}], visualization={"kind": "kpi"}
        )
        out = await run_custom_report(db, env["admin"], spec)
        assert out["rows"][0]["m0"] == 450
