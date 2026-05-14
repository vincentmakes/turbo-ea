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

import hashlib
import json
import logging
import re
import uuid as uuid_mod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.compliance_regulation import ComplianceRegulation
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

# Built-in regulation key that triggers the EU AI Act semantic detector
# pass. Custom regulations don't activate it — only the built-in does.
EU_AI_ACT_KEY = "eu_ai_act"

AI_SUBTYPES = {"AI Agent", "AI Model", "MCP Server"}
CVE_PER_CARD_LIMIT = 20
AI_BATCH_SIZE = 25
COMPLIANCE_BATCH_SIZE = 60
# `detect_ai_bearing_cards` packs each card with a richer payload (name, vendor,
# product, description, plus an EU AI Act risk-tier verdict per item in the
# response). With 60-card batches and 2400 output tokens, the JSON array can
# truncate mid-array and the parser silently drops the whole batch. 30/4000
# leaves plenty of headroom; if this ever needs to grow, prefer smaller batches
# over more tokens (latency stays lower).
AI_DETECTION_BATCH_SIZE = 30
AI_DETECTION_MAX_TOKENS = 4000


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

    # User verdict on attributes.hasAiFeatures is sticky in BOTH directions:
    #   - True  → card is in scope even if subtype + LLM both miss it
    #             (handled in the seed loop below)
    #   - False → card is OUT of scope, even if its subtype matches and
    #             even if the LLM would have flagged it. The user's "no"
    #             overrides everything; otherwise the verdict UI is
    #             pointless and we'd just toggle it back on every scan.
    #   - missing → unknown; let subtype + LLM decide as before.
    def _user_says_no_ai(c: ScanCard) -> bool:
        return isinstance(c.attributes, dict) and c.attributes.get("hasAiFeatures") is False

    def _user_says_yes_ai(c: ScanCard) -> bool:
        return isinstance(c.attributes, dict) and c.attributes.get("hasAiFeatures") is True

    # Start with cards that are AI by subtype — in scope by default,
    # unless the user has explicitly overruled with a "no".
    scoped: dict[str, dict[str, Any]] = {
        c.id: {"role": "provider", "confidence": 1.0, "subtype_match": True}
        for c in cards
        if c.subtype in AI_SUBTYPES and not _user_says_no_ai(c)
    }
    # Pre-include cards the user has explicitly confirmed as AI-bearing.
    # The LLM pass is non-deterministic and may miss subtle / embedded
    # cases on a re-scan; this keeps user verdicts sticky.
    for c in cards:
        if c.id in scoped:
            continue
        if _user_says_yes_ai(c):
            scoped[c.id] = {
                "role": "embedded",
                "confidence": 1.0,
                "subtype_match": False,
            }

    ai_config = await get_ai_config(db)
    if not is_ai_configured(ai_config):
        return scoped

    # Don't ask the LLM about cards the user has explicitly flagged as
    # NOT AI-bearing — their answer is fixed regardless of what the
    # model would say. Saves tokens and prevents the UI from flapping.
    candidates = [c for c in cards if not _user_says_no_ai(c)]
    total_batches = max(
        1, (len(candidates) + AI_DETECTION_BATCH_SIZE - 1) // AI_DETECTION_BATCH_SIZE
    )
    for start in range(0, len(candidates), AI_DETECTION_BATCH_SIZE):
        batch_index = start // AI_DETECTION_BATCH_SIZE + 1
        if progress_cb:
            await progress_cb("ai_detection", batch_index, total_batches, "")
        batch = candidates[start : start + AI_DETECTION_BATCH_SIZE]
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
            "Classify each card below as AI-bearing or not. A card is "
            "AI-bearing if it embeds, provides, integrates, or depends "
            "on AI / ML / generative-AI capabilities. Cards may be "
            "Applications (business apps, microservices, AI agents, "
            "deployments) or IT Components (software, SaaS, PaaS, "
            "IaaS, services, AI models, hardware) — assess both equally.\n\n"
            "Signals to combine (use ALL that are present):\n"
            "1. The card's SUBTYPE field — values like 'AI Agent', "
            "'AI Model', 'MCP Server' are explicit AI markers and the "
            "card MUST be flagged.\n"
            "2. The card's NAME — recognise well-known AI products "
            "from your training data (Microsoft Copilot, GitHub "
            "Copilot, ChatGPT, Claude, Gemini, Llama, Mistral, "
            "DeepSeek, Perplexity, Cursor, Tabnine, Codeium, Amazon Q, "
            "Microsoft 365 Copilot, Salesforce Einstein, Adobe Sensei, "
            "Notion AI, Jira AI, Midjourney, DALL·E, Stable Diffusion, "
            "Runway, Sora, ElevenLabs, etc.).\n"
            "3. The card's VENDOR — vendors whose flagship offerings "
            "are AI (OpenAI, Anthropic, Hugging Face, Cohere, "
            "Mistral AI, Stability AI, ElevenLabs, RunwayML, etc.).\n"
            "4. The card's DESCRIPTION — wording such as 'AI-powered', "
            "'machine learning', 'LLM', 'generative AI', 'foundation "
            "model', 'embeddings', 'RAG', 'recommendation engine', "
            "'computer vision', 'speech recognition', 'predictive "
            "analytics', 'anomaly detection', 'chatbot', 'assistant', "
            "'agent', etc.\n\n"
            "Be deliberately broad. Include both first-party AI "
            "products and subtle / embedded cases:\n"
            "- LLMs and foundation models packaged as components / "
            "services / inference APIs\n"
            "- coding assistants and AI IDE features\n"
            "- consumer chat / assistant products\n"
            "- image / video / audio / speech generation and "
            "transcription\n"
            "- vector databases used for retrieval / RAG, embeddings "
            "APIs\n"
            "- recommendation engines, search ranking, ad targeting\n"
            "- computer vision, OCR, anomaly detection, fraud / credit "
            "scoring, predictive analytics\n"
            "- enterprise AI features hidden inside general-purpose "
            "products or third-party SaaS\n\n"
            "Use ALL of NAME, VENDOR, SUBTYPE and DESCRIPTION together. "
            "Apply your own knowledge of well-known products even if the "
            "description is sparse: a card simply named 'Copilot' or "
            "'ChatGPT' is AI even with no description. Err on the side "
            "of inclusion: when in doubt, flag it.\n\n"
            'Return ONLY JSON: [{"id":"<uuid>","ai_role":"provider|consumer|embedded",'
            '"confidence":0.0-1.0,"signal":"<what in the card hinted at AI>"}].\n'
            "Omit cards with no AI involvement.\n\n"
            f"Cards:\n{json.dumps(payload)}"
        )
        try:
            result = await call_ai(
                db,
                prompt,
                max_tokens=AI_DETECTION_MAX_TOKENS,
                system_prompt=(
                    "You are an enterprise-architecture analyst classifying "
                    "applications and IT components by whether they use AI / "
                    "ML capabilities. Be broad and inclusive — embedded and "
                    "third-party AI both count. Return only valid JSON."
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
            # Subtype-match cards stay marked as such — don't downgrade.
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
# Compliance prompts (dynamic — built from the compliance_regulations table)
# ---------------------------------------------------------------------------


async def load_enabled_regulations(
    db: AsyncSession, keys: list[str] | None = None
) -> list[ComplianceRegulation]:
    """Return enabled regulations from the DB, ordered by sort_order.

    If ``keys`` is provided, the result is intersected with that set.
    Unknown keys are silently dropped — the scan endpoint never raises
    on a stale client-side regulation key.
    """
    stmt = (
        select(ComplianceRegulation)
        .where(ComplianceRegulation.is_enabled == True)  # noqa: E712
        .order_by(ComplianceRegulation.sort_order, ComplianceRegulation.label)
    )
    if keys:
        stmt = stmt.where(ComplianceRegulation.key.in_(keys))
    return list((await db.execute(stmt)).scalars().all())


async def load_regulation_meta(db: AsyncSession) -> dict[str, dict[str, Any]]:
    """Map of regulation key → {label, is_enabled} for ALL rows (incl. disabled).

    Used by the ``GET /security/compliance`` rollup to surface a finding's
    regulation label even after the regulation has been disabled, and to
    render the muted "disabled" chip on the tab.
    """
    stmt = select(ComplianceRegulation).order_by(
        ComplianceRegulation.sort_order, ComplianceRegulation.label
    )
    rows = list((await db.execute(stmt)).scalars().all())
    return {r.key: {"label": r.label, "is_enabled": r.is_enabled} for r in rows}


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


DEFAULT_ASSESSMENT_DIRECTIVE = (
    "Assess landscape compliance with this regulation. Identify card-level "
    "gaps where a specific application, IT component, or data object drives "
    "the non-compliance, and landscape-level gaps where a systemic control "
    "is missing across the estate."
)


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
    regulation: ComplianceRegulation,
    cards: list[ScanCard],
    ai_scope: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Run one compliance pass against a single regulation.

    The regulation's ``label`` and ``description`` (stored on the
    ``compliance_regulations`` row) are composed into the LLM prompt.
    Admins never enter or see raw prompts — the assessment scope text
    they edit on the row is what feeds the LLM here.

    Returns a list of raw finding dicts ready to be materialised into
    :class:`TurboLensComplianceFinding` rows.
    """
    reg_key = regulation.key
    ai_config = await get_ai_config(db)
    if not is_ai_configured(ai_config):
        return [
            {
                "regulation": reg_key,
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

    directive = (regulation.description or "").strip() or DEFAULT_ASSESSMENT_DIRECTIVE
    context_json = _compliance_shared_context(cards, ai_scope)

    prompt = (
        f"Regulation: {regulation.label}.\n"
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
        logger.warning("Compliance pass %s failed: %s", reg_key, exc)
        return []

    if not isinstance(parsed, list):
        return []

    ai_ids = set(ai_scope.keys())
    valid_card_ids = {c.id for c in cards}
    cards_by_id = {c.id: c for c in cards}
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

        # ``ai_detected`` now means "the card is AI-bearing" — any of
        # subtype-marked, LLM semantically-detected, or LLM-emitted under
        # EU AI Act. Previously it was narrowly true only for non-subtype
        # matches, which meant the "AI only" filter hid every Copilot /
        # ChatGPT card that had a proper AI Agent subtype.
        ai_detected = False
        if reg_key == EU_AI_ACT_KEY and card_uuid and str(card_uuid) in ai_ids:
            ai_detected = True

        findings.append(
            {
                "regulation": reg_key,
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

    # EU AI Act guarantee: every AI-bearing card must appear in the
    # register with at least one finding, even when the LLM chose to
    # emit none for it (small models often skip "compliant-looking"
    # cards). Without this fallback the AI inventory has gaps and
    # cards like Copilot — subtype AI Agent — never surface.
    if reg_key == EU_AI_ACT_KEY:
        emitted_card_ids = {
            str(f["card_id"])
            for f in findings
            if f.get("card_id") and f.get("scope_type") == "card"
        }
        for cid in ai_ids:
            if cid in emitted_card_ids:
                continue
            try:
                card_uuid = uuid_mod.UUID(cid)
            except (TypeError, ValueError):
                continue
            card = cards_by_id.get(cid)
            card_name = card.name if card else cid
            findings.append(
                {
                    "regulation": reg_key,
                    "regulation_article": None,
                    "card_id": card_uuid,
                    "scope_type": "card",
                    "category": "applicability",
                    "requirement": (
                        f"EU AI Act applies to {card_name} — classify risk "
                        "tier (prohibited / high / limited / minimal) and "
                        "document the applicable obligations."
                    ),
                    "status": "review_needed",
                    "severity": "medium",
                    "gap_description": (
                        "Card detected as AI-bearing but no risk-tier "
                        "classification or obligation assessment on file."
                    ),
                    "evidence": None,
                    "remediation": (
                        "Open the card and classify its EU AI Act risk "
                        "tier per Art. 5 / Annex III, then document the "
                        "obligations that apply at that tier."
                    ),
                    "ai_detected": True,
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

    raw_findings, skipped = await _fetch_raw_cves(cards, progress_cb=progress_cb)
    await enrich_with_ai(db, cards_by_id, raw_findings, progress_cb=progress_cb)

    await progress_cb("persisting_cve_findings", 0, len(raw_findings), "")

    # Upsert by (card_id, cve_id) so user-set fields — ``status`` and
    # the promoted-Risk back-link ``risk_id`` — survive re-scans. The
    # parallel regression on the compliance side was fixed in PR #536;
    # CVE was missed at the time and used to blanket-DELETE every row.
    existing_rows = (await db.execute(select(TurboLensCveFinding))).scalars().all()
    existing_by_key: dict[tuple[uuid_mod.UUID, str], TurboLensCveFinding] = {
        (row.card_id, row.cve_id): row for row in existing_rows
    }

    seen_keys: set[tuple[uuid_mod.UUID, str]] = set()
    for f in raw_findings:
        card_uuid = uuid_mod.UUID(f["card_id"])
        cve_id = f["cve_id"]
        key = (card_uuid, cve_id)
        seen_keys.add(key)
        row = existing_by_key.get(key)
        if row is None:
            db.add(
                TurboLensCveFinding(
                    id=uuid_mod.uuid4(),
                    run_id=run_uuid,
                    card_id=card_uuid,
                    card_type=f["card_type"],
                    cve_id=cve_id,
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
        else:
            # Refresh scanner-side fields from NVD; never touch
            # user-owned ``status`` or ``risk_id``.
            row.run_id = run_uuid
            row.card_type = f["card_type"]
            row.vendor = f.get("vendor") or ""
            row.product = f.get("product") or ""
            row.version = f.get("version")
            row.cvss_score = f.get("cvss_score")
            row.cvss_vector = f.get("cvss_vector")
            row.severity = f.get("severity") or "unknown"
            row.attack_vector = f.get("attack_vector")
            row.exploitability_score = f.get("exploitability_score")
            row.impact_score = f.get("impact_score")
            row.patch_available = bool(f.get("patch_available"))
            row.published_date = f.get("published_date")
            row.last_modified_date = f.get("last_modified_date")
            row.description = f.get("description") or ""
            row.nvd_references = f.get("nvd_references") or []
            row.priority = f.get("priority") or "medium"
            row.probability = f.get("probability") or "medium"
            row.business_impact = f.get("business_impact")
            row.remediation = f.get("remediation")

    # Vanished rows — NVD didn't re-emit this (card, CVE) pair on this
    # run. Delete only the untouched ones (``status="open"`` and no
    # promoted Risk). Anything the user has triaged or escalated is
    # preserved so the audit trail and any open Risks stay intact.
    for key, row in existing_by_key.items():
        if key in seen_keys:
            continue
        if row.status == "open" and row.risk_id is None:
            await db.delete(row)

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


# ---------------------------------------------------------------------------
# Compliance finding lifecycle
# ---------------------------------------------------------------------------
#
# Five-state main path with three off-path side branches. The `decision`
# column on TurboLensComplianceFinding stores the current state. The
# `auto_resolved` boolean is a separate flag, NOT a decision value.
#
#     new → in_review → mitigated → verified              (main path)
#                ↳ risk_tracked / accepted / not_applicable (side branches)
#
# `risk_tracked` exits are blocked here and instead driven by the Risk
# back-prop service (`compliance_risk_sync.propagate_risk_to_findings`).

COMPLIANCE_LIFECYCLE_STATES: frozenset[str] = frozenset(
    {
        "new",
        "in_review",
        "mitigated",
        "verified",
        "risk_tracked",
        "accepted",
        "not_applicable",
    }
)

_COMPLIANCE_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "new": {"in_review", "accepted", "not_applicable"},
    "in_review": {"mitigated", "accepted", "not_applicable", "new"},
    "mitigated": {"verified", "in_review"},
    "verified": {"in_review"},
    "accepted": {"in_review"},
    "not_applicable": {"in_review"},
    # risk_tracked exits are managed by the Risk lifecycle (back-prop).
    "risk_tracked": set(),
}


def compliance_lifecycle_allowed(current: str | None, new: str) -> bool:
    """Return True if ``new`` is a legal forward transition from ``current``.

    Same-state is always allowed (no-op). Promotion to ``risk_tracked``
    is handled by the dedicated promote endpoint and so is excluded from
    the user-facing transition map.
    """
    if not current or current == new:
        return True
    allowed = _COMPLIANCE_ALLOWED_TRANSITIONS.get(current, set())
    return new in allowed


# Match the LLM-emitted prefixes we want to strip from regulation_article so
# "Art. 6", "Article 6", "art 6" and "§ 6" all collapse to the same identity.
# Order is significant only in the regex sense (longer alternatives first).
# ``§`` may sit flush against the digit ("§6") so its trailing whitespace is
# optional. Word prefixes ("Article", "Art.", "Section" …) require trailing
# whitespace so we don't accidentally chop the leading letters off words like
# "Articles" or "Sectional".
_ARTICLE_PREFIX_RE = re.compile(
    r"^\s*(?:§\s*|(?:article|art\.?|section|sect\.?|paragraph|para\.?|chapter|chap\.?|annex)\s+)",
    re.IGNORECASE,
)


def _normalise_article(article: str | None) -> str:
    """Reduce an LLM-emitted article reference to a stable identifier.

    Why: the LLM rephrases prefixes between scan runs ("Art. 6" → "Article 6"
    → "art 6" → "§6"), tweaks whitespace, and sometimes adds trailing
    punctuation. We want all those forms to collapse onto the same
    ``finding_key`` so a re-scan upserts onto the existing row instead of
    inserting a duplicate.
    """
    if not article:
        return ""
    s = article.strip()
    # Strip leading prefixes — repeat to handle nested LLM phrasings like
    # "Article §6" or "Art. Section 6".
    while True:
        new = _ARTICLE_PREFIX_RE.sub("", s, count=1)
        if new == s:
            break
        s = new
    # Collapse internal whitespace, lowercase, trim trailing punctuation.
    s = re.sub(r"\s+", " ", s).strip().lower().rstrip(".,;:")
    return s


def compute_finding_key(
    scope_type: str | None,
    card_id: uuid_mod.UUID | str | None,
    regulation: str | None,
    regulation_article: str | None,
    requirement: str | None = None,  # accepted for backwards-compat; ignored
) -> str:
    """Stable identity for a compliance finding across re-scans.

    The natural key is **(scope, card, regulation, normalised article)** —
    NOT the LLM-emitted requirement text. Earlier versions hashed the
    requirement too, but the LLM rephrases that body on every run, so a
    re-scan would mint a brand-new ``finding_key`` for every row and
    duplicate every finding. The requirement (and the rest of the body
    fields: gap_description, evidence, remediation) are now treated as
    scanner content — they live on the row but they're not part of its
    identity.

    Used as the upsert key in ``run_compliance_scan`` so human decisions
    (acknowledge / accept / risk_tracked) and promoted-Risk back-links
    survive subsequent scans. The recipe is mirrored by migration 083's
    backfill — keep them in sync. SHA-256 so CodeQL's weak-hash rule stays
    quiet; the role is fingerprinting only, not security.
    """
    del requirement  # explicitly discarded — see docstring
    parts = [
        (scope_type or "").strip(),
        str(card_id) if card_id else "",
        (regulation or "").strip(),
        _normalise_article(regulation_article),
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


async def run_compliance_scan(
    db: AsyncSession,
    run_id: uuid_mod.UUID | str,
    user_id: uuid_mod.UUID | str | None,
    *,
    regulations: list[str] | None = None,
) -> dict[str, Any]:
    """Compliance pipeline only: per-regulation AI gap analysis.

    Findings are *upserted* by ``finding_key`` (stable hash of scope +
    card + regulation + article + requirement) so that human decisions
    and any linked Risks survive re-scans. Findings that the new pass no
    longer reports — within the scanned regulations — are flagged
    ``auto_resolved=True`` instead of deleted; their ``risk_id`` is
    preserved so the owner can verify / close any open Risk manually.
    Findings under regulations not in scope this run are untouched.
    """
    run_uuid = uuid_mod.UUID(str(run_id))
    progress_cb = _progress_cb(db, run_uuid)

    # Load enabled regulations from the DB. The optional ``regulations``
    # filter (from the request body) narrows the run to the intersection.
    # When the caller passes a non-empty filter that doesn't match any
    # enabled regulation (typo, or an admin disabled them in the
    # meantime), DO NOT silently widen to a full-landscape scan — that
    # would trigger an LLM fanout the caller never asked for. Return a
    # no-op summary instead so the run record still completes cleanly.
    if regulations:
        enabled_regs = await load_enabled_regulations(db, keys=regulations)
        if not enabled_regs:
            empty_summary = {
                "scan": "compliance",
                "compliance_findings": 0,
                "regulations": [],
                "regulations_requested": list(regulations),
                "skipped_reason": "no_matching_enabled_regulations",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            run = await db.get(TurboLensAnalysisRun, run_uuid)
            if run is not None:
                run.results = empty_summary
            return empty_summary
    else:
        enabled_regs = await load_enabled_regulations(db)
    reg_keys = [r.key for r in enabled_regs]

    await progress_cb("loading_cards", 0, 0, "")
    cards = await load_scan_targets(db, include_itc=True)

    ai_scope: dict[str, dict[str, Any]] = {}
    if EU_AI_ACT_KEY in reg_keys:
        ai_scope = await detect_ai_bearing_cards(db, cards, progress_cb=progress_cb)

    compliance_rows: list[dict[str, Any]] = []
    for idx, reg in enumerate(enabled_regs, 1):
        await progress_cb("regulation", idx, len(enabled_regs), reg.key)
        reg_findings = await assess_regulation(db, reg, cards, ai_scope)
        compliance_rows.extend(reg_findings)

    await progress_cb("persisting_compliance_findings", 0, len(compliance_rows), "")

    # Load existing findings within the scanned regulations and index by key.
    existing_rows = (
        (
            await db.execute(
                select(TurboLensComplianceFinding).where(
                    TurboLensComplianceFinding.regulation.in_(reg_keys)
                )
            )
        )
        .scalars()
        .all()
    )
    existing_by_key: dict[str, TurboLensComplianceFinding] = {
        row.finding_key: row for row in existing_rows
    }

    seen_keys: set[str] = set()
    for f in compliance_rows:
        key = compute_finding_key(
            f.get("scope_type") or "landscape",
            f.get("card_id"),
            f["regulation"],
            f.get("regulation_article"),
            f.get("requirement") or "",
        )
        seen_keys.add(key)
        row = existing_by_key.get(key)
        if row is None:
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
                    finding_key=key,
                    decision="new",
                    last_seen_run_id=run_uuid,
                    auto_resolved=False,
                )
            )
        else:
            # Re-emitted finding — minimal-touch.
            #
            # Once a finding exists, its body and decision belong to the
            # user. The scanner only updates the AI-side bookkeeping
            # (which run last confirmed it) and never touches anything
            # else. See the block below for vanished rows.
            row.run_id = run_uuid
            row.last_seen_run_id = run_uuid

    # Re-scan is purely additive: every existing row in the scanned
    # regulations stays visible regardless of whether the LLM re-emitted
    # it this run. Previously the "vanished" branch set
    # ``auto_resolved=True`` on rows the new scan didn't mention, which
    # the default Compliance grid filter hides — combined with LLM
    # non-determinism, that silently shrank the user's visible findings
    # on every scan.
    #
    # Now we explicitly clear ``auto_resolved`` on every row in the
    # scanned regulations. This also restores rows that got stuck at
    # ``auto_resolved=True`` from older scans. Body and decision are
    # never touched — verifying / closing is the user's call via the
    # lifecycle workflow.
    for row in existing_rows:
        row.auto_resolved = False

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
                    f"{len(reg_keys)} regulation(s)."
                ),
                link="/turbolens?tab=security",
                data={
                    "compliance_count": len(compliance_rows),
                    "regulations": reg_keys,
                    "scan": "compliance",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Compliance scan notification failed: %s", exc)

    summary = {
        "scan": "compliance",
        "compliance_findings": len(compliance_rows),
        "regulations": reg_keys,
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
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _date_or_none(value: date | None) -> str | None:
    return value.isoformat() if value else None


def compliance_to_dict(
    row: TurboLensComplianceFinding,
    card_name: str | None,
    *,
    card_type: str | None = None,
    card_has_ai_features: bool | None = None,
    risk_reference: str | None = None,
    reviewer_name: str | None = None,
) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "run_id": str(row.run_id),
        "regulation": row.regulation,
        "regulation_article": row.regulation_article,
        "card_id": str(row.card_id) if row.card_id else None,
        "card_name": card_name,
        "card_type": card_type,
        "card_has_ai_features": card_has_ai_features,
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
        "decision": row.decision,
        "reviewed_by": str(row.reviewed_by) if row.reviewed_by else None,
        "reviewer_name": reviewer_name,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "review_note": row.review_note,
        "auto_resolved": row.auto_resolved,
        "last_seen_run_id": (str(row.last_seen_run_id) if row.last_seen_run_id else None),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def load_risk_references(db: AsyncSession, risk_ids: set[uuid_mod.UUID]) -> dict[str, str]:
    """Resolve risk id → reference for N findings. Cheap bulk lookup."""
    if not risk_ids:
        return {}
    from app.models.risk import Risk

    result = await db.execute(select(Risk.id, Risk.reference).where(Risk.id.in_(risk_ids)))
    return {str(rid): ref for rid, ref in result.all()}


async def load_reviewer_names(db: AsyncSession, user_ids: set[uuid_mod.UUID]) -> dict[str, str]:
    """Resolve user id → display_name (falling back to email) for reviewers."""
    if not user_ids:
        return {}
    from app.models.user import User

    result = await db.execute(
        select(User.id, User.display_name, User.email).where(User.id.in_(user_ids))
    )
    return {str(uid): (display or email or "") for uid, display, email in result.all()}
