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

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
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


async def _create_draft_survey(client, admin, *, fields=None, target_roles=None):
    """Helper to create a draft survey via the API."""
    resp = await client.post(
        "/api/v1/surveys",
        json={
            "name": "Workflow Test Survey",
            "description": "Testing the full survey workflow",
            "message": "Please review and update your application data.",
            "target_type_key": "Application",
            "target_roles": target_roles if target_roles is not None else ["responsible"],
            "fields": fields if fields is not None else SURVEY_FIELDS,
        },
        headers=auth_headers(admin),
    )
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
