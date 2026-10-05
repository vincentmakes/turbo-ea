"""The risk register's arithmetic and seeding, pinned to exact values.

``compute_metrics`` feeds the register's KPI header and both 4×4 matrices;
``create_risk`` and ``promote_compliance_finding`` decide every field a new risk
starts with. Each test states the full expected value, so a mutation to a
count, a default or a boundary changes something a test compares.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import RiskMitigationTask
from app.models.todo import Todo
from app.models.turbolens import TurboLensAnalysisRun, TurboLensComplianceFinding
from app.services import risk_service
from app.services.risk_service import (
    build_level_matrix,
    compute_metrics,
    create_risk,
    link_cards,
    promote_compliance_finding,
    risk_count,
    risk_summary,
    validate_status_transition,
)
from tests.conftest import create_card, create_card_type, create_role, create_user

NOW = datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc)
MONTH_START = datetime(2026, 3, 1, tzinfo=timezone.utc)


def risk(**fields) -> Risk:
    base = {"status": "identified", "category": "operational", "reference": "R-000001"}
    base.update(fields)
    return Risk(**base)


class TestLevelMatrix:
    def test_counts_land_on_probability_rows_and_impact_columns(self):
        risks = [
            risk(initial_probability="very_high", initial_impact="critical"),
            risk(initial_probability="very_high", initial_impact="critical"),
            risk(initial_probability="high", initial_impact="medium"),
            risk(initial_probability="low", initial_impact="low"),
            risk(initial_probability="medium", initial_impact="high"),
        ]
        assert build_level_matrix(risks) == [
            [2, 0, 0, 0],
            [0, 0, 1, 0],
            [0, 1, 0, 0],
            [0, 0, 0, 1],
        ]

    def test_the_residual_matrix_reads_the_residual_pair(self):
        risks = [
            risk(
                initial_probability="very_high",
                initial_impact="critical",
                residual_probability="low",
                residual_impact="high",
            )
        ]
        assert build_level_matrix(risks, residual=True) == [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 1, 0, 0],
        ]

    @pytest.mark.parametrize(
        "fields",
        [
            {"initial_probability": None, "initial_impact": "low"},
            {"initial_probability": "low", "initial_impact": None},
            {"initial_probability": "certain", "initial_impact": "low"},
            {"initial_probability": "low", "initial_impact": "catastrophic"},
        ],
    )
    def test_incomplete_or_unknown_pairs_are_not_counted(self, fields):
        assert build_level_matrix([risk(**fields)]) == [[0] * 4 for _ in range(4)]


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW


class TestComputeMetrics:
    @pytest.fixture(autouse=True)
    def _freeze(self, monkeypatch):
        monkeypatch.setattr(risk_service, "datetime", _Frozen)

    def test_every_count(self):
        yesterday = NOW.date() - timedelta(days=1)
        risks = [
            # overdue: past target, still open
            risk(
                status="in_progress",
                category="security",
                initial_level="high",
                target_resolution_date=yesterday,
                created_at=MONTH_START,
            ),
            # residual level wins over the initial one; due today is not overdue
            risk(
                status="analysed",
                category="security",
                initial_level="critical",
                residual_level="low",
                target_resolution_date=NOW.date(),
                created_at=MONTH_START - timedelta(microseconds=1),
            ),
            # past target but closed / accepted / mitigated is not overdue
            risk(status="closed", initial_level="medium", target_resolution_date=yesterday),
            risk(status="accepted", initial_level="medium", target_resolution_date=yesterday),
            risk(status="mitigated", initial_level="bogus", target_resolution_date=yesterday),
            # no date, no level, a status outside the known list
            risk(status="legacy", category="financial", created_at=NOW),
        ]
        metrics = compute_metrics(risks)
        assert metrics["total"] == 6
        assert metrics["by_status"] == {
            "identified": 0,
            "analysed": 1,
            "mitigation_planned": 0,
            "in_progress": 1,
            "mitigated": 1,
            "monitoring": 0,
            "accepted": 1,
            "closed": 1,
            "legacy": 1,
        }
        assert metrics["by_level"] == {"critical": 0, "high": 1, "medium": 2, "low": 1}
        assert metrics["by_category"] == {"security": 2, "operational": 3, "financial": 1}
        assert metrics["overdue"] == 1
        assert metrics["created_this_month"] == 2
        assert metrics["initial_matrix"] == [[0] * 4 for _ in range(4)]
        assert metrics["residual_matrix"] == [[0] * 4 for _ in range(4)]

    def test_no_risks(self):
        metrics = compute_metrics([])
        assert metrics["total"] == 0
        assert set(metrics["by_status"].values()) == {0}
        assert metrics["by_category"] == {}
        assert (metrics["overdue"], metrics["created_this_month"]) == (0, 0)

    def test_the_matrices_are_included(self):
        r = risk(
            initial_probability="high",
            initial_impact="low",
            residual_probability="low",
            residual_impact="low",
        )
        metrics = compute_metrics([r])
        assert metrics["initial_matrix"][1][3] == 1
        assert metrics["residual_matrix"][3][3] == 1


class TestSummaryAndTransitions:
    def test_summary_prefers_the_residual_level(self):
        r = risk(reference="R-000042", title="Vendor lock-in", initial_level="HIGH")
        assert risk_summary(r) == "R-000042 · High · Vendor lock-in"
        r.residual_level = "low"
        assert risk_summary(r) == "R-000042 · Low · Vendor lock-in"

    def test_summary_without_a_level_or_title(self):
        assert risk_summary(risk(reference="R-000007", title=None)) == "R-000007"

    def test_an_illegal_transition_names_what_is_allowed(self):
        with pytest.raises(ValueError) as exc:
            validate_status_transition("identified", "closed")
        assert str(exc.value) == (
            "Illegal status transition: identified → closed. Allowed: ['accepted', 'analysed']"
        )

    def test_an_unknown_current_status_allows_nothing(self):
        with pytest.raises(ValueError) as exc:
            validate_status_transition("legacy", "closed")
        assert str(exc.value) == "Illegal status transition: legacy → closed. Allowed: (none)"

    def test_staying_put_is_always_allowed(self):
        validate_status_transition("legacy", "legacy")


@pytest.fixture
async def people(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    actor = await create_user(db, email="actor@t.com", role="admin")
    owner = await create_user(db, email="owner@t.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    return actor, owner


class TestCreateRisk:
    async def test_defaults(self, db, people):
        actor, _ = people
        r = await create_risk(db, title="Minimal", actor_id=actor.id)
        assert isinstance(r.id, uuid.UUID)
        assert (r.reference, r.title, r.description, r.category) == (
            "R-000001",
            "Minimal",
            "",
            "operational",
        )
        assert (r.source_type, r.source_ref, r.status, r.created_by) == (
            "manual",
            None,
            "identified",
            actor.id,
        )
        assert (r.initial_probability, r.initial_impact, r.initial_level) == (
            "medium",
            "medium",
            "medium",
        )
        stored = (await db.execute(select(Risk).where(Risk.id == r.id))).scalar_one()
        assert stored.category == "operational"

    async def test_explicit_fields_and_the_derived_level(self, db, people):
        actor, owner = people
        r = await create_risk(
            db,
            title="Full",
            description=None,
            category="security",
            initial_probability="very_high",
            initial_impact="critical",
            owner_id=owner.id,
            target_resolution_date=date(2026, 6, 1),
            source_type="extension",
            source_ref="ext:1",
            actor_id=actor.id,
        )
        assert r.description == ""
        assert (r.initial_level, r.category, r.source_type, r.source_ref) == (
            "critical",
            "security",
            "extension",
            "ext:1",
        )
        assert (r.owner_id, r.target_resolution_date) == (owner.id, date(2026, 6, 1))

    async def test_an_unknown_pair_falls_back_to_a_medium_level(self, db, people):
        actor, _ = people
        r = await create_risk(
            db, title="Odd", initial_probability="certain", initial_impact="x", actor_id=actor.id
        )
        assert r.initial_level == "medium"

    async def test_references_count_up(self, db, people):
        actor, _ = people
        first = await create_risk(db, title="A", actor_id=actor.id)
        second = await create_risk(db, title="B", actor_id=actor.id)
        assert (first.reference, second.reference) == ("R-000001", "R-000002")

    async def test_the_owner_todo_and_the_events_carry_the_actor(self, db, people):
        actor, owner = people
        card = await create_card(db, card_type="Application", name="App")
        r = await create_risk(
            db, title="Owned", owner_id=owner.id, card_ids=[card.id], actor_id=actor.id
        )
        todo = (
            await db.execute(select(Todo).where(Todo.link == f"/ea-delivery/risks/{r.id}"))
        ).scalar_one()
        assert (todo.created_by, todo.assigned_to) == (actor.id, owner.id)
        events = (
            (await db.execute(select(Event).where(Event.event_type == "risk.added")))
            .scalars()
            .all()
        )
        assert [(e.card_id, e.user_id) for e in events] == [(card.id, actor.id)]
        assert events[0].data["created"] is True


class TestLinkCards:
    async def test_skips_unknown_and_already_linked_cards(self, db, people):
        actor, _ = people
        a = await create_card(db, card_type="Application", name="A")
        b = await create_card(db, card_type="Application", name="B")
        r = await create_risk(db, title="R", card_ids=[a.id], actor_id=actor.id)
        await link_cards(db, r.id, [uuid.uuid4(), a.id, b.id], role="cause")
        await db.flush()
        rows = (await db.execute(select(RiskCard).where(RiskCard.risk_id == r.id))).scalars().all()
        assert {(row.card_id, row.role) for row in rows} == {(a.id, "affected"), (b.id, "cause")}


async def _finding(db, actor, **fields) -> TurboLensComplianceFinding:
    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="compliance",
        status="completed",
        started_at=NOW,
        created_by=actor.id,
    )
    db.add(run)
    await db.flush()
    base = {
        "id": uuid.uuid4(),
        "run_id": run.id,
        "regulation": "gdpr",
        "regulation_article": "Art. 35",
        "card_id": None,
        "scope_type": "landscape",
        "category": "privacy",
        "requirement": "A DPIA is required.",
        "status": "review_needed",
        "severity": "info",
        "gap_description": "",
        "remediation": None,
        "finding_key": f"k-{uuid.uuid4().hex}",
    }
    base.update(fields)
    row = TurboLensComplianceFinding(**base)
    db.add(row)
    await db.flush()
    return row


class TestPromote:
    async def test_an_unknown_finding(self, db):
        with pytest.raises(LookupError) as exc:
            await promote_compliance_finding(db, uuid.uuid4(), None)
        assert str(exc.value) == "Finding not found"

    async def test_seeds_a_landscape_risk(self, db, people):
        actor, _ = people
        finding = await _finding(db, actor, gap_description="No DPIA on file.")
        r = await promote_compliance_finding(db, finding.id, actor.id)
        assert (r.title, r.category, r.source_type, r.source_ref) == (
            "Art. 35: landscape",
            "compliance",
            "compliance",
            "gdpr",
        )
        assert r.description == "A DPIA is required.\n\nNo DPIA on file."
        # review_needed → medium probability; info severity → low impact.
        assert (r.initial_probability, r.initial_impact, r.initial_level) == (
            "medium",
            "low",
            "low",
        )
        assert (r.status, r.created_by, r.owner_id) == ("identified", actor.id, None)
        assert finding.risk_id == r.id
        assert finding.decision == "risk_tracked"
        assert finding.reviewed_by == actor.id
        assert finding.reviewed_at is not None
        assert finding.reviewed_at.tzinfo is not None

    async def test_a_non_compliant_finding_on_a_card(self, db, people):
        actor, _ = people
        card = await create_card(db, card_type="Application", name="CRM")
        finding = await _finding(
            db, actor, status="non_compliant", severity="critical", card_id=card.id
        )
        r = await promote_compliance_finding(db, finding.id, actor.id)
        assert r.title == "Art. 35: CRM"
        assert (r.initial_probability, r.initial_impact, r.initial_level) == (
            "high",
            "critical",
            "critical",
        )
        links = (await db.execute(select(RiskCard.card_id).where(RiskCard.risk_id == r.id))).all()
        assert links == [(card.id,)]

    async def test_without_an_article_the_regulation_names_it(self, db, people):
        actor, _ = people
        finding = await _finding(
            db,
            actor,
            regulation_article="  ",
            requirement="",
            gap_description="Only the gap.",
            remediation="Write the DPIA.",
        )
        r = await promote_compliance_finding(db, finding.id, actor.id)
        assert r.title == "GDPR: landscape"
        assert r.description == "Only the gap."
        task = (
            await db.execute(select(RiskMitigationTask).where(RiskMitigationTask.risk_id == r.id))
        ).scalar_one()
        assert task.title == "Remediate GDPR"

    async def test_an_unknown_severity_and_bad_overrides_fall_back_to_medium(self, db, people):
        actor, _ = people
        finding = await _finding(db, actor, severity="weird")
        r = await promote_compliance_finding(
            db,
            finding.id,
            actor.id,
            overrides={"initial_probability": "certain", "initial_impact": "fatal"},
        )
        assert (r.initial_probability, r.initial_impact, r.initial_level) == (
            "medium",
            "medium",
            "medium",
        )

    async def test_valid_overrides_win(self, db, people):
        actor, owner = people
        finding = await _finding(db, actor, remediation="Fix it.")
        due = date(2026, 9, 1)
        r = await promote_compliance_finding(
            db,
            finding.id,
            actor.id,
            overrides={
                "initial_probability": "low",
                "initial_impact": "high",
                "title": "Custom",
                "description": "Custom body",
                "category": "security",
                "owner_id": owner.id,
                "target_resolution_date": due,
            },
        )
        assert (r.title, r.description, r.category) == ("Custom", "Custom body", "security")
        assert (r.initial_level, r.owner_id, r.target_resolution_date) == ("medium", owner.id, due)
        task = (
            await db.execute(select(RiskMitigationTask).where(RiskMitigationTask.risk_id == r.id))
        ).scalar_one()
        assert (task.title, task.description, task.owner_id) == (
            "Remediate: Art. 35",
            "Fix it.",
            owner.id,
        )
        assert (task.recurrence_unit, task.recurrence_interval, task.created_by) == (
            "none",
            1,
            actor.id,
        )

    async def test_long_titles_are_cut_at_500(self, db, people):
        actor, _ = people
        finding = await _finding(db, actor, regulation_article="A" * 120, remediation="Do it.")
        r = await promote_compliance_finding(
            db, finding.id, actor.id, overrides={"title": "T" * 600}
        )
        assert r.title == "T" * 500

    async def test_no_task_without_a_person_to_own_the_write(self, db, people):
        actor, _ = people
        finding = await _finding(db, actor, remediation="Fix it.")
        r = await promote_compliance_finding(db, finding.id, None)
        tasks = (
            await db.execute(select(RiskMitigationTask).where(RiskMitigationTask.risk_id == r.id))
        ).all()
        assert tasks == []
        assert r.created_by is None

    async def test_a_second_promotion_returns_the_first_risk(self, db, people):
        actor, _ = people
        finding = await _finding(db, actor)
        first = await promote_compliance_finding(db, finding.id, actor.id)
        again = await promote_compliance_finding(db, finding.id, actor.id)
        assert again.id == first.id
        assert await risk_count(db) == 1


class TestRiskCount:
    async def test_counts_rows(self, db, people):
        actor, _ = people
        assert await risk_count(db) == 0
        await create_risk(db, title="A", actor_id=actor.id)
        await create_risk(db, title="B", actor_id=actor.id)
        assert await risk_count(db) == 2
