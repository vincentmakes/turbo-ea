"""Integration tests for ``GET /dashboards/leaderboard`` — the Data quality
leaderboard widget.

Who appears (stakeholders of ACTIVE, visible, readable cards; active accounts;
from ``min_cards`` cards), the two rankings, a card counted once per person,
the role filters, the parameter bounds and the least-privilege user payload.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

URL = "/api/v1/dashboards/leaderboard"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="blind",
        label="Blind",
        permissions={**MEMBER_PERMISSIONS, "reports.ea_dashboard": False},
    )
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Secret", label="Secret")
    await create_card_type(db, key="Hidden", label="Hidden", is_hidden=True)
    for type_key in ("Application", "Secret", "Hidden"):
        await create_stakeholder_role_def(db, card_type_key=type_key, key="responsible")
    await create_stakeholder_role_def(db, card_type_key="Application", key="technicalOwner")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", counts_for_quality=False
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="retired", is_archived=True
    )
    return {
        "admin": await create_user(db, email="admin@lb.test", role="admin"),
        "viewer": await create_user(db, email="viewer@lb.test", role="viewer"),
        "blind": await create_user(db, email="blind@lb.test", role="blind"),
        "alice": await create_user(db, email="alice@lb.test", display_name="Alice", role="member"),
        "bob": await create_user(db, email="bob@lb.test", display_name="bob", role="member"),
        "carol": await create_user(db, email="carol@lb.test", display_name="Carol", role="member"),
    }


async def _hold(db, user, quality: float, *roles: str, card_type="Application", **card):
    """A new card of ``quality`` on which ``user`` holds ``roles``
    (``responsible`` when none is given)."""
    created = await create_card(
        db, card_type=card_type, name=card.pop("name", "C"), data_quality=quality, **card
    )
    for role in roles or ("responsible",):
        db.add(Stakeholder(card_id=created.id, user_id=user.id, role=role))
    await db.flush()
    return created


async def _board(client, user, **params):
    r = await client.get(URL, params=params, headers=auth_headers(user))
    assert r.status_code == 200, r.text
    return r.json()


def _rows(body):
    return [
        (row["rank"], row["user"]["display_name"], row["cards"], row["average_quality"])
        for row in body["rows"]
    ]


async def _deny_secret_to(db, role: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == "Secret"))).scalar_one()
    ct.role_permissions = {role: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


class TestRanking:
    async def test_by_average_from_the_threshold(self, client, db, env):
        for quality in (90, 80, 75):
            await _hold(db, env["alice"], quality)
        for quality in (100, 95):
            await _hold(db, env["bob"], quality)
        await _hold(db, env["carol"], 100)

        body = await _board(client, env["viewer"], min_cards=2)
        # Alice's 81.67 is rounded to one decimal; Carol's one card is below 2.
        assert _rows(body) == [(1, "bob", 2, 97.5), (2, "Alice", 3, 81.7)]
        assert body["total_people"] == 2
        assert body["rows"][0]["user"]["id"] == str(env["bob"].id)

        # The default threshold is 3 cards and the default ranking the average.
        body = await _board(client, env["viewer"])
        assert _rows(body) == [(1, "Alice", 3, 81.7)]
        assert {k: body[k] for k in body if k not in ("rows", "total_people")} == {
            "rank_by": "average_quality",
            "min_cards": 3,
            "card_types": [],
            "roles": [],
            "counting_roles_only": True,
            "top": 10,
        }

    async def test_by_card_count(self, client, db, env):
        for quality in (10, 20, 30):
            await _hold(db, env["alice"], quality)
        for quality in (100, 90):
            await _hold(db, env["bob"], quality)
        await _hold(db, env["carol"], 100)
        body = await _board(client, env["viewer"], rank_by="card_count", min_cards=1)
        assert _rows(body) == [
            (1, "Alice", 3, 20.0),
            (2, "bob", 2, 95.0),
            (3, "Carol", 1, 100.0),
        ]
        assert body["rank_by"] == "card_count"
        assert body["total_people"] == 3

    async def test_a_tie_shares_the_rank_and_reads_alphabetically(self, client, db, env):
        # bob (lower-case) is created first; the order is by name, case-blind.
        await _hold(db, env["bob"], 50)
        await _hold(db, env["carol"], 50)
        await _hold(db, env["alice"], 50)
        await _hold(db, env["alice"], 40)
        body = await _board(client, env["viewer"], min_cards=1)
        assert _rows(body) == [(1, "bob", 1, 50.0), (1, "Carol", 1, 50.0), (3, "Alice", 2, 45.0)]
        body = await _board(client, env["viewer"], min_cards=1, rank_by="card_count")
        assert _rows(body) == [(1, "Alice", 2, 45.0), (2, "bob", 1, 50.0), (2, "Carol", 1, 50.0)]

    async def test_top_cuts_the_rows_not_the_total(self, client, db, env):
        await _hold(db, env["alice"], 90)
        await _hold(db, env["bob"], 80)
        await _hold(db, env["carol"], 70)
        body = await _board(client, env["viewer"], min_cards=1, top=2)
        assert _rows(body) == [(1, "Alice", 1, 90.0), (2, "bob", 1, 80.0)]
        assert body["total_people"] == 3
        assert body["top"] == 2

    async def test_nobody_reaches_the_threshold(self, client, db, env):
        await _hold(db, env["alice"], 90)
        body = await _board(client, env["viewer"], min_cards=2)
        assert body["rows"] == []
        assert body["total_people"] == 0


class TestWhatCounts:
    async def test_two_roles_on_one_card_count_it_once(self, client, db, env):
        await _hold(db, env["alice"], 100, "responsible", "technicalOwner")
        await _hold(db, env["alice"], 50)
        body = await _board(client, env["viewer"], min_cards=1)
        assert _rows(body) == [(1, "Alice", 2, 75.0)]

    async def test_counting_roles_only_leaves_out_an_observer(self, client, db, env):
        for quality in (10, 10, 10):
            await _hold(db, env["alice"], quality, "observer")
        await _hold(db, env["alice"], 90)
        await _hold(db, env["alice"], 70, "retired")
        body = await _board(client, env["viewer"], min_cards=1)
        assert _rows(body) == [(1, "Alice", 1, 90.0)]
        everyone = await _board(client, env["viewer"], min_cards=1, counting_roles_only=False)
        assert _rows(everyone) == [(1, "Alice", 5, 38.0)]
        assert everyone["counting_roles_only"] is False

    async def test_the_role_and_type_filters(self, client, db, env):
        await _hold(db, env["alice"], 10, "observer")
        await _hold(db, env["alice"], 30, "observer")
        await _hold(db, env["alice"], 90, "technicalOwner")
        await _hold(db, env["bob"], 60, card_type="Secret")
        await _hold(db, env["bob"], 80)
        observers = await _board(
            client, env["viewer"], min_cards=1, roles="observer", counting_roles_only=False
        )
        assert _rows(observers) == [(1, "Alice", 2, 20.0)]
        assert observers["roles"] == ["observer"]
        # Repeated parameters, duplicates folded.
        two = await _board(
            client,
            env["viewer"],
            min_cards=1,
            roles=["technicalOwner", "responsible", "technicalOwner"],
        )
        assert _rows(two) == [(1, "Alice", 1, 90.0), (2, "bob", 2, 70.0)]
        assert two["roles"] == ["technicalOwner", "responsible"]
        secrets = await _board(client, env["viewer"], min_cards=1, card_types="Secret")
        assert _rows(secrets) == [(1, "bob", 1, 60.0)]
        assert secrets["card_types"] == ["Secret"]

    async def test_a_type_denied_by_the_read_scope_is_not_counted(self, client, db, env):
        await _hold(db, env["alice"], 0, card_type="Secret")
        await _hold(db, env["alice"], 100)
        await _deny_secret_to(db, "viewer")
        assert _rows(await _board(client, env["viewer"], min_cards=1)) == [(1, "Alice", 1, 100.0)]
        assert _rows(await _board(client, env["admin"], min_cards=1)) == [(1, "Alice", 2, 50.0)]
        # Narrowed to the denied type, the board is empty — not a 400.
        hidden = await _board(client, env["viewer"], min_cards=1, card_types="Secret")
        assert hidden["rows"] == []
        assert hidden["total_people"] == 0

    async def test_hidden_types_and_archived_cards_never_count(self, client, db, env):
        await _hold(db, env["alice"], 0, card_type="Hidden")
        await _hold(db, env["alice"], 0, status="ARCHIVED")
        await _hold(db, env["alice"], 80)
        body = await _board(client, env["admin"], min_cards=1)
        assert _rows(body) == [(1, "Alice", 1, 80.0)]

    async def test_an_inactive_user_is_left_out(self, client, db, env):
        await _hold(db, env["alice"], 90)
        await _hold(db, env["bob"], 80)
        env["alice"].is_active = False
        await db.flush()
        body = await _board(client, env["admin"], min_cards=1)
        assert _rows(body) == [(1, "bob", 1, 80.0)]
        assert body["total_people"] == 1

    async def test_the_payload_names_a_person_and_nothing_more(self, client, db, env):
        await _hold(db, env["alice"], 90)
        r = await client.get(URL, params={"min_cards": 1}, headers=auth_headers(env["admin"]))
        (row,) = r.json()["rows"]
        assert row["user"] == {"id": str(env["alice"].id), "display_name": "Alice"}
        assert set(row) == {"rank", "user", "cards", "average_quality"}
        assert "alice@lb.test" not in r.text
        assert "member" not in r.text


class TestRequests:
    @pytest.mark.parametrize(
        ("top", "status"), [(0, 422), (51, 422), (1, 200), (50, 200), ("x", 422)]
    )
    async def test_top_bounds(self, client, env, top, status):
        r = await client.get(URL, params={"top": top}, headers=auth_headers(env["viewer"]))
        assert r.status_code == status

    @pytest.mark.parametrize(
        ("params", "status"),
        [
            ({"min_cards": 0}, 422),
            ({"min_cards": 101}, 422),
            ({"min_cards": 1}, 200),
            ({"min_cards": 100}, 200),
            ({"rank_by": "cards"}, 422),
            ({"counting_roles_only": "maybe"}, 422),
        ],
    )
    async def test_parameter_bounds(self, client, env, params, status):
        r = await client.get(URL, params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == status

    @pytest.mark.parametrize(
        ("params", "detail"),
        [
            ({"card_types": "Nope"}, "unknown_card_type"),
            ({"card_types": ["Application", "Hidden"]}, "unknown_card_type"),
            ({"roles": "nope"}, "unknown_role"),
            ({"roles": ["responsible", "retired"]}, "unknown_role"),
        ],
    )
    async def test_unknown_keys_are_400(self, client, env, params, detail):
        r = await client.get(URL, params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == 400
        assert r.json()["detail"] == detail

    async def test_known_keys_pass(self, client, env):
        params = {"card_types": ["Application", "Secret"], "roles": ["observer"]}
        r = await client.get(URL, params=params, headers=auth_headers(env["viewer"]))
        assert r.status_code == 200
        assert r.json()["card_types"] == ["Application", "Secret"]

    async def test_needs_the_dashboard_permission(self, client, env):
        r = await client.get(URL, headers=auth_headers(env["blind"]))
        assert r.status_code == 403

    async def test_requires_authentication(self, client, env):
        assert (await client.get(URL)).status_code == 401
