import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO

import pytest
from openpyxl import Workbook
from sqlalchemy import select, update

from app.models.card_cost import CardCost
from app.models.card_type import CardType
from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.services import cost_item_types
from app.services.event_bus import event_bus
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

IMPORT = "/api/v1/costs/import"
CUR = current_fiscal_year(1)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="no_cost", permissions={})
    admin = await create_user(db, email="import-admin@test.com", role="admin")
    denied = await create_user(db, email="import-denied@test.com", role="no_cost")
    await create_card_type(
        db,
        key="Application",
        fields_schema=[{"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost"}]}],
    )
    await cost_item_types.create_item(db, "lic", "Licences")
    await cost_item_types.create_item(db, "support", "Support")
    card = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    return {"admin": admin, "denied": denied, "card": card}


def workbook(rows):
    book = Workbook()
    sheet = book.active
    sheet.append(["Card ID", "Fiscal Year", "Cost Item", "Amount", "Renewal Date"])
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    book.save(output)
    return output.getvalue()


async def upload(client, user, rows, dry_run=True):
    return await client.post(
        IMPORT,
        params={"dry_run": str(dry_run).lower()},
        headers=auth_headers(user),
        files={
            "file": (
                "costs.xlsx",
                workbook(rows),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


async def test_import_requires_authentication_and_cost_permission(client, env):
    assert (await client.post(IMPORT)).status_code == 401
    response = await upload(client, env["denied"], [])
    assert response.status_code == 403


async def test_import_rechecks_the_current_user_role_after_parsing(client, db, env, monkeypatch):
    from app.api.v1 import card_costs as routes

    admin, card = env["admin"], env["card"]
    admin_id = admin.id

    async def parse_then_change_role(parse, data):
        rows = parse(data)
        await db.execute(
            update(User)
            .where(User.id == admin_id)
            .values(role="no_cost")
            .execution_options(synchronize_session=False)
        )
        return rows

    monkeypatch.setattr(routes, "run_in_threadpool", parse_then_change_role)
    response = await upload(client, admin, [[str(card.id), CUR, "lic", 10]], dry_run=False)
    assert response.status_code == 403


@pytest.mark.parametrize("filename", ["costs.csv", "costs.xlsx"])
async def test_import_rejects_unsupported_and_malformed_uploads(client, env, filename):
    response = await client.post(
        IMPORT,
        headers=auth_headers(env["admin"]),
        files={"file": (filename, b"not a workbook")},
    )
    assert response.status_code == 400


async def test_import_uses_the_shared_upload_limit(client, env, monkeypatch):
    from app.services import attachment_upload

    monkeypatch.setattr(attachment_upload, "MAX_ATTACHMENT_BYTES", 16)
    response = await upload(client, env["admin"], [])
    assert response.status_code == 400
    assert "exceeds maximum size" in response.json()["detail"]


async def test_preview_is_immutable_and_apply_changes_only_named_item(client, db, env):
    card, admin = env["card"], env["admin"]
    headers = auth_headers(admin)
    for key, amount in (("lic", 10), ("support", 20)):
        response = await client.put(
            f"/api/v1/cards/{card.id}/costs/{CUR}/items/{key}",
            json={"amount": amount, "renewal_date": "2030-01-01"},
            headers=headers,
        )
        assert response.status_code == 200
    before_rows = (
        (await db.execute(select(CardCost).where(CardCost.card_id == card.id))).scalars().all()
    )
    before_items = {row.fiscal_year: deepcopy(row.items) for row in before_rows}
    before_events = (
        (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
    )
    await db.refresh(card)
    before_total = card.attributes["costTotalAnnual"]
    rows = [[str(card.id), CUR, "lic", 75, None]]

    preview = await upload(client, admin, rows)
    assert preview.status_code == 200
    assert preview.json() == {"matched": 1, "applied": 0, "clears_renewal_count": 1, "skipped": []}
    assert len(
        (await db.execute(select(CardCost).where(CardCost.card_id == card.id))).scalars().all()
    ) == len(before_rows)
    await db.refresh(before_rows[0])
    assert {row.fiscal_year: row.items for row in before_rows} == before_items
    assert len(
        (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
    ) == len(before_events)
    await db.refresh(card)
    assert card.attributes["costTotalAnnual"] == before_total

    applied = await upload(client, admin, rows, dry_run=False)
    assert applied.status_code == 200
    assert applied.json()["applied"] == 1
    result = await client.get(f"/api/v1/cards/{card.id}/costs/{CUR}", headers=headers)
    items = {item["key"]: item for item in result.json()["items"]}
    assert items["lic"]["amount"] == 75
    assert items["lic"]["renewal_date"] is None
    assert items["support"]["amount"] == 20
    assert items["support"]["renewal_date"] == "2030-01-01"


async def test_duplicates_rejected_before_amount_validation(client, env):
    card = env["card"]
    response = await upload(
        client, env["admin"], [[str(card.id), CUR, "lic", "bad"], [str(card.id), CUR, "lic", 10]]
    )
    assert response.status_code == 200
    assert response.json()["matched"] == 0
    assert response.json()["skipped"] == [
        {"row": 2, "reason": "duplicate_item"},
        {"row": 3, "reason": "duplicate_item"},
    ]


@pytest.mark.parametrize("reverse", [False, True])
async def test_history_inherits_projected_items_and_replay_is_idempotent(client, db, env, reverse):
    card, admin = env["card"], env["admin"]
    headers = auth_headers(admin)
    response = await client.put(
        f"/api/v1/cards/{card.id}/costs/{CUR - 1}/items/support",
        json={"amount": 20},
        headers=headers,
    )
    assert response.status_code == 200
    rows = [[str(card.id), CUR - 1, "lic", 40], [str(card.id), CUR, "lic", 70]]
    if reverse:
        rows.reverse()
    preview = await upload(client, admin, rows)
    assert preview.status_code == 200 and preview.json()["matched"] == 2
    for _ in range(2):
        result = await upload(client, admin, rows, dry_run=False)
        assert result.status_code == 200 and result.json()["applied"] == 2
    result = await client.get(f"/api/v1/cards/{card.id}/costs/{CUR}", headers=headers)
    assert {item["key"]: item["amount"] for item in result.json()["items"]} == {
        "lic": 70,
        "support": 20,
    }
    await db.refresh(card)
    assert card.attributes["costTotalAnnual"] == 90


async def test_import_preserves_card_archive_and_only_active_cost_reaches_report(client, db, env):
    active, admin = env["card"], env["admin"]
    archived = await create_card(db, name="Retired ERP", user_id=admin.id, status="ARCHIVED")
    archived.archived_at = datetime.now(UTC)
    await db.flush()
    response = await upload(
        client,
        admin,
        [[str(active.id), CUR, "lic", 10], [str(archived.id), CUR, "lic", 20]],
        dry_run=False,
    )
    assert response.status_code == 200 and response.json()["applied"] == 2
    await db.refresh(archived)
    assert archived.status == "ARCHIVED" and archived.archived_at is not None
    report = await client.get(
        "/api/v1/reports/cost-treemap",
        params={"type": "Application", "fiscal_year": CUR},
        headers=auth_headers(admin),
    )
    assert report.status_code == 200
    assert report.json()["total"] == 10
    assert [row["name"] for row in report.json()["items"]] == [active.name]


async def test_late_writer_failure_rolls_back_rows_and_events(client, db, env, monkeypatch):
    from app.services import card_costs

    original = card_costs.upsert_item
    calls = 0

    async def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated write failure")
        return await original(*args, **kwargs)

    monkeypatch.setattr(card_costs, "upsert_item", fail_second)
    card = env["card"]
    card_id = card.id
    queue = asyncio.Queue()
    event_bus._subscribers.append(queue)
    before = len((await db.execute(select(Event).where(Event.card_id == card_id))).scalars().all())
    response = await upload(
        client,
        env["admin"],
        [[str(card_id), CUR - 1, "lic", 10], [str(card_id), CUR, "support", 20]],
        dry_run=False,
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "cost_import_write_failed", "applied": 0}
    assert (
        not (await db.execute(select(CardCost).where(CardCost.card_id == card_id))).scalars().all()
    )
    assert (
        len((await db.execute(select(Event).where(Event.card_id == card_id))).scalars().all())
        == before
    )
    event_bus._subscribers.remove(queue)
    assert queue.empty()


async def test_hidden_card_and_stakeholder_edit_permission(client, db, env):
    await create_role(db, key="editor", permissions={"costs.view": True})
    editor = await create_user(db, email="import-editor@test.com", role="editor")
    card = env["card"]
    rows = [[str(card.id), CUR, "lic", 10]]
    denied = await upload(client, editor, rows)
    assert denied.json()["skipped"] == [{"row": 2, "reason": "edit_forbidden"}]
    await create_stakeholder_role_def(
        db,
        key="cost_owner",
        label="Owner",
        permissions={"card.view": True, "card.edit": True, "card.view_costs": True},
    )
    stakeholder = Stakeholder(card_id=card.id, user_id=editor.id, role="cost_owner")
    db.add(stakeholder)
    await db.flush()
    allowed = await upload(client, editor, rows, dry_run=False)
    assert allowed.status_code == 200 and allowed.json()["applied"] == 1
    await db.delete(stakeholder)
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"editor": {"inventory.view": False}})
    )
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    assert (
        await client.get(f"/api/v1/cards/{card.id}/costs", headers=auth_headers(editor))
    ).status_code == 404
    hidden = await upload(client, editor, rows)
    assert hidden.json()["skipped"] == [{"row": 2, "reason": "card_not_found"}]


async def test_archived_item_inheritance_and_revalidation(client, db, env):
    card, admin = env["card"], env["admin"]
    headers = auth_headers(admin)
    response = await client.put(
        f"/api/v1/cards/{card.id}/costs/{CUR - 1}/items/lic",
        json={"amount": 10, "renewal_date": "2030-01-01"},
        headers=headers,
    )
    assert response.status_code == 200
    await cost_item_types.update_item(db, "lic", archived=True)
    rows = [[str(card.id), CUR, "lic", 12]]
    preview = await upload(client, admin, rows)
    assert preview.json()["matched"] == 1
    assert preview.json()["clears_renewal_count"] == 1
    assert (await upload(client, admin, rows, dry_run=False)).json()["applied"] == 1
    absent = await upload(client, admin, [[str(card.id), CUR + 1, "lic", 12]])
    assert absent.json()["skipped"] == [{"row": 2, "reason": "archived_cost_item"}]
    changed = [[str(card.id), CUR, "support", 10]]
    assert (await upload(client, admin, changed)).json()["matched"] == 1
    await cost_item_types.update_item(db, "support", archived=True)
    result = await upload(client, admin, changed, dry_run=False)
    assert result.json()["applied"] == 0
    assert result.json()["skipped"] == [{"row": 2, "reason": "archived_cost_item"}]


async def test_invalid_values_and_zero_amount(client, env):
    card = str(env["card"].id)
    rows = [
        [card, CUR, "lic", 0, None],
        [card, CUR, "support", -1, None],
        [card, CUR - 1, "lic", 1, 0],
        [card, CUR - 2, "lic", 1, "2201-01-01"],
        [card, CUR - 3, "lic", 1, "1899-12-31"],
    ]
    result = await upload(client, env["admin"], rows)
    assert result.status_code == 200
    assert result.json()["matched"] == 1
    assert result.json()["skipped"] == [
        {"row": 3, "reason": "invalid_amount"},
        {"row": 4, "reason": "invalid_renewal_date"},
        {"row": 5, "reason": "invalid_renewal_date"},
        {"row": 6, "reason": "invalid_renewal_date"},
    ]


async def test_committed_import_fans_out_and_formula_skips_only_its_row(client, env):
    queue = asyncio.Queue()
    event_bus._subscribers.append(queue)
    try:
        card = str(env["card"].id)
        response = await upload(
            client,
            env["admin"],
            [
                [card, CUR, "lic", 10, '=IF(1=1,"","")'],
                [card, CUR, "support", 20, None],
            ],
            dry_run=False,
        )
        assert response.status_code == 200
        assert response.json()["applied"] == 1
        assert response.json()["skipped"] == [{"row": 2, "reason": "invalid_renewal_date"}]
        assert queue.get_nowait()["event"] == "card.costs_updated"
        assert queue.empty()
    finally:
        event_bus._subscribers.remove(queue)


async def test_apply_reloads_scope_after_lock(client, env, monkeypatch):
    from app.services.card_read_scope import CardReadScope

    original = CardReadScope.load
    calls = 0

    class HiddenScope:
        def __init__(self, scope):
            self.scope = scope

        def __getattr__(self, name):
            return getattr(self.scope, name)

        def readable(self, *args, **kwargs):
            return False

    async def changed_scope(cls, db, user, **kwargs):
        nonlocal calls
        calls += 1
        scope = await original(db, user, **kwargs)
        return HiddenScope(scope) if calls == 2 else scope

    monkeypatch.setattr(CardReadScope, "load", classmethod(changed_scope))
    response = await upload(
        client, env["admin"], [[str(env["card"].id), CUR, "lic", 10]], dry_run=False
    )
    assert response.status_code == 200
    assert response.json()["applied"] == 0
    assert response.json()["skipped"] == [{"row": 2, "reason": "card_not_found"}]
