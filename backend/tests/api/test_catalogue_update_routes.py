"""Route-level tests for the reference catalogues' update and import endpoints.

The three catalogue routers share one shape (CLAUDE.md, *Never hold a database
session across work that is not database work*): ``update-status`` and
``update-fetch`` hand the request's connection back before the service talks
to PyPI, ``update-fetch`` commits the cache the service staged, and ``import``
commits the cards the service staged. The services are faked here — their own
suites cover what they do — so these tests pin what the routes add: the gate,
the commit path, the 502 mapping and the locale fallback. The *position* of
each commit is pinned by the source scans in
``tests/services/test_db_session_holding.py``.
"""

from __future__ import annotations

import importlib

import pytest

from tests.conftest import auth_headers, create_user

CATALOGUES = [
    pytest.param(
        "capability-catalogue",
        "app.services.capability_catalogue_service",
        "import_capabilities",
        id="capability",
    ),
    pytest.param(
        "process-catalogue",
        "app.services.process_catalogue_service",
        "import_processes",
        id="process",
    ),
    pytest.param(
        "value-stream-catalogue",
        "app.services.value_stream_catalogue_service",
        "import_value_streams",
        id="value-stream",
    ),
]

STATUS = {"active_version": "2.0.0", "active_source": "bundled", "update_available": False}
FETCHED = {"catalogue_version": "2.1.0", "node_count": 3}
IMPORTED = {
    "created": [],
    "skipped": [],
    "relinked": [],
    "failed": [],
    "catalogue_version": "2.0.0",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix, module_name, import_fn", CATALOGUES)
async def test_update_status_returns_the_service_answer_to_an_admin(
    client, db, admin_role, monkeypatch, prefix, module_name, import_fn
):
    svc = importlib.import_module(module_name)
    seen: list[object] = []

    async def fake_check(session):
        seen.append(session)
        return dict(STATUS)

    monkeypatch.setattr(svc, "check_remote_version", fake_check)
    admin = await create_user(db, email=f"{prefix}-status@test.com", role="admin")

    response = await client.get(f"/api/v1/{prefix}/update-status", headers=auth_headers(admin))

    assert response.status_code == 200, response.text
    assert response.json() == STATUS
    assert len(seen) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix, module_name, import_fn", CATALOGUES)
async def test_update_routes_need_admin_metamodel(
    client, db, member_role, monkeypatch, prefix, module_name, import_fn
):
    svc = importlib.import_module(module_name)

    async def never(session):
        raise AssertionError("the service must not run for a refused caller")

    monkeypatch.setattr(svc, "check_remote_version", never)
    monkeypatch.setattr(svc, "fetch_remote_catalogue", never)
    member = await create_user(db, email=f"{prefix}-member@test.com", role="member")
    headers = auth_headers(member)

    assert (await client.get(f"/api/v1/{prefix}/update-status", headers=headers)).status_code == 403
    assert (await client.post(f"/api/v1/{prefix}/update-fetch", headers=headers)).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix, module_name, import_fn", CATALOGUES)
async def test_update_fetch_returns_what_the_service_cached(
    client, db, admin_role, monkeypatch, prefix, module_name, import_fn
):
    svc = importlib.import_module(module_name)

    async def fake_fetch(session):
        return dict(FETCHED)

    monkeypatch.setattr(svc, "fetch_remote_catalogue", fake_fetch)
    admin = await create_user(db, email=f"{prefix}-fetch@test.com", role="admin")

    response = await client.post(f"/api/v1/{prefix}/update-fetch", headers=auth_headers(admin))

    assert response.status_code == 200, response.text
    assert response.json() == FETCHED


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix, module_name, import_fn", CATALOGUES)
async def test_update_fetch_maps_a_failed_download_to_502(
    client, db, admin_role, monkeypatch, prefix, module_name, import_fn
):
    svc = importlib.import_module(module_name)

    async def boom(session):
        raise RuntimeError("PyPI unreachable")

    monkeypatch.setattr(svc, "fetch_remote_catalogue", boom)
    admin = await create_user(db, email=f"{prefix}-boom@test.com", role="admin")

    response = await client.post(f"/api/v1/{prefix}/update-fetch", headers=auth_headers(admin))

    assert response.status_code == 502
    assert response.json()["detail"] == "Catalogue fetch failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix, module_name, import_fn", CATALOGUES)
async def test_import_passes_the_caller_selection_and_locale_to_the_service(
    client, db, admin_role, monkeypatch, prefix, module_name, import_fn
):
    svc = importlib.import_module(module_name)
    calls: list[tuple] = []

    async def fake_import(session, *, user, catalogue_ids, locale):
        calls.append((user.id, list(catalogue_ids), locale))
        return dict(IMPORTED)

    monkeypatch.setattr(svc, import_fn, fake_import)
    admin = await create_user(db, email=f"{prefix}-import@test.com", role="admin")
    headers = auth_headers(admin)

    first = await client.post(
        f"/api/v1/{prefix}/import",
        json={"catalogue_ids": ["X-1", "X-2"], "locale": "de"},
        headers=headers,
    )
    assert first.status_code == 200, first.text
    assert first.json() == IMPORTED

    # No locale in the body and none saved on the user: English.
    second = await client.post(
        f"/api/v1/{prefix}/import", json={"catalogue_ids": ["X-3"]}, headers=headers
    )
    assert second.status_code == 200, second.text

    assert calls == [(admin.id, ["X-1", "X-2"], "de"), (admin.id, ["X-3"], "en")]
