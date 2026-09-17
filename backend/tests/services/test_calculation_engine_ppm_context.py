"""The ``ppm`` context root, built against a real database.

These are the first tests of ``_build_context`` itself. They pin the two things
most likely to break silently: which rows land in which fiscal year, and that a
related Initiative's PPM data is reachable through ``PLUCK``.
"""

from __future__ import annotations

from datetime import date

from app.models.app_settings import AppSettings
from app.services.calculation_engine import _build_context, _evaluate_formula
from app.services.calculation_ppm import build_ppm_map
from tests.conftest import (
    create_budget_line,
    create_card,
    create_card_type,
    create_cost_line,
    create_ppm_risk,
    create_relation,
    create_relation_type,
    create_status_report,
    create_task,
    create_wbs,
)


async def _set_fiscal_year_start(db, month: int) -> None:
    row = AppSettings(id="default", general_settings={"fiscalYearStart": month})
    await db.merge(row)
    await db.flush()


async def _initiative_with_ppm(db, *, name="Initiative"):
    await create_card_type(db, key="Initiative", label="Initiative")
    card = await create_card(db, card_type="Initiative", name=name)
    await create_budget_line(
        db, initiative_id=card.id, fiscal_year=2025, category="capex", amount=100
    )
    await create_budget_line(
        db, initiative_id=card.id, fiscal_year=2025, category="opex", amount=50
    )
    await create_budget_line(
        db, initiative_id=card.id, fiscal_year=2026, category="capex", amount=200
    )
    await create_cost_line(
        db, initiative_id=card.id, category="capex", planned=10, actual=7, date=date(2025, 11, 1)
    )
    return card


class TestPpmRoot:
    async def test_totals_split_by_category(self, db):
        card = await _initiative_with_ppm(db)
        context = await _build_context(db, card, needs_ppm_data=True)
        ppm = context["ppm"]
        assert ppm["capexBudget"] == 300
        assert ppm["opexBudget"] == 50
        assert ppm["totalBudget"] == 350
        assert ppm["capexActual"] == 7
        assert ppm["totalPlanned"] == 10

    async def test_by_year_is_sorted_and_split(self, db):
        card = await _initiative_with_ppm(db)
        context = await _build_context(db, card, needs_ppm_data=True)
        years = [row["year"] for row in context["ppm"]["byYear"]]
        assert years == sorted(years)
        assert 2025 in years and 2026 in years
        by_year = {row["year"]: row for row in context["ppm"]["byYear"]}
        assert by_year[2025]["capexBudget"] == 100
        assert by_year[2026]["capexBudget"] == 200

    async def test_totals_include_a_category_outside_capex_and_opex(self, db):
        # `category` is a plain text column, so imports and older rows can carry
        # anything. Such a row must still count towards the totals, or the
        # numbers stop reconciling with the PPM Cost tab.
        card = await _initiative_with_ppm(db)
        await create_budget_line(
            db, initiative_id=card.id, fiscal_year=2025, category="contingency", amount=25
        )
        context = await _build_context(db, card, needs_ppm_data=True)
        ppm = context["ppm"]
        assert ppm["totalBudget"] == 375
        assert ppm["capexBudget"] + ppm["opexBudget"] < ppm["totalBudget"]

    async def test_dateless_cost_line_is_in_totals_but_no_year(self, db):
        card = await _initiative_with_ppm(db)
        await create_cost_line(db, initiative_id=card.id, category="opex", actual=40, date=None)
        context = await _build_context(db, card, needs_ppm_data=True)
        ppm = context["ppm"]
        assert ppm["totalActual"] == 47
        assert ppm["unscheduledActual"] == 40
        assert sum(row["totalActual"] for row in ppm["byYear"]) == 7

    async def test_fiscal_year_start_shifts_cost_lines_only(self, db):
        # Budget lines keep their stored fiscal_year; cost lines are bucketed
        # from their date. With an October start the November cost line moves
        # into FY2026 while the FY2025 budget rows stay put — documenting that
        # the two sides use different sources for the year.
        await _set_fiscal_year_start(db, 10)
        card = await _initiative_with_ppm(db)
        context = await _build_context(db, card, needs_ppm_data=True)
        by_year = {row["year"]: row for row in context["ppm"]["byYear"]}
        assert by_year[2025]["capexBudget"] == 100
        assert by_year[2025]["capexActual"] == 0
        assert by_year[2026]["capexActual"] == 7

    async def test_non_initiative_card_gets_a_zeroed_payload(self, db):
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="App")
        context = await _build_context(db, card, needs_ppm_data=True)
        assert context["ppm"]["totalBudget"] == 0.0
        assert context["ppm"]["byYear"] == []
        assert _evaluate_formula("ppm.capexBudget + 1", context) == 1

    async def test_lazy_build_leaves_the_root_zeroed(self, db):
        # A formula that never mentions `ppm` must not pay for the aggregation.
        card = await _initiative_with_ppm(db)
        context = await _build_context(db, card, needs_ppm_data=False)
        assert context["ppm"]["totalBudget"] == 0.0


class TestPpmOnRelatedCards:
    async def test_related_initiative_exposes_ppm(self, db):
        initiative = await _initiative_with_ppm(db)
        await create_card_type(db, key="Application", label="Application")
        app = await create_card(db, card_type="Application", name="App")
        await create_relation_type(
            db,
            key="relInitiativeToApp",
            label="affects",
            source_type_key="Initiative",
            target_type_key="Application",
        )
        await create_relation(
            db, type_key="relInitiativeToApp", source_id=initiative.id, target_id=app.id
        )

        context = await _build_context(db, app, needs_ppm_data=True)
        formula = 'SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))'
        assert _evaluate_formula(formula, context) == 300

    async def test_non_initiative_relations_contribute_nothing(self, db):
        # The wrapper for a non-Initiative card carries no `ppm` key at all, so
        # PLUCK yields None and _SUM skips it rather than raising.
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        app = await create_card(db, card_type="Application", name="App")
        itc = await create_card(db, card_type="ITComponent", name="Component")
        await create_relation_type(
            db,
            key="relAppToITC",
            label="uses",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        await create_relation(db, type_key="relAppToITC", source_id=app.id, target_id=itc.id)

        context = await _build_context(db, app, needs_ppm_data=True)
        assert (
            _evaluate_formula('SUM(PLUCK(relations.relAppToITC, "ppm.capexBudget"))', context) == 0
        )


class TestDeliveryFigures:
    """The non-money half of the ``ppm`` root (#1111)."""

    async def test_completion_is_the_mean_of_root_work_packages(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        card = await create_card(db, card_type="Initiative", name="Rollout")
        root_a = await create_wbs(db, initiative_id=card.id, title="Phase 1", completion=80)
        await create_wbs(db, initiative_id=card.id, title="Phase 2", completion=40)
        # A child at 100 % must not skew the mean — its root already carries it.
        await create_wbs(
            db, initiative_id=card.id, title="Child", parent_id=root_a.id, completion=100
        )
        await create_wbs(db, initiative_id=card.id, title="Go-live", is_milestone=True)

        context = await _build_context(db, card, needs_ppm_data=True)
        ppm = context["ppm"]
        # (80 + 40 + 0) / 3 — the milestone is a root too, at 0 %.
        assert ppm["completion"] == 40.0
        assert ppm["wbsCount"] == 3
        assert ppm["milestoneCount"] == 1
        assert _evaluate_formula("ppm.completion", context) == 40.0

    async def test_no_work_packages_reads_zero(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        card = await create_card(db, card_type="Initiative", name="Empty")
        context = await _build_context(db, card, needs_ppm_data=True)
        assert context["ppm"]["completion"] == 0.0
        assert context["ppm"]["taskCount"] == 0

    async def test_task_counts_and_overdue(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        card = await create_card(db, card_type="Initiative", name="Rollout")
        await create_task(db, initiative_id=card.id, status="todo", due_date=date(2026, 1, 1))
        await create_task(
            db, initiative_id=card.id, status="in_progress", due_date=date(2026, 1, 1)
        )
        await create_task(db, initiative_id=card.id, status="blocked")
        # Done and past due is not overdue; due today is not overdue either.
        await create_task(db, initiative_id=card.id, status="done", due_date=date(2026, 1, 1))
        await create_task(db, initiative_id=card.id, status="todo", due_date=date(2026, 6, 1))

        payload = (await build_ppm_map(db, [card.id], start_month=1, today=date(2026, 6, 1)))[
            str(card.id)
        ]
        assert payload["taskCount"] == 5
        assert payload["tasksTodo"] == 2
        assert payload["tasksInProgress"] == 1
        assert payload["tasksBlocked"] == 1
        assert payload["tasksDone"] == 1
        assert payload["tasksOverdue"] == 2

    async def test_risks_and_latest_report(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        card = await create_card(db, card_type="Initiative", name="Rollout")
        await create_ppm_risk(db, initiative_id=card.id, probability=2, impact=5, status="open")
        await create_ppm_risk(db, initiative_id=card.id, probability=4, impact=4, status="closed")
        await create_status_report(
            db, initiative_id=card.id, report_date=date(2026, 3, 1), schedule_health="atRisk"
        )
        await create_status_report(
            db,
            initiative_id=card.id,
            report_date=date(2026, 5, 1),
            schedule_health="offTrack",
            cost_health="atRisk",
        )

        context = await _build_context(db, card, needs_ppm_data=True)
        ppm = context["ppm"]
        assert ppm["riskCount"] == 2
        assert ppm["risksOpen"] == 1
        assert ppm["riskScoreMax"] == 16
        assert ppm["reportCount"] == 2
        assert ppm["reportDate"] == "2026-05-01"
        assert ppm["scheduleHealth"] == "offTrack"
        assert ppm["costHealth"] == "atRisk"
        assert ppm["scopeHealth"] == "onTrack"
        assert (
            _evaluate_formula('IF(ppm.scheduleHealth == "offTrack", "Late", "Fine")', context)
            == "Late"
        )

    async def test_reachable_through_a_relation(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        await create_card_type(db, key="Application", label="Application")
        await create_relation_type(
            db,
            key="relInitiativeToApp",
            source_type_key="Initiative",
            target_type_key="Application",
        )
        initiative = await create_card(db, card_type="Initiative", name="Rollout")
        app = await create_card(db, card_type="Application", name="ERP")
        await create_relation(
            db, type_key="relInitiativeToApp", source_id=initiative.id, target_id=app.id
        )
        await create_wbs(db, initiative_id=initiative.id, completion=70)

        context = await _build_context(db, app, needs_ppm_data=True)
        assert (
            _evaluate_formula('MAX(PLUCK(relations.relInitiativeToApp, "ppm.completion"))', context)
            == 70.0
        )
