"""Unit + DB tests for the demo Compliance seeder.

Pure-Python tests check that the curated compliance data structure
references valid regulations, valid lifecycle states, and only targets
cards that actually exist in the NexaTech base demo set — guarding
against the most common bug (renaming a card in ``seed_demo.py`` without
updating ``seed_demo_security.py``).

A small DB-backed test rounds out the suite: it inserts the demo cards the
seeder targets, runs the seeder twice, asserts the row counts and the
idempotency skip.
"""

from __future__ import annotations

import pytest

from app.services.compliance_scanner import COMPLIANCE_LIFECYCLE_STATES
from app.services.seed_demo import APPLICATIONS, IT_COMPONENTS
from app.services.seed_demo_security import (
    COMPLIANCE_FINDINGS,
    seed_security_demo_data,
)
from tests.conftest import create_card

# Built-in regulation keys registered by ``seed_metamodel`` (see seed.py).
_BUILTIN_REGULATIONS = frozenset({"eu_ai_act", "gdpr", "nis2", "dora", "soc2", "iso27001"})


# ---------------------------------------------------------------------------
# Card-name compatibility — no DB required
# ---------------------------------------------------------------------------


def _demo_card_names() -> set[str]:
    """Names of every Application + IT Component in ``seed_demo.py``."""
    return {a["name"] for a in APPLICATIONS} | {c["name"] for c in IT_COMPONENTS}


def test_every_compliance_card_name_exists_in_demo_set() -> None:
    demo = _demo_card_names()
    referenced = {f["card_name"] for f in COMPLIANCE_FINDINGS if f.get("card_name")}
    missing = referenced - demo
    assert not missing, (
        f"COMPLIANCE_FINDINGS references card names that don't exist in seed_demo.py "
        f"Applications/ITComponents: {sorted(missing)}"
    )


# ---------------------------------------------------------------------------
# Regulation + lifecycle validity — no DB required
# ---------------------------------------------------------------------------


def test_every_compliance_regulation_is_built_in() -> None:
    used = {f["regulation"] for f in COMPLIANCE_FINDINGS}
    unknown = used - _BUILTIN_REGULATIONS
    assert not unknown, (
        f"COMPLIANCE_FINDINGS uses regulation keys not registered by "
        f"seed_metamodel(): {sorted(unknown)}"
    )


def test_every_compliance_decision_is_valid() -> None:
    for f in COMPLIANCE_FINDINGS:
        decision = f.get("decision", "new")
        assert decision in COMPLIANCE_LIFECYCLE_STATES, (
            f"Compliance finding for {f.get('regulation')}/"
            f"{f.get('regulation_article')} has invalid decision "
            f"{decision!r}; must be one of {sorted(COMPLIANCE_LIFECYCLE_STATES)}"
        )


def test_required_fields_present_on_every_compliance_finding() -> None:
    required = {"regulation", "regulation_article", "requirement", "gap_description"}
    for f in COMPLIANCE_FINDINGS:
        missing = required - set(f.keys())
        assert not missing, (
            f"Compliance finding {f.get('regulation')}/{f.get('regulation_article')} "
            f"missing fields: {sorted(missing)}"
        )


# ---------------------------------------------------------------------------
# DB-backed integration: seed + idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_inserts_findings_and_is_idempotent(db) -> None:
    """Insert the cards the seeder targets, then run the seeder twice."""
    from sqlalchemy import select

    from app.models.turbolens import (
        TurboLensAnalysisRun,
        TurboLensComplianceFinding,
    )

    # Seed exactly the cards referenced in the compliance demo so the seeder
    # has somewhere to land its rows.
    referenced = {f["card_name"] for f in COMPLIANCE_FINDINGS if f.get("card_name")}
    apps = {a["name"] for a in APPLICATIONS}
    for name in referenced:
        card_type = "Application" if name in apps else "ITComponent"
        await create_card(db, card_type=card_type, name=name)
    await db.commit()

    # ---- first run: should insert everything ------------------------
    result = await seed_security_demo_data(db)
    assert result.get("skipped") is not True
    assert result["compliance_findings"] == len(COMPLIANCE_FINDINGS)
    assert result["analysis_runs"] == 1

    comp_rows = (await db.execute(select(TurboLensComplianceFinding))).scalars().all()
    run_rows = (await db.execute(select(TurboLensAnalysisRun))).scalars().all()
    assert len(comp_rows) == len(COMPLIANCE_FINDINGS)
    assert len(run_rows) == 1
    for r in run_rows:
        assert isinstance(r.results, dict) and r.results.get("demo") is True

    # ---- second run: should be a no-op -------------------------------
    # The skip is now decided by the durable `demoSeeded` marker (see
    # seed_markers.py) rather than by inferring it from the findings still being
    # present — that inference is exactly what let deleted demo content come
    # back on every restart (discussion #905). Assert the behaviour, not which
    # of the two guards happened to fire.
    result2 = await seed_security_demo_data(db)
    assert result2["skipped"] is True

    comp_rows2 = (await db.execute(select(TurboLensComplianceFinding))).scalars().all()
    assert len(comp_rows2) == len(COMPLIANCE_FINDINGS)


@pytest.mark.asyncio
async def test_seed_skips_findings_for_missing_cards(db) -> None:
    """If a referenced card isn't in the DB, that finding is silently skipped."""
    from sqlalchemy import select

    from app.models.turbolens import TurboLensComplianceFinding

    # Don't insert any cards.
    result = await seed_security_demo_data(db)
    assert not result.get("skipped"), result

    # Landscape-scoped compliance findings (card_name=None) should still land;
    # card-scoped ones whose target is missing should be skipped.
    comp_rows = (await db.execute(select(TurboLensComplianceFinding))).scalars().all()
    landscape_count = sum(1 for f in COMPLIANCE_FINDINGS if f.get("card_name") is None)
    assert len(comp_rows) == landscape_count
