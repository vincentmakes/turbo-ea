"""ArchiMate diagrams are gated on the per-layer ``archimatediagrams.<tab>.<action>``
keys, not on ``diagrams.*``. A viewpoint spanning several tabs needs the key on
at least one of them."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.models.archimate_viewpoint import ArchimateViewpoint, ArchimateViewpointObject
from app.models.diagram import Diagram
from app.models.enterprise_object import EnterpriseObject
from tests.conftest import auth_headers, create_role, create_user

XML = '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m"/>'
AM = {"format": "archimate-exchange-3.1", "xml": XML}


@pytest.fixture
async def env(db):
    for key, layer in (
        ("BusinessActor", "business"),
        ("ApplicationComponent", "application"),
        ("Node", "technology"),
    ):
        db.add(EnterpriseObject(key=key, name=key, layer=layer))
    for key, objects in (
        ("vp-business", ["BusinessActor"]),
        ("vp-technology", ["Node"]),
        ("vp-app-tech", ["ApplicationComponent", "Node"]),
    ):
        db.add(ArchimateViewpoint(key=key, name=key, layer="business"))
        await db.flush()
        for o in objects:
            db.add(ArchimateViewpointObject(viewpoint_key=key, enterprise_object_key=o))
    await db.flush()

    users = {}
    for role, perms in {
        "business_manager": {"archimatediagrams.business.manage": True},
        "technology_manager": {"archimatediagrams.technology.manage": True},
        "business_viewer": {"archimatediagrams.business.view": True},
        "technology_viewer": {"archimatediagrams.technology.view": True},
        # Full plain-diagram rights, no ArchiMate keys at all.
        "drawio_only": {"diagrams.view": True, "diagrams.manage": True},
    }.items():
        await create_role(db, key=role, label=role, permissions=perms)
        users[role] = await create_user(db, email=f"{role}@t.com", role=role)
    return users


async def _create(client, user, viewpoint_key):
    return await client.post(
        "/api/v1/diagrams",
        json={"name": "a", "kind": "archimate", "viewpoint_key": viewpoint_key, "data": AM},
        headers=auth_headers(user),
    )


async def test_layer_manage_key_allows_its_own_layer_only(client, env):
    assert (await _create(client, env["business_manager"], "vp-business")).status_code == 201
    assert (await _create(client, env["business_manager"], "vp-technology")).status_code == 403


async def test_cross_layer_viewpoint_needs_one_of_its_layers(client, env):
    # vp-app-tech spans application + technology.
    assert (await _create(client, env["technology_manager"], "vp-app-tech")).status_code == 201
    assert (await _create(client, env["business_manager"], "vp-app-tech")).status_code == 403


async def test_diagrams_keys_no_longer_grant_archimate_access(client, env, db):
    assert (await _create(client, env["drawio_only"], "vp-business")).status_code == 403
    d = Diagram(name="x", kind="archimate", viewpoint_key="vp-business", data=AM)
    db.add(d)
    await db.flush()
    r = await client.get(f"/api/v1/diagrams/{d.id}", headers=auth_headers(env["drawio_only"]))
    assert r.status_code == 403


async def test_open_and_edit_follow_the_diagram_viewpoint_layers(client, env, db):
    business = Diagram(name="b", kind="archimate", viewpoint_key="vp-business", data=AM)
    technology = Diagram(name="t", kind="archimate", viewpoint_key="vp-technology", data=AM)
    db.add_all([business, technology])
    await db.flush()
    viewer = auth_headers(env["business_viewer"])
    assert (await client.get(f"/api/v1/diagrams/{business.id}", headers=viewer)).status_code == 200
    assert (
        await client.get(f"/api/v1/diagrams/{technology.id}", headers=viewer)
    ).status_code == 403
    # view is not manage
    r = await client.patch(f"/api/v1/diagrams/{business.id}", json={"name": "z"}, headers=viewer)
    assert r.status_code == 403
    r = await client.patch(
        f"/api/v1/diagrams/{technology.id}",
        json={"name": "z"},
        headers=auth_headers(env["technology_manager"]),
    )
    assert r.status_code == 200


async def test_archimate_list_takes_any_layer_view_or_manage_key(client, env):
    url = "/api/v1/diagrams?kind=archimate"
    for role in ("business_manager", "technology_viewer"):
        assert (await client.get(url, headers=auth_headers(env[role]))).status_code == 200
    assert (await client.get(url, headers=auth_headers(env["drawio_only"]))).status_code == 403
    # The DrawIO list is untouched: still diagrams.view.
    r = await client.get("/api/v1/diagrams", headers=auth_headers(env["drawio_only"]))
    assert r.status_code == 200


async def test_all_list_silently_drops_archimate_rows_the_user_cant_see(client, env, db):
    """The Diagrams page's kind=all listing mixes DrawIO and ArchiMate: the base
    diagrams.view key (required for kind=all, same as today) covers every
    DrawIO row, but an ArchiMate row still needs its own per-layer key --
    dropped from the list, not a 403 for the whole page, the same way an
    unreadable linked card is dropped."""
    await create_role(
        db,
        key="mixed_viewer",
        label="mixed_viewer",
        permissions={"diagrams.view": True, "archimatediagrams.business.view": True},
    )
    mixed_viewer = await create_user(db, email="mixed@t.com", role="mixed_viewer")
    drawio = Diagram(name="d", kind="drawio", data={"xml": "<m/>"})
    business = Diagram(name="b", kind="archimate", viewpoint_key="vp-business", data=AM)
    technology = Diagram(name="t", kind="archimate", viewpoint_key="vp-technology", data=AM)
    db.add_all([drawio, business, technology])
    await db.flush()
    r = await client.get("/api/v1/diagrams?kind=all", headers=auth_headers(mixed_viewer))
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {str(drawio.id), str(business.id)}
    r = await client.get("/api/v1/diagrams?kind=all", headers=auth_headers(env["drawio_only"]))
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {str(drawio.id)}


async def test_list_filters_by_viewpoint_key(client, env, db):
    business = Diagram(name="b", kind="archimate", viewpoint_key="vp-business", data=AM)
    technology = Diagram(name="t", kind="archimate", viewpoint_key="vp-technology", data=AM)
    db.add_all([business, technology])
    await db.flush()
    h = auth_headers(env["business_manager"])
    r = await client.get("/api/v1/diagrams?kind=archimate&viewpoint_key=vp-business", headers=h)
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {str(business.id)}
    assert r.json()[0]["viewpoint_key"] == "vp-business"


async def test_validate_needs_an_archimate_view_key(client, env):
    body = {"xml": XML}
    r = await client.post(
        "/api/v1/archimate/validate", json=body, headers=auth_headers(env["drawio_only"])
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/v1/archimate/validate", json=body, headers=auth_headers(env["technology_viewer"])
    )
    assert r.status_code == 200


# ── migration 162 ────────────────────────────────────────────────────────────

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "162_add_archimate_diagram_permissions.py"
)
_spec = importlib.util.spec_from_file_location("mig162", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_migration_copies_each_diagrams_value_to_every_layer():
    planned = mig.plan_role_permissions(
        {"diagrams.view": True, "diagrams.manage": False, "diagrams.publish": True}
    )
    for layer in ("business", "application", "technology"):
        assert planned[f"archimatediagrams.{layer}.view"] is True
        assert planned[f"archimatediagrams.{layer}.manage"] is False
        assert planned[f"archimatediagrams.{layer}.publish"] is True


def test_migration_keeps_explicit_values_and_wildcards():
    assert mig.plan_role_permissions({"*": True}) == {"*": True}
    planned = mig.plan_role_permissions(
        {"diagrams.manage": True, "archimatediagrams.business.manage": False}
    )
    assert planned["archimatediagrams.business.manage"] is False
    assert planned["archimatediagrams.technology.manage"] is True


async def test_archimate_list_hides_diagrams_of_layers_the_caller_has_no_key_for(client, env, db):
    business = Diagram(name="biz", kind="archimate", viewpoint_key="vp-business", data=AM)
    technology = Diagram(name="tech", kind="archimate", viewpoint_key="vp-technology", data=AM)
    db.add_all([business, technology])
    await db.flush()
    url = "/api/v1/diagrams?kind=archimate"

    r = await client.get(url, headers=auth_headers(env["business_viewer"]))
    assert r.status_code == 200
    assert [d["name"] for d in r.json()] == ["biz"]
    r = await client.get(url, headers=auth_headers(env["technology_manager"]))
    assert [d["name"] for d in r.json()] == ["tech"]


async def test_card_listing_with_kind_all_hides_an_archimate_layer_the_caller_cannot_view(
    client, env, db
):
    from sqlalchemy import insert

    from app.models.diagram import diagram_cards
    from tests.conftest import create_card, create_card_type

    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="App")
    tech = Diagram(name="t", kind="archimate", viewpoint_key="vp-technology", data=AM)
    db.add(tech)
    await db.flush()
    await db.execute(insert(diagram_cards).values(diagram_id=tech.id, card_id=card.id))
    users = {}
    for role, key in (("biz_all", "business"), ("tech_all", "technology")):
        await create_role(
            db,
            key=role,
            label=role,
            permissions={"diagrams.view": True, f"archimatediagrams.{key}.view": True},
        )
        users[role] = await create_user(db, email=f"{role}@t.com", role=role)
    url = f"/api/v1/diagrams?card_id={card.id}&kind=all"
    biz = await client.get(url, headers=auth_headers(users["biz_all"]))
    techr = await client.get(url, headers=auth_headers(users["tech_all"]))
    assert biz.status_code == techr.status_code == 200
    assert biz.json() == []
    assert {x["id"] for x in techr.json()} == {str(tech.id)}
