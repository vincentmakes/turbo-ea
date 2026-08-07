"""Integration tests for process-flow approval authority and withdrawal.

Two related things, both from `discussion #916
<https://github.com/vincentmakes/turbo-ea/discussions/916>`_:

**Approval authority.** ``approve`` / ``reject`` are gated on
``bpm.approve_flows`` / ``card.bpm_approve``, not on ``bpm.edit``. Before the
fix, every ``member`` could approve any flow — including a revision they had
submitted seconds earlier — which is how a flow gets approved by accident in
the first place. There was no test asserting a non-approver is refused, so
these are the regression tests that were missing.

**Withdrawal.** ``POST .../withdraw`` is gated on the ``bpm.withdraw_flows`` /
``card.bpm_withdraw`` permission alone — no seeded role holds it — takes a
mandatory reason, and is forward-only: it must never clear the original
approval, delete the version, or touch the extracted elements and their derived
relations. Crucially the *recording* of a withdrawal is unconditional: that, not
the ability to withdraw, is what GxP and ISO 9001 actually require, so no
instance setting may switch it off.
"""

from __future__ import annotations

import pytest

from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

SAMPLE_BPMN = "<bpmn>test</bpmn>"
GOOD_REASON = "Approved by mistake, wrong revision"


async def _set_separate_approver(db, *, enabled):
    """Set the opt-in segregation-of-duties switch in app_settings."""
    from sqlalchemy import select

    from app.models.app_settings import AppSettings

    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row is None:
        row = AppSettings(id="default", general_settings={})
        db.add(row)
    general = dict(row.general_settings or {})
    general["bpmRequireSeparateApprover"] = enabled
    row.general_settings = general
    await db.flush()


async def _add_stakeholder(db, *, card_id, user_id, role):
    from app.models.stakeholder import Stakeholder

    s = Stakeholder(card_id=card_id, user_id=user_id, role=role)
    db.add(s)
    await db.flush()
    return s


@pytest.fixture
async def env(db):
    """Roles, users and a BusinessProcess card covering every approval identity.

    Roles mirror the seeded ones on the two keys that matter: ``member`` has
    ``bpm.edit`` but not ``bpm.approve_flows`` (that combination is exactly what
    used to let anyone approve), ``bpm_admin`` has both, nobody has
    ``bpm.withdraw_flows``.
    """
    PermissionService.invalidate_role_cache()
    PermissionService.invalidate_srd_cache()

    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions={
            "inventory.view": True,
            "inventory.edit": True,
            "bpm.view": True,
            "bpm.edit": True,
            "bpm.approve_flows": False,
            "bpm.withdraw_flows": False,
        },
    )
    await create_role(
        db,
        key="bpm_admin",
        label="BPM Admin",
        permissions={
            "inventory.view": True,
            "inventory.edit": True,
            "bpm.view": True,
            "bpm.edit": True,
            "bpm.approve_flows": True,
            "bpm.withdraw_flows": False,
        },
    )
    await create_card_type(db, key="BusinessProcess", label="Business Process")

    # Stakeholder roles on BusinessProcess, matching the seeded permission sets.
    await create_stakeholder_role_def(
        db,
        card_type_key="BusinessProcess",
        key="processOwner",
        label="Process Owner",
        permissions={
            "card.view": True,
            "card.edit": True,
            "card.approval_status": True,
            "card.bpm_edit": True,
            "card.bpm_approve": True,
            "card.bpm_withdraw": False,
        },
    )
    await create_stakeholder_role_def(
        db,
        card_type_key="BusinessProcess",
        key="responsible",
        label="Responsible",
        permissions={
            "card.view": True,
            "card.edit": True,
            # True on the seeded role — the old gate used this key, which is why
            # `responsible` could approve despite card.bpm_approve being False.
            "card.approval_status": True,
            "card.bpm_edit": True,
            "card.bpm_approve": False,
            "card.bpm_withdraw": False,
        },
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    member2 = await create_user(db, email="member2@test.com", role="member")
    bpm_admin = await create_user(db, email="bpmadmin@test.com", role="bpm_admin")
    owner = await create_user(db, email="owner@test.com", role="member")
    responsible = await create_user(db, email="responsible@test.com", role="member")

    process = await create_card(
        db, card_type="BusinessProcess", name="Test Process", user_id=admin.id
    )
    await _add_stakeholder(db, card_id=process.id, user_id=owner.id, role="processOwner")
    await _add_stakeholder(db, card_id=process.id, user_id=responsible.id, role="responsible")
    await db.flush()

    return {
        "admin": admin,
        "member": member,
        "member2": member2,
        "bpm_admin": bpm_admin,
        "owner": owner,
        "responsible": responsible,
        "process": process,
    }


async def _draft(client, process_id, user):
    resp = await client.post(
        f"/api/v1/bpm/processes/{process_id}/flow/drafts",
        json={"bpmn_xml": SAMPLE_BPMN},
        headers=auth_headers(user),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _submit(client, process_id, vid, user):
    resp = await client.post(
        f"/api/v1/bpm/processes/{process_id}/flow/versions/{vid}/submit",
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text


async def _publish(client, process_id, *, submitter, approver):
    """Take a draft all the way to published and return its version id."""
    vid = await _draft(client, process_id, submitter)
    await _submit(client, process_id, vid, submitter)
    resp = await client.post(
        f"/api/v1/bpm/processes/{process_id}/flow/versions/{vid}/approve",
        headers=auth_headers(approver),
    )
    assert resp.status_code == 200, resp.text
    return vid


# ---------------------------------------------------------------------------
# Approval authority — the regression tests that were missing
# ---------------------------------------------------------------------------


class TestApprovalAuthority:
    async def test_member_cannot_approve(self, client, db, env):
        """A plain member holds bpm.edit but not bpm.approve_flows."""
        process, member = env["process"], env["member"]
        vid = await _draft(client, process.id, member)
        await _submit(client, process.id, vid, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_member_cannot_reject(self, client, db, env):
        process, member = env["process"], env["member"]
        vid = await _draft(client, process.id, member)
        await _submit(client, process.id, vid, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/reject",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_responsible_stakeholder_cannot_approve(self, client, db, env):
        """card.approval_status is True on `responsible`, card.bpm_approve is not.

        The old gate read the former, which is why a Responsible could sign off
        a process flow it was never meant to.
        """
        process, member, responsible = env["process"], env["member"], env["responsible"]
        vid = await _draft(client, process.id, member)
        await _submit(client, process.id, vid, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(responsible),
        )
        assert resp.status_code == 403

    async def test_bpm_admin_can_approve(self, client, db, env):
        process, member, bpm_admin = env["process"], env["member"], env["bpm_admin"]
        vid = await _draft(client, process.id, member)
        await _submit(client, process.id, vid, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(bpm_admin),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "published"

    async def test_process_owner_stakeholder_can_approve(self, client, db, env):
        """card.bpm_approve on the processOwner stakeholder role is enough."""
        process, member, owner = env["process"], env["member"], env["owner"]
        vid = await _draft(client, process.id, member)
        await _submit(client, process.id, vid, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(owner),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "published"

    async def test_permissions_endpoint_reports_can_approve_false_for_member(self, client, db, env):
        """The UI must not offer a button the API would refuse."""
        resp = await client.get(
            f"/api/v1/bpm/processes/{env['process'].id}/flow/permissions",
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["can_edit_draft"] is True
        assert body["can_approve"] is False
        assert body["can_withdraw"] is False


class TestSeparateApprover:
    async def test_self_approval_allowed_when_controlled_publishing_off(self, client, db, env):
        """Default instance: unchanged behaviour for an approver acting alone."""
        await _set_separate_approver(db, enabled=False)
        process, bpm_admin = env["process"], env["bpm_admin"]
        vid = await _draft(client, process.id, bpm_admin)
        await _submit(client, process.id, vid, bpm_admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(bpm_admin),
        )
        assert resp.status_code == 200

    async def test_self_approval_refused_under_controlled_publishing(self, client, db, env):
        await _set_separate_approver(db, enabled=True)
        process, bpm_admin = env["process"], env["bpm_admin"]
        vid = await _draft(client, process.id, bpm_admin)
        await _submit(client, process.id, vid, bpm_admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(bpm_admin),
        )
        assert resp.status_code == 403
        assert "separate approver" in resp.json()["detail"]

    async def test_different_approver_accepted_under_controlled_publishing(self, client, db, env):
        await _set_separate_approver(db, enabled=True)
        process, member, bpm_admin = env["process"], env["member"], env["bpm_admin"]
        vid = await _draft(client, process.id, member)
        await _submit(client, process.id, vid, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(bpm_admin),
        )
        assert resp.status_code == 200

    async def test_sub_option_can_be_switched_off(self, client, db, env):
        """A two-person team keeps withdrawal without the second-approver rule."""
        await _set_separate_approver(db, enabled=False)
        process, bpm_admin = env["process"], env["bpm_admin"]
        vid = await _draft(client, process.id, bpm_admin)
        await _submit(client, process.id, vid, bpm_admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/approve",
            headers=auth_headers(bpm_admin),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Withdrawal
# ---------------------------------------------------------------------------


class TestWithdrawGating:
    async def test_refused_without_permission(self, client, db, env):
        """Withdrawal is gated on the permission alone, and nobody holds it.

        The process owner can approve but holds no withdraw permission, which is
        the shipped default — no instance setting is involved.
        """
        process, admin, member, owner = (
            env["process"],
            env["admin"],
            env["member"],
            env["owner"],
        )
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(owner),
        )
        assert resp.status_code == 403

    async def test_granting_the_stakeholder_permission_is_enough(self, client, db, env):
        """The intended setup: an admin ticks card.bpm_withdraw on processOwner."""
        from sqlalchemy import select

        from app.models.stakeholder_role_definition import StakeholderRoleDefinition

        process, admin, member, owner = (
            env["process"],
            env["admin"],
            env["member"],
            env["owner"],
        )
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        srd = (
            await db.execute(
                select(StakeholderRoleDefinition).where(
                    StakeholderRoleDefinition.card_type_key == "BusinessProcess",
                    StakeholderRoleDefinition.key == "processOwner",
                )
            )
        ).scalar_one()
        srd.permissions = {**srd.permissions, "card.bpm_withdraw": True}
        await db.flush()
        PermissionService.invalidate_srd_cache("BusinessProcess", "processOwner")

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(owner),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "withdrawn"


class TestWithdrawValidation:
    async def test_non_published_version_refused(self, client, db, env):
        process, admin, member = env["process"], env["admin"], env["member"]
        await _publish(client, process.id, submitter=member, approver=admin)
        # A fresh draft is not the published version.
        draft_id = await _draft(client, process.id, member)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{draft_id}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_empty_reason_refused(self, client, db, env):
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": ""},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 422  # min_length on the schema

    async def test_whitespace_only_reason_refused(self, client, db, env):
        """Long enough to pass min_length, but still not a reason."""
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": "               "},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "reason is required" in resp.json()["detail"]


class TestWithdrawEffects:
    async def test_withdrawal_is_forward_only(self, client, db, env):
        """The approval is recorded, not erased — 21 CFR 11.10(e)."""
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        before = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
                headers=auth_headers(admin),
            )
        ).json()

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": f"  {GOOD_REASON}  "},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        after = resp.json()

        assert after["status"] == "withdrawn"
        # Nothing about the original approval is obscured.
        assert after["approved_by"] == before["approved_by"]
        assert after["approved_at"] == before["approved_at"]
        assert after["revision"] == before["revision"]
        assert after["bpmn_xml"] == SAMPLE_BPMN
        # The withdrawal itself is fully attributed, and the reason is trimmed.
        assert after["withdrawn_by"] == str(admin.id)
        assert after["withdrawn_at"] is not None
        assert after["withdrawal_reason"] == GOOD_REASON

    async def test_process_left_with_no_published_flow(self, client, db, env):
        """No *published* flow — though a draft is waiting, see the tests below."""
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/published",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() is None

    async def test_withdrawn_version_listed_in_archived(self, client, db, env):
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/archived",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        rows = resp.json()
        withdrawn = [r for r in rows if r["id"] == vid]
        assert len(withdrawn) == 1
        assert withdrawn[0]["status"] == "withdrawn"
        assert withdrawn[0]["withdrawal_reason"] == GOOD_REASON
        assert withdrawn[0]["withdrawn_by_name"] == admin.display_name

    async def test_cannot_withdraw_twice(self, client, db, env):
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        first = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )
        assert first.status_code == 200

        second = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )
        assert second.status_code == 400

    async def test_elements_and_relations_are_not_touched(self, client, db, env):
        """Withdrawal must never become a covert delete."""
        from sqlalchemy import func, select

        from app.models.process_element import ProcessElement
        from app.models.relation import Relation

        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        async def counts():
            elems = (
                await db.execute(
                    select(func.count())
                    .select_from(ProcessElement)
                    .where(ProcessElement.process_id == process.id)
                )
            ).scalar_one()
            rels = (await db.execute(select(func.count()).select_from(Relation))).scalar_one()
            return elems, rels

        before = await counts()

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )

        assert await counts() == before

    async def test_withdrawal_is_recorded_as_an_event(self, client, db, env):
        """Without the event there is no audit trail on the card."""
        from sqlalchemy import select

        from app.models.event import Event

        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )

        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == process.id,
                        Event.event_type == "process_flow.withdrawn",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].data["reason"] == GOOD_REASON
        assert events[0].user_id == admin.id

    async def test_capture_is_unconditional(self, client, db, env):
        """No setting exists that can switch the audit record off.

        This is the compliance-relevant guarantee. Offering withdrawal at all is
        a permission question; *recording* who withdrew what, when and why is
        not optional, so this runs with app_settings never written to.
        """
        from sqlalchemy import select

        from app.models.app_settings import AppSettings
        from app.models.event import Event

        # Explicitly assert there is no settings row at all for this instance.
        assert (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one_or_none() is None

        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "withdrawn"
        assert body["withdrawal_reason"] == GOOD_REASON
        assert body["withdrawn_by"] == str(admin.id)
        assert body["withdrawn_at"] is not None

        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == process.id,
                        Event.event_type == "process_flow.withdrawn",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1

    async def test_withdrawal_opens_a_draft_at_the_next_revision(self, client, db, env):
        """Withdrawing must not strand the process — it clones a working copy.

        The withdrawn row is the approved artefact and is kept untouched; the
        clone is what the owner edits. Mutating the original into a draft would
        let the very BPMN an approver signed off be edited away.
        """
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        withdrawn_revision = body["revision"]
        assert body["new_draft_revision"] == withdrawn_revision + 1

        drafts = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/flow/drafts",
                headers=auth_headers(admin),
            )
        ).json()
        assert len(drafts) == 1
        draft = drafts[0]
        assert draft["id"] == body["new_draft_id"]
        assert draft["status"] == "draft"
        assert draft["revision"] == withdrawn_revision + 1
        assert draft["based_on_id"] == vid
        # Provenance, so the UI can badge it rather than guessing.
        assert draft["from_withdrawn_revision"] == withdrawn_revision

    async def test_withdrawn_original_is_retained_intact(self, client, db, env):
        """The approved artefact survives the withdrawal byte for byte."""
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)

        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )

        original = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}",
                headers=auth_headers(admin),
            )
        ).json()
        assert original["status"] == "withdrawn"
        assert original["bpmn_xml"] == SAMPLE_BPMN
        assert original["approved_by"] == str(admin.id)
        assert original["approved_at"] is not None

    async def test_the_auto_draft_publishes_at_the_bumped_revision(self, client, db, env):
        """End to end: withdraw, then re-approve the draft it opened."""
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)
        withdraw = (
            await client.post(
                f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
                json={"reason": GOOD_REASON},
                headers=auth_headers(admin),
            )
        ).json()

        draft_id = withdraw["new_draft_id"]
        await _submit(client, process.id, draft_id, member)
        approve = await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{draft_id}/approve",
            headers=auth_headers(admin),
        )
        assert approve.status_code == 200, approve.text

        published = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/flow/published",
                headers=auth_headers(admin),
            )
        ).json()
        assert published["id"] == draft_id
        assert published["revision"] == withdraw["revision"] + 1

    async def test_a_new_revision_can_be_approved_afterwards(self, client, db, env):
        """Recovery path: the process is not stuck without a flow."""
        await _set_separate_approver(db, enabled=False)
        process, admin, member = env["process"], env["admin"], env["member"]
        vid = await _publish(client, process.id, submitter=member, approver=admin)
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/flow/versions/{vid}/withdraw",
            json={"reason": GOOD_REASON},
            headers=auth_headers(admin),
        )

        new_vid = await _publish(client, process.id, submitter=member, approver=admin)
        assert new_vid != vid

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/flow/published",
            headers=auth_headers(admin),
        )
        assert resp.json()["id"] == new_vid
