"""Route-level behaviour of the per-card-type View permission.

A card type can deny (or allow) a role View. These tests pin the rules at the
HTTP boundary — the sentinel sweep (``test_read_scope_sentinel_sweep.py``)
covers *where* hidden cards must not appear; this file covers *how* the rules
read: omitted rather than refused in lists, 404 on a hidden card, stakeholders
keep their card, an Allow opens the inventory to a role without the global
grant, a View deny locks the type's writes, ``ppm.view`` does not reopen a
denied Initiative, and a write that replaces a link set keeps the links the
caller never saw.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.turbolens import TurboLensVendorAnalysis
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def set_overrides(db, type_key: str, overrides: dict) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = overrides
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_relation_type(
        db,
        key="relAppToInit",
        label="supports",
        source_type_key="Application",
        target_type_key="Initiative",
    )
    await create_stakeholder_role_def(
        db, card_type_key="Initiative", key="responsible", permissions={"card.view": True}
    )
    app = await create_card(db, card_type="Application", name="App One")
    secret = await create_card(db, card_type="Initiative", name="Secret Program")
    held = await create_card(db, card_type="Initiative", name="Held Program")
    rel = await create_relation(db, type_key="relAppToInit", source_id=app.id, target_id=secret.id)
    admin = await create_user(db, email="admin@t.com", role="admin")
    member = await create_user(db, email="member@t.com", role="member")
    viewer = await create_user(db, email="viewer@t.com", role="viewer")
    db.add(Stakeholder(card_id=held.id, user_id=member.id, role="responsible"))
    await db.flush()
    await set_overrides(db, "Initiative", {"member": {"inventory.view": False}})
    return {
        "app": app,
        "secret": secret,
        "held": held,
        "rel": rel,
        "admin": admin,
        "member": member,
        "viewer": viewer,
    }


class TestLists:
    async def test_hidden_cards_are_omitted(self, client, env):
        resp = await client.get("/api/v1/cards", headers=auth_headers(env["member"]))
        names = {c["name"] for c in resp.json()["items"]}
        assert "Secret Program" not in names
        assert "App One" in names
        assert resp.json()["total"] == len(resp.json()["items"])

    async def test_stakeholder_keeps_their_card(self, client, env):
        resp = await client.get(
            "/api/v1/cards", params={"type": "Initiative"}, headers=auth_headers(env["member"])
        )
        assert [c["name"] for c in resp.json()["items"]] == ["Held Program"]

    async def test_counts_follow(self, client, env):
        resp = await client.get("/api/v1/cards/counts", headers=auth_headers(env["member"]))
        by_type = {e["type"]: e["count"] for e in resp.json()["by_type"]}
        assert by_type.get("Initiative") == 1  # the held one only

    async def test_other_roles_and_admin_unaffected(self, client, env):
        for who in ("viewer", "admin"):
            resp = await client.get(
                "/api/v1/cards", params={"type": "Initiative"}, headers=auth_headers(env[who])
            )
            assert {c["name"] for c in resp.json()["items"]} == {
                "Secret Program",
                "Held Program",
            }

    async def test_ids_mode_reports_withheld(self, client, env):
        ids = f"{env['app'].id},{env['secret'].id}"
        resp = await client.get(
            "/api/v1/cards", params={"ids": ids}, headers=auth_headers(env["member"])
        )
        body = resp.json()
        assert [c["id"] for c in body["items"]] == [str(env["app"].id)]
        assert body["withheld_ids"] == [str(env["secret"].id)]

    async def test_relations_drop_hidden_ends(self, client, env):
        resp = await client.get(
            "/api/v1/relations",
            params={"card_id": str(env["app"].id)},
            headers=auth_headers(env["member"]),
        )
        assert resp.json() == []


class TestSingleCard:
    async def test_hidden_card_is_404(self, client, env):
        resp = await client.get(
            f"/api/v1/cards/{env['secret'].id}", headers=auth_headers(env["member"])
        )
        assert resp.status_code == 404

    async def test_held_card_opens(self, client, env):
        resp = await client.get(
            f"/api/v1/cards/{env['held'].id}", headers=auth_headers(env["member"])
        )
        assert resp.status_code == 200

    async def test_ppm_view_does_not_reopen_a_denied_initiative(self, client, db, env):
        await create_role(db, key="ppm_only", label="PPM", permissions={"ppm.view": True})
        ppm_user = await create_user(db, email="ppm@t.com", role="ppm_only")
        resp = await client.get(f"/api/v1/cards/{env['secret'].id}", headers=auth_headers(ppm_user))
        assert resp.status_code == 200  # no deny for this role: ppm.view reads it
        await set_overrides(db, "Initiative", {"ppm_only": {"inventory.view": False}})
        resp = await client.get(f"/api/v1/cards/{env['secret'].id}", headers=auth_headers(ppm_user))
        assert resp.status_code == 404
        resp = await client.get(
            f"/api/v1/ppm/initiatives/{env['secret'].id}/reports", headers=auth_headers(ppm_user)
        )
        assert resp.status_code == 404

    async def test_sub_resources_are_404(self, client, env):
        for sub in ("comments", "documents", "file-attachments", "stakeholders", "todos"):
            resp = await client.get(
                f"/api/v1/cards/{env['secret'].id}/{sub}", headers=auth_headers(env["member"])
            )
            assert resp.status_code == 404, sub

    async def test_effective_permissions_follow(self, client, env):
        resp = await client.get(
            f"/api/v1/cards/{env['held'].id}/my-permissions", headers=auth_headers(env["member"])
        )
        eff = resp.json()["effective"]
        assert eff["can_view"] is True
        assert eff["can_edit"] is False  # the landscape-wide edit is gone with View


class TestAllowOnlyRole:
    async def test_allow_opens_one_type(self, client, db, env):
        await create_role(db, key="initonly", label="Init only", permissions={})
        user = await create_user(db, email="io@t.com", role="initonly")
        resp = await client.get("/api/v1/cards", headers=auth_headers(user))
        assert resp.status_code == 403
        await set_overrides(
            db,
            "Initiative",
            {"member": {"inventory.view": False}, "initonly": {"inventory.view": True}},
        )
        resp = await client.get("/api/v1/cards", headers=auth_headers(user))
        assert resp.status_code == 200
        assert {c["type"] for c in resp.json()["items"]} == {"Initiative"}


class TestWrites:
    async def test_view_deny_locks_writes(self, client, db, env):
        await set_overrides(
            db, "Initiative", {"member": {"inventory.view": False, "inventory.create": True}}
        )
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Initiative", "name": "New"},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 403

    async def test_relation_to_hidden_card_is_404(self, client, env):
        resp = await client.post(
            "/api/v1/relations",
            json={
                "type": "relAppToInit",
                "source_id": str(env["app"].id),
                "target_id": str(env["secret"].id),
            },
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 404

    async def test_relation_with_hidden_end_cannot_be_deleted(self, client, env):
        resp = await client.delete(
            f"/api/v1/relations/{env['rel'].id}", headers=auth_headers(env["member"])
        )
        assert resp.status_code == 404

    async def test_adr_patch_keeps_links_the_caller_never_saw(self, client, db, env):
        created = await client.post(
            "/api/v1/adr",
            json={
                "title": "Decision",
                "linked_card_ids": [str(env["app"].id), str(env["secret"].id)],
            },
            headers=auth_headers(env["admin"]),
        )
        adr_id = created.json()["id"]
        seen = await client.get(f"/api/v1/adr/{adr_id}", headers=auth_headers(env["member"]))
        assert [c["id"] for c in seen.json()["linked_cards"]] == [str(env["app"].id)]
        # The member unlinks the one card they can see.
        resp = await client.patch(
            f"/api/v1/adr/{adr_id}",
            json={"linked_card_ids": []},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 200
        rows = await db.execute(
            select(ArchitectureDecisionCard.card_id).where(
                ArchitectureDecisionCard.architecture_decision_id == created.json()["id"]
            )
        )
        assert {r[0] for r in rows.all()} == {env["secret"].id}


class TestReports:
    async def test_dependencies_drop_hidden_nodes_and_edges(self, client, env):
        resp = await client.get("/api/v1/reports/dependencies", headers=auth_headers(env["member"]))
        body = resp.json()
        assert str(env["secret"].id) not in {n["id"] for n in body["nodes"]}
        assert all(str(env["secret"].id) not in (e["source"], e["target"]) for e in body["edges"])

    async def test_reports_role_without_inventory_view_is_unaffected(self, client, db, env):
        """Module surfaces subtract only explicit denies — no regression for such roles."""
        await create_role(
            db, key="reporter", label="Reporter", permissions={"reports.ea_dashboard": True}
        )
        reporter = await create_user(db, email="rep@t.com", role="reporter")
        resp = await client.get("/api/v1/reports/dashboard", headers=auth_headers(reporter))
        assert resp.json()["by_type"].get("Initiative") == 2
        assert resp.json()["trends"] is not None


class TestHierarchy:
    """The tree is read in module mode: a deny subtracts, nothing else does."""

    async def test_hidden_type_relatives_are_omitted(self, client, db, env):
        await create_card(db, card_type="Initiative", name="Hidden child", parent_id=env["app"].id)
        for who, expected in (("member", []), ("viewer", ["Hidden child"])):
            resp = await client.get(
                f"/api/v1/cards/{env['app'].id}/hierarchy", headers=auth_headers(env[who])
            )
            assert resp.status_code == 200
            assert [c["name"] for c in resp.json()["children"]] == expected, who

    async def test_stakeholder_only_reader_sees_the_tree(self, client, db, env):
        """A card opened through a stakeholder role shows its children (module mode)."""
        await create_role(db, key="holder", label="Holder", permissions={})
        holder = await create_user(db, email="holder@t.com", role="holder")
        db.add(Stakeholder(card_id=env["held"].id, user_id=holder.id, role="responsible"))
        await db.flush()
        child = await create_card(
            db, card_type="Application", name="Held child", parent_id=env["held"].id
        )
        resp = await client.get(
            f"/api/v1/cards/{env['held'].id}/hierarchy", headers=auth_headers(holder)
        )
        assert resp.status_code == 200
        assert [c["id"] for c in resp.json()["children"]] == [str(child.id)]
        resp = await client.get(f"/api/v1/cards/{child.id}/hierarchy", headers=auth_headers(holder))
        assert resp.status_code == 403  # module mode on the tree, not on the gate


class TestTurboLensVendors:
    """The vendor analysis stores card names; a reader sees only the ones they may read."""

    @pytest.fixture
    async def vendors(self, db, env):
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="Provider", label="Provider")
        await create_role(
            db,
            key="analyst",
            label="Analyst",
            permissions={"inventory.view": True, "turbolens.view": True},
        )
        analyst = await create_user(db, email="analyst@t.com", role="analyst")
        await create_card(db, card_type="Application", name="Hidden App")
        await create_card(db, card_type="ITComponent", name="Visible Component")
        db.add_all(
            [
                TurboLensVendorAnalysis(
                    vendor_name="Mixed Vendor",
                    category="ERP",
                    app_count=2,
                    app_list=["Hidden App", "Visible Component"],
                ),
                TurboLensVendorAnalysis(
                    vendor_name="Hidden Only Vendor",
                    category="CRM",
                    app_count=1,
                    app_list=["Hidden App"],
                ),
                TurboLensVendorAnalysis(vendor_name="Bare Vendor", category="Other", app_count=0),
            ]
        )
        await db.flush()
        await set_overrides(db, "Application", {"analyst": {"inventory.view": False}})
        return analyst

    async def test_hidden_card_names_are_dropped(self, client, env, vendors):
        resp = await client.get("/api/v1/turbolens/vendors", headers=auth_headers(vendors))
        assert resp.status_code == 200
        by_name = {v["vendor_name"]: v for v in resp.json()}
        assert set(by_name) == {"Mixed Vendor", "Bare Vendor"}
        assert by_name["Mixed Vendor"]["app_list"] == ["Visible Component"]
        assert by_name["Mixed Vendor"]["app_count"] == 1
        assert "Hidden App" not in resp.text

    async def test_admin_sees_everything(self, client, env, vendors):
        resp = await client.get("/api/v1/turbolens/vendors", headers=auth_headers(env["admin"]))
        assert {v["vendor_name"] for v in resp.json()} == {
            "Mixed Vendor",
            "Hidden Only Vendor",
            "Bare Vendor",
        }

    async def test_provider_deny_hides_every_vendor(self, client, db, env, vendors):
        await set_overrides(db, "Provider", {"analyst": {"inventory.view": False}})
        resp = await client.get("/api/v1/turbolens/vendors", headers=auth_headers(vendors))
        assert resp.json() == []
        resp = await client.get(
            "/api/v1/turbolens/vendors/hierarchy", headers=auth_headers(vendors)
        )
        assert resp.json() == []
