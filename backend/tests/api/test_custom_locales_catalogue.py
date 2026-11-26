"""``/custom-locales/catalogue``: the community language library.

The library is ``tests/language_library.FakeLibrary`` — no request leaves the
test. The service's own rules (URLs, index, pack, merge) are tested in
``tests/services/test_language_catalogue.py``; here: permissions, the
configured URL, status codes and what lands in the database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.config import settings as app_config
from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from app.models.custom_locale import CustomLocale
from app.services import language_catalogue as lc
from tests.conftest import auth_headers, create_role, create_user
from tests.language_library import (
    INDEX_URL,
    FakeLibrary,
    make_entry,
    make_index,
    make_pack,
    pack_bytes,
    pack_url_for,
)

BASE = "/api/v1/custom-locales/catalogue"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


@pytest.fixture
def library(monkeypatch, db) -> FakeLibrary:
    lib = FakeLibrary().install(monkeypatch)
    lib.count_sessions(monkeypatch, db)
    monkeypatch.setattr(app_config, "LANGUAGE_CATALOGUE_URL", INDEX_URL)
    return lib


async def _list(client, user, **params):
    return await client.get(BASE, params=params, headers=auth_headers(user))


async def _install(client, user, code="nl", **body):
    return await client.post(f"{BASE}/{code}/install", json=body, headers=auth_headers(user))


class TestPermissions:
    async def test_a_viewer_can_neither_list_nor_install(self, client, env, library):
        library.publish(make_pack())
        assert (await _list(client, env["viewer"])).status_code == 403
        assert (await _install(client, env["viewer"])).status_code == 403
        assert library.requested == []

    async def test_anonymous(self, client, library):
        assert (await client.get(BASE)).status_code == 401
        assert (await client.post(f"{BASE}/nl/install", json={})).status_code == 401


class TestList:
    async def test_the_library_is_listed(self, client, env, library):
        library.publish(make_pack(), make_pack("fy"))
        resp = await _list(client, env["admin"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["enabled"] is True and body["error"] is None
        assert body["url"] == INDEX_URL
        assert [(e["code"], e["installed"]) for e in body["languages"]] == [
            ("nl", False),
            ("fy", False),
        ]
        assert "path" not in body["languages"][0]

    async def test_not_shadowed_by_the_language_route(self, client, env, library):
        """``/catalogue`` is registered before ``/{code}``: it is never read as
        a language called "catalogue"."""
        library.publish()
        resp = await _list(client, env["admin"])
        assert resp.status_code == 200
        assert resp.json()["languages"] == []

    async def test_refresh(self, client, env, library):
        library.publish(make_pack())
        await _list(client, env["admin"])
        await _list(client, env["admin"])
        assert library.requested == [INDEX_URL]
        await _list(client, env["admin"], refresh="true")
        assert library.requested == [INDEX_URL, INDEX_URL]

    async def test_an_unreachable_library_is_reported(self, client, env, library):
        resp = await _list(client, env["admin"])
        assert resp.status_code == 200
        assert resp.json()["error"] == lc.UNREACHABLE
        assert resp.json()["languages"] == []

    async def test_off(self, client, env, library, monkeypatch):
        monkeypatch.setattr(app_config, "LANGUAGE_CATALOGUE_URL", "")
        body = (await _list(client, env["admin"], refresh="true")).json()
        assert body["enabled"] is False
        assert library.requested == []
        assert (await _install(client, env["admin"])).json()["detail"] == lc.DISABLED

    def test_the_default_is_the_community_library(self):
        from app.config import DEFAULT_LANGUAGE_CATALOGUE_URL

        assert DEFAULT_LANGUAGE_CATALOGUE_URL == INDEX_URL


class TestInstall:
    async def test_install_then_update(self, client, env, db, library):
        library.publish(make_pack())
        await _list(client, env["admin"])
        resp = await _install(client, env["admin"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["created"], body["applied"], body["kept_manual"]) == (True, 1, 0)
        assert body["locale"]["code"] == "nl"
        assert body["locale"]["enabled"] is False
        assert body["locale"]["source"] == "community"

        listed = (await _list(client, env["admin"])).json()["languages"]
        assert (listed[0]["installed"], listed[0]["update_available"]) == (True, False)

        library.publish(
            make_pack(
                strings={"common": {"actions.save": "Opslaan", "actions.delete": "Verwijderen"}},
                hashes={"common": {}},
            )
        )
        listed = (await _list(client, env["admin"], refresh="true")).json()["languages"]
        assert listed[0]["update_available"] is True
        again = (await _install(client, env["admin"], overwrite_manual=False)).json()
        assert (again["created"], again["applied"], again["unchanged"]) == (False, 1, 1)
        actions = (
            await db.execute(
                select(AuditLogEntry.action).where(
                    AuditLogEntry.action == "admin.custom_locale.community_installed"
                )
            )
        ).all()
        assert len(actions) == 2

    async def test_a_language_not_listed(self, client, env, library):
        library.publish(make_pack())
        await _list(client, env["admin"])
        for code in ("fy", "de", "catalogue", "NL"):
            resp = await _install(client, env["admin"], code)
            assert (resp.status_code, resp.json()["detail"]) == (404, lc.NOT_LISTED), code

    async def test_a_tampered_pack(self, client, env, db, library):
        library.publish(make_pack())
        await _list(client, env["admin"])
        library.serve(pack_url_for(), pack_bytes(make_pack(strings={"common": {}})))
        resp = await _install(client, env["admin"])
        assert (resp.status_code, resp.json()["detail"]) == (502, lc.PACK_CHECKSUM)
        assert (await db.execute(select(CustomLocale))).first() is None

    async def test_a_pack_of_another_language(self, client, env, library):
        data = pack_bytes(make_pack("fy"))
        library.serve(pack_url_for(), data)
        library.serve(INDEX_URL, make_index(make_entry("nl", data)))
        await _list(client, env["admin"])
        resp = await _install(client, env["admin"])
        assert (resp.status_code, resp.json()["detail"]) == (422, lc.PACK_CODE_MISMATCH)

    async def test_an_unreachable_pack(self, client, env, library):
        library.publish(make_pack())
        await _list(client, env["admin"])
        library.serve(pack_url_for(), b"", status=500)
        resp = await _install(client, env["admin"])
        assert (resp.status_code, resp.json()["detail"]) == (502, lc.PACK_UNREACHABLE)

    async def test_a_bad_body(self, client, env, library):
        resp = await client.post(
            f"{BASE}/nl/install",
            json={"overwrite_manual": "maybe"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422

    def test_every_error_has_a_status(self):
        codes = {
            lc.DISABLED,
            lc.NOT_LISTED,
            lc.PACK_UNREACHABLE,
            lc.PACK_TOO_LARGE,
            lc.PACK_CHECKSUM,
            lc.PACK_INVALID,
            lc.PACK_CODE_MISMATCH,
            lc.CATALOG_UNAVAILABLE,
            lc.LOCALE_EXISTS,
        }
        assert set(lc.STATUS) == codes
        assert lc.STATUS[lc.PACK_CHECKSUM] == 502
        assert lc.STATUS[lc.LOCALE_EXISTS] == 409
