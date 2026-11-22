from io import BytesIO

import pytest
from openpyxl import load_workbook

from tests.conftest import auth_headers, create_role, create_user

TEMPLATE = "/api/v1/costs/import/template"
CATALOGUE = "/api/v1/metamodel/cost-item-types"


@pytest.fixture
async def users(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="no_costs", label="No costs", permissions={})
    return {
        "admin": await create_user(db, email="template-admin@test.com", role="admin"),
        "denied": await create_user(db, email="template-denied@test.com", role="no_costs"),
    }


async def test_template_requires_authentication_and_cost_permission(client, users):
    assert (await client.get(TEMPLATE)).status_code == 401
    response = await client.get(TEMPLATE, headers=auth_headers(users["denied"]))
    assert response.status_code == 403


async def test_template_contains_current_active_catalogue_only(client, users):
    headers = auth_headers(users["admin"])
    for key, label in [("first", "=Literal label"), ("second", "Second"), ("old", "Old")]:
        assert (
            await client.post(CATALOGUE, json={"key": key, "label": label}, headers=headers)
        ).status_code == 201
    await client.patch(f"{CATALOGUE}/old", json={"archived": True}, headers=headers)
    await client.patch(f"{CATALOGUE}/second", json={"sort_order": 0}, headers=headers)
    await client.patch(f"{CATALOGUE}/first", json={"sort_order": 1}, headers=headers)

    response = await client.get(TEMPLATE, headers=headers)
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert "cost-import-template.xlsx" in response.headers["content-disposition"]
    assert "no-store" in response.headers["cache-control"]
    workbook = load_workbook(BytesIO(response.content))
    assert workbook.sheetnames == ["Costs", "Cost Items"]
    assert [cell.value for cell in workbook.worksheets[0][1]] == [
        "Card ID",
        "Fiscal Year",
        "Cost Item",
        "Amount",
        "Renewal Date",
    ]
    assert workbook.worksheets[0].max_row == 1
    reference = workbook["Cost Items"]
    values = [[cell.value for cell in row] for row in reference.iter_rows()]
    text = " ".join(str(value) for row in values for value in row if value is not None)
    assert "UUID" in text and "URL" in text
    assert "old" not in text
    assert text.index("second") < text.index("first")
    label_cell = next(
        cell for row in reference.iter_rows() for cell in row if cell.value == "=Literal label"
    )
    assert label_cell.data_type == "s"


async def test_catalogue_edits_are_visible_in_subsequent_downloads(client, users):
    headers = auth_headers(users["admin"])
    await client.post(CATALOGUE, json={"key": "item", "label": "Before"}, headers=headers)
    before = await client.get(TEMPLATE, headers=headers)
    assert before.status_code == 200
    await client.patch(f"{CATALOGUE}/item", json={"label": "After"}, headers=headers)
    after = await client.get(TEMPLATE, headers=headers)
    workbook = load_workbook(BytesIO(after.content))
    values = [cell.value for row in workbook["Cost Items"].iter_rows() for cell in row]
    assert "After" in values and "Before" not in values


async def test_changed_saves_warm_and_noop_does_not(client, users, monkeypatch):
    from app.services import cost_import_template

    calls = []

    async def warm(snapshot):
        calls.append(snapshot)
        return b"workbook"

    monkeypatch.setattr(cost_import_template, "template_bytes", warm)
    headers = auth_headers(users["admin"])
    assert (
        await client.post(CATALOGUE, json={"key": "item", "label": "Item"}, headers=headers)
    ).status_code == 201
    assert len(calls) == 1
    for update in [
        {"label": "Renamed"},
        {"translations": {"it": "Voce"}},
        {"archived": True},
        {"archived": False},
        {"sort_order": 3},
    ]:
        assert (
            await client.patch(f"{CATALOGUE}/item", json=update, headers=headers)
        ).status_code == 200
    assert len(calls) == 6
    assert (
        await client.patch(f"{CATALOGUE}/item", json={"sort_order": 3}, headers=headers)
    ).status_code == 200
    assert len(calls) == 6
    assert (await client.get(CATALOGUE, headers=headers)).status_code == 200
    assert len(calls) == 6


async def test_warm_failure_does_not_fail_catalogue_save(client, users, monkeypatch):
    from app.services import cost_import_template

    async def fail(snapshot):
        raise RuntimeError("workbook unavailable")

    monkeypatch.setattr(cost_import_template, "template_bytes", fail)
    headers = auth_headers(users["admin"])
    response = await client.post(CATALOGUE, json={"key": "item", "label": "Item"}, headers=headers)
    assert response.status_code == 201
    assert (await client.get(CATALOGUE, headers=headers)).json()[0]["label"] == "Item"


async def test_build_failure_returns_503_and_next_download_retries(client, users, db, monkeypatch):
    from app.services import cost_import_template

    await create_role(db, key="costs_only", label="Costs only", permissions={"costs.view": True})
    user = await create_user(db, email="template-costs@test.com", role="costs_only")
    headers = auth_headers(user)
    cost_import_template._cache.clear()
    original = cost_import_template._build
    calls = 0

    def fail_once(snapshot):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient failure")
        return original(snapshot)

    monkeypatch.setattr(cost_import_template, "_build", fail_once)
    response = await client.get(TEMPLATE, headers=headers)
    assert response.status_code == 503
    assert response.json() == {"detail": "Cost import template is unavailable"}
    response = await client.get(TEMPLATE, headers=headers)
    assert response.status_code == 200
    assert load_workbook(BytesIO(response.content)).sheetnames == ["Costs", "Cost Items"]
    assert calls == 2


async def test_illegal_xml_label_is_normalized_only_in_workbook(client, users):
    headers = auth_headers(users["admin"])
    label = "Before\x0bAfter"
    created = await client.post(
        CATALOGUE, json={"key": "xml_label", "label": label}, headers=headers
    )
    assert created.status_code == 201
    response = await client.get(TEMPLATE, headers=headers)
    assert response.status_code == 200
    workbook = load_workbook(BytesIO(response.content))
    values = [cell.value for row in workbook["Cost Items"].iter_rows() for cell in row]
    assert "Before After" in values
    assert (await client.get(CATALOGUE, headers=headers)).json()[0]["label"] == label


async def test_snapshot_uses_persisted_values_and_stable_tie_order(client, users, db):
    from sqlalchemy import update

    from app.models.cost_item_type import CostItemType
    from app.services import cost_import_template, cost_item_types

    headers = auth_headers(users["admin"])
    for key in ("zebra", "alpha"):
        response = await client.post(CATALOGUE, json={"key": key, "label": "Same"}, headers=headers)
        assert response.status_code == 201
    stale = await cost_item_types.get_item(db, "zebra")
    await db.execute(
        update(CostItemType)
        .where(CostItemType.key == "zebra")
        .values(label="Persisted", sort_order=0)
        .execution_options(synchronize_session=False)
    )
    assert stale.label == "Same"
    snapshot = await cost_import_template.catalogue_snapshot(db)
    assert next(item for item in snapshot if item.key == "zebra").label == "Persisted"

    await db.execute(
        update(CostItemType)
        .values(label="Same", sort_order=0)
        .execution_options(synchronize_session=False)
    )
    snapshot = await cost_import_template.catalogue_snapshot(db)
    assert [item.key for item in snapshot] == ["alpha", "zebra"]
