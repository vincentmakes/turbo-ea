from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.event import Event
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


@pytest.fixture
async def stages_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="stages-admin@test.com", role="admin")
    viewer = await create_user(db, email="stages-viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application")
    return admin, viewer


STAGES = [{"key": "testing", "label": "Testing", "color": "#4578bb"}]


async def test_admin_configures_stages_and_viewer_cannot_change_them(client, stages_env):
    admin, viewer = stages_env
    url = "/api/v1/metamodel/types/Application/lifecycle-stages"
    denied = await client.put(url, json={"stages": STAGES}, headers=auth_headers(viewer))
    assert denied.status_code == 403
    invalid = await client.put(url, json={"stages": STAGES + STAGES}, headers=auth_headers(admin))
    assert invalid.status_code == 422
    blank = await client.put(
        url,
        json={"stages": [{"key": "blank", "label": "   ", "color": "#4578bb"}]},
        headers=auth_headers(admin),
    )
    assert blank.status_code == 422
    saved = await client.put(url, json={"stages": STAGES}, headers=auth_headers(admin))
    assert saved.status_code == 200
    loaded = await client.get("/api/v1/metamodel/types/Application", headers=auth_headers(viewer))
    assert loaded.json()["lifecycle_stages"] == STAGES


async def test_card_stage_filter_and_clear_preserve_dates_and_attributes(client, db, stages_env):
    admin, viewer = stages_env
    headers = auth_headers(admin)
    url = "/api/v1/metamodel/types/Application/lifecycle-stages"
    assert (await client.put(url, json={"stages": STAGES}, headers=headers)).status_code == 200
    original_lifecycle = {"active": "2025-03-01", "endOfLife": "2030-12-31"}
    original_attributes = {"other": "unchanged", "costTotalAnnual": 120000}
    card = await create_card(
        db,
        card_type="Application",
        name="Document System",
        user_id=admin.id,
        lifecycle=original_lifecycle,
        attributes=original_attributes,
    )
    other = await create_card(db, card_type="Application", name="Other App", user_id=admin.id)
    bad = await client.patch(
        f"/api/v1/cards/{card.id}", json={"lifecycle_stage": "unknown"}, headers=headers
    )
    assert bad.status_code in (400, 422)
    denied = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"lifecycle_stage": "testing"},
        headers=auth_headers(viewer),
    )
    assert denied.status_code == 403
    changed = await client.patch(
        f"/api/v1/cards/{card.id}", json={"lifecycle_stage": "testing"}, headers=headers
    )
    assert changed.status_code == 200
    assert changed.json()["lifecycle_stage"] == "testing"
    assert changed.json()["lifecycle"] == original_lifecycle
    assert changed.json()["attributes"] == original_attributes
    event = await db.scalar(
        select(Event).where(Event.card_id == card.id, Event.event_type == "card.updated")
    )
    assert event.data["changes"]["lifecycle_stage"] == {"old": None, "new": "testing"}
    query = {"type": "Application", "where": {"lifecycle_stage": ["testing"]}}
    found = await client.get("/api/v1/cards", params={"query": json.dumps(query)}, headers=headers)
    assert found.status_code == 200
    assert [entry["id"] for entry in found.json()["items"]] == [str(card.id)]
    assert str(other.id) not in [entry["id"] for entry in found.json()["items"]]
    direct = await client.get(
        "/api/v1/cards",
        params={"type": "Application", "lifecycle_stage": "testing"},
        headers=headers,
    )
    assert direct.status_code == 200
    assert [entry["id"] for entry in direct.json()["items"]] == [str(card.id)]
    missing = await client.get(
        "/api/v1/cards",
        params={"type": "Application", "lifecycle_stage": "__empty__"},
        headers=headers,
    )
    assert [entry["id"] for entry in missing.json()["items"]] == [str(other.id)]
    blocked = await client.put(url, json={"stages": []}, headers=headers)
    assert blocked.status_code == 409
    cleared = await client.patch(
        f"/api/v1/cards/{card.id}", json={"lifecycle_stage": None}, headers=headers
    )
    assert cleared.json()["lifecycle_stage"] is None
    assert (await client.put(url, json={"stages": []}, headers=headers)).status_code == 200


async def test_stage_edit_breaks_approval_and_keeps_dates(client, db, stages_env):
    admin, _ = stages_env
    headers = auth_headers(admin)
    await client.put(
        "/api/v1/metamodel/types/Application/lifecycle-stages",
        json={"stages": STAGES},
        headers=headers,
    )
    card = await create_card(
        db,
        card_type="Application",
        name="Approved",
        user_id=admin.id,
        lifecycle={"active": "2025-03-01"},
        attributes={"costTotalAnnual": 123},
    )
    card.approval_status = "APPROVED"
    await db.flush()
    response = await client.patch(
        f"/api/v1/cards/{card.id}", json={"lifecycle_stage": "testing"}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["approval_status"] == "BROKEN"
    assert response.json()["lifecycle"] == {"active": "2025-03-01"}
    assert response.json()["attributes"] == {"costTotalAnnual": 123}


async def test_stage_color_change_is_visible_in_audit(client, db, stages_env):
    from app.models.audit_log import AuditLogEntry

    admin, _ = stages_env
    headers = auth_headers(admin)
    url = "/api/v1/metamodel/types/Application/lifecycle-stages"
    await client.put(url, json={"stages": STAGES}, headers=headers)
    changed = [{"key": "testing", "label": "Testing", "color": "#abcdef"}]
    response = await client.put(url, json={"stages": changed}, headers=headers)
    assert response.status_code == 200
    rows = (
        await db.scalars(
            select(AuditLogEntry).where(AuditLogEntry.action == "admin.metamodel.type.updated")
        )
    ).all()
    assert any(
        {
            "kind": "lifecycle_stage.changed",
            "label": "Testing",
            "property": "color",
            "old": "#4578bb",
            "new": "#abcdef",
        }
        in (row.details or {}).get("items", [])
        for row in rows
    )


def test_stage_update_openapi_has_typed_response(app):
    schema = app.openapi()
    response = schema["paths"]["/api/v1/metamodel/types/{key}/lifecycle-stages"]["put"][
        "responses"
    ]["200"]["content"]["application/json"]["schema"]
    assert "$ref" in response


async def test_stage_reorder_logs_positions_even_for_duplicate_labels(client, db, stages_env):
    from app.models.audit_log import AuditLogEntry

    admin, _ = stages_env
    url = "/api/v1/metamodel/types/Application/lifecycle-stages"
    headers = auth_headers(admin)
    stages = [
        {"key": "one", "label": "Same", "color": "#111111"},
        {"key": "two", "label": "Same", "color": "#222222"},
    ]
    assert (await client.put(url, json={"stages": stages}, headers=headers)).status_code == 200
    assert (
        await client.put(url, json={"stages": stages[::-1]}, headers=headers)
    ).status_code == 200
    rows = (
        await db.scalars(
            select(AuditLogEntry).where(AuditLogEntry.action == "admin.metamodel.type.updated")
        )
    ).all()
    items = [item for row in rows for item in (row.details or {}).get("items", [])]
    assert {
        "kind": "lifecycle_stage.changed",
        "label": "Same",
        "property": "position",
        "old": 1,
        "new": 2,
    } in items
    assert {
        "kind": "lifecycle_stage.changed",
        "label": "Same",
        "property": "position",
        "old": 2,
        "new": 1,
    } in items


async def test_rollback_api_rejects_removed_stage_before_restoring_any_fields(
    client, db, stages_env
):
    from app.models.mutation_batch import MutationBatch

    admin, _ = stages_env
    card = await create_card(db, card_type="Application", name="Current", user_id=admin.id)
    batch = MutationBatch(tool_name="ext:test", actor_user_id=admin.id, dry_run=False)
    db.add(batch)
    await db.flush()
    db.add(
        Event(
            batch_id=batch.id,
            user_id=admin.id,
            card_id=card.id,
            event_type="card.updated",
            data={
                "id": str(card.id),
                "changes": {
                    "name": {"old": "Before", "new": "Current"},
                    "lifecycle_stage": {"old": "removed", "new": None},
                },
            },
        )
    )
    await db.flush()
    response = await client.post(
        f"/api/v1/mutation-batches/{batch.id}/rollback",
        json={"force": True, "dry_run": False},
        headers=auth_headers(admin),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "rollback_conflict"
    assert card.name == "Current"
    assert card.lifecycle_stage is None


async def test_stage_edit_refreshes_approval_before_breaking_it(client, db, stages_env):
    from sqlalchemy import update

    from app.models.card import Card

    admin, _ = stages_env
    headers = auth_headers(admin)
    await client.put(
        "/api/v1/metamodel/types/Application/lifecycle-stages",
        json={"stages": STAGES},
        headers=headers,
    )
    card = await create_card(db, card_type="Application", name="Concurrent", user_id=admin.id)
    await db.execute(
        update(Card)
        .where(Card.id == card.id)
        .values(approval_status="APPROVED")
        .execution_options(synchronize_session=False)
    )
    response = await client.patch(
        f"/api/v1/cards/{card.id}", json={"lifecycle_stage": "testing"}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["approval_status"] == "BROKEN"


async def test_approval_delivers_notification_after_commit(client, db, stages_env, monkeypatch):
    from unittest.mock import AsyncMock

    from app.models.card import Card
    from app.models.stakeholder import Stakeholder
    from app.services import notification_service

    admin, viewer = stages_env
    card = await create_card(db, card_type="Application", name="Approval", user_id=admin.id)
    db.add(Stakeholder(card_id=card.id, user_id=viewer.id, role="responsible"))
    await db.flush()
    transaction_open_at_delivery = []

    async def record_delivery(*args, **kwargs):
        transaction_open_at_delivery.append(db.in_transaction())

    deliver = AsyncMock(side_effect=record_delivery)
    monkeypatch.setattr(notification_service, "deliver_notification_batch", deliver)

    response = await client.post(
        f"/api/v1/cards/{card.id}/approval-status?action=approve", headers=auth_headers(admin)
    )

    assert response.status_code == 200
    assert await db.scalar(select(Card.approval_status).where(Card.id == card.id)) == "APPROVED"
    assert transaction_open_at_delivery == [False]
    recipients = deliver.await_args.args[0]
    assert recipients[0]["user_id"] == viewer.id
    assert recipients[0]["card_id"] == card.id
    assert recipients[0]["link"] == f"/cards/{card.id}"
    assert deliver.await_args.kwargs == {
        "notif_type": "approval_status_changed",
        "actor_id": admin.id,
        "require_card_read": True,
    }
