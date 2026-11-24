"""API regressions for linked PML budgets, costs and invoice tracking."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from tests.api.test_ppm import ppm_env as ppm_env
from tests.conftest import auth_headers, create_budget_line, create_cost_line

BASE = "/api/v1/ppm"


async def _budget(client, initiative_id, headers, *, amount=12000, category="capex"):
    response = await client.post(
        f"{BASE}/initiatives/{initiative_id}/budgets",
        json={"fiscal_year": 2026, "category": category, "amount": amount},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


async def _cost(client, initiative_id, headers, budget_id, *, amount, category="opex"):
    response = await client.post(
        f"{BASE}/initiatives/{initiative_id}/costs",
        json={
            "description": "Recorded cost",
            "category": category,
            "actual": amount,
            "budget_line_id": budget_id,
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["budget_line_id"] == budget_id
    return response.json()


async def _invoice(client, initiative_id, headers, cost_id, *, amount, invoice_id):
    response = await client.post(
        f"{BASE}/initiatives/{initiative_id}/invoices",
        json={
            "cost_item_id": cost_id,
            "invoice_date": "2026-11-23",
            "invoice_id": invoice_id,
            "amount": amount,
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["invoice_id"] == invoice_id
    return response.json()


async def test_new_cost_requires_budget_in_same_initiative(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    payload = {"description": "New cost", "category": "opex", "actual": 100}

    missing = await client.post(
        f"{BASE}/initiatives/{initiative_id}/costs", json=payload, headers=headers
    )
    assert missing.status_code == 422

    payload["budget_line_id"] = str(uuid4())
    stale = await client.post(
        f"{BASE}/initiatives/{initiative_id}/costs", json=payload, headers=headers
    )
    assert stale.status_code == 404
    listed = await client.get(f"{BASE}/initiatives/{initiative_id}/costs", headers=headers)
    assert listed.json() == []


async def test_linked_financials_and_legacy_costs(client, db, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    cost = await _cost(client, initiative_id, headers, budget["id"], amount=8000)
    await _cost(client, initiative_id, headers, budget["id"], amount=2000)
    legacy = await create_cost_line(db, initiative_id=ppm_env["initiative"].id, actual=1000)

    await _invoice(client, initiative_id, headers, cost["id"], amount="4000", invoice_id="00018")
    await _invoice(client, initiative_id, headers, cost["id"], amount="2500", invoice_id="00051")
    await _invoice(client, initiative_id, headers, str(legacy.id), amount="300", invoice_id="00003")

    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert Decimal(data["actual_invoiced"]) == Decimal("6800")
    assert Decimal(data["budget_totals"]["total_cost_items"]) == Decimal("10000")
    assert Decimal(data["budget_totals"]["total_invoiced"]) == Decimal("6500")
    assert Decimal(data["budget_totals"]["remaining_to_invoice"]) == Decimal("3500")
    assert len(data["invoices"]) == 3


async def test_invoice_amount_and_residual(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    cost = await _cost(client, initiative_id, headers, budget["id"], amount=100.13)
    invoice = await _invoice(
        client, initiative_id, headers, cost["id"], amount="30.11", invoice_id="INV-00001"
    )
    assert Decimal(invoice["amount"]) == Decimal("30.11")

    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 200
    item = next(row for row in response.json()["cost_items"] if row["id"] == cost["id"])
    assert Decimal(item["total_invoiced"]) == Decimal("30.11")
    assert Decimal(item["remaining_to_invoice"]) == Decimal("70.02")

    negative = await client.post(
        f"{BASE}/initiatives/{initiative_id}/invoices",
        json={
            "cost_item_id": cost["id"],
            "invoice_date": "2026-11-23",
            "invoice_id": "negative",
            "amount": "-1",
        },
        headers=headers,
    )
    assert negative.status_code == 422


async def test_move_invoice_updates_both_costs_and_preserves_initiative_total(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    first = await _cost(client, initiative_id, headers, budget["id"], amount=8000)
    second = await _cost(client, initiative_id, headers, budget["id"], amount=2000)
    invoice = await _invoice(
        client, initiative_id, headers, first["id"], amount="2500", invoice_id="INV-00002"
    )

    moved = await client.patch(
        f"{BASE}/invoices/{invoice['id']}",
        json={"cost_item_id": second["id"]},
        headers=headers,
    )
    assert moved.status_code == 200
    assert moved.json()["cost_item_id"] == second["id"]
    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 200
    data = response.json()
    by_id = {item["id"]: item for item in data["cost_items"]}
    assert Decimal(by_id[first["id"]]["total_invoiced"]) == Decimal("0")
    assert Decimal(by_id[second["id"]]["remaining_to_invoice"]) == Decimal("-500")
    assert Decimal(data["actual_invoiced"]) == Decimal("2500")


async def test_financial_parent_deletion_and_split_document(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    first = await _cost(client, initiative_id, headers, budget["id"], amount=100)
    second = await _cost(client, initiative_id, headers, budget["id"], amount=200)
    await _invoice(client, initiative_id, headers, first["id"], amount="30", invoice_id="INV-01")
    await _invoice(client, initiative_id, headers, second["id"], amount="40", invoice_id="INV-01")

    budget_delete = await client.delete(f"{BASE}/budgets/{budget['id']}", headers=headers)
    cost_delete = await client.delete(f"{BASE}/costs/{first['id']}", headers=headers)
    assert budget_delete.status_code == 409
    assert cost_delete.status_code == 409

    result = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert result.status_code == 200
    assert len(result.json()["invoices"]) == 2
    assert Decimal(result.json()["actual_invoiced"]) == Decimal("70")


async def test_invoice_id_cannot_cross_initiatives(client, db, ppm_env):
    from tests.conftest import create_card

    admin = ppm_env["admin"]
    headers = auth_headers(admin)
    initiative_id = str(ppm_env["initiative"].id)
    other = await create_card(db, card_type="Initiative", name="Other", user_id=admin.id)
    other_id = str(other.id)
    budget = await _budget(client, initiative_id, headers)
    source = await _cost(client, initiative_id, headers, budget["id"], amount=100)
    other_budget = await _budget(client, other_id, headers)
    target = await _cost(client, other_id, headers, other_budget["id"], amount=100)
    invoice = await _invoice(
        client, initiative_id, headers, source["id"], amount="30", invoice_id="INV-01"
    )

    moved = await client.patch(
        f"{BASE}/invoices/{invoice['id']}",
        json={"cost_item_id": target["id"]},
        headers=headers,
    )
    assert moved.status_code == 404
    result = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert result.status_code == 200
    assert result.json()["invoices"][0]["cost_item_id"] == source["id"]


async def test_invoice_access_requires_module_and_cost_permissions(client, db, ppm_env):
    from tests.conftest import create_role, create_user

    await create_role(
        db,
        key="ppm_limited",
        label="PPM limited",
        permissions={"ppm.view": True, "inventory.view": True},
    )
    viewer = await create_user(db, email="ppm-limited@test.com", role="ppm_limited")
    initiative_id = str(ppm_env["initiative"].id)
    admin_headers = auth_headers(ppm_env["admin"])
    viewer_headers = auth_headers(viewer)
    budget = await _budget(client, initiative_id, admin_headers)
    cost = await _cost(client, initiative_id, admin_headers, budget["id"], amount=100)
    await _invoice(
        client, initiative_id, admin_headers, cost["id"], amount="30", invoice_id="INV-01"
    )

    response = await client.get(
        f"{BASE}/initiatives/{initiative_id}/financials", headers=viewer_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["invoice_access"] is False
    assert "invoices" not in data
    assert "actual_invoiced" not in data
    assert "card_comparison" not in data
    assert all("total_invoiced" not in row for row in data["cost_items"])
    assert all("remaining_to_invoice" not in row for row in data["cost_items"])


async def test_decimal_costs_are_summed_without_binary_rounding(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    await _cost(client, initiative_id, headers, budget["id"], amount=0.1)
    await _cost(client, initiative_id, headers, budget["id"], amount=0.2)
    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 200
    assert Decimal(response.json()["budget_totals"]["total_cost_items"]) == Decimal("0.3")
    assert Decimal(response.json()["card_comparison"]["actual"]["total"]) == Decimal("0.3")


async def test_invoice_rejects_nonfinite_and_missing_fields(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    cost = await _cost(client, initiative_id, headers, budget["id"], amount=100)
    body = {
        "cost_item_id": cost["id"],
        "invoice_date": "2026-11-23",
        "invoice_id": "INV-01",
        "amount": "NaN",
    }
    rejected = await client.post(
        f"{BASE}/initiatives/{initiative_id}/invoices", headers=headers, json=body
    )
    assert rejected.status_code == 422
    body["amount"] = "1"
    created = await client.post(
        f"{BASE}/initiatives/{initiative_id}/invoices", headers=headers, json=body
    )
    assert created.status_code == 200
    for change in ({"amount": "Infinity"}, {"invoice_id": None}, {"cost_item_id": None}):
        response = await client.patch(
            f"{BASE}/invoices/{created.json()['id']}", headers=headers, json=change
        )
        assert response.status_code == 422


async def test_card_comparison_reports_own_budget_and_cost_by_category(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers, amount=12000, category="capex")
    await _cost(client, initiative_id, headers, budget["id"], amount=8000, category="opex")
    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 200
    comparison = response.json()["card_comparison"]
    assert Decimal(comparison["budget"]["capex"]) == Decimal("12000")
    assert Decimal(comparison["budget"]["opex"]) == Decimal("0")
    assert Decimal(comparison["actual"]["capex"]) == Decimal("0")
    assert Decimal(comparison["actual"]["opex"]) == Decimal("8000")
    assert comparison["budget"]["derived"] is False
    assert comparison["actual"]["derived"] is False


async def test_financial_write_rolls_back_if_rollup_fails(client, db, ppm_env, monkeypatch):
    import pytest
    from sqlalchemy import func, select

    from app.api.v1 import ppm
    from app.models.card import Card
    from app.models.event import Event
    from app.models.ppm_cost_line import PpmBudgetLine

    initiative = ppm_env["initiative"]
    initiative_id = initiative.id
    initial_attributes = dict(initiative.attributes or {})
    headers = auth_headers(ppm_env["admin"])
    await db.commit()
    initial_events = await db.scalar(
        select(func.count()).select_from(Event).where(Event.card_id == initiative_id)
    )
    fanout_messages = []

    async def fail_ancestor(*args, **kwargs):
        raise RuntimeError("simulated rollup failure")

    monkeypatch.setattr(ppm, "_refresh_ancestors", fail_ancestor)
    monkeypatch.setattr(ppm.event_bus, "fanout", fanout_messages.append)
    with pytest.raises(RuntimeError, match="simulated rollup failure"):
        await client.post(
            f"{BASE}/initiatives/{initiative_id}/budgets",
            json={"fiscal_year": 2026, "category": "capex", "amount": 100},
            headers=headers,
        )
    await db.rollback()
    rows = await db.scalars(
        select(PpmBudgetLine).where(PpmBudgetLine.initiative_id == initiative_id)
    )
    assert rows.all() == []
    persisted = await db.get(Card, initiative_id)
    assert persisted is not None
    assert persisted.attributes == initial_attributes
    assert (
        await db.scalar(
            select(func.count()).select_from(Event).where(Event.card_id == initiative_id)
        )
        == initial_events
    )
    assert fanout_messages == []


async def test_high_precision_invoice_amount_and_remaining(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    cost = await _cost(client, initiative_id, headers, budget["id"], amount=100)
    await _invoice(
        client,
        initiative_id,
        headers,
        cost["id"],
        amount="1234567890123456789012345678.91",
        invoice_id="INV-HIGH-PRECISION",
    )
    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert Decimal(data["actual_invoiced"]) == Decimal("1234567890123456789012345678.91")
    item = next(row for row in data["cost_items"] if row["id"] == cost["id"])
    assert Decimal(item["remaining_to_invoice"]) == Decimal("-1234567890123456789012345578.91")


async def test_card_comparison_excludes_descendant_without_cost_access(
    client, db, ppm_env, monkeypatch
):
    from app.services.permission_service import PermissionService
    from tests.conftest import create_budget_line, create_card

    root = ppm_env["initiative"]
    child = await create_card(
        db,
        card_type="Initiative",
        name="Restricted child",
        user_id=ppm_env["admin"].id,
        parent_id=root.id,
    )
    await create_budget_line(db, initiative_id=child.id, amount=9000)
    await create_cost_line(db, initiative_id=child.id, actual=7000)

    async def denied_descendant(db_session, user, candidate_card_ids):
        return set()

    monkeypatch.setattr(PermissionService, "card_ids_with_cost_access", denied_descendant)
    response = await client.get(
        f"{BASE}/initiatives/{root.id}/financials",
        headers=auth_headers(ppm_env["admin"]),
    )
    assert response.status_code == 200
    comparison = response.json()["card_comparison"]
    assert Decimal(comparison["budget"]["total"]) == 0
    assert Decimal(comparison["actual"]["total"]) == 0


async def test_invoice_create_waits_for_concurrent_cost_delete(test_engine):
    import asyncio

    import pytest
    from fastapi import HTTPException
    from sqlalchemy import delete, select
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.ppm_cost_line import PpmCostLine
    from app.schemas.ppm import PpmInvoiceCreate
    from app.services.ppm_financials import create_invoice, lock_initiative
    from tests.conftest import create_budget_line, create_card, create_card_type, create_cost_line

    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        card_type = await setup.scalar(select(CardType).where(CardType.key == "Initiative"))
        created_type = card_type is None
        if created_type:
            await create_card_type(setup, key="Initiative", label="Initiative")
        card = await create_card(setup, card_type="Initiative", name="Concurrent PPM test")
        budget = await create_budget_line(setup, initiative_id=card.id, amount=100)
        cost = await create_cost_line(setup, initiative_id=card.id, actual=100)
        cost.budget_line_id = budget.id
        initiative_id, cost_id = card.id, cost.id
        await setup.commit()

    entered = asyncio.Event()
    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as deleting:
            await lock_initiative(deleting, initiative_id)
            await deleting.execute(delete(PpmCostLine).where(PpmCostLine.id == cost_id))
            body = PpmInvoiceCreate(
                cost_item_id=cost_id,
                invoice_date="2026-11-23",
                invoice_id="INV-CONCURRENT",
                amount="10",
            )

            async def create_after_delete():
                async with AsyncSession(test_engine, expire_on_commit=False) as writing:
                    entered.set()
                    with pytest.raises(HTTPException) as error:
                        await create_invoice(writing, initiative_id, body)
                    assert error.value.status_code == 404

            pending = asyncio.create_task(create_after_delete())
            await entered.wait()
            await deleting.commit()
            await asyncio.wait_for(pending, timeout=10)
    finally:
        async with AsyncSession(test_engine) as cleanup:
            await cleanup.execute(delete(Card).where(Card.id == initiative_id))
            if created_type:
                await cleanup.execute(delete(CardType).where(CardType.key == "Initiative"))
            await cleanup.commit()


async def test_cost_delete_waits_for_invoice_and_returns_conflict(test_engine, monkeypatch):
    import asyncio

    import pytest
    from fastapi import HTTPException
    from sqlalchemy import delete, select
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.v1.ppm import delete_cost_line
    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.ppm_cost_line import PpmCostLine
    from app.models.ppm_invoice import PpmInvoice
    from app.models.role import Role
    from app.models.user import User
    from app.schemas.ppm import PpmInvoiceCreate
    from app.services import ppm_financials
    from tests.conftest import (
        create_budget_line,
        create_card,
        create_card_type,
        create_cost_line,
        create_role,
        create_user,
    )

    role_key = "pml_concurrent_" + uuid4().hex[:12]
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        card_type = await setup.scalar(select(CardType).where(CardType.key == "Initiative"))
        created_type = card_type is None
        if created_type:
            await create_card_type(setup, key="Initiative", label="Initiative")
        await create_role(setup, key=role_key, permissions={"*": True})
        user = await create_user(setup, role=role_key)
        card = await create_card(setup, card_type="Initiative", name="Concurrent PPM test")
        budget = await create_budget_line(setup, initiative_id=card.id, amount=100)
        cost = await create_cost_line(setup, initiative_id=card.id, actual=100)
        cost.budget_line_id = budget.id
        initiative_id, cost_id, user_id = card.id, cost.id, user.id
        await setup.commit()

    entered = asyncio.Event()
    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as writing:
            body = PpmInvoiceCreate(
                cost_item_id=cost_id,
                invoice_date="2026-11-23",
                invoice_id="INV-CONCURRENT",
                amount="10",
            )
            await ppm_financials.create_invoice(writing, initiative_id, body)
            original_lock = ppm_financials.lock_initiative

            async def signaled_lock(db_session, card_id):
                entered.set()
                await original_lock(db_session, card_id)

            monkeypatch.setattr(ppm_financials, "lock_initiative", signaled_lock)

            async def delete_after_invoice():
                async with AsyncSession(test_engine, expire_on_commit=False) as deleting:
                    deleting_user = await deleting.get(User, user_id)
                    with pytest.raises(HTTPException) as error:
                        await delete_cost_line(str(cost_id), db=deleting, user=deleting_user)
                    assert error.value.status_code == 409

            pending = asyncio.create_task(delete_after_invoice())
            await asyncio.wait_for(entered.wait(), timeout=10)
            await writing.commit()
            await asyncio.wait_for(pending, timeout=10)

        async with AsyncSession(test_engine) as verification:
            assert await verification.get(PpmCostLine, cost_id) is not None
            invoice = await verification.scalar(
                select(PpmInvoice).where(PpmInvoice.cost_item_id == cost_id)
            )
            assert invoice is not None
            assert invoice.invoice_id == "INV-CONCURRENT"
    finally:
        async with AsyncSession(test_engine) as cleanup:
            await cleanup.execute(delete(Card).where(Card.id == initiative_id))
            await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.execute(delete(Role).where(Role.key == role_key))
            if created_type:
                await cleanup.execute(delete(CardType).where(CardType.key == "Initiative"))
            await cleanup.commit()


async def test_required_financial_fields_reject_null_without_changing_rows(client, ppm_env):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    budget = await _budget(client, initiative_id, headers)
    cost = await _cost(client, initiative_id, headers, budget["id"], amount=123.45)
    for path, fields in (
        (f"{BASE}/budgets/{budget['id']}", ("fiscal_year", "category", "amount")),
        (f"{BASE}/costs/{cost['id']}", ("description", "category", "planned", "actual")),
    ):
        for field in fields:
            response = await client.patch(path, json={field: None}, headers=headers)
            assert response.status_code == 422
    result = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert result.status_code == 200
    assert Decimal(result.json()["budget_totals"]["total_cost_items"]) == Decimal("123.45")


@pytest.mark.parametrize(
    "row_type,field",
    [
        ("budget", "amount"),
        ("cost", "planned"),
        ("cost", "actual"),
    ],
)
async def test_invalid_historical_amount_reports_conflict(client, db, ppm_env, row_type, field):
    initiative_id = str(ppm_env["initiative"].id)
    headers = auth_headers(ppm_env["admin"])
    factory = create_budget_line if row_type == "budget" else create_cost_line
    row = await factory(db, initiative_id=ppm_env["initiative"].id, **{field: float("nan")})
    response = await client.get(f"{BASE}/initiatives/{initiative_id}/financials", headers=headers)
    assert response.status_code == 409
    assert "non-finite" in response.json()["detail"].lower()
    assert getattr(row, field) != getattr(row, field)
