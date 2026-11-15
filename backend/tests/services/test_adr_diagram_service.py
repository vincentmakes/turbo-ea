"""``adr_diagram_service``: the live links from a decision to free-draw diagrams.

Database-backed: the helpers flush on the test's session and never commit.
The routes' gate order and status codes are in ``tests/api/test_adr_diagrams.py``.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_diagram import ArchitectureDecisionDiagram
from app.services import adr_diagram_service as svc
from tests.conftest import create_diagram, create_role, create_user

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="blind", label="Blind", permissions={"adr.manage": True})
    a = ArchitectureDecision(reference_number="ADR-971", title="A")
    b = ArchitectureDecision(reference_number="ADR-972", title="B")
    db.add_all([a, b])
    await db.flush()
    return {
        "admin": await create_user(db, email="svc-admin@test.com", role="admin"),
        "blind": await create_user(db, email="svc-blind@test.com", role="blind"),
        "a": a,
        "b": b,
        "d1": await create_diagram(db, name="One", data={"xml": "<x/>", "thumbnail": "T1"}),
        "d2": await create_diagram(db, name="Two", data={"xml": "<x/>"}),
        "d3": await create_diagram(db, name="Three", data={"xml": "<x/>"}),
    }


async def _linked(db, decision_id) -> set[uuid.UUID]:
    rows = await db.execute(
        select(ArchitectureDecisionDiagram.diagram_id).where(
            ArchitectureDecisionDiagram.architecture_decision_id == decision_id
        )
    )
    return set(rows.scalars().all())


class TestCanView:
    async def test_admin_yes_blind_no(self, db, env):
        assert await svc.can_view_diagrams(db, env["admin"]) is True
        assert await svc.can_view_diagrams(db, env["blind"]) is False


class TestResolve:
    async def test_none_stays_none(self, db, env):
        assert await svc.resolve_diagram_ids(db, env["admin"], None) is None
        assert await svc.resolve_diagram_ids(db, env["blind"], None) is None

    async def test_dedupes_in_first_seen_order(self, db, env):
        d1, d2 = env["d1"].id, env["d2"].id
        got = await svc.resolve_diagram_ids(db, env["admin"], [str(d2), str(d1), str(d2)])
        assert got == [d2, d1]

    async def test_empty_with_permission_is_an_empty_list(self, db, env):
        assert await svc.resolve_diagram_ids(db, env["admin"], []) == []

    async def test_empty_without_permission_is_none(self, db, env):
        assert await svc.resolve_diagram_ids(db, env["blind"], []) is None

    async def test_non_empty_without_permission_404(self, db, env):
        with pytest.raises(HTTPException) as exc:
            await svc.resolve_diagram_ids(db, env["blind"], [str(env["d1"].id)])
        assert exc.value.status_code == 404
        assert exc.value.detail == "Diagram not found"

    @pytest.mark.parametrize("bad", ["nope", str(uuid.UUID(int=7))])
    async def test_malformed_or_unknown_404(self, db, env, bad):
        with pytest.raises(HTTPException) as exc:
            await svc.resolve_diagram_ids(db, env["admin"], [str(env["d1"].id), bad])
        assert exc.value.status_code == 404
        assert exc.value.detail == "Diagram not found"

    async def test_resolve_one(self, db, env):
        assert await svc.resolve_one(db, env["admin"], str(env["d3"].id)) == env["d3"].id
        for user, value in (
            (env["blind"], str(env["d3"].id)),
            (env["admin"], "nope"),
            (env["admin"], str(uuid.UUID(int=9))),
        ):
            with pytest.raises(HTTPException) as exc:
                await svc.resolve_one(db, user, value)
            assert exc.value.status_code == 404
            assert exc.value.detail == "Diagram not found"


class TestWrites:
    async def test_add_then_duplicate_409(self, db, env):
        a, d1 = env["a"].id, env["d1"].id
        await svc.add_link(db, a, d1)
        assert await _linked(db, a) == {d1}
        with pytest.raises(HTTPException) as exc:
            await svc.add_link(db, a, d1)
        assert exc.value.status_code == 409
        assert await _linked(db, a) == {d1}

    async def test_remove_and_missing_404(self, db, env):
        a, d1, d2 = env["a"].id, env["d1"].id, env["d2"].id
        await svc.add_link(db, a, d1)
        await svc.add_link(db, a, d2)
        await svc.remove_link(db, a, d1)
        assert await _linked(db, a) == {d2}
        with pytest.raises(HTTPException) as exc:
            await svc.remove_link(db, a, d1)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Link not found"

    async def test_replace(self, db, env):
        a, b = env["a"].id, env["b"].id
        d1, d2, d3 = env["d1"].id, env["d2"].id, env["d3"].id
        await svc.add_link(db, b, d1)
        await svc.replace_links(db, a, [d1, d2])
        assert await _linked(db, a) == {d1, d2}
        await svc.replace_links(db, a, [d2, d3])
        assert await _linked(db, a) == {d2, d3}
        await svc.replace_links(db, a, None)
        assert await _linked(db, a) == {d2, d3}
        await svc.replace_links(db, a, [])
        assert await _linked(db, a) == set()
        # Another decision's links are untouched.
        assert await _linked(db, b) == {d1}

    async def test_copy_links(self, db, env):
        a, b = env["a"].id, env["b"].id
        d1, d2 = env["d1"].id, env["d2"].id
        await svc.replace_links(db, a, [d1, d2])
        assert await svc.copy_links(db, a, b) == 2
        assert await _linked(db, b) == {d1, d2}
        assert await _linked(db, a) == {d1, d2}
        assert await svc.linked_ids(db, a) == sorted([d1, d2])

    async def test_copy_nothing(self, db, env):
        assert await svc.copy_links(db, env["a"].id, env["b"].id) == 0
        assert await _linked(db, env["b"].id) == set()


class TestPayload:
    async def test_rows_and_order(self, db, env):
        a = env["a"].id
        await svc.replace_links(db, a, [env["d1"].id, env["d2"].id, env["d3"].id])
        rows = await svc.diagrams_payload(db, a)
        assert [r["name"] for r in rows] == ["One", "Three", "Two"]
        assert rows[0] == {
            "id": str(env["d1"].id),
            "name": "One",
            "thumbnail": "T1",
            "updated_at": env["d1"].updated_at.isoformat(),
        }
        assert rows[1]["thumbnail"] is None

    async def test_for_reader(self, db, env):
        a = env["a"].id
        await svc.add_link(db, a, env["d1"].id)
        assert [r["id"] for r in await svc.diagrams_for_reader(db, env["admin"], a)] == [
            str(env["d1"].id)
        ]
        assert await svc.diagrams_for_reader(db, env["blind"], a) == []

    async def test_thumbnail_cap_boundary(self, db, env):
        a = env["a"].id
        exact = await create_diagram(
            db, name="A exact", data={"thumbnail": "x" * svc.MAX_THUMBNAIL_CHARS}
        )
        over = await create_diagram(
            db, name="B over", data={"thumbnail": "x" * (svc.MAX_THUMBNAIL_CHARS + 1)}
        )
        await svc.replace_links(db, a, [exact.id, over.id])
        rows = await svc.diagrams_payload(db, a)
        assert [r["name"] for r in rows] == ["A exact", "B over"]
        assert len(rows[0]["thumbnail"]) == svc.MAX_THUMBNAIL_CHARS
        assert rows[1]["thumbnail"] is None
