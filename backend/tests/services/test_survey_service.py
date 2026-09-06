"""The survey send path as a service (SDK 1.14 groundwork): targeting,
activation, the per-card ``survey.sent`` events, and the field expansion a
programmatic caller uses instead of hand-writing the builder's rows.

``POST /surveys/{id}/send`` and the extension surveys bridge both call
these — one writer, so the response rows and events are identical whichever
path sent the survey (``tests/api/test_surveys_extended.py`` covers the
route end to end)."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.services import survey_service
from tests.conftest import create_card, create_card_type, create_stakeholder_role_def, create_user

FIELDS_SCHEMA = [
    {
        "section": "General",
        "fields": [
            {"key": "costTotalAnnual", "label": "Annual Cost", "type": "cost"},
            {
                "key": "riskLevel",
                "label": "Risk Level",
                "type": "single_select",
                "options": [{"key": "low", "label": "Low"}, {"key": "high", "label": "High"}],
            },
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application", fields_schema=FIELDS_SCHEMA)
    await create_stakeholder_role_def(db, card_type_key="Application", key="responsible")
    owner = await create_user(db, email="owner@test.com", role="member")
    other = await create_user(db, email="other@test.com", role="member")
    a = await create_card(db, card_type="Application", name="A")
    b = await create_card(db, card_type="Application", name="B")
    orphan = await create_card(db, card_type="Application", name="Nobody")
    db.add_all(
        [
            Stakeholder(card_id=a.id, user_id=owner.id, role="responsible"),
            Stakeholder(card_id=b.id, user_id=owner.id, role="responsible"),
            Stakeholder(card_id=b.id, user_id=other.id, role="responsible"),
        ]
    )
    survey = Survey(
        name="Refresh",
        message="Please check",
        target_type_key="Application",
        target_filters={"card_ids": [str(a.id), str(b.id), str(orphan.id)]},
        target_roles=["responsible"],
        fields=[{"key": "costTotalAnnual", "action": "maintain"}],
    )
    db.add(survey)
    await db.flush()
    return {"a": a, "b": b, "orphan": orphan, "owner": owner, "other": other, "survey": survey}


class TestResolveAndActivate:
    async def test_targets_are_one_entry_per_card_and_user(self, db, env):
        targets, matched = await survey_service.resolve_targets(db, env["survey"])
        assert {c.id for c in matched} == {env["a"].id, env["b"].id, env["orphan"].id}
        assert {t["card_id"] for t in targets} == {str(env["a"].id), str(env["b"].id)}
        by_card = {t["card_id"]: t for t in targets}
        assert len(by_card[str(env["b"].id)]["users"]) == 2

    async def test_activation_writes_rows_recipients_and_events(self, db, env):
        survey = env["survey"]
        targets, _ = await survey_service.resolve_targets(db, survey)
        result = await survey_service.activate_survey(
            db, survey, targets, actor_id=None, event_extra={"ext": "rules"}
        )
        assert result.created == 3
        assert survey.status == "active" and survey.sent_at is not None
        rows = (
            (await db.execute(select(SurveyResponse).where(SurveyResponse.survey_id == survey.id)))
            .scalars()
            .all()
        )
        assert len(rows) == 3
        # One notification per person, not per card.
        assert {r["user_id"] for r in result.recipients} == {env["owner"].id, env["other"].id}
        owner_payload = next(r for r in result.recipients if r["user_id"] == env["owner"].id)
        assert owner_payload["link"] == "/todos?tab=surveys"
        assert len(owner_payload["email_items"]) == 2
        other_payload = next(r for r in result.recipients if r["user_id"] == env["other"].id)
        assert other_payload["link"] == f"/surveys/{survey.id}/respond/{env['b'].id}"
        # One survey.sent per surveyed card, carrying the survey id the
        # rollback planner dedupes on and the extension stamp.
        events = (
            (await db.execute(select(Event).where(Event.event_type == "survey.sent")))
            .scalars()
            .all()
        )
        assert {e.card_id for e in events} == {env["a"].id, env["b"].id}
        assert all(e.data["survey_id"] == str(survey.id) for e in events)
        assert all(e.data["ext"] == "rules" for e in events)
        assert events[0].data["card_count"] == 2 and events[0].data["user_count"] == 2


class TestExpandFields:
    async def test_expands_from_the_metamodel(self, db, env):
        rows = await survey_service.expand_fields(
            db,
            "Application",
            [{"key": "riskLevel", "action": "confirm"}, {"key": "costTotalAnnual"}],
        )
        assert rows[0] == {
            "key": "riskLevel",
            "section": "General",
            "label": "Risk Level",
            "type": "single_select",
            "options": [{"key": "low", "label": "Low"}, {"key": "high", "label": "High"}],
            "action": "confirm",
        }
        assert rows[1]["action"] == "maintain" and "options" not in rows[1]

    async def test_refuses_unknown_duplicate_and_bad_action(self, db, env):
        with pytest.raises(ValueError, match="does not exist"):
            await survey_service.expand_fields(db, "Application", [{"key": "nope"}])
        with pytest.raises(ValueError, match="twice"):
            await survey_service.expand_fields(
                db, "Application", [{"key": "riskLevel"}, {"key": "riskLevel"}]
            )
        with pytest.raises(ValueError, match="action"):
            await survey_service.expand_fields(
                db, "Application", [{"key": "riskLevel", "action": "delete"}]
            )
        with pytest.raises(ValueError, match="Unknown card type"):
            await survey_service.expand_fields(db, "Ghost", [{"key": "riskLevel"}])
