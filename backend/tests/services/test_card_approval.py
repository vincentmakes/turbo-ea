"""The approval-break rule and the notifications it owes.

An APPROVED card drops to BROKEN whenever a substantive field changes. Until
2.122 that flip was recorded nowhere — not in the ``card.updated`` payload the
History tab renders, and not in a notification to the stakeholders who now owe
a re-review. These tests pin both halves, plus the two things the fan-out does
that ``create_notifications_for_subscribers`` does not: dedup by user, and drop
the actor before a row is ever built.
"""

from __future__ import annotations

import pathlib

import pytest

from app.models.stakeholder import Stakeholder
from app.services import card_approval
from tests.conftest import create_card, create_card_type, create_user

APP = pathlib.Path(__file__).resolve().parents[2] / "app"


@pytest.fixture
async def env(db):
    await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=[{"section": "General", "fields": []}],
    )
    editor = await create_user(db, email="editor@test.com", role="admin")
    owner = await create_user(db, email="owner@test.com", role="member")
    return {"editor": editor, "owner": owner}


class TestBreakApproval:
    """Only an APPROVED card, only on a status-breaking field."""

    async def test_flips_on_a_breaking_field(self, db, env):
        card = await create_card(db, name="A", approval_status="APPROVED")
        assert card_approval.break_approval(card, ["description"]) is True
        assert card.approval_status == "BROKEN"

    async def test_ignores_a_non_breaking_field(self, db, env):
        card = await create_card(db, name="A", approval_status="APPROVED")
        assert card_approval.break_approval(card, ["data_quality"]) is False
        assert card.approval_status == "APPROVED"

    @pytest.mark.parametrize("status", ["DRAFT", "REJECTED", "BROKEN"])
    async def test_only_an_approved_card_breaks(self, db, env, status):
        card = await create_card(db, name="A", approval_status=status)
        assert card_approval.break_approval(card, ["name"]) is False
        assert card.approval_status == status

    def test_the_rule_is_not_duplicated_anywhere(self):
        """Four hand-rolled copies of this set is how turbolens grew a fifth.

        A source-level assertion because the drift is invisible at runtime:
        each copy works, they just stop agreeing.
        """
        for rel in (
            "services/card_write_service.py",
            "services/card_lifecycle.py",
            "api/v1/cards.py",
            "api/v1/turbolens.py",
        ):
            source = (APP / rel).read_text()
            assert "status_breaking = {" not in source, rel
            assert 'card.approval_status = "BROKEN"' not in source, rel


class TestBuildRecipients:
    async def test_one_entry_per_person_however_many_cards_broke(self, db, env):
        editor, owner = env["editor"], env["owner"]
        cards = [await create_card(db, name=f"App {i}", approval_status="BROKEN") for i in range(3)]
        for c in cards:
            db.add(Stakeholder(card_id=c.id, user_id=owner.id, role="responsible"))
        await db.flush()

        recipients = await card_approval.build_approval_broken_recipients(
            db, cards=cards, actor_id=editor.id, actor_display_name="Editor"
        )
        assert len(recipients) == 1
        entry = recipients[0]
        assert entry["user_id"] == owner.id
        assert entry["title"] == "3 cards need re-approval"
        assert entry["link"] == card_approval.APPROVAL_BROKEN_LINK
        assert entry["data"]["card_count"] == 3
        assert len(entry["email_items"]) == 3
        # No single card to point at, so no card scoping on the bell row.
        assert "card_id" not in entry

    async def test_a_single_card_links_straight_to_it(self, db, env):
        editor, owner = env["editor"], env["owner"]
        card = await create_card(db, name="Solo", approval_status="BROKEN")
        db.add(Stakeholder(card_id=card.id, user_id=owner.id, role="responsible"))
        await db.flush()

        recipients = await card_approval.build_approval_broken_recipients(
            db, cards=[card], actor_id=editor.id, actor_display_name="Editor"
        )
        assert len(recipients) == 1
        assert recipients[0]["link"] == f"/cards/{card.id}"
        assert recipients[0]["card_id"] == card.id
        assert "email_items" not in recipients[0]

    async def test_two_roles_on_one_card_is_still_one_person(self, db, env):
        """``create_notifications_for_subscribers`` sends two rows here."""
        editor, owner = env["editor"], env["owner"]
        card = await create_card(db, name="Solo", approval_status="BROKEN")
        db.add(Stakeholder(card_id=card.id, user_id=owner.id, role="responsible"))
        db.add(Stakeholder(card_id=card.id, user_id=owner.id, role="observer"))
        await db.flush()

        recipients = await card_approval.build_approval_broken_recipients(
            db, cards=[card], actor_id=editor.id, actor_display_name="Editor"
        )
        assert len(recipients) == 1

    async def test_the_editor_is_never_a_recipient(self, db, env):
        editor = env["editor"]
        card = await create_card(db, name="Solo", approval_status="BROKEN")
        db.add(Stakeholder(card_id=card.id, user_id=editor.id, role="responsible"))
        await db.flush()

        recipients = await card_approval.build_approval_broken_recipients(
            db, cards=[card], actor_id=editor.id, actor_display_name="Editor"
        )
        assert recipients == []

    async def test_nothing_broken_means_no_query_and_no_recipients(self, db, env):
        assert (
            await card_approval.build_approval_broken_recipients(
                db, cards=[], actor_id=None, actor_display_name="Editor"
            )
            == []
        )

    async def test_a_long_list_is_capped_but_the_count_stays_exact(self, db, env):
        editor, owner = env["editor"], env["owner"]
        total = card_approval._MAX_LISTED_CARDS + 5
        cards = [
            await create_card(db, name=f"App {i:03d}", approval_status="BROKEN")
            for i in range(total)
        ]
        for c in cards:
            db.add(Stakeholder(card_id=c.id, user_id=owner.id, role="responsible"))
        await db.flush()

        entry = (
            await card_approval.build_approval_broken_recipients(
                db, cards=cards, actor_id=editor.id, actor_display_name="Editor"
            )
        )[0]
        assert entry["data"]["card_count"] == total
        assert len(entry["data"]["card_ids"]) == card_approval._MAX_LISTED_CARDS
        assert len(entry["email_items"]) == card_approval._MAX_LISTED_CARDS


class TestRollbackRestoresApproval:
    """Recording the break is what makes it undoable.

    ``rollback_service`` builds its inverse ops straight from
    ``event.data.changes`` — ``{field: old}`` — so an approval the events never
    mentioned could not be restored. Now that the flip is on the record, undoing
    a batch puts the card back to APPROVED along with everything else.
    """

    async def test_plan_includes_the_approval_status(self, db, env):
        from app.models.event import Event
        from app.models.mutation_batch import MutationBatch
        from app.services.rollback_service import plan_rollback

        editor = env["editor"]
        card = await create_card(db, name="App", approval_status="BROKEN")
        batch = MutationBatch(tool_name="update_cards_bulk", actor_user_id=editor.id, dry_run=False)
        db.add(batch)
        await db.flush()
        db.add(
            Event(
                event_type="card.updated",
                card_id=card.id,
                user_id=editor.id,
                batch_id=batch.id,
                data={
                    "id": str(card.id),
                    "changes": {
                        "description": {"old": "Before", "new": "After"},
                        "approval_status": card_approval.approval_change_entry(),
                    },
                },
            )
        )
        await db.flush()

        plan = await plan_rollback(db, batch)
        assert plan["unsupported_events"] == []
        fields = plan["operations"][0]["fields"]
        assert fields["approval_status"] == "APPROVED"
