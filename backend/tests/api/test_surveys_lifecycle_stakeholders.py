"""Survey lifecycle-date and stakeholder-role fields, survey provenance on the
events an apply writes, and deleting a survey of any status (#1257).

Covers:
- field-row validation on create / PATCH (phase, role, kind);
- the response form's current values and the card link flag;
- submit refusing a lifecycle answer that is not a date;
- apply merging lifecycle phases through ``update_card`` and applying a
  role answer as a diff against what the respondent saw, every event carrying
  the survey it came from;
- a malformed, unknown-person or unauthorised stakeholder answer refused whole;
- one refused response rolling back alone, inside one audit batch — whatever
  raised, and with the subscriber nudges delivered only after the commit;
- rolling the apply batch back from the audit log;
- ``DELETE /surveys/{id}`` and ``GET /surveys/{id}/delete-impact``.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.surveys import UNEXPECTED_APPLY_ERROR
from app.models.audit_log import AuditLogEntry
from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.notification import Notification
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.services import notification_service, survey_apply
from app.services.rollback_service import execute_rollback
from tests.api.test_surveys_extended import _create_draft_survey, survey_env  # noqa: F401
from tests.conftest import (
    auth_headers,
    create_card,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

LIFECYCLE_FIELDS = [
    {
        "key": "lifecycle:endOfLife",
        "label": "End of Life",
        "type": "date",
        "kind": "lifecycle",
        "phase": "endOfLife",
        "action": "maintain",
    },
    {
        "key": "lifecycle:plan",
        "label": "Plan",
        "type": "date",
        "kind": "lifecycle",
        "phase": "plan",
        "action": "maintain",
    },
]

OBSERVER_FIELD = {
    "key": "sh:observer",
    "label": "Observer",
    "type": "stakeholder",
    "kind": "stakeholder",
    "role": "observer",
    "action": "maintain",
}


@pytest.fixture
async def env(db, survey_env):  # noqa: F811
    """``survey_env`` plus an observer role, observers and a lifecycle."""
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", label="Observer"
    )
    card = survey_env["card"]
    card.lifecycle = {"plan": "2024-01-01", "active": "2024-06-01"}
    leaving = await create_user(db, email="leaving@test.com", display_name="Leaving Observer")
    joining = await create_user(db, email="joining@test.com", display_name="Joining Observer")
    retired = await create_user(db, email="retired@test.com", display_name="Retired Observer")
    retired.is_active = False
    db.add(Stakeholder(card_id=card.id, user_id=leaving.id, role="observer"))
    db.add(Stakeholder(card_id=card.id, user_id=retired.id, role="observer"))
    await db.flush()
    return {**survey_env, "leaving": leaving, "joining": joining, "retired": retired}


async def _send(client, admin, fields):
    survey = await _create_draft_survey(client, admin, fields=fields)
    resp = await client.post(f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    return survey["id"]


async def _answer(client, member, survey_id, card_id, responses):
    resp = await client.post(
        f"/api/v1/surveys/{survey_id}/respond/{card_id}",
        json={"responses": responses},
        headers=auth_headers(member),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["response_id"]


async def _apply(client, admin, survey_id, response_ids):
    resp = await client.post(
        f"/api/v1/surveys/{survey_id}/apply",
        json={"response_ids": response_ids},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Field-row validation
# ---------------------------------------------------------------------------


class TestFieldValidation:
    async def test_lifecycle_and_stakeholder_rows_are_accepted(self, client, env):
        survey = await _create_draft_survey(
            client, env["admin"], fields=[*LIFECYCLE_FIELDS, OBSERVER_FIELD]
        )
        assert [f["key"] for f in survey["fields"]] == [
            "lifecycle:endOfLife",
            "lifecycle:plan",
            "sh:observer",
        ]

    @pytest.mark.parametrize(
        "row, message",
        [
            ({"key": "lifecycle:x", "kind": "lifecycle", "phase": "sunset"}, "phase"),
            ({"key": "sh:ghost", "kind": "stakeholder", "role": "ghost"}, "role"),
            ({"key": "sh:", "kind": "stakeholder", "role": ""}, "role"),
            ({"key": "tags", "kind": "tag"}, "kind"),
        ],
    )
    async def test_unknown_phase_role_or_kind_is_refused(self, client, env, row, message):
        resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Bad",
                "target_type_key": "Application",
                "fields": [{**row, "action": "maintain"}],
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400
        assert message in resp.json()["detail"]

    async def test_patch_validates_fields_too(self, client, env):
        survey = await _create_draft_survey(client, env["admin"])
        resp = await client.patch(
            f"/api/v1/surveys/{survey['id']}",
            json={"fields": [{"key": "sh:ghost", "kind": "stakeholder", "role": "ghost"}]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400
        ok = await client.patch(
            f"/api/v1/surveys/{survey['id']}",
            json={"fields": [OBSERVER_FIELD]},
            headers=auth_headers(env["admin"]),
        )
        assert ok.status_code == 200
        assert ok.json()["fields"][0]["role"] == "observer"

    async def test_a_name_only_patch_skips_field_validation(self, client, env):
        survey = await _create_draft_survey(client, env["admin"])
        resp = await client.patch(
            f"/api/v1/surveys/{survey['id']}",
            json={"name": "Renamed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed"


# ---------------------------------------------------------------------------
# Response form + submit
# ---------------------------------------------------------------------------


class TestResponseForm:
    async def test_current_values_for_lifecycle_and_stakeholder_fields(self, client, env):
        sid = await _send(client, env["admin"], [*LIFECYCLE_FIELDS, OBSERVER_FIELD])
        resp = await client.get(
            f"/api/v1/surveys/{sid}/respond/{env['card'].id}",
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        by_key = {f["key"]: f for f in body["fields"]}
        assert by_key["lifecycle:plan"]["current_value"] == "2024-01-01"
        assert by_key["lifecycle:endOfLife"]["current_value"] is None
        # The inactive holder is not offered for editing.
        assert by_key["sh:observer"]["current_value"] == [
            {"id": str(env["leaving"].id), "display_name": "Leaving Observer"}
        ]
        assert by_key["sh:observer"]["label"] == "Observer"
        assert body["card"]["can_view"] is True
        # Every phase the card holds, so the form can warn about ordering
        # against a phase the survey did not ask about.
        assert body["card"]["lifecycle"] == {"plan": "2024-01-01", "active": "2024-06-01"}

    async def test_can_view_is_false_without_a_read_grant(self, client, db, env):
        await create_role(
            db, key="respondent", label="Respondent", permissions={"surveys.respond": True}
        )
        outsider = await create_user(db, email="outsider@test.com", role="respondent")
        # The targeted "responsible" role definition carries no card.view grant,
        # and the app role has no inventory.view.
        db.add(Stakeholder(card_id=env["card"].id, user_id=outsider.id, role="responsible"))
        await db.flush()
        sid = await _send(client, env["admin"], [OBSERVER_FIELD])
        resp = await client.get(
            f"/api/v1/surveys/{sid}/respond/{env['card'].id}",
            headers=auth_headers(outsider),
        )
        assert resp.status_code == 200
        assert resp.json()["card"]["can_view"] is False

    async def test_submit_refuses_a_lifecycle_answer_that_is_not_a_date(self, client, env):
        sid = await _send(client, env["admin"], LIFECYCLE_FIELDS)
        resp = await client.post(
            f"/api/v1/surveys/{sid}/respond/{env['card'].id}",
            json={"responses": {"lifecycle:endOfLife": {"new_value": "next year"}}},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 422
        assert "Not a date" in resp.json()["detail"]

    async def test_submit_normalises_a_timestamp_and_snapshots_current(self, client, db, env):
        sid = await _send(client, env["admin"], [*LIFECYCLE_FIELDS, OBSERVER_FIELD])
        rid = await _answer(
            client,
            env["member"],
            sid,
            env["card"].id,
            {
                "lifecycle:endOfLife": {"new_value": "2030-12-31T00:00:00"},
                "sh:observer": {"new_value": [{"id": str(env["joining"].id)}]},
            },
        )
        row = await db.get(SurveyResponse, uuid.UUID(rid))
        await db.refresh(row)
        assert row.responses["lifecycle:endOfLife"]["new_value"] == "2030-12-31"
        assert row.responses["lifecycle:plan"]["current_value"] == "2024-01-01"
        assert row.responses["sh:observer"]["current_value"][0]["id"] == str(env["leaving"].id)

    # ---------------------------------------------------------------------------
    # Apply
    # ---------------------------------------------------------------------------

    @pytest.mark.parametrize(
        "answer",
        ["alice", {"id": "x"}, ["not-a-uuid"], [{"name": "no id"}], [None]],
    )
    async def test_submit_refuses_a_people_answer_that_is_not_a_list_of_refs(
        self, client, env, answer
    ):
        sid = await _send(client, env["admin"], [OBSERVER_FIELD])
        resp = await client.post(
            f"/api/v1/surveys/{sid}/respond/{env['card'].id}",
            json={"responses": {"sh:observer": {"new_value": answer}}},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 422, resp.text

    async def test_submit_refuses_a_relation_answer_that_is_not_a_list(self, client, env):
        field = {
            "key": "rel:relAppToApp:outgoing",
            "label": "Depends on",
            "type": "relation",
            "kind": "relation",
            "relation_type_key": "relAppToApp",
            "direction": "outgoing",
            "action": "maintain",
        }
        sid = await _send(client, env["admin"], [field])
        resp = await client.post(
            f"/api/v1/surveys/{sid}/respond/{env['card'].id}",
            json={"responses": {field["key"]: {"new_value": "ERP"}}},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 422, resp.text
        # An empty list and no answer are both fine.
        for value in ([], None):
            resp = await client.post(
                f"/api/v1/surveys/{sid}/respond/{env['card'].id}",
                json={"responses": {field["key"]: {"new_value": value}}},
                headers=auth_headers(env["member"]),
            )
            assert resp.status_code == 200, resp.text


async def _survey_events(db, card_id) -> list[Event]:
    rows = await db.execute(
        select(Event)
        .where(Event.card_id == card_id, Event.event_type != "survey.sent")
        .order_by(Event.created_at)
    )
    return list(rows.scalars().all())


class TestApply:
    async def test_lifecycle_answers_merge_and_clear_through_update_card(self, client, db, env):
        card, member = env["card"], env["member"]
        sid = await _send(client, env["admin"], LIFECYCLE_FIELDS)
        rid = await _answer(
            client,
            member,
            sid,
            card.id,
            {
                "lifecycle:endOfLife": {"new_value": "2030-12-31"},
                "lifecycle:plan": {"new_value": ""},
            },
        )
        result = await _apply(client, env["admin"], sid, [rid])
        assert result == {"applied": 1, "errors": []}

        await db.refresh(card)
        # `active` was not in the survey and survives; `plan` was cleared.
        assert card.lifecycle == {"active": "2024-06-01", "endOfLife": "2030-12-31"}

        (ev,) = [e for e in await _survey_events(db, card.id) if e.event_type == "card.updated"]
        assert ev.data["changes"]["lifecycle"] == {
            "old": {"plan": "2024-01-01", "active": "2024-06-01"},
            "new": {"active": "2024-06-01", "endOfLife": "2030-12-31"},
        }
        assert ev.user_id == env["admin"].id
        assert ev.data["source"] == "survey_response"
        assert ev.data["survey_id"] == sid
        assert ev.data["survey_name"] == "Workflow Test Survey"
        assert ev.data["response_id"] == rid
        assert ev.data["respondent_id"] == str(member.id)
        assert ev.data["respondent_name"] == member.display_name

    async def test_a_confirmed_lifecycle_answer_writes_nothing(self, client, db, env):
        card = env["card"]
        sid = await _send(client, env["admin"], LIFECYCLE_FIELDS)
        rid = await _answer(
            client,
            env["member"],
            sid,
            card.id,
            {"lifecycle:plan": {"new_value": "2020-01-01", "confirmed": True}},
        )
        before = set((await db.execute(select(MutationBatch.id))).scalars().all())
        assert (await _apply(client, env["admin"], sid, [rid]))["applied"] == 1
        await db.refresh(card)
        assert card.lifecycle == {"plan": "2024-01-01", "active": "2024-06-01"}
        assert await _survey_events(db, card.id) == []
        # Nothing was written, so no empty audit batch was left behind.
        after = set((await db.execute(select(MutationBatch.id))).scalars().all())
        assert after == before

    async def test_stakeholder_answer_is_applied_as_a_diff(self, client, db, env):
        card = env["card"]
        sid = await _send(client, env["admin"], [OBSERVER_FIELD])
        rid = await _answer(
            client,
            env["member"],
            sid,
            card.id,
            {
                "sh:observer": {
                    "new_value": [
                        {"id": str(env["joining"].id), "display_name": "Joining Observer"},
                        # A deactivated person is skipped, never added.
                        {"id": str(env["retired"].id)},
                    ]
                }
            },
        )
        # Someone else joined between the answer and the apply; the answer
        # never saw them and must not remove them.
        later = await create_user(db, email="later@test.com", display_name="Later Observer")
        db.add(Stakeholder(card_id=card.id, user_id=later.id, role="observer"))
        await db.flush()
        assert (await _apply(client, env["admin"], sid, [rid]))["applied"] == 1

        holders = (
            (
                await db.execute(
                    select(Stakeholder.user_id).where(
                        Stakeholder.card_id == card.id, Stakeholder.role == "observer"
                    )
                )
            )
            .scalars()
            .all()
        )
        # Joining added, leaving removed, the deactivated and the late holders
        # left alone.
        assert set(holders) == {env["joining"].id, env["retired"].id, later.id}

        events = {e.event_type: e for e in await _survey_events(db, card.id)}
        added, removed = events["stakeholder.added"], events["stakeholder.removed"]
        assert added.data["user_id"] == str(env["joining"].id)
        assert removed.data["user_id"] == str(env["leaving"].id)
        for ev in (added, removed):
            assert ev.user_id == env["admin"].id
            assert ev.data["survey_name"] == "Workflow Test Survey"
            assert ev.data["respondent_id"] == str(env["member"].id)
            assert ev.data["role"] == "observer"
            assert ev.data["role_label"] == "Observer"

    async def test_two_respondents_answers_to_one_role_compose(self, client, db, env):
        card = env["card"]
        other = await create_user(db, email="other@test.com", role="member", display_name="Other")
        db.add(Stakeholder(card_id=card.id, user_id=other.id, role="responsible"))
        await db.flush()
        sid = await _send(client, env["admin"], [OBSERVER_FIELD])
        # Both saw [leaving]; one adds joining, the other adds themselves and
        # drops leaving. Applied together, both edits land.
        first = await _answer(
            client,
            env["member"],
            sid,
            card.id,
            {
                "sh:observer": {
                    "new_value": [{"id": str(env["leaving"].id)}, {"id": str(env["joining"].id)}]
                }
            },
        )
        second = await _answer(
            client, other, sid, card.id, {"sh:observer": {"new_value": [{"id": str(other.id)}]}}
        )
        result = await _apply(client, env["admin"], sid, [first, second])
        assert result == {"applied": 2, "errors": []}
        holders = (
            await db.execute(
                select(Stakeholder.user_id).where(
                    Stakeholder.card_id == card.id, Stakeholder.role == "observer"
                )
            )
        ).scalars()
        assert set(holders) == {env["joining"].id, other.id, env["retired"].id}

    async def test_an_unknown_person_refuses_the_response_and_keeps_the_role(self, client, db, env):
        card = env["card"]
        sid = await _send(client, env["admin"], [OBSERVER_FIELD])
        rid = await _answer(
            client,
            env["member"],
            sid,
            card.id,
            {"sh:observer": {"new_value": [{"id": str(uuid.uuid4()), "display_name": "Ghost"}]}},
        )
        card_id, leaving_id = card.id, env["leaving"].id
        result = await _apply(client, env["admin"], sid, [rid])
        assert result["applied"] == 0
        assert "match no user" in result["errors"][0]["error"]
        holders = (
            await db.execute(
                select(Stakeholder.user_id).where(
                    Stakeholder.card_id == card_id, Stakeholder.role == "observer"
                )
            )
        ).scalars()
        # The one active holder is still there: the answer was not read as "nobody".
        assert leaving_id in set(holders)
        assert await _survey_events(db, card_id) == []

    async def test_a_stakeholder_answer_needs_stakeholders_manage(self, client, db, env):
        """``surveys.manage`` applies attributes; a role assignment needs the
        stakeholder authority the Stakeholders tab asks for."""
        await create_role(
            db,
            key="survey_admin",
            label="Survey admin",
            permissions={"surveys.manage": True, "inventory.view": True, "inventory.edit": True},
        )
        applier = await create_user(db, email="applier@test.com", role="survey_admin")
        card = env["card"]
        second = await create_card(
            db, card_type="Application", name="Second App", attributes={"riskLevel": "low"}
        )
        db.add(Stakeholder(card_id=second.id, user_id=env["member"].id, role="responsible"))
        await db.flush()
        fields = [
            {"key": "riskLevel", "label": "Risk", "type": "single_select", "action": "maintain"},
            OBSERVER_FIELD,
        ]
        sid = await _send(client, env["admin"], fields)
        roles = await _answer(
            client,
            env["member"],
            sid,
            card.id,
            {"sh:observer": {"new_value": [{"id": str(env["joining"].id)}]}},
        )
        attrs = await _answer(
            client, env["member"], sid, second.id, {"riskLevel": {"new_value": "high"}}
        )
        card_id, second_id, joining_id = card.id, second.id, env["joining"].id

        result = await _apply(client, applier, sid, [roles, attrs])
        assert result["applied"] == 1
        assert [e["response_id"] for e in result["errors"]] == [roles]
        assert "stakeholders.manage" in result["errors"][0]["error"]
        joined = await db.execute(
            select(Stakeholder).where(
                Stakeholder.card_id == card_id, Stakeholder.user_id == joining_id
            )
        )
        assert joined.scalar_one_or_none() is None
        second_card = await db.get(Card, second_id)
        await db.refresh(second_card)
        assert second_card.attributes["riskLevel"] == "high"

        # A card-level grant on this very card is enough: the applier is made
        # a stakeholder in a role that carries ``card.manage_stakeholders``.
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="steward",
            label="Steward",
            permissions={"card.manage_stakeholders": True},
        )
        db.add(Stakeholder(card_id=card_id, user_id=applier.id, role="steward"))
        await db.flush()
        result = await _apply(client, applier, sid, [roles])
        assert result == {"applied": 1, "errors": []}

    async def test_an_unchanged_stakeholder_answer_writes_nothing(self, client, db, env):
        sid = await _send(client, env["admin"], [OBSERVER_FIELD])
        rid = await _answer(
            client,
            env["member"],
            sid,
            env["card"].id,
            {"sh:observer": {"new_value": [{"id": str(env["leaving"].id)}]}},
        )
        assert (await _apply(client, env["admin"], sid, [rid]))["applied"] == 1
        assert await _survey_events(db, env["card"].id) == []

    async def test_relation_events_carry_the_survey_too(self, client, db, env):
        from tests.conftest import create_card_type, create_relation_type

        await create_card_type(db, key="Interface", label="Interface")
        await create_relation_type(
            db,
            key="relAppToInterface",
            label="provides",
            source_type_key="Application",
            target_type_key="Interface",
        )
        iface = await create_card(db, card_type="Interface", name="Orders API")
        field = {
            "key": "rel:relAppToInterface:outgoing",
            "label": "provides",
            "type": "relation",
            "kind": "relation",
            "relation_type_key": "relAppToInterface",
            "direction": "outgoing",
            "related_type_key": "Interface",
            "action": "maintain",
        }
        sid = await _send(client, env["admin"], [field])
        rid = await _answer(
            client,
            env["member"],
            sid,
            env["card"].id,
            {field["key"]: {"new_value": [{"id": str(iface.id), "name": "Orders API"}]}},
        )
        assert (await _apply(client, env["admin"], sid, [rid]))["applied"] == 1
        (ev,) = await _survey_events(db, env["card"].id)
        assert ev.event_type == "relation.created"
        assert ev.data["survey_id"] == sid
        assert ev.data["survey_name"] == "Workflow Test Survey"

    async def test_a_refused_response_rolls_back_alone(self, client, db, env):
        admin, member = env["admin"], env["member"]
        second = await create_card(
            db,
            card_type="Application",
            name="Second App",
            attributes={"costTotalAnnual": 1, "riskLevel": "low"},
        )
        db.add(Stakeholder(card_id=second.id, user_id=member.id, role="responsible"))
        await db.flush()
        fields = [
            {"key": "riskLevel", "label": "Risk", "type": "single_select", "action": "maintain"},
            OBSERVER_FIELD,
        ]
        sid = await _send(client, admin, fields)
        bad = await _answer(
            client,
            member,
            sid,
            env["card"].id,
            {
                "riskLevel": {"new_value": "bogus"},
                "sh:observer": {"new_value": [{"id": str(env["joining"].id)}]},
            },
        )
        good = await _answer(client, member, sid, second.id, {"riskLevel": {"new_value": "high"}})

        # The savepoint rollback expires the refused card in this shared test
        # session, so read the ids before applying.
        card_id, joining_id = env["card"].id, env["joining"].id
        result = await _apply(client, admin, sid, [bad, good])
        assert result["applied"] == 1
        assert [e["response_id"] for e in result["errors"]] == [bad]
        assert "bogus" in result["errors"][0]["error"]

        # The refused response wrote nothing — not even its stakeholder answer,
        # which ran before the attribute the card refused.
        assert await _survey_events(db, card_id) == []
        joined = await db.execute(
            select(Stakeholder).where(
                Stakeholder.card_id == card_id, Stakeholder.user_id == joining_id
            )
        )
        assert joined.scalar_one_or_none() is None
        bad_row = await db.get(SurveyResponse, uuid.UUID(bad))
        await db.refresh(bad_row)
        assert bad_row.applied is False

        # The accepted one landed, in an audit batch that exists.
        second_card = await db.get(Card, second.id)
        await db.refresh(second_card)
        assert second_card.attributes["riskLevel"] == "high"
        (ev,) = await _survey_events(db, second.id)
        assert ev.batch_id is not None
        assert await db.get(MutationBatch, ev.batch_id) is not None

    async def test_rolling_back_the_apply_batch_restores_the_card(self, client, db, env):
        card = env["card"]
        sid = await _send(
            client,
            env["admin"],
            [
                {"key": "costTotalAnnual", "label": "Cost", "type": "cost", "action": "maintain"},
                *LIFECYCLE_FIELDS,
                OBSERVER_FIELD,
            ],
        )
        rid = await _answer(
            client,
            env["member"],
            sid,
            card.id,
            {
                "costTotalAnnual": {"new_value": 99},
                "lifecycle:endOfLife": {"new_value": "2031-01-01"},
                "sh:observer": {"new_value": [{"id": str(env["joining"].id)}]},
            },
        )
        assert (await _apply(client, env["admin"], sid, [rid]))["applied"] == 1
        events = await _survey_events(db, card.id)
        (batch_id,) = {e.batch_id for e in events}
        batch = await db.get(MutationBatch, batch_id)

        result = await execute_rollback(db, batch, env["admin"].id)
        assert all(r["status"] == "ok" for r in result["results"]), result["results"]

        await db.refresh(card)
        assert card.attributes["costTotalAnnual"] == 50000
        assert card.lifecycle == {"plan": "2024-01-01", "active": "2024-06-01"}
        holders = (
            (
                await db.execute(
                    select(Stakeholder.user_id).where(
                        Stakeholder.card_id == card.id, Stakeholder.role == "observer"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert set(holders) == {env["leaving"].id, env["retired"].id}


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


class TestApplyFailures:
    async def test_an_unexpected_error_is_reported_and_the_others_land(
        self, client, db, env, monkeypatch
    ):
        """Only two exception types are raised on purpose; anything else inside
        a response's savepoint is still a refused response, not a lost request."""
        admin, member = env["admin"], env["member"]
        second = await create_card(
            db, card_type="Application", name="Second App", attributes={"riskLevel": "low"}
        )
        db.add(Stakeholder(card_id=second.id, user_id=member.id, role="responsible"))
        await db.flush()
        sid = await _send(client, admin, [OBSERVER_FIELD])
        first = await _answer(
            client,
            member,
            sid,
            env["card"].id,
            {"sh:observer": {"new_value": [{"id": str(env["joining"].id)}]}},
        )
        other = await _answer(
            client,
            member,
            sid,
            second.id,
            {"sh:observer": {"new_value": [{"id": str(env["joining"].id)}]}},
        )

        real = survey_apply.apply_stakeholder_change

        async def flaky(db_, card, *args, **kwargs):
            if card.name == "Survey Test App":
                raise RuntimeError("connection dropped")
            return await real(db_, card, *args, **kwargs)

        monkeypatch.setattr(survey_apply, "apply_stakeholder_change", flaky)
        second_id = second.id
        result = await _apply(client, admin, sid, [first, other])
        assert result["applied"] == 1
        assert result["errors"] == [{"response_id": first, "error": UNEXPECTED_APPLY_ERROR}]
        # The exception text is logged, never sent to the client.
        assert "connection dropped" not in str(result)
        assert "RuntimeError" not in str(result)
        (ev,) = await _survey_events(db, second_id)
        assert ev.event_type == "stakeholder.added"

    def test_error_text_prefers_a_dict_details_message(self):
        from app.api.v1.surveys import _apply_error_text

        assert _apply_error_text(HTTPException(400, "plain")) == "plain"
        assert (
            _apply_error_text(
                HTTPException(409, {"code": "duplicate_name", "message": "Name already used"})
            )
            == "Name already used"
        )
        assert _apply_error_text(HTTPException(409, {"code": "x"})) == "{'code': 'x'}"
        assert _apply_error_text(survey_apply.SurveyFieldError("bad")) == "bad"
        assert _apply_error_text(RuntimeError("boom")) == UNEXPECTED_APPLY_ERROR
        assert _apply_error_text(KeyError()) == UNEXPECTED_APPLY_ERROR

    def test_error_text_never_carries_an_unexpected_exceptions_details(self):
        from app.api.v1.surveys import _apply_error_text

        leaky = RuntimeError('duplicate key value violates unique constraint "cards_pkey"')
        text = _apply_error_text(leaky)
        assert text == UNEXPECTED_APPLY_ERROR
        assert "cards_pkey" not in text and "RuntimeError" not in text

    async def test_subscriber_nudges_are_delivered_after_the_commit(
        self, client, db, env, monkeypatch
    ):
        """The apply emails nobody inline: ``card_updated`` and the
        approval-broken nudge go to the background batch, once per type, and
        a refused response notifies nobody at all."""
        admin, member = env["admin"], env["member"]
        card = env["card"]
        card.approval_status = "APPROVED"
        watcher = await create_user(db, email="watcher@test.com", display_name="Watcher")
        db.add(Stakeholder(card_id=card.id, user_id=watcher.id, role="observer"))
        second = await create_card(
            db, card_type="Application", name="Second App", attributes={"riskLevel": "low"}
        )
        db.add(Stakeholder(card_id=second.id, user_id=member.id, role="responsible"))
        db.add(Stakeholder(card_id=second.id, user_id=watcher.id, role="responsible"))
        await db.flush()

        calls: list[tuple[str, list[dict]]] = []

        async def fake_deliver(recipients, *, notif_type, actor_id=None):
            calls.append((notif_type, recipients))

        monkeypatch.setattr(notification_service, "deliver_notification_batch", fake_deliver)

        fields = [
            {"key": "riskLevel", "label": "Risk", "type": "single_select", "action": "maintain"}
        ]
        sid = await _send(client, admin, fields)
        calls.clear()  # the send's own survey_request batch
        good = await _answer(client, member, sid, card.id, {"riskLevel": {"new_value": "high"}})
        bad = await _answer(client, member, sid, second.id, {"riskLevel": {"new_value": "bogus"}})
        card_id = card.id
        # Every stakeholder of the applied card (the fixture's two observers
        # included), the actor excluded; nobody from the refused card.
        subscribers = {member.id, watcher.id, env["leaving"].id, env["retired"].id}

        result = await _apply(client, admin, sid, [good, bad])
        assert result["applied"] == 1 and len(result["errors"]) == 1

        by_type = {t: r for t, r in calls}
        assert set(by_type) == {"card_updated", "approval_status_changed"}
        updated = by_type["card_updated"]
        assert {r["user_id"] for r in updated} == subscribers
        assert len(updated) == len(subscribers)
        assert all(r["card_id"] == card_id for r in updated)
        assert {r["user_id"] for r in by_type["approval_status_changed"]} == subscribers
        # Nothing was written inline on the request's session.
        inline = await db.execute(
            select(Notification).where(
                Notification.type.in_(["card_updated", "approval_status_changed"])
            )
        )
        assert inline.scalars().all() == []


class TestDelete:
    async def _active_survey_with_answers(self, client, db, env):
        sid = await _send(client, env["admin"], LIFECYCLE_FIELDS)
        rid = await _answer(
            client,
            env["member"],
            sid,
            env["card"].id,
            {"lifecycle:endOfLife": {"new_value": "2030-01-01"}},
        )
        await _apply(client, env["admin"], sid, [rid])
        # A second, still-pending request on another card.
        other = await create_card(db, card_type="Application", name="Pending App")
        db.add(SurveyResponse(survey_id=uuid.UUID(sid), card_id=other.id, user_id=env["member"].id))
        db.add(
            Notification(
                user_id=env["member"].id,
                type="survey_request",
                title="Survey: Workflow Test Survey",
                data={"survey_id": sid},
            )
        )
        db.add(
            Notification(
                user_id=env["member"].id,
                type="survey_request",
                title="Another survey",
                data={"survey_id": str(uuid.uuid4())},
            )
        )
        await db.flush()
        return sid

    async def test_delete_impact_counts(self, client, db, env):
        sid = await self._active_survey_with_answers(client, db, env)
        resp = await client.get(
            f"/api/v1/surveys/{sid}/delete-impact", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert resp.json() == {
            "status": "active",
            "requests": 2,
            "pending": 1,
            "answered": 1,
            "applied": 1,
        }

    async def test_an_active_survey_is_deleted_with_its_requests(self, client, db, env):
        sid = await self._active_survey_with_answers(client, db, env)
        resp = await client.delete(f"/api/v1/surveys/{sid}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 204

        assert await db.get(Survey, uuid.UUID(sid)) is None
        left = await db.execute(
            select(SurveyResponse).where(SurveyResponse.survey_id == uuid.UUID(sid))
        )
        assert left.scalars().all() == []
        titles = (
            (
                await db.execute(
                    select(Notification.title).where(Notification.type == "survey_request")
                )
            )
            .scalars()
            .all()
        )
        assert titles == ["Another survey"]

        # The card keeps the change and the history that names the survey.
        await db.refresh(env["card"])
        assert env["card"].lifecycle["endOfLife"] == "2030-01-01"
        kinds = {e.event_type for e in await _survey_events(db, env["card"].id)}
        assert "card.updated" in kinds
        sent = await db.execute(
            select(Event).where(Event.card_id == env["card"].id, Event.event_type == "survey.sent")
        )
        assert sent.scalars().one().data["survey_name"] == "Workflow Test Survey"

        (entry,) = (
            (
                await db.execute(
                    select(AuditLogEntry).where(AuditLogEntry.action == "admin.survey.deleted")
                )
            )
            .scalars()
            .all()
        )
        assert entry.details["context"]["status"] == "active"
        assert entry.details["context"]["requests"] == 2
        assert entry.details["context"]["applied"] == 1

    async def test_a_closed_survey_can_be_deleted(self, client, db, env):
        sid = await _send(client, env["admin"], LIFECYCLE_FIELDS)
        await client.post(f"/api/v1/surveys/{sid}/close", headers=auth_headers(env["admin"]))
        resp = await client.delete(f"/api/v1/surveys/{sid}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 204
        assert await db.get(Survey, uuid.UUID(sid)) is None

    async def test_delete_and_impact_need_surveys_manage(self, client, env):
        survey = await _create_draft_survey(client, env["admin"])
        for method, path in (
            ("delete", f"/api/v1/surveys/{survey['id']}"),
            ("get", f"/api/v1/surveys/{survey['id']}/delete-impact"),
        ):
            resp = await getattr(client, method)(path, headers=auth_headers(env["viewer"]))
            assert resp.status_code == 403

    async def test_unknown_survey_is_404(self, client, env):
        missing = uuid.uuid4()
        for method, path in (
            ("delete", f"/api/v1/surveys/{missing}"),
            ("get", f"/api/v1/surveys/{missing}/delete-impact"),
        ):
            resp = await getattr(client, method)(path, headers=auth_headers(env["admin"]))
            assert resp.status_code == 404
