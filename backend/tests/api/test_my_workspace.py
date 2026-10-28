"""Integration tests for the My Workspace dashboard tab endpoints.

Covers:
- ``GET/PATCH /users/me/ui-preferences``
- ``GET /cards/my-stakeholder``
- ``GET /cards/my-created``
- ``GET /events/my-cards``
- ``GET /reports/my-workspace``
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.todo import Todo
from app.models.user_favorite import UserFavorite
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

# ---------------------------------------------------------------------------
# UI preferences
# ---------------------------------------------------------------------------


class TestUiPreferences:
    async def test_get_returns_default_when_unset(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get("/api/v1/users/me/ui-preferences", headers=auth_headers(user))
        assert resp.status_code == 200
        assert resp.json() == {"dashboard_default_tab": "overview"}

    async def test_patch_sets_default_tab(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": "workspace"},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["dashboard_default_tab"] == "workspace"

        # Persists across calls.
        get_resp = await client.get("/api/v1/users/me/ui-preferences", headers=auth_headers(user))
        assert get_resp.json()["dashboard_default_tab"] == "workspace"

    async def test_patch_null_unsets_pin(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": "workspace"},
            headers=auth_headers(user),
        )
        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": None},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        assert "dashboard_default_tab" not in resp.json()

    async def test_patch_invalid_value_rejected(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            # Any dashboard key is accepted now; one that is not key-shaped is not.
            json={"dashboard_default_tab": "Garbage Value!"},
            headers=auth_headers(user),
        )
        assert resp.status_code == 422

    async def test_auth_me_includes_ui_preferences(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get("/api/v1/auth/me", headers=auth_headers(user))
        assert resp.status_code == 200
        body = resp.json()
        assert body["ui_preferences"] == {"dashboard_default_tab": "overview"}

    async def test_viewer_can_set_own_ui_preferences(self, client, db):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        viewer = await create_user(db, role="viewer")

        resp = await client.patch(
            "/api/v1/users/me/ui-preferences",
            json={"dashboard_default_tab": "workspace"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200
        assert resp.json()["dashboard_default_tab"] == "workspace"

    async def test_requires_auth(self, client, db):
        resp = await client.get("/api/v1/users/me/ui-preferences")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /cards/my-stakeholder
# ---------------------------------------------------------------------------


class TestMyStakeholderCards:
    @pytest.fixture
    async def env(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="Hidden", label="Hidden", is_hidden=True)
        # Stakeholder role definitions for Application — the endpoint uses
        # them to resolve role labels, colours and translations.
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="observer",
            label="Observer",
        )
        admin = await create_user(db, email="admin@test.com", role="admin")
        alice = await create_user(db, email="alice@test.com", role="member")
        bob = await create_user(db, email="bob@test.com", role="member")
        return {"admin": admin, "alice": alice, "bob": bob}

    async def test_returns_only_own_stakeholder_cards(self, client, db, env):
        c1 = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
        c2 = await create_card(db, card_type="Application", name="B", user_id=env["admin"].id)
        c3 = await create_card(db, card_type="Application", name="C", user_id=env["admin"].id)
        db.add(Stakeholder(card_id=c1.id, user_id=env["alice"].id, role="responsible"))
        db.add(Stakeholder(card_id=c2.id, user_id=env["bob"].id, role="responsible"))
        db.add(Stakeholder(card_id=c3.id, user_id=env["alice"].id, role="observer"))
        await db.flush()

        resp = await client.get("/api/v1/cards/my-stakeholder", headers=auth_headers(env["alice"]))
        assert resp.status_code == 200
        body = resp.json()
        names = {item["name"] for item in body["items"]}
        assert names == {"A", "C"}
        c1_roles = body["roles_by_card_id"][str(c1.id)]
        assert {r["key"] for r in c1_roles} == {"responsible"}
        assert c1_roles[0]["label"] == "Responsible"
        c3_roles = body["roles_by_card_id"][str(c3.id)]
        assert {r["key"] for r in c3_roles} == {"observer"}
        assert c3_roles[0]["label"] == "Observer"

    async def test_aggregates_multiple_roles_per_card(self, client, db, env):
        card = await create_card(
            db, card_type="Application", name="MultiRole", user_id=env["admin"].id
        )
        db.add(Stakeholder(card_id=card.id, user_id=env["alice"].id, role="responsible"))
        db.add(Stakeholder(card_id=card.id, user_id=env["alice"].id, role="observer"))
        await db.flush()

        resp = await client.get("/api/v1/cards/my-stakeholder", headers=auth_headers(env["alice"]))
        body = resp.json()
        assert len(body["items"]) == 1
        roles = body["roles_by_card_id"][str(card.id)]
        assert {r["key"] for r in roles} == {"responsible", "observer"}
        labels = {r["label"] for r in roles}
        assert labels == {"Responsible", "Observer"}

    async def test_unknown_role_falls_back_to_key(self, client, db, env):
        """If a stakeholder row references a role with no SRD (e.g. it was
        archived), the endpoint should still return the row using the role
        key as the label fallback rather than dropping the card."""
        card = await create_card(
            db, card_type="Application", name="OrphanRole", user_id=env["admin"].id
        )
        db.add(Stakeholder(card_id=card.id, user_id=env["alice"].id, role="legacy_role"))
        await db.flush()

        resp = await client.get("/api/v1/cards/my-stakeholder", headers=auth_headers(env["alice"]))
        body = resp.json()
        roles = body["roles_by_card_id"][str(card.id)]
        assert roles == [
            {"key": "legacy_role", "label": "legacy_role", "color": "#757575", "translations": {}}
        ]

    async def test_excludes_hidden_card_types(self, client, db, env):
        visible = await create_card(
            db, card_type="Application", name="Visible", user_id=env["admin"].id
        )
        hidden = await create_card(db, card_type="Hidden", name="Hidden", user_id=env["admin"].id)
        db.add(Stakeholder(card_id=visible.id, user_id=env["alice"].id, role="responsible"))
        db.add(Stakeholder(card_id=hidden.id, user_id=env["alice"].id, role="responsible"))
        await db.flush()

        resp = await client.get("/api/v1/cards/my-stakeholder", headers=auth_headers(env["alice"]))
        names = {item["name"] for item in resp.json()["items"]}
        assert names == {"Visible"}

    async def test_excludes_archived_cards(self, client, db, env):
        active = await create_card(
            db, card_type="Application", name="Active", user_id=env["admin"].id
        )
        archived = await create_card(
            db,
            card_type="Application",
            name="Archived",
            user_id=env["admin"].id,
            status="ARCHIVED",
        )
        db.add(Stakeholder(card_id=active.id, user_id=env["alice"].id, role="responsible"))
        db.add(Stakeholder(card_id=archived.id, user_id=env["alice"].id, role="responsible"))
        await db.flush()

        resp = await client.get("/api/v1/cards/my-stakeholder", headers=auth_headers(env["alice"]))
        names = {item["name"] for item in resp.json()["items"]}
        assert names == {"Active"}

    async def test_user_id_param_returns_target_user_cards(self, client, db, env):
        """`?user_id=` lets a permitted caller look up someone else's
        stakeholder portfolio — the same shape as the no-arg response."""
        c1 = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
        c2 = await create_card(db, card_type="Application", name="B", user_id=env["admin"].id)
        db.add(Stakeholder(card_id=c1.id, user_id=env["alice"].id, role="responsible"))
        db.add(Stakeholder(card_id=c2.id, user_id=env["bob"].id, role="responsible"))
        await db.flush()

        # Admin caller, scoped to Alice → only Alice's cards.
        resp = await client.get(
            f"/api/v1/cards/my-stakeholder?user_id={env['alice'].id}",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        names = {item["name"] for item in resp.json()["items"]}
        assert names == {"A"}

    async def test_user_id_omitted_still_returns_caller_cards(self, client, db, env):
        """Regression guard: existing consumers that hit `/cards/my-stakeholder`
        with no params keep getting the caller's own cards."""
        c1 = await create_card(db, card_type="Application", name="A", user_id=env["admin"].id)
        c2 = await create_card(db, card_type="Application", name="B", user_id=env["admin"].id)
        db.add(Stakeholder(card_id=c1.id, user_id=env["alice"].id, role="responsible"))
        db.add(Stakeholder(card_id=c2.id, user_id=env["bob"].id, role="responsible"))
        await db.flush()

        resp = await client.get("/api/v1/cards/my-stakeholder", headers=auth_headers(env["alice"]))
        names = {item["name"] for item in resp.json()["items"]}
        assert names == {"A"}

    async def test_user_id_param_denied_without_stakeholders_view(self, client, db, env):
        """A caller whose role lacks `stakeholders.view` cannot look up
        another user's portfolio. Self-lookup must still work."""
        # Custom role that has inventory.view but NOT stakeholders.view.
        await create_role(
            db,
            key="no_stakeholder_view",
            label="No Stakeholder View",
            permissions={"inventory.view": True, "stakeholders.view": False},
            is_system=False,
        )
        no_perm_user = await create_user(db, email="noperm@test.com", role="no_stakeholder_view")

        # Cross-user lookup → 403.
        resp = await client.get(
            f"/api/v1/cards/my-stakeholder?user_id={env['alice'].id}",
            headers=auth_headers(no_perm_user),
        )
        assert resp.status_code == 403

        # Self-lookup with same user_id still works (no permission needed).
        resp = await client.get(
            f"/api/v1/cards/my-stakeholder?user_id={no_perm_user.id}",
            headers=auth_headers(no_perm_user),
        )
        assert resp.status_code == 200

    async def test_user_id_unknown_returns_404(self, client, db, env):
        import uuid

        ghost_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/cards/my-stakeholder?user_id={ghost_id}",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /cards/my-created
# ---------------------------------------------------------------------------


class TestMyCreatedCards:
    async def test_returns_only_cards_user_created(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        alice = await create_user(db, email="alice@test.com", role="member")

        await create_card(db, name="By admin", user_id=admin.id)
        await create_card(db, name="By alice 1", user_id=alice.id)
        await create_card(db, name="By alice 2", user_id=alice.id)

        resp = await client.get("/api/v1/cards/my-created", headers=auth_headers(alice))
        assert resp.status_code == 200
        body = resp.json()
        names = {c["name"] for c in body["items"]}
        assert names == {"By alice 1", "By alice 2"}
        assert body["total"] == 2
        assert body["has_more"] is False

    async def test_excludes_archived(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")

        await create_card(db, name="Active", user_id=admin.id)
        await create_card(db, name="Archived", user_id=admin.id, status="ARCHIVED")

        resp = await client.get("/api/v1/cards/my-created", headers=auth_headers(admin))
        names = {c["name"] for c in resp.json()["items"]}
        assert names == {"Active"}

    async def test_pagination_via_offset_and_limit(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")

        # Create 12 cards with deterministic names so we can spot-check
        # that order is preserved across pages (created_at desc).
        for i in range(12):
            await create_card(db, name=f"Card {i:02d}", user_id=admin.id)

        first = await client.get(
            "/api/v1/cards/my-created?limit=5&offset=0", headers=auth_headers(admin)
        )
        assert first.status_code == 200
        body1 = first.json()
        assert body1["total"] == 12
        assert body1["has_more"] is True
        assert len(body1["items"]) == 5

        second = await client.get(
            "/api/v1/cards/my-created?limit=5&offset=5", headers=auth_headers(admin)
        )
        body2 = second.json()
        assert body2["has_more"] is True
        assert len(body2["items"]) == 5

        third = await client.get(
            "/api/v1/cards/my-created?limit=5&offset=10", headers=auth_headers(admin)
        )
        body3 = third.json()
        assert body3["has_more"] is False
        assert len(body3["items"]) == 2

        # All three pages combined should equal the full set with no
        # duplicates.
        names = (
            {c["name"] for c in body1["items"]}
            | {c["name"] for c in body2["items"]}
            | {c["name"] for c in body3["items"]}
        )
        assert len(names) == 12


# ---------------------------------------------------------------------------
# /events/my-cards
# ---------------------------------------------------------------------------


class TestMyCardsEvents:
    async def test_includes_events_on_favorited_and_stakeholder_cards(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        alice = await create_user(db, email="alice@test.com", role="member")

        favorited = await create_card(db, name="Fav", user_id=admin.id)
        stakeholder_card = await create_card(db, name="Role", user_id=admin.id)
        unrelated = await create_card(db, name="Other", user_id=admin.id)

        db.add(UserFavorite(user_id=alice.id, card_id=favorited.id))
        db.add(Stakeholder(card_id=stakeholder_card.id, user_id=alice.id, role="responsible"))
        for c in (favorited, stakeholder_card, unrelated):
            db.add(
                Event(
                    card_id=c.id,
                    event_type="card.updated",
                    user_id=admin.id,
                    data={"name": c.name},
                )
            )
        await db.flush()

        resp = await client.get("/api/v1/events/my-cards", headers=auth_headers(alice))
        assert resp.status_code == 200
        names = {e["card_name"] for e in resp.json()}
        assert names == {"Fav", "Role"}


# ---------------------------------------------------------------------------
# /reports/my-workspace
# ---------------------------------------------------------------------------


class TestMyWorkspaceReport:
    async def test_zero_counters_for_new_user(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")

        resp = await client.get("/api/v1/reports/my-workspace", headers=auth_headers(user))
        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "favorite_count": 0,
            "stakeholder_card_count": 0,
            "open_todo_count": 0,
            "pending_survey_count": 0,
            "attention_count": 0,
            "overdue_todo_count": 0,
            "broken_card_count": 0,
            "created_count": 0,
        }

    async def test_full_counter_breakdown(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        alice = await create_user(db, email="alice@test.com", role="member")

        # 2 favorites
        c_fav1 = await create_card(db, name="Fav1", user_id=admin.id)
        c_fav2 = await create_card(db, name="Fav2", user_id=admin.id)
        db.add(UserFavorite(user_id=alice.id, card_id=c_fav1.id))
        db.add(UserFavorite(user_id=alice.id, card_id=c_fav2.id))

        # 3 stakeholder cards (one with two roles → still counts as 1 distinct card)
        s1 = await create_card(db, name="S1", user_id=admin.id)
        s2 = await create_card(db, name="S2", user_id=admin.id)
        s3 = await create_card(db, name="S3", user_id=admin.id)
        db.add(Stakeholder(card_id=s1.id, user_id=alice.id, role="responsible"))
        db.add(Stakeholder(card_id=s1.id, user_id=alice.id, role="observer"))
        db.add(Stakeholder(card_id=s2.id, user_id=alice.id, role="responsible"))
        db.add(Stakeholder(card_id=s3.id, user_id=alice.id, role="responsible"))

        # 2 open todos, 1 of which overdue, 1 done (excluded)
        db.add(Todo(description="t1 open", status="open", assigned_to=alice.id))
        db.add(
            Todo(
                description="t2 overdue",
                status="open",
                assigned_to=alice.id,
                due_date=date.today() - timedelta(days=2),
            )
        )
        db.add(Todo(description="t3 done", status="done", assigned_to=alice.id))

        # 1 broken card she's responsible for
        broken = await create_card(db, name="Broken", user_id=admin.id, approval_status="BROKEN")
        db.add(Stakeholder(card_id=broken.id, user_id=alice.id, role="responsible"))

        # 1 pending + 1 completed survey response
        survey = Survey(
            name="S",
            target_type_key="Application",
            status="active",
            created_by=admin.id,
        )
        db.add(survey)
        await db.flush()
        db.add(
            SurveyResponse(
                survey_id=survey.id, user_id=alice.id, card_id=c_fav1.id, status="pending"
            )
        )
        db.add(
            SurveyResponse(
                survey_id=survey.id, user_id=alice.id, card_id=c_fav2.id, status="completed"
            )
        )

        # 2 cards alice created
        await create_card(db, name="Mine1", user_id=alice.id)
        await create_card(db, name="Mine2", user_id=alice.id)
        await db.flush()

        resp = await client.get("/api/v1/reports/my-workspace", headers=auth_headers(alice))
        assert resp.status_code == 200
        body = resp.json()
        assert body["favorite_count"] == 2
        # s1, s2, s3 + broken = 4 distinct stakeholder cards
        assert body["stakeholder_card_count"] == 4
        assert body["open_todo_count"] == 2
        assert body["pending_survey_count"] == 1
        assert body["overdue_todo_count"] == 1
        assert body["broken_card_count"] == 1
        # attention = overdue + broken (no de-dup needed; categories are disjoint)
        assert body["attention_count"] == 2
        assert body["created_count"] == 2

    async def test_open_todo_count_assigned_only(self, client, db):
        """``open_todo_count`` is scoped to todos *assigned* to the user.
        Todos the user merely created (but assigned to someone else) live
        in the "Created by me" tab on ``/todos`` and must not inflate the
        workspace counter.
        """
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        alice = await create_user(db, email="alice@test.com", role="member")
        bob = await create_user(db, email="bob@test.com", role="member")

        # Open, assigned to alice — counts.
        db.add(Todo(description="assigned-open", status="open", assigned_to=alice.id))
        # Open, created by alice but assigned to bob — does NOT count.
        db.add(
            Todo(
                description="created-for-bob",
                status="open",
                assigned_to=bob.id,
                created_by=alice.id,
            )
        )
        # Done, assigned to alice — does NOT count (wrong status).
        db.add(Todo(description="done", status="done", assigned_to=alice.id))
        await db.flush()

        resp = await client.get("/api/v1/reports/my-workspace", headers=auth_headers(alice))
        assert resp.status_code == 200
        assert resp.json()["open_todo_count"] == 1

    async def test_broken_card_count_stakeholder_scope(self, client, db):
        """Only cards the user holds a stakeholder role on count toward
        ``broken_card_count`` — same notion of ownership the todos counter
        uses (assigned to me). Cards merely created by the user, with no
        stakeholder role, are deliberately excluded.
        """
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        alice = await create_user(db, email="alice@test.com", role="member")

        # Broken card alice created but isn't a stakeholder on → does NOT count.
        await create_card(db, name="MineNoRole", user_id=alice.id, approval_status="BROKEN")
        # Broken card alice is a stakeholder on (admin created) → counts.
        broken_stake = await create_card(
            db, name="StakeholderBroken", user_id=admin.id, approval_status="BROKEN"
        )
        db.add(Stakeholder(card_id=broken_stake.id, user_id=alice.id, role="responsible"))
        # Two stakeholder roles on the same broken card → still 1 distinct card.
        db.add(Stakeholder(card_id=broken_stake.id, user_id=alice.id, role="observer"))
        # Broken card alice has nothing to do with → does NOT count.
        await create_card(db, name="NotMine", user_id=admin.id, approval_status="BROKEN")
        await db.flush()

        resp = await client.get("/api/v1/reports/my-workspace", headers=auth_headers(alice))
        assert resp.status_code == 200
        assert resp.json()["broken_card_count"] == 1

    async def test_requires_auth(self, client, db):
        resp = await client.get("/api/v1/reports/my-workspace")
        assert resp.status_code == 401
