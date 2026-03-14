"""ArchLens Architecture AI — 3-phase conversational architecture workflow.

Ported from architect.js. Queries the cards table directly for landscape
context and uses the shared AI caller for LLM interactions.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.archlens import ArchLensVendorAnalysis
from app.models.card import Card
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.archlens_ai import (
    call_ai,
    format_principles_block,
    load_active_principles,
    parse_json,
)

logger = logging.getLogger("turboea.archlens.architect")

# ---------------------------------------------------------------------------
# Persona
# ---------------------------------------------------------------------------

ARCHITECT_PERSONA = """You are a Principal Enterprise Architect with 20+ years of experience \
designing mission-critical systems for large enterprises across retail, finance, logistics, \
and manufacturing sectors.

Your architecture practice is grounded in:
- Domain-Driven Design (DDD) and bounded context thinking
- Event-Driven Architecture (EDA) and messaging patterns (CQRS, Event Sourcing, Saga)
- API-first design (REST, GraphQL, AsyncAPI, gRPC)
- Cloud-native patterns (12-factor, microservices, serverless, service mesh)
- Integration patterns (ESB, iPaaS, event streaming, ETL/ELT)
- Non-functional requirements: reliability, scalability, security, observability, cost

When asking questions, you think like a real architect running a discovery session:
- You probe for SCALE, RESILIENCE, INTEGRATION, SECURITY, and OPERATIONAL needs
- You always look at the existing landscape FIRST before recommending new tools
- You flag when an event-driven or async pattern is needed vs synchronous REST

Always respond with valid JSON only \u2014 no markdown fences, no preamble text."""


async def _build_persona_with_principles(db: AsyncSession) -> str:
    """Build the architect persona with EA principles appended."""
    principles = await load_active_principles(db)
    block = format_principles_block(principles)
    if not block:
        return ARCHITECT_PERSONA
    return ARCHITECT_PERSONA + "\n\n" + block


# ---------------------------------------------------------------------------
# Landscape loading from cards table
# ---------------------------------------------------------------------------


async def load_landscape(db: AsyncSession) -> dict[str, Any]:
    """Load the EA landscape for architect context."""
    # Load vendor analysis
    va_result = await db.execute(select(ArchLensVendorAnalysis))
    vendors = va_result.scalars().all()

    by_category: dict[str, list[dict[str, Any]]] = {}
    for v in vendors:
        cat = v.category or "Other"
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(
            {
                "name": v.vendor_name,
                "subCategory": v.sub_category,
                "appCount": v.app_count,
            }
        )

    # Load apps/ITCs
    cards_result = await db.execute(
        select(Card).where(
            Card.type.in_(["Application", "ITComponent", "Interface"]),
            Card.status != "ARCHIVED",
        )
    )
    cards = cards_result.scalars().all()

    # Get Provider relations
    rt_result = await db.execute(
        select(RelationType.key).where(
            (RelationType.target_type_key == "Provider")
            | (RelationType.source_type_key == "Provider")
        )
    )
    provider_rel_keys = [r[0] for r in rt_result.all()]

    prov_result = await db.execute(
        select(Card).where(Card.type == "Provider", Card.status != "ARCHIVED")
    )
    providers = {str(p.id): p for p in prov_result.scalars().all()}

    card_vendors: dict[str, list[str]] = {}
    if provider_rel_keys:
        rels_result = await db.execute(select(Relation).where(Relation.type.in_(provider_rel_keys)))
        for rel in rels_result.scalars().all():
            src_id = str(rel.source_id)
            tgt_id = str(rel.target_id)
            if tgt_id in providers:
                card_vendors.setdefault(src_id, []).append(providers[tgt_id].name)
            elif src_id in providers:
                card_vendors.setdefault(tgt_id, []).append(providers[src_id].name)

    apps = []
    for card in cards:
        lifecycle_data = card.lifecycle or {}
        lifecycle_phase = None
        if isinstance(lifecycle_data, list) and lifecycle_data:
            lifecycle_phase = lifecycle_data[-1].get("phase")
        elif isinstance(lifecycle_data, dict):
            lifecycle_phase = lifecycle_data.get("phase")

        apps.append(
            {
                "name": card.name,
                "fs_type": card.type,
                "vendors": json.dumps(card_vendors.get(str(card.id), [])),
                "lifecycle": lifecycle_phase,
            }
        )

    vendor_list = [{"vendor_name": v.vendor_name, "category": v.category} for v in vendors]

    return {
        "byCategory": by_category,
        "apps": apps,
        "appCount": sum(1 for a in apps if a["fs_type"] == "Application"),
        "vendorCount": len(vendors),
        "totalTechFS": len(apps),
        "vendors": vendor_list,
    }


# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------


def _build_landscape_context(landscape: dict[str, Any]) -> str:
    """Build full landscape context for Phase 1/2."""
    by_category = landscape.get("byCategory", {})
    apps = landscape.get("apps", [])
    vendor_count = landscape.get("vendorCount", 0)
    app_count = landscape.get("appCount", 0)
    total = landscape.get("totalTechFS", 0)

    lines = [
        "=== EXISTING TECHNOLOGY LANDSCAPE ===",
        f"{vendor_count} categorised vendors | {app_count} applications"
        f" | {total} total technical cards",
        "",
    ]

    if vendor_count > 0:
        lines.append("--- VENDORS BY CATEGORY ---")
        for cat, vs in by_category.items():
            if not vs:
                continue
            lines.append(f"[{cat}]")
            for v in vs[:15]:
                sub = f" ({v['subCategory']})" if v.get("subCategory") else ""
                lines.append(f"  \u2022 {v['name']}{sub} \u2014 used by {v['appCount']} app(s)")
            if len(vs) > 15:
                lines.append(f"  ... and {len(vs) - 15} more in this category")
            lines.append("")

    by_type: dict[str, list[dict[str, Any]]] = {}
    for a in apps:
        by_type.setdefault(a["fs_type"], []).append(a)

    if apps:
        lines.append("--- APPLICATIONS & TECHNICAL COMPONENTS ---")
        for type_name, items in by_type.items():
            lines.append(f"[{type_name}] ({len(items)} total)")
            for a in items[:20]:
                try:
                    v_list = json.loads(a.get("vendors", "[]"))
                    vendor_str = f" [{', '.join(v_list[:3])}]" if v_list else ""
                except Exception:
                    vendor_str = ""
                lc = f" [{a['lifecycle']}]" if a.get("lifecycle") else ""
                lines.append(f"  \u2022 {a['name']}{vendor_str}{lc}")
            if len(items) > 20:
                lines.append(f"  ... and {len(items) - 20} more")
            lines.append("")

    return "\n".join(lines)


def _build_compact_context(landscape: dict[str, Any]) -> str:
    """Compact landscape context for Phase 3 (fewer tokens)."""
    by_category = landscape.get("byCategory", {})
    apps = landscape.get("apps", [])
    vendor_count = landscape.get("vendorCount", 0)
    app_count = landscape.get("appCount", 0)
    total = landscape.get("totalTechFS", 0)

    lines = [
        f"=== EXISTING LANDSCAPE: {vendor_count} vendors"
        f" | {app_count} apps | {total} tech items ==="
    ]

    for cat, vs in by_category.items():
        if not vs:
            continue
        names = ", ".join(v["name"] for v in vs[:8])
        extra = f" (+{len(vs) - 8} more)" if len(vs) > 8 else ""
        lines.append(f"[{cat}]: {names}{extra}")

    by_type: dict[str, list[dict[str, Any]]] = {}
    for a in apps:
        by_type.setdefault(a["fs_type"], []).append(a)
    for type_name, items in by_type.items():
        names = ", ".join(a["name"] for a in items[:10])
        extra = f" (+{len(items) - 10} more)" if len(items) > 10 else ""
        lines.append(f"[{type_name}]: {names}{extra}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------


def _detect_intent_patterns(requirement: str) -> list[str]:
    """Detect architecture intent patterns from the requirement text."""
    r = requirement.lower()
    patterns = []

    checks = [
        ("event_driven", r"event|stream|messag|queue|kafka|rabbit|async|real.?time"),
        ("api_integration", r"api|gateway|rest|graphql|webhook|integrat|middleware"),
        ("data_platform", r"data|analytics|bi|report|warehouse|lake|pipeline|etl|ml|ai|predict"),
        ("ecommerce", r"checkout|payment|order|cart|ecommerce|e-commerce|shop"),
        ("identity_access", r"identity|auth|sso|saml|oauth|iam|login|access"),
        ("cloud_native", r"microservice|container|kubernetes|k8s|docker|serverless|cloud.?native"),
        ("erp_integration", r"erp|sap|finance|supply.?chain|warehouse|inventory|logistics"),
        ("customer_portal", r"portal|customer|self.?service|onboard|crm|salesforce"),
        ("observability", r"monitor|observ|alert|log|trace|apm|perform"),
        ("security_compliance", r"security|compliance|gdpr|pci|iso|audit|encrypt"),
    ]

    for name, pattern in checks:
        if re.search(pattern, r, re.IGNORECASE):
            patterns.append(name)

    return patterns or ["general"]


# ---------------------------------------------------------------------------
# Phase 1 — Business & Functional Clarification
# ---------------------------------------------------------------------------


async def phase1_questions(db: AsyncSession, requirement: str) -> dict[str, Any]:
    """Generate Phase 1 business clarification questions."""
    landscape = await load_landscape(db)
    ctx = _build_landscape_context(landscape)
    patterns = _detect_intent_patterns(requirement)

    prompt = f"""A stakeholder has submitted this architecture requirement:
"{requirement}"

{ctx}

DETECTED ARCHITECTURE INTENT: {", ".join(patterns)}

TASK: Generate 5-6 targeted Phase 1 questions as a principal enterprise architect.

Phase 1 focuses on FUNCTIONAL and BUSINESS requirements:
- Business context: who uses it, what problem it solves, what success looks like
- Functional scope: key capabilities, user journeys, integrations needed
- Data: what data flows, ownership, sensitivity
- Stakeholders: who owns the system, who are the consumers
- Timeline and phasing: MVP vs full rollout

CRITICAL RULES:
1. Tailor questions to the detected patterns ({", ".join(patterns)})
2. Reference SPECIFIC systems from the existing landscape where relevant
3. Mix question types: use 'choice' for bounded answers, 'multi' for multi-select, 'text' for open-ended # noqa: E501
4. The 'why' field must explain the ARCHITECTURAL IMPLICATION
5. Each question must directly affect an architectural decision
6. If EA principles are provided, ensure at least one question probes alignment with key principles

Respond with ONLY this JSON:
{{
  "summary": "<one sentence restatement>",
  "detectedPatterns": {json.dumps(patterns)},
  "phase": 1,
  "phaseTitle": "Business & Functional Clarification",
  "questions": [
    {{
      "id": "q1",
      "question": "<specific question>",
      "why": "<architectural decision this drives>",
      "type": "text | choice | multi",
      "options": ["option1", "option2"]
    }}
  ]
}}"""

    persona = await _build_persona_with_principles(db)
    result = await call_ai(db, prompt, 2500, persona)
    parsed: dict[str, Any] = parse_json(result["text"])
    return parsed


# ---------------------------------------------------------------------------
# Phase 2 — Technical & Non-Functional Deep Dive
# ---------------------------------------------------------------------------


async def phase2_questions(
    db: AsyncSession,
    requirement: str,
    phase1_qa: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate Phase 2 technical deep-dive questions."""
    landscape = await load_landscape(db)
    ctx = _build_landscape_context(landscape)

    answers_text = "\n\n".join(
        f"Q: {qa.get('question', '')}\nA: {qa.get('answer', '')}" for qa in phase1_qa
    )

    prompt = f"""Original requirement: "{requirement}"

Phase 1 answers from the business stakeholder:
{answers_text}

{ctx}

TASK: Generate 5-6 Phase 2 TECHNICAL and NON-FUNCTIONAL deep-dive questions.

Phase 2 must cover NON-FUNCTIONAL REQUIREMENTS and TECHNICAL SPECIFICS:
1. RELIABILITY & AVAILABILITY (SLA, RPO/RTO, failover)
2. SCALABILITY & PERFORMANCE (TPS, peak load, latency targets)
3. SECURITY & COMPLIANCE (data classification, regulations, auth)
4. INTEGRATION & DATA FLOW (sync vs async, consistency, idempotency)
5. OPERATIONAL EXCELLENCE (observability, deployment strategy)
6. BUILD vs BUY vs EXTEND

CRITICAL RULES:
1. Build on Phase 1 answers \u2014 do not repeat
2. Reference existing landscape systems
3. Each question must change a specific design decision in Phase 3
4. Consider alignment with EA principles when formulating technical questions

Respond with ONLY this JSON:
{{
  "phase": 2,
  "phaseTitle": "Technical & Non-Functional Deep Dive",
  "refined_requirement": "<updated requirement, 2-3 sentences>",
  "keyInsights": ["<insight from phase 1>"],
  "missingCapabilities": ["<critical capability not in landscape>"],
  "questions": [
    {{
      "id": "q1",
      "question": "<precise NFR or technical question>",
      "why": "<which quality attribute this drives>",
      "type": "text | choice | multi",
      "options": ["option1", "option2"],
      "nfrCategory": "reliability | scalability | security | performance | integration | operational" # noqa: E501
    }}
  ]
}}"""

    persona = await _build_persona_with_principles(db)
    result = await call_ai(db, prompt, 2800, persona)
    parsed: dict[str, Any] = parse_json(result["text"])
    return parsed


# ---------------------------------------------------------------------------
# Phase 3 — Architecture Generation (two-call pattern)
# ---------------------------------------------------------------------------


async def phase3_architecture(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate full architecture with landscape mapping + Mermaid diagram."""
    landscape = await load_landscape(db)
    ctx = _build_compact_context(landscape)
    patterns = _detect_intent_patterns(requirement)

    answers_text = "\n\n".join(
        f"Q{i + 1}: {qa.get('question', '')}\nA: {qa.get('answer', '')}"
        for i, qa in enumerate(all_qa)
    )

    # ── Call 1: Structured architecture ──────────────────────────────────
    logger.info("Phase 3 \u2014 Call 1: generating architecture structure...")

    structure_prompt = f"""You are generating a complete enterprise solution architecture.

REQUIREMENT: "{requirement}"
PATTERNS: {", ".join(patterns)}

ALL REQUIREMENTS ({len(all_qa)} questions answered):
{answers_text}

{ctx}

TASK: Generate the full architecture structure. Do NOT include a diagram.

RULES:
1. LANDSCAPE MAPPING: Mark 'existing' only if in landscape, 'recommended' for procurement, 'new' for custom-built. # noqa: E501
2. GAP ANALYSIS: For every missing capability, provide 3-4 named product recommendations.
3. INTEGRATION MAP: List every integration with protocol, direction, data flows.
4. Include ALL 7 sections below.
5. PRINCIPLE ALIGNMENT: Note when components or decisions align with or conflict with stated EA principles.

Respond with ONLY this JSON:
{{
  "title": "<architecture title>",
  "summary": "<3-4 sentence executive summary>",
  "architecturalPattern": "<e.g. Event-Driven Microservices>",
  "estimatedComplexity": "low | medium | high | very_high",
  "estimatedDuration": "<e.g. 3-6 months MVP>",
  "nfrDecisions": {{
    "availability": "<SLA and resilience>",
    "scalability": "<scaling strategy>",
    "security": "<security approach>",
    "integration": "<integration pattern>"
  }},
  "layers": [
    {{
      "name": "<layer name>",
      "components": [
        {{ "name": "<name>", "type": "existing | new | recommended", "product": "<vendor/product>", "category": "<tech category>", "role": "<1-2 sentences>", "notes": "<optional>" }} # noqa: E501
      ]
    }}
  ],
  "gaps": [
    {{
      "capability": "<missing capability>",
      "impact": "<what breaks>",
      "urgency": "critical | high | medium",
      "recommendations": [
        {{ "name": "<product>", "vendor": "<vendor>", "why": "<fit>", "pros": ["..."], "cons": ["..."], "estimatedCost": "<range>", "integrationEffort": "low | medium | high", "recommended": true }} # noqa: E501
      ]
    }}
  ],
  "integrations": [
    {{ "from": "<source>", "to": "<target>", "protocol": "<REST|GraphQL|Event|Batch|gRPC>", "direction": "sync | async | batch", "dataFlows": "<data>", "notes": "<decision>" }} # noqa: E501
  ],
  "risks": [
    {{ "risk": "<risk>", "severity": "high | medium | low", "mitigation": "<strategy>" }}
  ],
  "nextSteps": [
    {{ "step": "<action>", "owner": "<role>", "timeline": "<timeframe>", "effort": "S | M | L | XL" }} # noqa: E501
  ]
}}"""

    persona = await _build_persona_with_principles(db)
    struct_result = await call_ai(db, structure_prompt, 8000, persona)
    result: dict[str, Any] = parse_json(struct_result["text"])

    # Check for truncation
    required_sections = ["layers", "gaps", "integrations", "risks", "nextSteps"]
    missing_sections = [
        s
        for s in required_sections
        if not result.get(s) or (isinstance(result.get(s), list) and not result[s])
    ]

    if missing_sections and struct_result.get("truncated"):
        logger.warning(
            "Call 1 truncated \u2014 missing: %s. Retrying...", ", ".join(missing_sections)
        )
        retry_prompt = f"""The previous architecture generation was truncated. Here is what was generated: # noqa: E501
{json.dumps(result, indent=2)}

Generate ONLY the missing sections: {", ".join(missing_sections)}

Context:
REQUIREMENT: "{requirement}"
{ctx}

Respond with ONLY a JSON object containing the missing sections."""

        try:
            retry_result = await call_ai(db, retry_prompt, 6000, persona)
            retry_data = parse_json(retry_result["text"])
            for section in missing_sections:
                if retry_data.get(section):
                    result[section] = retry_data[section]
        except Exception as e:
            logger.warning("Retry failed: %s", e)

    # Cross-reference against landscape
    vendor_names = {v.get("vendor_name", "").lower() for v in landscape.get("vendors", [])}
    app_names = {a.get("name", "").lower() for a in landscape.get("apps", [])}

    if result.get("layers"):
        for layer in result["layers"]:
            for comp in layer.get("components", []):
                lookup = (comp.get("product") or comp.get("name", "")).lower()
                comp["existsInLandscape"] = (
                    lookup in vendor_names
                    or lookup in app_names
                    or any(lookup.startswith(v.split()[0]) for v in vendor_names if v)
                    or any(lookup.startswith(a.split()[0]) for a in app_names if a)
                )
                if comp["existsInLandscape"] and comp.get("type") != "new":
                    comp["type"] = "existing"

    # Diagram is now rendered client-side from structured layers/integrations
    # using React Flow — no Mermaid generation needed.
    return result
