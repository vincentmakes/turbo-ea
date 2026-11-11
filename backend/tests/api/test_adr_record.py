"""Record as decided: a draft locked as a decision taken outside Turbo EA.

``POST /adr/{id}/record`` needs ``adr.record`` (admin only by default). The
decision becomes ``signed`` with ``recorded_at`` / ``recorded_by`` and no
signatories, writes ``admin.adr.recorded`` to the Security & admin log and
publishes ``adr.recorded``. Locking a decision that replaces, amends or
revokes another notifies that decision's author (``adr_standing_changed``),
whether it locks by its final signature or by being recorded.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.permissions import (
    BPM_ADMIN_PERMISSIONS,
    MEMBER_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.audit_log import AuditLogEntry
from app.models.event import Event
from app.models.notification import Notification
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/adr"


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _days(n: int) -> str:
    return (_today() + timedelta(days=n)).isoformat()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="bpm_admin", label="BPM Admin", permissions=BPM_ADMIN_PERMISSIONS)
    return {
        "admin": await create_user(
            db, email="admin@test.com", role="admin", display_name="Ann Admin"
        ),
        "member": await create_user(
            db, email="member@test.com", role="member", display_name="Mo Member"
        ),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
        "bpm_admin": await create_user(db, email="bpm@test.com", role="bpm_admin"),
    }


MAKERS = [{"name": "Architecture Board"}]


async def _create(client, user, title="Decision", **extra) -> dict:
    resp = await client.post(URL, json={"title": title, **extra}, headers=auth_headers(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _record(client, user, adr_id, **body):
    return await client.post(f"{URL}/{adr_id}/record", json=body, headers=auth_headers(user))


async def _recorded(client, admin, title="Recorded", decided_on=None, **extra) -> dict:
    adr = await _create(client, admin, title, decision_makers=MAKERS, **extra)
    resp = await _record(client, admin, adr["id"], decided_on=decided_on or _days(-10))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _sign(client, admin, adr_id) -> dict:
    resp = await client.post(
        f"{URL}/{adr_id}/request-signatures",
        json={"user_ids": [str(admin.id)]},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"{URL}/{adr_id}/sign", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _get(client, user, adr_id) -> dict:
    resp = await client.get(f"{URL}/{adr_id}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _notices(db, user_id) -> list[Notification]:
    rows = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id, Notification.type == "adr_standing_changed")
        .order_by(Notification.title, Notification.message)
    )
    return list(rows.scalars().all())


# ---------------------------------------------------------------------------
# Success
# ---------------------------------------------------------------------------


class TestRecord:
    async def test_records_a_draft_with_exact_fields(self, client, env, db):
        admin = env["admin"]
        adr = await _create(
            client,
            admin,
            "Use Postgres",
            decision_makers=[{"user_id": str(env["member"].id)}, {"name": "Board"}],
        )

        resp = await _record(client, admin, adr["id"], decided_on=_days(-30))
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert body["status"] == "signed"
        assert body["decided_on"] == _days(-30)
        assert body["effective_from"] == _days(-30)
        assert body["signed_at"] is None
        assert body["signatories"] == []
        assert body["recorded_at"] is not None
        assert body["recorded_by"] == {"user_id": str(admin.id), "display_name": "Ann Admin"}
        assert body["standing"] == "in_force"
        assert body["revision_number"] == 1
        assert body["reference_number"] == adr["reference_number"]
        row = next(
            r
            for r in (await client.get(URL, headers=auth_headers(admin))).json()
            if r["id"] == adr["id"]
        )
        assert row["recorded_at"] == body["recorded_at"]
        assert row["standing"] == "in_force"

    async def test_effective_from_may_be_given(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS)

        resp = await _record(
            client, admin, adr["id"], decided_on=_days(-5), effective_from=_days(10)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["decided_on"] == _days(-5)
        assert resp.json()["effective_from"] == _days(10)
        assert resp.json()["standing"] == "scheduled"

    async def test_today_is_allowed(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS)
        resp = await _record(client, admin, adr["id"], decided_on=_days(0))
        assert resp.status_code == 200, resp.text
        assert resp.json()["standing"] == "in_force"

    async def test_writes_the_audit_row(self, client, env, db):
        admin = env["admin"]
        adr = await _create(
            client,
            admin,
            "Use Postgres",
            decision_makers=[{"user_id": str(env["member"].id)}, {"name": "Board"}],
        )
        await _record(client, admin, adr["id"], decided_on=_days(-3), effective_from=_days(-1))

        rows = (
            (
                await db.execute(
                    select(AuditLogEntry).where(AuditLogEntry.action == "admin.adr.recorded")
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        entry = rows[0]
        assert entry.category == "admin"
        assert entry.outcome == "success"
        assert entry.actor_user_id == admin.id
        assert entry.actor_email == "admin@test.com"
        assert entry.target_type == "architecture_decision"
        assert entry.target_id == adr["id"]
        assert entry.target_label == f"{adr['reference_number']} — Use Postgres"
        assert entry.details == {
            "context": {
                "decided_on": _days(-3),
                "effective_from": _days(-1),
                "decision_makers": ["Mo Member", "Board"],
            }
        }

    async def test_publishes_adr_recorded(self, client, env, db):
        admin = env["admin"]
        adr = await _create(client, admin, "Use Postgres", decision_makers=MAKERS)
        await _record(client, admin, adr["id"], decided_on=_days(-3))

        events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.recorded")))
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].user_id == admin.id
        assert events[0].card_id is None
        assert events[0].data["id"] == adr["id"]
        assert events[0].data["reference_number"] == adr["reference_number"]
        assert events[0].data["revision_number"] == 1
        assert events[0].data["title"] == "Use Postgres"
        assert events[0].data["decided_on"] == _days(-3)
        assert events[0].data["effective_from"] == _days(-3)


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------


class TestRefusals:
    @pytest.mark.parametrize("role", ["member", "viewer", "bpm_admin"])
    async def test_needs_adr_record(self, client, env, role):
        adr = await _create(client, env["admin"], decision_makers=MAKERS)
        resp = await _record(client, env[role], adr["id"], decided_on=_days(-1))
        assert resp.status_code == 403
        assert (await _get(client, env["admin"], adr["id"]))["status"] == "draft"

    async def test_a_role_granted_adr_record_may_record(self, client, env, db):
        await create_role(db, key="recorder", label="Recorder", permissions={"adr.record": True})
        recorder = await create_user(db, email="rec@test.com", role="recorder")
        adr = await _create(client, env["admin"], decision_makers=MAKERS)
        resp = await _record(client, recorder, adr["id"], decided_on=_days(-1))
        assert resp.status_code == 200, resp.text

    async def test_only_a_draft(self, client, env):
        admin = env["admin"]
        recorded = await _recorded(client, admin)
        resp = await _record(client, admin, recorded["id"], decided_on=_days(-1))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {"error": "not_draft"}

        in_review = await _create(client, admin, decision_makers=MAKERS)
        await client.post(
            f"{URL}/{in_review['id']}/request-signatures",
            json={"user_ids": [str(admin.id)]},
            headers=auth_headers(admin),
        )
        resp = await _record(client, admin, in_review["id"], decided_on=_days(-1))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {"error": "not_draft"}

    async def test_needs_a_decision_maker(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, participants=[{"name": "Not a maker"}])
        resp = await _record(client, admin, adr["id"], decided_on=_days(-1))
        assert resp.status_code == 400
        assert resp.json()["detail"] == {
            "error": "invalid_record",
            "problems": ["no_decision_maker"],
        }
        assert (await _get(client, admin, adr["id"]))["status"] == "draft"

    async def test_decided_on_cannot_be_in_the_future(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS)
        resp = await _record(client, admin, adr["id"], decided_on=_days(2))
        assert resp.status_code == 400
        assert resp.json()["detail"] == {
            "error": "invalid_record",
            "problems": ["decided_on_future"],
        }
        assert (await _get(client, admin, adr["id"]))["status"] == "draft"

    async def test_decided_on_tomorrow_is_accepted_for_authors_ahead_of_utc(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS)
        resp = await _record(client, admin, adr["id"], decided_on=_days(1))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["status"], body["decided_on"], body["effective_from"]) == (
            "signed",
            _days(1),
            _days(1),
        )

    async def test_problems_are_listed_together(self, client, env):
        adr = await _create(client, env["admin"])
        resp = await _record(client, env["admin"], adr["id"], decided_on=_days(2))
        assert resp.json()["detail"]["problems"] == ["no_decision_maker", "decided_on_future"]

    async def test_body_is_strict(self, client, env):
        adr = await _create(client, env["admin"], decision_makers=MAKERS)
        resp = await _record(client, env["admin"], adr["id"], decided_on=_days(-1), status="x")
        assert resp.status_code == 422
        resp = await _record(client, env["admin"], adr["id"])
        assert resp.status_code == 422

    async def test_a_link_to_an_unlocked_decision_is_refused(self, client, env):
        admin = env["admin"]
        draft = await _create(client, admin, "Draft target")
        adr = await _create(
            client,
            admin,
            decision_makers=MAKERS,
            links=[{"decision_id": draft["id"], "kind": "relates"}],
        )
        resp = await _record(client, admin, adr["id"], decided_on=_days(-1))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "link_target_not_locked",
            "problems": ["link_target_not_locked"],
            "target_ids": [draft["id"]],
        }
        assert (await _get(client, admin, adr["id"]))["status"] == "draft"

    async def test_valid_until_in_the_past_is_refused(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS, valid_until=_days(-2))
        resp = await _record(client, admin, adr["id"], decided_on=_days(-5))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {
            "error": "valid_until_past",
            "problems": ["valid_until_past"],
        }
        assert (await _get(client, admin, adr["id"]))["status"] == "draft"

    async def test_valid_until_yesterday_is_accepted_for_authors_behind_utc(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS, valid_until=_days(-1))
        resp = await _record(client, admin, adr["id"], decided_on=_days(-5))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["status"], body["valid_until"], body["effective_from"]) == (
            "signed",
            _days(-1),
            _days(-5),
        )

    async def test_valid_until_before_effective_from_is_refused(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, decision_makers=MAKERS, valid_until=_days(5))
        resp = await _record(
            client, admin, adr["id"], decided_on=_days(-1), effective_from=_days(10)
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["problems"] == ["valid_until_before_effective"]

    async def test_a_closed_chain_is_refused(self, client, env):
        admin = env["admin"]
        target = await _recorded(client, admin, "Target")
        revision = (
            await client.post(f"{URL}/{target['id']}/revise", headers=auth_headers(admin))
        ).json()
        await client.patch(
            f"{URL}/{revision['id']}", json={"decision_makers": MAKERS}, headers=auth_headers(admin)
        )
        revoker = await _recorded(
            client,
            admin,
            "Revoker",
            links=[{"decision_id": target["id"], "kind": "revokes"}],
        )

        resp = await _record(client, admin, revision["id"], decided_on=_days(-1))
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["error"] == "chain_closed"
        assert detail["problems"] == ["chain_closed"]
        assert detail["by"]["id"] == revoker["id"]

    async def test_unknown_decision_is_404(self, client, env):
        missing = "00000000-0000-0000-0000-000000000001"
        resp = await _record(client, env["admin"], missing, decided_on=_days(-1))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Revisions (R12) and the rest of the workflow
# ---------------------------------------------------------------------------


class TestRevisions:
    async def test_a_revision_draft_may_be_recorded_on_or_after_its_parent(self, client, env):
        admin = env["admin"]
        parent = await _recorded(client, admin, "Parent", decided_on=_days(-10))
        revision = (
            await client.post(f"{URL}/{parent['id']}/revise", headers=auth_headers(admin))
        ).json()
        assert revision["decision_makers"] == [
            {"user_id": None, "display_name": "Architecture Board"}
        ]

        resp = await _record(client, admin, revision["id"], decided_on=_days(-11))
        assert resp.status_code == 400
        assert resp.json()["detail"] == {
            "error": "invalid_record",
            "problems": ["decided_before_parent"],
        }

        resp = await _record(client, admin, revision["id"], decided_on=_days(-10))
        assert resp.status_code == 200, resp.text
        assert resp.json()["revision_number"] == 2
        old = await _get(client, admin, parent["id"])
        assert old["standing"] == "superseded"
        assert old["is_earlier_revision"] is True

    async def test_a_recorded_decision_is_revisable_and_the_stamp_is_not_carried(self, client, env):
        admin = env["admin"]
        recorded = await _recorded(client, admin)
        resp = await client.post(f"{URL}/{recorded['id']}/revise", headers=auth_headers(admin))
        assert resp.status_code == 200, resp.text
        revision = resp.json()
        assert revision["status"] == "draft"
        assert revision["revision_number"] == 2
        assert revision["recorded_at"] is None
        assert revision["recorded_by"] is None
        assert revision["decided_on"] is None
        assert revision["effective_from"] is None

    async def test_a_recorded_decision_is_locked(self, client, env):
        admin = env["admin"]
        recorded = await _recorded(client, admin)
        rid = recorded["id"]
        h = auth_headers(admin)

        assert (
            await client.patch(f"{URL}/{rid}", json={"title": "x"}, headers=h)
        ).status_code == 403
        assert (await client.delete(f"{URL}/{rid}", headers=h)).status_code == 400
        assert (await client.post(f"{URL}/{rid}/sign", headers=h)).status_code == 400
        resp = await client.post(
            f"{URL}/{rid}/request-signatures", json={"user_ids": [str(admin.id)]}, headers=h
        )
        assert resp.status_code == 400
        assert (await client.post(f"{URL}/{rid}/recall-signatures", headers=h)).status_code == 400
        resp = await client.post(f"{URL}/{rid}/reject", json={"comment": "no"}, headers=h)
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Standing-changed notifications
# ---------------------------------------------------------------------------


class TestStandingNotifications:
    async def test_recording_a_replacement_supersedes_and_notifies_the_author(
        self, client, env, db
    ):
        admin, member = env["admin"], env["member"]
        old = await _create(client, member, "Old way")
        old = await _sign(client, admin, old["id"])

        new = await _recorded(
            client,
            admin,
            "New way",
            links=[{"decision_id": old["id"], "kind": "replaces"}],
        )

        old_now = await _get(client, admin, old["id"])
        assert old_now["standing"] == "superseded"
        assert old_now["superseded_by"]["id"] == new["id"]

        notices = await _notices(db, member.id)
        assert len(notices) == 1
        n = notices[0]
        assert n.title == "ADR Standing Changed"
        assert n.message == (
            f'"{new["reference_number"]} — New way" replaces "{old["reference_number"]} — Old way"'
        )
        assert n.link == f"/ea-delivery/adr/{old['id']}/preview"
        assert n.actor_id == admin.id
        assert n.data == {
            "adr_id": old["id"],
            "adr_title": "Old way",
            "by_adr_id": new["id"],
            "by_adr_title": "New way",
            "kind": "replaces",
        }
        assert await _notices(db, admin.id) == []

    async def test_the_final_signature_notifies_each_author_once_per_target(self, client, env, db):
        admin, member = env["admin"], env["member"]
        targets = {}
        for title in ("Replaced", "Amended", "Revoked"):
            created = await _create(client, member, title)
            targets[title] = await _sign(client, admin, created["id"])
        own = await _sign(client, admin, (await _create(client, admin, "Own"))["id"])
        related = await _create(client, member, "Related")
        related = await _sign(client, admin, related["id"])

        actor = await _create(
            client,
            admin,
            "Actor",
            links=[
                {"decision_id": targets["Replaced"]["id"], "kind": "replaces"},
                {"decision_id": targets["Amended"]["id"], "kind": "amends"},
                {"decision_id": targets["Revoked"]["id"], "kind": "revokes"},
                {"decision_id": own["id"], "kind": "replaces"},
                {"decision_id": related["id"], "kind": "relates"},
            ],
        )
        # Sent for signature to two people: the first signature locks nothing.
        resp = await client.post(
            f"{URL}/{actor['id']}/request-signatures",
            json={"user_ids": [str(admin.id), str(member.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        resp = await client.post(f"{URL}/{actor['id']}/sign", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert await _notices(db, member.id) == []

        # The member's own signature locks it; they authored the targets, so
        # they are the actor: no notice to themselves.
        resp = await client.post(f"{URL}/{actor['id']}/sign", headers=auth_headers(member))
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "signed"
        assert await _notices(db, member.id) == []
        # The admin authored ``own`` but did not give the final signature.
        notices = await _notices(db, admin.id)
        assert [(n.data["adr_id"], n.data["kind"]) for n in notices] == [(own["id"], "replaces")]

    async def test_signing_notifies_the_authors_of_replaced_amended_and_revoked(
        self, client, env, db
    ):
        admin, member = env["admin"], env["member"]
        targets = {}
        for title in ("Replaced", "Amended", "Revoked"):
            created = await _create(client, member, title)
            targets[title] = await _sign(client, admin, created["id"])
        actor = await _create(
            client,
            admin,
            "Actor",
            links=[
                {"decision_id": targets["Replaced"]["id"], "kind": "replaces"},
                {"decision_id": targets["Amended"]["id"], "kind": "amends"},
                {"decision_id": targets["Revoked"]["id"], "kind": "revokes"},
            ],
        )
        await _sign(client, admin, actor["id"])

        notices = await _notices(db, member.id)
        got = sorted((n.data["adr_id"], n.data["kind"], n.message) for n in notices)
        ref = actor["reference_number"]
        assert got == sorted(
            (
                targets[title]["id"],
                kind,
                f'"{ref} — Actor" {kind} "{targets[title]["reference_number"]} — {title}"',
            )
            for title, kind in (
                ("Replaced", "replaces"),
                ("Amended", "amends"),
                ("Revoked", "revokes"),
            )
        )
        assert all(n.actor_id == admin.id for n in notices)


# ---------------------------------------------------------------------------
# decided_from / decided_to
# ---------------------------------------------------------------------------


class TestDecidedFilters:
    async def test_filters_recorded_and_signed_alike(self, client, env):
        admin = env["admin"]
        recorded = await _recorded(client, admin, "Recorded", decided_on=_days(-40))
        signed = await _sign(client, admin, (await _create(client, admin, "Signed"))["id"])
        draft = await _create(client, admin, "Draft")

        async def ids(query: str) -> set[str]:
            resp = await client.get(f"{URL}{query}", headers=auth_headers(admin))
            assert resp.status_code == 200, resp.text
            return {r["id"] for r in resp.json()}

        assert await ids(f"?decided_from={_days(-40)}&decided_to={_days(-40)}") == {recorded["id"]}
        assert await ids(f"?decided_from={_days(-39)}") == {signed["id"]}
        assert await ids(f"?decided_to={_days(-1)}") == {recorded["id"]}
        assert await ids(f"?decided_from={_days(-40)}") == {recorded["id"], signed["id"]}
        assert draft["id"] in await ids("")
        # The signed_* filters read signed_at: a recorded decision has none.
        assert await ids(f"?signed_from={_days(-400)}") == {signed["id"]}

    async def test_a_malformed_date_is_422(self, client, env):
        resp = await client.get(f"{URL}?decided_from=yesterday", headers=auth_headers(env["admin"]))
        assert resp.status_code == 422
