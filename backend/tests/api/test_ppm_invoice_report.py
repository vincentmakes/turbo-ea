"""Invoice tracking must not alter existing card cost reports or editable history."""

from datetime import date
from decimal import Decimal

from app.services.cost_field_filter import cost_field_keys_from_card_schema
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


async def test_invoiced_projection_stays_out_of_existing_costs_and_card_writes(client, db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="pml-invoice-report@example.test", role="admin")
    card_type = await create_card_type(
        db,
        key="Initiative",
        label="Initiative",
        fields_schema=[
            {
                "section": "Cost",
                "fields": [
                    {"key": "costBudget", "type": "cost", "weight": 0},
                    {"key": "costActual", "type": "cost", "weight": 0},
                    {"key": "pmlActualInvoiced", "type": "text", "weight": 0},
                ],
            }
        ],
    )
    card = await create_card(
        db,
        card_type="Initiative",
        name="Invoice report isolation",
        user_id=admin.id,
        attributes={"pmlActualInvoiced": "original value"},
    )
    headers = auth_headers(admin)
    prefix = f"/api/v1/ppm/initiatives/{card.id}"

    budget = await client.post(
        f"{prefix}/budgets",
        json={"fiscal_year": date.today().year, "category": "capex", "amount": 100},
        headers=headers,
    )
    assert budget.status_code == 200
    cost = await client.post(
        f"{prefix}/costs",
        json={
            "budget_line_id": budget.json()["id"],
            "description": "Recorded cost",
            "category": "capex",
            "actual": 80,
        },
        headers=headers,
    )
    assert cost.status_code == 200

    report = await client.get("/api/v1/reports/cost?type=Initiative", headers=headers)
    assert report.status_code == 200
    assert report.json()["total"] == 180

    history_before = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=headers)
    assert history_before.status_code == 200

    invoice = await client.post(
        f"{prefix}/invoices",
        json={
            "cost_item_id": cost.json()["id"],
            "invoice_date": date.today().isoformat(),
            "invoice_id": "INV-00060",
            "amount": "60",
        },
        headers=headers,
    )
    assert invoice.status_code == 200
    report_after = await client.get("/api/v1/reports/cost?type=Initiative", headers=headers)
    assert report_after.status_code == 200
    assert report_after.json()["total"] == 180
    projection = await client.get(f"{prefix}/financials", headers=headers)
    assert projection.status_code == 200
    assert Decimal(projection.json()["actual_invoiced"]) == Decimal("60")

    history_after_invoice = await client.get(
        f"/api/v1/cards/{card.id}/cost-history", headers=headers
    )
    assert history_after_invoice.status_code == 200
    assert history_after_invoice.json()["rows"] == history_before.json()["rows"]

    card_response = await client.get(f"/api/v1/cards/{card.id}", headers=headers)
    assert card_response.status_code == 200
    attributes = card_response.json()["attributes"]
    assert attributes["pmlActualInvoiced"] == "original value"
    attributes["pmlActualInvoiced"] = "updated independently"
    updated = await client.patch(
        f"/api/v1/cards/{card.id}", json={"attributes": attributes}, headers=headers
    )
    assert updated.status_code == 200
    assert updated.json()["attributes"]["pmlActualInvoiced"] == "updated independently"
    projection_after = await client.get(f"{prefix}/financials", headers=headers)
    assert projection_after.status_code == 200
    assert Decimal(projection_after.json()["actual_invoiced"]) == Decimal("60")

    history = await client.get(f"/api/v1/cards/{card.id}/cost-history", headers=headers)
    assert history.status_code == 200
    assert {row["field_key"] for row in history.json()["rows"]} <= {"costBudget", "costActual"}
    invalid_history = await client.put(
        f"/api/v1/cards/{card.id}/cost-history",
        json={
            "fiscal_year": date.today().year,
            "field_key": "pmlActualInvoiced",
            "value": 60,
        },
        headers=headers,
    )
    assert invalid_history.status_code == 400

    assert cost_field_keys_from_card_schema(card_type.fields_schema) == {
        "costBudget",
        "costActual",
    }
    custom_field_report = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Initiative", "cost_field": "pmlActualInvoiced"},
        headers=headers,
    )
    assert custom_field_report.status_code == 200
    assert custom_field_report.json()["total"] == 0
