"""Integration tests for ``/dashboards`` — the admin-editable homepage.

Covers who sees which dashboard (roles, hidden, wildcard, impersonation), the
payload trim for non-managers, every write with its 403 / 404 / 409 / 400 /
422 and its Security & admin log row, and the data endpoints behind the Chart
and KPI widgets (read scope, cost gate, trends).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.core.security import create_access_token
from app.models.audit_log import AuditLogEntry
from app.models.card import Card
from app.models.card_type import CardType
from app.models.dashboard import Dashboard, DashboardKpiSnapshot
from app.services.dashboard_defaults import DEFAULT_DASHBOARDS
from app.services.dashboard_service import seed_dashboards
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

BASE = "/api/v1/dashboards"
TODAY = datetime.now(timezone.utc).date()
KPI_WIDGET = {
    "id": "kpi-apps",
    "type": "kpi",
    "title": "Applications",
    "config": {"query": {"card_type": "Application"}},
    "layout": {"x": 0, "y": 0, "w": 3, "h": 2},
}
TODO_WIDGET = {"id": "todos", "type": "my_todos", "layout": {"x": 3, "y": 0, "w": 6, "h": 6}}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="curator",
        label="Curator",
        permissions={**VIEWER_PERMISSIONS, "admin.dashboards": True},
    )
    await seed_dashboards(db)
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Cost",
                "fields": [
                    {"key": "cost", "type": "cost"},
                    {"key": "users", "type": "number"},
                ],
            }
        ],
    )
    await create_card_type(db, key="Secret", label="Secret")
    await create_card(db, card_type="Application", name="A1", attributes={"cost": 10, "users": 3})
    await create_card(db, card_type="Application", name="A2", attributes={"cost": 5, "users": 1})
    await create_card(db, card_type="Secret", name="S1")
    return {
        "admin": await create_user(db, email="admin@dash.test", role="admin"),
        "member": await create_user(db, email="member@dash.test", role="member"),
        "viewer": await create_user(db, email="viewer@dash.test", role="viewer"),
        "curator": await create_user(db, email="curator@dash.test", role="curator"),
    }


async def _audit(db, action: str) -> list[AuditLogEntry]:
    await db.rollback()
    rows = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == action)
        .order_by(AuditLogEntry.created_at)
    )
    return list(rows.scalars().all())


async def _by_key(db, key: str) -> Dashboard:
    return (await db.execute(select(Dashboard).where(Dashboard.key == key))).scalar_one()


async def _create(client, user, **body):
    return await client.post(BASE, json={"name": "Sales", **body}, headers=auth_headers(user))


async def _deny_secret_to(db, role: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == "Secret"))).scalar_one()
    ct.role_permissions = {role: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


# ── List ─────────────────────────────────────────────────────────────────


class TestList:
    async def test_member_sees_the_open_defaults_trimmed(self, client, env):
        # The Admin dashboard is seeded with Access set to the roles holding
        # ``admin.users``, so a member is not even told it exists.
        r = await client.get(BASE, headers=auth_headers(env["member"]))
        assert r.status_code == 200
        rows = r.json()
        assert [d["key"] for d in rows] == ["overview", "workspace"]
        overview = rows[0]
        assert overview["name"] == "Overview"
        assert overview["built_in"] is True
        assert overview["can_manage"] is False
        assert "allowed_roles" not in overview
        assert overview["widgets"] == DEFAULT_DASHBOARDS["overview"]["widgets"]

    async def test_admin_gets_allowed_roles_and_can_manage(self, client, env):
        rows = (await client.get(BASE, headers=auth_headers(env["admin"]))).json()
        assert all(d["can_manage"] is True for d in rows)
        assert rows[0]["allowed_roles"] == []

    async def test_requires_authentication(self, client, env):
        assert (await client.get(BASE)).status_code == 401

    async def test_role_restricted_and_hidden_dashboards(self, client, db, env):
        db.add(Dashboard(key="for-viewers", name="Viewers", sort_order=5, allowed_roles=["viewer"]))
        db.add(Dashboard(key="hidden", name="Hidden", sort_order=6, is_hidden=True))
        await db.flush()

        def keys(r):
            return [d["key"] for d in r.json()]

        viewer = await client.get(BASE, headers=auth_headers(env["viewer"]))
        assert keys(viewer) == ["overview", "workspace", "for-viewers"]
        member = await client.get(BASE, headers=auth_headers(env["member"]))
        assert keys(member) == ["overview", "workspace"]
        # The wildcard admin sees every role's dashboard, and as a manager the
        # hidden one too; so does a non-wildcard manager.
        admin = await client.get(BASE, headers=auth_headers(env["admin"]))
        assert keys(admin) == ["overview", "workspace", "admin", "for-viewers", "hidden"]
        curator = await client.get(BASE, headers=auth_headers(env["curator"]))
        assert keys(curator)[-2:] == ["for-viewers", "hidden"]
        assert curator.json()[0]["can_manage"] is True

    async def test_impersonation_decides_the_role(self, client, db, env):
        db.add(Dashboard(key="for-viewers", name="Viewers", sort_order=5, allowed_roles=["viewer"]))
        await db.flush()
        admin = env["admin"]

        async def as_role(role):
            token = create_access_token(admin.id, admin.role, impersonated_role=role)
            r = await client.get(BASE, headers={"Authorization": f"Bearer {token}"})
            assert r.status_code == 200
            return [d["key"] for d in r.json()]

        assert "for-viewers" not in await as_role("member")
        assert "for-viewers" in await as_role("viewer")


# ── Create / update / delete ─────────────────────────────────────────────


class TestCreate:
    async def test_admin_creates_a_dashboard(self, client, db, env):
        r = await _create(
            client,
            env["admin"],
            description="Pipeline",
            icon="trending_up",
            allowed_roles=["viewer", "viewer"],
            widgets=[KPI_WIDGET, TODO_WIDGET],
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["key"].startswith("sales-") and len(body["key"]) == len("sales-") + 6
        assert body["name"] == "Sales"
        assert body["built_in"] is False
        assert body["sort_order"] == 3
        assert body["allowed_roles"] == ["viewer"]
        assert body["widgets"][1] == {
            "id": "todos",
            "type": "my_todos",
            "title": None,
            "config": {},
            "layout": {"x": 3, "y": 0, "w": 6, "h": 6},
        }
        # A baseline for the KPI query, so its trend starts today.
        snaps = (await db.execute(select(DashboardKpiSnapshot))).scalars().all()
        assert [(s.snapshot_date, s.metric_key, s.value) for s in snaps] == [
            (TODAY, "card_type=Application", 2.0)
        ]
        (entry,) = await _audit(db, "admin.dashboard.created")
        assert entry.category == "admin"
        assert entry.target_type == "dashboard"
        assert entry.target_label == "Sales"
        assert entry.details["context"] == {
            "key": body["key"],
            "built_in": False,
            "widget_count": 2,
            "allowed_roles": ["Viewer"],
        }

    async def test_a_member_may_not(self, client, db, env):
        r = await _create(client, env["member"])
        assert r.status_code == 403
        assert len((await db.execute(select(Dashboard))).scalars().all()) == 3

    async def test_roles_must_exist(self, client, env):
        r = await _create(client, env["admin"], allowed_roles=["ghost"])
        assert r.status_code == 400
        assert r.json()["detail"] == "unknown_role"

    async def test_a_wildcard_role_is_accepted_and_echoed(self, client, env):
        r = await _create(client, env["admin"], allowed_roles=["admin", "member"])
        assert r.status_code == 201
        assert r.json()["allowed_roles"] == ["admin", "member"]

    @pytest.mark.parametrize(
        "widget",
        [
            {**TODO_WIDGET, "layout": {"x": 8, "y": 0, "w": 6, "h": 6}},
            {**TODO_WIDGET, "type": "bogus"},
            {**KPI_WIDGET, "config": {"query": {"group_by": "name"}}},
            {**TODO_WIDGET, "config": {"card_id": "0b8e1c5e-8f7a-4c1b-9d3e-2f6a7b8c9d0e"}},
        ],
    )
    async def test_an_invalid_widget_is_422(self, client, env, widget):
        r = await _create(client, env["admin"], widgets=[widget])
        assert r.status_code == 422


class TestUpdate:
    async def test_patch_records_changes_with_role_labels_and_widget_items(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.patch(
            f"{BASE}/{overview.id}",
            json={
                "name": "Home",
                "allowed_roles": ["viewer"],
                "widgets": [*overview.widgets[1:], KPI_WIDGET],
            },
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "Home"
        # The translations named "Overview"; a renamed tab reads as typed.
        assert body["translations"] == {}
        assert body["allowed_roles"] == ["viewer"]
        assert body["widgets"][-1]["id"] == "kpi-apps"
        (entry,) = await _audit(db, "admin.dashboard.updated")
        assert entry.details["changes"] == {
            "name": {"old": "Overview", "new": "Home"},
            "allowed_roles": {"old": [], "new": ["Viewer"]},
        }
        assert entry.details["items"] == [
            {"kind": "dashboard_widget.added", "widget": "Applications", "type": "kpi"},
            {"kind": "dashboard_widget.removed", "widget": "kpi", "type": "kpi"},
        ]
        snaps = (await db.execute(select(DashboardKpiSnapshot.metric_key))).scalars().all()
        assert snaps == ["card_type=Application"]

    async def test_hide_reorder_and_null_is_ignored(self, client, db, env):
        workspace = await _by_key(db, "workspace")
        r = await client.patch(
            f"{BASE}/{workspace.id}",
            json={"is_hidden": True, "sort_order": 9, "name": None, "widgets": None},
            headers=auth_headers(env["curator"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert (body["is_hidden"], body["sort_order"], body["name"]) == (True, 9, "My Workspace")
        assert len(body["widgets"]) == len(DEFAULT_DASHBOARDS["workspace"]["widgets"])
        (entry,) = await _audit(db, "admin.dashboard.updated")
        assert entry.details["changes"] == {
            "is_hidden": {"old": False, "new": True},
            "sort_order": {"old": 1, "new": 9},
        }

    async def test_a_no_op_patch_writes_no_audit_row(self, client, db, env):
        overview = await _by_key(db, "overview")
        seeded = dict(overview.translations or {})
        assert seeded  # the built-in names ship translated
        r = await client.patch(
            f"{BASE}/{overview.id}", json={"name": "Overview"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200
        assert r.json()["translations"] == seeded  # an unchanged name keeps them
        assert await _audit(db, "admin.dashboard.updated") == []

    async def test_member_403_unknown_404_bad_role_400(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.patch(
            f"{BASE}/{overview.id}", json={"is_hidden": True}, headers=auth_headers(env["member"])
        )
        assert r.status_code == 403
        r = await client.patch(
            f"{BASE}/00000000-0000-0000-0000-000000000000",
            json={"is_hidden": True},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 404
        r = await client.patch(
            f"{BASE}/{overview.id}",
            json={"allowed_roles": ["ghost"]},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "unknown_role"


class TestDelete:
    async def test_built_in_is_409(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.delete(f"{BASE}/{overview.id}", headers=auth_headers(env["admin"]))
        assert r.status_code == 409
        assert r.json()["detail"] == "built_in"

    async def test_custom_is_deleted_and_audited(self, client, db, env):
        created = (await _create(client, env["admin"], widgets=[TODO_WIDGET])).json()
        r = await client.delete(f"{BASE}/{created['id']}", headers=auth_headers(env["member"]))
        assert r.status_code == 403
        r = await client.delete(f"{BASE}/{created['id']}", headers=auth_headers(env["admin"]))
        assert r.status_code == 204
        keys = (await db.execute(select(Dashboard.key))).scalars().all()
        assert created["key"] not in keys
        (entry,) = await _audit(db, "admin.dashboard.deleted")
        assert entry.target_label == "Sales"
        assert entry.details["context"]["widget_count"] == 1


class TestDuplicate:
    async def test_duplicate_is_a_custom_copy_with_new_widget_ids(self, client, db, env):
        overview = await _by_key(db, "overview")
        overview.allowed_roles = ["viewer"]
        await db.flush()
        r = await client.post(f"{BASE}/{overview.id}/duplicate", headers=auth_headers(env["admin"]))
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "Copy of Overview"
        assert body["key"].startswith("copy-of-overview-")
        assert body["built_in"] is False
        assert body["translations"] == {}
        assert body["sort_order"] == 1
        assert body["allowed_roles"] == ["viewer"]
        source_ids = [w["id"] for w in overview.widgets]
        copy_ids = [w["id"] for w in body["widgets"]]
        assert len(copy_ids) == len(source_ids)
        assert not set(copy_ids) & set(source_ids)
        assert copy_ids[0].startswith("kpi-total-cards-")
        assert [w["layout"] for w in body["widgets"]] == [w["layout"] for w in overview.widgets]
        (entry,) = await _audit(db, "admin.dashboard.duplicated")
        assert entry.details["context"]["source"] == "Overview"

    async def test_the_client_names_the_copy(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.post(
            f"{BASE}/{overview.id}/duplicate",
            json={"name": "Kopie von Übersicht"},
            headers=auth_headers(env["admin"]),
        )
        assert r.json()["name"] == "Kopie von Übersicht"
        assert r.json()["key"].startswith("kopie-von-bersicht-")

    async def test_member_may_not(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.post(
            f"{BASE}/{overview.id}/duplicate", headers=auth_headers(env["member"])
        )
        assert r.status_code == 403


class TestReset:
    async def test_reset_restores_the_built_in_widgets(self, client, db, env):
        overview = await _by_key(db, "overview")
        overview.widgets = [TODO_WIDGET]
        await db.flush()
        r = await client.post(f"{BASE}/{overview.id}/reset", headers=auth_headers(env["admin"]))
        assert r.status_code == 200
        assert r.json()["widgets"] == DEFAULT_DASHBOARDS["overview"]["widgets"]
        (entry,) = await _audit(db, "admin.dashboard.reset")
        assert entry.details["changes"] == {"widget_count": {"old": 1, "new": 10}}
        assert {"kind": "dashboard_widget.removed", "widget": "my_todos", "type": "my_todos"} in (
            entry.details["items"]
        )

    @pytest.mark.parametrize("restricted", [[], ["member"]])
    async def test_reset_restores_the_seeded_access(self, client, db, env, restricted):
        """Reset means the whole default: the Admin dashboard gets back the
        roles holding ``admin.users`` (only ``admin`` here — the curator
        manages dashboards but not users), named by label in the log."""
        admin_dashboard = await _by_key(db, "admin")
        admin_dashboard.allowed_roles = restricted
        await db.flush()
        r = await client.post(
            f"{BASE}/{admin_dashboard.id}/reset", headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200
        assert r.json()["allowed_roles"] == ["admin"]
        (entry,) = await _audit(db, "admin.dashboard.reset")
        old_labels = ["Member"] if restricted else []
        assert entry.details["changes"] == {"allowed_roles": {"old": old_labels, "new": ["Admin"]}}

    async def test_reset_leaves_the_access_of_a_dashboard_stating_none(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.post(f"{BASE}/{overview.id}/reset", headers=auth_headers(env["admin"]))
        assert r.status_code == 200
        assert r.json()["allowed_roles"] == []
        (entry,) = await _audit(db, "admin.dashboard.reset")
        assert "allowed_roles" not in (entry.details.get("changes") or {})

    async def test_a_custom_dashboard_has_no_default(self, client, env):
        created = (await _create(client, env["admin"])).json()
        r = await client.post(f"{BASE}/{created['id']}/reset", headers=auth_headers(env["admin"]))
        assert r.status_code == 409
        assert r.json()["detail"] == "not_built_in"

    async def test_member_may_not(self, client, db, env):
        overview = await _by_key(db, "overview")
        r = await client.post(f"{BASE}/{overview.id}/reset", headers=auth_headers(env["member"]))
        assert r.status_code == 403


# ── Data endpoints ───────────────────────────────────────────────────────


class TestQuery:
    async def test_counts_by_type(self, client, env):
        r = await client.get(
            f"{BASE}/query", params={"group_by": "type"}, headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 200
        assert r.json() == {
            "dimension": "type",
            "dimension_2": None,
            "rows": [{"key": "Application", "value": 2}, {"key": "Secret", "value": 1}],
            "total": 3,
        }

    async def test_a_type_denied_by_the_read_scope_is_not_counted(self, client, db, env):
        await _deny_secret_to(db, "viewer")
        r = await client.get(
            f"{BASE}/query", params={"group_by": "type"}, headers=auth_headers(env["viewer"])
        )
        assert r.json()["rows"] == [{"key": "Application", "value": 2}]
        assert r.json()["total"] == 2

    @pytest.mark.parametrize(
        ("params", "detail"),
        [
            ({"card_type": "Nope"}, "unknown_card_type"),
            ({"group_by": "name"}, "unknown_dimension"),
            ({"card_type": "Application", "group_by": "field:nope"}, "unknown_field"),
            ({"relation_type": "nope"}, "unknown_relation_type"),
            ({"metric": "sum"}, "metric_field_required"),
            ({"flags": "bogus"}, "unknown_flag"),
            ({"flags": "eol_linked,eol_missing"}, "flags_conflict"),
            ({"metric": "share"}, "share_needs_filter"),
            ({"group_by": "card"}, "card_dimension_needs_card_type"),
            (
                {"card_type": "Application", "group_by": "type", "group_by_2": "card"},
                "card_dimension_not_second",
            ),
            ({"group_by": "related:appToSecret"}, "related_needs_card_type"),
            ({"card_type": "Application", "group_by": "related:nope"}, "unknown_relation_type"),
            ({"group_by": "phase_month:someday"}, "unknown_phase"),
        ],
    )
    async def test_rejected_queries_are_400(self, client, env, params, detail):
        r = await client.get(f"{BASE}/query", params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == 400
        assert r.json()["detail"] == detail

    async def test_needs_the_dashboard_permission(self, client, db, env):
        await create_role(db, key="nobody", label="Nobody", permissions={})
        user = await create_user(db, email="nobody@dash.test", role="nobody")
        r = await client.get(f"{BASE}/query", headers=auth_headers(user))
        assert r.status_code == 403

    async def test_a_cost_sum_needs_costs_view(self, client, env):
        params = {"card_type": "Application", "metric": "sum", "metric_field": "cost"}
        r = await client.get(f"{BASE}/query", params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == 403
        r = await client.get(f"{BASE}/query", params=params, headers=auth_headers(env["member"]))
        assert r.status_code == 200
        assert r.json()["total"] == 15
        # A cost names the fiscal year it counts in (January start by default).
        assert r.json()["fiscal_year"] == TODAY.year
        assert r.json()["fiscal_year_start"] == 1
        users = {"card_type": "Application", "metric": "avg", "metric_field": "users"}
        r = await client.get(f"{BASE}/query", params=users, headers=auth_headers(env["viewer"]))
        assert r.status_code == 200
        assert r.json()["total"] == 2
        assert "fiscal_year" not in r.json()

    async def test_cost_kpis_name_the_fiscal_year_too(self, client, env):
        params = {"card_type": "Application", "metric": "sum", "metric_field": "cost"}
        for path in ("kpi", "kpi-history"):
            r = await client.get(
                f"{BASE}/{path}", params=params, headers=auth_headers(env["viewer"])
            )
            assert r.status_code == 403
            r = await client.get(
                f"{BASE}/{path}", params=params, headers=auth_headers(env["member"])
            )
            assert r.status_code == 200
            assert r.json()["fiscal_year"] == TODAY.year
            assert r.json()["fiscal_year_start"] == 1
        r = await client.get(f"{BASE}/kpi-history", headers=auth_headers(env["viewer"]))
        assert "fiscal_year" not in r.json()

    async def test_cost_per_card_is_a_treemap_named_by_labels(self, client, env):
        params = {
            "card_type": "Application",
            "group_by": "card",
            "metric": "sum",
            "metric_field": "cost",
            "top": 1,
        }
        r = await client.get(f"{BASE}/query", params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == 403
        r = await client.get(f"{BASE}/query", params=params, headers=auth_headers(env["member"]))
        assert r.status_code == 200
        body = r.json()
        assert body["dimension"] == "card"
        assert [row["value"] for row in body["rows"]] == [10, 5]
        assert body["rows"][1]["key"] == "__other__"
        assert body["folded"] == {"top": 1, "cards": 1}
        assert list(body["labels"].values()) == ["A1"]
        assert body["labels"].keys() == {body["rows"][0]["key"]}
        assert body["total"] == 15
        assert body["fiscal_year"] == TODAY.year

    async def test_folded_says_how_many_cards_top_left_out(self, client, db, env):
        for n in range(3, 6):
            await create_card(db, card_type="Application", name=f"A{n}", attributes={"users": 1})
        params = {"card_type": "Application", "group_by": "card"}
        headers = auth_headers(env["viewer"])
        r = await client.get(f"{BASE}/query", params={**params, "top": 2}, headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["folded"] == {"top": 2, "cards": 3}
        assert body["rows"][-1] == {"key": "__other__", "value": 3}
        assert len(body["labels"]) == 2
        # Exactly ``top`` cards, or the default 20: nothing is folded or said.
        for extra in ({"top": 5}, {}):
            r = await client.get(f"{BASE}/query", params={**params, **extra}, headers=headers)
            assert "folded" not in r.json()
            assert len(r.json()["rows"]) == 5
        # An average drops the rest rather than merging it, and says so too.
        avg = {**params, "metric": "avg", "metric_field": "users", "top": 1}
        body = (await client.get(f"{BASE}/query", params=avg, headers=headers)).json()
        assert body["rows"] == [{"key": next(iter(body["labels"])), "value": 3}]
        assert body["folded"] == {"top": 1, "cards": 4}
        # A dimension that is not card-keyed never folds.
        by_type = {"group_by": "type", "top": 1}
        body = (await client.get(f"{BASE}/query", params=by_type, headers=headers)).json()
        assert "folded" not in body

    @pytest.mark.parametrize(("top", "status"), [(0, 422), (201, 422), (1, 200), (200, 200)])
    async def test_top_bounds(self, client, env, top, status):
        r = await client.get(
            f"{BASE}/query",
            params={"group_by": "type", "top": top},
            headers=auth_headers(env["viewer"]),
        )
        assert r.status_code == status

    async def test_flags_are_bounded_and_canonical(self, client, env):
        r = await client.get(
            f"{BASE}/query", params={"flags": "x" * 301}, headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 422
        r = await client.get(
            f"{BASE}/query",
            params={"flags": " orphaned , without_stakeholders,orphaned", "group_by": "type"},
            headers=auth_headers(env["viewer"]),
        )
        assert r.status_code == 200
        assert r.json()["total"] == 3


async def _link_a1_to_secret(db) -> Card:
    await create_relation_type(
        db,
        key="appToSecret",
        label="keeps",
        source_type_key="Application",
        target_type_key="Secret",
    )
    a1 = (await db.execute(select(Card).where(Card.name == "A1"))).scalar_one()
    s1 = (await db.execute(select(Card).where(Card.name == "S1"))).scalar_one()
    await create_relation(db, type_key="appToSecret", source_id=a1.id, target_id=s1.id)
    return s1


class TestRelatedCardsAndTheReadScope:
    async def test_an_unrestricted_reader_gets_the_related_card_named(self, client, db, env):
        s1 = await _link_a1_to_secret(db)
        r = await client.get(
            f"{BASE}/query",
            params={"card_type": "Application", "group_by": "related:appToSecret"},
            headers=auth_headers(env["viewer"]),
        )
        assert r.status_code == 200
        assert r.json() == {
            "dimension": "related:appToSecret",
            "dimension_2": None,
            "rows": [{"key": str(s1.id), "value": 1}, {"key": "none", "value": 1}],
            "total": 2,
            "labels": {str(s1.id): "S1"},
        }

    async def test_a_restricted_reader_never_sees_the_hidden_card(self, client, db, env):
        s1 = await _link_a1_to_secret(db)
        await _deny_secret_to(db, "viewer")
        headers = auth_headers(env["viewer"])
        queries = [
            {"card_type": "Application", "group_by": "related:appToSecret"},
            {"card_type": "Application", "group_by": "type", "flags": "related:appToSecret"},
            {"relation_type": "appToSecret", "group_by": "card", "group_by_2": "card"},
            {
                "card_type": "Application",
                "metric": "sum",
                "metric_field": "@relations:appToSecret",
            },
        ]
        for params in queries:
            r = await client.get(f"{BASE}/query", params=params, headers=headers)
            assert r.status_code == 200, params
            assert str(s1.id) not in r.text, params
            assert "S1" not in r.text, params
        r = await client.get(f"{BASE}/query", params=queries[0], headers=headers)
        assert r.json()["rows"] == [{"key": "none", "value": 2}]
        assert r.json()["labels"] == {}
        r = await client.get(f"{BASE}/query", params=queries[1], headers=headers)
        assert r.json()["total"] == 0
        r = await client.get(f"{BASE}/query", params=queries[3], headers=headers)
        assert r.json()["total"] == 0


class TestKpi:
    async def test_value_and_trend_for_an_unrestricted_reader(self, client, db, env):
        db.add(
            DashboardKpiSnapshot(
                snapshot_date=TODAY - timedelta(days=30),
                metric_key="card_type=Application",
                value=1,
            )
        )
        await db.flush()
        r = await client.get(
            f"{BASE}/kpi", params={"card_type": "Application"}, headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 200
        body = r.json()
        assert body["value"] == 2
        assert body["trend"] == {
            "current": 2,
            "previous": 1,
            "delta_abs": 1,
            "delta_pct": 100.0,
            "comparison_days": 30,
            "snapshot_date": (TODAY - timedelta(days=30)).isoformat(),
            "snapshot_available": True,
        }

    async def test_a_restricted_reader_gets_no_trend(self, client, db, env):
        await _deny_secret_to(db, "viewer")
        r = await client.get(f"{BASE}/kpi", headers=auth_headers(env["viewer"]))
        assert r.json() == {"value": 2, "trend": None}

    async def test_a_narrowed_count_returns_its_base(self, client, db, env):
        params = {"card_type": "Application", "approval_status": "APPROVED"}
        r = await client.get(f"{BASE}/kpi", params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == 200
        assert r.json()["value"] == 0
        assert r.json()["base"] == 2
        await _deny_secret_to(db, "viewer")
        r = await client.get(
            f"{BASE}/kpi", params={"flags": "orphaned"}, headers=auth_headers(env["viewer"])
        )
        assert r.json() == {"value": 2, "trend": None, "base": 2}
        r = await client.get(
            f"{BASE}/kpi", params={"card_type": "Application"}, headers=auth_headers(env["viewer"])
        )
        assert "base" not in r.json()

    async def test_history(self, client, db, env):
        for days_ago, value in ((10, 1), (2, 2)):
            db.add(
                DashboardKpiSnapshot(
                    snapshot_date=TODAY - timedelta(days=days_ago), metric_key="", value=value
                )
            )
        await db.flush()
        r = await client.get(f"{BASE}/kpi-history", headers=auth_headers(env["viewer"]))
        assert r.json() == {
            "points": [
                {"date": (TODAY - timedelta(days=10)).isoformat(), "value": 1},
                {"date": (TODAY - timedelta(days=2)).isoformat(), "value": 2},
            ]
        }
        r = await client.get(
            f"{BASE}/kpi-history", params={"days": 5}, headers=auth_headers(env["viewer"])
        )
        assert [p["value"] for p in r.json()["points"]] == [2]
        r = await client.get(
            f"{BASE}/kpi-history", params={"days": 0}, headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 422
        await _deny_secret_to(db, "viewer")
        r = await client.get(f"{BASE}/kpi-history", headers=auth_headers(env["viewer"]))
        assert r.json() == {"points": []}
