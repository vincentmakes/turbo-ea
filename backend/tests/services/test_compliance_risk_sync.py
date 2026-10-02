"""``propagate_risk_to_findings`` — the Risk → Finding lifecycle mapping.

Database-backed: the propagator reads the findings linked to the risk
through ``risk_id`` and rewrites their ``decision`` / ``review_note`` /
reviewer stamp in place.
"""

from __future__ import annotations

import pytest

from app.services.compliance_risk_sync import propagate_risk_to_findings
from tests.conftest import (
    create_analysis_run,
    create_compliance_finding,
    create_risk,
    create_role,
    create_user,
)


@pytest.fixture
async def actor(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return await create_user(db, email="admin@test.com", role="admin")


async def _linked(db, actor, *, status, rationale=None):
    risk = await create_risk(
        db, title="R", status=status, source_type="compliance", acceptance_rationale=rationale
    )
    run = await create_analysis_run(db, user_id=actor.id)
    finding = await create_compliance_finding(db, run.id, risk_id=risk.id, decision="risk_tracked")
    return risk, finding


class TestMapping:
    @pytest.mark.parametrize(
        "status,decision,note_prefix",
        [
            ("mitigated", "mitigated", "Auto-mitigated"),
            ("monitoring", "mitigated", "Auto-mitigated"),
            ("closed", "verified", "Auto-verified"),
        ],
    )
    async def test_risk_status_drives_the_finding_decision(
        self, db, actor, status, decision, note_prefix
    ):
        risk, finding = await _linked(db, actor, status=status)
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 1
        assert finding.decision == decision
        assert finding.review_note.startswith(note_prefix) and risk.reference in finding.review_note
        assert finding.reviewed_by == actor.id and finding.reviewed_at is not None

    async def test_acceptance_carries_the_rationale(self, db, actor):
        risk, finding = await _linked(db, actor, status="accepted", rationale="  Cheap enough.  ")
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 1
        assert finding.decision == "accepted" and finding.review_note == "Cheap enough."

    async def test_acceptance_without_a_rationale_keeps_the_old_note(self, db, actor):
        risk, finding = await _linked(db, actor, status="accepted")
        finding.review_note = "earlier note"
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 1
        assert finding.decision == "accepted" and finding.review_note == "earlier note"

    @pytest.mark.parametrize("status", ["identified", "analysed", "in_progress"])
    async def test_unmapped_statuses_change_nothing(self, db, actor, status):
        risk, finding = await _linked(db, actor, status=status)
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 0
        assert finding.decision == "risk_tracked" and finding.reviewed_by is None

    async def test_no_linked_findings_is_a_no_op(self, db, actor):
        risk = await create_risk(db, title="R", status="closed")
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 0

    async def test_propagation_is_idempotent(self, db, actor):
        risk, finding = await _linked(db, actor, status="closed")
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 1
        finding.reviewed_by = None
        assert await propagate_risk_to_findings(db, risk, actor_user_id=actor.id) == 0
        assert finding.reviewed_by is None  # untouched the second time

    async def test_deletion_reopens_the_finding_for_review(self, db, actor):
        risk, finding = await _linked(db, actor, status="in_progress")
        assert await propagate_risk_to_findings(db, risk, deleted=True, actor_user_id=actor.id) == 1
        assert finding.decision == "in_review"
        assert finding.review_note == (
            f"Risk {risk.reference} was deleted; finding re-opened for review."
        )

    async def test_every_linked_finding_is_touched(self, db, actor):
        risk, first = await _linked(db, actor, status="closed")
        second = await create_compliance_finding(
            db, first.run_id, risk_id=risk.id, decision="risk_tracked"
        )
        assert await propagate_risk_to_findings(db, risk, actor_user_id=None) == 2
        assert {first.decision, second.decision} == {"verified"}
        assert first.reviewed_by is None  # an extension's write has no actor
