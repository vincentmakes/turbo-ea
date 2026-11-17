import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.services import license_types
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_license_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

CUR = current_fiscal_year(1)
FORECAST = CUR + 1


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="member",
        label="Member",
        permissions={"inventory.view": True, "inventory.edit": True, "licenses.view": True},
    )
    users = {
        "admin": await create_user(db, email="a@lic-api.com", role="admin"),
        "viewer": await create_user(db, email="v@lic-api.com", role="viewer"),
        "member": await create_user(db, email="m@lic-api.com", role="member"),
        "resp": await create_user(db, email="r@lic-api.com", role="viewer"),
    }
    await create_card_type(db, key="Application")
    await create_card_type(db, key="Platform", label="Platform")
    await create_card_type(db, key="Process", label="Process")
    await create_license_type(db, "admin", "Admin")
    await create_license_type(db, "old", "Old")
    await license_types.update_item(db, "users", "old", archived=True)
    await create_stakeholder_role_def(
        db, key="responsible", label="R", permissions={"card.view": True, "card.edit": True}
    )
    card = await create_card(
        db,
        card_type="Application",
        name="ERP",
        user_id=users["admin"].id,
        attributes={"licensingModel": ["users", "installations"]},
    )
    db.add(Stakeholder(card_id=card.id, user_id=users["resp"].id, role="responsible"))
    await db.flush()
    return {**users, "card": card}


def url(card, tail=""):
    return f"/api/v1/cards/{card.id}/licenses{tail}"


async def put(client, env, user="admin", fy=CUR, metric="users", key="admin", body=None):
    return await client.put(
        url(env["card"], f"/{fy}/items/{metric}/{key}"),
        json=body if body is not None else {"licensed": 10, "actual": 8},
        headers=auth_headers(env[user]),
    )


async def test_get_window_and_can_edit_for_admin(client, env):
    r = await client.get(url(env["card"]), headers=auth_headers(env["admin"]))
    assert r.status_code == 200
    body = r.json()
    assert len(body["years"]) == 6 and body["can_edit"] is True
    assert (
        "licensing_model" not in body and "catalogue" not in body
    )  # GET /metamodel/license-metrics
    assert body["years"][-1]["is_forecast"] and body["years"][-1]["status"] is None


async def test_viewer_without_permission_403(client, env):
    r = await client.get(url(env["card"]), headers=auth_headers(env["viewer"]))
    assert r.status_code == 403


async def test_member_reads_but_cannot_edit(client, env):
    r = await client.get(url(env["card"]), headers=auth_headers(env["member"]))
    assert r.status_code == 200 and r.json()["can_edit"] is False


async def test_stakeholder_viewer_reads_own_card(client, env):
    r = await client.get(url(env["card"]), headers=auth_headers(env["resp"]))
    assert r.status_code == 200 and r.json()["can_edit"] is True


async def test_hidden_card_404(client, db, env):
    from sqlalchemy import update

    from app.models.card_type import CardType

    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"member": {"inventory.view": False}})
    )
    await db.flush()
    r = await client.get(url(env["card"]), headers=auth_headers(env["member"]))
    assert r.status_code == 404


async def test_platform_card_404(client, db, env):
    other = await create_card(db, card_type="Platform", name="P", user_id=env["admin"].id)
    r = await client.get(url(other), headers=auth_headers(env["admin"]))
    assert r.status_code == 404
    r = await client.put(
        url(other, f"/{CUR}/items/users/admin"),
        json={"licensed": 1},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 404


async def test_put_success_and_event_stored(client, db, env):
    r = await put(client, env)
    assert r.status_code == 200
    users = r.json()["metrics"][0]
    assert users["metric"] == "users" and users["types"][0]["pct"] == 80.0
    assert users["status"] == "approaching"
    evs = [e for e in (await db.execute(select(Event))).scalars() if e.card_id == env["card"].id]
    assert len(evs) == 1 and evs[0].data["source"] == "card_licenses"
    assert evs[0].data["changes"]["license_types"] == {"old": [], "new": ["users:admin"]}
    assert (
        await client.get(url(env["card"], f"/{CUR}"), headers=auth_headers(env["admin"]))
    ).json()["pair_keys"] == ["users:admin"]
    assert "10" not in str(evs[0].data["changes"])
    year = await client.get(url(env["card"], f"/{CUR}"), headers=auth_headers(env["admin"]))
    assert year.json()["can_edit"] is True


async def test_put_rejects_unknown_type_422(client, env):
    assert (await put(client, env, key="nope")).status_code == 422


async def test_put_rejects_forecast_actual_422(client, env):
    assert (await put(client, env, fy=FORECAST)).status_code == 422
    ok = await put(client, env, fy=FORECAST, body={"licensed": 5})
    assert ok.status_code == 200 and ok.json()["status"] is None


async def test_put_rejects_bad_year_422(client, env):
    assert (await put(client, env, fy=CUR + 2)).status_code == 422


async def test_put_rejects_fractional_count_422(client, env):
    assert (await put(client, env, body={"licensed": 1.5})).status_code == 422
    assert (await put(client, env, body={"licensed": -1})).status_code == 422
    assert (await put(client, env, metric="seats")).status_code == 422


async def test_put_409_archived_new_type(client, env):
    assert (await put(client, env, key="old")).status_code == 409


async def test_put_409_archived_metric_new_cell(client, db, env):
    from app.services import license_metrics

    await license_metrics.update_item(db, "users", archived=True)
    r = await put(client, env)
    assert r.status_code == 409 and r.json()["detail"] == "archived_metric"


async def test_member_without_card_edit_stakeholder_403(client, env):
    assert (await put(client, env, user="member")).status_code == 403
    assert (await put(client, env, user="viewer")).status_code == 403
    assert (await put(client, env, user="resp")).status_code == 200  # card.edit stakeholder


async def test_delete_is_idempotent(client, env):
    await put(client, env)
    path = url(env["card"], f"/{CUR}/items/users/admin")
    assert (await client.delete(path, headers=auth_headers(env["member"]))).status_code == 403
    assert (await client.delete(path, headers=auth_headers(env["admin"]))).status_code == 204
    assert (await client.delete(path, headers=auth_headers(env["admin"]))).status_code == 204


async def test_confirm_and_copy_to_forecast(client, env):
    await put(client, env, fy=CUR - 1, body={"licensed": 10, "actual": 9})
    r = await client.post(url(env["card"], f"/{CUR}/confirm"), headers=auth_headers(env["admin"]))
    assert r.status_code == 200 and r.json()["confirmed"] is True
    r = await client.post(
        url(env["card"], f"/{CUR}/items/users/admin/copy-to-forecast"),
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["fiscal_year"] == FORECAST
    cell = body["metrics"][0]["types"][0]
    assert (cell["licensed"], cell["actual"]) == (10, None)
    bad = await client.post(
        url(env["card"], f"/{CUR}/items/users/admin/copy-to-forecast"),
        headers=auth_headers(env["viewer"]),
    )
    assert bad.status_code == 403


async def test_readable_wrong_type_card_is_404_for_everyone_even_without_permission(
    client, db, env
):
    other = await create_card(db, card_type="Platform", name="P2", user_id=env["admin"].id)
    for who in ("admin", "viewer"):  # the viewer lacks licenses.view: still 404, never 403
        r = await client.get(url(other), headers=auth_headers(env[who]))
        assert r.status_code == 404


async def test_delete_outside_the_write_window_is_422(client, env):
    path = url(env["card"], f"/{CUR - 6}/items/users/admin")
    r = await client.delete(path, headers=auth_headers(env["admin"]))
    assert r.status_code == 422 and r.json()["detail"] == "year_out_of_range"
