"""Guard: lifecycle phases a licensed extension maintains cannot be edited by hand.

An extension holding ``core.cards.maintain_lifecycle`` claims chosen phases of
a card (``cards.lifecycle_maintained``). While the claim is in force — the
extension enabled, loaded and licensed — the single and bulk PATCH routes
refuse a change to those phases with a 403 ``lifecycle_maintained``; manual
phases stay editable. Disabled, unlicensed or removed: the claim is ignored.
Uses an invented extension key and the in-memory registry seam.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

KEY = "acme-sync"
GRANTS = ["core.cards.write", "core.cards.maintain_lifecycle"]
MARKER = {"ext": KEY, "phases": ["active", "endOfLife"]}
LIFECYCLE = {"plan": "2018-01-01", "active": "2020-01-01", "endOfLife": "2030-01-01"}
PAYLOAD = {"ext": KEY, "name": "Acme Sync", "phases": ["active", "endOfLife"]}


def load(*, licensed: bool = True, grants: list[str] | None = None, **overrides) -> None:
    values = dict(
        key=KEY,
        name="Acme Sync",
        version="1.0.0",
        status="installed",
        enabled=True,
        manifest={"grants": GRANTS if grants is None else grants},
    )
    values.update(overrides)
    extension_registry.clear()
    extension_registry.load_installed([ExtensionInfo(**values)])
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=datetime.now(timezone.utc) - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)] if licensed else [],
        )
    )


@pytest.fixture(autouse=True)
def _registry(monkeypatch):
    extension_registry.clear()
    monkeypatch.setattr(extension_registry, "refresh_from_db", AsyncMock())
    yield
    extension_registry.clear()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(
        db, name="Locked", lifecycle=dict(LIFECYCLE), lifecycle_maintained=dict(MARKER)
    )
    free = await create_card(db, name="Free", lifecycle={"active": "2019-01-01"})
    await db.commit()
    return {"admin": admin, "card": card, "free": free}


async def _patch(client, env, card, body):
    return await client.patch(
        f"/api/v1/cards/{card.id}", headers=auth_headers(env["admin"]), json=body
    )


class TestSinglePatch:
    async def test_changing_a_maintained_phase_is_refused(self, client, db, env):
        load()
        resp = await _patch(
            client, env, env["card"], {"lifecycle": {**LIFECYCLE, "endOfLife": "2031-01-01"}}
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == {
            "error": "lifecycle_maintained",
            "message": (
                "These lifecycle dates are set automatically by the installed extension "
                "Acme Sync and cannot be edited by hand: End of Life."
            ),
            "phases": ["endOfLife"],
            "extension": "Acme Sync",
        }
        await db.refresh(env["card"])
        assert env["card"].lifecycle == LIFECYCLE

    async def test_changing_only_a_manual_phase_succeeds(self, client, db, env):
        load()
        resp = await _patch(
            client, env, env["card"], {"lifecycle": {**LIFECYCLE, "plan": "2017-01-01"}}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["lifecycle"] == {**LIFECYCLE, "plan": "2017-01-01"}
        assert body["lifecycle_maintained"] == PAYLOAD

    async def test_omitted_maintained_phases_are_carried_over(self, client, db, env):
        load()
        resp = await _patch(client, env, env["card"], {"lifecycle": {"plan": "2017-01-01"}})
        assert resp.status_code == 200, resp.text
        assert resp.json()["lifecycle"] == {**LIFECYCLE, "plan": "2017-01-01"}

    async def test_omitted_maintained_phases_keep_their_current_value_after_a_move(
        self, client, db, env
    ):
        # The client read the card, then the extension moved its dates. A save
        # that leaves the maintained phases out (what the card editor, the
        # Excel import and the MCP tool send) changes the manual phase and
        # keeps the maintained ones at their CURRENT stored values.
        load()
        moved = {**LIFECYCLE, "active": "2021-06-01", "endOfLife": "2032-01-01"}
        env["card"].lifecycle = dict(moved)
        await db.commit()
        resp = await _patch(client, env, env["card"], {"lifecycle": {"plan": "2017-01-01"}})
        assert resp.status_code == 200, resp.text
        assert resp.json()["lifecycle"] == {**moved, "plan": "2017-01-01"}
        await db.refresh(env["card"])
        assert env["card"].lifecycle == {**moved, "plan": "2017-01-01"}

    async def test_a_manual_date_breaking_the_order_is_clamped(self, client, db, env):
        load()
        resp = await _patch(
            client, env, env["card"], {"lifecycle": {**LIFECYCLE, "phaseOut": "2035-01-01"}}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["lifecycle"]["phaseOut"] == "2030-01-01"

    async def test_a_stale_echo_of_maintained_phases_passes(self, client, db, env):
        load()
        resp = await _patch(
            client,
            env,
            env["card"],
            {"lifecycle": dict(LIFECYCLE), "description": "edited"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["description"] == "edited"
        assert resp.json()["lifecycle"] == LIFECYCLE

    @pytest.mark.parametrize(
        "overrides",
        [
            {"enabled": False},
            {"status": "removed"},
            {"licensed": False},
            {"grants": ["core.cards.write"]},
        ],
        ids=["disabled", "removed", "unlicensed", "no-grant"],
    )
    async def test_the_lock_is_ignored_when_not_in_force(self, client, db, env, overrides):
        load(**overrides)
        resp = await _patch(
            client, env, env["card"], {"lifecycle": {**LIFECYCLE, "endOfLife": "2031-01-01"}}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["lifecycle"]["endOfLife"] == "2031-01-01"
        assert resp.json()["lifecycle_maintained"] is None

    async def test_the_lock_is_ignored_when_the_extension_is_gone(self, client, db, env):
        extension_registry.clear()
        resp = await _patch(
            client, env, env["card"], {"lifecycle": {**LIFECYCLE, "active": "2021-01-01"}}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["lifecycle"]["active"] == "2021-01-01"

    async def test_a_body_cannot_set_or_clear_the_claim(self, client, db, env):
        load()
        resp = await _patch(
            client,
            env,
            env["free"],
            {"lifecycle_maintained": {"ext": KEY, "phases": ["active"]}, "name": "Free 2"},
        )
        assert resp.status_code == 200, resp.text
        await db.refresh(env["free"])
        assert env["free"].lifecycle_maintained is None
        resp = await _patch(
            client, env, env["card"], {"lifecycle_maintained": None, "name": "Locked 2"}
        )
        assert resp.status_code == 200, resp.text
        await db.refresh(env["card"])
        assert env["card"].lifecycle_maintained == MARKER


class TestPayload:
    async def test_get_carries_the_claim_only_while_in_force(self, client, db, env):
        load()
        headers = auth_headers(env["admin"])
        resp = await client.get(f"/api/v1/cards/{env['card'].id}", headers=headers)
        assert resp.json()["lifecycle_maintained"] == PAYLOAD
        resp = await client.get(f"/api/v1/cards/{env['free'].id}", headers=headers)
        assert resp.json()["lifecycle_maintained"] is None
        load(enabled=False)
        resp = await client.get(f"/api/v1/cards/{env['card'].id}", headers=headers)
        assert resp.json()["lifecycle_maintained"] is None

    async def test_list_rows_carry_the_claim(self, client, db, env):
        load()
        resp = await client.get(
            "/api/v1/cards?type=Application", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        by_name = {row["name"]: row for row in resp.json()["items"]}
        assert by_name["Locked"]["lifecycle_maintained"] == PAYLOAD
        assert by_name["Free"]["lifecycle_maintained"] is None

    async def test_by_ids_rows_carry_the_claim_only_while_in_force(self, client, db, env):
        ids = f"{env['card'].id},{env['free'].id}"
        headers = auth_headers(env["admin"])
        load()
        resp = await client.get(f"/api/v1/cards?ids={ids}", headers=headers)
        assert resp.status_code == 200, resp.text
        by_name = {row["name"]: row["lifecycle_maintained"] for row in resp.json()["items"]}
        assert by_name == {"Locked": PAYLOAD, "Free": None}
        load(licensed=False)
        resp = await client.get(f"/api/v1/cards?ids={ids}", headers=headers)
        by_name = {row["name"]: row["lifecycle_maintained"] for row in resp.json()["items"]}
        assert by_name == {"Locked": None, "Free": None}

    async def test_a_list_resolves_each_owner_once(self, client, db, env, monkeypatch):
        for i in range(3):
            await create_card(db, name=f"Locked {i}", lifecycle_maintained=dict(MARKER))
        await db.commit()
        load()
        calls: list[str] = []
        original = extension_registry.grants_for

        def counting(key, now=None):
            calls.append(key)
            return original(key, now=now)

        monkeypatch.setattr(extension_registry, "grants_for", counting)
        resp = await client.get(
            "/api/v1/cards?type=Application", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        claimed = [r for r in resp.json()["items"] if r["lifecycle_maintained"]]
        assert len(claimed) == 4
        assert calls.count(KEY) == 1

    @pytest.mark.parametrize("route", ["my-created", "bulk"])
    async def test_every_row_of_a_response_shares_one_lock_cache(
        self, client, db, env, monkeypatch, route
    ):
        from app.api.v1 import cards as cards_api

        for i in range(3):
            await create_card(
                db,
                name=f"Mine {i}",
                lifecycle_maintained=dict(MARKER),
                user_id=env["admin"].id,
            )
        await db.commit()
        load()
        caches: list[int] = []
        original = cards_api._card_to_response

        def recording(card, **kwargs):
            caches.append(id(kwargs.get("lock_cache")))
            return original(card, **kwargs)

        monkeypatch.setattr(cards_api, "_card_to_response", recording)
        headers = auth_headers(env["admin"])
        if route == "my-created":
            resp = await client.get("/api/v1/cards/my-created", headers=headers)
        else:
            ids = [str(c.id) for c in (env["card"], env["free"])]
            resp = await client.patch(
                "/api/v1/cards/bulk",
                headers=headers,
                json={"ids": ids, "updates": {"description": "bulk"}},
            )
        assert resp.status_code == 200, resp.text
        assert len(caches) >= 2
        assert len(set(caches)) == 1


class TestBulkPatch:
    async def test_a_shared_change_to_a_maintained_phase_refuses_the_whole_call(
        self, client, db, env
    ):
        load()
        for dry_run in (True, False):
            resp = await client.patch(
                "/api/v1/cards/bulk",
                headers=auth_headers(env["admin"]),
                json={
                    "ids": [str(env["card"].id), str(env["free"].id)],
                    "updates": {"lifecycle": {"active": "2022-01-01"}},
                    "dry_run": dry_run,
                },
            )
            assert resp.status_code == 403, resp.text
            detail = resp.json()["detail"]
            assert detail["error"] == "lifecycle_maintained"
            assert detail["phases"] == ["active"]
            assert detail["cards"] == [str(env["card"].id)]
            assert detail["extension"] == "Acme Sync"
        await db.refresh(env["free"])
        assert env["free"].lifecycle == {"active": "2019-01-01"}

    async def test_a_shared_change_to_manual_phases_carries_the_maintained_ones(
        self, client, db, env
    ):
        load()
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(env["admin"]),
            json={
                "ids": [str(env["card"].id), str(env["free"].id)],
                "updates": {"lifecycle": {"plan": "2017-01-01"}},
            },
        )
        assert resp.status_code == 200, resp.text
        rows = {row["name"]: row for row in resp.json()}
        assert rows["Locked"]["lifecycle"] == {**LIFECYCLE, "plan": "2017-01-01"}
        assert rows["Free"]["lifecycle"] == {"plan": "2017-01-01"}

    async def test_the_lock_is_ignored_when_unlicensed(self, client, db, env):
        load(licensed=False)
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(env["admin"]),
            json={"ids": [str(env["card"].id)], "updates": {"lifecycle": {"active": "2022-01-01"}}},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()[0]["lifecycle"] == {"active": "2022-01-01"}

    async def test_bulk_body_cannot_set_the_claim(self, client, db, env):
        load()
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=auth_headers(env["admin"]),
            json={
                "ids": [str(env["free"].id)],
                "updates": {"name": "Free 3", "lifecycle_maintained": MARKER},
            },
        )
        assert resp.status_code == 200, resp.text
        await db.refresh(env["free"])
        assert env["free"].lifecycle_maintained is None


class TestPermissions:
    async def test_a_viewer_cannot_patch_a_maintained_card(self, client, db, env):
        load()
        await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        resp = await client.patch(
            f"/api/v1/cards/{env['card'].id}",
            headers=auth_headers(viewer),
            json={"lifecycle": {"plan": "2017-01-01"}},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not enough permissions"
