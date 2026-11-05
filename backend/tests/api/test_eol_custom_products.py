"""Custom EOL products: the organisation's own end-of-life data for products
endoflife.date does not track, linked from cards as ``custom:<key>``.

Covers the catalogue routes (``/eol/custom-products``), how custom products
join the existing EOL surfaces (product search, cycles, card status, mass
search/link, the EOL report) without ever reaching the upstream proxy, and
the switch that moves a custom product's cards onto endoflife.date.
"""

from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.audit_log import AuditLogEntry
from app.models.card import Card
from app.models.eol_custom_cycle import EolCustomCycle
from app.models.eol_custom_product import EolCustomProduct
from app.models.event import Event
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

BASE = "/api/v1/eol/custom-products"
TODAY = date.today()
PAST = (TODAY - timedelta(days=400)).isoformat()
LONG_AGO = (TODAY - timedelta(days=2000)).isoformat()
FUTURE = (TODAY + timedelta(days=1000)).isoformat()
UPSTREAM = ["python", "nodejs", "postgresql"]


def _no_upstream():
    """Fail the test if anything reaches endoflife.date."""
    return patch(
        "app.api.v1.eol._get_client", AsyncMock(side_effect=AssertionError("upstream called"))
    )


@pytest.fixture
async def admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return await create_user(db, email="admin@test.com", role="admin")


@pytest.fixture
async def viewer(db):
    await create_role(db, key="viewer", label="Viewer", permissions={"eol.view": True})
    return await create_user(db, email="viewer@test.com", role="viewer")


@pytest.fixture
async def itc_type(db):
    return await create_card_type(db, key="ITComponent", label="IT Component")


@pytest.fixture
async def acme(client, admin):
    """``acme-erp`` with an ended cycle "1" and a supported cycle "2"."""
    resp = await client.post(
        BASE,
        json={
            "key": "acme-erp",
            "title": "Acme ERP",
            "link": "https://acme.example/erp",
            "cycles": [
                {"cycle": "1", "releaseDate": LONG_AGO, "eol": PAST, "latest": "1.4"},
                {"cycle": "2", "releaseDate": PAST, "eol": False, "support": FUTURE},
            ],
        },
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _link(db, name: str, product: str, cycle: str, **kwargs) -> Card:
    return await create_card(
        db,
        card_type="ITComponent",
        name=name,
        attributes={"eol_product": product, "eol_cycle": cycle},
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Catalogue CRUD
# ---------------------------------------------------------------------------


class TestCreate:
    async def test_creates_product_with_cycles(self, client, admin, acme, db):
        assert acme["key"] == "acme-erp"
        assert acme["product"] == "custom:acme-erp"
        assert acme["title"] == "Acme ERP"
        assert acme["linked_cards"] == 0
        # Newest release first, in endoflife.date's field names.
        assert [c["cycle"] for c in acme["cycles"]] == ["2", "1"]
        assert acme["cycles"][1]["releaseDate"] == LONG_AGO
        assert acme["cycles"][1]["eol"] == PAST
        assert acme["cycles"][0]["eol"] is False
        assert acme["cycles"][0]["support"] == FUTURE

        audit = (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == "admin.eol_custom_product.created"
                )
            )
        ).scalar_one()
        assert audit.target_label == "Acme ERP"

    async def test_key_is_generated_from_the_title(self, client, admin):
        """Nobody types the key: it comes from the title, and a second product
        with the same title gets a numbered one."""
        first = await client.post(BASE, json={"title": " Macos X "}, headers=auth_headers(admin))
        assert first.status_code == 201, first.text
        assert (first.json()["key"], first.json()["title"]) == ("macos-x", "Macos X")
        second = await client.post(BASE, json={"title": "Macos X"}, headers=auth_headers(admin))
        assert second.status_code == 201
        assert second.json()["key"] == "macos-x-2"
        third = await client.post(BASE, json={"title": "macos x"}, headers=auth_headers(admin))
        assert third.json()["key"] == "macos-x-3"
        # A title with nothing usable still gets a key.
        bare = await client.post(BASE, json={"title": "🚀"}, headers=auth_headers(admin))
        assert bare.status_code == 201
        assert bare.json()["key"] == "product"
        # An explicit key (the API, a workspace import) is kept, and refused when taken.
        given = await client.post(
            BASE, json={"key": "given", "title": "Macos X"}, headers=auth_headers(admin)
        )
        assert given.json()["key"] == "given"
        dup = await client.post(
            BASE, json={"key": "given", "title": "Other"}, headers=auth_headers(admin)
        )
        assert dup.status_code == 409

    async def test_viewer_cannot_create_but_can_list(self, client, viewer, admin, acme):
        resp = await client.post(
            BASE, json={"key": "x", "title": "X"}, headers=auth_headers(viewer)
        )
        assert resp.status_code == 403
        listed = await client.get(BASE, headers=auth_headers(viewer))
        assert listed.status_code == 200
        assert [p["key"] for p in listed.json()] == ["acme-erp"]

    @pytest.mark.parametrize(
        "body",
        [
            {"key": "Acme ERP", "title": "Acme"},
            {"key": "acme", "title": "  "},
            {"key": "acme", "title": "A", "link": "javascript:alert(1)"},
            {"key": "acme", "title": "A", "cycles": [{"cycle": "1"}, {"cycle": "1"}]},
            {"key": "acme", "title": "A", "cycles": [{"cycle": "1", "eol": "2026-13-01"}]},
            {"key": "acme", "title": "A", "cycles": [{"cycle": "1", "eol": "soon"}]},
            {
                "key": "acme",
                "title": "A",
                "cycles": [{"cycle": "1", "releaseDate": "2024-01-01", "eol": "2023-01-01"}],
            },
            {"key": "acme", "title": "A", "cycles": [{"cycle": " "}]},
            # endoflife.date requires an end of life on every release.
            {"key": "acme", "title": "A", "cycles": [{"cycle": "1"}]},
            {"key": "acme", "title": "A", "cycles": [{"cycle": "1", "eol": None}]},
            {"key": "acme", "title": "A", "cycles": [{"cycle": "1", "eol": ""}]},
            {"key": "acme", "title": "A", "eol_category": "toaster"},
            {"key": "acme", "title": "A", "release_policy_note": "x" * 5001},
        ],
    )
    async def test_rejects_invalid_input(self, client, admin, body):
        resp = await client.post(BASE, json=body, headers=auth_headers(admin))
        assert resp.status_code == 422, body

    async def test_a_cycle_without_an_end_of_life_is_told_why(self, client, admin):
        resp = await client.post(
            BASE,
            json={"title": "A", "cycles": [{"cycle": "1", "eol": None}]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422
        assert "end of life is required" in str(resp.json()["detail"])

    async def test_creates_product_with_the_proposal_fields(self, client, admin):
        resp = await client.post(
            BASE,
            json={
                "title": "Acme MES",
                "eol_category": "server-app",
                "release_policy_note": "  Each release is supported for two years.  ",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert (body["eol_category"], body["release_policy_note"]) == (
            "server-app",
            "Each release is supported for two years.",
        )

    async def test_duplicate_key_is_409(self, client, admin, acme):
        resp = await client.post(
            BASE, json={"key": "acme-erp", "title": "Again"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 409


class TestUpdateProduct:
    async def test_edits_title_and_never_the_key(self, client, admin, acme, db):
        resp = await client.patch(
            f"{BASE}/acme-erp",
            json={"title": "Acme ERP Suite", "key": "renamed", "link": None},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert (body["key"], body["title"], body["link"]) == ("acme-erp", "Acme ERP Suite", None)
        audit = (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == "admin.eol_custom_product.updated"
                )
            )
        ).scalar_one()
        assert audit.details["changes"]["title"] == {"old": "Acme ERP", "new": "Acme ERP Suite"}

    async def test_unknown_product_is_404(self, client, admin):
        resp = await client.patch(f"{BASE}/nope", json={"title": "X"}, headers=auth_headers(admin))
        assert resp.status_code == 404

    async def test_proposal_fields_round_trip_and_clear(self, client, admin, acme):
        assert (acme["eol_category"], acme["release_policy_note"]) == (None, None)
        resp = await client.patch(
            f"{BASE}/acme-erp",
            json={"eol_category": "app", "release_policy_note": "Two years per release."},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        assert (resp.json()["eol_category"], resp.json()["release_policy_note"]) == (
            "app",
            "Two years per release.",
        )
        listed = await client.get(BASE, headers=auth_headers(admin))
        assert listed.json()[0]["eol_category"] == "app"
        assert listed.json()[0]["release_policy_note"] == "Two years per release."
        cleared = await client.patch(
            f"{BASE}/acme-erp", json={"eol_category": None}, headers=auth_headers(admin)
        )
        assert cleared.status_code == 200
        assert cleared.json()["eol_category"] is None
        assert cleared.json()["release_policy_note"] == "Two years per release."
        bad = await client.patch(
            f"{BASE}/acme-erp", json={"eol_category": "toaster"}, headers=auth_headers(admin)
        )
        assert bad.status_code == 422

    async def test_viewer_cannot_edit(self, client, viewer, acme):
        resp = await client.patch(
            f"{BASE}/acme-erp", json={"title": "X"}, headers=auth_headers(viewer)
        )
        assert resp.status_code == 403


class TestDeleteProduct:
    async def test_refused_while_linked_then_deleted(self, client, admin, acme, db, itc_type):
        card = await _link(db, "ERP host", "custom:acme-erp", "1")
        resp = await client.delete(f"{BASE}/acme-erp", headers=auth_headers(admin))
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "cards_linked"
        assert resp.json()["detail"]["count"] == 1

        card.attributes = {}
        await db.flush()
        resp = await client.delete(f"{BASE}/acme-erp", headers=auth_headers(admin))
        assert resp.status_code == 204
        assert (await db.execute(select(EolCustomProduct))).scalars().all() == []
        assert (await db.execute(select(EolCustomCycle))).scalars().all() == []

    async def test_hidden_card_blocks_delete_without_being_counted(self, client, db, acme, admin):
        await create_card_type(
            db,
            key="ITComponent",
            label="IT Component",
            role_permissions={"restricted": {"inventory.view": False}},
        )
        await create_role(
            db,
            key="restricted",
            label="Restricted",
            permissions={"eol.view": True, "eol.manage": True, "inventory.view": True},
        )
        restricted = await create_user(db, email="r@test.com", role="restricted")
        await _link(db, "Secret host", "custom:acme-erp", "1")

        resp = await client.delete(f"{BASE}/acme-erp", headers=auth_headers(restricted))
        assert resp.status_code == 409
        assert resp.json()["detail"]["count"] == 0
        listed = await client.get(BASE, headers=auth_headers(restricted))
        assert listed.json()[0]["linked_cards"] == 0
        assert "Secret host" not in listed.text
        # The admin sees the card in the count.
        listed = await client.get(BASE, headers=auth_headers(admin))
        assert listed.json()[0]["linked_cards"] == 1
        assert listed.json()[0]["cycles"][1]["linked_cards"] == 1


# ---------------------------------------------------------------------------
# Cycles
# ---------------------------------------------------------------------------


def _cycle(product: dict, name: str) -> dict:
    return next(c for c in product["cycles"] if c["cycle"] == name)


def _cycle_id(product: dict, name: str) -> str:
    return next(c["id"] for c in product["cycles"] if c["cycle"] == name)


class TestCycles:
    async def test_add_cycle_and_duplicate(self, client, admin, acme):
        resp = await client.post(
            f"{BASE}/acme-erp/cycles",
            json={"cycle": "3", "releaseDate": FUTURE, "eol": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["cycle"] == "3"
        assert resp.json()["eol"] is True
        dup = await client.post(
            f"{BASE}/acme-erp/cycles",
            json={"cycle": "3", "eol": False},
            headers=auth_headers(admin),
        )
        assert dup.status_code == 409

    async def test_a_cycle_needs_an_end_of_life(self, client, admin, acme):
        for body in ({"cycle": "3"}, {"cycle": "3", "eol": None}, {"cycle": "3", "eol": ""}):
            resp = await client.post(
                f"{BASE}/acme-erp/cycles", json=body, headers=auth_headers(admin)
            )
            assert resp.status_code == 422, body
        assert "end of life is required" in str(resp.json()["detail"])

    async def test_viewer_cannot_add_cycle(self, client, viewer, acme):
        resp = await client.post(
            f"{BASE}/acme-erp/cycles",
            json={"cycle": "3", "eol": False},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_patch_one_field_keeps_the_rest(self, client, admin, acme):
        cid = _cycle_id(acme, "1")
        resp = await client.patch(
            f"{BASE}/acme-erp/cycles/{cid}",
            json={"latest": "1.5"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert (body["latest"], body["eol"], body["releaseDate"]) == ("1.5", PAST, LONG_AGO)

    async def test_patch_cannot_clear_the_end_of_life(self, client, admin, acme):
        cid = _cycle_id(acme, "1")
        for body in ({"eol": None}, {"eol": ""}):
            resp = await client.patch(
                f"{BASE}/acme-erp/cycles/{cid}", json=body, headers=auth_headers(admin)
            )
            assert resp.status_code == 422, body
            assert "end of life is required" in str(resp.json()["detail"])
        kept = await client.get(BASE, headers=auth_headers(admin))
        assert _cycle(kept.json()[0], "1")["eol"] == PAST

    async def test_a_legacy_cycle_without_an_end_of_life_gets_one_on_edit(
        self, client, admin, acme, db
    ):
        """A row from before the rule can still be edited — with an end of life."""
        from app.models.eol_custom_cycle import EolCustomCycle

        legacy = EolCustomCycle(product_key="acme-erp", cycle="0", eol=None)
        db.add(legacy)
        await db.flush()
        await db.commit()
        url = f"{BASE}/acme-erp/cycles/{legacy.id}"
        refused = await client.patch(url, json={"latest": "0.9"}, headers=auth_headers(admin))
        assert refused.status_code == 422
        assert "end of life is required" in str(refused.json()["detail"])
        fixed = await client.patch(
            url, json={"latest": "0.9", "eol": False}, headers=auth_headers(admin)
        )
        assert fixed.status_code == 200, fixed.text
        assert (fixed.json()["latest"], fixed.json()["eol"]) == ("0.9", False)

    async def test_patch_cannot_put_eol_before_release(self, client, admin, acme):
        cid = _cycle_id(acme, "1")
        resp = await client.patch(
            f"{BASE}/acme-erp/cycles/{cid}",
            json={"eol": "2000-01-01"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422
        assert "release date" in resp.json()["detail"]

    async def test_patch_rename_moves_linked_cards(self, client, admin, acme, db, itc_type):
        card = await create_card(
            db,
            card_type="ITComponent",
            name="ERP host",
            attributes={"eol_product": "custom:acme-erp", "eol_cycle": "1", "vendor": "Acme"},
            lifecycle={"active": PAST},
        )
        await _link(db, "Other", "custom:acme-erp", "2")
        cid = _cycle_id(acme, "1")
        resp = await client.patch(
            f"{BASE}/acme-erp/cycles/{cid}", json={"cycle": "1.0"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        await db.refresh(card)
        moved = {"eol_product": "custom:acme-erp", "eol_cycle": "1.0", "vendor": "Acme"}
        assert card.attributes == moved
        assert card.lifecycle == {"active": PAST}
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert [e.data["source"] for e in events] == ["eol_custom_rename"]
        # History reads the whole attribute dict on both sides.
        assert events[0].data["changes"]["attributes"] == {
            "old": {"eol_product": "custom:acme-erp", "eol_cycle": "1", "vendor": "Acme"},
            "new": moved,
        }

    async def test_rename_onto_existing_cycle_is_409(self, client, admin, acme):
        cid = _cycle_id(acme, "1")
        resp = await client.patch(
            f"{BASE}/acme-erp/cycles/{cid}", json={"cycle": "2"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 409

    async def test_cycle_of_another_product_is_404(self, client, admin, acme):
        other = await client.post(
            BASE, json={"key": "b", "title": "B"}, headers=auth_headers(admin)
        )
        assert other.status_code == 201
        cid = _cycle_id(acme, "1")
        for path in (f"{BASE}/b/cycles/{cid}", f"{BASE}/acme-erp/cycles/not-a-uuid"):
            resp = await client.patch(path, json={"latest": "x"}, headers=auth_headers(admin))
            assert resp.status_code == 404, path

    async def test_delete_linked_cycle_is_refused(self, client, admin, acme, db, itc_type):
        await _link(db, "ERP host", "custom:acme-erp", "1")
        cid = _cycle_id(acme, "1")
        resp = await client.delete(f"{BASE}/acme-erp/cycles/{cid}", headers=auth_headers(admin))
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "cards_linked"
        assert resp.json()["detail"]["count"] == 1
        listed = (await client.get(BASE, headers=auth_headers(admin))).json()
        assert [c["cycle"] for c in listed[0]["cycles"]] == ["2", "1"]

    async def test_delete_unlinked_cycle(self, client, admin, acme, db, itc_type):
        await _link(db, "ERP host", "custom:acme-erp", "1")
        cid = _cycle_id(acme, "2")
        resp = await client.delete(f"{BASE}/acme-erp/cycles/{cid}", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        listed = (await client.get(BASE, headers=auth_headers(admin))).json()
        assert [c["cycle"] for c in listed[0]["cycles"]] == ["1"]
        entry = (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == "admin.eol_custom_cycle.deleted"
                )
            )
        ).scalar_one()
        assert entry.details["context"] == {"cycle": "2"}

    async def test_viewer_cannot_delete_cycle(self, client, viewer, acme):
        cid = _cycle_id(acme, "2")
        resp = await client.delete(f"{BASE}/acme-erp/cycles/{cid}", headers=auth_headers(viewer))
        assert resp.status_code == 403

    async def test_hidden_card_blocks_cycle_delete_without_being_counted(
        self, client, admin, acme, db
    ):
        await create_card_type(
            db,
            key="ITComponent",
            label="IT Component",
            role_permissions={"restricted": {"inventory.view": False}},
        )
        await create_role(
            db,
            key="restricted",
            label="Restricted",
            permissions={"eol.view": True, "eol.manage": True, "inventory.view": True},
        )
        restricted = await create_user(db, email="r@test.com", role="restricted")
        await _link(db, "Secret host", "custom:acme-erp", "1")
        cid = _cycle_id(acme, "1")
        resp = await client.delete(
            f"{BASE}/acme-erp/cycles/{cid}", headers=auth_headers(restricted)
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["count"] == 0
        assert "Secret host" not in resp.text

    async def test_a_link_without_cycle_counts_against_the_product(
        self, client, admin, acme, db, itc_type
    ):
        await create_card(
            db,
            card_type="ITComponent",
            name="Half-linked",
            attributes={"eol_product": "custom:acme-erp"},
        )
        listed = (await client.get(BASE, headers=auth_headers(admin))).json()
        assert listed[0]["linked_cards"] == 1
        assert [c["linked_cards"] for c in listed[0]["cycles"]] == [0, 0]
        resp = await client.delete(f"{BASE}/acme-erp", headers=auth_headers(admin))
        assert resp.status_code == 409
        assert resp.json()["detail"]["count"] == 1

    async def test_patch_accepts_any_spelling_of_the_cycle_id(self, client, admin, acme):
        cid = _cycle_id(acme, "1").upper()
        resp = await client.patch(
            f"{BASE}/acme-erp/cycles/{cid}", json={"latest": "1.6"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["latest"] == "1.6"

    async def test_sort_order_change_is_audited(self, client, admin, acme, db):
        cid = _cycle_id(acme, "1")
        resp = await client.patch(
            f"{BASE}/acme-erp/cycles/{cid}", json={"sort_order": 3}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert resp.json()["sort_order"] == 3
        entry = (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == "admin.eol_custom_cycle.updated"
                )
            )
        ).scalar_one()
        assert entry.details["changes"] == {"sort_order": {"old": 0, "new": 3}}


# ---------------------------------------------------------------------------
# Custom products inside the existing EOL surfaces
# ---------------------------------------------------------------------------


@patch("app.api.v1.eol._products_cache", UPSTREAM)
@patch("app.api.v1.eol._products_cache_time", 9999999999.0)
class TestSearch:
    async def test_product_list_puts_custom_first(self, client, admin, acme):
        resp = await client.get("/api/v1/eol/products?search=", headers=auth_headers(admin))
        assert resp.status_code == 200
        first = resp.json()[0]
        assert first == {"name": "custom:acme-erp", "title": "Acme ERP", "custom": True}
        assert {"name": "python", "title": None, "custom": False} in resp.json()

    async def test_product_search_matches_title(self, client, admin, acme):
        resp = await client.get("/api/v1/eol/products?search=acme", headers=auth_headers(admin))
        assert [p["name"] for p in resp.json()] == ["custom:acme-erp"]

    async def test_fuzzy_includes_custom(self, client, admin, acme):
        resp = await client.get(
            "/api/v1/eol/products/fuzzy?search=Acme ERP", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        top = resp.json()[0]
        assert (top["name"], top["custom"], top["title"], top["score"]) == (
            "custom:acme-erp",
            True,
            "Acme ERP",
            1.0,
        )


class TestSearchWhenUpstreamIsDown:
    async def test_custom_products_still_answer(self, client, admin, acme):
        down = AsyncMock(side_effect=HTTPException(502, "endoflife.date API is unavailable"))
        with patch("app.api.v1.eol._get_all_products", down):
            listed = await client.get(
                "/api/v1/eol/products?search=acme", headers=auth_headers(admin)
            )
            fuzzy = await client.get(
                "/api/v1/eol/products/fuzzy?search=acme", headers=auth_headers(admin)
            )
        assert [p["name"] for p in listed.json()] == ["custom:acme-erp"]
        assert [p["name"] for p in fuzzy.json()] == ["custom:acme-erp"]

    async def test_no_custom_match_keeps_the_502(self, client, admin):
        down = AsyncMock(side_effect=HTTPException(502, "endoflife.date API is unavailable"))
        with patch("app.api.v1.eol._get_all_products", down):
            listed = await client.get("/api/v1/eol/products?search=zz", headers=auth_headers(admin))
            fuzzy = await client.get(
                "/api/v1/eol/products/fuzzy?search=zz", headers=auth_headers(admin)
            )
        assert (listed.status_code, fuzzy.status_code) == (502, 502)


class TestCustomCycles:
    async def test_served_from_the_database(self, client, admin, acme):
        with _no_upstream():
            resp = await client.get(
                "/api/v1/eol/products/custom:acme-erp", headers=auth_headers(admin)
            )
        assert resp.status_code == 200
        assert [c["cycle"] for c in resp.json()] == ["2", "1"]
        assert resp.json()[1]["eol"] == PAST
        assert resp.json()[1]["releaseDate"] == LONG_AGO
        # The product's link stands in for endoflife.date's per-cycle link,
        # and its title names it on the card.
        assert {c["link"] for c in resp.json()} == {"https://acme.example/erp"}
        assert {c["title"] for c in resp.json()} == {"Acme ERP"}

    async def test_unknown_custom_product_is_404(self, client, admin):
        with _no_upstream():
            resp = await client.get("/api/v1/eol/products/custom:nope", headers=auth_headers(admin))
        assert resp.status_code == 404


class TestCardStatus:
    async def test_custom_link_resolves_without_upstream(self, client, admin, acme, db, itc_type):
        ended = await _link(db, "Old ERP", "custom:acme-erp", "1")
        current = await _link(db, "New ERP", "custom:acme-erp", "2")
        gone = await _link(db, "Gone ERP", "custom:deleted-product", "1")
        with patch(
            "app.services.eol_service.fetch_product_cycles",
            AsyncMock(side_effect=AssertionError("upstream called")),
        ):
            resp = await client.get(
                "/api/v1/eol/card-status?type=ITComponent", headers=auth_headers(admin)
            )
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert items[str(ended.id)]["status"] == "eol"
        assert items[str(ended.id)]["source"] == "custom"
        assert items[str(ended.id)]["eol_product_title"] == "Acme ERP"
        assert items[str(ended.id)]["eol_date"] == PAST
        assert items[str(ended.id)]["latest"] == "1.4"
        assert items[str(current.id)]["status"] == "supported"
        assert items[str(current.id)]["support_date"] == FUTURE
        assert items[str(gone.id)]["status"] == "unknown"
        assert items[str(gone.id)]["source"] == "custom"
        assert items[str(gone.id)]["eol_product_title"] is None


class TestMassLink:
    async def test_links_a_custom_cycle(self, client, admin, acme, db, itc_type):
        card = await create_card(db, card_type="ITComponent", name="ERP host")
        resp = await client.post(
            "/api/v1/eol/mass-link",
            json=[{"card_id": str(card.id), "eol_product": "custom:acme-erp", "eol_cycle": "2"}],
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 1
        await db.refresh(card)
        assert card.attributes == {"eol_product": "custom:acme-erp", "eol_cycle": "2"}

    @pytest.mark.parametrize(("product", "cycle"), [("custom:nope", "1"), ("custom:acme-erp", "9")])
    async def test_refuses_a_dead_custom_link(
        self, client, admin, acme, db, itc_type, product, cycle
    ):
        card = await create_card(db, card_type="ITComponent", name="ERP host")
        resp = await client.post(
            "/api/v1/eol/mass-link",
            json=[{"card_id": str(card.id), "eol_product": product, "eol_cycle": cycle}],
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422
        await db.refresh(card)
        assert not (card.attributes or {}).get("eol_product")

    @patch("app.api.v1.eol._products_cache", UPSTREAM)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_mass_search_offers_custom_candidates(self, client, admin, acme, db, itc_type):
        await create_card(db, card_type="ITComponent", name="Acme ERP")
        resp = await client.post(
            "/api/v1/eol/mass-search?type_key=ITComponent", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        top = resp.json()[0]["candidates"][0]
        assert (top["eol_product"], top["custom"], top["title"]) == (
            "custom:acme-erp",
            True,
            "Acme ERP",
        )

    @patch("app.api.v1.eol._products_cache", UPSTREAM)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_mass_search_names_the_current_custom_link(
        self, client, admin, acme, db, itc_type
    ):
        await _link(db, "ERP host", "custom:acme-erp", "1")
        await _link(db, "Py host", "python", "3.12")
        resp = await client.post(
            "/api/v1/eol/mass-search?type_key=ITComponent", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        by_name = {r["card_name"]: r for r in resp.json()}
        assert by_name["ERP host"]["current_eol_product"] == "custom:acme-erp"
        assert by_name["ERP host"]["current_title"] == "Acme ERP"
        assert by_name["Py host"]["current_title"] is None


class TestEolReport:
    async def test_custom_items_carry_their_cycle(self, client, admin, acme, db, itc_type):
        card = await _link(db, "Old ERP", "custom:acme-erp", "1")
        with patch(
            "app.services.eol_service.fetch_product_cycles",
            AsyncMock(side_effect=AssertionError("upstream called")),
        ):
            resp = await client.get("/api/v1/reports/eol", headers=auth_headers(admin))
        assert resp.status_code == 200
        item = next(i for i in resp.json()["items"] if i["id"] == str(card.id))
        assert (item["source"], item["status"]) == ("custom", "eol")
        assert item["eol_product_title"] == "Acme ERP"
        assert item["cycle_data"]["eol"] == PAST
        assert item["cycle_data"]["releaseDate"] == LONG_AGO
        assert resp.json()["summary"]["eol"] == 1


# ---------------------------------------------------------------------------
# Upstream matches + switching to endoflife.date
# ---------------------------------------------------------------------------


class TestUpstreamMatches:
    async def test_names_the_upstream_product(self, client, admin, db):
        for key, title in (("acme-erp", "Acme ERP"), ("postgres-internal", "PostgreSQL")):
            resp = await client.post(
                BASE, json={"key": key, "title": title}, headers=auth_headers(admin)
            )
            assert resp.status_code == 201
        with (
            patch("app.api.v1.eol._products_cache", UPSTREAM),
            patch("app.api.v1.eol._products_cache_time", 9999999999.0),
        ):
            resp = await client.get(f"{BASE}/upstream-matches", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json() == {"postgres-internal": {"name": "postgresql", "score": 1.0}}

    async def test_a_short_slug_inside_a_title_is_no_match(self, client, admin, db):
        # "go" sits inside "pingoanalytics" — a substring hit scores 0.85.
        resp = await client.post(
            BASE,
            json={"key": "pingo-analytics", "title": "Pingo Analytics"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        with (
            patch("app.api.v1.eol._products_cache", [*UPSTREAM, "go"]),
            patch("app.api.v1.eol._products_cache_time", 9999999999.0),
        ):
            resp = await client.get(f"{BASE}/upstream-matches", headers=auth_headers(admin))
        assert resp.json() == {}

    async def test_a_title_inside_the_slug_still_matches(self, client, admin, db):
        resp = await client.post(
            BASE, json={"key": "pg", "title": "Postgres"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 201
        with (
            patch("app.api.v1.eol._products_cache", UPSTREAM),
            patch("app.api.v1.eol._products_cache_time", 9999999999.0),
        ):
            resp = await client.get(f"{BASE}/upstream-matches", headers=auth_headers(admin))
        assert list(resp.json()) == ["pg"]
        assert resp.json()["pg"]["name"] == "postgresql"
        assert resp.json()["pg"]["score"] >= 0.9

    async def test_empty_when_upstream_is_down(self, client, admin, acme):
        down = AsyncMock(side_effect=HTTPException(502, "down"))
        with patch("app.api.v1.eol._get_all_products", down):
            resp = await client.get(f"{BASE}/upstream-matches", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json() == {}

    async def test_empty_without_custom_products(self, client, admin):
        with (
            _no_upstream(),
            patch("app.api.v1.eol._get_all_products", AsyncMock(side_effect=AssertionError)),
        ):
            resp = await client.get(f"{BASE}/upstream-matches", headers=auth_headers(admin))
        assert resp.json() == {}


UPSTREAM_CYCLES = [{"cycle": "2024", "eol": FUTURE}, {"cycle": "2020", "eol": PAST}]


def _upstream(cycles=UPSTREAM_CYCLES):
    return patch("app.api.v1.eol.fetch_product_cycles", AsyncMock(return_value=cycles))


class TestSwitch:
    async def test_relinks_mapped_cycles_and_keeps_the_rest(
        self, client, admin, acme, db, itc_type
    ):
        old = await _link(db, "Old ERP", "custom:acme-erp", "1", lifecycle={"endOfLife": PAST})
        new = await _link(db, "New ERP", "custom:acme-erp", "2")
        with _upstream():
            resp = await client.post(
                f"{BASE}/acme-erp/switch",
                json={
                    "target_product": "acme",
                    "cycle_map": {"1": "2020", "2": None},
                    "delete_when_unused": True,
                },
                headers=auth_headers(admin),
            )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"relinked": 1, "kept": 1, "deleted": False}
        await db.refresh(old)
        await db.refresh(new)
        assert old.attributes == {"eol_product": "acme", "eol_cycle": "2020"}
        assert old.lifecycle == {"endOfLife": PAST}
        assert new.attributes == {"eol_product": "custom:acme-erp", "eol_cycle": "2"}
        events = (await db.execute(select(Event).where(Event.card_id == old.id))).scalars().all()
        assert [e.data["source"] for e in events] == ["eol_custom_switch"]
        assert (await db.execute(select(EolCustomProduct))).scalar_one().key == "acme-erp"

    async def test_deletes_the_product_once_nothing_links_it(
        self, client, admin, acme, db, itc_type
    ):
        await _link(db, "Old ERP", "custom:acme-erp", "1")
        with _upstream():
            resp = await client.post(
                f"{BASE}/acme-erp/switch",
                json={
                    "target_product": "acme",
                    "cycle_map": {"1": "2020"},
                    "delete_when_unused": True,
                },
                headers=auth_headers(admin),
            )
        assert resp.json() == {"relinked": 1, "kept": 0, "deleted": True}
        assert (await db.execute(select(EolCustomProduct))).scalars().all() == []
        audit = (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == "admin.eol_custom_product.switched"
                )
            )
        ).scalar_one()
        assert audit.details["context"]["target_product"] == "acme"

    async def test_hidden_cards_stay_and_keep_the_product(self, client, db, acme, admin):
        await create_card_type(
            db,
            key="ITComponent",
            label="IT Component",
            role_permissions={"restricted": {"inventory.view": False}},
        )
        await create_role(
            db,
            key="restricted",
            label="Restricted",
            permissions={"eol.view": True, "eol.manage": True},
        )
        restricted = await create_user(db, email="r@test.com", role="restricted")
        hidden = await _link(db, "Secret host", "custom:acme-erp", "1")
        with _upstream():
            resp = await client.post(
                f"{BASE}/acme-erp/switch",
                json={
                    "target_product": "acme",
                    "cycle_map": {"1": "2020"},
                    "delete_when_unused": True,
                },
                headers=auth_headers(restricted),
            )
        assert resp.json() == {"relinked": 0, "kept": 0, "deleted": False}
        await db.refresh(hidden)
        assert hidden.attributes["eol_product"] == "custom:acme-erp"

    @pytest.mark.parametrize(
        ("target", "cycle_map", "cycles"),
        [
            ("acme", {"1": "1999"}, UPSTREAM_CYCLES),  # upstream lacks the cycle
            ("acme", {"9": "2020"}, UPSTREAM_CYCLES),  # custom product lacks the cycle
            ("custom:acme-erp", {}, UPSTREAM_CYCLES),  # not an upstream product
            ("../etc", {}, UPSTREAM_CYCLES),  # SSRF guard
            ("acme", {}, None),  # endoflife.date has no such product
        ],
    )
    async def test_rejects_bad_requests(self, client, admin, acme, target, cycle_map, cycles):
        with _upstream(cycles):
            resp = await client.post(
                f"{BASE}/acme-erp/switch",
                json={"target_product": target, "cycle_map": cycle_map},
                headers=auth_headers(admin),
            )
        assert resp.status_code == 422, (target, cycle_map)

    async def test_viewer_cannot_switch(self, client, viewer, acme):
        with _upstream():
            resp = await client.post(
                f"{BASE}/acme-erp/switch",
                json={"target_product": "acme", "cycle_map": {}},
                headers=auth_headers(viewer),
            )
        assert resp.status_code == 403

    async def test_unknown_product_is_404(self, client, admin):
        with _upstream():
            resp = await client.post(
                f"{BASE}/nope/switch",
                json={"target_product": "acme", "cycle_map": {}},
                headers=auth_headers(admin),
            )
        assert resp.status_code == 404
