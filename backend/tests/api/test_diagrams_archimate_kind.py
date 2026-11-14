from __future__ import annotations

import uuid

import pytest

from app.models.archimate_viewpoint import ArchimateViewpoint
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

XML = '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m"/>'
AM = {"format": "archimate-exchange-3.1", "xml": XML}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    # A real, non-hidden viewpoint for the archimate-create viewpoint check
    # (Task 5) -- not the full seed.seed_metamodel(), which collides with this
    # file's own create_card_type() calls ("Application" is already seeded).
    db.add(ArchimateViewpoint(key="organization", name="Organization", layer="business"))
    await db.flush()
    return {"admin": await create_user(db, email="a@t.com", role="admin")}


async def _create(client, env, **body):
    # Every existing archimate-kind test in this file predates the viewpoint
    # requirement; default a real seeded viewpoint so they keep exercising the
    # data-shape/publish/etc. behaviour they actually test. A test for the
    # viewpoint check itself passes viewpoint_key explicitly (None or unknown)
    # to opt out of this default.
    if body.get("kind") == "archimate" and "viewpoint_key" not in body:
        body["viewpoint_key"] = "organization"
    return await client.post("/api/v1/diagrams", json=body, headers=auth_headers(env["admin"]))


async def test_default_kind_is_drawio(client, env):
    r = await _create(client, env, name="d", data={"xml": "<mxGraphModel/>"})
    assert r.status_code == 201
    got = (
        await client.get(f"/api/v1/diagrams/{r.json()['id']}", headers=auth_headers(env["admin"]))
    ).json()
    assert got["kind"] == "drawio"


async def test_archimate_diagram_roundtrips_its_data(client, env):
    r = await _create(client, env, name="a", kind="archimate", data=AM)
    assert r.status_code == 201
    got = (
        await client.get(f"/api/v1/diagrams/{r.json()['id']}", headers=auth_headers(env["admin"]))
    ).json()
    assert got["kind"] == "archimate" and got["data"] == AM
    assert got["viewpoint_key"] == "organization"


@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        {"xml": "<x/>"},
        {"format": "archimate-exchange-3.1"},
        {"format": "archimate-exchange-3.1", "xml": ""},
        {"format": "other", "xml": "<x/>"},
    ],
)
async def test_archimate_data_shape_is_enforced(client, env, data):
    r = await _create(client, env, name="a", kind="archimate", data=data)
    assert r.status_code == 422


async def test_drawio_create_refuses_archimate_data(client, env):
    assert (await _create(client, env, name="d", data=AM)).status_code == 422


async def test_archimate_diagram_without_viewpoint_is_rejected(client, env):
    r = await _create(client, env, name="a", kind="archimate", data=AM, viewpoint_key=None)
    assert r.status_code == 422


async def test_drawio_diagram_does_not_need_a_viewpoint(client, env):
    r = await _create(client, env, name="d")
    assert r.status_code == 201


async def test_archimate_diagram_with_unknown_viewpoint_is_rejected(client, env):
    r = await _create(client, env, name="a", kind="archimate", data=AM, viewpoint_key="nope")
    assert r.status_code == 404


async def test_unknown_kind_is_rejected(client, env):
    assert (await _create(client, env, name="a", kind="visio")).status_code == 422


async def test_list_defaults_to_drawio_and_filters_by_kind(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    ids = lambda rows: {x["id"] for x in rows}  # noqa: E731
    assert ids((await client.get("/api/v1/diagrams", headers=h)).json()) == {d}
    assert ids((await client.get("/api/v1/diagrams?kind=drawio", headers=h)).json()) == {d}
    assert ids((await client.get("/api/v1/diagrams?kind=archimate", headers=h)).json()) == {a}
    assert ids((await client.get("/api/v1/diagrams?kind=all", headers=h)).json()) == {d, a}
    rows = (await client.get("/api/v1/diagrams?kind=all", headers=h)).json()
    assert {x["id"]: x["kind"] for x in rows} == {d: "drawio", a: "archimate"}
    assert (await client.get("/api/v1/diagrams?kind=nope", headers=h)).status_code == 422


async def test_card_linked_listing_hides_archimate_diagrams_by_default(client, env, db):
    """`GET /diagrams?card_id=` with no `kind` lists DrawIO only (Resources tab asks `kind=all`)."""
    h = auth_headers(env["admin"])
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
    d = (
        await _create(client, env, name="draw", data={"xml": "<m/>"}, card_ids=[str(card.id)])
    ).json()["id"]
    a = (
        await _create(client, env, name="arch", kind="archimate", data=AM, card_ids=[str(card.id)])
    ).json()["id"]
    url = f"/api/v1/diagrams?card_id={card.id}"
    assert {x["id"] for x in (await client.get(url, headers=h)).json()} == {d}
    assert {x["id"] for x in (await client.get(url + "&kind=all", headers=h)).json()} == {d, a}
    # card_ids sync works as for DrawIO: explicit, replaced on PATCH.
    got = (await client.get(f"/api/v1/diagrams/{a}", headers=h)).json()
    assert got["card_ids"] == [str(card.id)]
    r = await client.patch(f"/api/v1/diagrams/{a}", json={"card_ids": []}, headers=h)
    assert r.status_code == 200 and r.json()["card_ids"] == []


async def test_patch_checks_the_data_shape_against_the_kind(client, env):
    h = auth_headers(env["admin"])
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.patch(f"/api/v1/diagrams/{a}", json={"data": {"xml": "<m/>"}}, headers=h)
    assert r.status_code == 422
    assert (
        await client.patch(f"/api/v1/diagrams/{d}", json={"data": AM}, headers=h)
    ).status_code == 422
    new = {**AM, "xml": XML + " "}
    ok = await client.patch(f"/api/v1/diagrams/{a}", json={"data": new}, headers=h)
    assert ok.status_code == 200
    assert (await client.get(f"/api/v1/diagrams/{a}", headers=h)).json()["data"] == new


async def test_kind_cannot_be_changed(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.patch(f"/api/v1/diagrams/{d}", json={"kind": "archimate"}, headers=h)
    assert r.status_code == 422
    # Re-sending the same kind is a no-op, not an error.
    same = await client.patch(f"/api/v1/diagrams/{d}", json={"kind": "drawio"}, headers=h)
    assert same.status_code == 200


async def test_archimate_diagrams_cannot_be_published(client, env):
    h = auth_headers(env["admin"])
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    r = await client.post(f"/api/v1/diagrams/{a}/publish", json={}, headers=h)
    assert r.status_code == 400 and "cannot be published" in r.json()["detail"]
    got = (await client.get(f"/api/v1/diagrams/{a}", headers=h)).json()
    assert got["is_published"] is False and got["public_slug"] is None


async def test_drawio_diagrams_still_publish(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.post(f"/api/v1/diagrams/{d}/publish", json={}, headers=h)
    assert r.status_code == 200 and r.json()["is_published"] is True


async def test_unknown_kind_on_patch_is_rejected(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.patch(f"/api/v1/diagrams/{d}", json={"kind": "visio"}, headers=h)
    assert r.status_code == 422


async def test_group_diagram_count_blends_both_kinds(client, env):
    h = auth_headers(env["admin"])
    g = (await client.post("/api/v1/diagram-groups", json={"name": "G"}, headers=h)).json()["id"]
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    for did in (d, a):
        r = await client.put(f"/api/v1/diagrams/{did}/groups", json={"group_ids": [g]}, headers=h)
        assert r.status_code == 200
    groups = (await client.get("/api/v1/diagram-groups", headers=h)).json()
    row = next(x for x in groups if x["id"] == g)
    assert row["diagram_count"] == 2
    assert row["diagram_count_drawio"] == 1
    assert row["diagram_count_archimate"] == 1
    r = await client.patch(f"/api/v1/diagram-groups/{g}", json={"name": "G2"}, headers=h)
    assert r.json()["diagram_count"] == 2


async def test_published_archimate_row_never_serves_publicly(client, env, db):
    from app.models.diagram import Diagram

    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    row = await db.get(Diagram, uuid.UUID(a))
    row.is_published, row.public_slug = True, "arch-slug"
    await db.commit()
    assert (await client.get("/api/v1/diagrams/public/arch-slug")).status_code == 404
    assert (await client.get("/api/v1/diagrams/public/arch-slug/gate")).status_code == 404


# ── card_ids sync: purged and hidden cards ───────────────────────────────────


@pytest.fixture
async def cards_env(db):
    from sqlalchemy import select

    from app.core.permissions import MEMBER_PERMISSIONS
    from app.models.card_type import CardType
    from app.services.permission_service import PermissionService

    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"member": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    return {
        "admin": await create_user(db, email="a@t.com", role="admin"),
        "member": await create_user(db, email="m@t.com", role="member"),
        "app": await create_card(db, card_type="Application", name="App"),
        "secret": await create_card(db, card_type="Initiative", name="Secret"),
    }


async def test_patch_drops_the_id_of_a_purged_card(client, cards_env, db):
    """A hard-purged card's id lingers in the XML: saving must not 500 on the FK."""
    h = auth_headers(cards_env["admin"])
    app = cards_env["app"]
    d = (
        await client.post(
            "/api/v1/diagrams",
            json={"name": "d", "data": {"xml": "<m/>"}, "card_ids": [str(app.id)]},
            headers=h,
        )
    ).json()["id"]
    app_id = str(app.id)
    await db.delete(app)
    await db.commit()
    r = await client.patch(f"/api/v1/diagrams/{d}", json={"card_ids": [app_id]}, headers=h)
    assert r.status_code == 200 and r.json()["card_ids"] == []
    assert (await client.get(f"/api/v1/diagrams/{d}", headers=h)).json()["card_ids"] == []


async def test_create_drops_a_non_existent_card_id(client, cards_env):
    h = auth_headers(cards_env["admin"])
    ghost = str(uuid.uuid4())
    r = await client.post(
        "/api/v1/diagrams",
        json={"name": "d", "data": {"xml": "<m/>"}, "card_ids": [ghost, str(cards_env["app"].id)]},
        headers=h,
    )
    assert r.status_code == 201 and r.json()["card_ids"] == [str(cards_env["app"].id)]


async def test_patch_keeps_an_already_linked_hidden_card(client, cards_env):
    admin_h, member_h = auth_headers(cards_env["admin"]), auth_headers(cards_env["member"])
    app, secret = str(cards_env["app"].id), str(cards_env["secret"].id)
    d = (
        await client.post(
            "/api/v1/diagrams",
            json={"name": "d", "data": {"xml": "<m/>"}, "card_ids": [app, secret]},
            headers=admin_h,
        )
    ).json()["id"]
    # The member's client only ever saw `app`, and the XML still references both.
    r = await client.patch(
        f"/api/v1/diagrams/{d}", json={"card_ids": [app, secret]}, headers=member_h
    )
    assert r.status_code == 200 and r.json()["card_ids"] == [app]
    r = await client.patch(f"/api/v1/diagrams/{d}", json={"card_ids": [app]}, headers=member_h)
    assert r.status_code == 200
    got = (await client.get(f"/api/v1/diagrams/{d}", headers=admin_h)).json()
    assert set(got["card_ids"]) == {app, secret}


async def test_patch_refuses_a_new_link_to_a_hidden_card(client, cards_env):
    admin_h, member_h = auth_headers(cards_env["admin"]), auth_headers(cards_env["member"])
    d = (
        await client.post(
            "/api/v1/diagrams", json={"name": "d", "data": {"xml": "<m/>"}}, headers=admin_h
        )
    ).json()["id"]
    r = await client.patch(
        f"/api/v1/diagrams/{d}", json={"card_ids": [str(cards_env["secret"].id)]}, headers=member_h
    )
    assert r.status_code == 404


# ── card link / unlink endpoints ─────────────────────────────────────────────


async def _archimate_row(db):
    from app.models.diagram import Diagram

    db.add(ArchimateViewpoint(key="organization", name="Organization", layer="business"))
    await db.flush()
    d = Diagram(name="a", kind="archimate", viewpoint_key="organization", data=AM)
    db.add(d)
    await db.flush()
    return d


async def _drawio(client, user):
    r = await client.post(
        "/api/v1/diagrams",
        json={"name": "d", "data": {"xml": "<m/>"}},
        headers=auth_headers(user),
    )
    return r.json()["id"]


async def test_link_an_archimate_diagram_is_refused(client, cards_env, db):
    d = await _archimate_row(db)
    h = auth_headers(cards_env["admin"])
    r = await client.post(
        f"/api/v1/diagrams/{d.id}/cards", json={"card_id": str(cards_env["app"].id)}, headers=h
    )
    assert r.status_code == 409


async def test_unlink_an_archimate_diagram_is_refused(client, cards_env, db):
    d = await _archimate_row(db)
    h = auth_headers(cards_env["admin"])
    r = await client.delete(f"/api/v1/diagrams/{d.id}/cards/{cards_env['app'].id}", headers=h)
    assert r.status_code == 409


async def test_link_an_archimate_diagram_needs_the_layer_key(client, cards_env, db):
    d = await _archimate_row(db)
    await create_role(db, key="dm", label="dm", permissions={"diagrams.manage": True})
    h = auth_headers(await create_user(db, email="dm@t.com", role="dm"))
    app = str(cards_env["app"].id)
    r = await client.post(f"/api/v1/diagrams/{d.id}/cards", json={"card_id": app}, headers=h)
    assert r.status_code == 403
    assert (
        await client.delete(f"/api/v1/diagrams/{d.id}/cards/{app}", headers=h)
    ).status_code == 403


async def test_link_a_hidden_card_and_a_missing_card_answer_the_same(client, cards_env):
    d = await _drawio(client, cards_env["admin"])
    h = auth_headers(cards_env["member"])
    url = f"/api/v1/diagrams/{d}/cards"
    hidden = await client.post(url, json={"card_id": str(cards_env["secret"].id)}, headers=h)
    missing = await client.post(url, json={"card_id": str(uuid.uuid4())}, headers=h)
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json() == missing.json()
    hidden = await client.delete(f"{url}/{cards_env['secret'].id}", headers=h)
    missing = await client.delete(f"{url}/{uuid.uuid4()}", headers=h)
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json() == missing.json()


async def test_a_caller_cannot_unlink_a_card_it_cannot_read(client, cards_env):
    d = await _drawio(client, cards_env["admin"])
    secret = str(cards_env["secret"].id)
    url = f"/api/v1/diagrams/{d}/cards"
    admin = auth_headers(cards_env["admin"])
    assert (await client.post(url, json={"card_id": secret}, headers=admin)).status_code == 201
    r = await client.delete(f"{url}/{secret}", headers=auth_headers(cards_env["member"]))
    assert r.status_code == 404 and r.json()["detail"] == "Card not found"
    r = await client.get(f"/api/v1/diagrams/{d}", headers=admin)
    assert secret in r.json()["card_ids"]


async def test_an_unrestricted_caller_gets_404_for_a_missing_card(client, cards_env):
    d = await _drawio(client, cards_env["admin"])
    h = auth_headers(cards_env["admin"])
    url = f"/api/v1/diagrams/{d}/cards"
    r = await client.post(url, json={"card_id": str(uuid.uuid4())}, headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "Card not found"
    r = await client.delete(f"{url}/{uuid.uuid4()}", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "Card not found"


async def test_link_and_unlink_a_readable_card_still_work(client, cards_env):
    d = await _drawio(client, cards_env["admin"])
    h = auth_headers(cards_env["member"])
    url = f"/api/v1/diagrams/{d}/cards"
    app = str(cards_env["app"].id)
    assert (await client.post(url, json={"card_id": app}, headers=h)).status_code == 201
    assert (await client.post(url, json={"card_id": app}, headers=h)).status_code == 409
    assert (await client.delete(f"{url}/{app}", headers=h)).status_code == 204
    r = await client.delete(f"{url}/{app}", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "Link not found"
