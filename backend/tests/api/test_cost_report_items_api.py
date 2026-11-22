"""The cost reports read cost items for Application / ITComponent."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import update

from app.models.card_cost import CardCost
from app.models.card_cost_history import CardCostHistory
from app.models.card_logo import CardLogo
from app.models.card_type import CardType
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

CUR = current_fiscal_year(1)
COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db, key="costviewer", label="CV", permissions={"costs.view": True, "inventory.view": True}
    )
    await create_role(db, key="nocost", label="NoCost", permissions={"inventory.view": True})
    admin = await create_user(db, email="a@items-report.com", role="admin")
    viewer = await create_user(db, email="v@items-report.com", role="costviewer")
    nocost = await create_user(db, email="n@items-report.com", role="nocost")
    await create_card_type(db, key="Application", fields_schema=COST_FIELDS)
    await create_card_type(db, key="ITComponent", fields_schema=COST_FIELDS)
    await create_card_type(db, key="Provider", fields_schema=COST_FIELDS)
    await cost_item_types.create_item(db, "lic", "Licences", {"it": "Licenze"})
    await cost_item_types.create_item(db, "sup", "Support")
    return {"admin": admin, "viewer": viewer, "nocost": nocost}


async def _costs(db, card, year, **items):
    db.add(
        CardCost(
            card_id=card.id,
            fiscal_year=year,
            items={k: {"amount": v, "renewal_date": None} for k, v in items.items()},
        )
    )
    await db.flush()


async def _get(client, env, path, user="admin", **params):
    return await client.get(
        f"/api/v1/reports/{path}", params=params, headers=auth_headers(env[user])
    )


async def test_treemap_total_is_sum_of_items_current_and_past(client, db, env):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR, lic=100, sup=50)
    await _costs(db, app, CUR - 1, lic=70)
    cur = (await _get(client, env, "cost-treemap", type="Application")).json()
    assert cur["total"] == 150
    assert cur["components"] == ["lic", "sup"]
    assert cur["item_labels"]["lic"] == {
        "label": "Licences",
        "translations": {"it": "Licenze"},
    }
    past = (await _get(client, env, "cost-treemap", type="Application", fiscal_year=CUR - 1)).json()
    assert past["total"] == 70
    assert [i["name"] for i in past["items"]] == ["ERP"]


async def test_attribute_without_items_is_not_a_cost(client, db, env):
    await create_card(
        db, card_type="Application", name="Legacy", attributes={"costTotalAnnual": 999}
    )
    data = (await _get(client, env, "cost-treemap", type="Application")).json()
    assert data["items"] == []


async def test_archived_item_is_its_own_component_and_totals_hold(client, db, env):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR - 1, lic=100, sup=20)
    await _costs(db, app, CUR, lic=100, sup=20)
    before = (
        await _get(client, env, "cost-sankey", type="Application", fiscal_year=CUR - 1)
    ).json()
    await cost_item_types.update_item(db, "sup", label="Renamed", archived=True)
    after = (await _get(client, env, "cost-sankey", type="Application", fiscal_year=CUR - 1)).json()
    assert before["total"] == after["total"] == 120
    ids = {n["id"] for n in after["nodes"]}
    assert {"item:lic", "item:sup"} <= ids
    assert "item:__other__" not in ids
    card_node = next(n for n in after["nodes"] if n["name"] == "ERP")
    assert card_node["costs"] == {"lic": 100, "sup": 20}
    tm = (await _get(client, env, "cost-treemap", type="Application")).json()
    assert tm["total"] == 120
    assert "sup" in tm["components"]
    assert tm["item_labels"]["sup"]["label"] == "Renamed"


async def test_current_year_falls_back_and_reports_it_empty_row_is_zero(client, db, env):
    fb = await create_card(db, card_type="Application", name="Fallback")
    await _costs(db, fb, CUR - 2, lic=40)
    empty = await create_card(db, card_type="Application", name="Confirmed empty")
    await _costs(db, empty, CUR - 2, lic=500)
    db.add(CardCost(card_id=empty.id, fiscal_year=CUR, items={}))
    await db.flush()
    data = (await _get(client, env, "cost-treemap", type="Application")).json()
    assert [i["name"] for i in data["items"]] == ["Fallback"]
    assert data["total"] == 40
    # a past year never falls back
    past = (await _get(client, env, "cost-treemap", type="Application", fiscal_year=CUR - 1)).json()
    assert past["items"] == []


async def test_fallback_marks_nothing_else_than_current_year_in_sankey(client, db, env):
    fb = await create_card(db, card_type="Application", name="Fallback")
    await _costs(db, fb, CUR - 2, lic=40)
    flow = (await _get(client, env, "cost-sankey", type="Application")).json()
    assert flow["total"] == 40


async def test_provider_cost_is_unchanged(client, db, env):
    await create_card(db, card_type="Provider", name="Vendor", attributes={"costTotalAnnual": 300})
    db.add(
        CardCostHistory(
            card_id=(await create_card(db, card_type="Provider", name="Old")).id,
            fiscal_year=CUR - 1,
            field_key="costTotalAnnual",
            value=11,
        )
    )
    await db.flush()
    cur = (await _get(client, env, "cost-treemap", type="Provider")).json()
    assert cur["total"] == 300
    assert cur["item_labels"].keys() == {"lic", "sup"}
    past = (await _get(client, env, "cost-treemap", type="Provider", fiscal_year=CUR - 1)).json()
    assert past["total"] == 11


async def test_mixed_request_uses_totals_only(client, db, env):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR, lic=100, sup=50)
    await create_card(db, card_type="Provider", name="Vendor", attributes={"costTotalAnnual": 30})
    tm = (await _get(client, env, "cost-treemap", type="Application,Provider")).json()
    assert tm["total"] == 180
    assert tm["components"] == []
    flow = (await _get(client, env, "cost-sankey", type="Application,Provider")).json()
    assert flow["total"] == 180
    assert {n["id"] for n in flow["nodes"] if n["type"] == "CostItem"} == {"item:costTotalAnnual"}


async def test_cost_endpoint_reads_items(client, db, env):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR, lic=100, sup=50)
    data = (await _get(client, env, "cost", type="Application")).json()
    assert data["total"] == 150
    assert data["items"][0]["name"] == "ERP"


@pytest.mark.parametrize("path", ["cost", "cost-treemap", "cost-sankey"])
async def test_no_costs_view_gets_403(client, db, env, path):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR, lic=100)
    resp = await _get(client, env, path, user="nocost", type="Application")
    assert resp.status_code == 403
    assert "ERP" not in resp.text


async def test_hidden_card_type_leaks_nothing(client, db, env):
    app = await create_card(db, card_type="Application", name="SecretERP")
    await _costs(db, app, CUR, lic=100)
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"costviewer": {"inventory.view": False}})
    )
    await db.flush()
    for path in ("cost", "cost-treemap", "cost-sankey"):
        resp = await _get(client, env, path, user="viewer", type="Application")
        assert resp.status_code == 200, resp.text
        assert "SecretERP" not in resp.text and str(app.id) not in resp.text
    admin = await _get(client, env, "cost-treemap", type="Application")
    assert "SecretERP" in admin.text


@pytest.mark.parametrize("path", ["cost-treemap", "cost-sankey"])
async def test_report_logo_metadata_respects_card_scope(client, db, env, path):
    visible = await create_card(db, card_type="ITComponent", name="Visible")
    plain = await create_card(db, card_type="ITComponent", name="Plain")
    hidden = await create_card(db, card_type="Application", name="Hidden")
    for card in (visible, plain, hidden):
        await _costs(db, card, CUR, lic=10)
    timestamp = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    for card in (visible, hidden):
        db.add(
            CardLogo(
                card_id=card.id, mime_type="image/png", size=1, data=b"x", updated_at=timestamp
            )
        )
    await db.execute(
        update(CardType)
        .where(CardType.key == "ITComponent")
        .values(
            allow_card_logo=True,
            fields_schema=[
                {
                    "section": "Cost",
                    "fields": [
                        {"key": "costTotalAnnual", "type": "cost", "weight": 0},
                        {"key": "tier", "type": "single_select"},
                    ],
                }
            ],
        )
    )
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(
            allow_card_logo=True,
            role_permissions={"costviewer": {"inventory.view": False}},
            fields_schema=[
                {
                    "section": "Cost",
                    "fields": [
                        {"key": "costTotalAnnual", "type": "cost", "weight": 0},
                        {"key": "tier", "type": "single_select"},
                    ],
                }
            ],
        )
    )
    await db.flush()
    response = await _get(
        client, env, path, user="viewer", type="Application,ITComponent", group_by="field:tier"
    )
    assert response.status_code == 200, response.text
    assert str(hidden.id) not in response.text and "Hidden" not in response.text
    data = response.json()
    rows = data["items"] if path == "cost-treemap" else data["nodes"]
    by_id = {row["id"]: row for row in rows}
    assert "logo_updated_at" not in by_id[str(plain.id)]
    assert all(
        "logo_updated_at" not in row for row in rows if row["id"].startswith(("group:", "item:"))
    )
    assert by_id[str(visible.id)]["logo_updated_at"] == timestamp.isoformat()


async def test_per_item_cost_field_reads_that_item_for_current_and_past(client, db, env):
    await cost_item_types.create_item(db, "other", "Other")
    app = await create_card(db, card_type="Application", name="ERP")
    other = await create_card(db, card_type="Application", name="CRM")
    await _costs(db, app, CUR, lic=100, sup=50, other=7)
    await _costs(db, app, CUR - 1, lic=70, sup=5)
    await _costs(db, other, CUR, sup=9)
    await cost_item_types.update_item(db, "sup", archived=True)

    async def total(field, **p):
        resp = await _get(client, env, "cost-treemap", type="Application", cost_field=field, **p)
        assert resp.status_code == 200
        return resp.json()

    assert (await total("lic"))["total"] == 100
    assert [i["name"] for i in (await total("lic"))["items"]] == ["ERP"]
    assert (await total("lic", fiscal_year=CUR - 1))["total"] == 70
    assert (await total("sup"))["total"] == 59  # archived item still reported
    assert (await total("other"))["total"] == 7
    for fy in (CUR, CUR - 1):
        parts = 0
        for k in ("lic", "sup", "other"):
            parts += (await total(k, fiscal_year=fy))["total"]
        assert parts == (await total("costTotalAnnual", fiscal_year=fy))["total"]


async def test_per_item_cost_field_needs_costs_view(client, db, env):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR, lic=100)
    resp = await _get(
        client, env, "cost-treemap", user="nocost", type="Application", cost_field="lic"
    )
    assert resp.status_code == 403
    assert "ERP" not in resp.text


async def test_sankey_puts_a_line_missing_from_the_catalogue_under_other(client, db, env):
    app = await create_card(db, card_type="Application", name="ERP")
    await _costs(db, app, CUR, lic=100, ghost=5)  # `ghost` was never in the catalogue
    flow = (await _get(client, env, "cost-sankey", type="Application")).json()
    assert {n["id"] for n in flow["nodes"] if n["type"] == "CostItem"} == {
        "item:lic",
        "item:__other__",
    }
    assert sum(link["value"] for link in flow["links"]) == flow["total"] == 105
