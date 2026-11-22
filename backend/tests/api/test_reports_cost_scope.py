"""Cost report scope browsing respects module access and complete hierarchies."""

import pytest

from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


@pytest.fixture
async def scope_env(db):
    await create_role(db, key="cost_reader", permissions={"costs.view": True})
    await create_role(db, key="no_cost", permissions={"inventory.view": True})
    reader = await create_user(db, role="cost_reader")
    denied = await create_user(db, role="no_cost")
    await create_card_type(db, key="Application")
    await create_card_type(db, key="ITComponent")
    await create_card_type(db, key="Provider")
    return reader, denied


async def _scope(client, user, **params):
    return await client.get(
        "/api/v1/reports/cost-scope",
        params={"type": "Application,ITComponent", **params},
        headers=auth_headers(user),
    )


async def test_cost_scope_reader_without_inventory(client, db, scope_env):
    reader, _ = scope_env
    app = await create_card(db, name="Application", alias="App alias")
    component = await create_card(db, card_type="ITComponent", name="Component")
    await create_card(db, card_type="Provider", name="Provider")
    await create_card(db, name="Archived", status="ARCHIVED")

    response = await _scope(client, reader)
    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": str(app.id),
                "name": "Application",
                "type": "Application",
                "parent_id": None,
                "alias": "App alias",
            },
            {
                "id": str(component.id),
                "name": "Component",
                "type": "ITComponent",
                "parent_id": None,
                "alias": None,
            },
        ],
        "total": 2,
    }


async def test_cost_scope_pages_include_zero_cost_ancestors(client, db, scope_env):
    reader, _ = scope_env
    parent = await create_card(db, name="Alpha parent")
    child = await create_card(db, name="Beta child", parent_id=parent.id)
    await create_card(db, name="Gamma child", parent_id=parent.id)

    first = await _scope(client, reader, page=1, page_size=1)
    second = await _scope(client, reader, page=2, page_size=1)
    assert first.status_code == second.status_code == 200
    assert first.json()["total"] == second.json()["total"] == 3
    assert first.json()["items"][0]["id"] == str(parent.id)
    assert second.json()["items"][0]["id"] == str(child.id)
    assert second.json()["items"][0]["parent_id"] == str(parent.id)
    searched = await _scope(client, reader, search="Beta")
    assert searched.status_code == 200
    assert searched.json()["items"][0]["parent_id"] == str(parent.id)


async def test_cost_scope_hides_denied_types_subtypes_and_parent_ids(client, db, scope_env):
    reader, _ = scope_env
    from sqlalchemy import select

    from app.models.card_type import CardType

    app_type = (
        await db.execute(select(CardType).where(CardType.key == "Application"))
    ).scalar_one()
    app_type.role_permissions = {
        "cost_reader": {"inventory.view": {"value": False, "subtypes": ["secret"]}}
    }
    component_type = (
        await db.execute(select(CardType).where(CardType.key == "ITComponent"))
    ).scalar_one()
    component_type.role_permissions = {"cost_reader": {"inventory.view": False}}
    hidden = await create_card(db, name="Hidden", subtype="secret")
    child = await create_card(db, name="Visible", parent_id=hidden.id)
    await create_card(db, card_type="ITComponent", name="Denied component")
    await db.flush()

    response = await _scope(client, reader)
    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": str(child.id),
                "name": "Visible",
                "type": "Application",
                "parent_id": None,
                "alias": None,
            }
        ],
        "total": 1,
    }


async def test_cost_scope_rejects_unsupported_type(client, scope_env):
    response = await _scope(client, scope_env[0], type="Application,Provider")
    assert response.status_code == 422


async def test_cost_scope_requires_cost_view(client, scope_env):
    response = await _scope(client, scope_env[1])
    assert response.status_code == 403
