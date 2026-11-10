"""Decision and SoAW review events are stored, not only broadcast.

Every workflow route of a decision (request signatures, sign, recall, reject,
link and unlink a card) and of a SoAW (request signatures, sign, recall,
reject) publishes its event with ``db=``. Published after the route's last
``commit()``, the ``Event`` row and its auto-batch were flushed into a
transaction nobody committed and vanished when the request's session closed:
live listeners saw the event, the activity feed and the card history never did.

The test session is shared with the request (``get_db`` override), so a row
flushed after the commit is still visible to a plain query. Two checks make the
defect visible here instead:

- ``publish_commit_log`` records the order of commits and publishes: the
  route's last call must be its commit, with the event published before it;
- each test commits its setup, calls the route, then rolls the session back
  (what closing an uncommitted request session does) before reading the event
  row: only what the route committed survives.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.notification import Notification
from app.services import adr_service
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

ADR = "/api/v1/adr"
SOAW = "/api/v1/soaw"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada")
    one = await create_user(db, email="one@test.com", role="member", display_name="One")
    two = await create_user(db, email="two@test.com", role="member", display_name="Two")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing", user_id=admin.id)
    return {
        "admin": admin,
        "one": one,
        "two": two,
        "card": card,
        # Plain values: the session is rolled back mid-test, which expires
        # the ORM objects above.
        "ids": {"admin": admin.id, "one": one.id, "two": two.id, "card": card.id},
        "headers": {
            "admin": auth_headers(admin),
            "one": auth_headers(one),
            "two": auth_headers(two),
        },
    }


async def _commit_setup(db, log) -> None:
    """Commit what the test has built so far and start the log afresh."""
    await db.commit()
    log.clear()


def _assert_published_before_the_last_commit(log, event_type: str) -> None:
    assert log.count(("publish", event_type, True)) == 1
    assert log[-1] == ("commit",)
    persisted = [i for i, entry in enumerate(log) if entry[0] == "publish" and entry[2]]
    last_commit = max(i for i, entry in enumerate(log) if entry == ("commit",))
    assert max(persisted) < last_commit


async def _stored(db, event_type: str) -> list[Event]:
    """The ``event_type`` rows that survive dropping everything uncommitted."""
    await db.rollback()
    rows = await db.execute(
        select(Event).where(Event.event_type == event_type).order_by(Event.created_at)
    )
    return list(rows.scalars().all())


async def _batch_exists(db, batch_id) -> bool:
    found = await db.execute(select(MutationBatch.id).where(MutationBatch.id == batch_id))
    return found.scalar_one_or_none() == batch_id


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------


async def _adr(client, env, title="Event ADR") -> dict:
    resp = await client.post(ADR, json={"title": title}, headers=env["headers"]["admin"])
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _adr_request(client, env, adr_id, *signers) -> None:
    resp = await client.post(
        f"{ADR}/{adr_id}/request-signatures",
        json={"user_ids": [str(env["ids"][s]) for s in signers]},
        headers=env["headers"]["admin"],
    )
    assert resp.status_code == 200, resp.text


class TestDecisionEvents:
    async def test_request_signatures(self, client, db, env, publish_commit_log):
        adr = await _adr(client, env)
        await _commit_setup(db, publish_commit_log)

        await _adr_request(client, env, adr["id"], "one", "two")

        _assert_published_before_the_last_commit(publish_commit_log, "adr.signatures_requested")
        (event,) = await _stored(db, "adr.signatures_requested")
        assert event.data == {
            "id": adr["id"],
            "reference_number": adr["reference_number"],
            "revision_number": 1,
            "title": "Event ADR",
            "signatory_count": 2,
        }
        assert event.user_id == env["ids"]["admin"]
        assert event.card_id is None
        assert await _batch_exists(db, event.batch_id) is True

    async def test_sign_partial_then_complete(self, client, db, env, publish_commit_log):
        adr = await _adr(client, env)
        await _adr_request(client, env, adr["id"], "one", "two")
        await _commit_setup(db, publish_commit_log)

        first = await client.post(
            f"{ADR}/{adr['id']}/sign",
            json={"comment": "Fine by me"},
            headers=env["headers"]["one"],
        )
        assert first.status_code == 200, first.text
        _assert_published_before_the_last_commit(publish_commit_log, "adr.signed")

        await _commit_setup(db, publish_commit_log)
        second = await client.post(f"{ADR}/{adr['id']}/sign", headers=env["headers"]["two"])
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "signed"
        _assert_published_before_the_last_commit(publish_commit_log, "adr.signed")

        partial, complete = await _stored(db, "adr.signed")
        base = {
            "id": adr["id"],
            "reference_number": adr["reference_number"],
            "revision_number": 1,
            "title": "Event ADR",
        }
        assert partial.data == {**base, "signer": "One", "all_signed": False}
        assert complete.data == {**base, "signer": "Two", "all_signed": True}
        assert (partial.user_id, complete.user_id) == (env["ids"]["one"], env["ids"]["two"])
        assert await _batch_exists(db, complete.batch_id) is True

    async def test_recall(self, client, db, env, publish_commit_log):
        adr = await _adr(client, env)
        await _adr_request(client, env, adr["id"], "one")
        await _commit_setup(db, publish_commit_log)

        resp = await client.post(
            f"{ADR}/{adr['id']}/recall-signatures", headers=env["headers"]["admin"]
        )
        assert resp.status_code == 200, resp.text

        _assert_published_before_the_last_commit(publish_commit_log, "adr.signatures_recalled")
        (event,) = await _stored(db, "adr.signatures_recalled")
        assert event.data == {
            "id": adr["id"],
            "reference_number": adr["reference_number"],
            "revision_number": 1,
            "title": "Event ADR",
        }
        assert event.user_id == env["ids"]["admin"]

    async def test_reject_stores_no_reason(self, client, db, env, publish_commit_log):
        adr = await _adr(client, env)
        await _adr_request(client, env, adr["id"], "one", "two")
        await _commit_setup(db, publish_commit_log)

        resp = await client.post(
            f"{ADR}/{adr['id']}/reject",
            json={"comment": "Budget not agreed"},
            headers=env["headers"]["one"],
        )
        assert resp.status_code == 200, resp.text

        _assert_published_before_the_last_commit(publish_commit_log, "adr.rejected")
        (event,) = await _stored(db, "adr.rejected")
        # The reason is not in the event every feed reader can see...
        assert event.data == {
            "id": adr["id"],
            "reference_number": adr["reference_number"],
            "revision_number": 1,
            "title": "Event ADR",
            "rejector": "One",
        }
        assert event.user_id == env["ids"]["one"]
        # ...the people it is addressed to still get it.
        notes = (
            await db.execute(
                select(Notification).where(
                    Notification.type == "adr_rejected",
                    Notification.user_id == env["ids"]["two"],
                )
            )
        ).scalars()
        (note,) = list(notes)
        assert note.data["comment"] == "Budget not agreed"

    async def test_link_and_unlink_a_card(self, client, db, env, publish_commit_log):
        adr = await _adr(client, env)
        card_id = env["ids"]["card"]
        await _commit_setup(db, publish_commit_log)

        linked = await client.post(
            f"{ADR}/{adr['id']}/cards",
            json={"card_id": str(card_id)},
            headers=env["headers"]["admin"],
        )
        assert linked.status_code == 201, linked.text
        _assert_published_before_the_last_commit(publish_commit_log, "adr.linked")

        await _commit_setup(db, publish_commit_log)
        unlinked = await client.delete(
            f"{ADR}/{adr['id']}/cards/{card_id}", headers=env["headers"]["admin"]
        )
        assert unlinked.status_code == 204, unlinked.text
        _assert_published_before_the_last_commit(publish_commit_log, "adr.unlinked")

        expected = {
            "adr_id": adr["id"],
            "reference_number": adr["reference_number"],
            "revision_number": 1,
            "title": "Event ADR",
            "status": "draft",
            "link": adr_service.decision_link(uuid.UUID(adr["id"])),
        }
        (link_event,) = await _stored(db, "adr.linked")
        # Read before the next rollback expires the row.
        assert (link_event.data, link_event.card_id, link_event.user_id) == (
            expected,
            card_id,
            env["ids"]["admin"],
        )
        (unlink_event,) = await _stored(db, "adr.unlinked")
        assert (unlink_event.data, unlink_event.card_id, unlink_event.user_id) == (
            expected,
            card_id,
            env["ids"]["admin"],
        )


# ---------------------------------------------------------------------------
# Statements of Architecture Work
# ---------------------------------------------------------------------------


async def _soaw(client, env) -> dict:
    resp = await client.post(
        SOAW, json={"name": "Event SoAW", "status": "draft"}, headers=env["headers"]["admin"]
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _soaw_request(client, env, soaw_id, *signers) -> None:
    resp = await client.post(
        f"{SOAW}/{soaw_id}/request-signatures",
        json={"user_ids": [str(env["ids"][s]) for s in signers]},
        headers=env["headers"]["admin"],
    )
    assert resp.status_code == 200, resp.text


class TestSoAWEvents:
    async def test_request_signatures(self, client, db, env, publish_commit_log):
        doc = await _soaw(client, env)
        await _commit_setup(db, publish_commit_log)

        await _soaw_request(client, env, doc["id"], "one")

        _assert_published_before_the_last_commit(publish_commit_log, "soaw.signatures_requested")
        (event,) = await _stored(db, "soaw.signatures_requested")
        assert event.data == {
            "id": doc["id"],
            "name": "Event SoAW",
            "revision_number": 1,
            "signatory_count": 1,
        }
        assert event.user_id == env["ids"]["admin"]
        assert event.card_id is None
        assert await _batch_exists(db, event.batch_id) is True

    async def test_sign_partial_then_complete(self, client, db, env, publish_commit_log):
        doc = await _soaw(client, env)
        await _soaw_request(client, env, doc["id"], "one", "two")
        await _commit_setup(db, publish_commit_log)

        first = await client.post(f"{SOAW}/{doc['id']}/sign", headers=env["headers"]["one"])
        assert first.status_code == 200, first.text
        _assert_published_before_the_last_commit(publish_commit_log, "soaw.signed")

        await _commit_setup(db, publish_commit_log)
        second = await client.post(f"{SOAW}/{doc['id']}/sign", headers=env["headers"]["two"])
        assert second.status_code == 200, second.text
        _assert_published_before_the_last_commit(publish_commit_log, "soaw.signed")

        partial, complete = await _stored(db, "soaw.signed")
        base = {"id": doc["id"], "name": "Event SoAW", "revision_number": 1}
        assert partial.data == {**base, "signer": "One", "all_signed": False}
        assert complete.data == {**base, "signer": "Two", "all_signed": True}
        assert (partial.user_id, complete.user_id) == (env["ids"]["one"], env["ids"]["two"])

    async def test_recall(self, client, db, env, publish_commit_log):
        doc = await _soaw(client, env)
        await _soaw_request(client, env, doc["id"], "one")
        await _commit_setup(db, publish_commit_log)

        resp = await client.post(
            f"{SOAW}/{doc['id']}/recall-signatures", headers=env["headers"]["admin"]
        )
        assert resp.status_code == 200, resp.text

        _assert_published_before_the_last_commit(publish_commit_log, "soaw.signatures_recalled")
        (event,) = await _stored(db, "soaw.signatures_recalled")
        assert event.data == {"id": doc["id"], "name": "Event SoAW", "revision_number": 1}
        assert event.user_id == env["ids"]["admin"]

    async def test_reject_stores_no_reason(self, client, db, env, publish_commit_log):
        doc = await _soaw(client, env)
        await _soaw_request(client, env, doc["id"], "one", "two")
        await _commit_setup(db, publish_commit_log)

        resp = await client.post(
            f"{SOAW}/{doc['id']}/reject",
            json={"comment": "Scope unclear"},
            headers=env["headers"]["one"],
        )
        assert resp.status_code == 200, resp.text

        _assert_published_before_the_last_commit(publish_commit_log, "soaw.rejected")
        (event,) = await _stored(db, "soaw.rejected")
        assert event.data == {
            "id": doc["id"],
            "name": "Event SoAW",
            "revision_number": 1,
            "rejector": "One",
        }
        assert event.user_id == env["ids"]["one"]
        notes = (
            await db.execute(
                select(Notification).where(
                    Notification.type == "soaw_rejected",
                    Notification.user_id == env["ids"]["two"],
                )
            )
        ).scalars()
        (note,) = list(notes)
        assert note.data["comment"] == "Scope unclear"


class TestTheLog:
    """The fixture itself: it records both kinds of call, in order."""

    async def test_records_commits_and_publishes(self, db, publish_commit_log):
        from app.services.event_bus import event_bus

        await event_bus.publish("probe.live", {"x": 1})
        await event_bus.publish("probe.kept", {"x": 2}, db=db)
        await db.commit()
        assert publish_commit_log == [
            ("publish", "probe.live", False),
            ("publish", "probe.kept", True),
            ("commit",),
        ]
        (kept,) = await _stored(db, "probe.kept")
        assert kept.data == {"x": 2}
