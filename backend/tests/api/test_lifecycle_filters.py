import json
import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.bookmark import Bookmark
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.schemas.card import CardBulkUpdate
from app.services import notification_service
from app.services.permission_service import PermissionService
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="filter-admin@test.com", role="admin")
    stages = [f"s{i:02d}" + "x" * 47 for i in range(50)]
    card_type = await create_card_type(db, key="Application", label="Application")
    card_type.lifecycle_stages = [{"key": s, "label": s, "color": "#4578bb"} for s in stages]
    await db.flush()
    return admin, stages


async def test_saved_flat_stage_filter_applies_before_count_and_pagination(client, db, env):
    admin, stages = env
    headers = auth_headers(admin)
    excluded = await create_card(db, name="A excluded")
    included = await create_card(db, name="B selected")
    excluded.lifecycle_stage = stages[1]
    included.lifecycle_stage = stages[0]
    empty = await create_card(db, name="C empty")
    await db.flush()
    created = await client.post(
        "/api/v1/bookmarks",
        headers=headers,
        json={
            "name": "Stages",
            "card_type": "Application",
            "odata_enabled": True,
            "filters": {"types": ["Application"], "lifecycleStages": [stages[0], "__empty__"]},
        },
    )
    assert created.status_code == 201
    url = f"/api/v1/bookmarks/{created.json()['id']}/odata"
    first = await client.get(url, params={"page_size": 1}, headers=headers)
    second = await client.get(url, params={"page_size": 1, "page": 2}, headers=headers)
    assert first.json()["@odata.count"] == second.json()["@odata.count"] == 2
    assert [first.json()["value"][0]["id"], second.json()["value"][0]["id"]] == [
        str(included.id),
        str(empty.id),
    ]


@pytest.mark.parametrize("types", [[], ["Application", "Other"]])
async def test_saved_stage_filter_is_ignored_without_one_type(client, db, env, types):
    admin, stages = env
    await create_card_type(db, key="Other", label="Other")
    card = await create_card(db, name="Empty")
    created = await client.post(
        "/api/v1/bookmarks",
        headers=auth_headers(admin),
        json={
            "name": "Stages",
            "odata_enabled": True,
            "filters": {"types": types, "lifecycleStages": [stages[0]]},
        },
    )
    assert created.status_code == 201, created.text
    response = await client.get(
        f"/api/v1/bookmarks/{created.json()['id']}/odata", headers=auth_headers(admin)
    )
    assert response.status_code == 200, response.text
    assert response.json()["@odata.count"] == 1
    assert response.json()["value"][0]["id"] == str(card.id)


@pytest.mark.parametrize("bad", ["stage", 1, ["stage", 1], {"key": "stage"}])
async def test_bad_stage_facet_is_rejected_on_write(client, env, bad):
    admin, _ = env
    headers = auth_headers(admin)
    filters = {"types": ["Application"], "lifecycleStages": bad}
    rejected = await client.post(
        "/api/v1/bookmarks",
        headers=headers,
        json={"name": "Bad", "odata_enabled": True, "filters": filters},
    )
    assert rejected.status_code == 422
    created = await client.post(
        "/api/v1/bookmarks", headers=headers, json={"name": "Legacy", "odata_enabled": True}
    )
    assert created.status_code == 201
    rejected_update = await client.patch(
        f"/api/v1/bookmarks/{created.json()['id']}", headers=headers, json={"filters": filters}
    )
    assert rejected_update.status_code == 422


@pytest.mark.parametrize("bad", ["stage", 1, ["stage", 1], {"key": "stage"}])
async def test_bad_stage_facet_is_ignored_for_legacy_feed(client, db, env, bad):
    admin, _ = env
    headers = auth_headers(admin)
    card = await create_card(db, name="Empty")
    created = await client.post(
        "/api/v1/bookmarks", headers=headers, json={"name": "Legacy", "odata_enabled": True}
    )
    assert created.status_code == 201
    bookmark = await db.get(Bookmark, uuid.UUID(created.json()["id"]))
    bookmark.filters = {"types": ["Application"], "lifecycleStages": bad}
    await db.flush()
    response = await client.get(f"/api/v1/bookmarks/{bookmark.id}/odata", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["@odata.count"] == 1
    assert response.json()["value"][0]["id"] == str(card.id)


async def test_saved_stage_facet_bounds_on_write_and_legacy_read(client, db, env):
    admin, stages = env
    headers = auth_headers(admin)
    empty = await create_card(db, name="Empty")
    valid = {"types": ["Application"], "lifecycleStages": stages + ["__empty__"]}
    created = await client.post(
        "/api/v1/bookmarks",
        headers=headers,
        json={"name": "Boundaries", "odata_enabled": True, "filters": valid},
    )
    assert created.status_code == 201, created.text
    bookmark = await db.get(Bookmark, uuid.UUID(created.json()["id"]))
    url = f"/api/v1/bookmarks/{bookmark.id}"
    for bad in (
        stages + ["extra"],
        stages + ["__empty__", "__empty__"],
        ["x" * 51],
        ["ready,live"],
        ["ready live"],
    ):
        filters = {"types": ["Application"], "lifecycleStages": bad}
        rejected = await client.post(
            "/api/v1/bookmarks", headers=headers, json={"name": "Bad", "filters": filters}
        )
        assert rejected.status_code == 422
        rejected = await client.patch(url, headers=headers, json={"filters": filters})
        assert rejected.status_code == 422
        bookmark.filters = filters
        await db.flush()
        response = await client.get(f"{url}/odata", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["@odata.count"] == 1
        assert response.json()["value"][0]["id"] == str(empty.id)


async def test_direct_stage_filter_rejects_invalid_key_and_accepts_unknown_key(client, env):
    admin, _ = env
    headers = auth_headers(admin)
    bad = await client.get(
        "/api/v1/cards", headers=headers, params={"lifecycle_stage": "ready live"}
    )
    assert bad.status_code == 400
    good = await client.get(
        "/api/v1/cards", headers=headers, params={"lifecycle_stage": "Unknown_123,__empty__"}
    )
    assert good.status_code == 200


async def test_stage_filters_respect_inventory_scope_and_counts(client, db, env):
    admin, stages = env
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    reader = await create_user(db, email="scoped@test.com", role="member")
    card_type = await db.scalar(select(CardType).where(CardType.key == "Application"))
    card_type.subtypes = [
        {"key": "visible", "label": "Visible"},
        {"key": "hidden", "label": "Hidden"},
    ]
    card_type.role_permissions = {
        "member": {"inventory.view": {"value": False, "subtypes": ["hidden"]}}
    }
    PermissionService.invalidate_type_permission_cache()
    visible = await create_card(db, name="Visible", subtype="visible")
    hidden = await create_card(db, name="Hidden", subtype="hidden")
    visible.lifecycle_stage = hidden.lifecycle_stage = stages[0]
    await db.flush()
    headers = auth_headers(reader)
    query = {"type": "Application", "where": {"lifecycle_stage": [stages[0]]}}
    for params in ({"lifecycle_stage": stages[0]}, {"query": json.dumps(query)}):
        response = await client.get("/api/v1/cards", params=params, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        assert [row["id"] for row in response.json()["items"]] == [str(visible.id)]
    for payload in (
        {"filters": {"types": ["Application"], "lifecycleStages": [stages[0]]}},
        {"query": query},
    ):
        created = await client.post(
            "/api/v1/bookmarks",
            headers=auth_headers(admin),
            json={"name": "Scoped", "visibility": "public", "odata_enabled": True, **payload},
        )
        assert created.status_code == 201, created.text
        response = await client.get(
            f"/api/v1/bookmarks/{created.json()['id']}/odata", headers=headers
        )
        assert response.status_code == 200, response.text
        assert response.json()["@odata.count"] == 1
        assert [row["id"] for row in response.json()["value"]] == [str(visible.id)]


async def test_direct_and_structured_filters_accept_all_stages_and_empty(client, db, env):
    admin, stages = env
    card = await create_card(db, name="Selected")
    card.lifecycle_stage = stages[-1]
    empty = await create_card(db, name="Empty")
    await db.flush()
    values = stages + ["__empty__"]
    headers = auth_headers(admin)
    direct = await client.get(
        "/api/v1/cards", headers=headers, params={"lifecycle_stage": ",".join(values)}
    )
    structured = await client.get(
        "/api/v1/cards",
        headers=headers,
        params={"query": json.dumps({"type": "Application", "where": {"lifecycle_stage": values}})},
    )
    for response in (direct, structured):
        assert response.status_code == 200
        assert {item["id"] for item in response.json()["items"]} == {str(card.id), str(empty.id)}
    for values in (stages + ["extra"], stages + ["__empty__", "__empty__"]):
        response = await client.get(
            "/api/v1/cards", headers=headers, params={"lifecycle_stage": ",".join(values)}
        )
        assert response.status_code in (400, 422)


async def test_bulk_stage_is_not_advertised_and_is_rejected(client, db, env):
    admin, stages = env
    card = await create_card(db, name="Bulk")
    schema = CardBulkUpdate.model_json_schema()
    updates_schema = schema["$defs"][schema["properties"]["updates"]["$ref"].split("/")[-1]]
    assert "lifecycle_stage" not in updates_schema["properties"]
    response = await client.patch(
        "/api/v1/cards/bulk",
        headers=auth_headers(admin),
        json={"ids": [str(card.id)], "updates": {"lifecycle_stage": stages[0]}},
    )
    assert response.status_code == 400
    ok = await client.patch(
        "/api/v1/cards/bulk",
        headers=auth_headers(admin),
        json={"ids": [str(card.id)], "updates": {"description": "changed"}},
    )
    assert ok.status_code == 200


async def test_stage_notification_is_delivered_after_commit(client, db, env, monkeypatch):
    admin, stages = env
    subscriber = await create_user(db, email="subscriber@test.com", role="admin")
    card = await create_card(db, name="Watched")
    db.add(Stakeholder(card_id=card.id, user_id=subscriber.id, role="responsible"))
    await db.flush()
    committed = False
    original_commit = db.commit
    delivered = []

    async def commit():
        nonlocal committed
        await original_commit()
        committed = True

    async def immediate(*args, **kwargs):
        pytest.fail("stage notification was delivered before commit")

    async def deliver(recipients, *, notif_type, actor_id, require_card_read):
        assert committed
        assert require_card_read
        delivered.append((recipients, notif_type, actor_id))

    monkeypatch.setattr(db, "commit", commit)
    monkeypatch.setattr(notification_service, "create_notifications_for_subscribers", immediate)
    monkeypatch.setattr(notification_service, "deliver_notification_batch", deliver)
    response = await client.patch(
        f"/api/v1/cards/{card.id}",
        headers=auth_headers(admin),
        json={"lifecycle_stage": stages[0]},
    )
    assert response.status_code == 200, response.text
    assert len(delivered) == 1
    recipients, notif_type, actor_id = delivered[0]
    assert notif_type == "card_updated" and actor_id == admin.id
    assert [row["user_id"] for row in recipients] == [subscriber.id]
