"""Integration tests for the survey workflow endpoints.

Covers the full survey lifecycle beyond basic CRUD:
- POST /surveys/{id}/send (activate and resolve targets)
- GET /surveys/my (list user's pending surveys)
- GET /surveys/{id}/respond/{card_id} (get response form)
- POST /surveys/{id}/respond/{card_id} (submit response)
- POST /surveys/{id}/close (close active survey)
- GET /surveys/{id}/responses (list all responses)
- POST /surveys/{id}/apply (apply responses to cards)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.event import Event
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------


SURVEY_FIELDS = [
    {
        "key": "costTotalAnnual",
        "label": "Annual Cost",
        "type": "cost",
        "action": "maintain",
    },
    {
        "key": "riskLevel",
        "label": "Risk Level",
        "type": "single_select",
        "action": "confirm",
        "options": [
            {"key": "low", "label": "Low"},
            {"key": "medium", "label": "Medium"},
            {"key": "high", "label": "High"},
        ],
    },
]


@pytest.fixture
async def survey_env(db):
    """Full environment for survey workflow tests.

    Creates:
    - admin, member, viewer roles
    - Application card type with fields
    - 'responsible' stakeholder role definition
    - admin user, member user, viewer user
    - An Application card with member assigned as 'responsible' stakeholder
    - A draft survey targeting Application cards with 'responsible' role
    """
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)

    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "low", "label": "Low"},
                            {"key": "medium", "label": "Medium"},
                            {"key": "high", "label": "High"},
                        ],
                    },
                ],
            }
        ],
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="responsible", label="Responsible"
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    card = await create_card(
        db,
        card_type="Application",
        name="Survey Test App",
        user_id=admin.id,
        attributes={"costTotalAnnual": 50000, "riskLevel": "medium"},
    )

    # Assign member as 'responsible' stakeholder on the card
    stakeholder = Stakeholder(card_id=card.id, user_id=member.id, role="responsible")
    db.add(stakeholder)
    await db.flush()

    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "card": card,
        "stakeholder": stakeholder,
    }


async def _create_draft_survey(
    client, admin, *, fields=None, target_roles=None, target_filters=None
):
    """Helper to create a draft survey via the API."""
    body = {
        "name": "Workflow Test Survey",
        "description": "Testing the full survey workflow",
        "message": "Please review and update your application data.",
        "target_type_key": "Application",
        "target_roles": target_roles if target_roles is not None else ["responsible"],
        "fields": fields if fields is not None else SURVEY_FIELDS,
    }
    if target_filters is not None:
        body["target_filters"] = target_filters
    resp = await client.post("/api/v1/surveys", json=body, headers=auth_headers(admin))
    assert resp.status_code == 201
    return resp.json()


# ---------------------------------------------------------------------------
# POST /surveys/{id}/send
# ---------------------------------------------------------------------------


class TestSendSurvey:
    async def test_send_survey_success(self, client, db, survey_env):
        """Sending a draft survey activates it and creates response records."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["status"] == "active"
        assert data["sent_at"] is not None
        assert data["targets_created"] >= 1
        assert data["total_responses"] >= 1

    async def test_send_survey_already_sent(self, client, db, survey_env):
        """Sending a survey that is already active returns 400."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send it once
        resp1 = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 200

        # Try to send again
        resp2 = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 400

    async def test_send_survey_no_fields(self, client, db, survey_env):
        """Sending a survey with no fields returns 400."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin, fields=[])
        survey_id = survey["id"]

        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "field" in resp.json()["detail"].lower()

    async def test_send_survey_no_target_roles(self, client, db, survey_env):
        """Sending a survey with no target roles returns 400."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin, target_roles=[])
        survey_id = survey["id"]

        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "role" in resp.json()["detail"].lower()

    async def test_send_survey_viewer_forbidden(self, client, db, survey_env):
        """Viewer cannot send surveys (requires surveys.manage)."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /surveys/my
# ---------------------------------------------------------------------------


class TestMySurveys:
    async def test_member_sees_pending_survey(self, client, db, survey_env):
        """After a survey is sent, the targeted member sees it in /surveys/my."""
        admin = survey_env["admin"]
        member = survey_env["member"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Member checks their surveys
        resp = await client.get(
            "/api/v1/surveys/my",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1

        # Find our survey in the list
        found = [s for s in data if s["survey_id"] == survey_id]
        assert len(found) == 1
        assert found[0]["survey_name"] == "Workflow Test Survey"
        assert found[0]["pending_count"] >= 1
        assert len(found[0]["items"]) >= 1

        item = found[0]["items"][0]
        assert item["card_id"] == str(survey_env["card"].id)
        assert item["card_name"] == "Survey Test App"

    async def test_closed_survey_not_shown_as_pending(self, client, db, survey_env):
        """A closed survey drops off /surveys/my and the badge count (issue #746)."""
        admin = survey_env["admin"]
        member = survey_env["member"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey so the member has a pending response.
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Sanity: the member sees it while the survey is active.
        resp = await client.get("/api/v1/surveys/my", headers=auth_headers(member))
        assert resp.status_code == 200
        assert any(s["survey_id"] == survey_id for s in resp.json())

        badge = await client.get("/api/v1/notifications/badge-counts", headers=auth_headers(member))
        assert badge.status_code == 200
        assert badge.json()["pending_surveys"] >= 1

        # Admin closes the survey without the member ever responding.
        close_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/close",
            headers=auth_headers(admin),
        )
        assert close_resp.status_code == 200

        # The closed survey must no longer appear in the member's Todos.
        resp = await client.get("/api/v1/surveys/my", headers=auth_headers(member))
        assert resp.status_code == 200
        assert not any(s["survey_id"] == survey_id for s in resp.json())

        # ...and the badge count drops back to zero.
        badge = await client.get("/api/v1/notifications/badge-counts", headers=auth_headers(member))
        assert badge.status_code == 200
        assert badge.json()["pending_surveys"] == 0

    async def test_non_targeted_user_sees_no_surveys(self, client, db, survey_env):
        """A user who is not a stakeholder on any matching card sees nothing."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Viewer checks their surveys (viewer is not a stakeholder on the card)
        resp = await client.get(
            "/api/v1/surveys/my",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Viewer should have no pending surveys for this survey
        found = [s for s in data if s["survey_id"] == survey_id]
        assert len(found) == 0


# ---------------------------------------------------------------------------
# GET /surveys/{id}/respond/{card_id}
# ---------------------------------------------------------------------------


class TestGetResponseForm:
    async def test_get_response_form(self, client, db, survey_env):
        """Targeted user can retrieve the response form with current field values."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Member gets the response form
        resp = await client.get(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["response_status"] == "pending"
        assert data["survey"]["id"] == survey_id
        assert data["survey"]["name"] == "Workflow Test Survey"
        assert data["card"]["id"] == str(card.id)
        assert data["card"]["name"] == "Survey Test App"
        assert data["card"]["type"] == "Application"

        # Fields should include current values from card attributes
        assert len(data["fields"]) == 2
        field_keys = {f["key"] for f in data["fields"]}
        assert "costTotalAnnual" in field_keys
        assert "riskLevel" in field_keys

        cost_field = next(f for f in data["fields"] if f["key"] == "costTotalAnnual")
        assert cost_field["current_value"] == 50000

        risk_field = next(f for f in data["fields"] if f["key"] == "riskLevel")
        assert risk_field["current_value"] == "medium"

    async def test_response_form_enriches_custom_field_config_and_help(
        self, client, db, survey_env
    ):
        """A contributed custom-typed field's config + help are pulled from the
        live metamodel into the response form, even though the survey snapshot
        omits them — so the respond UI can render the same rating widget +
        guidance as the card detail."""
        from sqlalchemy.orm.attributes import flag_modified

        from app.models.card_type import CardType

        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        # Add a custom-typed field carrying config + help to the Application type.
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.fields_schema[0]["fields"].append(
            {
                "key": "autonomyRating",
                "label": "Autonomy Rating",
                "type": "ext.demo.rating",
                "config": {"min": 1, "max": 5},
                "help": "Score 1 (worst) to 5 (best).",
                "helpTranslations": {"de": "Bewerten Sie 1 bis 5."},
                "weight": 1,
            }
        )
        flag_modified(ct, "fields_schema")
        await db.flush()

        # The survey snapshot deliberately omits config/help (the builder never
        # captures them) — the response form must enrich from the metamodel.
        fields = [
            {
                "key": "autonomyRating",
                "label": "Autonomy Rating",
                "type": "ext.demo.rating",
                "action": "maintain",
            }
        ]
        survey = await _create_draft_survey(client, admin, fields=fields)
        send_resp = await client.post(
            f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin)
        )
        assert send_resp.status_code == 200

        resp = await client.get(
            f"/api/v1/surveys/{survey['id']}/respond/{card.id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        field = next(f for f in resp.json()["fields"] if f["key"] == "autonomyRating")
        assert field["config"] == {"min": 1, "max": 5}
        assert field["help"] == "Score 1 (worst) to 5 (best)."
        assert field["helpTranslations"] == {"de": "Bewerten Sie 1 bis 5."}

    async def test_get_response_form_not_found_for_wrong_user(self, client, db, survey_env):
        """A user who is not targeted cannot access the response form."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Viewer tries to get the response form (not targeted)
        resp = await client.get(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /surveys/{id}/respond/{card_id}
# ---------------------------------------------------------------------------


class TestSubmitResponse:
    async def test_submit_response_success(self, client, db, survey_env):
        """Targeted user can submit a survey response."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Member submits a response
        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {
                        "new_value": 75000,
                        "confirmed": False,
                    },
                    "riskLevel": {
                        "new_value": None,
                        "confirmed": True,
                    },
                }
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert "response_id" in data

    async def test_submit_response_not_targeted(self, client, db, survey_env):
        """A user who was not targeted cannot submit a response."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Viewer tries to submit (not targeted)
        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {"new_value": 99999, "confirmed": False},
                }
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 404

    async def test_submit_response_survey_closed(self, client, db, survey_env):
        """Submitting a response to a closed survey returns 400."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Close the survey
        close_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/close",
            headers=auth_headers(admin),
        )
        assert close_resp.status_code == 200

        # Member tries to submit after close
        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {"new_value": 75000, "confirmed": False},
                }
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /surveys/{id}/close
# ---------------------------------------------------------------------------


class TestCloseSurvey:
    async def test_close_active_survey(self, client, db, survey_env):
        """Admin can close an active survey."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Close the survey
        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/close",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "closed"
        assert data["closed_at"] is not None

    async def test_close_draft_survey_returns_400(self, client, db, survey_env):
        """Closing a draft survey (not yet sent) returns 400."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/close",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_close_survey_viewer_forbidden(self, client, db, survey_env):
        """Viewer cannot close surveys."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey first
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/close",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /surveys/{id}/responses
# ---------------------------------------------------------------------------


class TestListResponses:
    async def test_list_responses_after_submission(self, client, db, survey_env):
        """Admin can list responses that include the submitted one."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Member submits a response
        submit_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {"new_value": 75000, "confirmed": False},
                    "riskLevel": {"new_value": None, "confirmed": True},
                }
            },
            headers=auth_headers(member),
        )
        assert submit_resp.status_code == 200

        # Admin lists all responses
        resp = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1

        completed = [r for r in data if r["status"] == "completed"]
        assert len(completed) >= 1

        response = completed[0]
        assert response["card_id"] == str(card.id)
        assert response["card_name"] == "Survey Test App"
        assert response["user_id"] == str(member.id)
        assert response["applied"] is False
        assert response["responded_at"] is not None

        # Verify response data
        responses_data = response["responses"]
        assert "costTotalAnnual" in responses_data
        assert responses_data["costTotalAnnual"]["new_value"] == 75000
        assert responses_data["costTotalAnnual"]["confirmed"] is False
        assert "riskLevel" in responses_data
        assert responses_data["riskLevel"]["confirmed"] is True

    async def test_list_responses_filter_by_status(self, client, db, survey_env):
        """Admin can filter responses by status."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey (creates pending responses)
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # List only pending responses
        resp = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            params={"status": "pending"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all(r["status"] == "pending" for r in data)

        # List only completed responses (should be empty)
        resp2 = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            params={"status": "completed"},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert len(resp2.json()) == 0

    async def test_list_responses_viewer_forbidden(self, client, db, survey_env):
        """Viewer cannot list survey responses (requires surveys.manage)."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        resp = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /surveys/{id}/apply
# ---------------------------------------------------------------------------


class TestApplyResponses:
    async def test_apply_responses_to_cards(self, client, db, survey_env):
        """Admin applies completed responses, updating card attributes."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Member submits a response with a proposed cost change
        submit_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {"new_value": 75000, "confirmed": False},
                    "riskLevel": {"new_value": None, "confirmed": True},
                }
            },
            headers=auth_headers(member),
        )
        assert submit_resp.status_code == 200
        response_id = submit_resp.json()["response_id"]

        # Admin applies the response
        apply_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [response_id]},
            headers=auth_headers(admin),
        )
        assert apply_resp.status_code == 200
        apply_data = apply_resp.json()
        assert apply_data["applied"] == 1
        assert apply_data["errors"] == []

        # Verify the card attributes were updated
        card_resp = await client.get(
            f"/api/v1/cards/{card.id}",
            headers=auth_headers(admin),
        )
        assert card_resp.status_code == 200
        card_data = card_resp.json()
        assert card_data["attributes"]["costTotalAnnual"] == 75000

        # Verify the response is now marked as applied
        responses_resp = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            headers=auth_headers(admin),
        )
        assert responses_resp.status_code == 200
        applied = [r for r in responses_resp.json() if r["id"] == response_id]
        assert len(applied) == 1
        assert applied[0]["applied"] is True
        assert applied[0]["applied_at"] is not None

        # Audit trail: applying a survey response must emit a card.updated
        # event so the card's History tab shows what changed and who triggered
        # it. Previously this path updated the card silently.
        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == card.id,
                        Event.event_type == "card.updated",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1, "expected exactly one card.updated event"
        ev = events[0]
        assert ev.user_id == admin.id
        assert ev.data["source"] == "survey_response"
        assert ev.data["survey_id"] == survey_id
        assert ev.data["response_id"] == response_id
        assert "attr_costTotalAnnual" in ev.data["changes"]
        assert ev.data["changes"]["attr_costTotalAnnual"]["new"] == 75000

    async def test_apply_already_applied_returns_error(self, client, db, survey_env):
        """Applying an already-applied response returns an error in the errors list."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Member submits a response
        submit_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {"new_value": 75000, "confirmed": False},
                }
            },
            headers=auth_headers(member),
        )
        assert submit_resp.status_code == 200
        response_id = submit_resp.json()["response_id"]

        # Apply once
        apply_resp1 = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [response_id]},
            headers=auth_headers(admin),
        )
        assert apply_resp1.status_code == 200
        assert apply_resp1.json()["applied"] == 1

        # Apply again
        apply_resp2 = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [response_id]},
            headers=auth_headers(admin),
        )
        assert apply_resp2.status_code == 200
        assert apply_resp2.json()["applied"] == 0
        assert len(apply_resp2.json()["errors"]) == 1
        assert "already applied" in apply_resp2.json()["errors"][0]["error"].lower()

    async def test_apply_pending_response_returns_error(self, client, db, survey_env):
        """Applying a pending (not yet submitted) response returns an error."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        # Send the survey (creates pending response records)
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200

        # Get the pending response ID
        responses_resp = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            headers=auth_headers(admin),
        )
        assert responses_resp.status_code == 200
        data = responses_resp.json()
        assert len(data) >= 1
        pending_id = data[0]["id"]
        assert data[0]["status"] == "pending"

        # Try to apply the pending response
        apply_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [pending_id]},
            headers=auth_headers(admin),
        )
        assert apply_resp.status_code == 200
        assert apply_resp.json()["applied"] == 0
        assert len(apply_resp.json()["errors"]) == 1
        assert "not completed" in apply_resp.json()["errors"][0]["error"].lower()

    async def test_apply_nonexistent_response_returns_error(self, client, db, survey_env):
        """Applying a non-existent response ID returns an error."""
        admin = survey_env["admin"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        fake_response_id = str(uuid.uuid4())
        apply_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [fake_response_id]},
            headers=auth_headers(admin),
        )
        assert apply_resp.status_code == 200
        assert apply_resp.json()["applied"] == 0
        assert len(apply_resp.json()["errors"]) == 1
        assert "not found" in apply_resp.json()["errors"][0]["error"].lower()

    async def test_apply_viewer_forbidden(self, client, db, survey_env):
        """Viewer cannot apply survey responses (requires surveys.manage)."""
        admin = survey_env["admin"]
        viewer = survey_env["viewer"]

        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]

        fake_response_id = str(uuid.uuid4())
        resp = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [fake_response_id]},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Full workflow integration test
# ---------------------------------------------------------------------------


class TestFullSurveyWorkflow:
    async def test_end_to_end_workflow(self, client, db, survey_env):
        """Full lifecycle: create -> send -> respond -> list responses -> apply -> close."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        # 1. Create draft survey
        survey = await _create_draft_survey(client, admin)
        survey_id = survey["id"]
        assert survey["status"] == "draft"

        # 2. Send survey
        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200
        assert send_resp.json()["status"] == "active"
        assert send_resp.json()["targets_created"] >= 1

        # 3. Member sees it in "my surveys"
        my_resp = await client.get(
            "/api/v1/surveys/my",
            headers=auth_headers(member),
        )
        assert my_resp.status_code == 200
        my_surveys = my_resp.json()
        assert any(s["survey_id"] == survey_id for s in my_surveys)

        # 4. Member gets the response form
        form_resp = await client.get(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            headers=auth_headers(member),
        )
        assert form_resp.status_code == 200
        assert form_resp.json()["response_status"] == "pending"

        # 5. Member submits a response
        submit_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            json={
                "responses": {
                    "costTotalAnnual": {"new_value": 120000, "confirmed": False},
                    "riskLevel": {"new_value": "high", "confirmed": False},
                }
            },
            headers=auth_headers(member),
        )
        assert submit_resp.status_code == 200
        response_id = submit_resp.json()["response_id"]

        # 6. Member no longer sees it as pending in "my surveys"
        my_resp2 = await client.get(
            "/api/v1/surveys/my",
            headers=auth_headers(member),
        )
        assert my_resp2.status_code == 200
        # The response is now completed so it should not appear as pending
        found = [s for s in my_resp2.json() if s["survey_id"] == survey_id]
        assert len(found) == 0

        # 7. Admin lists responses and sees the completed one
        responses_resp = await client.get(
            f"/api/v1/surveys/{survey_id}/responses",
            headers=auth_headers(admin),
        )
        assert responses_resp.status_code == 200
        responses = responses_resp.json()
        completed = [r for r in responses if r["status"] == "completed"]
        assert len(completed) == 1
        assert completed[0]["responses"]["costTotalAnnual"]["new_value"] == 120000
        assert completed[0]["responses"]["riskLevel"]["new_value"] == "high"

        # 8. Admin applies the response
        apply_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/apply",
            json={"response_ids": [response_id]},
            headers=auth_headers(admin),
        )
        assert apply_resp.status_code == 200
        assert apply_resp.json()["applied"] == 1
        assert apply_resp.json()["errors"] == []

        # 9. Verify card data was updated
        card_resp = await client.get(
            f"/api/v1/cards/{card.id}",
            headers=auth_headers(admin),
        )
        assert card_resp.status_code == 200
        attrs = card_resp.json()["attributes"]
        assert attrs["costTotalAnnual"] == 120000
        assert attrs["riskLevel"] == "high"

        # 10. Admin closes the survey
        close_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/close",
            headers=auth_headers(admin),
        )
        assert close_resp.status_code == 200
        assert close_resp.json()["status"] == "closed"
        assert close_resp.json()["closed_at"] is not None

        # 11. Verify survey stats reflect the completed workflow
        survey_resp = await client.get(
            f"/api/v1/surveys/{survey_id}",
            headers=auth_headers(admin),
        )
        assert survey_resp.status_code == 200
        stats = survey_resp.json()
        assert stats["total_responses"] >= 1
        assert stats["completed_responses"] >= 1
        assert stats["applied_responses"] >= 1


# ---------------------------------------------------------------------------
# target_filters.card_ids — direct single-card targeting
# ---------------------------------------------------------------------------


class TestCardIdsFilter:
    async def test_card_ids_targets_single_card(self, client, db, survey_env):
        """A survey with target_filters.card_ids resolves to that exact card."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        # Second Application without the right stakeholder — should be excluded
        await create_card(
            db,
            card_type="Application",
            name="Other App",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000, "riskLevel": "low"},
        )

        survey = await _create_draft_survey(
            client,
            admin,
            target_filters={"card_ids": [str(card.id)]},
        )
        survey_id = survey["id"]

        send_resp = await client.post(
            f"/api/v1/surveys/{survey_id}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200, send_resp.json()
        body = send_resp.json()
        assert body["status"] == "active"
        assert body["targets_created"] == 1
        assert body["total_responses"] == 1

        # Member can fetch the response form for that card
        form = await client.get(
            f"/api/v1/surveys/{survey_id}/respond/{card.id}",
            headers=auth_headers(member),
        )
        assert form.status_code == 200

    async def test_card_ids_excludes_other_cards(self, client, db, survey_env):
        """Cards not listed in card_ids are not surveyed even if of the right type."""
        admin = survey_env["admin"]
        member = survey_env["member"]

        # Create a second Application with the same stakeholder role assigned
        other = await create_card(
            db,
            card_type="Application",
            name="Other App With Stakeholder",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000, "riskLevel": "low"},
        )
        db.add(Stakeholder(card_id=other.id, user_id=member.id, role="responsible"))
        await db.flush()

        # Target only the first card
        survey = await _create_draft_survey(
            client,
            admin,
            target_filters={"card_ids": [str(survey_env["card"].id)]},
        )
        send_resp = await client.post(
            f"/api/v1/surveys/{survey['id']}/send",
            headers=auth_headers(admin),
        )
        assert send_resp.status_code == 200
        assert send_resp.json()["targets_created"] == 1

    async def test_respond_form_includes_metamodel_translations(self, client, db, survey_env):
        """The respond form enriches each field with translations from the live metamodel."""
        admin = survey_env["admin"]
        member = survey_env["member"]
        card = survey_env["card"]

        survey = await _create_draft_survey(
            client,
            admin,
            target_filters={"card_ids": [str(card.id)]},
        )
        await client.post(
            f"/api/v1/surveys/{survey['id']}/send",
            headers=auth_headers(admin),
        )

        form = await client.get(
            f"/api/v1/surveys/{survey['id']}/respond/{card.id}",
            headers=auth_headers(member),
        )
        assert form.status_code == 200
        data = form.json()

        # The card payload exposes metamodel translation maps (may be None when no
        # metamodel translations are defined on the test fixture, but the keys must exist)
        assert "type_translations" in data["card"]
        assert "subtype_translations" in data["card"]
        # Each field carries at least its key + current_value so the response form
        # can render it; translation maps are added when the live metamodel has any
        assert all("key" in f and "current_value" in f for f in data["fields"])


# ---------------------------------------------------------------------------
# Relation survey fields — maintain/confirm relationships, not just attributes
# ---------------------------------------------------------------------------


REL_FIELD = {
    "key": "rel:relAppToITC:outgoing",
    "section": "",
    "label": "Uses",
    "type": "relation",
    "kind": "relation",
    "relation_type_key": "relAppToITC",
    "direction": "outgoing",
    "related_type_key": "ITComponent",
    "action": "maintain",
}


@pytest.fixture
async def relation_survey_env(db, survey_env):
    """Augment survey_env with an ITComponent type, an Application→ITComponent
    relation type, two peer components, and an existing link from the card."""
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db,
        key="relAppToITC",
        label="Uses",
        reverse_label="Used by",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    card = survey_env["card"]
    itc_current = await create_card(db, card_type="ITComponent", name="Current Component")
    itc_new = await create_card(db, card_type="ITComponent", name="New Component")
    # Card already links to the current component.
    await create_relation(db, type_key="relAppToITC", source_id=card.id, target_id=itc_current.id)
    return {**survey_env, "itc_current": itc_current, "itc_new": itc_new}


class TestRelationSurveyFields:
    async def test_response_form_lists_current_related_cards(self, client, db, relation_survey_env):
        """The response form returns the card's currently-linked peers as the
        relation field's current_value."""
        admin = relation_survey_env["admin"]
        member = relation_survey_env["member"]
        card = relation_survey_env["card"]
        itc_current = relation_survey_env["itc_current"]

        survey = await _create_draft_survey(
            client, admin, fields=[REL_FIELD], target_filters={"card_ids": [str(card.id)]}
        )
        await client.post(f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin))

        form = await client.get(
            f"/api/v1/surveys/{survey['id']}/respond/{card.id}",
            headers=auth_headers(member),
        )
        assert form.status_code == 200
        rel_field = form.json()["fields"][0]
        assert rel_field["kind"] == "relation"
        assert rel_field["current_value"] == [
            {"id": str(itc_current.id), "name": "Current Component"}
        ]

    async def test_apply_syncs_relations(self, client, db, relation_survey_env):
        """Applying a relation response adds the proposed links and removes the
        ones the respondent dropped."""
        admin = relation_survey_env["admin"]
        member = relation_survey_env["member"]
        card = relation_survey_env["card"]
        itc_current = relation_survey_env["itc_current"]
        itc_new = relation_survey_env["itc_new"]

        survey = await _create_draft_survey(
            client, admin, fields=[REL_FIELD], target_filters={"card_ids": [str(card.id)]}
        )
        await client.post(f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin))

        # Respondent replaces the current component with the new one.
        submit = await client.post(
            f"/api/v1/surveys/{survey['id']}/respond/{card.id}",
            json={
                "responses": {
                    REL_FIELD["key"]: {
                        "new_value": [{"id": str(itc_new.id), "name": "New Component"}],
                        "confirmed": False,
                    }
                }
            },
            headers=auth_headers(member),
        )
        assert submit.status_code == 200
        response_id = submit.json()["response_id"]

        apply = await client.post(
            f"/api/v1/surveys/{survey['id']}/apply",
            json={"response_ids": [response_id]},
            headers=auth_headers(admin),
        )
        assert apply.status_code == 200, apply.json()
        assert apply.json()["applied"] == 1

        rels = (
            (
                await db.execute(
                    select(Relation).where(
                        Relation.type == "relAppToITC", Relation.source_id == card.id
                    )
                )
            )
            .scalars()
            .all()
        )
        targets = {r.target_id for r in rels}
        assert itc_new.id in targets
        assert itc_current.id not in targets

    async def test_apply_confirmed_relation_leaves_links_untouched(
        self, client, db, relation_survey_env
    ):
        """A confirmed relation field (no change proposed) must not alter links."""
        admin = relation_survey_env["admin"]
        member = relation_survey_env["member"]
        card = relation_survey_env["card"]
        itc_current = relation_survey_env["itc_current"]

        survey = await _create_draft_survey(
            client, admin, fields=[REL_FIELD], target_filters={"card_ids": [str(card.id)]}
        )
        await client.post(f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin))

        submit = await client.post(
            f"/api/v1/surveys/{survey['id']}/respond/{card.id}",
            json={"responses": {REL_FIELD["key"]: {"new_value": None, "confirmed": True}}},
            headers=auth_headers(member),
        )
        assert submit.status_code == 200
        response_id = submit.json()["response_id"]

        apply = await client.post(
            f"/api/v1/surveys/{survey['id']}/apply",
            json={"response_ids": [response_id]},
            headers=auth_headers(admin),
        )
        assert apply.status_code == 200
        assert apply.json()["applied"] == 1

        rels = (
            (
                await db.execute(
                    select(Relation).where(
                        Relation.type == "relAppToITC", Relation.source_id == card.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.target_id for r in rels} == {itc_current.id}


# ---------------------------------------------------------------------------
# target_filters.not_updated_for — staleness window
# ---------------------------------------------------------------------------


async def _age_card(db, card, days: int):
    """Back-date a card's ``updated_at``.

    Assigning the attribute explicitly suppresses the ``onupdate`` default, so
    the flush writes the value we asked for rather than "now".
    """
    card.updated_at = datetime.now(timezone.utc) - timedelta(days=days)
    db.add(card)
    await db.flush()


async def _preview(client, admin, survey_id):
    resp = await client.post(f"/api/v1/surveys/{survey_id}/preview", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.json()
    return resp.json()


class TestNotUpdatedForFilter:
    """The survey builder's "only cards nobody has touched" scope.

    Asserted through ``/preview`` rather than ``/send`` so the tests don't fan
    out notifications for what is purely a targeting question.
    """

    async def _app_with_owner(self, db, admin, member, name, *, age_days):
        card = await create_card(
            db,
            card_type="Application",
            name=name,
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000, "riskLevel": "low"},
        )
        db.add(Stakeholder(card_id=card.id, user_id=member.id, role="responsible"))
        await db.flush()
        # Age last: the stakeholder insert above rescores data quality, which
        # writes the card row and would otherwise refresh updated_at.
        await _age_card(db, card, age_days)
        return card

    async def test_excludes_recently_touched_cards(self, client, db, survey_env):
        admin, member = survey_env["admin"], survey_env["member"]
        await _age_card(db, survey_env["card"], 400)
        await self._app_with_owner(db, admin, member, "Ancient App", age_days=200)
        await self._app_with_owner(db, admin, member, "Fresh App", age_days=5)

        survey = await _create_draft_survey(
            client, admin, target_filters={"not_updated_for": {"value": 90, "unit": "days"}}
        )
        body = await _preview(client, admin, survey["id"])

        assert {t["card_name"] for t in body["targets"]} == {"Survey Test App", "Ancient App"}
        assert body["total_cards"] == 2

    async def test_day_boundary(self, client, db, survey_env):
        """Pins `<` against the cutoff: 91 days out matches a 90-day window,
        89 does not."""
        admin, member = survey_env["admin"], survey_env["member"]
        await _age_card(db, survey_env["card"], 91)
        await self._app_with_owner(db, admin, member, "Just Inside", age_days=89)

        survey = await _create_draft_survey(
            client, admin, target_filters={"not_updated_for": {"value": 90, "unit": "days"}}
        )
        body = await _preview(client, admin, survey["id"])

        assert {t["card_name"] for t in body["targets"]} == {"Survey Test App"}

    async def test_months_are_calendar_months(self, client, db, survey_env):
        admin, member = survey_env["admin"], survey_env["member"]
        await _age_card(db, survey_env["card"], 200)
        await self._app_with_owner(db, admin, member, "Hundred Days", age_days=100)

        survey = await _create_draft_survey(
            client, admin, target_filters={"not_updated_for": {"value": 6, "unit": "months"}}
        )
        body = await _preview(client, admin, survey["id"])

        assert {t["card_name"] for t in body["targets"]} == {"Survey Test App"}

    async def test_absent_key_targets_everything(self, client, db, survey_env):
        admin, member = survey_env["admin"], survey_env["member"]
        await self._app_with_owner(db, admin, member, "Fresh App", age_days=0)

        survey = await _create_draft_survey(client, admin, target_filters={})
        body = await _preview(client, admin, survey["id"])

        assert body["total_cards"] == 2

    async def test_composes_with_another_filter(self, client, db, survey_env):
        """Filters AND together — the staleness window narrows the card_ids
        selection rather than replacing it."""
        admin, member = survey_env["admin"], survey_env["member"]
        await _age_card(db, survey_env["card"], 200)
        old_other = await self._app_with_owner(db, admin, member, "Other Old App", age_days=200)

        survey = await _create_draft_survey(
            client,
            admin,
            target_filters={
                "card_ids": [str(old_other.id)],
                "not_updated_for": {"value": 90, "unit": "days"},
            },
        )
        body = await _preview(client, admin, survey["id"])

        assert {t["card_name"] for t in body["targets"]} == {"Other Old App"}

    @pytest.mark.parametrize(
        "window",
        [
            "yesterday",
            None,
            [],
            {},
            {"value": 6},
            {"unit": "months"},
            {"value": 0, "unit": "days"},
            {"value": -5, "unit": "days"},
            {"value": True, "unit": "days"},
            {"value": "90", "unit": "days"},
            {"value": 90, "unit": "weeks"},
            {"value": 10**9, "unit": "days"},
            {"value": 10**9, "unit": "months"},
        ],
    )
    async def test_malformed_window_is_ignored_not_fatal(self, client, db, survey_env, window):
        """A window that cannot be read drops the clause. It must never 500 the
        preview, and must never silently resolve to nobody."""
        admin = survey_env["admin"]
        await _age_card(db, survey_env["card"], 5)

        survey = await _create_draft_survey(
            client, admin, target_filters={"not_updated_for": window}
        )
        body = await _preview(client, admin, survey["id"])

        assert body["total_cards"] == 1

    async def test_cutoff_is_a_day_boundary_not_the_clock(self, client, db, survey_env):
        """A card touched earlier on the cutoff day is inside the window. Before
        the boundary fix this depended on the time of day the preview ran."""
        admin = survey_env["admin"]
        # 30 days back to the minute — same calendar day as the cutoff, so the
        # card counts as touched within the window and must not be targeted.
        await _age_card(db, survey_env["card"], 30)

        survey = await _create_draft_survey(
            client, admin, target_filters={"not_updated_for": {"value": 30, "unit": "days"}}
        )
        body = await _preview(client, admin, survey["id"])

        assert body["total_cards"] == 0

    async def test_window_round_trips_through_the_api(self, client, db, survey_env):
        admin = survey_env["admin"]
        window = {"value": 45, "unit": "days"}
        survey = await _create_draft_survey(
            client, admin, target_filters={"not_updated_for": window}
        )

        resp = await client.get(f"/api/v1/surveys/{survey['id']}", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert resp.json()["target_filters"]["not_updated_for"] == window


# ---------------------------------------------------------------------------
# POST /surveys/{id}/preview — payload shape
# ---------------------------------------------------------------------------


class TestPreviewPayload:
    """What the Preview & send step renders.

    The role a user holds reaches the UI as a key that the builder resolves to a
    label, and the two counters answer different questions: `total_users` is a
    headcount, `total_requests` is how many response records `send` will create.
    """

    async def _app_with_roles(self, db, admin, user, name, roles):
        card = await create_card(
            db,
            card_type="Application",
            name=name,
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000, "riskLevel": "low"},
        )
        for role in roles:
            db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
        await db.flush()
        return card

    async def test_user_with_two_roles_on_one_card_appears_once(self, client, db, survey_env):
        """One entry per user — SurveyResponse is unique on (survey, card, user),
        so a second entry would break the send — but carrying both roles."""
        admin, member = survey_env["admin"], survey_env["member"]
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )
        # survey_env's card already has member as 'responsible'; add a second role.
        db.add(Stakeholder(card_id=survey_env["card"].id, user_id=member.id, role="observer"))
        await db.flush()

        survey = await _create_draft_survey(client, admin, target_roles=["responsible", "observer"])
        body = await _preview(client, admin, survey["id"])

        assert body["total_cards"] == 1
        users = body["targets"][0]["users"]
        assert len(users) == 1
        assert users[0]["roles"] == ["observer", "responsible"]  # sorted, not query order
        assert body["total_users"] == 1
        assert body["total_requests"] == 1

    async def test_untargeted_roles_are_excluded(self, client, db, survey_env):
        admin, member = survey_env["admin"], survey_env["member"]
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )
        db.add(Stakeholder(card_id=survey_env["card"].id, user_id=member.id, role="observer"))
        await db.flush()

        survey = await _create_draft_survey(client, admin, target_roles=["responsible"])
        body = await _preview(client, admin, survey["id"])

        assert body["targets"][0]["users"][0]["roles"] == ["responsible"]

    async def test_one_person_on_two_cards_is_one_user_two_requests(self, client, db, survey_env):
        """The reported bug: total_users summed the per-card lists, so a single
        person stakeholding several cards was reported as several users."""
        admin, member = survey_env["admin"], survey_env["member"]
        await self._app_with_roles(db, admin, member, "Second App", ["responsible"])

        survey = await _create_draft_survey(client, admin)
        body = await _preview(client, admin, survey["id"])

        assert body["total_cards"] == 2
        assert body["total_users"] == 1
        assert body["total_requests"] == 2

    async def test_distinct_people_are_counted_separately(self, client, db, survey_env):
        admin, member, viewer = survey_env["admin"], survey_env["member"], survey_env["viewer"]
        await self._app_with_roles(db, admin, viewer, "Viewer App", ["responsible"])

        survey = await _create_draft_survey(client, admin)
        body = await _preview(client, admin, survey["id"])

        assert body["total_users"] == 2
        assert body["total_requests"] == 2
        assert member.id != viewer.id

    async def test_total_requests_matches_what_send_creates(self, client, db, survey_env):
        admin, member = survey_env["admin"], survey_env["member"]
        await self._app_with_roles(db, admin, member, "Second App", ["responsible"])

        survey = await _create_draft_survey(client, admin)
        body = await _preview(client, admin, survey["id"])

        send = await client.post(
            f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin)
        )
        assert send.status_code == 200, send.json()
        assert send.json()["targets_created"] == body["total_requests"]


# ---------------------------------------------------------------------------
# POST /surveys/{id}/preview — cards the filters matched but nobody can answer
# ---------------------------------------------------------------------------


class TestSkippedCards:
    """A card is only reachable through someone holding a target role on it.

    Cards that match every filter but have no such stakeholder used to vanish
    from the preview with no explanation, so a landscape with thin ownership
    read as a filter that was too narrow.
    """

    async def _app(self, db, admin, name, *, owner=None, role="responsible"):
        card = await create_card(
            db,
            card_type="Application",
            name=name,
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000, "riskLevel": "low"},
        )
        if owner is not None:
            db.add(Stakeholder(card_id=card.id, user_id=owner.id, role=role))
        await db.flush()
        return card

    async def test_reports_matched_alongside_targeted_and_names_the_rest(
        self, client, db, survey_env
    ):
        admin, member = survey_env["admin"], survey_env["member"]
        await self._app(db, admin, "Ownerless One")
        await self._app(db, admin, "Ownerless Two")

        survey = await _create_draft_survey(client, admin)
        body = await _preview(client, admin, survey["id"])

        # survey_env's own card has the stakeholder; the two new ones do not.
        assert body["total_matched"] == 3
        assert body["total_cards"] == 1
        assert member.id  # the one targeted card is reachable through member

    async def test_a_stakeholder_in_another_role_still_counts_as_skipped(
        self, client, db, survey_env
    ):
        admin, viewer = survey_env["admin"], survey_env["viewer"]
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )
        await self._app(db, admin, "Watched Only", owner=viewer, role="observer")

        survey = await _create_draft_survey(client, admin, target_roles=["responsible"])
        body = await _preview(client, admin, survey["id"])

        assert body["total_matched"] == 2
        assert body["total_cards"] == 1
        assert body["total_matched"] - body["total_cards"] == 1

    async def test_nothing_skipped_when_every_card_has_a_recipient(self, client, db, survey_env):
        admin, member = survey_env["admin"], survey_env["member"]
        await self._app(db, admin, "Owned Too", owner=member)

        survey = await _create_draft_survey(client, admin)
        body = await _preview(client, admin, survey["id"])

        assert body["total_matched"] == body["total_cards"] == 2
        assert body["total_matched"] == body["total_cards"]

    async def test_send_is_unaffected(self, client, db, survey_env):
        """Skipped cards are reported, not surveyed — `send` behaves as before."""
        admin = survey_env["admin"]
        await self._app(db, admin, "Ownerless One")

        survey = await _create_draft_survey(client, admin)
        body = await _preview(client, admin, survey["id"])
        send = await client.post(
            f"/api/v1/surveys/{survey['id']}/send", headers=auth_headers(admin)
        )
        assert send.status_code == 200, send.json()
        assert send.json()["targets_created"] == body["total_requests"] == 1
