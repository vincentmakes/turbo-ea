"""The decision register on the API: standing, typed links, people and dates.

``GET /adr`` and ``GET /adr/{id}`` carry the derived standing of every
decision; ``POST`` / ``PATCH`` save typed links, people and dates; the signing
workflow refuses to lock what cannot be locked and fills the default dates.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.architecture_decision import ArchitectureDecision
from app.models.event import Event
from app.models.todo import Todo
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/adr"


def _today() -> date:
    return datetime.now(timezone.utc).date()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "member": await create_user(db, email="member@test.com", role="member"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
    }


async def _create(client, user, title="Decision", **extra) -> dict:
    resp = await client.post(URL, json={"title": title, **extra}, headers=auth_headers(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _sign(client, admin, adr_id) -> dict:
    """Send for signature to ``admin`` alone and sign: a signed decision."""
    resp = await client.post(
        f"{URL}/{adr_id}/request-signatures",
        json={"user_ids": [str(admin.id)]},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"{URL}/{adr_id}/sign", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _signed(client, admin, title="Decision", **extra) -> dict:
    created = await _create(client, admin, title, **extra)
    return await _sign(client, admin, created["id"])


async def _get(client, user, adr_id) -> dict:
    resp = await client.get(f"{URL}/{adr_id}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _list(client, user, query="") -> dict[str, dict]:
    resp = await client.get(f"{URL}{query}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return {row["id"]: row for row in resp.json()}


def _ref(adr: dict) -> dict:
    return {
        "id": adr["id"],
        "reference_number": adr["reference_number"],
        "revision_number": adr["revision_number"],
        "title": adr["title"],
    }


# ---------------------------------------------------------------------------
# Standing on the list and the detail
# ---------------------------------------------------------------------------


class TestStanding:
    async def test_a_signed_decision_is_in_force_with_its_dates(self, client, env):
        admin = env["admin"]
        adr = await _signed(client, admin, "In force")

        assert adr["standing"] == "in_force"
        assert adr["is_current"] is True
        assert adr["is_earlier_revision"] is False
        assert adr["decided_on"] == _today().isoformat()
        assert adr["effective_from"] == _today().isoformat()
        assert adr["valid_until"] is None
        assert adr["recorded_at"] is None
        assert adr["recorded_by"] is None
        assert adr["revisions"] == [{**_ref(adr), "status": "signed", "standing": "in_force"}]
        row = (await _list(client, env["viewer"]))[adr["id"]]
        assert row["standing"] == "in_force"
        assert row["is_current"] is True
        assert row["decided_on"] == _today().isoformat()

    async def test_a_draft_has_no_standing(self, client, env):
        adr = await _create(client, env["admin"], "Draft")
        assert adr["standing"] is None
        assert adr["is_current"] is True
        assert adr["superseded_by"] is None
        row = (await _list(client, env["admin"]))[adr["id"]]
        assert row["standing"] is None

    async def test_replaced_by_a_signed_decision(self, client, env):
        admin = env["admin"]
        old = await _signed(client, admin, "Old")
        new = await _create(
            client, admin, "New", links=[{"decision_id": old["id"], "kind": "replaces"}]
        )
        # A draft replacement changes nothing yet.
        assert (await _get(client, admin, old["id"]))["standing"] == "in_force"
        new = await _sign(client, admin, new["id"])

        old_now = await _get(client, admin, old["id"])
        assert old_now["standing"] == "superseded"
        assert old_now["superseded_by"] == _ref(new)
        assert old_now["revoked_by"] is None
        row = (await _list(client, admin))[old["id"]]
        assert row["standing"] == "superseded"
        assert row["superseded_by"] == _ref(new)
        assert new["standing"] == "in_force"

    async def test_revoked(self, client, env):
        admin = env["admin"]
        target = await _signed(client, admin, "Target")
        revoker = await _signed(
            client, admin, "Revoker", links=[{"decision_id": target["id"], "kind": "revokes"}]
        )
        got = await _get(client, admin, target["id"])
        assert got["standing"] == "revoked"
        assert got["revoked_by"] == _ref(revoker)
        assert got["superseded_by"] is None

    async def test_amended(self, client, env):
        admin = env["admin"]
        target = await _signed(client, admin, "Target")
        amender = await _signed(
            client,
            admin,
            "Amender",
            links=[{"decision_id": target["id"], "kind": "amends", "note": "§3 only"}],
        )
        got = await _get(client, admin, target["id"])
        assert got["standing"] == "amended"
        assert got["amended_by"] == [_ref(amender)]
        assert (await _list(client, admin))[target["id"]]["amended_by"] == [_ref(amender)]

    async def test_scheduled_when_effective_tomorrow(self, client, env):
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        adr = await _signed(client, env["admin"], "Later", effective_from=tomorrow)
        assert adr["standing"] == "scheduled"
        assert adr["effective_from"] == tomorrow
        assert adr["decided_on"] == _today().isoformat()

    async def test_expired_after_valid_until(self, client, db, env):
        adr = await _signed(client, env["admin"], "Waiver")
        row = await db.get(ArchitectureDecision, uuid.UUID(adr["id"]))
        row.valid_until = _today() - timedelta(days=1)
        await db.flush()
        assert (await _get(client, env["admin"], adr["id"]))["standing"] == "expired"
        row.valid_until = _today()
        await db.flush()
        assert (await _get(client, env["admin"], adr["id"]))["standing"] == "in_force"

    async def test_earlier_revisions_and_the_open_revision(self, client, env):
        admin = env["admin"]
        first = await _signed(client, admin, "Chain")
        resp = await client.post(f"{URL}/{first['id']}/revise", headers=auth_headers(admin))
        second = resp.json()

        got = await _get(client, admin, first["id"])
        assert got["standing"] == "in_force"
        assert got["open_revision"] == _ref(second)

        second = await _sign(client, admin, second["id"])
        got = await _get(client, admin, first["id"])
        assert got["standing"] == "superseded"
        assert got["is_earlier_revision"] is True
        assert got["is_current"] is False
        assert got["superseded_by"] == _ref(second)
        assert second["revisions"] == [
            {**_ref(got), "status": "signed", "standing": "superseded"},
            {**_ref(second), "status": "signed", "standing": "in_force"},
        ]

        everything = await _list(client, admin)
        assert set(everything) == {first["id"], second["id"]}
        current_only = await _list(client, admin, "?include_earlier=false")
        assert set(current_only) == {second["id"]}
        assert current_only[second["id"]]["is_current"] is True

    async def test_standing_filter(self, client, env):
        admin = env["admin"]
        in_force = await _signed(client, admin, "In force")
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        scheduled = await _signed(client, admin, "Scheduled", effective_from=tomorrow)
        draft = await _create(client, admin, "Draft")

        assert set(await _list(client, admin, "?standing=in_force")) == {in_force["id"]}
        assert set(await _list(client, admin, "?standing=in_force,scheduled")) == {
            in_force["id"],
            scheduled["id"],
        }
        assert draft["id"] not in await _list(client, admin, "?standing=in_force")

        resp = await client.get(f"{URL}?standing=retired", headers=auth_headers(admin))
        assert resp.status_code == 400
        assert resp.json()["detail"] == {"error": "unknown_standing", "values": ["retired"]}

    async def test_by_card_applies_the_same_filters(self, client, db, env):
        from tests.conftest import create_card, create_card_type

        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Billing")
        admin = env["admin"]
        first = await _signed(client, admin, "Chain", linked_card_ids=[str(card.id)])
        resp = await client.post(f"{URL}/{first['id']}/revise", headers=auth_headers(admin))
        second = await _sign(client, admin, resp.json()["id"])

        url = f"{URL}/by-card/{card.id}"
        rows = (await client.get(url, headers=auth_headers(admin))).json()
        assert {r["id"]: r["standing"] for r in rows} == {
            first["id"]: "superseded",
            second["id"]: "in_force",
        }
        rows = (
            await client.get(f"{url}?include_earlier=false", headers=auth_headers(admin))
        ).json()
        assert [r["id"] for r in rows] == [second["id"]]
        rows = (await client.get(f"{url}?standing=superseded", headers=auth_headers(admin))).json()
        assert [r["id"] for r in rows] == [first["id"]]
        resp = await client.get(f"{url}?standing=nope", headers=auth_headers(admin))
        assert resp.status_code == 400

    async def test_a_viewer_cannot_save_links(self, client, env):
        resp = await client.post(
            URL,
            json={"title": "x", "links": []},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------


class TestLinks:
    async def test_links_show_on_both_sides(self, client, env):
        admin = env["admin"]
        target = await _signed(client, admin, "Target")
        source = await _create(
            client,
            admin,
            "Source",
            links=[{"decision_id": target["reference_number"], "kind": "amends", "note": "§2"}],
        )

        assert len(source["links"]["outgoing"]) == 1
        out = source["links"]["outgoing"][0]
        assert (out["kind"], out["note"]) == ("amends", "§2")
        assert out["decision"] == {**_ref(target), "status": "signed", "standing": "in_force"}
        assert source["links"]["incoming"] == []
        assert source["related_decisions"] == []

        got = await _get(client, admin, target["id"])
        assert got["links"]["outgoing"] == []
        [inc] = got["links"]["incoming"]
        assert inc["id"] == out["id"]
        assert (inc["kind"], inc["note"]) == ("amends", "§2")
        assert inc["decision"] == {**_ref(source), "status": "draft", "standing": None}

    async def test_related_decisions_are_relates_links(self, client, env):
        admin = env["admin"]
        a = await _create(client, admin, "A")
        b = await _create(client, admin, "B")
        hard = await _signed(client, admin, "Hard")
        src = await _create(
            client,
            admin,
            "Src",
            related_decisions=[a["id"], "adr-002"],
            links=[{"decision_id": hard["id"], "kind": "replaces"}],
        )
        assert sorted(src["related_decisions"]) == sorted([a["id"], b["id"]])
        kinds = {e["decision"]["id"]: e["kind"] for e in src["links"]["outgoing"]}
        assert kinds == {a["id"]: "relates", b["id"]: "relates", hard["id"]: "replaces"}

        # related_decisions on PATCH replaces only the relates subset.
        resp = await client.patch(
            f"{URL}/{src['id']}", json={"related_decisions": [b["id"]]}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        kinds = {e["decision"]["id"]: e["kind"] for e in resp.json()["links"]["outgoing"]}
        assert kinds == {b["id"]: "relates", hard["id"]: "replaces"}
        assert resp.json()["related_decisions"] == [b["id"]]

        # links replaces the full set.
        resp = await client.patch(
            f"{URL}/{src['id']}",
            json={"links": [{"decision_id": a["id"], "kind": "relates"}]},
            headers=auth_headers(admin),
        )
        kinds = {e["decision"]["id"]: e["kind"] for e in resp.json()["links"]["outgoing"]}
        assert kinds == {a["id"]: "relates"}

        # Both at once is ambiguous.
        resp = await client.patch(
            f"{URL}/{src['id']}",
            json={"links": [], "related_decisions": []},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["error"] == "links_and_related_decisions"

        # Omitting both leaves the links alone.
        resp = await client.patch(
            f"{URL}/{src['id']}", json={"title": "Renamed"}, headers=auth_headers(admin)
        )
        assert [e["decision"]["id"] for e in resp.json()["links"]["outgoing"]] == [a["id"]]

    async def test_unknown_and_invalid_links_are_refused(self, client, env):
        admin = env["admin"]
        target = await _create(client, admin, "Target")
        resp = await client.post(
            URL,
            json={"title": "x", "links": [{"decision_id": "ADR-404", "kind": "relates"}]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["error"] == "decision_not_found"

        resp = await client.post(
            URL,
            json={"title": "x", "links": [{"decision_id": target["id"], "kind": "cancels"}]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["error"] == "unknown_kind"
        assert resp.json()["detail"]["target_id"] == target["id"]

        resp = await client.patch(
            f"{URL}/{target['id']}",
            json={"links": [{"decision_id": target["id"], "kind": "relates"}]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["error"] == "same_chain"

        resp = await client.patch(
            f"{URL}/{target['id']}",
            json={"related_decisions": ["ADR-404"]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_link_shape_is_validated(self, client, env):
        resp = await client.post(
            URL,
            json={"title": "x", "links": [{"decision_id": "ADR-001", "kind": "relates", "x": 1}]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422

    async def test_revise_and_duplicate_carry_relates_links_and_people(self, client, env):
        admin = env["admin"]
        related = await _signed(client, admin, "Related")
        replaced = await _signed(client, admin, "Replaced")
        source = await _signed(
            client,
            admin,
            "Source",
            related_decisions=[related["id"]],
            links=[{"decision_id": replaced["id"], "kind": "replaces"}],
            decision_makers=[{"name": "Board"}],
            participants=[{"user_id": str(env["member"].id)}],
            valid_until=(_today() + timedelta(days=30)).isoformat(),
        )

        for path in ("revise", "duplicate"):
            resp = await client.post(f"{URL}/{source['id']}/{path}", headers=auth_headers(admin))
            copy = resp.json()
            assert [(e["kind"], e["decision"]["id"]) for e in copy["links"]["outgoing"]] == [
                ("relates", related["id"])
            ], path
            assert copy["decision_makers"] == [{"user_id": None, "display_name": "Board"}]
            assert copy["participants"] == [
                {"user_id": str(env["member"].id), "display_name": env["member"].display_name}
            ]
            assert copy["valid_until"] == source["valid_until"]
            assert copy["decided_on"] is None
            assert copy["effective_from"] is None


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------


class TestPeople:
    async def test_round_trip_with_users_and_free_text(self, client, env):
        admin, member = env["admin"], env["member"]
        adr = await _create(
            client,
            admin,
            "People",
            decision_makers=[{"user_id": str(member.id)}, {"name": "Architecture Board"}],
            participants=[{"name": "Ops"}],
        )
        assert adr["decision_makers"] == [
            {"user_id": str(member.id), "display_name": member.display_name},
            {"user_id": None, "display_name": "Architecture Board"},
        ]
        assert adr["participants"] == [{"user_id": None, "display_name": "Ops"}]
        row = (await _list(client, admin))[adr["id"]]
        assert row["decision_makers"] == adr["decision_makers"]
        assert "participants" not in row
        exported = (await _list(client, admin, "?include_content=true"))[adr["id"]]
        assert exported["participants"] == [{"user_id": None, "display_name": "Ops"}]
        assert exported["decision_makers"] == adr["decision_makers"]

        resp = await client.patch(
            f"{URL}/{adr['id']}",
            json={"participants": [{"user_id": str(admin.id)}]},
            headers=auth_headers(admin),
        )
        assert resp.json()["decision_makers"] == adr["decision_makers"]
        assert resp.json()["participants"] == [
            {"user_id": str(admin.id), "display_name": admin.display_name}
        ]

    async def test_an_unknown_user_is_a_404(self, client, env):
        ghost = uuid.uuid4()
        resp = await client.post(
            URL,
            json={"title": "x", "decision_makers": [{"user_id": str(ghost)}]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == f"User not found: {ghost}"

    async def test_a_person_needs_exactly_one_of_user_and_name(self, client, env):
        for person in ({}, {"user_id": str(env["admin"].id), "name": "Both"}):
            resp = await client.post(
                URL,
                json={"title": "x", "participants": [person]},
                headers=auth_headers(env["admin"]),
            )
            assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------


class TestDates:
    async def test_valid_until_before_effective_from_is_a_400(self, client, env):
        resp = await client.post(
            URL,
            json={"title": "x", "effective_from": "2027-02-01", "valid_until": "2027-01-31"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective"],
        }

    async def test_patch_sets_clears_and_leaves_dates(self, client, env):
        admin = env["admin"]
        adr = await _create(
            client,
            admin,
            "Dated",
            decided_on="2026-01-02",
            effective_from="2027-01-01",
            change_summary="First text",
        )
        assert (adr["decided_on"], adr["effective_from"], adr["change_summary"]) == (
            "2026-01-02",
            "2027-01-01",
            "First text",
        )

        resp = await client.patch(
            f"{URL}/{adr['id']}",
            json={"effective_from": None, "valid_until": "2028-01-01"},
            headers=auth_headers(admin),
        )
        got = resp.json()
        assert (got["decided_on"], got["effective_from"], got["valid_until"]) == (
            "2026-01-02",
            None,
            "2028-01-01",
        )
        assert got["change_summary"] == "First text"

        resp = await client.patch(
            f"{URL}/{adr['id']}",
            json={"effective_from": "2028-06-01"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["error"] == "valid_until_before_effective"

    async def test_change_summary_is_capped(self, client, env):
        resp = await client.post(
            URL,
            json={"title": "x", "change_summary": "y" * 2001},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Locking
# ---------------------------------------------------------------------------


class TestLocking:
    async def _request(self, client, admin, adr_id):
        return await client.post(
            f"{URL}/{adr_id}/request-signatures",
            json={"user_ids": [str(admin.id)]},
            headers=auth_headers(admin),
        )

    async def test_a_link_to_an_unsigned_decision_blocks_the_request(self, client, env):
        admin = env["admin"]
        draft = await _create(client, admin, "Draft target")
        src = await _create(client, admin, "Src", related_decisions=[draft["id"]])
        resp = await self._request(client, admin, src["id"])
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "link_target_not_locked",
            "problems": ["link_target_not_locked"],
            "target_ids": [draft["id"]],
        }
        assert (await _get(client, admin, src["id"]))["status"] == "draft"

    async def test_valid_until_past_blocks_the_request(self, client, env):
        admin = env["admin"]
        two_days_ago = (_today() - timedelta(days=2)).isoformat()
        src = await _create(
            client, admin, "Src", effective_from=two_days_ago, valid_until=two_days_ago
        )
        resp = await self._request(client, admin, src["id"])
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "valid_until_past",
            "problems": ["valid_until_past"],
        }
        assert (await _get(client, admin, src["id"]))["status"] == "draft"

    async def test_valid_until_yesterday_is_accepted(self, client, env):
        # One day of timezone spread: an author behind UTC is still on "yesterday".
        admin = env["admin"]
        yesterday = (_today() - timedelta(days=1)).isoformat()
        src = await _create(client, admin, "Src", effective_from=yesterday, valid_until=yesterday)
        resp = await self._request(client, admin, src["id"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "in_review"

    async def test_decided_on_future_blocks_the_request(self, client, env):
        admin = env["admin"]
        in_two_days = (_today() + timedelta(days=2)).isoformat()
        src = await _create(client, admin, "Src", decided_on=in_two_days)
        resp = await self._request(client, admin, src["id"])
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "decided_on_future",
            "problems": ["decided_on_future"],
        }
        assert (await _get(client, admin, src["id"]))["status"] == "draft"

    async def test_decided_on_tomorrow_is_accepted(self, client, env):
        # One day of timezone spread: an author ahead of UTC is already on "tomorrow".
        admin = env["admin"]
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        src = await _create(client, admin, "Src", decided_on=tomorrow)
        resp = await self._request(client, admin, src["id"])
        assert resp.status_code == 200, resp.text
        assert (resp.json()["status"], resp.json()["decided_on"]) == ("in_review", tomorrow)

    async def test_signing_keeps_explicit_dates(self, client, env):
        adr = await _signed(client, env["admin"], "Kept", decided_on="2026-01-02")
        assert adr["decided_on"] == "2026-01-02"
        assert adr["effective_from"] == _today().isoformat()

    async def test_the_last_signature_on_a_revoked_chain_is_refused(self, client, env):
        admin = env["admin"]
        original = await _signed(client, admin, "Original")
        resp = await client.post(f"{URL}/{original['id']}/revise", headers=auth_headers(admin))
        revision = resp.json()
        assert (await self._request(client, admin, revision["id"])).status_code == 200
        revoker = await _signed(
            client, admin, "Revoker", links=[{"decision_id": original["id"], "kind": "revokes"}]
        )

        resp = await client.post(f"{URL}/{revision['id']}/sign", headers=auth_headers(admin))

        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "chain_closed",
            "problems": ["chain_closed"],
            "by": _ref(revoker),
        }
        stored = await _get(client, admin, revision["id"])
        assert stored["status"] == "in_review"
        assert [s["status"] for s in stored["signatories"]] == ["pending"]

    async def _aged_in_review(self, client, db, admin, signers, **dates):
        """A draft sent for signature whose dates no longer hold on signing day.

        Moving ``valid_until`` in the database stands in for the days spent in
        review: the request passed, the signing day is past ``valid_until``.
        """
        adr = await _create(client, admin, "Aged", **dates)
        resp = await client.post(
            f"{URL}/{adr['id']}/request-signatures",
            json={"user_ids": [str(u.id) for u in signers]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        row = await db.get(ArchitectureDecision, uuid.UUID(adr["id"]))
        row.valid_until = _today() - timedelta(days=2)
        await db.commit()
        return adr

    async def test_the_last_signature_rechecks_the_dates(self, client, db, env):
        admin = env["admin"]
        adr = await self._aged_in_review(
            client, db, admin, [admin], valid_until=(_today() + timedelta(days=2)).isoformat()
        )

        resp = await client.post(f"{URL}/{adr['id']}/sign", headers=auth_headers(admin))

        # Same shape as the request-signatures lock refusal; the signing day
        # would have become effective_from, after valid_until.
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective", "valid_until_past"],
        }
        stored = await _get(client, admin, adr["id"])
        assert (stored["status"], stored["signed_at"], stored["effective_from"]) == (
            "in_review",
            None,
            None,
        )
        assert [(s["status"], s["signed_at"]) for s in stored["signatories"]] == [("pending", None)]
        [todo] = (
            (await db.execute(select(Todo).where(Todo.link == f"/ea-delivery/adr/{adr['id']}")))
            .scalars()
            .all()
        )
        assert todo.status == "open"
        signed_events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.signed")))
            .scalars()
            .all()
        )
        assert signed_events == []

    async def test_an_earlier_signature_is_not_held_by_the_dates(self, client, db, env):
        admin = env["admin"]
        other = await create_user(db, email="second-signer@test.com", role="admin")
        adr = await self._aged_in_review(
            client,
            db,
            admin,
            [admin, other],
            effective_from=_today().isoformat(),
            valid_until=(_today() + timedelta(days=2)).isoformat(),
        )

        resp = await client.post(f"{URL}/{adr['id']}/sign", headers=auth_headers(admin))

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "in_review"
        assert [s["status"] for s in resp.json()["signatories"]] == ["signed", "pending"]
        resp = await client.post(f"{URL}/{adr['id']}/sign", headers=auth_headers(other))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective", "valid_until_past"],
        }
        stored = await _get(client, admin, adr["id"])
        assert stored["status"] == "in_review"
        assert [s["status"] for s in stored["signatories"]] == ["signed", "pending"]

    async def test_the_last_signature_locks_when_the_dates_hold(self, client, db, env):
        admin = env["admin"]
        adr = await _create(
            client, admin, "Holds", valid_until=(_today() + timedelta(days=2)).isoformat()
        )
        await self._request(client, admin, adr["id"])
        resp = await client.post(f"{URL}/{adr['id']}/sign", headers=auth_headers(admin))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["status"], body["effective_from"], body["decided_on"]) == (
            "signed",
            _today().isoformat(),
            _today().isoformat(),
        )

    async def test_sign_todos_are_matched_by_link_and_labelled(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, "Todo target")
        await self._request(client, admin, adr["id"])
        [todo] = (
            (await db.execute(select(Todo).where(Todo.link == f"/ea-delivery/adr/{adr['id']}")))
            .scalars()
            .all()
        )
        assert todo.description == f'Sign ADR: "{adr["reference_number"]} — Todo target"'
        assert todo.status == "open"

        await client.post(f"{URL}/{adr['id']}/sign", headers=auth_headers(admin))
        await db.refresh(todo)
        assert todo.status == "done"

        events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.signed")))
            .scalars()
            .all()
        )
        assert [e.data["revision_number"] for e in events] == [1]

    async def test_a_revision_todo_names_its_revision_and_recall_closes_it(self, client, db, env):
        admin = env["admin"]
        original = await _signed(client, admin, "Chain")
        resp = await client.post(f"{URL}/{original['id']}/revise", headers=auth_headers(admin))
        revision = resp.json()
        await self._request(client, admin, revision["id"])
        [todo] = (
            (
                await db.execute(
                    select(Todo).where(Todo.link == f"/ea-delivery/adr/{revision['id']}")
                )
            )
            .scalars()
            .all()
        )
        assert todo.description == f'Sign ADR: "{revision["reference_number"]} · Rev 2 — Chain"'

        resp = await client.post(
            f"{URL}/{revision['id']}/recall-signatures", headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        await db.refresh(todo)
        assert todo.status == "done"


# ---------------------------------------------------------------------------
# No N+1 on the list
# ---------------------------------------------------------------------------


class TestQueryCount:
    async def test_list_queries_do_not_grow_with_the_number_of_decisions(self, client, db, env):
        admin = env["admin"]
        target = await _signed(client, admin, "Target")

        async def add(n):
            for i in range(n):
                await _create(
                    client,
                    admin,
                    f"Decision {i}",
                    related_decisions=[target["id"]],
                    decision_makers=[{"name": f"Maker {i}"}, {"user_id": str(admin.id)}],
                    participants=[{"name": f"Guest {i}"}],
                )

        async def count() -> tuple[int, int]:
            statements: list[str] = []
            bind = db.sync_session.get_bind()

            def _record(conn, cursor, statement, parameters, context, executemany):
                statements.append(statement)

            sa_event.listen(bind, "before_cursor_execute", _record)
            try:
                resp = await client.get(f"{URL}?include_content=true", headers=auth_headers(admin))
            finally:
                sa_event.remove(bind, "before_cursor_execute", _record)
            rows = resp.json()
            guests = sorted(p["display_name"] for row in rows for p in row["participants"])
            return len(statements), len(rows), guests

        await add(2)
        few, rows_few, guests_few = await count()
        await add(5)
        many, rows_many, guests_many = await count()

        assert (rows_few, rows_many) == (3, 8)
        assert guests_few == ["Guest 0", "Guest 1"]
        assert len(guests_many) == 7
        assert many == few
