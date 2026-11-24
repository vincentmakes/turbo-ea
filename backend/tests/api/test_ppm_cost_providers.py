"""API regressions for budget Provider inheritance and child selection."""

from decimal import Decimal

import pytest

from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

pytest_plugins = ("tests.api.test_ppm",)
SETTINGS = "/api/v1/settings/pml/financial-fields"


@pytest.fixture
async def provider_setup(client, db, ppm_env):
    provider_type = await create_card_type(db, key="Provider", label="Provider", has_hierarchy=True)
    parent = await create_card(db, card_type="Provider", name="Aruba Software")
    child = await create_card(
        db, card_type="Provider", name="Software Licensing", parent_id=parent.id
    )
    other = await create_card(db, card_type="Provider", name="Other Provider")
    foreign_child = await create_card(
        db, card_type="Provider", name="Other child", parent_id=other.id
    )
    headers = auth_headers(ppm_env["admin"])
    budget_config = {
        "fields": [
            {"key": "origin", "label": "Origin", "kind": "card_reference", "card_type": "Provider"}
        ],
        "visible_columns": ["origin"],
    }
    cost_config = {
        "fields": [],
        "visible_columns": [],
        "provider_source": {"budget_field_key": "origin", "allow_child_selection": True},
    }
    for section, body in (("budget", budget_config), ("cost_item", cost_config)):
        response = await client.put(f"{SETTINGS}/{section}", json=body, headers=headers)
        assert response.status_code == 200, response.text

    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 100,
            "field_values": {"origin": str(parent.id)},
        },
        headers=headers,
    )
    assert budget.status_code == 200, budget.text
    return {
        "base": base,
        "headers": headers,
        "budget": budget.json(),
        "parent": parent,
        "child": child,
        "other": other,
        "foreign_child": foreign_child,
        "provider_type": provider_type,
    }


async def test_budget_provider_default_child_selection_and_clearing(client, provider_setup):
    env = provider_setup
    response = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": env["budget"]["id"],
            "description": "Licensing",
            "category": "opex",
            "actual": 80,
        },
        headers=env["headers"],
    )
    assert response.status_code == 200, response.text
    cost = response.json()
    assert cost["provider"]["id"] == str(env["parent"].id)
    assert cost["provider_child_id"] is None

    patched = await client.patch(
        f"/api/v1/ppm/costs/{cost['id']}",
        json={"provider_child_id": str(env["child"].id)},
        headers=env["headers"],
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["provider_child_id"] == str(env["child"].id)
    assert patched.json()["provider"]["id"] == str(env["child"].id)

    renamed = await client.patch(
        f"/api/v1/ppm/costs/{cost['id']}",
        json={"description": "Renewal"},
        headers=env["headers"],
    )
    assert renamed.status_code == 200
    assert renamed.json()["provider"]["id"] == str(env["child"].id)

    cleared = await client.patch(
        f"/api/v1/ppm/costs/{cost['id']}",
        json={"provider_child_id": None},
        headers=env["headers"],
    )
    assert cleared.status_code == 200
    assert cleared.json()["provider_child_id"] is None
    assert cleared.json()["provider"]["id"] == str(env["parent"].id)


async def test_provider_child_picker_and_invalid_children(client, db, provider_setup):
    env = provider_setup
    archived = await create_card(
        db,
        card_type="Provider",
        name="Archived child",
        parent_id=env["parent"].id,
        status="ARCHIVED",
    )
    endpoint = f"{env['base']}/budgets/{env['budget']['id']}/provider-children"
    response = await client.get(
        endpoint, params={"search": "Software", "page": 1, "page_size": 10}, headers=env["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(env["child"].id)
    for invalid in (env["foreign_child"].id, archived.id):
        rejected = await client.post(
            f"{env['base']}/costs",
            json={
                "budget_line_id": env["budget"]["id"],
                "description": "Invalid",
                "category": "opex",
                "provider_child_id": str(invalid),
            },
            headers=env["headers"],
        )
        assert rejected.status_code in (400, 404, 422)


async def test_disabling_hierarchy_preserves_old_selection_but_blocks_new(
    client, db, provider_setup
):
    env = provider_setup
    created = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": env["budget"]["id"],
            "description": "Cost",
            "category": "opex",
            "provider_child_id": str(env["child"].id),
        },
        headers=env["headers"],
    )
    assert created.status_code == 200, created.text
    env["provider_type"].has_hierarchy = False
    await db.flush()
    endpoint = f"{env['base']}/budgets/{env['budget']['id']}/provider-children"
    choices = await client.get(endpoint, headers=env["headers"])
    assert choices.status_code == 200
    assert choices.json()["items"] == []
    changed = await client.patch(
        f"/api/v1/ppm/costs/{created.json()['id']}",
        json={"description": "Renamed"},
        headers=env["headers"],
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["provider"]["id"] == str(env["child"].id)
    new_cost = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": env["budget"]["id"],
            "description": "New",
            "category": "opex",
            "provider_child_id": str(env["child"].id),
        },
        headers=env["headers"],
    )
    assert new_cost.status_code in (400, 404, 422)


async def test_invoice_moves_across_different_providers(client, provider_setup):
    env = provider_setup
    costs = []
    for label, child in (("Renewal", str(env["child"].id)), ("Support", None)):
        response = await client.post(
            f"{env['base']}/costs",
            json={
                "budget_line_id": env["budget"]["id"],
                "description": label,
                "category": "opex",
                "actual": 80,
                "provider_child_id": child,
            },
            headers=env["headers"],
        )
        assert response.status_code == 200, response.text
        costs.append(response.json())

    invoice = await client.post(
        f"{env['base']}/invoices",
        json={
            "cost_item_id": costs[0]["id"],
            "invoice_date": "2026-11-23",
            "invoice_id": "INV-0001",
            "amount": "30.11",
        },
        headers=env["headers"],
    )
    assert invoice.status_code == 200
    original = invoice.json()
    before = await client.get(f"{env['base']}/financials", headers=env["headers"])
    assert before.status_code == 200, before.text
    assert costs[0]["provider"]["id"] != costs[1]["provider"]["id"]
    moved = await client.patch(
        f"/api/v1/ppm/invoices/{invoice.json()['id']}",
        json={"cost_item_id": costs[1]["id"]},
        headers=env["headers"],
    )
    assert moved.status_code == 200, moved.text
    updated = moved.json()
    assert updated["cost_item_id"] == costs[1]["id"]
    for field in ("id", "invoice_id", "invoice_date", "amount"):
        assert updated[field] == original[field]
    assert "provider" not in updated
    financials = await client.get(f"{env['base']}/financials", headers=env["headers"])
    assert financials.status_code == 200
    result = financials.json()
    assert Decimal(result["actual_invoiced"]) == Decimal("30.11")
    assert result["actual_invoiced"] == before.json()["actual_invoiced"]
    rows = {row["id"]: row for row in result["cost_items"]}
    assert Decimal(rows[costs[0]["id"]]["total_invoiced"]) == 0
    assert Decimal(rows[costs[1]["id"]]["total_invoiced"]) == Decimal("30.11")


async def test_budget_provider_change_with_invoice_and_conflicting_child(client, provider_setup):
    env = provider_setup
    budget_id = env["budget"]["id"]
    selected = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": budget_id,
            "description": "Child cost",
            "category": "opex",
            "provider_child_id": str(env["child"].id),
        },
        headers=env["headers"],
    )
    assert selected.status_code == 200
    invoice = await client.post(
        f"{env['base']}/invoices",
        json={
            "cost_item_id": selected.json()["id"],
            "invoice_date": "2026-11-23",
            "invoice_id": "INV-0002",
            "amount": "10",
        },
        headers=env["headers"],
    )
    assert invoice.status_code == 200
    conflict = await client.patch(
        f"/api/v1/ppm/budgets/{budget_id}",
        json={"field_values": {"origin": str(env["other"].id)}},
        headers=env["headers"],
    )
    assert conflict.status_code == 409
    listed = await client.get(f"{env['base']}/costs", headers=env["headers"])
    assert listed.status_code == 200
    assert listed.json()[0]["provider"]["id"] == str(env["child"].id)

    cleared = await client.patch(
        f"/api/v1/ppm/costs/{selected.json()['id']}",
        json={"provider_child_id": None},
        headers=env["headers"],
    )
    assert cleared.status_code == 200
    changed = await client.patch(
        f"/api/v1/ppm/budgets/{budget_id}",
        json={"field_values": {"origin": str(env["other"].id)}},
        headers=env["headers"],
    )
    assert changed.status_code == 200, changed.text
    costs = await client.get(f"{env['base']}/costs", headers=env["headers"])
    assert costs.json()[0]["provider"]["id"] == str(env["other"].id)
    financials = await client.get(f"{env['base']}/financials", headers=env["headers"])
    assert financials.status_code == 200
    assert Decimal(financials.json()["actual_invoiced"]) == Decimal("10")


async def test_provider_formula_context_is_redacted_for_hidden_parent(client, db, provider_setup):
    env = provider_setup
    config = {
        "fields": [
            {
                "key": "provider_match",
                "label": "Provider match",
                "kind": "calculated",
                "calculation": {
                    "result_type": "text",
                    "inputs": {"effective": "provider.effective", "budget": "provider.budget"},
                    "rules": [
                        {
                            "when": {
                                "op": "all",
                                "conditions": [
                                    {
                                        "op": "eq",
                                        "input": "effective",
                                        "value": str(env["child"].id),
                                    },
                                    {"op": "eq", "input": "budget", "value": str(env["parent"].id)},
                                ],
                            },
                            "then": "match",
                        }
                    ],
                    "fallback": "other",
                },
            }
        ],
        "visible_columns": ["provider_match"],
        "provider_source": {"budget_field_key": "origin", "allow_child_selection": True},
    }
    saved = await client.put(f"{SETTINGS}/cost_item", json=config, headers=env["headers"])
    assert saved.status_code == 200, saved.text
    created = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": env["budget"]["id"],
            "description": "Cost",
            "category": "opex",
            "provider_child_id": str(env["child"].id),
        },
        headers=env["headers"],
    )
    assert created.status_code == 200, created.text
    for path, key in (("costs", None), ("financials", "cost_items")):
        response = await client.get(f"{env['base']}/{path}", headers=env["headers"])
        assert response.status_code == 200, response.text
        rows = response.json() if key is None else response.json()[key]
        assert rows[0]["calculated_values"]["provider_match"] == "match"

    await create_role(
        db, key="pml_hidden_provider", permissions={"inventory.view": True, "ppm.view": True}
    )
    env["provider_type"].role_permissions = {"pml_hidden_provider": {"inventory.view": False}}
    viewer = await create_user(
        db, role="pml_hidden_provider", email="pml-hidden-provider@example.test"
    )
    await db.flush()
    for path, key in (("costs", None), ("financials", "cost_items")):
        response = await client.get(f"{env['base']}/{path}", headers=auth_headers(viewer))
        assert response.status_code == 200, response.text
        assert str(env["parent"].id) not in response.text
        assert str(env["child"].id) not in response.text
        rows = response.json() if key is None else response.json()[key]
        assert rows[0]["provider"] == {"status": "UNAVAILABLE"}
        assert "provider_match" not in rows[0]["calculated_values"]


async def test_move_cost_with_child_to_different_budget_requires_clear(client, provider_setup):
    env = provider_setup
    other_budget = await client.post(
        f"{env['base']}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 10,
            "field_values": {"origin": str(env["other"].id)},
        },
        headers=env["headers"],
    )
    assert other_budget.status_code == 200, other_budget.text
    cost = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": env["budget"]["id"],
            "description": "Cost",
            "category": "opex",
            "provider_child_id": str(env["child"].id),
        },
        headers=env["headers"],
    )
    assert cost.status_code == 200, cost.text
    endpoint = f"/api/v1/ppm/costs/{cost.json()['id']}"
    conflict = await client.patch(
        endpoint, json={"budget_line_id": other_budget.json()["id"]}, headers=env["headers"]
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["detail"]["cost_ids"] == [cost.json()["id"]]
    moved = await client.patch(
        endpoint,
        json={"budget_line_id": other_budget.json()["id"], "provider_child_id": None},
        headers=env["headers"],
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["provider"]["id"] == str(env["other"].id)


@pytest.mark.parametrize("creating", [True, False])
async def test_budget_rechecks_provider_after_financial_lock(
    client, db, provider_setup, monkeypatch, creating
):
    from sqlalchemy import update

    from app.models.card import Card
    from app.services import ppm_field_relations

    env = provider_setup
    new_provider_id = env["other"].id
    original = ppm_field_relations.prepare_configured_card_relations

    async def archive_before_lock(*args, **kwargs):
        await db.execute(update(Card).where(Card.id == new_provider_id).values(status="ARCHIVED"))
        return await original(*args, **kwargs)

    monkeypatch.setattr(
        ppm_field_relations, "prepare_configured_card_relations", archive_before_lock
    )
    fields = {"field_values": {"origin": str(new_provider_id)}}
    if creating:
        response = await client.post(
            f"{env['base']}/budgets",
            json={"fiscal_year": 2026, "category": "opex", "amount": 50, **fields},
            headers=env["headers"],
        )
    else:
        response = await client.patch(
            f"/api/v1/ppm/budgets/{env['budget']['id']}", json=fields, headers=env["headers"]
        )
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {"origin": "Card is unavailable"}


async def test_editor_cannot_replace_invisible_provider_child(client, db, provider_setup):
    env = provider_setup
    response = await client.post(
        f"{env['base']}/costs",
        json={
            "budget_line_id": env["budget"]["id"],
            "description": "Restricted child",
            "category": "opex",
            "provider_child_id": str(env["child"].id),
        },
        headers=env["headers"],
    )
    assert response.status_code == 200, response.text
    cost_id = response.json()["id"]
    await create_role(
        db,
        key="pml_provider_editor",
        permissions={"inventory.view": True, "ppm.view": True, "ppm.manage": True},
    )
    env["provider_type"].role_permissions = {"pml_provider_editor": {"inventory.view": False}}
    editor = await create_user(db, role="pml_provider_editor", email="provider-editor@example.test")
    await db.flush()
    headers = auth_headers(editor)
    for value in (None, str(env["child"].id)):
        response = await client.patch(
            f"/api/v1/ppm/costs/{cost_id}", json={"provider_child_id": value}, headers=headers
        )
        assert response.status_code == 403
        assert str(env["child"].id) not in response.text
    response = await client.patch(
        f"/api/v1/ppm/costs/{cost_id}", json={"description": "Updated"}, headers=headers
    )
    assert response.status_code == 200, response.text
    saved = await client.get(f"{env['base']}/costs", headers=env["headers"])
    assert saved.status_code == 200
    assert saved.json()[0]["provider_child_id"] == str(env["child"].id)
