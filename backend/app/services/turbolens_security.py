"""TurboLens Security & Compliance scan orchestrator.

Runs in a background task triggered from
``POST /turbolens/security/scan``. Two pipelines:

1. **CVE scan** — for every non-archived Application / ITComponent card,
   query NVD for CVEs matching the vendor/product/version attributes,
   then call the configured LLM to prioritize each finding using
   business context (criticality, lifecycle, subtype).

2. **Compliance scan** — per regulation (EU AI Act, GDPR, NIS2, DORA,
   SOC 2, ISO 27001) call the LLM with a regulation-specific system
   prompt against a landscape summary. The EU AI Act check runs a
   semantic detection pass first so cards that embed AI but are not
   classified as ``AI Agent`` / ``AI Model`` are still evaluated.
"""

from __future__ import annotations

import json
import logging
import uuid as uuid_mod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.turbolens import (
    TurboLensAnalysisRun,
    TurboLensComplianceFinding,
    TurboLensCveFinding,
)
from app.services import notification_service
from app.services.turbolens_ai import (
    call_ai,
    get_ai_config,
    is_ai_configured,
    parse_json,
)
from app.services.turbolens_nvd import (
    CveRecord,
    derive_probability,
    patch_age_days,
    search_cves,
)

logger = logging.getLogger("turboea.turbolens.security")

SUPPORTED_REGULATIONS: tuple[str, ...] = (
    "eu_ai_act",
    "gdpr",
    "nis2",
    "dora",
    "soc2",
    "iso27001",
)

AI_SUBTYPES = {"AI Agent", "AI Model", "MCP Server"}
CVE_PER_CARD_LIMIT = 20
AI_BATCH_SIZE = 25
COMPLIANCE_BATCH_SIZE = 60


# A progress callback receives a ``phase`` label + a ``{current, total, note}``
# triple. It is invoked from inside the scan pipeline so the orchestrator can
# mirror the state into ``TurboLensAnalysisRun.results["progress"]``.
ProgressCallback = Callable[[str, int, int, str], Awaitable[None]]


async def _write_progress(
    db: AsyncSession,
    run_id: uuid_mod.UUID,
    phase: str,
    current: int,
    total: int,
    note: str = "",
) -> None:
    """Persist progress to the analysis run so polls can pick it up.

    We commit here so the UI sees progress updates without waiting for the
    scan to complete. Any findings added before this call are also flushed
    (incremental visibility is a feature).
    """
    run = await db.get(TurboLensAnalysisRun, run_id)
    if run is None:
        return
    run.results = {
        "progress": {
            "phase": phase,
            "current": current,
            "total": total,
            "note": note,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    }
    await db.commit()


def _progress_cb(db: AsyncSession, run_id: uuid_mod.UUID) -> ProgressCallback:
    async def _cb(phase: str, current: int, total: int, note: str = "") -> None:
        await _write_progress(db, run_id, phase, current, total, note)

    return _cb


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


@dataclass
class ScanCard:
    """Lightweight projection of a card for the scan pipeline."""

    id: str
    name: str
    type: str
    subtype: str | None
    description: str
    vendor: str
    product: str
    version: str | None
    business_criticality: str | None
    lifecycle_phase: str | None
    attributes: dict[str, Any] = field(default_factory=dict)


def _extract_lifecycle_phase(raw: Any) -> str | None:
    if isinstance(raw, list) and raw:
        last = raw[-1]
        if isinstance(last, dict):
            return last.get("phase")
    if isinstance(raw, dict):
        return raw.get("phase")
    return None


async def load_scan_targets(db: AsyncSession, include_itc: bool = True) -> list[ScanCard]:
    types = ["Application"] + (["ITComponent"] if include_itc else [])
    result = await db.execute(select(Card).where(Card.type.in_(types), Card.status != "ARCHIVED"))
    out: list[ScanCard] = []
    for card in result.scalars().all():
        attrs = card.attributes or {}
        vendor = (attrs.get("vendor") or "").strip()
        product = (attrs.get("productName") or attrs.get("product") or card.name or "").strip()
        version = (attrs.get("version") or "").strip() or None
        out.append(
            ScanCard(
                id=str(card.id),
                name=card.name,
                type=card.type,
                subtype=card.subtype,
                description=(card.description or "")[:500],
                vendor=vendor,
                product=product,
                version=version,
                business_criticality=attrs.get("businessCriticality"),
                lifecycle_phase=_extract_lifecycle_phase(card.lifecycle),
                attributes=attrs,
            )
        )
    return out


# ---------------------------------------------------------------------------
# CVE scan
# ---------------------------------------------------------------------------


def _dedupe_key(card_id: str, cve_id: str) -> tuple[str, str]:
    return (card_id, cve_id)


def _base_finding(card: ScanCard, rec: CveRecord) -> dict[str, Any]:
    """Build the DB-ready dict before AI enrichment."""
    age = patch_age_days(rec.published_date) if rec.patch_available else None
    probability = derive_probability(rec.exploitability_score, rec.attack_vector, age)
    priority = _priority_from_cvss_and_criticality(rec.cvss_score, card.business_criticality)
    return {
        "card_id": card.id,
        "card_type": card.type,
        "cve_id": rec.cve_id,
        "vendor": card.vendor,
        "product": card.product,
        "version": card.version,
        "cvss_score": rec.cvss_score,
        "cvss_vector": rec.cvss_vector,
        "severity": rec.severity,
        "attack_vector": rec.attack_vector,
        "exploitability_score": rec.exploitability_score,
        "impact_score": rec.impact_score,
        "patch_available": rec.patch_available,
        "published_date": rec.published_date,
        "last_modified_date": rec.last_modified_date,
        "description": rec.description,
        "nvd_references": rec.references[:10],
        "priority": priority,
        "probability": probability,
        "business_impact": None,
        "remediation": None,
    }


def _priority_from_cvss_and_criticality(cvss: float | None, criticality: str | None) -> str:
    """Heuristic priority used as a fallback before AI enrichment."""
    if cvss is None:
        return "medium"
    crit = (criticality or "").strip().lower()
    high_crit = crit in ("missioncritical", "mission_critical", "critical", "high")
    if cvss >= 9.0:
        return "critical"
    if cvss >= 7.0:
        return "critical" if high_crit else "high"
    if cvss >= 4.0:
        return "high" if high_crit else "medium"
    return "low"


async def _fetch_raw_cves(
    cards: list[ScanCard],
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Query NVD per card and return a list of base-finding dicts.

    De-duplicates by ``(card_id, cve_id)`` — NVD can return the same CVE
    several times across CPE variants.
    """
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    skipped: list[str] = []
    total = len(cards)

    for idx, card in enumerate(cards, 1):
        if progress_cb:
            await progress_cb("cve_nvd", idx, total, card.name)
        if not card.vendor and not card.product:
            skipped.append(card.id)
            continue
        try:
            records = await search_cves(
                card.vendor, card.product, card.version, max_results=CVE_PER_CARD_LIMIT
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "NVD lookup failed for %s (%s/%s): %s",
                card.name,
                card.vendor,
                card.product,
                exc,
            )
            continue
        for rec in records:
            key = _dedupe_key(card.id, rec.cve_id)
            if key in seen:
                continue
            seen.add(key)
            findings.append(_base_finding(card, rec))
    return findings, skipped


def _cvss_sort_key(f: dict[str, Any]) -> float:
    return float(f.get("cvss_score") or 0.0)


async def enrich_with_ai(
    db: AsyncSession,
    cards_by_id: dict[str, ScanCard],
    findings: list[dict[str, Any]],
    progress_cb: ProgressCallback | None = None,
) -> None:
    """Mutate findings in-place, filling ``business_impact``,
    ``remediation``, and refining ``priority`` / ``probability`` using
    the configured LLM. Silently leaves fallback values in place if AI
    is unavailable or a batch call fails.
    """
    ai_config = await get_ai_config(db)
    if not is_ai_configured(ai_config):
        logger.info("AI not configured — skipping CVE enrichment")
        return

    findings.sort(key=_cvss_sort_key, reverse=True)
    total_batches = max(1, (len(findings) + AI_BATCH_SIZE - 1) // AI_BATCH_SIZE)

    for start in range(0, len(findings), AI_BATCH_SIZE):
        batch_index = start // AI_BATCH_SIZE + 1
        if progress_cb:
            await progress_cb(
                "cve_ai_enrichment",
                batch_index,
                total_batches,
                f"{len(findings)} finding(s)",
            )
        batch = findings[start : start + AI_BATCH_SIZE]
        payload = []
        for f in batch:
            card = cards_by_id.get(f["card_id"])
            if not card:
                continue
            payload.append(
                {
                    "cve_id": f["cve_id"],
                    "cvss": f.get("cvss_score"),
                    "severity": f.get("severity"),
                    "attack_vector": f.get("attack_vector"),
                    "patch": f.get("patch_available"),
                    "description": (f.get("description") or "")[:600],
                    "card": {
                        "name": card.name,
                        "type": card.type,
                        "subtype": card.subtype,
                        "criticality": card.business_criticality,
                        "lifecycle": card.lifecycle_phase,
                        "product": card.product,
                        "vendor": card.vendor,
                    },
                }
            )

        prompt = (
            "You are a senior security architect. For each CVE below, "
            "using the attached card context, output JSON:\n"
            '[{"cve_id":"CVE-YYYY-NNNN","priority":"critical|high|medium|low",'
            '"probability":"very_high|high|medium|low",'
            '"business_impact":"<1-2 sentence impact statement referencing the card\'s role>",'
            '"remediation":"<single concrete next step>"}]\n\n'
            "Rules:\n"
            "- Raise priority when the card is mission-critical or in live "
            "operations; lower it for retired or unused systems.\n"
            "- Probability reflects exploitability in context (reachability, "
            "patch availability).\n"
            "- Keep business_impact grounded in the card — no generic text.\n"
            "- Remediation is one concrete action (e.g., upgrade to X, apply "
            "advisory Y, restrict network access).\n\n"
            f"CVEs:\n{json.dumps(payload)}"
        )
        try:
            result = await call_ai(
                db,
                prompt,
                max_tokens=3000,
                system_prompt=(
                    "You are a security analyst. Return only valid JSON — no "
                    "markdown, no commentary."
                ),
            )
            parsed = parse_json(result["text"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("CVE AI enrichment batch failed: %s", exc)
            continue

        if not isinstance(parsed, list):
            continue
        by_cve: dict[str, dict[str, Any]] = {}
        for item in parsed:
            if isinstance(item, dict) and item.get("cve_id"):
                by_cve[item["cve_id"]] = item

        for f in batch:
            enrich = by_cve.get(f["cve_id"])
            if not enrich:
                continue
            for key in ("priority", "probability", "business_impact", "remediation"):
                value = enrich.get(key)
                if value:
                    f[key] = value


# ---------------------------------------------------------------------------
# EU AI Act — semantic AI detection
# ---------------------------------------------------------------------------


async def detect_ai_bearing_cards(
    db: AsyncSession,
    cards: list[ScanCard],
    progress_cb: ProgressCallback | None = None,
) -> dict[str, dict[str, Any]]:
    """Return {card_id: {role, confidence, subtype_match}}.

    Uses an AI pass that looks at name / description / vendor / subtype
    — NOT just the card subtype. The caller treats ``subtype_match=False``
    results as "hidden AI" and flags them with ``ai_detected=True`` on
    compliance findings.
    """
    if not cards:
        return {}

    # Start with cards that are AI by subtype — they are always in scope.
    scoped: dict[str, dict[str, Any]] = {
        c.id: {"role": "provider", "confidence": 1.0, "subtype_match": True}
        for c in cards
        if c.subtype in AI_SUBTYPES
    }

    ai_config = await get_ai_config(db)
    if not is_ai_configured(ai_config):
        return scoped

    total_batches = max(1, (len(cards) + COMPLIANCE_BATCH_SIZE - 1) // COMPLIANCE_BATCH_SIZE)
    for start in range(0, len(cards), COMPLIANCE_BATCH_SIZE):
        batch_index = start // COMPLIANCE_BATCH_SIZE + 1
        if progress_cb:
            await progress_cb("ai_detection", batch_index, total_batches, "")
        batch = cards[start : start + COMPLIANCE_BATCH_SIZE]
        payload = [
            {
                "id": c.id,
                "name": c.name,
                "type": c.type,
                "subtype": c.subtype,
                "vendor": c.vendor,
                "product": c.product,
                "desc": c.description,
            }
            for c in batch
        ]
        prompt = (
            "Identify every card below that embeds, provides, or depends "
            "on AI / ML capabilities. Include subtle cases — LLMs, "
            "recommendation engines, computer vision, fraud / credit scoring, "
            "chatbots, predictive analytics, anomaly detection, and AI "
            "features hidden inside general-purpose software. Do NOT rely "
            "only on the card's subtype; inspect name, vendor and "
            "description for AI signals.\n\n"
            'Return ONLY JSON: [{"id":"<uuid>","ai_role":"provider|consumer|embedded",'
            '"confidence":0.0-1.0,"signal":"<what in the card hinted at AI>"}].\n'
            "Omit cards with no AI involvement.\n\n"
            f"Cards:\n{json.dumps(payload)}"
        )
        try:
            result = await call_ai(
                db,
                prompt,
                max_tokens=2400,
                system_prompt=(
                    "You are a governance analyst for the EU AI Act. Return only valid JSON."
                ),
            )
            parsed = parse_json(result["text"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("AI-bearing detection batch failed: %s", exc)
            continue
        if not isinstance(parsed, list):
            continue
        for item in parsed:
            if not isinstance(item, dict):
                continue
            card_id = item.get("id")
            if not card_id:
                continue
            # Never downgrade a subtype match.
            if card_id in scoped and scoped[card_id]["subtype_match"]:
                continue
            scoped[card_id] = {
                "role": item.get("ai_role", "embedded"),
                "confidence": float(item.get("confidence", 0.6) or 0.6),
                "subtype_match": False,
                "signal": item.get("signal", ""),
            }
    return scoped


# ---------------------------------------------------------------------------
# Compliance prompts
# ---------------------------------------------------------------------------


REGULATION_LABELS = {
    "eu_ai_act": "EU AI Act (Regulation (EU) 2024/1689)",
    "gdpr": "GDPR (Regulation (EU) 2016/679)",
    "nis2": "NIS2 Directive (Directive (EU) 2022/2555)",
    "dora": "DORA (Regulation (EU) 2022/2554)",
    "soc2": "SOC 2 (Trust Services Criteria)",
    "iso27001": "ISO/IEC 27001:2022",
}


def _landscape_summary(cards: list[ScanCard]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    subtype_counts: dict[str, int] = {}
    top_vendors: dict[str, int] = {}
    high_crit: list[str] = []
    for c in cards:
        counts[c.type] = counts.get(c.type, 0) + 1
        if c.subtype:
            subtype_counts[c.subtype] = subtype_counts.get(c.subtype, 0) + 1
        if c.vendor:
            top_vendors[c.vendor] = top_vendors.get(c.vendor, 0) + 1
        crit = (c.business_criticality or "").lower()
        if (
            crit in ("missioncritical", "mission_critical", "critical", "high")
            and len(high_crit) < 20
        ):
            high_crit.append(c.name)
    vendors_sorted = sorted(top_vendors.items(), key=lambda kv: kv[1], reverse=True)
    return {
        "counts_by_type": counts,
        "counts_by_subtype": dict(
            sorted(subtype_counts.items(), key=lambda kv: kv[1], reverse=True)[:20]
        ),
        "top_vendors": vendors_sorted[:15],
        "high_criticality_cards": high_crit,
        "total": len(cards),
    }


REGULATION_PROMPTS: dict[str, str] = {
    "eu_ai_act": (
        "Assess EU AI Act compliance. For each AI-bearing card classify "
        "the risk tier (prohibited / high_risk / limited_risk / minimal) "
        "using use-case signals in the description, and emit findings for "
        "obligations that apply at that tier: risk management system, "
        "data governance, technical documentation, transparency, human "
        "oversight, accuracy / robustness / cybersecurity, logging, "
        "post-market monitoring, conformity assessment. Also emit "
        "landscape-level findings (e.g., missing registry of high-risk "
        "systems, no AI governance role assigned)."
    ),
    "gdpr": (
        "Assess GDPR compliance. Flag applications that likely process "
        "personal data without a documented lawful basis, those that may "
        "transfer personal data outside the EU without SCCs, and "
        "high-risk processing that requires a DPIA. Emit landscape findings "
        "for gaps such as missing DPO assignment or no record of "
        "processing activities."
    ),
    "nis2": (
        "Assess NIS2 Directive compliance. Consider the cards as the IT "
        "estate of an essential or important entity. Flag gaps in: "
        "incident response capability, supply-chain risk concentration "
        "(single-vendor reliance), business continuity / disaster recovery, "
        "vulnerability management for essential services."
    ),
    "dora": (
        "Assess DORA (Digital Operational Resilience Act) compliance for "
        "financial-services cards. Flag: ICT third-party concentration, "
        "missing critical-function mapping, no resilience testing, "
        "incident classification / reporting gaps."
    ),
    "soc2": (
        "Assess SOC 2 Trust Services Criteria coverage over the landscape. "
        "Flag: stakeholder / owner assignment gaps (access control), "
        "change-management gaps (no approval workflow), monitoring / "
        "availability gaps, confidentiality gaps around sensitive cards."
    ),
    "iso27001": (
        "Assess ISO/IEC 27001:2022 Annex A control coverage. Flag: asset "
        "inventory completeness (data-quality gaps), access control "
        "ownership, supplier relationships (vendor / provider linkage), "
        "operations security, incident management."
    ),
}


def _compliance_shared_context(
    cards: list[ScanCard],
    ai_scope: dict[str, dict[str, Any]],
) -> str:
    summary = _landscape_summary(cards)
    ai_cards = [
        {
            "id": cid,
            "name": next((c.name for c in cards if c.id == cid), ""),
            "type": next((c.type for c in cards if c.id == cid), ""),
            "subtype": next((c.subtype for c in cards if c.id == cid), ""),
            "role": info.get("role"),
            "subtype_match": info.get("subtype_match"),
            "signal": info.get("signal", ""),
            "confidence": info.get("confidence"),
            "description": next(((c.description or "")[:300] for c in cards if c.id == cid), ""),
        }
        for cid, info in ai_scope.items()
    ]
    sample_cards = [
        {
            "id": c.id,
            "name": c.name,
            "type": c.type,
            "subtype": c.subtype,
            "vendor": c.vendor,
            "crit": c.business_criticality,
            "lifecycle": c.lifecycle_phase,
            "desc": (c.description or "")[:200],
        }
        for c in cards[:80]
    ]
    return json.dumps(
        {
            "summary": summary,
            "ai_bearing_cards": ai_cards,
            "sample_cards": sample_cards,
        }
    )


async def assess_regulation(
    db: AsyncSession,
    regulation: str,
    cards: list[ScanCard],
    ai_scope: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Run one compliance pass against a single regulation.

    Returns a list of raw finding dicts ready to be materialised into
    :class:`TurboLensComplianceFinding` rows.
    """
    ai_config = await get_ai_config(db)
    if not is_ai_configured(ai_config):
        return [
            {
                "regulation": regulation,
                "regulation_article": None,
                "card_id": None,
                "scope_type": "landscape",
                "category": "configuration",
                "requirement": "AI provider is configured for compliance analysis.",
                "status": "review_needed",
                "severity": "info",
                "gap_description": (
                    "AI is not configured — only a manual review of the "
                    "landscape could be performed."
                ),
                "evidence": None,
                "remediation": "Configure an AI provider under Admin → Settings → AI.",
                "ai_detected": False,
            }
        ]

    directive = REGULATION_PROMPTS.get(regulation)
    if not directive:
        return []
    context_json = _compliance_shared_context(cards, ai_scope)

    prompt = (
        f"Regulation: {REGULATION_LABELS.get(regulation, regulation)}.\n"
        f"{directive}\n\n"
        "Return ONLY a JSON array of compliance findings. Each finding:\n"
        '{"regulation_article":"<optional article reference>",'
        '"card_id":"<uuid or null for landscape-wide>",'
        '"scope_type":"card|landscape",'
        '"category":"<short category slug>",'
        '"requirement":"<what the regulation requires, plain English>",'
        '"status":"compliant|partial|non_compliant|not_applicable|review_needed",'
        '"severity":"critical|high|medium|low|info",'
        '"gap_description":"<why not compliant, or \\"—\\" if compliant>",'
        '"evidence":"<data points from the landscape that support the call>",'
        '"remediation":"<concrete next step, empty string if compliant>"}\n'
        "Rules:\n"
        "- If nothing applies, return [].\n"
        "- Prefer card-level findings when a specific card drives the gap; "
        "use scope_type=landscape only for systemic issues.\n"
        "- Never invent card ids. Use ids from the ai_bearing_cards or "
        "sample_cards lists only; otherwise set card_id to null.\n\n"
        f"Landscape data:\n{context_json}"
    )
    try:
        result = await call_ai(
            db,
            prompt,
            max_tokens=3000,
            system_prompt=(
                "You are an experienced compliance auditor. Return only "
                "valid JSON — no commentary, no markdown."
            ),
        )
        parsed = parse_json(result["text"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Compliance pass %s failed: %s", regulation, exc)
        return []

    if not isinstance(parsed, list):
        return []

    ai_ids = set(ai_scope.keys())
    non_subtype_ids = {cid for cid, info in ai_scope.items() if not info.get("subtype_match")}
    valid_card_ids = {c.id for c in cards}
    findings: list[dict[str, Any]] = []

    for item in parsed:
        if not isinstance(item, dict):
            continue
        raw_card_id = item.get("card_id")
        try:
            card_uuid = uuid_mod.UUID(raw_card_id) if raw_card_id else None
        except (TypeError, ValueError):
            card_uuid = None
        if card_uuid and str(card_uuid) not in valid_card_ids:
            card_uuid = None

        scope_type = (item.get("scope_type") or "").strip()
        if scope_type not in ("card", "landscape"):
            scope_type = "card" if card_uuid else "landscape"

        ai_detected = False
        if regulation == "eu_ai_act" and card_uuid and str(card_uuid) in ai_ids:
            ai_detected = str(card_uuid) in non_subtype_ids

        findings.append(
            {
                "regulation": regulation,
                "regulation_article": (item.get("regulation_article") or None),
                "card_id": card_uuid,
                "scope_type": scope_type,
                "category": (item.get("category") or "")[:64],
                "requirement": item.get("requirement", ""),
                "status": (item.get("status") or "review_needed"),
                "severity": (item.get("severity") or "info"),
                "gap_description": item.get("gap_description", ""),
                "evidence": item.get("evidence") or None,
                "remediation": item.get("remediation") or None,
                "ai_detected": ai_detected,
            }
        )
    return findings


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def run_cve_scan(
    db: AsyncSession,
    run_id: uuid_mod.UUID | str,
    user_id: uuid_mod.UUID | str | None,
    *,
    include_itc: bool = True,
) -> dict[str, Any]:
    """CVE pipeline only: query NVD + AI prioritisation.

    Replaces any existing CVE findings in-place (compliance findings are
    left untouched). Reports progress via ``run.results["progress"]``
    so the UI can render a phase-aware progress bar.
    """
    run_uuid = uuid_mod.UUID(str(run_id))
    progress_cb = _progress_cb(db, run_uuid)

    await progress_cb("loading_cards", 0, 0, "")
    cards = await load_scan_targets(db, include_itc=include_itc)
    cards_by_id = {c.id: c for c in cards}

    # Clear previous CVE findings for a fresh snapshot.
    await db.execute(delete(TurboLensCveFinding))
    await db.flush()

    raw_findings, skipped = await _fetch_raw_cves(cards, progress_cb=progress_cb)
    await enrich_with_ai(db, cards_by_id, raw_findings, progress_cb=progress_cb)

    await progress_cb("persisting_cve_findings", 0, len(raw_findings), "")
    for f in raw_findings:
        db.add(
            TurboLensCveFinding(
                id=uuid_mod.uuid4(),
                run_id=run_uuid,
                card_id=uuid_mod.UUID(f["card_id"]),
                card_type=f["card_type"],
                cve_id=f["cve_id"],
                vendor=f.get("vendor") or "",
                product=f.get("product") or "",
                version=f.get("version"),
                cvss_score=f.get("cvss_score"),
                cvss_vector=f.get("cvss_vector"),
                severity=f.get("severity") or "unknown",
                attack_vector=f.get("attack_vector"),
                exploitability_score=f.get("exploitability_score"),
                impact_score=f.get("impact_score"),
                patch_available=bool(f.get("patch_available")),
                published_date=f.get("published_date"),
                last_modified_date=f.get("last_modified_date"),
                description=f.get("description") or "",
                nvd_references=f.get("nvd_references") or [],
                priority=f.get("priority") or "medium",
                probability=f.get("probability") or "medium",
                business_impact=f.get("business_impact"),
                remediation=f.get("remediation"),
                status="open",
            )
        )
    await db.flush()

    if user_id:
        try:
            await notification_service.create_notification(
                db,
                user_id=uuid_mod.UUID(str(user_id)),
                notif_type="security_scan_complete",
                title="CVE scan finished",
                message=(
                    f"{len(raw_findings)} CVE finding(s) across "
                    f"{len(cards) - len(skipped)} scanned card(s)."
                ),
                link="/turbolens?tab=security",
                data={"cve_count": len(raw_findings), "scan": "cve"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("CVE scan notification failed: %s", exc)

    summary = {
        "scan": "cve",
        "cve_findings": len(raw_findings),
        "cards_scanned": len(cards),
        "cards_skipped": len(skipped),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    run = await db.get(TurboLensAnalysisRun, run_uuid)
    if run is not None:
        run.results = summary
    return summary


async def run_compliance_scan(
    db: AsyncSession,
    run_id: uuid_mod.UUID | str,
    user_id: uuid_mod.UUID | str | None,
    *,
    regulations: list[str] | None = None,
) -> dict[str, Any]:
    """Compliance pipeline only: per-regulation AI gap analysis.

    Replaces any existing compliance findings for the scanned
    regulations; findings for unscoped regulations (e.g. the user
    un-ticked DORA this time) are also cleared so the dashboard never
    shows stale data from a previous pass.
    """
    run_uuid = uuid_mod.UUID(str(run_id))
    progress_cb = _progress_cb(db, run_uuid)

    regs = [r for r in (regulations or list(SUPPORTED_REGULATIONS)) if r in SUPPORTED_REGULATIONS]
    if not regs:
        regs = list(SUPPORTED_REGULATIONS)

    await progress_cb("loading_cards", 0, 0, "")
    cards = await load_scan_targets(db, include_itc=True)

    # Clear all previous compliance findings — a compliance scan is a
    # full refresh of the selected regulations; anything not in scope
    # this run shouldn't linger.
    await db.execute(delete(TurboLensComplianceFinding))
    await db.flush()

    ai_scope: dict[str, dict[str, Any]] = {}
    if "eu_ai_act" in regs:
        ai_scope = await detect_ai_bearing_cards(db, cards, progress_cb=progress_cb)

    compliance_rows: list[dict[str, Any]] = []
    for idx, reg in enumerate(regs, 1):
        await progress_cb("regulation", idx, len(regs), reg)
        reg_findings = await assess_regulation(db, reg, cards, ai_scope)
        compliance_rows.extend(reg_findings)

    await progress_cb("persisting_compliance_findings", 0, len(compliance_rows), "")
    for f in compliance_rows:
        db.add(
            TurboLensComplianceFinding(
                id=uuid_mod.uuid4(),
                run_id=run_uuid,
                regulation=f["regulation"],
                regulation_article=f.get("regulation_article"),
                card_id=f.get("card_id"),
                scope_type=f.get("scope_type") or "landscape",
                category=f.get("category") or "",
                requirement=f.get("requirement") or "",
                status=f.get("status") or "review_needed",
                severity=f.get("severity") or "info",
                gap_description=f.get("gap_description") or "",
                evidence=f.get("evidence"),
                remediation=f.get("remediation"),
                ai_detected=bool(f.get("ai_detected")),
            )
        )
    await db.flush()

    if user_id:
        try:
            await notification_service.create_notification(
                db,
                user_id=uuid_mod.UUID(str(user_id)),
                notif_type="security_scan_complete",
                title="Compliance scan finished",
                message=(
                    f"{len(compliance_rows)} compliance finding(s) across "
                    f"{len(regs)} regulation(s)."
                ),
                link="/turbolens?tab=security",
                data={
                    "compliance_count": len(compliance_rows),
                    "regulations": regs,
                    "scan": "compliance",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Compliance scan notification failed: %s", exc)

    summary = {
        "scan": "compliance",
        "compliance_findings": len(compliance_rows),
        "regulations": regs,
        "cards_scanned": len(cards),
        "ai_bearing_cards": len(ai_scope),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    run = await db.get(TurboLensAnalysisRun, run_uuid)
    if run is not None:
        run.results = summary
    return summary


# ---------------------------------------------------------------------------
# Aggregations used by the API layer
# ---------------------------------------------------------------------------


def build_risk_matrix(rows: list[TurboLensCveFinding]) -> list[list[int]]:
    """5x5 matrix indexed by probability (row) x severity (col).

    Rows: very_high, high, medium, low, unknown.
    Cols: critical, high, medium, low, unknown.
    """
    prob_idx = {"very_high": 0, "high": 1, "medium": 2, "low": 3}
    sev_idx = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    matrix = [[0 for _ in range(5)] for _ in range(5)]
    for row in rows:
        pi = prob_idx.get(row.probability, 4)
        si = sev_idx.get(row.severity, 4)
        matrix[pi][si] += 1
    return matrix


def compliance_score(rows: list[TurboLensComplianceFinding]) -> int:
    """0-100 compliance score.

    * compliant:       +1.0 weight
    * not_applicable:  +1.0 weight (counts as fully covered)
    * partial:         +0.5 weight
    * review_needed:   +0.3 weight
    * non_compliant:   0 weight
    """
    if not rows:
        return 100
    weights = {
        "compliant": 1.0,
        "not_applicable": 1.0,
        "partial": 0.5,
        "review_needed": 0.3,
        "non_compliant": 0.0,
    }
    total = 0.0
    for r in rows:
        total += weights.get(r.status, 0.0)
    return int(round((total / len(rows)) * 100))


def finding_to_dict(
    row: TurboLensCveFinding,
    card_name: str | None,
    *,
    risk_reference: str | None = None,
) -> dict[str, Any]:
    """Flatten a CVE row + joined card name + (optional) promoted risk ref."""
    return {
        "id": str(row.id),
        "run_id": str(row.run_id),
        "card_id": str(row.card_id),
        "card_name": card_name,
        "card_type": row.card_type,
        "cve_id": row.cve_id,
        "vendor": row.vendor,
        "product": row.product,
        "version": row.version,
        "cvss_score": row.cvss_score,
        "cvss_vector": row.cvss_vector,
        "severity": row.severity,
        "attack_vector": row.attack_vector,
        "exploitability_score": row.exploitability_score,
        "impact_score": row.impact_score,
        "patch_available": row.patch_available,
        "published_date": _date_or_none(row.published_date),
        "last_modified_date": _date_or_none(row.last_modified_date),
        "description": row.description,
        "nvd_references": row.nvd_references or [],
        "priority": row.priority,
        "probability": row.probability,
        "business_impact": row.business_impact,
        "remediation": row.remediation,
        "status": row.status,
        "risk_id": str(row.risk_id) if row.risk_id else None,
        "risk_reference": risk_reference,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _date_or_none(value: date | None) -> str | None:
    return value.isoformat() if value else None


def compliance_to_dict(
    row: TurboLensComplianceFinding,
    card_name: str | None,
    *,
    risk_reference: str | None = None,
) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "run_id": str(row.run_id),
        "regulation": row.regulation,
        "regulation_article": row.regulation_article,
        "card_id": str(row.card_id) if row.card_id else None,
        "card_name": card_name,
        "scope_type": row.scope_type,
        "category": row.category,
        "requirement": row.requirement,
        "status": row.status,
        "severity": row.severity,
        "gap_description": row.gap_description,
        "evidence": row.evidence,
        "remediation": row.remediation,
        "ai_detected": row.ai_detected,
        "risk_id": str(row.risk_id) if row.risk_id else None,
        "risk_reference": risk_reference,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def load_risk_references(db: AsyncSession, risk_ids: set[uuid_mod.UUID]) -> dict[str, str]:
    """Resolve risk id → reference for N findings. Cheap bulk lookup."""
    if not risk_ids:
        return {}
    from app.models.risk import Risk

    result = await db.execute(select(Risk.id, Risk.reference).where(Risk.id.in_(risk_ids)))
    return {str(rid): ref for rid, ref in result.all()}
