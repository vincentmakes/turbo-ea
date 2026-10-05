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
from app.models.notification import Notification
from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import (
    RiskMitigationTask,
    RiskMitigationTaskOccurrence,
)
from app.models.todo import Todo
from app.models.turbolens import TurboLensAnalysisRun, TurboLensComplianceFinding
from app.services import risk_service
from app.services.card_read_scope import CardReadScope
from app.services.risk_service import (
    build_level_matrix,
    compute_metrics,
    create_risk,
    link_cards,
    promote_compliance_finding,
    risk_count,
    risk_snapshot,
    risk_summary,
    risk_to_dict,
    sync_owner_todo,
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

    def test_a_skipped_risk_does_not_end_the_count(self):
        risks = [
            risk(initial_probability="high", initial_impact=None),
            risk(initial_probability="bogus", initial_impact="low"),
            risk(initial_probability="high", initial_impact="low"),
        ]
        assert build_level_matrix(risks) == [
            [0, 0, 0, 0],
            [0, 0, 0, 1],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ]


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW


class _FrozenOffTheHour(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 3, 15, 12, 34, 56, 789000, tzinfo=timezone.utc)


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

    def test_the_month_starts_at_midnight_whatever_the_clock_says(self, monkeypatch):
        monkeypatch.setattr(risk_service, "datetime", _FrozenOffTheHour)
        overdue = date(2026, 3, 14)
        risks = [
            risk(status="in_progress", target_resolution_date=overdue, created_at=MONTH_START),
            risk(
                status="in_progress",
                target_resolution_date=overdue,
                created_at=MONTH_START - timedelta(microseconds=1),
            ),
        ]
        metrics = compute_metrics(risks)
        assert metrics["created_this_month"] == 1
        assert metrics["by_status"]["in_progress"] == 2
        assert metrics["overdue"] == 2

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


class TestSnapshot:
    def test_values_are_json_ready(self):
        owner = uuid.uuid4()
        snap = risk_snapshot(
            risk(
                title="Snap",
                owner_id=owner,
                target_resolution_date=date(2026, 6, 1),
                accepted_at=NOW,
                initial_probability="high",
            )
        )
        assert snap["owner_id"] == str(owner)
        assert snap["target_resolution_date"] == "2026-06-01"
        assert snap["accepted_at"] == "2026-03-15T12:00:00+00:00"
        assert (snap["title"], snap["initial_probability"], snap["accepted_by"]) == (
            "Snap",
            "high",
            None,
        )


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

    async def test_the_event_payload(self, db, people):
        actor, _ = people
        card = await create_card(db, card_type="Application", name="App")
        r = await create_risk(
            db,
            title="Payload",
            category="security",
            initial_probability="high",
            initial_impact="high",
            card_ids=[card.id],
            actor_id=actor.id,
            event_extra={"via": "test"},
        )
        event = (
            await db.execute(select(Event).where(Event.event_type == "risk.added"))
        ).scalar_one()
        expected = {
            "risk_id": str(r.id),
            "reference": "R-000001",
            "title": "Payload",
            "level": r.initial_level,
            "status": "identified",
            "category": "security",
            "link": f"/ea-delivery/risks/{r.id}",
            "summary": risk_summary(r),
            "via": "test",
            "created": True,
        }
        assert r.initial_level is not None
        assert {k: event.data.get(k) for k in expected} == expected


class TestSyncOwnerTodo:
    @pytest.mark.parametrize(
        "status, todo_status",
        [
            ("identified", "open"),
            ("in_progress", "open"),
            ("mitigated", "done"),
            ("monitoring", "done"),
            ("accepted", "done"),
            ("closed", "done"),
        ],
    )
    async def test_the_todo_follows_the_risk(self, db, people, status, todo_status):
        actor, owner = people
        r = await create_risk(db, title="Lifecycle", owner_id=owner.id, actor_id=actor.id)
        r.status = status
        await sync_owner_todo(db, r, actor_id=actor.id, previous_owner=owner.id)
        todo = (
            await db.execute(select(Todo).where(Todo.link == f"/ea-delivery/risks/{r.id}"))
        ).scalar_one()
        assert todo.status == todo_status

    async def test_a_persons_own_todo_on_the_same_link_is_left_alone(self, db, people):
        actor, owner = people
        r = await create_risk(db, title="Mine", owner_id=owner.id, actor_id=actor.id)
        link = f"/ea-delivery/risks/{r.id}"
        db.add(
            Todo(
                id=uuid.uuid4(),
                description="My own note",
                status="open",
                link=link,
                is_system=False,
                assigned_to=actor.id,
                created_by=actor.id,
            )
        )
        await db.flush()
        r.owner_id = None
        await sync_owner_todo(db, r, actor_id=actor.id, previous_owner=owner.id)
        await db.flush()
        rows = (
            await db.execute(select(Todo.description, Todo.is_system).where(Todo.link == link))
        ).all()
        assert rows == [("My own note", False)]

    async def test_the_assignment_notification(self, db, people):
        actor, owner = people
        r = await create_risk(db, title="N" * 250, owner_id=owner.id, actor_id=actor.id)
        note = (
            await db.execute(select(Notification).where(Notification.user_id == owner.id))
        ).scalar_one()
        assert (note.type, note.title, note.message, note.link, note.actor_id) == (
            "risk_assigned",
            "Risk R-000001 assigned to you",
            "N" * 200,
            f"/ea-delivery/risks/{r.id}",
            actor.id,
        )
        assert note.data == {"risk_id": str(r.id), "reference": "R-000001", "level": "medium"}


def _reader(*, base_view: bool, denied: frozenset[str]) -> CardReadScope:
    return CardReadScope(
        role_key="r",
        wildcard=False,
        base_view=base_view,
        denied_types=denied,
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
    )


class TestRiskToDict:
    async def test_every_field(self, db, people):
        actor, owner = people
        card = await create_card(db, card_type="Application", name="CRM")
        r = await create_risk(
            db,
            title="Lock-in",
            description="Body",
            category="security",
            initial_probability="high",
            initial_impact="medium",
            owner_id=owner.id,
            target_resolution_date=date(2026, 6, 1),
            card_ids=[card.id],
            source_type="compliance",
            source_ref="gdpr",
            actor_id=actor.id,
        )
        r.residual_probability, r.residual_impact, r.residual_level = "low", "low", "low"
        r.status = "accepted"
        r.acceptance_rationale = "Cheaper to live with."
        r.accepted_by, r.accepted_at = actor.id, NOW
        await db.flush()
        await db.refresh(r)
        assert r.created_at is not None and r.updated_at is not None
        assert await risk_to_dict(db, r) == {
            "id": str(r.id),
            "reference": "R-000001",
            "title": "Lock-in",
            "description": "Body",
            "category": "security",
            "source_type": "compliance",
            "source_ref": "gdpr",
            "initial_probability": "high",
            "initial_impact": "medium",
            "initial_level": r.initial_level,
            "residual_probability": "low",
            "residual_impact": "low",
            "residual_level": "low",
            "owner_id": str(owner.id),
            "owner_name": "Test User",
            "target_resolution_date": "2026-06-01",
            "status": "accepted",
            "acceptance_rationale": "Cheaper to live with.",
            "accepted_by": str(actor.id),
            "accepted_at": "2026-03-15T12:00:00+00:00",
            "created_by": str(actor.id),
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat(),
            "cards": [
                {
                    "card_id": str(card.id),
                    "card_name": "CRM",
                    "card_type": "Application",
                    "role": "affected",
                }
            ],
        }

    async def test_a_bare_risk(self, db):
        bare = Risk(
            id=uuid.uuid4(),
            reference="R-000009",
            title="Bare",
            status="identified",
            category="operational",
            source_type="ppm",  # retired vocabulary reads as manual
        )
        d = await risk_to_dict(db, bare)
        keys = (
            "source_type",
            "owner_id",
            "owner_name",
            "target_resolution_date",
            "accepted_by",
            "accepted_at",
            "created_by",
            "created_at",
            "updated_at",
            "cards",
        )
        assert {k: d[k] for k in keys} == {
            "source_type": "manual",
            "owner_id": None,
            "owner_name": None,
            "target_resolution_date": None,
            "accepted_by": None,
            "accepted_at": None,
            "created_by": None,
            "created_at": None,
            "updated_at": None,
            "cards": [],
        }

    async def test_an_owner_without_a_user_row_has_no_name(self, db):
        orphan = Risk(
            id=uuid.uuid4(),
            reference="R-000010",
            title="Orphan",
            status="identified",
            category="operational",
            source_type="extension",
            owner_id=uuid.uuid4(),
        )
        d = await risk_to_dict(db, orphan)
        assert (d["owner_id"], d["owner_name"], d["source_type"]) == (
            str(orphan.owner_id),
            None,
            "extension",
        )

    async def test_linked_cards_follow_the_module_read_scope(self, db, people):
        actor, _ = people
        await create_card_type(db, key="Secret", label="Secret")
        app = await create_card(db, card_type="Application", name="CRM")
        vault = await create_card(db, card_type="Secret", name="Vault")
        r = await create_risk(db, title="Scoped", card_ids=[app.id, vault.id], actor_id=actor.id)
        # No landscape-wide view (inventory mode would hide CRM too) and an
        # explicit deny on Secret: the risk register is module mode.
        reader = _reader(base_view=False, denied=frozenset({"Secret"}))
        scoped = await risk_to_dict(db, r, read_scope=reader)
        assert [c["card_name"] for c in scoped["cards"]] == ["CRM"]
        unscoped = await risk_to_dict(db, r)
        assert sorted(c["card_name"] for c in unscoped["cards"]) == ["CRM", "Vault"]


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

    async def test_a_requirement_without_a_gap_is_the_whole_description(self, db, people):
        actor, _ = people
        finding = await _finding(db, actor, gap_description="")
        r = await promote_compliance_finding(db, finding.id, actor.id)
        assert r.description == "A DPIA is required."

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
        occurrence = (
            await db.execute(
                select(RiskMitigationTaskOccurrence).where(
                    RiskMitigationTaskOccurrence.task_id == task.id
                )
            )
        ).scalar_one()
        assert occurrence.due_date == due

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
