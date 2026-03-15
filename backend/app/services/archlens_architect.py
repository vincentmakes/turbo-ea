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
from app.models.card_type import CardType
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


async def phase1_questions(
    db: AsyncSession,
    requirement: str,
    objective_ids: list[str] | None = None,
    selected_capabilities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Generate Phase 1 business clarification questions."""
    landscape = await load_landscape(db)
    ctx = _build_landscape_context(landscape)
    patterns = _detect_intent_patterns(requirement)
    objectives_ctx = await _load_objectives_context(db, objective_ids)
    caps_ctx = _build_capabilities_context(selected_capabilities)

    prompt = f"""A stakeholder has submitted this architecture requirement:
"{requirement}"
{objectives_ctx}{caps_ctx}
{ctx}

DETECTED ARCHITECTURE INTENT: {", ".join(patterns)}

TASK: Generate 5-6 targeted Phase 1 questions as a principal enterprise architect.

Phase 1 focuses on FUNCTIONAL and BUSINESS requirements:
- Business context: who uses it, what problem it solves, what success looks like
- Functional scope: key capabilities, user journeys, integrations needed
- Data: what data flows, ownership, sensitivity
- Stakeholders: who owns the system, who are the consumers
- Timeline and phasing: MVP vs full rollout

The user has already identified their business objectives and target capabilities
(shown above). Tailor your questions to explore HOW those capabilities should be
improved or introduced, not WHETHER they are the right ones.

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
    objective_ids: list[str] | None = None,
    selected_capabilities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Generate Phase 2 technical deep-dive questions."""
    landscape = await load_landscape(db)
    ctx = _build_landscape_context(landscape)
    objectives_ctx = await _load_objectives_context(db, objective_ids)
    caps_ctx = _build_capabilities_context(selected_capabilities)

    answers_text = "\n\n".join(
        f"Q: {qa.get('question', '')}\nA: {qa.get('answer', '')}" for qa in phase1_qa
    )

    prompt = f"""Original requirement: "{requirement}"
{objectives_ctx}{caps_ctx}
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
# Metamodel type context for AI prompts
# ---------------------------------------------------------------------------


async def _load_metamodel_types_context(db: AsyncSession) -> str:
    """Load card types and format them for AI prompt context."""
    result = await db.execute(
        select(CardType)
        .where(CardType.is_hidden.is_(False))
        .order_by(CardType.sort_order, CardType.key)
    )
    types = result.scalars().all()
    if not types:
        return ""

    lines = [
        "",
        "=== METAMODEL CARD TYPES ===",
        "Tag each component with a cardTypeKey from this list:",
        "",
    ]
    for ct in types:
        subtypes = ct.subtypes or []
        sub_labels = [s.get("label", s.get("key", "")) for s in subtypes]
        sub_str = f" (subtypes: {', '.join(sub_labels)})" if sub_labels else ""
        lines.append(f"- {ct.key}: {ct.label}{sub_str}")
    lines.append("")
    return "\n".join(lines)


async def _load_relation_types_context(db: AsyncSession) -> str:
    """Load relation types and format for AI prompt context."""
    result = await db.execute(select(RelationType).where(RelationType.is_hidden.is_(False)))
    rtypes = result.scalars().all()
    if not rtypes:
        return ""

    lines = [
        "",
        "=== METAMODEL RELATION TYPES (STRICT — only these relations are allowed) ===",
        "Each relation type defines which source card type can relate to which target card type.",
        "You MUST only propose relations using these exact keys AND matching source/target types.",
        "If a relation type says 'Application → ITComponent', you CANNOT use it between",
        "BusinessCapability → ITComponent. Choose the card type that fits the available relations.",
        "",
    ]
    # Group by source type for easier AI lookup
    by_source: dict[str, list[str]] = {}
    for rt in rtypes:
        entry = f'  - {rt.key}: → {rt.target_type_key} ("{rt.label}" / "{rt.reverse_label}")'
        by_source.setdefault(rt.source_type_key, []).append(entry)

    for src_type in sorted(by_source):
        lines.append(f"[{src_type}] can relate to:")
        lines.extend(by_source[src_type])
        lines.append("")

    lines.append(
        "IMPORTANT: When deciding which cardTypeKey to assign a proposed card, "
        "check which relation types connect it to other cards. For example, if "
        "a capability needs to be 'supported by' a component and that relation "
        "only exists from Application, then the component must be an Application, "
        "not an ITComponent."
    )
    lines.append("")
    return "\n".join(lines)


async def _load_existing_cards_context(db: AsyncSession) -> str:
    """Load ALL existing cards grouped by type for AI to reference exact names."""
    lookup_types = [
        "Application",
        "DataObject",
        "Interface",
        "ITComponent",
        "BusinessCapability",
        "Provider",
        "System",
    ]
    result = await db.execute(
        select(Card)
        .where(Card.type.in_(lookup_types), Card.status != "ARCHIVED")
        .order_by(Card.type, Card.name)
    )
    cards = result.scalars().all()
    if not cards:
        return ""

    by_type: dict[str, list[tuple[str, str]]] = {}
    for c in cards:
        by_type.setdefault(c.type, []).append((str(c.id), c.name))

    lines = [
        "",
        "=== ALL EXISTING CARDS (use EXACT names — do NOT invent variants) ===",
        'Format: "<UUID>": <name>',
        "Use the UUID as existingCardId when referencing existing cards in relations.",
        "",
    ]
    for card_type in lookup_types:
        entries = by_type.get(card_type, [])
        if entries:
            lines.append(f"[{card_type}]:")
            for card_id, name in entries:
                lines.append(f'  "{card_id}": {name}')
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Phase 3a — Capability Mapping (dependency-aware)
# ---------------------------------------------------------------------------


async def phase3_capability_mapping(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
    objective_ids: list[str],
    existing_dependencies: dict[str, Any],
    selected_option: dict[str, Any] | None = None,
    selected_recommendations: list[dict[str, Any]] | None = None,
    selected_capabilities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Analyse capability impact and propose new cards/relations for the architecture."""
    landscape = await load_landscape(db)
    ctx = _build_compact_context(landscape)
    metamodel_ctx = await _load_metamodel_types_context(db)
    rel_types_ctx = await _load_relation_types_context(db)
    patterns = _detect_intent_patterns(requirement)
    existing_cards_ctx = await _load_existing_cards_context(db)
    objectives_ctx = await _load_objectives_context(db, objective_ids)
    caps_ctx = _build_capabilities_context(selected_capabilities)

    answers_text = "\n\n".join(
        f"Q{i + 1}: {qa.get('question', '')}\nA: {qa.get('answer', '')}"
        for i, qa in enumerate(all_qa)
    )

    # Format existing dependency subgraph for the prompt
    dep_nodes = existing_dependencies.get("nodes", [])
    dep_edges = existing_dependencies.get("edges", [])

    dep_context_lines = ["=== EXISTING DEPENDENCY SUBGRAPH (from selected Objectives) ==="]
    if dep_nodes:
        by_type: dict[str, list[str]] = {}
        for n in dep_nodes:
            by_type.setdefault(n.get("type", "?"), []).append(n.get("name", "?"))
        for t, names in by_type.items():
            dep_context_lines.append(f"[{t}]: {', '.join(names[:15])}")

        dep_context_lines.append("")
        dep_context_lines.append("Existing relations:")
        for e in dep_edges[:40]:
            src_name = next((n["name"] for n in dep_nodes if n["id"] == e.get("source")), "?")
            tgt_name = next((n["name"] for n in dep_nodes if n["id"] == e.get("target")), "?")
            dep_context_lines.append(f"  {src_name} --[{e.get('type', '?')}]--> {tgt_name}")
    else:
        dep_context_lines.append("  (no existing dependencies found)")

    dep_context = "\n".join(dep_context_lines)

    # Build list of existing node IDs for the prompt
    existing_id_map = "\n".join(
        f'  "{n["id"]}": "{n["name"]}" ({n.get("type", "?")})' for n in dep_nodes
    )

    option_ctx = ""
    if selected_option:
        option_ctx = "\n" + _build_option_context(selected_option) + "\n"

    recs_ctx = ""
    if selected_recommendations:
        primary = [r for r in selected_recommendations if r.get("role") != "dependency"]
        deps = [r for r in selected_recommendations if r.get("role") == "dependency"]

        recs_lines = [
            "=== USER-SELECTED PRODUCTS & DEPENDENCIES (final decisions) ===",
            "These are the products the user has chosen. The target architecture",
            "MUST incorporate exactly these products — no substitutions, no additions.",
            "",
        ]
        if primary:
            recs_lines.append("PRIMARY PRODUCTS (selected in gap analysis):")
            for rec in primary:
                vendor = rec.get("vendor", "")
                vendor_str = f" ({vendor})" if vendor else ""
                recs_lines.append(
                    f"  - {rec.get('recommendation', '?')}{vendor_str}"
                    f" — for: {rec.get('capability', '?')}"
                )
                pros = rec.get("pros")
                if pros and isinstance(pros, list):
                    recs_lines.append(f"    Capabilities: {', '.join(pros)}")
                cons = rec.get("cons")
                if cons and isinstance(cons, list):
                    recs_lines.append(f"    Limitations: {', '.join(cons)}")
            recs_lines.append("")
        if deps:
            recs_lines.append("DEPENDENCY PRODUCTS (selected in dependency analysis):")
            for rec in deps:
                vendor = rec.get("vendor", "")
                vendor_str = f" ({vendor})" if vendor else ""
                recs_lines.append(
                    f"  - {rec.get('recommendation', '?')}{vendor_str}"
                    f" — for: {rec.get('capability', '?')}"
                )
            recs_lines.append("")

        recs_lines.append(
            "Build the target architecture using EXACTLY these products. "
            "Create cards, providers, interfaces, and ITComponents for each. "
            "Respect the product capabilities listed above — if a product has "
            "native integration with an existing system, connect them directly "
            "via an Interface, do NOT introduce additional middleware."
        )
        recs_ctx = "\n".join(recs_lines)

    prompt = f"""You are analysing the capability impact of a new architecture requirement
on an existing enterprise landscape.

REQUIREMENT: "{requirement}"
PATTERNS: {", ".join(patterns)}
{objectives_ctx}{caps_ctx}{option_ctx}
{recs_ctx}
ALL REQUIREMENTS ({len(all_qa)} questions answered):
{answers_text}

{dep_context}

{ctx}
{existing_cards_ctx}
{metamodel_ctx}
{rel_types_ctx}
EXISTING NODE IDs (use these exact IDs when referencing existing cards):
{existing_id_map}

TASK: Build a COMPLETE target architecture for this requirement. Propose new cards
and ALL relations needed for a coherent, fully-connected architecture graph.
The output must be ready to import into the EA tool — no missing connections.
{"Base the analysis on the SELECTED SOLUTION APPROACH above." if selected_option else ""}

RULES:
1. For EXISTING capabilities/cards in the dependency subgraph, use their exact "id"
   from the node list above. Set "isNew": false and "existingCardId" to that UUID.
2. For NEW capabilities/cards not in the landscape, generate a temporary id like
   "new_cap_1", "new_app_1", etc. Set "isNew": true.
3. Every proposed card MUST have a valid "cardTypeKey" from the metamodel.
4. CRITICAL — RELATION TYPE COMPLIANCE: Every proposed relation MUST use a valid
   "relationType" key from the METAMODEL RELATION TYPES section. The source card's
   cardTypeKey MUST match the relation type's source_type_key, and the target card's
   cardTypeKey MUST match the relation type's target_type_key. Check available
   relation types BEFORE assigning a cardTypeKey. If a product is infrastructure
   (see rule 12) but needs to support a BusinessCapability, do NOT retype it as
   Application — instead type it as ITComponent and connect it to an Application
   that supports the capability. The chain is: Application -[relAppToBC]-> Capability
   AND Application -[relAppToITC]-> ITComponent.
5. Include relations that connect proposed new cards to existing cards AND to each other.
6. Be specific: name real products for recommended purchases, name existing systems for reuse.
7. Provide a clear "rationale" for each new capability and card.
8. Do NOT invent relation types. If no relation type exists between two card types,
   do NOT propose that relation — restructure the card types instead.
9. NAMING — REUSE EXISTING: Check the ALL EXISTING CARDS list above. If a card
   with the same product or concept already exists, use its EXACT name, its UUID
   as "id" and "existingCardId", and mark isNew: false. Do NOT create variants
   like "X Enhanced", "X Extended", "X Platform", or "X Hub". If you need to
   describe changes to an existing system, use the existing name and explain
   the change in the rationale field.
10. NAMING — CLEAN DOMAIN ENTITIES: For DataObjects, use concise domain entity
    names (e.g. "Lead", "Customer", "Order"), NOT descriptive phrases like
    "Enriched Lead Data" or "Customer Profile Data". DataObjects represent
    data entities, not processes or states.
11. CAPABILITIES — STRICTLY FROM USER SELECTIONS: The user has already selected
    target capabilities in Business Requirements. Use ONLY those capabilities
    (listed in TARGET BUSINESS CAPABILITIES above) plus any existing capabilities
    already in the landscape. Do NOT invent new BusinessCapability cards.
    If you think a capability is missing, fold it into the rationale of the
    closest selected capability instead.
12. CARD TYPE CLASSIFICATION:
    - Application: Business-facing software that users interact with or that delivers
      business logic (e.g. "Apollo", "SAP S/4HANA", "Salesforce CRM", a custom app).
      Use subtype "businessApplication" for COTS/SaaS products configured for business use.
    - ITComponent: Infrastructure, platform, or technical middleware that Applications
      run on or use — users do NOT interact with it directly. Examples: databases
      (PostgreSQL), API gateways (Azure API Management, Kong), message brokers (Kafka,
      RabbitMQ), cloud platforms (AWS Lambda), monitoring (Datadog), identity providers
      (Okta, Azure AD), ETL tools, CI/CD pipelines. Use subtypes: saas, paas, iaas,
      software, hardware, service as appropriate.
    - Interface: A named integration point or data flow between two systems. Represents
      an API contract or sync (e.g. "Apollo → D365 Sync", "REST API: Orders").
      Use subtypes: api, logicalInterface as appropriate.
    KEY TEST: "Does a business user use this product directly?" → Application.
    "Is this infrastructure that developers/IT teams manage?" → ITComponent.
    "Is this a data flow or API between two systems?" → Interface.
13. INTERFACE CONNECTIVITY: Every Interface represents a data flow BETWEEN two
    Applications. You MUST create TWO relAppToInterface relations for each
    Interface — one from each endpoint Application. Example: for interface
    "App A → App B Sync", create:
      {{ sourceId: "app_a_id", targetId: "interface_id", relationType: "relAppToInterface" }}
      {{ sourceId: "app_b_id", targetId: "interface_id", relationType: "relAppToInterface" }}
    If one endpoint is an existing Application, use its existing ID.
14. COMPLETENESS CHECKLIST — verify EVERY proposed card has all required relations:

    For each APPLICATION:
    - At least one relAppToBC connecting it to a BusinessCapability it supports
    - A relProviderToApp from its vendor/Provider (create a Provider card if needed)
    - At least one relAppToITC to the ITComponent it runs on or depends on
      (the platform, runtime, or SaaS product — create the ITComponent if needed)
    - relAppToInterface for each Interface it provides or consumes

    For each INTERFACE:
    - relAppToInterface from BOTH endpoint Applications (see rule 13)
    - relInterfaceToDataObj if it transfers a specific data entity

    For each ITCOMPONENT:
    - At least one relAppToITC from the Application that uses it
    - A relProviderToITC from its vendor if it is a commercial product

    For each PROVIDER:
    - At least one relProviderToApp or relProviderToITC

    NO ORPHAN CARDS. Every card must have at least one relation.
    Run through this checklist mentally before outputting your JSON.
15. L1 DEPENDENCIES — CONNECT TO EXISTING CARDS: When a proposed Interface or
    relation involves an EXISTING application, ITComponent, or provider from the
    ALL EXISTING CARDS list, you MUST use that card's UUID as the sourceId or
    targetId. Do NOT omit a relation just because the other card already exists.
    For example, if you propose interface "D365 → ZoomInfo Sync", and D365 CRM
    exists in the landscape with UUID "abc-123", create:
      {{ sourceId: "abc-123", targetId: "new_iface_1", relationType: "relAppToInterface" }}
    This ensures the target architecture connects to the existing landscape.

Respond with ONLY this JSON:
{{
  "summary": "<2-3 sentence analysis of capability impact>",
  "capabilities": [
    {{
      "id": "<existing UUID or new_cap_N>",
      "name": "<capability name>",
      "isNew": false,
      "existingCardId": "<UUID if existing, omit if new>",
      "rationale": "<why this capability is relevant or needed>"
    }}
  ],
  "proposedCards": [
    {{
      "id": "<new_app_N or new_itc_N etc>",
      "name": "<card name>",
      "cardTypeKey": "<metamodel type key>",
      "subtype": "<optional subtype>",
      "isNew": true,
      "rationale": "<why this card is needed>"
    }}
  ],
  "proposedRelations": [
    {{
      "sourceId": "<id from capabilities, proposedCards, or existing nodes>",
      "targetId": "<id from capabilities, proposedCards, or existing nodes>",
      "relationType": "<relation type key from metamodel>",
      "label": "<relation label>"
    }}
  ]
}}"""  # noqa: E501

    persona = await _build_persona_with_principles(db)
    result = await call_ai(db, prompt, 6000, persona)
    parsed: dict[str, Any] = parse_json(result["text"])

    # Attach existing dependency graph so frontend can merge
    parsed["existingDependencies"] = existing_dependencies

    return parsed


# ---------------------------------------------------------------------------
# Objective context loader
# ---------------------------------------------------------------------------


async def _load_objectives_context(db: AsyncSession, objective_ids: list[str] | None) -> str:
    """Load selected Objective cards and format as prompt context."""
    if not objective_ids:
        return ""

    from uuid import UUID

    valid_ids = []
    for oid in objective_ids:
        try:
            valid_ids.append(UUID(oid))
        except (ValueError, TypeError):
            continue

    if not valid_ids:
        return ""

    result = await db.execute(select(Card).where(Card.id.in_(valid_ids)))
    objectives = result.scalars().all()
    if not objectives:
        return ""

    lines = [
        "",
        "=== SELECTED BUSINESS OBJECTIVES ===",
        "The architecture must serve these business objectives. Every proposed",
        "solution must trace back to improving a business capability that",
        "supports one of these objectives.",
        "",
    ]
    for obj in objectives:
        desc = (obj.description or "").strip()
        desc_str = f": {desc[:200]}" if desc else ""
        lines.append(f"- {obj.name}{desc_str}")
    lines.append("")
    return "\n".join(lines)


def _build_capabilities_context(
    selected_capabilities: list[dict[str, Any]] | None,
) -> str:
    """Format user-selected capabilities (existing + new) for AI prompt context."""
    if not selected_capabilities:
        return ""

    existing = [c for c in selected_capabilities if not c.get("isNew")]
    new = [c for c in selected_capabilities if c.get("isNew")]

    lines = [
        "",
        "=== TARGET BUSINESS CAPABILITIES ===",
        "The user has identified these capabilities as the focus of this initiative.",
        "",
    ]
    if existing:
        lines.append("Existing capabilities to IMPROVE:")
        for c in existing:
            lines.append(f"  - {c.get('name', '?')}")
    if new:
        lines.append("New capabilities to INTRODUCE:")
        for c in new:
            lines.append(f"  - {c.get('name', '?')}")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Phase 3a — Solution Options
# ---------------------------------------------------------------------------


async def phase3_options(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
    objective_ids: list[str] | None = None,
    selected_capabilities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Generate 2-4 solution options with architectural impact previews."""
    landscape = await load_landscape(db)
    ctx = _build_compact_context(landscape)
    metamodel_ctx = await _load_metamodel_types_context(db)
    patterns = _detect_intent_patterns(requirement)
    objectives_ctx = await _load_objectives_context(db, objective_ids)
    caps_ctx = _build_capabilities_context(selected_capabilities)

    answers_text = "\n\n".join(
        f"Q{i + 1}: {qa.get('question', '')}\nA: {qa.get('answer', '')}"
        for i, qa in enumerate(all_qa)
    )

    prompt = f"""You are a principal enterprise architect proposing solution approaches.

REQUIREMENT: "{requirement}"
PATTERNS: {", ".join(patterns)}
{objectives_ctx}{caps_ctx}
ALL REQUIREMENTS ({len(all_qa)} questions answered):
{answers_text}

{ctx}
{metamodel_ctx}
TASK: Propose 2-4 distinct solution approaches for this requirement.

Each approach must clearly explain:
1. Which BUSINESS CAPABILITIES it improves or introduces (capabilities that
   directly support the selected business objectives above).
2. What concrete solution components are needed to enable those capabilities.

The chain is: Business Objective → Business Capability → Solution.
Every option must trace back to the objectives.

Each approach should represent a fundamentally different strategy
(e.g. buy a product, extend an existing system, build custom, reuse
components from the landscape).

RULES:
1. Each option MUST have a different "approach" type: buy, build, extend, or reuse.
2. Reference SPECIFIC systems from the existing landscape where relevant.
3. Tag every component in impactPreview with a "cardTypeKey" from the metamodel.
4. impactPreview shows the architectural delta — what changes if this option is chosen.
5. Be concrete: name real products for "buy", name existing systems for "extend"/"reuse".
6. The "summary" of each option MUST explain which business capabilities are
   improved or created and how they serve the business objectives.

Respond with ONLY this JSON:
{{
  "summary": "<one sentence restating the requirement and its business objectives>",
  "options": [
    {{
      "id": "opt_1",
      "title": "<concise option title>",
      "approach": "buy | build | extend | reuse",
      "summary": "<2-3 sentences: which capabilities this improves/creates and how>",
      "estimatedCost": "<cost range>",
      "estimatedDuration": "<timeline>",
      "estimatedComplexity": "low | medium | high | very_high",
      "pros": ["<advantage 1>", "<advantage 2>"],
      "cons": ["<disadvantage 1>", "<disadvantage 2>"],
      "impactPreview": {{
        "newComponents": [
          {{ "name": "<name>", "cardTypeKey": "<type key>", "subtype": "<subtype>", "role": "<what it does>" }}
        ],
        "modifiedComponents": [
          {{ "name": "<existing system>", "cardTypeKey": "<type key>", "change": "<what changes>" }}
        ],
        "newIntegrations": [
          {{ "from": "<source>", "to": "<target>", "protocol": "<REST|GraphQL|Event|gRPC>" }}
        ],
        "retiredComponents": [
          {{ "name": "<system to retire>", "cardTypeKey": "<type key>", "role": "<current role>" }}
        ]
      }}
    }}
  ]
}}"""  # noqa: E501

    persona = await _build_persona_with_principles(db)
    result = await call_ai(db, prompt, 4000, persona)
    parsed: dict[str, Any] = parse_json(result["text"])
    return parsed


# ---------------------------------------------------------------------------
# Phase 3b — Gap Analysis for Selected Option
# ---------------------------------------------------------------------------


def _build_option_context(selected_option: dict[str, Any]) -> str:
    """Build a text block describing the selected solution option."""
    impact = selected_option.get("impactPreview") or {}
    impact_lines: list[str] = []
    for comp in impact.get("newComponents") or []:
        role = f" — {comp['role']}" if comp.get("role") else ""
        impact_lines.append(
            f"  + ADD: {comp.get('name', '?')} [{comp.get('cardTypeKey', 'Application')}]{role}"
        )
    for comp in impact.get("modifiedComponents") or []:
        change = f" — {comp['change']}" if comp.get("change") else ""
        impact_lines.append(
            f"  ~ MODIFY: {comp.get('name', '?')} "
            f"[{comp.get('cardTypeKey', 'Application')}]{change}"
        )
    for intg in impact.get("newIntegrations") or []:
        proto = f" ({intg['protocol']})" if intg.get("protocol") else ""
        impact_lines.append(
            f"  > INTEGRATE: {intg.get('from', '?')} → {intg.get('to', '?')}{proto}"
        )
    for comp in impact.get("retiredComponents") or []:
        impact_lines.append(f"  - RETIRE: {comp.get('name', '?')} [{comp.get('cardTypeKey', '')}]")
    impact_block = "\n".join(impact_lines) if impact_lines else "  (no impact details)"

    return f"""=== SELECTED SOLUTION APPROACH ===
Title: {selected_option.get("title", "")}
Approach: {selected_option.get("approach", "")}
Summary: {selected_option.get("summary", "")}
Estimated Cost: {selected_option.get("estimatedCost", "N/A")}
Estimated Duration: {selected_option.get("estimatedDuration", "N/A")}

ARCHITECTURAL IMPACT:
{impact_block}"""


async def phase3_gaps(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
    selected_option: dict[str, Any],
    objective_ids: list[str] | None = None,
    selected_capabilities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Phase 3b: identify the products needed to achieve the business requirements."""
    landscape = await load_landscape(db)
    ctx = _build_compact_context(landscape)
    metamodel_ctx = await _load_metamodel_types_context(db)
    patterns = _detect_intent_patterns(requirement)
    objectives_ctx = await _load_objectives_context(db, objective_ids)
    caps_ctx = _build_capabilities_context(selected_capabilities)

    answers_text = "\n\n".join(
        f"Q{i + 1}: {qa.get('question', '')}\nA: {qa.get('answer', '')}"
        for i, qa in enumerate(all_qa)
    )

    option_ctx = _build_option_context(selected_option)

    prompt = f"""You are a principal enterprise architect identifying the products needed \
to achieve the business requirements.

REQUIREMENT: "{requirement}"
PATTERNS: {", ".join(patterns)}
{objectives_ctx}{caps_ctx}
{option_ctx}

ALL REQUIREMENTS ({len(all_qa)} questions answered):
{answers_text}

{ctx}
{metamodel_ctx}
TASK: For the selected approach, identify ONLY the products that are needed to
achieve the business requirements — nothing more.

The chain is: Business Objective → Business Capability → Product/Solution.
Each gap represents a business capability that needs to be enabled or improved
to achieve the business objectives. The product recommendation is what fulfils
that capability gap.

Do NOT over-engineer: only include the products strictly required by this
approach to deliver the business capabilities. Skip anything the existing
landscape already covers.

RULES:
1. Each gap must name the BUSINESS CAPABILITY it addresses and explain which
   business objective it supports.
2. The recommendation for each gap is the product that best fulfils that
   capability need — mark it "recommended": true.
3. Include 1-2 alternatives only when genuine alternatives exist for that
   specific capability gap. Do not pad with unrelated products.
4. Aim for 1-3 total gaps. Only include capabilities that are genuinely
   missing and required — not sub-components of the main product.
5. Each recommendation must name a REAL product/vendor with concrete pros/cons.
6. Include integration effort and cost estimates for each recommendation.

Respond with ONLY this JSON:
{{
  "summary": "<1-2 sentences: which business capabilities are being addressed and why>",
  "gaps": [
    {{
      "capability": "<business capability to enable/improve>",
      "impact": "<which business objective this supports and why>",
      "urgency": "critical | high | medium",
      "recommendations": [
        {{
          "name": "<product name>",
          "vendor": "<vendor>",
          "why": "<why this product fulfils the capability>",
          "pros": ["<advantage>"],
          "cons": ["<disadvantage>"],
          "estimatedCost": "<cost range>",
          "integrationEffort": "low | medium | high",
          "recommended": true
        }}
      ]
    }}
  ]
}}"""  # noqa: E501

    persona = await _build_persona_with_principles(db)
    result = await call_ai(db, prompt, 4000, persona)
    parsed: dict[str, Any] = parse_json(result["text"])
    return parsed


async def phase3_deps(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
    selected_option: dict[str, Any],
    selected_products: list[dict[str, Any]],
) -> dict[str, Any]:
    """Phase 3c: identify hard dependencies for the products picked in 3b."""
    landscape = await load_landscape(db)
    ctx = _build_compact_context(landscape)
    patterns = _detect_intent_patterns(requirement)

    answers_text = "\n\n".join(
        f"Q{i + 1}: {qa.get('question', '')}\nA: {qa.get('answer', '')}"
        for i, qa in enumerate(all_qa)
    )

    option_ctx = _build_option_context(selected_option)

    # Build the picked products context with pros/cons for integration awareness
    picks_lines: list[str] = []
    for sp in selected_products:
        line = f"  - {sp.get('name', '?')}"
        if sp.get("vendor"):
            line += f" ({sp['vendor']})"
        line += f" — for: {sp.get('capability', '?')}"
        picks_lines.append(line)
        pros = sp.get("pros")
        if pros and isinstance(pros, list):
            picks_lines.append(f"    Pros: {', '.join(pros)}")
        cons = sp.get("cons")
        if cons and isinstance(cons, list):
            picks_lines.append(f"    Cons: {', '.join(cons)}")
    picks_block = "\n".join(picks_lines) if picks_lines else "  (none)"

    prompt = f"""You are a principal enterprise architect analysing integration dependencies.

REQUIREMENT: "{requirement}"
PATTERNS: {", ".join(patterns)}

{option_ctx}

=== SELECTED PRODUCTS ===
The user has chosen these specific products:
{picks_block}

ALL REQUIREMENTS ({len(all_qa)} questions answered):
{answers_text}

{ctx}
TASK: For the selected products above, identify the hard dependencies —
connectors, middleware, adapters, or infrastructure components — that are
REQUIRED to make these products work in this organisation's existing landscape.

Focus exclusively on what the selected products NEED to integrate and operate.
For example: if the user picked Salesforce, they might need MuleSoft for API
integration with their existing ERP — but only if no integration layer exists.

RULES:
1. ONLY include dependencies that are directly required by the selected products.
2. Check the existing landscape — if a dependency is already covered (e.g. an
   API gateway already exists), skip it entirely.
3. NATIVE INTEGRATIONS: Read the product Pros carefully. If a selected product
   already has native/built-in integration with an existing system (e.g. "Native
   D365 integration"), do NOT propose middleware or connectors for that integration.
   The product handles it natively — no additional tooling is needed.
4. Each dependency should name 2-3 REAL product options with pros/cons.
5. Aim for 0-3 dependencies total. Zero is valid and preferred if products have
   native integrations. Fewer is better — do NOT over-engineer.
6. Mark the best-fit product as "recommended": true.
7. Explain WHY each dependency is needed (which selected product requires it
   and what for).

Respond with ONLY this JSON:
{{
  "summary": "<1-2 sentence overview of the integration requirements>",
  "dependencies": [
    {{
      "need": "<what is needed, e.g. API Integration Layer>",
      "reason": "<which selected product needs this and why>",
      "urgency": "critical | high | medium",
      "options": [
        {{
          "name": "<product name>",
          "vendor": "<vendor>",
          "why": "<why this product fits>",
          "pros": ["<advantage>"],
          "cons": ["<disadvantage>"],
          "estimatedCost": "<cost range>",
          "integrationEffort": "low | medium | high",
          "recommended": true
        }}
      ]
    }}
  ]
}}"""  # noqa: E501

    persona = await _build_persona_with_principles(db)
    result = await call_ai(db, prompt, 3000, persona)
    parsed: dict[str, Any] = parse_json(result["text"])
    return parsed


# ---------------------------------------------------------------------------
# Phase 3c — Architecture Generation (two-call pattern, legacy)
# ---------------------------------------------------------------------------


async def phase3_architecture(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
    selected_option: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate full architecture with landscape mapping."""
    landscape = await load_landscape(db)
    ctx = _build_compact_context(landscape)
    metamodel_ctx = await _load_metamodel_types_context(db)
    patterns = _detect_intent_patterns(requirement)

    answers_text = "\n\n".join(
        f"Q{i + 1}: {qa.get('question', '')}\nA: {qa.get('answer', '')}"
        for i, qa in enumerate(all_qa)
    )

    # Build selected option context if provided
    option_ctx = ""
    if selected_option:
        impact = selected_option.get("impactPreview") or {}
        impact_lines: list[str] = []
        for comp in impact.get("newComponents") or []:
            role = f" — {comp['role']}" if comp.get("role") else ""
            impact_lines.append(
                f"  + ADD: {comp.get('name', '?')} [{comp.get('cardTypeKey', 'Application')}]{role}"
            )
        for comp in impact.get("modifiedComponents") or []:
            change = f" — {comp['change']}" if comp.get("change") else ""
            impact_lines.append(
                f"  ~ MODIFY: {comp.get('name', '?')} "
                f"[{comp.get('cardTypeKey', 'Application')}]{change}"
            )
        for intg in impact.get("newIntegrations") or []:
            proto = f" ({intg['protocol']})" if intg.get("protocol") else ""
            impact_lines.append(
                f"  > INTEGRATE: {intg.get('from', '?')} → {intg.get('to', '?')}{proto}"
            )
        for comp in impact.get("retiredComponents") or []:
            impact_lines.append(
                f"  - RETIRE: {comp.get('name', '?')} [{comp.get('cardTypeKey', '')}]"
            )
        impact_block = "\n".join(impact_lines) if impact_lines else "  (no impact details)"

        option_ctx = f"""
=== SELECTED SOLUTION APPROACH (from Phase 3a options) ===
Title: {selected_option.get("title", "")}
Approach: {selected_option.get("approach", "")}
Summary: {selected_option.get("summary", "")}
Estimated Cost: {selected_option.get("estimatedCost", "N/A")}
Estimated Duration: {selected_option.get("estimatedDuration", "N/A")}

ARCHITECTURAL IMPACT (you MUST implement this):
{impact_block}

CRITICAL: The architecture you generate MUST be based on this specific option.
Include ALL components listed above. Do NOT generate a generic architecture.
Every ADD component must appear in a layer, every INTEGRATE must appear in integrations.
Every RETIRE should be noted. Reuse existing landscape systems where the option says so.
"""

    # ── Call 1: Structured architecture ──────────────────────────────────
    logger.info("Phase 3 — Call 1: generating architecture structure...")

    structure_prompt = f"""You are generating a complete enterprise solution architecture.

REQUIREMENT: "{requirement}"
PATTERNS: {", ".join(patterns)}
{option_ctx}
ALL REQUIREMENTS ({len(all_qa)} questions answered):
{answers_text}

{ctx}
{metamodel_ctx}
TASK: Generate the full architecture structure. Do NOT include a diagram.

RULES:
1. LANDSCAPE MAPPING: Mark 'existing' only if in landscape, 'recommended' for procurement, 'new' for custom-built.
2. GAP ANALYSIS: For every missing capability, provide 3-4 named product recommendations.
3. INTEGRATION MAP: List EVERY integration between components ACROSS ALL LAYERS. Each pair of connected components MUST have an integration entry. Use EXACT component names from the layers section as the "from" and "to" values. Include cross-layer integrations (e.g. business layer → integration layer → data layer).
4. Include ALL 7 sections below.
5. PRINCIPLE ALIGNMENT: Note when components or decisions align with or conflict with stated EA principles.
6. METAMODEL TAGGING: Tag each component with a "cardTypeKey" from the metamodel types list.
7. INTEGRATION NAMES: The "from" and "to" fields in integrations MUST exactly match component "name" fields from the layers section.

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
        {{ "name": "<name>", "type": "existing | new | recommended", "product": "<vendor/product>", "category": "<tech category>", "role": "<1-2 sentences>", "cardTypeKey": "<metamodel type key>", "notes": "<optional>" }}
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
