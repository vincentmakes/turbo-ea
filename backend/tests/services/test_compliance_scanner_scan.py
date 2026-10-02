"""``run_compliance_scan`` and the loaders behind it, on the test database
with ``call_ai`` scripted (``fake_call_ai``): the scan targets, the
enabled regulations, one regulation's assessment (configured, not
configured, failing), the AI detector's LLM pass, the finding upsert
across re-runs, the progress mirror and the completion notification."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.compliance_regulation import ComplianceRegulation
from app.models.notification import Notification
from app.models.turbolens import TurboLensComplianceFinding
from app.services import compliance_scanner
from app.services.compliance_scanner import (
    AI_DETECTION_BATCH_SIZE,
    EU_AI_ACT_KEY,
    ScanCard,
    _extract_lifecycle_phase,
    _write_progress,
    assess_regulation,
    detect_ai_bearing_cards,
    load_enabled_regulations,
    load_regulation_meta,
    load_reviewer_names,
    load_risk_references,
    load_scan_targets,
    run_compliance_scan,
)
from tests.conftest import (
    create_analysis_run,
    create_card,
    create_card_type,
    create_compliance_finding,
    create_risk,
    create_role,
    create_user,
)
from tests.seams import ai_settings


def _scan_card(**overrides) -> ScanCard:
    base = {
        "id": str(uuid.uuid4()),
        "name": "Card",
        "type": "Application",
        "subtype": None,
        "description": "",
        "vendor": "",
        "product": "",
        "version": None,
        "business_criticality": None,
        "lifecycle_phase": None,
        "attributes": {},
    }
    base.update(overrides)
    return ScanCard(**base)


@pytest.fixture
async def landscape(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@scan.test", role="admin")
    for key in ("Application", "ITComponent", "Provider"):
        await create_card_type(db, key=key, label=key)
    copilot = await create_card(
        db,
        card_type="Application",
        name="Copilot",
        subtype="AI Agent",
        attributes={
            "vendor": " Microsoft ",
            "productName": "GitHub Copilot",
            "version": "2",
            "businessCriticality": "high",
        },
        lifecycle=[{"phase": "plan"}, {"phase": "active"}],
        description="x" * 600,
    )
    erp = await create_card(
        db,
        card_type="Application",
        name="ERP",
        attributes={"product": "S/4", "version": " "},
        lifecycle={"phase": "plan"},
    )
    postgres = await create_card(db, card_type="ITComponent", name="Postgres")
    await create_card(db, card_type="Application", name="Old", status="ARCHIVED")
    await create_card(db, card_type="Provider", name="SAP")
    db.add_all(
        [
            ComplianceRegulation(
                key="gdpr",
                label="GDPR",
                description="Check privacy.",
                is_enabled=True,
                sort_order=2,
            ),
            ComplianceRegulation(
                key=EU_AI_ACT_KEY, label="EU AI Act", is_enabled=True, sort_order=1
            ),
            ComplianceRegulation(key="dora", label="DORA", is_enabled=False, sort_order=3),
        ]
    )
    await db.flush()
    return {"admin": admin, "copilot": copilot, "erp": erp, "postgres": postgres}


async def _findings(db) -> list[TurboLensComplianceFinding]:
    return list((await db.execute(select(TurboLensComplianceFinding))).scalars().all())


# ── Loaders ───────────────────────────────────────────────────────────────


class TestLoadScanTargets:
    async def test_projects_active_applications_and_components(self, db, landscape):
        cards = {c.name: c for c in await load_scan_targets(db)}
        assert set(cards) == {"Copilot", "ERP", "Postgres"}
        copilot = cards["Copilot"]
        assert copilot.id == str(landscape["copilot"].id) and copilot.subtype == "AI Agent"
        assert (copilot.vendor, copilot.product, copilot.version) == (
            "Microsoft",
            "GitHub Copilot",
            "2",
        )
        assert copilot.business_criticality == "high" and copilot.lifecycle_phase == "active"
        assert len(copilot.description) == 500
        erp = cards["ERP"]
        assert erp.product == "S/4" and erp.version is None and erp.lifecycle_phase == "plan"
        postgres = cards["Postgres"]
        assert postgres.product == "Postgres" and postgres.vendor == ""
        assert postgres.lifecycle_phase is None and postgres.type == "ITComponent"

    async def test_components_can_be_left_out(self, db, landscape):
        assert {c.name for c in await load_scan_targets(db, include_itc=False)} == {
            "Copilot",
            "ERP",
        }

    def test_lifecycle_phase_shapes(self):
        assert _extract_lifecycle_phase([{"phase": "a"}, {"phase": "b"}]) == "b"
        assert _extract_lifecycle_phase({"phase": "plan"}) == "plan"
        assert _extract_lifecycle_phase([]) is None
        assert _extract_lifecycle_phase(["not a dict"]) is None
        assert _extract_lifecycle_phase({"no": "phase"}) is None
        assert _extract_lifecycle_phase("active") is None


class TestRegulationLoaders:
    async def test_enabled_in_catalogue_order_intersected_with_keys(self, db, landscape):
        assert [r.key for r in await load_enabled_regulations(db)] == [EU_AI_ACT_KEY, "gdpr"]
        assert [r.key for r in await load_enabled_regulations(db, keys=["gdpr", "nope"])] == [
            "gdpr"
        ]
        assert await load_enabled_regulations(db, keys=["dora"]) == []

    async def test_meta_covers_disabled_regulations(self, db, landscape):
        meta = await load_regulation_meta(db)
        assert list(meta) == [EU_AI_ACT_KEY, "gdpr", "dora"]
        assert meta["dora"] == {"label": "DORA", "is_enabled": False}

    async def test_risk_and_reviewer_lookups(self, db, landscape):
        assert await load_risk_references(db, set()) == {}
        assert await load_reviewer_names(db, set()) == {}
        risk = await create_risk(db, title="R", reference="R-000007")
        nameless = await create_user(db, email="nameless@scan.test", role="admin", display_name="")
        assert await load_risk_references(db, {risk.id, uuid.uuid4()}) == {str(risk.id): "R-000007"}
        assert await load_reviewer_names(db, {landscape["admin"].id, nameless.id}) == {
            str(landscape["admin"].id): "Test User",
            str(nameless.id): "nameless@scan.test",
        }


# ── Progress ──────────────────────────────────────────────────────────────


class TestProgress:
    async def test_mirrors_into_the_run_or_does_nothing(self, db):
        await _write_progress(db, uuid.uuid4(), "x", 1, 2)  # no run: no error
        run = await create_analysis_run(db, status="running")
        await _write_progress(db, run.id, "regulation", 1, 2, "gdpr")
        progress = run.results["progress"]
        assert progress["updated_at"]
        del progress["updated_at"]
        assert progress == {"phase": "regulation", "current": 1, "total": 2, "note": "gdpr"}


# ── AI detection (LLM pass) ───────────────────────────────────────────────


class TestDetectAiBearingCards:
    async def test_nothing_to_classify(self, db):
        assert await detect_ai_bearing_cards(db, []) == {}

    async def test_the_model_adds_embedded_cases_without_downgrading_subtypes(
        self, db, fake_call_ai
    ):
        await ai_settings(db)
        agent = _scan_card(name="Copilot", subtype="AI Agent")
        erp = _scan_card(name="ERP", description="an AI-powered forecast")
        refused = _scan_card(name="Nope", subtype="AI Model", attributes={"hasAiFeatures": False})
        invented = str(uuid.uuid4())
        fake_call_ai.queue(
            [
                {"id": erp.id, "ai_role": "embedded", "confidence": 0.7, "signal": "desc"},
                {"id": agent.id, "ai_role": "consumer", "confidence": 0.1},
                {"id": refused.id, "ai_role": "provider"},  # the user's "no" is final
                {"id": invented, "ai_role": "provider"},  # a card that does not exist
                {"no": "id"},
                "junk",
            ]
        )
        calls: list[tuple] = []

        async def progress(phase, current, total, note=""):
            calls.append((phase, current, total, note))

        scope = await detect_ai_bearing_cards(db, [agent, erp, refused], progress_cb=progress)
        assert scope[agent.id] == {"role": "provider", "confidence": 1.0, "subtype_match": True}
        assert scope[erp.id] == {
            "role": "embedded",
            "confidence": 0.7,
            "subtype_match": False,
            "signal": "desc",
        }
        # Neither was asked about, so neither answer counts: the user's "no"
        # stays final, and an invented id never reaches the register (its EU
        # AI Act fallback finding would have failed the scan on the FK).
        assert refused.id not in scope and invented not in scope
        assert calls == [("ai_detection", 1, 1, "")]
        prompt, max_tokens, system = fake_call_ai.calls[0]
        assert max_tokens == 4000 and "Return only valid JSON" in system
        assert erp.id in prompt and refused.id not in prompt  # refused cards are not asked about

    async def test_a_missing_confidence_defaults_and_bad_answers_are_skipped(
        self, db, fake_call_ai
    ):
        await ai_settings(db)
        a, b = _scan_card(name="A"), _scan_card(name="B")
        fake_call_ai.queue([{"id": a.id}])
        scope = await detect_ai_bearing_cards(db, [a, b])
        assert scope[a.id]["confidence"] == 0.6 and b.id not in scope

        fake_call_ai.queue({"not": "a list"})
        assert await detect_ai_bearing_cards(db, [a, b]) == {}

        fake_call_ai.route(raises=RuntimeError("down"))
        agent = _scan_card(subtype="MCP Server")
        assert list(await detect_ai_bearing_cards(db, [a, agent])) == [agent.id]

    async def test_batches_of_thirty(self, db, fake_call_ai):
        await ai_settings(db)
        cards = [_scan_card(name=f"C{i}") for i in range(AI_DETECTION_BATCH_SIZE + 1)]
        fake_call_ai.default = "[]"
        calls: list[tuple] = []

        async def progress(phase, current, total, note=""):
            calls.append((phase, current, total))

        await detect_ai_bearing_cards(db, cards, progress_cb=progress)
        assert calls == [("ai_detection", 1, 2), ("ai_detection", 2, 2)]
        assert len(fake_call_ai.calls) == 2
        assert cards[-1].id in fake_call_ai.calls[1][0]
        assert cards[-1].id not in fake_call_ai.calls[0][0]


# ── One regulation ────────────────────────────────────────────────────────


class TestAssessRegulation:
    async def test_without_ai_the_only_finding_says_so(self, db, landscape, fake_call_ai):
        reg = (
            await db.execute(select(ComplianceRegulation).where(ComplianceRegulation.key == "gdpr"))
        ).scalar_one()
        (finding,) = await assess_regulation(db, reg, [], {})
        assert finding["regulation"] == "gdpr" and finding["category"] == "configuration"
        assert "AI is not configured" in finding["gap_description"]
        assert finding["status"] == "review_needed" and finding["ai_detected"] is False
        assert fake_call_ai.calls == []

    async def test_the_prompt_and_the_normalised_findings(self, db, landscape, fake_call_ai):
        await ai_settings(db)
        reg = (
            await db.execute(select(ComplianceRegulation).where(ComplianceRegulation.key == "gdpr"))
        ).scalar_one()
        cards = await load_scan_targets(db)
        copilot = next(c for c in cards if c.name == "Copilot")
        fake_call_ai.queue(
            [
                {
                    "regulation_article": "Art. 35",
                    "card_id": copilot.id,
                    "scope_type": "card",
                    "category": "p" * 80,
                    "requirement": "DPIA",
                    "status": "non_compliant",
                    "severity": "high",
                    "gap_description": "none",
                    "evidence": "",
                    "remediation": "do it",
                },
                # an id the landscape does not carry: the finding is kept, unbound
                {"card_id": str(uuid.uuid4()), "scope_type": "card", "requirement": "r2"},
                {"card_id": "zzz", "scope_type": "bogus", "requirement": "r3"},
                "junk",
            ]
        )
        out = await assess_regulation(db, reg, cards, {copilot.id: {"role": "provider"}})
        assert [f["requirement"] for f in out] == ["DPIA", "r2", "r3"]
        first = out[0]
        assert first["card_id"] == uuid.UUID(copilot.id) and first["scope_type"] == "card"
        assert len(first["category"]) == 64 and first["evidence"] is None
        assert first["ai_detected"] is False  # only the EU AI Act marks AI-bearing cards
        assert out[1]["card_id"] is None and out[1]["scope_type"] == "card"
        assert out[2]["card_id"] is None and out[2]["scope_type"] == "landscape"
        assert out[2]["status"] == "review_needed" and out[2]["severity"] == "info"

        prompt, max_tokens, system = fake_call_ai.calls[0]
        assert max_tokens == 3000 and "compliance auditor" in system
        assert prompt.startswith("Regulation: GDPR.\nCheck privacy.\n")
        assert '"ai_bearing_cards": [{"id": "' + copilot.id in prompt
        assert '"sample_cards"' in prompt and '"name": "Postgres"' in prompt

    async def test_eu_ai_act_guarantees_a_finding_per_ai_card(self, db, landscape, fake_call_ai):
        await ai_settings(db)
        reg = (
            await db.execute(
                select(ComplianceRegulation).where(ComplianceRegulation.key == EU_AI_ACT_KEY)
            )
        ).scalar_one()
        cards = await load_scan_targets(db)
        copilot = next(c for c in cards if c.name == "Copilot")
        erp = next(c for c in cards if c.name == "ERP")
        fake_call_ai.queue([{"card_id": erp.id, "requirement": "Classify", "status": "partial"}])
        scope = {copilot.id: {"role": "provider"}, erp.id: {"role": "embedded"}, "nope": {}}
        out = await assess_regulation(db, reg, cards, scope)
        by_card = {str(f["card_id"]): f for f in out}
        assert set(by_card) == {erp.id, copilot.id}
        assert by_card[erp.id]["ai_detected"] is True and by_card[erp.id]["status"] == "partial"
        fallback = by_card[copilot.id]
        assert fallback["category"] == "applicability" and fallback["ai_detected"] is True
        assert "EU AI Act applies to Copilot" in fallback["requirement"]
        prompt = fake_call_ai.calls[0][0]
        assert "Assess landscape compliance with this regulation." in prompt  # default directive

    async def test_a_failed_or_malformed_pass_yields_nothing(self, db, landscape, fake_call_ai):
        await ai_settings(db)
        reg = (
            await db.execute(select(ComplianceRegulation).where(ComplianceRegulation.key == "gdpr"))
        ).scalar_one()
        fake_call_ai.queue({"not": "a list"})
        assert await assess_regulation(db, reg, [], {}) == []
        fake_call_ai.route(raises=RuntimeError("down"))
        assert await assess_regulation(db, reg, [], {}) == []


# ── The whole scan ────────────────────────────────────────────────────────


def _script(fake_call_ai, copilot_id: str, erp_id: str, *, gdpr_card: bool = True):
    fake_call_ai.route(contains="Classify each card", text=[{"id": erp_id, "ai_role": "embedded"}])
    fake_call_ai.route(
        contains="Regulation: EU AI Act.",
        text=[{"card_id": copilot_id, "requirement": "Tier", "regulation_article": "Art. 6"}],
    )
    gdpr = [{"requirement": "Register of processing", "status": "non_compliant"}]
    if gdpr_card:
        gdpr.append({"card_id": erp_id, "requirement": "DPIA", "regulation_article": "Art. 35"})
    fake_call_ai.route(contains="Regulation: GDPR.", text=gdpr)


class TestRunComplianceScan:
    async def test_an_unmatched_filter_is_a_skipped_run(self, db, landscape, fake_call_ai):
        run = await create_analysis_run(db, status="running")
        out = await run_compliance_scan(db, str(run.id), None, regulations=["nope"])
        assert out["skipped_reason"] == "no_matching_enabled_regulations"
        assert out["regulations_requested"] == ["nope"] and out["compliance_findings"] == 0
        assert run.results == out and fake_call_ai.calls == []

    async def test_a_first_scan_lands_every_finding_as_new(self, db, landscape, fake_call_ai):
        await ai_settings(db)
        admin, copilot, erp = landscape["admin"], landscape["copilot"], landscape["erp"]
        _script(fake_call_ai, str(copilot.id), str(erp.id))
        run = await create_analysis_run(db, status="running", user_id=admin.id)

        out = await run_compliance_scan(db, run.id, admin.id)
        assert out == {
            "scan": "compliance",
            "compliance_findings": 4,
            "regulations": [EU_AI_ACT_KEY, "gdpr"],
            "cards_scanned": 3,
            "ai_bearing_cards": 2,
            "completed_at": out["completed_at"],
        }
        assert run.results == out
        rows = {(r.regulation, r.requirement): r for r in await _findings(db)}
        assert set(rows) == {
            (EU_AI_ACT_KEY, "Tier"),
            (
                EU_AI_ACT_KEY,
                "EU AI Act applies to ERP — classify risk tier (prohibited / high /"
                " limited / minimal) and document the applicable obligations.",
            ),
            ("gdpr", "Register of processing"),
            ("gdpr", "DPIA"),
        }
        tier = rows[(EU_AI_ACT_KEY, "Tier")]
        assert tier.card_id == copilot.id and tier.ai_detected is True
        assert tier.decision == "new" and tier.last_seen_run_id == run.id
        assert tier.run_id == run.id and tier.auto_resolved is False and tier.finding_key
        dpia = rows[("gdpr", "DPIA")]
        assert dpia.card_id == erp.id and dpia.ai_detected is False
        assert rows[("gdpr", "Register of processing")].scope_type == "landscape"

        note = (
            await db.execute(
                select(Notification).where(
                    Notification.user_id == admin.id,
                    Notification.type == "security_scan_complete",
                )
            )
        ).scalar_one()
        assert "4 compliance finding(s) across 2 regulation(s)." == note.message
        assert note.data["regulations"] == [EU_AI_ACT_KEY, "gdpr"]
        # The three regulation passes plus the AI-detection pass.
        assert len(fake_call_ai.calls) == 3

    async def test_a_rescan_keeps_decisions_and_is_additive(self, db, landscape, fake_call_ai):
        await ai_settings(db)
        admin, copilot, erp = landscape["admin"], landscape["copilot"], landscape["erp"]
        _script(fake_call_ai, str(copilot.id), str(erp.id))
        first = await create_analysis_run(db, status="running")
        await run_compliance_scan(db, first.id, None)
        rows = {(r.regulation, r.requirement): r for r in await _findings(db)}
        dpia, register = rows[("gdpr", "DPIA")], rows[("gdpr", "Register of processing")]
        dpia.decision, dpia.review_note = "verified", "checked"
        register.auto_resolved = True
        untouched = await create_compliance_finding(db, first.id, regulation="dora")
        untouched.auto_resolved = True
        await db.flush()

        fake_call_ai._routes.clear()
        _script(fake_call_ai, str(copilot.id), str(erp.id), gdpr_card=False)
        second = await create_analysis_run(db, status="running")
        out = await run_compliance_scan(db, second.id, None)
        assert out["compliance_findings"] == 3

        after = {(r.regulation, r.requirement): r for r in await _findings(db)}
        assert len(after) == 5  # nothing duplicated, nothing deleted
        assert (dpia.decision, dpia.review_note) == ("verified", "checked")
        # Not re-emitted this run: still visible, and the run bookkeeping stays.
        assert dpia.auto_resolved is False and dpia.last_seen_run_id == first.id
        # Re-emitted: bookkeeping moves, the stale flag clears.
        assert register.last_seen_run_id == second.id and register.run_id == second.id
        assert register.auto_resolved is False
        # A regulation outside this scan is left alone.
        assert untouched.auto_resolved is True
        assert (
            await db.execute(select(Notification).where(Notification.user_id == admin.id))
        ).scalars().all() == []

    async def test_a_failing_notification_does_not_fail_the_scan(
        self, db, landscape, fake_call_ai, monkeypatch
    ):
        fake_call_ai.default = "[]"
        admin = landscape["admin"]

        async def boom(*_a, **_k):
            raise RuntimeError("smtp down")

        monkeypatch.setattr(compliance_scanner.notification_service, "create_notification", boom)
        run = await create_analysis_run(db, status="running")
        out = await run_compliance_scan(db, run.id, str(admin.id), regulations=["gdpr"])
        assert out["regulations"] == ["gdpr"] and out["compliance_findings"] == 1
        # Unconfigured AI: the one finding is the "configure AI" placeholder.
        (row,) = await _findings(db)
        assert row.category == "configuration" and fake_call_ai.calls == []
