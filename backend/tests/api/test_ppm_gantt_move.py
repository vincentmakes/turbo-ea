"""POST /ppm/initiatives/{id}/gantt/move — saving a row dragged in the Gantt task list.

Every row created in one test shares ``created_at`` (``now()`` is constant
within the test's transaction), so the fixtures set ``sort_order`` explicitly:
the list order would otherwise be a tie.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_task,
    create_user,
    create_wbs,
)

BASE = "/api/v1/ppm"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions={**VIEWER_PERMISSIONS})
    await create_card_type(db, key="Initiative", label="Initiative")
    admin = await create_user(db, email="admin@test.com", role="admin")
    card = await create_card(db, card_type="Initiative", name="Project", user_id=admin.id)
    return {
        "admin": admin,
        "member": await create_user(db, email="member@test.com", role="member"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
        "initiative": card,
    }


async def _ordered(db, rows):
    for index, row in enumerate(rows):
        row.sort_order = index
    await db.flush()
    return rows


def _url(card) -> str:
    return f"{BASE}/initiatives/{card.id}/gantt/move"


async def _move(client, env, *, kind, item, parent=None, position=0, user=None):
    return await client.post(
        _url(env["initiative"]),
        json={
            "kind": kind,
            "id": str(item.id),
            "parent_wbs_id": str(parent.id) if parent is not None else None,
            "position": position,
        },
        headers=auth_headers(user or env["admin"]),
    )


async def _task_titles(client, env, wbs=None):
    resp = await client.get(
        f"{BASE}/initiatives/{env['initiative'].id}/tasks",
        headers=auth_headers(env["admin"]),
    )
    want = str(wbs.id) if wbs is not None else None
    return [t["title"] for t in resp.json() if t["wbs_id"] == want]


async def _wbs_rows(client, env):
    resp = await client.get(
        f"{BASE}/initiatives/{env['initiative'].id}/wbs",
        headers=auth_headers(env["admin"]),
    )
    return {w["title"]: w for w in resp.json()}, [w["title"] for w in resp.json()]


class TestReorder:
    async def test_moves_a_task_down_among_its_siblings(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg")
        a, b, c = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A", wbs_id=pkg.id),
                await create_task(db, initiative_id=init, title="B", wbs_id=pkg.id),
                await create_task(db, initiative_id=init, title="C", wbs_id=pkg.id),
            ],
        )
        resp = await _move(client, env, kind="task", item=a, parent=pkg, position=2)
        assert resp.status_code == 204
        assert await _task_titles(client, env, pkg) == ["B", "C", "A"]
        assert [a.sort_order, b.sort_order, c.sort_order] == [2, 0, 1]

    async def test_moves_a_task_up_among_its_siblings(self, client, db, env):
        init = env["initiative"].id
        a, b, c = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A"),
                await create_task(db, initiative_id=init, title="B"),
                await create_task(db, initiative_id=init, title="C"),
            ],
        )
        resp = await _move(client, env, kind="task", item=c, position=1)
        assert resp.status_code == 204
        assert await _task_titles(client, env) == ["A", "C", "B"]

    async def test_a_position_past_the_end_appends(self, client, db, env):
        init = env["initiative"].id
        a, _b = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A"),
                await create_task(db, initiative_id=init, title="B"),
            ],
        )
        resp = await _move(client, env, kind="task", item=a, position=99)
        assert resp.status_code == 204
        assert await _task_titles(client, env) == ["B", "A"]
        assert a.sort_order == 1

    async def test_renumbers_siblings_that_shared_order_zero(self, client, db, env):
        init = env["initiative"].id
        first = await create_wbs(db, initiative_id=init, title="First")
        second = await create_wbs(db, initiative_id=init, title="Second")
        third = await create_wbs(db, initiative_id=init, title="Third")
        # All three were created with the default sort_order 0.
        resp = await _move(client, env, kind="wbs", item=third, position=0)
        assert resp.status_code == 204
        assert third.sort_order == 0
        assert sorted([first.sort_order, second.sort_order]) == [1, 2]

    async def test_other_initiatives_rows_are_not_renumbered(self, client, db, env):
        init = env["initiative"].id
        other = await create_card(db, card_type="Initiative", name="Other")
        foreign = await create_task(db, initiative_id=other.id, title="Foreign")
        foreign.sort_order = 7
        a, _b = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A"),
                await create_task(db, initiative_id=init, title="B"),
            ],
        )
        resp = await _move(client, env, kind="task", item=a, position=1)
        assert resp.status_code == 204
        assert foreign.sort_order == 7


class TestReparent:
    async def test_moves_a_task_into_another_work_package(self, client, db, env):
        init = env["initiative"].id
        src = await create_wbs(db, initiative_id=init, title="Src")
        dst = await create_wbs(db, initiative_id=init, title="Dst")
        moved = await create_task(
            db,
            initiative_id=init,
            title="Moved",
            wbs_id=src.id,
            status="done",
            start_date=date(2026, 5, 1),
            due_date=date(2026, 5, 10),
        )
        kept = await create_task(
            db,
            initiative_id=init,
            title="Kept",
            wbs_id=src.id,
            start_date=date(2026, 1, 1),
            due_date=date(2026, 1, 10),
        )
        existing = await create_task(
            db,
            initiative_id=init,
            title="Existing",
            wbs_id=dst.id,
            start_date=date(2026, 3, 1),
            due_date=date(2026, 3, 10),
        )
        await _ordered(db, [kept])
        await _ordered(db, [existing])

        resp = await _move(client, env, kind="task", item=moved, parent=dst, position=0)
        assert resp.status_code == 204
        assert await _task_titles(client, env, dst) == ["Moved", "Existing"]
        assert await _task_titles(client, env, src) == ["Kept"]

        rows, _ = await _wbs_rows(client, env)
        # The new parent's dates widen to the moved task and its completion counts it.
        assert rows["Dst"]["start_date"] == "2026-03-01"
        assert rows["Dst"]["end_date"] == "2026-05-10"
        assert rows["Dst"]["completion"] == 50.0
        # The old parent shrinks to the task it kept, which is not done.
        assert rows["Src"]["end_date"] == "2026-01-10"
        assert rows["Src"]["completion"] == 0.0

    async def test_moves_a_task_to_the_top_level(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg")
        task = await create_task(db, initiative_id=init, title="T", wbs_id=pkg.id)
        resp = await _move(client, env, kind="task", item=task, parent=None, position=0)
        assert resp.status_code == 204
        assert task.wbs_id is None
        assert await _task_titles(client, env) == ["T"]

    async def test_moves_a_work_package_under_another(self, client, db, env):
        init = env["initiative"].id
        outer = await create_wbs(db, initiative_id=init, title="Outer")
        inner = await create_wbs(db, initiative_id=init, title="Inner")
        await create_task(
            db,
            initiative_id=init,
            title="T",
            wbs_id=inner.id,
            status="done",
            start_date=date(2026, 6, 1),
            due_date=date(2026, 6, 30),
        )
        resp = await _move(client, env, kind="wbs", item=inner, parent=outer, position=0)
        assert resp.status_code == 204
        rows, _ = await _wbs_rows(client, env)
        assert rows["Inner"]["parent_id"] == str(outer.id)
        # The new parent rolls up the subtree it gained.
        assert rows["Outer"]["completion"] == 100.0
        assert rows["Outer"]["start_date"] == "2026-06-01"
        assert rows["Outer"]["end_date"] == "2026-06-30"

    async def test_a_reorder_without_a_new_parent_runs_no_rollup(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg", completion=40.0)
        a, _b = await _ordered(
            db,
            [
                await create_wbs(db, initiative_id=init, title="A", parent_id=pkg.id),
                await create_wbs(db, initiative_id=init, title="B", parent_id=pkg.id),
            ],
        )
        await create_task(db, initiative_id=init, title="Done", wbs_id=a.id, status="done")
        resp = await _move(client, env, kind="wbs", item=a, parent=pkg, position=1)
        assert resp.status_code == 204
        # A roll-up would have set the parent to 100 from the done task.
        assert pkg.completion == 40.0
        _, order = await _wbs_rows(client, env)
        assert order.index("B") < order.index("A")


class TestRejected:
    async def test_a_work_package_cannot_move_into_its_descendant(self, client, db, env):
        init = env["initiative"].id
        top = await create_wbs(db, initiative_id=init, title="Top")
        child = await create_wbs(db, initiative_id=init, title="Child", parent_id=top.id)
        resp = await _move(client, env, kind="wbs", item=top, parent=child)
        assert resp.status_code == 400
        assert top.parent_id is None

    async def test_a_work_package_cannot_move_into_itself(self, client, db, env):
        top = await create_wbs(db, initiative_id=env["initiative"].id, title="Top")
        resp = await _move(client, env, kind="wbs", item=top, parent=top)
        assert resp.status_code == 400

    async def test_a_milestone_cannot_hold_items(self, client, db, env):
        init = env["initiative"].id
        milestone = await create_wbs(db, initiative_id=init, title="M", is_milestone=True)
        task = await create_task(db, initiative_id=init, title="T")
        resp = await _move(client, env, kind="task", item=task, parent=milestone)
        assert resp.status_code == 400
        assert task.wbs_id is None

    async def test_a_parent_from_another_initiative_is_refused(self, client, db, env):
        other = await create_card(db, card_type="Initiative", name="Other")
        foreign = await create_wbs(db, initiative_id=other.id, title="Foreign")
        task = await create_task(db, initiative_id=env["initiative"].id, title="T")
        resp = await _move(client, env, kind="task", item=task, parent=foreign)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Parent WBS item not found in this initiative"
        assert task.wbs_id is None

    async def test_an_unknown_parent_is_refused(self, client, db, env):
        task = await create_task(db, initiative_id=env["initiative"].id, title="T")
        resp = await client.post(
            _url(env["initiative"]),
            json={
                "kind": "task",
                "id": str(task.id),
                "parent_wbs_id": str(uuid.uuid4()),
                "position": 0,
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Parent WBS item not found in this initiative"

    async def test_an_item_of_another_initiative_is_404(self, client, db, env):
        other = await create_card(db, card_type="Initiative", name="Other")
        foreign = await create_task(db, initiative_id=other.id, title="Foreign")
        resp = await _move(client, env, kind="task", item=foreign)
        assert resp.status_code == 404

    async def test_the_kind_must_match_the_row(self, client, db, env):
        pkg = await create_wbs(db, initiative_id=env["initiative"].id, title="Pkg")
        resp = await _move(client, env, kind="task", item=pkg)
        assert resp.status_code == 404

    async def test_a_negative_position_is_422(self, client, db, env):
        task = await create_task(db, initiative_id=env["initiative"].id, title="T")
        resp = await _move(client, env, kind="task", item=task, position=-1)
        assert resp.status_code == 422

    async def test_a_malformed_id_is_422(self, client, env):
        resp = await client.post(
            _url(env["initiative"]),
            json={"kind": "task", "id": "nope", "parent_wbs_id": None, "position": 0},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422


class TestPermissions:
    async def test_needs_ppm_manage(self, client, db, env):
        task = await create_task(db, initiative_id=env["initiative"].id, title="T")
        resp = await _move(client, env, kind="task", item=task, user=env["viewer"])
        assert resp.status_code == 403

    async def test_a_member_may_move(self, client, db, env):
        init = env["initiative"].id
        a, _b = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A"),
                await create_task(db, initiative_id=init, title="B"),
            ],
        )
        resp = await _move(client, env, kind="task", item=a, position=1, user=env["member"])
        assert resp.status_code == 204

    async def test_a_hidden_initiative_is_404(self, client, db, env):
        from app.models.card_type import CardType
        from app.services.permission_service import PermissionService

        task = await create_task(db, initiative_id=env["initiative"].id, title="T")
        ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()

        resp = await _move(client, env, kind="task", item=task, position=0, user=env["member"])
        assert resp.status_code == 404


class TestMilestoneChildren:
    async def test_rows_already_under_a_milestone_can_be_reordered(self, client, db, env):
        init = env["initiative"].id
        milestone = await create_wbs(db, initiative_id=init, title="M", is_milestone=True)
        a, _b = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A", wbs_id=milestone.id),
                await create_task(db, initiative_id=init, title="B", wbs_id=milestone.id),
            ],
        )
        resp = await _move(client, env, kind="task", item=a, parent=milestone, position=1)
        assert resp.status_code == 204
        assert await _task_titles(client, env, milestone) == ["B", "A"]


class TestNewRowsGoLast:
    """After a drag has renumbered a group 0..n-1, a row created or re-parented
    without an explicit order must land last, not second (default 0)."""

    async def test_a_new_task_goes_last_after_a_move(self, client, db, env):
        init = env["initiative"].id
        a, _b, c = await _ordered(
            db,
            [
                await create_task(db, initiative_id=init, title="A"),
                await create_task(db, initiative_id=init, title="B"),
                await create_task(db, initiative_id=init, title="C"),
            ],
        )
        await _move(client, env, kind="task", item=c, position=0)
        resp = await client.post(
            f"{BASE}/initiatives/{init}/tasks",
            json={"title": "D"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["sort_order"] == 3
        assert await _task_titles(client, env) == ["C", "A", "B", "D"]

    async def test_a_new_task_counts_only_its_own_work_package(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg")
        elsewhere = await create_task(db, initiative_id=init, title="Elsewhere")
        elsewhere.sort_order = 9
        inside = await create_task(db, initiative_id=init, title="Inside", wbs_id=pkg.id)
        inside.sort_order = 2
        other = await create_card(db, card_type="Initiative", name="Other")
        foreign = await create_task(db, initiative_id=other.id, title="Foreign", wbs_id=None)
        foreign.sort_order = 50
        await db.flush()
        resp = await client.post(
            f"{BASE}/initiatives/{init}/tasks",
            json={"title": "New", "wbs_id": str(pkg.id)},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 3

    async def test_the_first_task_of_a_group_is_zero(self, client, env):
        resp = await client.post(
            f"{BASE}/initiatives/{env['initiative'].id}/tasks",
            json={"title": "First"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 0

    async def test_an_explicit_order_is_kept(self, client, db, env):
        init = env["initiative"].id
        (a,) = await _ordered(db, [await create_task(db, initiative_id=init, title="A")])
        a.sort_order = 5
        await db.flush()
        resp = await client.post(
            f"{BASE}/initiatives/{init}/tasks",
            json={"title": "B", "sort_order": 0},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 0

    async def test_a_new_work_package_goes_last_under_its_parent(self, client, db, env):
        init = env["initiative"].id
        top = await create_wbs(db, initiative_id=init, title="Top")
        child = await create_wbs(db, initiative_id=init, title="Child", parent_id=top.id)
        child.sort_order = 4
        sibling = await create_wbs(db, initiative_id=init, title="Sibling")
        sibling.sort_order = 8
        await db.flush()
        resp = await client.post(
            f"{BASE}/initiatives/{init}/wbs",
            json={"title": "New", "parent_id": str(top.id)},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 5
        resp = await client.post(
            f"{BASE}/initiatives/{init}/wbs",
            json={"title": "Pinned", "sort_order": 1},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 1

    async def test_a_task_moved_by_the_dialog_goes_last_in_its_new_package(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg")
        there = await create_task(db, initiative_id=init, title="There", wbs_id=pkg.id)
        there.sort_order = 3
        moved = await create_task(db, initiative_id=init, title="Moved")
        await db.flush()
        resp = await client.patch(
            f"{BASE}/tasks/{moved.id}",
            json={"wbs_id": str(pkg.id)},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 4

    async def test_a_dialog_save_that_keeps_the_package_keeps_the_order(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg")
        task = await create_task(db, initiative_id=init, title="T", wbs_id=pkg.id)
        task.sort_order = 2
        await create_task(db, initiative_id=init, title="Later", wbs_id=pkg.id)
        await db.flush()
        resp = await client.patch(
            f"{BASE}/tasks/{task.id}",
            json={"wbs_id": str(pkg.id), "title": "Renamed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 2

    async def test_a_dialog_reparent_with_an_explicit_order_keeps_it(self, client, db, env):
        init = env["initiative"].id
        pkg = await create_wbs(db, initiative_id=init, title="Pkg")
        there = await create_task(db, initiative_id=init, title="There", wbs_id=pkg.id)
        there.sort_order = 3
        moved = await create_task(db, initiative_id=init, title="Moved")
        await db.flush()
        resp = await client.patch(
            f"{BASE}/tasks/{moved.id}",
            json={"wbs_id": str(pkg.id), "sort_order": 0},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 0

    async def test_a_work_package_moved_by_the_dialog_goes_last(self, client, db, env):
        init = env["initiative"].id
        top = await create_wbs(db, initiative_id=init, title="Top")
        child = await create_wbs(db, initiative_id=init, title="Child", parent_id=top.id)
        child.sort_order = 6
        moved = await create_wbs(db, initiative_id=init, title="Moved")
        moved.sort_order = 1
        await db.flush()
        resp = await client.patch(
            f"{BASE}/wbs/{moved.id}",
            json={"parent_id": str(top.id)},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 7
        # Saving the dialog again with the same parent keeps that place.
        resp = await client.patch(
            f"{BASE}/wbs/{moved.id}",
            json={"parent_id": str(top.id), "title": "Renamed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["sort_order"] == 7

    async def test_a_work_package_moved_to_the_top_level_goes_last(self, client, db, env):
        init = env["initiative"].id
        top = await create_wbs(db, initiative_id=init, title="Top")
        top.sort_order = 2
        child = await create_wbs(db, initiative_id=init, title="Child", parent_id=top.id)
        await db.flush()
        resp = await client.patch(
            f"{BASE}/wbs/{child.id}",
            json={"parent_id": None},
            headers=auth_headers(env["admin"]),
        )
        assert resp.json()["parent_id"] is None
        assert resp.json()["sort_order"] == 3
