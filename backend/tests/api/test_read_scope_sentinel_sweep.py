"""Behavioural guard: no GET endpoint hands a restricted reader a hidden card.

A card of a type the reader's role may not View is seeded with a unique
sentinel name and wired into everything that can reference a card — a
relation, an ADR, a risk, a diagram link, a todo, a favourite, a comment, a
shared OData bookmark and the event log. Then every GET route under
``/api/v1`` is called as a role holding every non-admin permission, and the
sentinel's name and id must appear in no response body.

The static scan (``tests/services/test_card_read_scope_guard.py``) proves a
module considered the read scope; this proves the queries inside it apply it.
A route whose path parameter this file cannot fill must be listed in
``UNMAPPED_PARAMS`` or skipped with a reason, so a new route forces a decision.

Two controls keep the sweep honest: as admin the sentinel must show up on a
good number of routes (so an empty sweep cannot pass vacuously), and a second
card of the hidden type held through a stakeholder role must still be listed
for the restricted reader.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import select

from app.core.permissions import ALL_APP_PERMISSION_KEYS
from app.models.card_type import CardType
from app.models.turbolens import TurboLensVendorAnalysis
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card_type,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

SENTINEL = "ZZSENTINELHIDDEN4711"
HELD = "ZZHELDVISIBLE9876"

# Path parameters the sweep does not fill, with the reason. Routes carrying
# one are not called.
UNMAPPED_PARAMS = {
    "assessment_id": "TurboLens assessment — none seeded",
    "asset_path": "extension asset bytes",
    "attachment_id": "no attachment seeded (the list route is covered)",
    "batch_id": "mutation ledger is admin audit data",
    "calc_id": "admin",
    "conn_id": "ServiceNow admin",
    "initiative_id": "PPM — no Initiative seeded",
    "install_id": "extension admin",
    "mapping_id": "ServiceNow admin",
    "migration_id": "migration admin",
    "portal_id": "portal admin",
    "process_id": "BPM — no process seeded",
    "product": "endoflife.date proxy (network)",
    "report_id": "saved reports — none seeded",
    "role_key": "metamodel config",
    "run_id": "analysis runs — none seeded",
    "slug": "public publications are out of scope by design",
    "soaw_id": "SoAW — none seeded",
    "survey_id": "surveys are addressed by an admin — out of scope",
    "table": "ServiceNow admin",
    "task_id": "none seeded",
    "template_key": "static templates",
    "transfer_id": "workspace transfer admin",
    "user_id": "user directory",
    "version": "extension assets",
    "version_id": "BPM — no process seeded",
}

# Routes never called: they stream, reach the network, or are heavy admin jobs.
SKIP_PREFIXES = (
    "/api/v1/events/stream",
    "/api/v1/eol/products",
    "/api/v1/admin/extensions",
    "/api/v1/extensions",
    "/api/v1/capability-catalogue",
    "/api/v1/process-catalogue",
    "/api/v1/value-stream-catalogue",
    "/api/v1/principles-catalogue",
    "/api/v1/admin/workspace",
    "/api/v1/web-portals/public",
    "/api/v1/diagrams/public",
    "/api/v1/ext-assets",
)


def _get_paths(app) -> list[tuple[str, list[dict]]]:
    spec = app.openapi()
    out = []
    for path, ops in spec["paths"].items():
        if "get" in ops:
            out.append((path, ops["get"].get("parameters", [])))
    return out


@pytest.fixture
async def world(db, client):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    restricted_perms = {k: True for k in ALL_APP_PERMISSION_KEYS if not k.startswith("admin.")}
    await create_role(db, key="restricted", label="Restricted", permissions=restricted_perms)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Secret", label="Secret")
    await create_relation_type(
        db,
        key="relAppToSecret",
        label="uses",
        source_type_key="Application",
        target_type_key="Secret",
    )
    await create_stakeholder_role_def(
        db, card_type_key="Secret", key="responsible", permissions={"card.view": True}
    )
    admin = await create_user(db, email="admin@sweep.test", role="admin")
    reader = await create_user(db, email="reader@sweep.test", role="restricted")
    ah = auth_headers(admin)

    async def post(path, json):
        resp = await client.post(path, json=json, headers=ah)
        assert resp.status_code in (200, 201), (path, resp.status_code, resp.text)
        return resp.json()

    anchor = await post("/api/v1/cards", {"type": "Application", "name": "Anchor App"})
    sentinel = await post("/api/v1/cards", {"type": "Secret", "name": SENTINEL})
    held = await post("/api/v1/cards", {"type": "Secret", "name": HELD})
    await post(
        "/api/v1/relations",
        {"type": "relAppToSecret", "source_id": anchor["id"], "target_id": sentinel["id"]},
    )
    await post(
        "/api/v1/relations",
        {"type": "relAppToSecret", "source_id": anchor["id"], "target_id": held["id"]},
    )
    await post(
        f"/api/v1/cards/{held['id']}/stakeholders",
        {"user_id": str(reader.id), "role": "responsible"},
    )
    adr = await post(
        "/api/v1/adr",
        {"title": "Decision", "linked_card_ids": [anchor["id"], sentinel["id"]]},
    )
    risk = await post(
        "/api/v1/risks", {"title": "Risk", "card_ids": [anchor["id"], sentinel["id"]]}
    )
    diagram = await post(
        "/api/v1/diagrams", {"name": "Diagram", "card_ids": [anchor["id"], sentinel["id"]]}
    )
    bookmark = await post(
        "/api/v1/bookmarks",
        {"name": "All", "visibility": "public", "odata_enabled": True, "filters": {}},
    )
    await post(
        f"/api/v1/cards/{sentinel['id']}/todos",
        {"description": "Look at it", "assigned_to": str(reader.id)},
    )
    await post(f"/api/v1/cards/{sentinel['id']}/comments", {"content": "note"})
    # Starred before the deny exists: a favourite outlives a later deny.
    resp = await client.post(f"/api/v1/favorites/{sentinel['id']}", headers=auth_headers(reader))
    assert resp.status_code in (200, 201), resp.text

    # A vendor analysis row is written by a background job, never by a route:
    # seed it directly so `/turbolens/vendors` carries the sentinel's name.
    db.add(
        TurboLensVendorAnalysis(
            vendor_name="Vendor X", category="ERP", app_count=1, app_list=[SENTINEL]
        )
    )

    ct = (await db.execute(select(CardType).where(CardType.key == "Secret"))).scalar_one()
    ct.role_permissions = {"restricted": {"inventory.view": False}}
    await db.commit()
    PermissionService.invalidate_type_permission_cache()

    return {
        "admin": admin,
        "reader": reader,
        "ids": {
            "card_id": anchor["id"],
            "adr_id": adr["id"],
            "risk_id": risk["id"],
            "diagram_id": diagram["id"],
            "bm_id": bookmark["id"],
            "key": "Application",
            "type_key": "Application",
        },
        "sentinel_id": sentinel["id"],
        "held_id": held["id"],
    }


QUERY_FILL = {
    "types": "Application,Secret",
    "type": "Application",
    "relation_type": "relAppToSecret",
}


async def _sweep(app, client, db, user, ids) -> tuple[dict[str, str], list[str]]:
    """GET every mappable route; return {path: body} and the errors met."""
    bodies: dict[str, str] = {}
    errors: list[str] = []
    headers = auth_headers(user)
    for path, params in _get_paths(app):
        if path.startswith(SKIP_PREFIXES):
            continue
        names = re.findall(r"\{(\w+)\}", path)
        unknown = [n for n in names if n not in ids]
        if unknown:
            assert all(n in UNMAPPED_PARAMS for n in unknown), (
                f"{path}: map {unknown} in the sweep or list them in UNMAPPED_PARAMS"
            )
            continue
        url = path
        for n in names:
            url = url.replace("{" + n + "}", str(ids[n]))
        query = {
            p["name"]: QUERY_FILL[p["name"]]
            for p in params
            if p["in"] == "query" and p.get("required") and p["name"] in QUERY_FILL
        }
        try:
            resp = await client.get(url, params=query, headers=headers)
        except Exception as exc:  # noqa: BLE001 — a crash is reported, not a leak
            errors.append(f"{path}: {type(exc).__name__}: {exc}")
            await db.rollback()
            continue
        bodies[path] = resp.text
    return bodies, errors


async def test_no_get_route_leaks_a_hidden_card(app, client, db, world):
    bodies, errors = await _sweep(app, client, db, world["reader"], world["ids"])
    leaks = sorted(
        path for path, body in bodies.items() if SENTINEL in body or world["sentinel_id"] in body
    )
    assert not leaks, f"Hidden card leaked by: {leaks}"
    assert not errors, errors

    # Control 1: a card of the hidden type held through a stakeholder role
    # granting card.view is still visible to the same reader.
    listing = await client.get(
        "/api/v1/cards", params={"type": "Secret"}, headers=auth_headers(world["reader"])
    )
    names = [c["name"] for c in listing.json()["items"]]
    assert names == [HELD]


async def test_the_sweep_is_not_vacuous(app, client, db, world):
    """As admin the sentinel shows up widely, so a clean restricted sweep means something."""
    bodies, _ = await _sweep(app, client, db, world["admin"], world["ids"])
    seen = [path for path, body in bodies.items() if SENTINEL in body]
    assert len(seen) >= 20, seen
