"""API contracts for configurable PML financial fields."""

from tests.api.test_ppm import ppm_env as ppm_env
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

SETTINGS = "/api/v1/settings/pml/financial-fields"


def _config(*fields):
    return {"fields": list(fields), "visible_columns": [field["key"] for field in fields]}


def _field(key, kind="text", **options):
    return {"key": key, "label": key, "kind": kind, "active": True, **options}


async def test_financial_field_settings_are_admin_only(client, ppm_env):
    headers = auth_headers(ppm_env["viewer"])
    assert (await client.get(SETTINGS, headers=headers)).status_code == 403
    assert (
        await client.put(f"{SETTINGS}/budget", json=_config(_field("reference")), headers=headers)
    ).status_code == 403
    assert (
        await client.post(
            f"{SETTINGS}/invoice/preview",
            json={"configuration": _config(), "field_key": "year", "sample_values": {}},
            headers=headers,
        )
    ).status_code == 403


async def test_sections_are_saved_independently_and_keep_stable_keys(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    budget_config = _config(_field("origin"))
    cost_config = _config(
        _field(
            "intercompany",
            "select",
            options=[{"id": "canone", "label": "Canone", "active": True}],
        )
    )
    for section, body in (("budget", budget_config), ("cost_item", cost_config)):
        response = await client.put(f"{SETTINGS}/{section}", json=body, headers=headers)
        assert response.status_code == 200, response.text

    renamed = _config(
        _field(
            "intercompany",
            "select",
            options=[{"id": "canone", "label": "Recurring", "active": True}],
        )
    )
    assert (
        await client.put(f"{SETTINGS}/cost_item", json=renamed, headers=headers)
    ).status_code == 200
    response = await client.get(SETTINGS, headers=headers)
    assert response.status_code == 200
    saved = response.json()
    assert saved["budget"]["fields"][0]["key"] == "origin"
    option = saved["cost_item"]["fields"][0]["options"][0]
    assert option["id"] == "canone"
    assert option["label"] == "Recurring"


async def test_invoice_year_preview_and_saved_calculation_agree(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    config = _config(
        _field(
            "invoice_year",
            "calculated",
            calculation={
                "result_type": "number",
                "inputs": {"d": "invoice_date"},
                "expression": "YEAR(d)",
            },
        )
    )
    preview = await client.post(
        f"{SETTINGS}/invoice/preview",
        json={
            "configuration": config,
            "field_key": "invoice_year",
            "sample_values": {"invoice_date": "2026-11-10"},
        },
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["value"] == "2026"
    assert not preview.json()["errors"]
    assert (
        await client.put(f"{SETTINGS}/invoice", json=config, headers=headers)
    ).status_code == 200

    initiative_id = ppm_env["initiative"].id
    base = f"/api/v1/ppm/initiatives/{initiative_id}"
    budget = await client.post(
        f"{base}/budgets",
        json={"fiscal_year": 2026, "category": "opex", "amount": 100},
        headers=headers,
    )
    assert budget.status_code == 200
    cost = await client.post(
        f"{base}/costs",
        json={"budget_line_id": budget.json()["id"], "description": "Cost", "category": "opex"},
        headers=headers,
    )
    assert cost.status_code == 200
    invoice = await client.post(
        f"{base}/invoices",
        json={
            "cost_item_id": cost.json()["id"],
            "invoice_date": "2026-11-10",
            "invoice_id": "INV-001",
            "amount": "30.11",
        },
        headers=headers,
    )
    assert invoice.status_code == 200
    financials = await client.get(f"{base}/financials", headers=headers)
    assert financials.status_code == 200
    entry = next(row for row in financials.json()["invoices"] if row["id"] == invoice.json()["id"])
    assert entry["calculated_values"]["invoice_year"] == "2026"


async def test_invoice_configuration_rejects_provider_and_allows_organization(client, db, ppm_env):
    await create_card_type(db, key="Provider", label="Provider")
    await create_card_type(db, key="Organization", label="Organization")
    headers = auth_headers(ppm_env["admin"])
    provider = _config(_field("supplier", "card_reference", card_type="Provider"))
    response = await client.put(f"{SETTINGS}/invoice", json=provider, headers=headers)
    assert response.status_code in (400, 422)
    organization = _config(_field("department", "card_reference", card_type="Organization"))
    response = await client.put(f"{SETTINGS}/invoice", json=organization, headers=headers)
    assert response.status_code == 200, response.text


async def test_required_custom_field_is_enforced_and_unmodified_value_is_preserved(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    config = _config(_field("purchase_order", required=True))
    response = await client.put(f"{SETTINGS}/cost_item", json=config, headers=headers)
    assert response.status_code == 200
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={"fiscal_year": 2026, "category": "opex", "amount": 100},
        headers=headers,
    )
    assert budget.status_code == 200
    payload = {
        "budget_line_id": budget.json()["id"],
        "description": "Cost",
        "category": "opex",
    }
    missing = await client.post(f"{base}/costs", json=payload, headers=headers)
    assert missing.status_code in (400, 422)
    payload["field_values"] = {"purchase_order": "ODA-000427"}
    created = await client.post(f"{base}/costs", json=payload, headers=headers)
    assert created.status_code == 200, created.text
    cost_id = created.json()["id"]
    edited = await client.patch(
        f"/api/v1/ppm/costs/{cost_id}", json={"description": "Updated"}, headers=headers
    )
    assert edited.status_code == 200
    assert edited.json()["field_values"]["purchase_order"] == "ODA-000427"


async def test_hidden_card_constants_and_transitive_results_are_not_disclosed(client, db, ppm_env):
    await create_role(
        db,
        key="pml_scoped_admin",
        permissions={"admin.settings": True, "inventory.view": True, "ppm.view": True},
    )
    await create_card_type(
        db,
        key="Organization",
        label="Organization",
        role_permissions={"pml_scoped_admin": {"inventory.view": False}},
    )
    hidden = await create_card(db, card_type="Organization", name="Hidden organization")
    scoped = await create_user(db, role="pml_scoped_admin", email="scoped-pml@example.test")
    admin_headers = auth_headers(ppm_env["admin"])
    scoped_headers = auth_headers(scoped)
    classification = _field(
        "classification",
        "calculated",
        calculation={
            "result_type": "text",
            "inputs": {"o": "org"},
            "rules": [{"when": {"op": "eq", "input": "o", "value": str(hidden.id)}, "then": "yes"}],
            "fallback": "no",
        },
    )
    derived = _field(
        "derived",
        "calculated",
        calculation={"result_type": "text", "inputs": {"x": "classification"}, "expression": "x"},
    )
    config = _config(
        _field("org", "card_reference", card_type="Organization", default=str(hidden.id)),
        classification,
        derived,
    )
    saved = await client.put(f"{SETTINGS}/cost_item", json=config, headers=admin_headers)
    assert saved.status_code == 200, saved.text

    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={"fiscal_year": 2026, "category": "opex", "amount": 100},
        headers=admin_headers,
    )
    assert budget.status_code == 200
    cost = await client.post(
        f"{base}/costs",
        json={"budget_line_id": budget.json()["id"], "description": "Cost", "category": "opex"},
        headers=admin_headers,
    )
    assert cost.status_code == 200, cost.text
    assert cost.json()["calculated_values"]["classification"] == "yes"

    settings = await client.get(SETTINGS, headers=scoped_headers)
    assert settings.status_code == 200, settings.text
    assert str(hidden.id) not in settings.text
    fields = settings.json()["cost_item"]["fields"]
    assert {field["key"] for field in fields if field.get("protected")} == {"org", "classification"}
    retained = _config(
        {"key": "org", "keep_existing": True},
        {"key": "classification", "keep_existing": True},
        derived,
        _field("note"),
    )
    response = await client.put(f"{SETTINGS}/cost_item", json=retained, headers=scoped_headers)
    assert response.status_code == 200, response.text
    rejected = await client.put(
        f"{SETTINGS}/cost_item", json=_config(derived), headers=scoped_headers
    )
    assert rejected.status_code == 403

    listing = await client.get(f"{base}/costs", headers=scoped_headers)
    assert listing.status_code == 200, listing.text
    assert str(hidden.id) not in listing.text
    entry = listing.json()[0]
    assert "org" not in entry["field_values"]
    assert entry["reference_display"]["org"] == {"status": "UNAVAILABLE"}
    assert "classification" not in entry["calculated_values"]
    assert "derived" not in entry["calculated_values"]
    financials = await client.get(f"{base}/financials", headers=scoped_headers)
    assert financials.status_code == 200
    assert str(hidden.id) not in financials.text
    assert "classification" not in financials.json()["cost_items"][0]["calculated_values"]
    assert "derived" not in financials.json()["cost_items"][0]["calculated_values"]

    preview = await client.post(
        f"{SETTINGS}/cost_item/preview",
        json={
            "configuration": config,
            "field_key": "classification",
            "sample_values": {"org": str(hidden.id)},
        },
        headers=scoped_headers,
    )
    assert preview.status_code == 403


async def test_only_unpopulated_field_can_change_type(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    text_config = _config(_field("tracking"))
    number_config = _config(_field("tracking", "number"))
    assert (
        await client.put(f"{SETTINGS}/budget", json=text_config, headers=headers)
    ).status_code == 200
    assert (
        await client.put(f"{SETTINGS}/budget", json=number_config, headers=headers)
    ).status_code == 200
    assert (
        await client.put(f"{SETTINGS}/budget", json=text_config, headers=headers)
    ).status_code == 200
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 100,
            "field_values": {"tracking": "123"},
        },
        headers=headers,
    )
    assert budget.status_code == 200, budget.text
    changed = await client.put(f"{SETTINGS}/budget", json=number_config, headers=headers)
    assert changed.status_code in (400, 409, 422)
    assert (await client.get(SETTINGS, headers=headers)).json()["budget"]["fields"][0][
        "kind"
    ] == "text"


async def test_card_reference_settings_validate_type_status_and_preview_sample(client, db, ppm_env):
    await create_card_type(db, key="Provider", label="Provider")
    await create_card_type(db, key="Organization", label="Organization")
    provider = await create_card(db, card_type="Provider", name="Provider")
    archived = await create_card(db, card_type="Organization", name="Archived", status="ARCHIVED")
    headers = auth_headers(ppm_env["admin"])
    for card in (provider, archived):
        config = _config(
            _field("org", "card_reference", card_type="Organization", default=str(card.id))
        )
        response = await client.put(f"{SETTINGS}/invoice", json=config, headers=headers)
        assert response.status_code == 422
    config = _config(
        _field("org", "card_reference", card_type="Organization"),
        _field(
            "is_set",
            "calculated",
            calculation={
                "result_type": "text",
                "inputs": {"o": "org"},
                "rules": [
                    {"when": {"op": "eq", "input": "o", "value": str(provider.id)}, "then": "yes"}
                ],
                "fallback": "no",
            },
        ),
    )
    response = await client.put(f"{SETTINGS}/invoice", json=config, headers=headers)
    assert response.status_code == 422
    config["fields"][1]["calculation"]["rules"] = []
    response = await client.post(
        f"{SETTINGS}/invoice/preview",
        json={
            "configuration": config,
            "field_key": "is_set",
            "sample_values": {"org": str(provider.id)},
        },
        headers=headers,
    )
    assert response.status_code == 422
    response = await client.post(
        f"{SETTINGS}/invoice/preview",
        json={"configuration": config, "field_key": "org", "sample_values": {}},
        headers=headers,
    )
    assert response.status_code == 422


async def test_populated_field_and_option_cannot_be_removed(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    config = _config(
        _field("choice", "select", options=[{"id": "old", "label": "Old", "active": True}])
    )
    assert (await client.put(f"{SETTINGS}/budget", json=config, headers=headers)).status_code == 200
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    response = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "field_values": {"choice": "old"},
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    removed = await client.put(f"{SETTINGS}/budget", json=_config(), headers=headers)
    assert removed.status_code == 422
    no_option = _config(_field("choice", "select", options=[]))
    removed_option = await client.put(f"{SETTINGS}/budget", json=no_option, headers=headers)
    assert removed_option.status_code == 422
    inactive = _config(
        _field("choice", "select", options=[{"id": "old", "label": "Old", "active": False}])
    )
    assert (
        await client.put(f"{SETTINGS}/budget", json=inactive, headers=headers)
    ).status_code == 200


async def test_settings_and_row_payload_reject_unknown_shapes(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    bad = await client.put(f"{SETTINGS}/budget", json={"fields": [8]}, headers=headers)
    assert bad.status_code == 422
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    forged = await client.post(
        f"{base}/budgets",
        json={"fiscal_year": 2026, "category": "opex", "calculated_values": {"amount": 20}},
        headers=headers,
    )
    assert forged.status_code == 422


async def test_automatic_relation_denial_rolls_back_financial_row(client, db, ppm_env):
    from sqlalchemy import select

    from app.models.relation import Relation
    from tests.conftest import create_relation_type

    await create_card_type(db, key="Organization", label="Organization")
    organization = await create_card(db, card_type="Organization", name="Supplier")
    organization_id = organization.id
    initiative_id = ppm_env["initiative"].id
    await create_relation_type(
        db,
        key="org_supports_initiative",
        label="Supports",
        source_type_key="Organization",
        target_type_key="Initiative",
    )
    await create_role(
        db,
        key="pml_no_autolink",
        permissions={"inventory.view": True, "ppm.view": True, "ppm.manage": True},
    )
    editor = await create_user(db, role="pml_no_autolink", email="pml-editor@example.test")
    editor_headers = auth_headers(editor)
    admin_headers = auth_headers(ppm_env["admin"])
    configured = await client.put(
        f"{SETTINGS}/budget",
        json=_config(
            _field(
                "org",
                "card_reference",
                card_type="Organization",
                relation_type="org_supports_initiative",
            )
        ),
        headers=admin_headers,
    )
    assert configured.status_code == 200, configured.text
    budgets = f"/api/v1/ppm/initiatives/{initiative_id}/budgets"
    payload = {
        "fiscal_year": 2026,
        "category": "opex",
        "amount": 100,
        "field_values": {"org": str(organization_id)},
    }
    denied = await client.post(budgets, json=payload, headers=editor_headers)
    assert denied.status_code == 403, denied.text
    # The API fixture reuses a session for all HTTP calls. Mimic request teardown.
    await db.rollback()
    listed = await client.get(budgets, headers=admin_headers)
    assert listed.status_code == 200, listed.text
    assert listed.json() == []
    assert (
        await db.scalars(select(Relation).where(Relation.type == "org_supports_initiative"))
    ).all() == []
    created = await client.post(budgets, json=payload, headers=admin_headers)
    assert created.status_code == 200, created.text
    relation = await db.scalar(select(Relation).where(Relation.type == "org_supports_initiative"))
    assert relation is not None
    assert (relation.source_id, relation.target_id) == (organization_id, initiative_id)


async def test_provider_inheritance_keeps_its_active_budget_field(client, ppm_env, db):
    headers = auth_headers(ppm_env["admin"])
    await create_card_type(db, key="Provider")
    origin = _field("origin", "card_reference", card_type="Provider")
    cost = {**_config(), "provider_source": {"budget_field_key": "origin"}}

    missing = await client.put(f"{SETTINGS}/cost_item", json=cost, headers=headers)
    assert missing.status_code == 422, missing.text
    assert "provider_source" in missing.json()["detail"]

    assert (
        await client.put(f"{SETTINGS}/budget", json=_config(origin), headers=headers)
    ).status_code == 200
    assert (
        await client.put(f"{SETTINGS}/cost_item", json=cost, headers=headers)
    ).status_code == 200

    for invalid in (_config(), _config({**origin, "active": False}), _config(_field("origin"))):
        response = await client.put(f"{SETTINGS}/budget", json=invalid, headers=headers)
        assert response.status_code == 422, response.text
        assert "provider_source" in response.json()["detail"]

    hidden = {**_config(origin), "visible_columns": []}
    assert (await client.put(f"{SETTINGS}/budget", json=hidden, headers=headers)).status_code == 200
    assert (
        await client.put(f"{SETTINGS}/cost_item", json=_config(), headers=headers)
    ).status_code == 200
    assert (
        await client.put(f"{SETTINGS}/budget", json=_config(), headers=headers)
    ).status_code == 200


async def test_budget_without_costs_exposes_the_configured_provider_to_ppm_editor(
    client, ppm_env, db
):
    admin = auth_headers(ppm_env["admin"])
    await create_card_type(db, key="Provider", has_hierarchy=True, built_in=True)
    parent = await create_card(db, card_type="Provider", name="Budget Provider")
    other = await create_card(db, card_type="Provider", name="Other configured reference")
    await create_role(
        db,
        key="pml_editor",
        permissions={
            "inventory.view": True,
            "ppm.view": True,
            "ppm.manage": True,
            "costs.view": True,
        },
    )
    editor = auth_headers(await create_user(db, email="pml-editor@test.com", role="pml_editor"))
    assert (await client.get(SETTINGS, headers=editor)).status_code == 403
    budget = _config(
        _field("other", "card_reference", card_type="Provider"),
        _field("origin", "card_reference", card_type="Provider"),
    )
    budget["visible_columns"] = ["other"]
    cost = {
        **_config(),
        "provider_source": {"budget_field_key": "origin", "allow_child_selection": True},
    }
    for section, config in (("budget", budget), ("cost_item", cost)):
        response = await client.put(f"{SETTINGS}/{section}", json=config, headers=admin)
        assert response.status_code == 200, response.text
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    created = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 100,
            "field_values": {"origin": str(parent.id), "other": str(other.id)},
        },
        headers=admin,
    )
    assert created.status_code == 200, created.text

    response = await client.get(f"{base}/financials", headers=editor)
    assert response.status_code == 200, response.text
    financials = response.json()
    assert financials["cost_items"] == []
    row = financials["budget_lines"][0]
    assert row["provider"] == {"id": str(parent.id), "name": parent.name, "status": "ACTIVE"}
    assert row["provider_child_enabled"] is True


async def test_provider_relation_denial_and_reuse_for_ppm_editor(client, ppm_env, db):
    from sqlalchemy import select

    from app.models.relation import Relation
    from tests.conftest import create_relation, create_relation_type

    admin = auth_headers(ppm_env["admin"])
    initiative_id = ppm_env["initiative"].id
    await create_card_type(db, key="Provider", has_hierarchy=True, built_in=True)
    parent_id = (await create_card(db, card_type="Provider", name="Budget Provider")).id
    child_id = (
        await create_card(db, card_type="Provider", name="Child Provider", parent_id=parent_id)
    ).id
    relation_key = "provider_serves_initiative"
    await create_relation_type(
        db,
        key=relation_key,
        label="Serves",
        source_type_key="Provider",
        target_type_key="Initiative",
    )
    await create_role(
        db,
        key="pml_editor",
        permissions={"inventory.view": True, "ppm.view": True, "ppm.manage": True},
    )
    editor = auth_headers(await create_user(db, email="pml-editor@test.com", role="pml_editor"))
    budget_config = _config(
        _field("origin", "card_reference", card_type="Provider", relation_type=relation_key)
    )
    cost_config = {
        **_config(),
        "provider_source": {"budget_field_key": "origin", "allow_child_selection": True},
    }
    for section, config in (("budget", budget_config), ("cost_item", cost_config)):
        response = await client.put(f"{SETTINGS}/{section}", json=config, headers=admin)
        assert response.status_code == 200, response.text
    base = f"/api/v1/ppm/initiatives/{initiative_id}"
    budget = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 100,
            "field_values": {"origin": str(parent_id)},
        },
        headers=admin,
    )
    assert budget.status_code == 200, budget.text
    cost = await client.post(
        f"{base}/costs",
        json={
            "budget_line_id": budget.json()["id"],
            "description": "Initial",
            "category": "opex",
        },
        headers=editor,
    )
    assert cost.status_code == 200, cost.text
    cost_id = cost.json()["id"]
    cost_path = f"/api/v1/ppm/costs/{cost_id}"
    selected = {"provider_child_id": str(child_id)}
    denied = await client.patch(
        cost_path, json={**selected, "description": "Must roll back"}, headers=editor
    )
    assert denied.status_code == 403, denied.text
    await db.rollback()
    listed = await client.get(f"{base}/costs", headers=admin)
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["description"] == "Initial"
    assert listed.json()[0]["provider"]["id"] == str(parent_id)
    child_relation = select(Relation).where(
        Relation.type == relation_key, Relation.source_id == child_id
    )
    assert await db.scalar(child_relation) is None

    relation = await create_relation(
        db,
        type_key=relation_key,
        source_id=child_id,
        target_id=initiative_id,
        attributes={"existing": "preserve"},
    )
    relation.description = "Manually maintained"
    relation_id = relation.id
    updated = await client.patch(cost_path, json=selected, headers=editor)
    assert updated.status_code == 200, updated.text
    assert updated.json()["provider"]["id"] == str(child_id)
    invoice = await client.post(
        f"{base}/invoices",
        json={
            "cost_item_id": cost_id,
            "invoice_date": "2026-11-20",
            "invoice_id": "INV-471",
            "amount": "12.34",
        },
        headers=admin,
    )
    assert invoice.status_code == 200, invoice.text
    for payload, provider_id in (({"provider_child_id": None}, parent_id), (selected, child_id)):
        updated = await client.patch(cost_path, json=payload, headers=editor)
        assert updated.status_code == 200, updated.text
        assert updated.json()["provider"]["id"] == str(provider_id)
        assert "INV-471" not in updated.text

    retained = (await db.scalars(child_relation.execution_options(populate_existing=True))).one()
    assert retained.id == relation_id
    assert retained.description == "Manually maintained"
    assert retained.attributes == {"existing": "preserve"}


async def test_boolean_preview_matches_saved_row_with_zero_quantity(client, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    config = _config(
        _field("quantity", "number"),
        _field(
            "eligible",
            "calculated",
            calculation={
                "result_type": "boolean",
                "inputs": {"quantity": "quantity", "amount": "amount"},
                "expression": "quantity != 0 and amount / quantity > 1",
            },
        ),
    )
    preview = await client.post(
        f"{SETTINGS}/budget/preview",
        json={
            "configuration": config,
            "field_key": "eligible",
            "sample_values": {"quantity": "0", "amount": "4"},
        },
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json() == {"value": False, "errors": {}}
    assert (await client.put(f"{SETTINGS}/budget", json=config, headers=headers)).status_code == 200
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    created = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 4,
            "field_values": {"quantity": "0"},
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    financials = await client.get(f"{base}/financials", headers=headers)
    assert financials.status_code == 200, financials.text
    row = next(
        item for item in financials.json()["budget_lines"] if item["id"] == created.json()["id"]
    )
    assert row["calculated_values"]["eligible"] is False


async def test_setting_removal_waits_for_financial_write(test_engine, monkeypatch):
    import asyncio
    import uuid

    import pytest
    from fastapi import HTTPException
    from sqlalchemy import delete, select
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.v1.ppm import create_budget_line
    from app.models.app_settings import AppSettings
    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.role import Role
    from app.models.user import User
    from app.schemas.ppm import PpmBudgetLineCreate
    from tests.conftest import create_card, create_card_type, create_role, create_user

    key = "pml.financial_fields.budget"
    role_key = "pml_settings_" + uuid.uuid4().hex[:12]
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        old_settings = await setup.get(AppSettings, "default")
        original = dict(old_settings.general_settings or {}) if old_settings else None
        if old_settings is None:
            old_settings = AppSettings(id="default", general_settings={}, email_settings={})
            setup.add(old_settings)
        old_settings.general_settings = {
            **(original or {}),
            key: _config(_field("reference")),
        }
        card_type = await setup.scalar(select(CardType).where(CardType.key == "Initiative"))
        created_type = card_type is None
        if created_type:
            await create_card_type(setup, key="Initiative", label="Initiative")
        await create_role(setup, key=role_key, permissions={"*": True})
        user = await create_user(setup, role=role_key)
        card = await create_card(setup, card_type="Initiative", name="Concurrent field settings")
        user_id, card_id = user.id, card.id
        await setup.commit()

    pending = None
    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as admin:
            settings = await admin.scalar(
                select(AppSettings).where(AppSettings.id == "default").with_for_update()
            )
            settings.general_settings = {**settings.general_settings, key: _config()}
            await admin.flush()
            started = asyncio.Event()

            async def write_budget():
                async with AsyncSession(test_engine, expire_on_commit=False) as writer:
                    writer_user = await writer.get(User, user_id)
                    started.set()
                    return await create_budget_line(
                        str(card_id),
                        PpmBudgetLineCreate(
                            fiscal_year=2026,
                            category="opex",
                            amount=100,
                            field_values={"reference": "first value"},
                        ),
                        db=writer,
                        user=writer_user,
                    )

            pending = asyncio.create_task(write_budget())
            await asyncio.wait_for(started.wait(), timeout=10)
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(pending), timeout=0.3)
            await admin.commit()
            with pytest.raises(HTTPException) as error:
                await asyncio.wait_for(pending, timeout=10)
            assert error.value.status_code == 422
    finally:
        if pending and not pending.done():
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
        async with AsyncSession(test_engine) as cleanup:
            await cleanup.execute(delete(Card).where(Card.id == card_id))
            await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.execute(delete(Role).where(Role.key == role_key))
            if created_type:
                await cleanup.execute(delete(CardType).where(CardType.key == "Initiative"))
            settings = await cleanup.get(AppSettings, "default")
            if original is None:
                await cleanup.delete(settings)
            else:
                settings.general_settings = original
            await cleanup.commit()


async def test_changing_input_type_cannot_unprotect_existing_rule(client, db, ppm_env):
    await create_role(
        db,
        key="pml_rules_admin",
        permissions={"admin.settings": True, "inventory.view": True, "ppm.view": True},
    )
    await create_card_type(
        db,
        key="Organization",
        label="Organization",
        role_permissions={"pml_rules_admin": {"inventory.view": False}},
    )
    hidden = await create_card(db, card_type="Organization", name="Restricted organization")
    scoped = await create_user(db, role="pml_rules_admin", email="rules-scope@example.test")
    admin = auth_headers(ppm_env["admin"])
    editor = auth_headers(scoped)
    rule = _field(
        "classification",
        "calculated",
        calculation={
            "result_type": "text",
            "inputs": {"source": "organization"},
            "rules": [
                {"when": {"op": "eq", "input": "source", "value": str(hidden.id)}, "then": "A"}
            ],
            "fallback": "B",
        },
    )
    initial = _config(_field("organization", "card_reference", card_type="Organization"), rule)
    response = await client.put(f"{SETTINGS}/budget", json=initial, headers=admin)
    assert response.status_code == 200, response.text
    before = await client.get(SETTINGS, headers=editor)
    assert before.status_code == 200
    assert str(hidden.id) not in before.text
    candidate = _config(
        _field("organization", "text"),
        {"key": "classification", "keep_existing": True},
    )
    response = await client.put(f"{SETTINGS}/budget", json=candidate, headers=editor)
    assert response.status_code == 403
    assert str(hidden.id) not in response.text
    after = await client.get(SETTINGS, headers=editor)
    assert str(hidden.id) not in after.text
    field = next(item for item in after.json()["budget"]["fields"] if item["key"] == "organization")
    assert field["kind"] == "card_reference"


async def test_hidden_saved_reference_cannot_be_cleared_or_replaced(client, db, ppm_env):
    await create_role(
        db,
        key="pml_finance_editor",
        permissions={
            "ppm.manage": True,
            "ppm.view": True,
            "inventory.view": True,
            "costs.view": True,
        },
    )
    await create_card_type(
        db,
        key="Organization",
        label="Organization",
        role_permissions={"pml_finance_editor": {"inventory.view": False}},
    )
    hidden = await create_card(db, card_type="Organization", name="Restricted organization")
    editor_user = await create_user(
        db, role="pml_finance_editor", email="finance-scope@example.test"
    )
    admin = auth_headers(ppm_env["admin"])
    editor = auth_headers(editor_user)
    field = _field("organization", "card_reference", card_type="Organization")
    for section in ("budget", "cost_item", "invoice"):
        response = await client.put(f"{SETTINGS}/{section}", json=_config(field), headers=admin)
        assert response.status_code == 200, response.text
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 100,
            "field_values": {"organization": str(hidden.id)},
        },
        headers=admin,
    )
    assert budget.status_code == 200, budget.text
    cost = await client.post(
        f"{base}/costs",
        json={
            "budget_line_id": budget.json()["id"],
            "category": "opex",
            "description": "Cost",
            "field_values": {"organization": str(hidden.id)},
        },
        headers=admin,
    )
    assert cost.status_code == 200, cost.text
    invoice = await client.post(
        f"{base}/invoices",
        json={
            "cost_item_id": cost.json()["id"],
            "invoice_date": "2026-11-24",
            "invoice_id": "TEST-REF",
            "amount": "30",
            "field_values": {"organization": str(hidden.id)},
        },
        headers=admin,
    )
    assert invoice.status_code == 200, invoice.text
    paths = (
        f"/api/v1/ppm/budgets/{budget.json()['id']}",
        f"/api/v1/ppm/costs/{cost.json()['id']}",
        f"/api/v1/ppm/invoices/{invoice.json()['id']}",
    )
    for path in paths:
        for value in (None, str(hidden.id)):
            response = await client.patch(
                path, json={"field_values": {"organization": value}}, headers=editor
            )
            assert response.status_code == 403
            assert str(hidden.id) not in response.text
    # A partial edit omitting the unavailable field keeps the existing reference.
    response = await client.patch(paths[0], json={"amount": 101}, headers=editor)
    assert response.status_code == 200, response.text
    result = await client.get(f"{base}/financials", headers=admin)
    assert result.status_code == 200, result.text
    data = result.json()
    for section, identifier in (
        ("budget_lines", budget.json()["id"]),
        ("cost_items", cost.json()["id"]),
        ("invoices", invoice.json()["id"]),
    ):
        row = next(item for item in data[section] if item["id"] == identifier)
        assert row["field_values"]["organization"] == str(hidden.id)


async def test_pml_schedule_requires_view_permission_before_card_lookup(client, db, ppm_env):
    from uuid import uuid4

    await create_role(db, key="pml_no_view", permissions={"inventory.view": True})
    limited = await create_user(db, role="pml_no_view", email="no-pml-view@example.test")
    headers = auth_headers(limited)
    base = "/api/v1/ppm/initiatives"
    existing = await client.get(f"{base}/{ppm_env['initiative'].id}/schedule", headers=headers)
    missing = await client.get(f"{base}/{uuid4()}/schedule", headers=headers)
    assert existing.status_code == 403
    assert missing.status_code == 403
    assert existing.json() == missing.json()


async def test_report_history_masks_cost_health_without_cost_visibility(client, db, ppm_env):
    await create_role(
        db,
        key="pml_report_editor",
        permissions={"inventory.view": True, "ppm.view": True, "ppm.manage": True},
    )
    editor = await create_user(db, role="pml_report_editor", email="report-editor@example.test")
    admin_headers = auth_headers(ppm_env["admin"])
    headers = auth_headers(editor)
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}/reports"
    created = await client.post(
        base,
        json={"report_date": "2026-11-24", "cost_health": "offTrack"},
        headers=admin_headers,
    )
    assert created.status_code == 200, created.text
    report_id = created.json()["id"]
    listed = await client.get(base, headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["cost_health"] is None
    updated = await client.patch(
        f"/api/v1/ppm/reports/{report_id}",
        json={"summary": "Updated", "cost_health": "onTrack"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["cost_health"] is None
    editor_created = await client.post(
        base,
        json={"report_date": "2026-11-25", "cost_health": "offTrack", "summary": "New report"},
        headers=headers,
    )
    assert editor_created.status_code == 200, editor_created.text
    assert editor_created.json()["cost_health"] is None
    visible = await client.get(base, headers=admin_headers)
    assert visible.status_code == 200
    original = next(row for row in visible.json() if row["id"] == report_id)
    assert original["cost_health"] == "offTrack"
    editor_report = next(row for row in visible.json() if row["id"] == editor_created.json()["id"])
    assert editor_report["cost_health"] == "onTrack"
    assert editor_report["summary"] == "New report"


async def test_provider_constants_preview_and_visibility(client, db, ppm_env):
    await create_role(
        db,
        key="pml_provider_scoped",
        permissions={
            "admin.settings": True,
            "inventory.view": True,
            "ppm.view": True,
            "ppm.manage": True,
        },
    )
    await create_card_type(
        db,
        key="Provider",
        label="Provider",
        role_permissions={"pml_provider_scoped": {"inventory.view": False}},
    )
    await create_card_type(db, key="Organization", label="Organization")
    provider = await create_card(db, card_type="Provider", name="Visible to admin")
    wrong_type = await create_card(db, card_type="Organization", name="Wrong type")
    scoped = await create_user(db, role="pml_provider_scoped", email="provider-scoped@example.test")
    admin_headers = auth_headers(ppm_env["admin"])
    scoped_headers = auth_headers(scoped)
    classification = _field(
        "classification",
        "calculated",
        calculation={
            "result_type": "text",
            "inputs": {"provider": "provider.effective"},
            "provider_constants": {"partner": str(provider.id)},
            "expression": (
                'IF(provider == None, None, IF(provider == partner, "Internal", "Other"))'
            ),
        },
    )
    derived = _field(
        "derived",
        "calculated",
        calculation={
            "result_type": "text",
            "inputs": {"source": "classification"},
            "expression": "source",
        },
    )
    config = _config(classification, derived)
    wrong = _config(
        {
            **classification,
            "calculation": {
                **classification["calculation"],
                "provider_constants": {"partner": str(wrong_type.id)},
            },
        }
    )
    rejected = await client.put(f"{SETTINGS}/cost_item", json=wrong, headers=admin_headers)
    assert rejected.status_code == 422
    denied_save = await client.put(f"{SETTINGS}/cost_item", json=config, headers=scoped_headers)
    assert denied_save.status_code == 422
    saved = await client.put(f"{SETTINGS}/cost_item", json=config, headers=admin_headers)
    assert saved.status_code == 200, saved.text
    preview = await client.post(
        f"{SETTINGS}/cost_item/preview",
        json={
            "configuration": config,
            "field_key": "classification",
            "sample_values": {"provider.effective": str(provider.id)},
        },
        headers=admin_headers,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json() == {"value": "Internal", "errors": {}}

    settings = await client.get(SETTINGS, headers=scoped_headers)
    assert settings.status_code == 200
    assert str(provider.id) not in settings.text
    fields = settings.json()["cost_item"]["fields"]
    assert next(field for field in fields if field["key"] == "classification")["protected"] is True
    denied = await client.post(
        f"{SETTINGS}/cost_item/preview",
        json={"configuration": config, "field_key": "classification", "sample_values": {}},
        headers=scoped_headers,
    )
    assert denied.status_code == 403
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={"fiscal_year": 2026, "category": "opex", "amount": 100},
        headers=admin_headers,
    )
    assert budget.status_code == 200
    cost = await client.post(
        f"{base}/costs",
        json={"budget_line_id": budget.json()["id"], "description": "Cost", "category": "opex"},
        headers=admin_headers,
    )
    assert cost.status_code == 200, cost.text
    listing = await client.get(f"{base}/costs", headers=scoped_headers)
    assert listing.status_code == 200, listing.text
    assert "classification" not in listing.json()[0]["calculated_values"]
    assert "derived" not in listing.json()[0]["calculated_values"]
    assert str(provider.id) not in listing.text

    scoped_cost = await client.post(
        f"{base}/costs",
        json={"budget_line_id": budget.json()["id"], "description": "Scoped", "category": "opex"},
        headers=scoped_headers,
    )
    assert scoped_cost.status_code == 200, scoped_cost.text
    assert "classification" not in scoped_cost.json()["calculated_values"]
    assert "derived" not in scoped_cost.json()["calculated_values"]
    assert str(provider.id) not in scoped_cost.text


async def test_provider_constant_formula_uses_inherited_budget_provider(client, db, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    await create_card_type(db, key="Provider", has_hierarchy=True, built_in=True)
    provider = await create_card(db, card_type="Provider", name="Budget Provider")
    budget_config = _config(_field("origin", "card_reference", card_type="Provider"))
    cost_config = {
        **_config(
            _field(
                "aggregate",
                "calculated",
                calculation={
                    "result_type": "text",
                    "inputs": {"provider": "provider.effective"},
                    "provider_constants": {"partner": str(provider.id)},
                    "expression": 'IF(provider == partner, "Internal", "Other")',
                },
            )
        ),
        "provider_source": {"budget_field_key": "origin", "allow_child_selection": True},
    }
    for section, config in (("budget", budget_config), ("cost_item", cost_config)):
        result = await client.put(f"{SETTINGS}/{section}", json=config, headers=headers)
        assert result.status_code == 200, result.text
    base = f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}"
    budget = await client.post(
        f"{base}/budgets",
        json={
            "fiscal_year": 2026,
            "category": "opex",
            "amount": 100,
            "field_values": {"origin": str(provider.id)},
        },
        headers=headers,
    )
    assert budget.status_code == 200, budget.text
    cost = await client.post(
        f"{base}/costs",
        json={"budget_line_id": budget.json()["id"], "description": "Cost", "category": "opex"},
        headers=headers,
    )
    assert cost.status_code == 200, cost.text
    assert cost.json()["calculated_values"]["aggregate"] == "Internal"
    listing = await client.get(f"{base}/financials", headers=headers)
    assert listing.status_code == 200, listing.text
    assert listing.json()["cost_items"][0]["calculated_values"]["aggregate"] == "Internal"


async def test_core_formula_preview_accepts_direct_select_and_provider(client, db, ppm_env):
    headers = auth_headers(ppm_env["admin"])
    await create_card_type(db, key="Provider", has_hierarchy=True, built_in=True)
    provider = await create_card(db, card_type="Provider", name="Internal provider")
    config = _config(
        _field("otherServiceType", "select", options=[{"id": "licencing", "label": "Licenze"}]),
        _field(
            "aggregate",
            "calculated",
            calculation={
                "result_type": "text",
                "formula_engine": "core",
                "inputs": {},
                "provider_constants": {"internal": str(provider.id)},
                "expression": 'IF(data.providerEffective == internal, "Servizi interni", '
                'IF(data.otherServiceType == "licencing", "Licenze", "Altro"))',
            },
        ),
    )
    saved = await client.put(f"{SETTINGS}/cost_item", json=config, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["fields"][1]["calculation"]["formula_engine"] == "core"
    for current_provider, expected in ((str(provider.id), "Servizi interni"), (None, "Licenze")):
        response = await client.post(
            f"{SETTINGS}/cost_item/preview",
            json={
                "configuration": config,
                "field_key": "aggregate",
                "sample_values": {
                    "provider.effective": current_provider,
                    "otherServiceType": "licencing",
                },
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"value": expected, "errors": {}}
