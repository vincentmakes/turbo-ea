"""Who may roll back (or preview rolling back) a mutation batch.

The rule matches the batch's read endpoints: the batch's own actor may, and
everyone else needs ``admin.events``. A batch with no actor — one an
extension wrote, or an auto-batch of a write no person made — has no owner,
so it needs ``admin.events`` from everyone. Before 2.209.0 the rollback route
read "no actor" as "nobody else's", and any signed-in user could preview
(old values included) and apply the rollback of such a batch.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models.card import Card
from app.models.event import Event
from app.models.user import User
from app.services import mutation_batch_service
from tests.conftest import auth_headers, create_card, create_user


async def _batch_with_one_edit(db, *, actor: User | None) -> tuple[str, Card]:
    """A committed batch holding one ``card.updated`` (name "Old" → "New")."""
    card = await create_card(db, card_type="Application", name="New")
    batch = await mutation_batch_service.create_batch(
        db, tool_name="ext:sample-connector", actor=actor, origin="ext", dry_run=False
    )
    db.add(
        Event(
            card_id=card.id,
            user_id=actor.id if actor else None,
            event_type="card.updated",
            data={"id": str(card.id), "changes": {"name": {"old": "Old", "new": "New"}}},
            batch_id=batch.id,
        )
    )
    batch.committed_at = datetime.now(timezone.utc)
    await db.flush()
    return str(batch.id), card


async def _rollback(client, user, batch_id: str, *, dry_run: bool):
    return await client.post(
        f"/api/v1/mutation-batches/{batch_id}/rollback",
        json={"dry_run": dry_run},
        headers=auth_headers(user),
    )


@pytest.fixture
async def member(db, member_role):
    return await create_user(db, email="member-rb@test.com", role="member")


class TestActorlessBatch:
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_a_member_may_not_roll_it_back(self, client, db, app_card_type, member, dry_run):
        batch_id, card = await _batch_with_one_edit(db, actor=None)
        resp = await _rollback(client, member, batch_id, dry_run=dry_run)
        assert resp.status_code == 403, resp.text
        assert "operations" not in resp.json()
        await db.refresh(card)
        assert card.name == "New"

    async def test_an_admin_events_holder_may(self, client, db, app_card_type, admin_user):
        batch_id, card = await _batch_with_one_edit(db, actor=None)
        preview = await _rollback(client, admin_user, batch_id, dry_run=True)
        assert preview.status_code == 200, preview.text
        assert preview.json()["operations"][0]["fields"] == {"name": "Old"}
        done = await _rollback(client, admin_user, batch_id, dry_run=False)
        assert done.status_code == 200, done.text
        await db.refresh(card)
        assert card.name == "Old"


class TestOwnedBatch:
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_its_actor_may_roll_it_back_without_admin_events(
        self, client, db, app_card_type, member, dry_run
    ):
        batch_id, _ = await _batch_with_one_edit(db, actor=member)
        resp = await _rollback(client, member, batch_id, dry_run=dry_run)
        assert resp.status_code == 200, resp.text

    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_someone_elses_batch_stays_refused(
        self, client, db, app_card_type, member, admin_user, dry_run
    ):
        batch_id, _ = await _batch_with_one_edit(db, actor=admin_user)
        resp = await _rollback(client, member, batch_id, dry_run=dry_run)
        assert resp.status_code == 403, resp.text

    async def test_force_still_needs_admin_events_on_an_own_batch(
        self, client, db, app_card_type, member
    ):
        batch_id, _ = await _batch_with_one_edit(db, actor=member)
        resp = await client.post(
            f"/api/v1/mutation-batches/{batch_id}/rollback",
            json={"dry_run": True, "force": True},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403, resp.text
