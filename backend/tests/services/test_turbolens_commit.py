"""``turbolens_commit.execute_commit`` — a saved assessment becomes an
Initiative, its selected new cards, the selected relations and a draft
ADR, with progress written to the analysis run."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card import Card
from app.models.relation import Relation
from app.models.turbolens import TurboLensAnalysisRun, TurboLensAssessment
from app.services.turbolens_commit import (
    _build_initiative_description,
    _generate_description,
    execute_commit,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)
from tests.seams import ai_settings


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    for key in ("Initiative", "Objective", "Application", "BusinessCapability", "ITComponent"):
        await create_card_type(db, key=key, label=key)
    for key, src, tgt in (
        ("relInitiativeToObjective", "Initiative", "Objective"),
        ("relInitiativeToApp", "Initiative", "Application"),
        ("relInitiativeToBC", "Initiative", "BusinessCapability"),
        ("relAppToBC", "Application", "BusinessCapability"),
        ("relAppToITC", "Application", "ITComponent"),
        # deliberately no relInitiativeToITC
    ):
        await create_relation_type(db, key=key, label=key, source_type_key=src, target_type_key=tgt)
    objective = await create_card(db, card_type="Objective", name="Grow")
    not_objective = await create_card(db, card_type="Application", name="Legacy")
    sales = await create_card(db, card_type="BusinessCapability", name="Sales")
    postgres = await create_card(db, card_type="ITComponent", name="Postgres")
    run = TurboLensAnalysisRun(
        analysis_type="architect_commit", status="running", created_by=admin.id
    )
    db.add(run)
    session_data = {
        "requirement": "Need lead scoring",
        "capabilityMapping": {
            "summary": "Impact summary",
            "capabilities": [
                {"id": str(sales.id), "existingCardId": str(sales.id), "isNew": False},
                {
                    "id": "new_cap_1",
                    "name": "Lead Mgmt",
                    "isNew": True,
                    "rationale": "missing today",
                },
            ],
            "proposedCards": [
                {
                    "id": "new_app_1",
                    "name": "Lead Scorer",
                    "cardTypeKey": "Application",
                    "subtype": "saas",
                    "isNew": True,
                },
                {
                    "id": "new_cap_1",
                    "name": "Lead Mgmt",
                    "cardTypeKey": "BusinessCapability",
                    "isNew": True,
                },
                {
                    "id": "new_itc_1",
                    "name": "Scoring DB",
                    "cardTypeKey": "ITComponent",
                    "isNew": True,
                },
                {
                    "id": "new_skip",
                    "name": "Not selected",
                    "cardTypeKey": "Application",
                    "isNew": True,
                },
                {
                    "id": str(postgres.id),
                    "name": "Postgres",
                    "cardTypeKey": "ITComponent",
                    "isNew": False,
                    "existingCardId": str(postgres.id),
                },
            ],
            "proposedRelations": [
                {"sourceId": "new_app_1", "targetId": "new_cap_1", "relationType": "relAppToBC"},
                {
                    "sourceId": "new_app_1",
                    "targetId": str(postgres.id),
                    "relationType": "relAppToITC",
                },
                # the model's order runs against the type: stored the type's way
                {"sourceId": str(sales.id), "targetId": "new_app_1", "relationType": "relAppToBC"},
                {"sourceId": "new_app_1", "targetId": "new_itc_1", "relationType": "relNope"},
                {"sourceId": "ghost", "targetId": "new_app_1", "relationType": "relAppToBC"},
                {"sourceId": "new_app_1", "targetId": "new_itc_1", "relationType": "relAppToITC"},
            ],
        },
        "archOptions": [
            {"id": "opt_1", "title": "Buy", "approach": "buy", "summary": "Buy a tool"},
            {"id": "opt_2", "title": "Build", "summary": "Build it"},
            "junk",
        ],
        "selectedOptionId": "opt_1",
        "selectedRecommendations": [
            {"name": "ZoomInfo", "vendor": "ZI", "capability": "Lead Mgmt"},
            {"recommendation": "MuleSoft", "role": "dependency"},
            "junk",
        ],
    }
    assessment = TurboLensAssessment(
        title="T",
        requirement="Need lead scoring",
        session_data=session_data,
        status="saved",
        created_by=admin.id,
    )
    db.add(assessment)
    await db.flush()
    data = {
        "assessment_id": str(assessment.id),
        "initiative_name": "Lead scoring programme",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "selected_card_ids": ["new_app_1", "new_cap_1", "new_itc_1"],
        "selected_relation_indices": [0, 1, 2, 3, 4, 99],
        "objective_ids": [str(objective.id), str(not_objective.id), "junk"],
        "renamed_cards": {"new_app_1": "Lead Scorer Pro"},
        "user_id": str(admin.id),
    }
    return {
        "admin": admin,
        "objective": objective,
        "sales": sales,
        "postgres": postgres,
        "run": run,
        "assessment": assessment,
        "data": data,
    }


async def _cards(db) -> dict[str, Card]:
    return {c.name: c for c in (await db.execute(select(Card))).scalars()}


async def _relations(db) -> set[tuple[str, uuid.UUID, uuid.UUID]]:
    rows = (await db.execute(select(Relation))).scalars().all()
    return {(r.type, r.source_id, r.target_id) for r in rows}


class TestExecuteCommit:
    async def test_creates_the_initiative_cards_relations_and_adr(self, db, env):
        out = await execute_commit(db, str(env["run"].id), env["data"])
        cards = await _cards(db)
        initiative = cards["Lead scoring programme"]
        assert out == {
            "initiative_id": str(initiative.id),
            "initiative_name": "Lead scoring programme",
            "card_count": 3,
            "relation_count": 3,
            "adr_id": out["adr_id"],
            "adr_reference": out["adr_reference"],
        }

        assert initiative.type == "Initiative" and initiative.subtype == "project"
        assert initiative.attributes == {"startDate": "2026-01-01", "endDate": "2026-12-31"}
        assert initiative.created_by == env["admin"].id and initiative.approval_status == "DRAFT"
        assert initiative.description == (
            "Impact summary\n\nApproach: Buy a tool\n\nKey components: ZoomInfo (ZI)."
        )

        app, cap, itc = cards["Lead Scorer Pro"], cards["Lead Mgmt"], cards["Scoring DB"]
        assert "Not selected" not in cards
        assert app.type == "Application" and app.subtype == "saas" and app.description == ""
        assert app.lifecycle == {"phaseIn": "2026-01-01", "active": "2026-12-31"}
        assert cap.type == "BusinessCapability" and itc.type == "ITComponent"

        rels = await _relations(db)
        assert ("relInitiativeToObjective", initiative.id, env["objective"].id) in rels
        assert not any(t == env["sales"].id and k == "relInitiativeToObjective" for k, _, t in rels)
        assert ("relInitiativeToApp", initiative.id, app.id) in rels
        assert ("relInitiativeToBC", initiative.id, cap.id) in rels
        assert not any(
            t == itc.id and s == initiative.id for _, s, t in rels
        )  # no relInitiativeToITC
        assert ("relAppToBC", app.id, cap.id) in rels
        assert ("relAppToITC", app.id, env["postgres"].id) in rels
        assert ("relAppToBC", app.id, env["sales"].id) in rels  # re-oriented
        assert not any(k == "relNope" for k, _, _ in rels)
        assert ("relAppToITC", app.id, itc.id) not in rels  # index 5 was not selected
        assert len(rels) == 6

        adr = (await db.execute(select(ArchitectureDecision))).scalar_one()
        assert str(adr.id) == out["adr_id"] and adr.reference_number == out["adr_reference"]
        assert (
            adr.title == "Architecture Decision: Lead scoring programme" and adr.status == "draft"
        )
        assert adr.context == "Impact summary\n\nBusiness Requirement: Need lead scoring"
        assert adr.decision == (
            "Selected approach: Buy (buy)\nBuy a tool\n\nSelected products/recommendations:\n"
            "- ZoomInfo (ZI) for Lead Mgmt\n- MuleSoft (N/A) [dependency]"
        )
        assert adr.alternatives_considered == "- Build: Build it"
        assert adr.consequences == (
            "New cards introduced: 3\nNew relations created: 5\nNew capability: missing today"
        )
        assert adr.related_decisions == [{"type": "assessment", "id": str(env["assessment"].id)}]
        assert adr.created_by == env["admin"].id
        linked = (
            await db.execute(
                select(ArchitectureDecisionCard.card_id).where(
                    ArchitectureDecisionCard.architecture_decision_id == adr.id
                )
            )
        ).scalars()
        assert set(linked) == {initiative.id, app.id, cap.id, itc.id}

        assessment = env["assessment"]
        assert assessment.status == "committed" and assessment.initiative_id == initiative.id
        assert env["run"].results == {
            "progress": {
                "step": "creating_adr",
                "current": 6,
                "total": 6,
                "initiative_id": str(initiative.id),
            }
        }

    async def test_descriptions_come_from_the_ai_when_it_is_configured(self, db, env, monkeypatch):
        await ai_settings(db)
        suggest = AsyncMock(return_value={"suggestions": {"description": {"value": "Generated"}}})
        monkeypatch.setattr("app.services.ai_service.suggest_metadata", suggest)
        await execute_commit(db, str(env["run"].id), env["data"])
        cards = await _cards(db)
        assert cards["Lead Scorer Pro"].description == "Generated"
        assert suggest.await_count == 3
        kwargs = suggest.await_args_list[0].kwargs
        assert kwargs["name"] == "Lead Scorer Pro" and kwargs["type_key"] == "Application"
        assert kwargs["type_label"] == "Application" and kwargs["subtype"] == "saas"
        assert kwargs["provider_type"] == "openai" and kwargs["api_key"] == "sk-test"
        assert kwargs["provider_url"] == "https://llm.test" and kwargs["model"] == "test-model"

    async def test_a_minimal_assessment(self, db, env):
        env["assessment"].session_data = {"requirement": "Just this"}
        data = {
            **env["data"],
            "selected_card_ids": [],
            "selected_relation_indices": [],
            "objective_ids": [],
            "renamed_cards": {},
        }
        out = await execute_commit(db, str(env["run"].id), data)
        assert out["card_count"] == 0 and out["relation_count"] == 0
        initiative = (await _cards(db))["Lead scoring programme"]
        assert initiative.description == "Business requirement: Just this"
        adr = (await db.execute(select(ArchitectureDecision))).scalar_one()
        assert adr.context == "Business Requirement: Just this"
        assert (
            adr.decision is None
            and adr.consequences is None
            and adr.alternatives_considered is None
        )
        assert env["run"].results["progress"] == {
            "step": "creating_adr",
            "current": 3,
            "total": 3,
            "initiative_id": str(initiative.id),
        }

    async def test_an_unset_id_or_relation_end_is_skipped_not_fatal(self, db, env):
        # The mapping is model output: a proposed card can come back with no
        # id (or an empty one) and a relation with an end left unset. Neither
        # may fail the commit, and an unset end must never resolve to a card
        # whose id happens to be empty.
        stray = await create_card(db, card_type="ITComponent", name="Stray")
        session = env["assessment"].session_data
        mapping = session["capabilityMapping"]
        stray_ref = {"cardTypeKey": "ITComponent", "isNew": False, "existingCardId": str(stray.id)}
        env["assessment"].session_data = {
            **session,
            "capabilityMapping": {
                **mapping,
                "capabilities": [
                    *mapping["capabilities"],
                    {"id": "", "existingCardId": str(stray.id), "isNew": False},
                ],
                "proposedCards": [
                    *mapping["proposedCards"],
                    {"name": "No id", "cardTypeKey": "Application", "isNew": True},
                    {**stray_ref, "id": "", "name": "Stray"},
                    {**stray_ref, "name": "Stray again"},
                ],
                "proposedRelations": [
                    *mapping["proposedRelations"],
                    {"sourceId": "new_app_1", "targetId": "", "relationType": "relAppToITC"},
                    {"sourceId": "new_app_1", "relationType": "relAppToITC"},
                ],
            },
        }
        last = len(mapping["proposedRelations"])
        data = {
            **env["data"],
            "selected_relation_indices": [
                *env["data"]["selected_relation_indices"],
                last,
                last + 1,
            ],
        }
        out = await execute_commit(db, str(env["run"].id), data)
        assert out["card_count"] == 3 and out["relation_count"] == 3
        assert "No id" not in await _cards(db)
        assert not any(stray.id in (s, t) for _, s, t in await _relations(db))

    async def test_a_missing_assessment_is_an_error(self, db, env):
        data = {**env["data"], "assessment_id": str(uuid.uuid4())}
        with pytest.raises(ValueError, match="Assessment not found"):
            await execute_commit(db, str(env["run"].id), data)

    async def test_progress_is_skipped_for_an_unknown_run(self, db, env):
        out = await execute_commit(db, str(uuid.uuid4()), env["data"])
        assert out["card_count"] == 3 and env["run"].results is None


class TestGenerateDescription:
    async def test_without_ai_settings_it_is_none(self, db):
        assert await _generate_description(db, "X", "Application", None) is None

    async def test_disabled_or_incomplete_settings_are_none(self, db):
        await ai_settings(db, enabled=False)
        assert await _generate_description(db, "X", "Application", None) is None
        await ai_settings(db, provider_url="")
        assert await _generate_description(db, "X", "Application", None) is None
        await ai_settings(db, model="")
        assert await _generate_description(db, "X", "Application", None) is None

    async def test_the_type_label_and_schema_are_passed(self, db, monkeypatch):
        await ai_settings(db, provider_type="ollama", api_key=None)
        await create_card_type(
            db,
            key="Application",
            label="Business App",
            fields_schema=[{"section": "S", "fields": []}],
        )
        suggest = AsyncMock(return_value={"suggestions": {"description": {"value": "D"}}})
        monkeypatch.setattr("app.services.ai_service.suggest_metadata", suggest)
        assert await _generate_description(db, "X", "Application", "saas") == "D"
        kwargs = suggest.await_args.kwargs
        assert kwargs["type_label"] == "Business App" and kwargs["api_key"] == ""
        assert kwargs["fields_schema"] == [{"section": "S", "fields": []}]
        # An unknown type falls back to its key and an empty schema.
        assert await _generate_description(db, "X", "Nope", None) == "D"
        assert suggest.await_args.kwargs["type_label"] == "Nope"
        assert suggest.await_args.kwargs["fields_schema"] == []

    async def test_a_suggestion_of_the_wrong_shape_or_a_failure_is_none(self, db, monkeypatch):
        await ai_settings(db)
        monkeypatch.setattr(
            "app.services.ai_service.suggest_metadata",
            AsyncMock(return_value={"suggestions": {"description": "plain"}}),
        )
        assert await _generate_description(db, "X", "Application", None) is None
        monkeypatch.setattr(
            "app.services.ai_service.suggest_metadata", AsyncMock(side_effect=RuntimeError("down"))
        )
        assert await _generate_description(db, "X", "Application", None) is None


class TestBuildInitiativeDescription:
    def test_pieces(self):
        assert _build_initiative_description({}) == ""
        assert _build_initiative_description({"requirement": "R"}) == "Business requirement: R"
        assert (
            _build_initiative_description(
                {"capabilityMapping": {"summary": "S"}, "requirement": "R"}
            )
            == "S"
        )
        full = _build_initiative_description(
            {
                "capabilityMapping": {"summary": "S"},
                "archOptions": [{"id": "a", "summary": "A"}, {"id": "b", "summary": "B"}, "junk"],
                "selectedOptionId": "b",
                "selectedRecommendations": [
                    {"name": "X", "vendor": "V"},
                    {"name": "Y"},
                    {"vendor": "only"},
                    "junk",
                ],
            }
        )
        assert full == "S\n\nApproach: B\n\nKey components: X (V), Y."

    def test_an_option_without_a_summary_adds_nothing(self):
        text = _build_initiative_description(
            {"archOptions": [{"id": "a"}], "selectedOptionId": "a", "requirement": "R"}
        )
        assert text == "Business requirement: R"
