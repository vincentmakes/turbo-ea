"""Integration tests for PPM report endpoints.

Covers the 3 endpoints in ppm_reports.py: group-options, dashboard, and gantt.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_budget_line,
    create_card,
    create_card_type,
    create_cost_line,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def ppm_env(db):
    """Set up card types and relations needed for PPM reports."""
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={**VIEWER_PERMISSIONS},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")

    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class TestPpmDashboard:
    async def test_empty_dashboard(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_initiatives"] == 0
        assert data["by_subtype"] == {}
        assert data["by_status"] == {}
        assert data["total_budget"] == 0
        assert data["total_actual"] == 0
        assert data["health_schedule"] == {
            "onTrack": 0,
            "atRisk": 0,
            "offTrack": 0,
            "noReport": 0,
        }
        assert data["health_cost"] == {
            "onTrack": 0,
            "atRisk": 0,
            "offTrack": 0,
            "noReport": 0,
        }
        assert data["health_scope"] == {
            "onTrack": 0,
            "atRisk": 0,
            "offTrack": 0,
            "noReport": 0,
        }

    async def test_dashboard_with_initiatives(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Project Alpha",
            user_id=admin.id,
            subtype="Project",
            attributes={"initiativeStatus": "Active"},
        )
        await create_card(
            db,
            card_type="Initiative",
            name="Program Beta",
            user_id=admin.id,
            subtype="Program",
            attributes={"initiativeStatus": "Planned"},
        )
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_initiatives"] == 2
        assert data["by_subtype"]["Project"] == 1
        assert data["by_subtype"]["Program"] == 1
        assert data["by_status"]["Active"] == 1
        assert data["by_status"]["Planned"] == 1
        # No status reports → all go to noReport
        assert data["health_schedule"]["noReport"] == 2
        assert data["health_cost"]["noReport"] == 2
        assert data["health_scope"]["noReport"] == 2

    async def test_dashboard_excludes_archived(self, client, db, ppm_env):
        """Archived initiatives should not appear in the dashboard."""
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Active Init",
            user_id=admin.id,
        )
        await create_card(
            db,
            card_type="Initiative",
            name="Archived Init",
            user_id=admin.id,
            status="ARCHIVED",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["total_initiatives"] == 1


# ---------------------------------------------------------------------------
# Gantt
# ---------------------------------------------------------------------------


class TestPpmGantt:
    async def test_empty_gantt(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_gantt_returns_initiatives(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Project Alpha",
            user_id=admin.id,
            subtype="Project",
            attributes={
                "initiativeStatus": "Active",
                "startDate": "2026-01-01",
                "endDate": "2026-12-31",
            },
        )
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        item = data[0]
        assert item["name"] == "Project Alpha"
        assert item["subtype"] == "Project"
        assert item["status"] == "Active"
        assert item["start_date"] == "2026-01-01"
        assert item["end_date"] == "2026-12-31"
        assert item["group_id"] is None
        assert item["group_name"] is None

    async def test_gantt_with_group_by(self, client, db, ppm_env):
        """When group_by is specified, initiatives should include group info."""
        admin = ppm_env["admin"]
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Initiative to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        org = await create_card(
            db,
            card_type="Organization",
            name="Engineering",
            user_id=admin.id,
        )
        init = await create_card(
            db,
            card_type="Initiative",
            name="Project Alpha",
            user_id=admin.id,
        )
        await create_relation(
            db,
            type_key="relInitToOrg",
            source_id=init.id,
            target_id=org.id,
        )

        resp = await client.get(
            "/api/v1/reports/ppm/gantt?group_by=Organization",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["group_id"] == str(org.id)
        assert data[0]["group_name"] == "Engineering"

    async def test_gantt_group_by_no_relation(self, client, db, ppm_env):
        """group_by with a type that has no relations returns null group."""
        admin = ppm_env["admin"]
        await create_card(
            db,
            card_type="Initiative",
            name="Solo Project",
            user_id=admin.id,
        )
        resp = await client.get(
            "/api/v1/reports/ppm/gantt?group_by=Organization",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["group_id"] is None
        assert data[0]["group_name"] is None


class TestPpmGanttParent:
    """``parent_id`` names a parent only when that parent is a row on the board.

    The board nests rows by it, and it must never hand out the id of a card the
    caller cannot read (an archived parent, or one hidden by the read scope).
    """

    @staticmethod
    async def _by_name(client, user) -> dict[str, dict]:
        resp = await client.get("/api/v1/reports/ppm/gantt", headers=auth_headers(user))
        assert resp.status_code == 200
        return {i["name"]: i for i in resp.json()}

    async def test_parent_on_the_board_is_emitted(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        program = await create_card(db, card_type="Initiative", name="Program")
        project = await create_card(
            db, card_type="Initiative", name="Project", parent_id=program.id
        )
        await create_card(db, card_type="Initiative", name="Sub", parent_id=project.id)

        items = await self._by_name(client, admin)
        assert items["Program"]["parent_id"] is None
        assert items["Project"]["parent_id"] == str(program.id)
        assert items["Sub"]["parent_id"] == str(project.id)

    async def test_archived_parent_is_not_named(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        gone = await create_card(db, card_type="Initiative", name="Old Program", status="ARCHIVED")
        await create_card(db, card_type="Initiative", name="Orphan", parent_id=gone.id)

        items = await self._by_name(client, admin)
        assert set(items) == {"Orphan"}
        assert items["Orphan"]["parent_id"] is None

    async def test_parent_hidden_by_the_read_scope_is_not_named(self, client, db, ppm_env):
        from sqlalchemy import select

        from app.core.permissions import MEMBER_PERMISSIONS
        from app.models.card_type import CardType
        from app.models.stakeholder import Stakeholder
        from app.services.permission_service import PermissionService
        from tests.conftest import create_stakeholder_role_def

        await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="member@test.com", role="member")
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key="responsible", permissions={"card.view": True}
        )
        program = await create_card(db, card_type="Initiative", name="Secret Program")
        project = await create_card(
            db, card_type="Initiative", name="Held Project", parent_id=program.id
        )
        db.add(Stakeholder(card_id=project.id, user_id=member.id, role="responsible"))
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        resp = await client.get("/api/v1/reports/ppm/gantt", headers=auth_headers(member))
        assert resp.status_code == 200
        body = resp.json()
        assert [i["name"] for i in body] == ["Held Project"]
        assert body[0]["parent_id"] is None
        assert str(program.id) not in resp.text

        # The admin still sees the pair, linked.
        items = await self._by_name(client, ppm_env["admin"])
        assert items["Held Project"]["parent_id"] == str(program.id)


class TestPpmGanttSubtypeGroup:
    """``group_by=subtype:<key>`` groups every row under the top-most initiative
    of that subtype above it; that initiative is the group's anchor.
    """

    @staticmethod
    async def _by_name(client, user, group_by: str) -> dict[str, dict]:
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            params={"group_by": group_by},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        return {i["name"]: i for i in resp.json()}

    async def test_every_level_beneath_is_grouped_to_the_top_most_program(
        self, client, db, ppm_env
    ):
        top = await create_card(db, card_type="Initiative", name="Top", subtype="program")
        project = await create_card(
            db, card_type="Initiative", name="Project", subtype="project", parent_id=top.id
        )
        await create_card(
            db, card_type="Initiative", name="Epic", subtype="epic", parent_id=project.id
        )
        nested = await create_card(
            db, card_type="Initiative", name="Nested", subtype="program", parent_id=top.id
        )
        await create_card(
            db, card_type="Initiative", name="Deep", subtype="project", parent_id=nested.id
        )

        items = await self._by_name(client, ppm_env["admin"], "subtype:program")
        assert {n: (i["group_id"], i["group_name"]) for n, i in items.items()} == {
            name: (str(top.id), "Top") for name in ("Top", "Project", "Epic", "Nested", "Deep")
        }
        assert {n for n, i in items.items() if i["group_anchor"]} == {"Top"}

    async def test_an_initiative_with_no_program_above_is_ungrouped(self, client, db, ppm_env):
        program = await create_card(db, card_type="Initiative", name="Prog", subtype="program")
        await create_card(
            db, card_type="Initiative", name="Inside", subtype="project", parent_id=program.id
        )
        loose = await create_card(db, card_type="Initiative", name="Loose", subtype="project")
        await create_card(
            db, card_type="Initiative", name="Loose child", subtype="epic", parent_id=loose.id
        )

        items = await self._by_name(client, ppm_env["admin"], "subtype:program")
        assert items["Inside"]["group_id"] == str(program.id)
        assert items["Inside"]["group_anchor"] is False
        for name in ("Loose", "Loose child"):
            assert items[name]["group_id"] is None
            assert items[name]["group_name"] is None
            assert items[name]["group_anchor"] is False

    async def test_an_archived_intermediate_breaks_the_chain(self, client, db, ppm_env):
        top = await create_card(db, card_type="Initiative", name="Top", subtype="program")
        gone = await create_card(
            db,
            card_type="Initiative",
            name="Gone",
            subtype="program",
            parent_id=top.id,
            status="ARCHIVED",
        )
        await create_card(
            db, card_type="Initiative", name="Orphan", subtype="project", parent_id=gone.id
        )

        items = await self._by_name(client, ppm_env["admin"], "subtype:program")
        assert set(items) == {"Top", "Orphan"}
        assert items["Top"]["group_anchor"] is True
        assert items["Orphan"]["group_id"] is None

    async def test_a_program_hidden_by_the_read_scope_breaks_the_chain(self, client, db, ppm_env):
        from sqlalchemy import select

        from app.core.permissions import MEMBER_PERMISSIONS
        from app.models.card_type import CardType
        from app.models.stakeholder import Stakeholder
        from app.services.permission_service import PermissionService
        from tests.conftest import create_stakeholder_role_def

        await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="member@test.com", role="member")
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key="responsible", permissions={"card.view": True}
        )
        top = await create_card(db, card_type="Initiative", name="Top", subtype="program")
        secret = await create_card(
            db, card_type="Initiative", name="Secret", subtype="program", parent_id=top.id
        )
        held = await create_card(
            db, card_type="Initiative", name="Held", subtype="project", parent_id=secret.id
        )
        for card in (top, held):
            db.add(Stakeholder(card_id=card.id, user_id=member.id, role="responsible"))
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            params={"group_by": "subtype:program"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        items = {i["name"]: i for i in resp.json()}
        assert set(items) == {"Top", "Held"}
        assert items["Top"]["group_anchor"] is True
        assert items["Held"]["group_id"] is None
        assert str(secret.id) not in resp.text

        # The admin sees the whole chain, grouped under the top-most program.
        admin_items = await self._by_name(client, ppm_env["admin"], "subtype:program")
        assert admin_items["Held"]["group_id"] == str(top.id)
        assert admin_items["Secret"]["group_anchor"] is False

    async def test_an_unknown_subtype_leaves_every_row_ungrouped(self, client, db, ppm_env):
        await create_card(db, card_type="Initiative", name="Prog", subtype="program")
        items = await self._by_name(client, ppm_env["admin"], "subtype:nope")
        assert items["Prog"]["group_id"] is None
        assert items["Prog"]["group_anchor"] is False

    async def test_the_subtype_key_is_matched_exactly(self, client, db, ppm_env):
        await create_card(db, card_type="Initiative", name="Prog", subtype="program")
        items = await self._by_name(client, ppm_env["admin"], "subtype:Program")
        assert items["Prog"]["group_id"] is None

    async def test_type_key_grouping_flags_no_anchor(self, client, db, ppm_env):
        admin = ppm_env["admin"]
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Initiative to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        org = await create_card(db, card_type="Organization", name="Engineering")
        program = await create_card(db, card_type="Initiative", name="Prog", subtype="program")
        await create_relation(db, type_key="relInitToOrg", source_id=program.id, target_id=org.id)

        items = await self._by_name(client, admin, "Organization")
        assert items["Prog"]["group_id"] == str(org.id)
        assert items["Prog"]["group_anchor"] is False


class TestPpmGanttRollup:
    """A parent with no lines or dates of its own shows what is beneath it.

    The derived part travels in ``rollup``; the row's own figures and dates stay
    as recorded, so the board's group totals still count every line once.
    """

    @staticmethod
    async def _by_name(client, user) -> dict[str, dict]:
        resp = await client.get("/api/v1/reports/ppm/gantt", headers=auth_headers(user))
        assert resp.status_code == 200
        return {i["name"]: i for i in resp.json()}

    @staticmethod
    async def _lines(db, card, *, capex=0.0, opex=0.0, capex_actual=0.0, opex_actual=0.0):
        await create_budget_line(db, initiative_id=card.id, category="capex", amount=capex)
        await create_budget_line(db, initiative_id=card.id, category="opex", amount=opex)
        await create_cost_line(db, initiative_id=card.id, category="capex", actual=capex_actual)
        await create_cost_line(db, initiative_id=card.id, category="opex", actual=opex_actual)

    async def test_parent_without_lines_sums_its_children(self, client, db, ppm_env):
        program = await create_card(db, card_type="Initiative", name="Program")
        a = await create_card(db, card_type="Initiative", name="A", parent_id=program.id)
        b = await create_card(db, card_type="Initiative", name="B", parent_id=program.id)
        await self._lines(db, a, capex=100, opex=10, capex_actual=50, opex_actual=5)
        await self._lines(db, b, capex=200, opex=20, capex_actual=70, opex_actual=7)

        items = await self._by_name(client, ppm_env["admin"])
        p = items["Program"]
        assert p["rollup"] == {
            "descendant_count": 2,
            "capex_planned": 300,
            "capex_actual": 120,
            "opex_planned": 30,
            "opex_actual": 12,
            "start_date": None,
            "end_date": None,
        }
        # Its own figures stay what it recorded: nothing.
        assert (p["capex_planned"], p["capex_actual"], p["opex_planned"], p["opex_actual"]) == (
            0,
            0,
            0,
            0,
        )
        assert items["A"]["rollup"] is None
        assert items["A"]["capex_planned"] == 100

    async def test_parent_with_a_zero_budget_line_keeps_its_budget_but_derives_actuals(
        self, client, db, ppm_env
    ):
        # Budget and costs derive on their own: a program that holds the budget
        # while its projects record the spend shows its projects' actuals.
        program = await create_card(db, card_type="Initiative", name="Program")
        child = await create_card(db, card_type="Initiative", name="Child", parent_id=program.id)
        await create_budget_line(db, initiative_id=program.id, category="capex", amount=0)
        await self._lines(db, child, capex=100, capex_actual=30, opex_actual=3)

        rollup = (await self._by_name(client, ppm_env["admin"]))["Program"]["rollup"]
        assert rollup["descendant_count"] == 1
        assert (rollup["capex_planned"], rollup["opex_planned"]) == (None, None)
        assert (rollup["capex_actual"], rollup["opex_actual"]) == (30, 3)

    async def test_parent_with_cost_lines_only_derives_its_budget(self, client, db, ppm_env):
        program = await create_card(db, card_type="Initiative", name="Program")
        child = await create_card(db, card_type="Initiative", name="Child", parent_id=program.id)
        await create_cost_line(db, initiative_id=program.id, category="opex", actual=9)
        await self._lines(db, child, capex=100, opex=10, capex_actual=30)

        items = await self._by_name(client, ppm_env["admin"])
        rollup = items["Program"]["rollup"]
        assert (rollup["capex_planned"], rollup["opex_planned"]) == (100, 10)
        assert (rollup["capex_actual"], rollup["opex_actual"]) == (None, None)
        # Its own actuals stay on the row itself.
        assert items["Program"]["opex_actual"] == 9

    async def test_parent_with_both_kinds_of_line_derives_no_costs(self, client, db, ppm_env):
        program = await create_card(db, card_type="Initiative", name="Program")
        child = await create_card(db, card_type="Initiative", name="Child", parent_id=program.id)
        await create_budget_line(db, initiative_id=program.id, category="capex", amount=0)
        await create_cost_line(db, initiative_id=program.id, category="capex", actual=0)
        await self._lines(db, child, capex=100, capex_actual=30)

        rollup = (await self._by_name(client, ppm_env["admin"]))["Program"]["rollup"]
        assert [rollup[k] for k in ("capex_planned", "capex_actual", "opex_planned")] == [
            None,
            None,
            None,
        ]
        assert rollup["opex_actual"] is None

    async def test_grandchild_figures_reach_the_root(self, client, db, ppm_env):
        root = await create_card(db, card_type="Initiative", name="Root")
        mid = await create_card(db, card_type="Initiative", name="Mid", parent_id=root.id)
        leaf = await create_card(db, card_type="Initiative", name="Leaf", parent_id=mid.id)
        await self._lines(db, leaf, capex=40, opex_actual=4)

        items = await self._by_name(client, ppm_env["admin"])
        assert items["Root"]["rollup"]["descendant_count"] == 2
        assert items["Root"]["rollup"]["capex_planned"] == 40
        assert items["Root"]["rollup"]["opex_actual"] == 4
        assert items["Mid"]["rollup"]["descendant_count"] == 1
        assert items["Mid"]["rollup"]["capex_planned"] == 40

    async def test_parent_without_dates_spans_its_subtree(self, client, db, ppm_env):
        root = await create_card(db, card_type="Initiative", name="Root")
        mid = await create_card(
            db,
            card_type="Initiative",
            name="Mid",
            parent_id=root.id,
            attributes={"startDate": "2026-03-01", "endDate": "2026-09-30"},
        )
        await create_card(
            db,
            card_type="Initiative",
            name="Leaf",
            parent_id=mid.id,
            attributes={"startDate": "2026-01-15", "endDate": "2026-04-30"},
        )

        root_item = (await self._by_name(client, ppm_env["admin"]))["Root"]
        assert root_item["rollup"]["start_date"] == "2026-01-15"
        assert root_item["rollup"]["end_date"] == "2026-09-30"
        assert root_item["start_date"] is None
        assert root_item["end_date"] is None

    async def test_parent_with_only_a_start_date_derives_no_dates(self, client, db, ppm_env):
        root = await create_card(
            db, card_type="Initiative", name="Root", attributes={"startDate": "2026-05-01"}
        )
        await create_card(
            db,
            card_type="Initiative",
            name="Child",
            parent_id=root.id,
            attributes={"startDate": "2026-01-01", "endDate": "2027-01-01"},
        )

        root_item = (await self._by_name(client, ppm_env["admin"]))["Root"]
        assert root_item["rollup"]["start_date"] is None
        assert root_item["rollup"]["end_date"] is None
        assert root_item["start_date"] == "2026-05-01"

    async def test_archived_child_adds_nothing(self, client, db, ppm_env):
        root = await create_card(db, card_type="Initiative", name="Root")
        live = await create_card(db, card_type="Initiative", name="Live", parent_id=root.id)
        gone = await create_card(
            db,
            card_type="Initiative",
            name="Gone",
            parent_id=root.id,
            status="ARCHIVED",
            attributes={"startDate": "2020-01-01", "endDate": "2030-01-01"},
        )
        await self._lines(db, live, capex=10)
        await self._lines(db, gone, capex=999)

        rollup = (await self._by_name(client, ppm_env["admin"]))["Root"]["rollup"]
        assert rollup["descendant_count"] == 1
        assert rollup["capex_planned"] == 10
        assert rollup["start_date"] is None

    async def test_child_hidden_by_the_read_scope_adds_nothing(self, client, db, ppm_env):
        from sqlalchemy import select

        from app.core.permissions import MEMBER_PERMISSIONS
        from app.models.card_type import CardType
        from app.models.stakeholder import Stakeholder
        from app.services.permission_service import PermissionService
        from tests.conftest import create_stakeholder_role_def

        await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="member@test.com", role="member")
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key="responsible", permissions={"card.view": True}
        )
        program = await create_card(db, card_type="Initiative", name="Program")
        seen = await create_card(db, card_type="Initiative", name="Seen", parent_id=program.id)
        secret = await create_card(
            db,
            card_type="Initiative",
            name="Secret",
            parent_id=program.id,
            attributes={"startDate": "2019-01-01", "endDate": "2031-12-31"},
        )
        await self._lines(db, seen, capex=10)
        await self._lines(db, secret, capex=5000)
        for card in (program, seen):
            db.add(Stakeholder(card_id=card.id, user_id=member.id, role="responsible"))
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        items = await self._by_name(client, member)
        assert set(items) == {"Program", "Seen"}
        rollup = items["Program"]["rollup"]
        assert rollup["descendant_count"] == 1
        assert rollup["capex_planned"] == 10
        assert rollup["start_date"] is None
        assert rollup["end_date"] is None

        # The admin sees both children summed.
        admin_rollup = (await self._by_name(client, ppm_env["admin"]))["Program"]["rollup"]
        assert admin_rollup["descendant_count"] == 2
        assert admin_rollup["capex_planned"] == 5010
        assert admin_rollup["start_date"] == "2019-01-01"

    async def test_leaf_has_no_rollup(self, client, db, ppm_env):
        await create_card(db, card_type="Initiative", name="Alone")
        items = await self._by_name(client, ppm_env["admin"])
        assert items["Alone"]["rollup"] is None


# ---------------------------------------------------------------------------
# Group Options
# ---------------------------------------------------------------------------


class TestPpmGroupOptions:
    async def test_no_relation_types(self, client, ppm_env):
        """Without relation types linking Initiative, returns empty list."""
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_related_types(self, client, db, ppm_env):
        """Should return types that Initiative has relation types to."""
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Initiative to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        await create_relation_type(
            db,
            key="relInitToApp",
            label="Initiative to App",
            source_type_key="Initiative",
            target_type_key="Application",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        type_keys = [o["type_key"] for o in data]
        assert "Organization" in type_keys
        assert "Application" in type_keys
        # Should not include Initiative itself
        assert "Initiative" not in type_keys

    async def test_returns_sorted_options(self, client, db, ppm_env):
        """Options should be sorted alphabetically by type_label."""
        await create_relation_type(
            db,
            key="relInitToOrg",
            label="Init to Org",
            source_type_key="Initiative",
            target_type_key="Organization",
        )
        await create_relation_type(
            db,
            key="relInitToApp",
            label="Init to App",
            source_type_key="Initiative",
            target_type_key="Application",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        data = resp.json()
        labels = [o["type_label"] for o in data]
        assert labels == sorted(labels)

    async def test_reverse_relation_included(self, client, db, ppm_env):
        """Relation where Initiative is the target should also appear."""
        await create_relation_type(
            db,
            key="relOrgToInit",
            label="Org to Initiative",
            source_type_key="Organization",
            target_type_key="Initiative",
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        type_keys = [o["type_key"] for o in data]
        assert "Organization" in type_keys

    async def test_hidden_relation_excluded(self, client, db, ppm_env):
        """Hidden relation types should not appear in group options."""
        await create_relation_type(
            db,
            key="relInitToOrgHidden",
            label="Hidden Rel",
            source_type_key="Initiative",
            target_type_key="Organization",
            is_hidden=True,
        )
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# Permission checks
# ---------------------------------------------------------------------------


class TestPpmReportsPermission:
    async def test_viewer_can_access_dashboard(self, client, ppm_env):
        """Viewers have ppm.view=True so they should access the dashboard."""
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_access_gantt(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/gantt",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_access_group_options(self, client, ppm_env):
        resp = await client.get(
            "/api/v1/reports/ppm/group-options",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_unauthenticated_rejected(self, client, ppm_env):
        resp = await client.get("/api/v1/reports/ppm/dashboard")
        assert resp.status_code in (401, 403)

    async def test_no_ppm_permission_denied(self, client, db, ppm_env):
        """A role with ppm.view=False should be denied."""
        await create_role(
            db,
            key="no_ppm",
            label="No PPM",
            permissions={"ppm.view": False, "inventory.view": True},
        )
        user = await create_user(db, email="noppm@test.com", role="no_ppm")
        resp = await client.get(
            "/api/v1/reports/ppm/dashboard",
            headers=auth_headers(user),
        )
        assert resp.status_code == 403
