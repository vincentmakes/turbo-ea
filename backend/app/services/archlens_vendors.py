"""ArchLens Vendor Analysis + Resolution — ported from ai.js + resolution.js.

Queries the cards table directly (no fact_sheets copy) and calls AI to:
  1. Categorise vendors into 60+ industry categories
  2. Resolve vendor aliases into canonical hierarchy
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.archlens import ArchLensVendorAnalysis, ArchLensVendorHierarchy
from app.models.card import Card
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.archlens_ai import call_ai, parse_json

logger = logging.getLogger("turboea.archlens.vendors")

# ---------------------------------------------------------------------------
# Categories (ported from ai.js)
# ---------------------------------------------------------------------------

CATEGORIES = [
    # Core IT Infrastructure
    "Payment Provider",
    "Cloud Hosting & Infrastructure",
    "E-Commerce & CRM",
    "ERP & Finance",
    "Supply Chain & Logistics",
    "Collaboration & Productivity",
    "Security & Identity",
    "DevOps & Developer Tools",
    "Analytics & BI",
    "AI & Machine Learning",
    "API & Integration Middleware",
    "Database & Storage",
    "HR & Workforce",
    "IoT & OT",
    "Network & Connectivity",
    "Search Engine",
    "Logging Solution",
    "Monitoring Solution",
    "CMS Solution",
    # Financial Services & FinTech
    "Banking & Core Banking",
    "Trading & Capital Markets",
    "Risk & Compliance",
    "Insurance & Actuarial",
    "Wealth & Asset Management",
    "Treasury & Cash Management",
    # Healthcare & Life Sciences
    "Healthcare IT & EMR",
    "Clinical & Research",
    "Pharma & Drug Development",
    "Medical Devices & IoMT",
    "Genomics & Bioinformatics",
    "Telehealth & Digital Health",
    "Healthcare Analytics",
    # Energy & Utilities
    "Energy Trading & ETRM",
    "Smart Grid & Metering",
    "Renewable Energy Systems",
    "Oil & Gas Operations",
    "Utilities CIS & Billing",
    # Manufacturing & Industrial
    "Manufacturing Execution (MES)",
    "Quality Management (QMS)",
    "Product Lifecycle (PLM)",
    "Maintenance & Asset (EAM)",
    # Industry-Agnostic
    "Document Management",
    "Marketing Automation",
    "Legal & Contract Management",
    "Sustainability & ESG",
    "Other",
]

CATEGORY_EXAMPLES = {
    "Payment Provider": "Adyen, Computop, Stripe, Klarna, Worldline, PayPal",
    "Cloud Hosting & Infrastructure": "Azure, AWS, Google Cloud, Cloudflare",
    "E-Commerce & CRM": "Spryker, SAP Commerce, Salesforce, Magento",
    "ERP & Finance": "SAP S/4HANA, SAP ECC, Oracle ERP",
    "Supply Chain & Logistics": "SAP TM, SAP EWM, Manhattan Associates",
    "Collaboration & Productivity": "Atlassian, Jira, ServiceNow, Microsoft 365",
    "Security & Identity": "CrowdStrike, Fortinet, Okta, SailPoint",
    "DevOps & Developer Tools": "Jenkins, GitHub, GitLab, SonarQube",
    "Analytics & BI": "SAP BW, Power BI, Tableau, Databricks",
    "AI & Machine Learning": "Azure ML, Google Vertex AI, OpenAI",
    "API & Integration Middleware": "MuleSoft, SAP Integration Suite, Apache Kafka",
    "Database & Storage": "Oracle DB, SQL Server, PostgreSQL, MongoDB",
    "HR & Workforce": "SAP SuccessFactors, Workday, ADP",
    "IoT & OT": "Siemens, Bosch IoT, PTC ThingWorx",
    "Network & Connectivity": "Cisco, Juniper, F5, Zscaler",
    "Search Engine": "Elasticsearch, Solr, Algolia",
    "Logging Solution": "Splunk, ELK Stack, Datadog, Graylog",
    "Monitoring Solution": "Dynatrace, New Relic, Datadog, Prometheus",
    "CMS Solution": "WordPress, Contentful, Adobe Experience Manager",
}


# ---------------------------------------------------------------------------
# Data loading from cards table
# ---------------------------------------------------------------------------


async def _load_cards_with_vendors(
    db: AsyncSession,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load Application/ITComponent cards with their Provider relations."""
    # Find Provider relation type keys (both directions in one query)
    rt_result = await db.execute(
        select(RelationType.key).where(
            (RelationType.target_type_key == "Provider")
            | (RelationType.source_type_key == "Provider")
        )
    )
    all_provider_rel_keys = [r[0] for r in rt_result.all()]

    # Load all relevant cards
    cards_result = await db.execute(
        select(Card).where(
            Card.type.in_(["Application", "ITComponent"]),
            Card.status != "ARCHIVED",
        )
    )
    app_cards = cards_result.scalars().all()

    # Load Provider cards
    provider_result = await db.execute(
        select(Card).where(Card.type == "Provider", Card.status != "ARCHIVED")
    )
    provider_cards = provider_result.scalars().all()

    # Build card ID -> card map
    card_map = {str(c.id): c for c in [*app_cards, *provider_cards]}

    # Load relations to Providers
    rels_result = await db.execute(select(Relation).where(Relation.type.in_(all_provider_rel_keys)))
    relations = rels_result.scalars().all()

    # Build card -> vendors mapping
    card_vendors: dict[str, list[str]] = {}
    for rel in relations:
        src_id = str(rel.source_id)
        tgt_id = str(rel.target_id)
        # Determine which side is the Provider
        if tgt_id in card_map and card_map[tgt_id].type == "Provider":
            if src_id not in card_vendors:
                card_vendors[src_id] = []
            card_vendors[src_id].append(card_map[tgt_id].name)
        elif src_id in card_map and card_map[src_id].type == "Provider":
            if tgt_id not in card_vendors:
                card_vendors[tgt_id] = []
            card_vendors[tgt_id].append(card_map[src_id].name)

    rows = []
    for card in app_cards:
        vendors = card_vendors.get(str(card.id), [])
        attrs = card.attributes or {}
        rows.append(
            {
                "id": str(card.id),
                "name": card.name,
                "type": card.type,
                "description": (card.description or "")[:200],
                "vendors": vendors,
                "annual_cost": attrs.get("costTotalAnnual", 0) or 0,
            }
        )

    provider_rows = []
    for card in provider_cards:
        attrs = card.attributes or {}
        provider_rows.append(
            {
                "id": str(card.id),
                "name": card.name,
                "description": (card.description or "")[:200],
                "annual_cost": attrs.get("costTotalAnnual", 0) or 0,
            }
        )

    return rows, provider_rows


# ---------------------------------------------------------------------------
# Vendor Analysis (port of analyseVendors from ai.js)
# ---------------------------------------------------------------------------


async def analyse_vendors(db: AsyncSession) -> dict[str, Any]:
    """Categorise vendors using AI. Returns {analysed, total}."""
    rows, provider_rows = await _load_cards_with_vendors(db)

    if not rows:
        return {
            "analysed": 0,
            "warning": "No vendor relationships found on Application or ITComponent cards.",
        }

    # Build vendor map
    vendor_map: dict[str, dict[str, Any]] = {}
    for row in rows:
        for v_name in row["vendors"]:
            v = v_name.strip()
            if not v:
                continue
            if v not in vendor_map:
                vendor_map[v] = {"apps": [], "totalCost": 0, "appDetails": []}
            vendor_map[v]["apps"].append(row["name"])
            vendor_map[v]["totalCost"] += float(row["annual_cost"] or 0)
            vendor_map[v]["appDetails"].append(
                {
                    "name": row["name"],
                    "type": row["type"],
                    "description": row["description"],
                }
            )

    # Include Provider cards themselves
    for row in provider_rows:
        v = row["name"].strip()
        if not v or v in vendor_map:
            continue
        vendor_map[v] = {
            "apps": [],
            "totalCost": float(row["annual_cost"] or 0),
            "appDetails": [],
            "providerDescription": row["description"],
        }

    vendor_list = sorted(
        [
            {
                "name": name,
                "appCount": len(d["apps"]),
                "totalCostEur": d["totalCost"],
                "sampleApps": d["apps"][:4],
                "appDetails": d["appDetails"][:4],
                "providerDescription": d.get("providerDescription", ""),
            }
            for name, d in vendor_map.items()
        ],
        key=lambda x: (-x["appCount"], -x["totalCostEur"]),
    )

    logger.info("%d unique vendors to categorise", len(vendor_list))

    examples_text = "\n".join(f'  "{cat}": {ex}' for cat, ex in CATEGORY_EXAMPLES.items())
    categories_text = "\n".join(f"- {c}" for c in CATEGORIES)

    batch_size = 15
    output_tokens = 1600
    now = datetime.now(timezone.utc)
    total_analysed = 0

    # Pre-load existing vendor names for batch upsert (#2: avoid N+1)
    existing_result = await db.execute(
        select(ArchLensVendorAnalysis.vendor_name, ArchLensVendorAnalysis.id)
    )
    existing_vendor_map: dict[str, ArchLensVendorAnalysis] = {}
    existing_ids: dict[str, Any] = {row[0]: row[1] for row in existing_result.all()}

    # Load full objects for those that exist
    if existing_ids:
        existing_objs_result = await db.execute(
            select(ArchLensVendorAnalysis).where(
                ArchLensVendorAnalysis.vendor_name.in_(existing_ids.keys())
            )
        )
        for obj in existing_objs_result.scalars().all():
            existing_vendor_map[obj.vendor_name] = obj

    for i in range(0, len(vendor_list), batch_size):
        batch = vendor_list[i : i + batch_size]
        batch_end = min(i + batch_size, len(vendor_list))

        batch_input = json.dumps(
            [
                {
                    "name": b["name"],
                    "sampleApps": b["sampleApps"],
                    "linkedApps": [
                        {"name": a["name"], "type": a["type"], "description": a["description"]}
                        for a in b["appDetails"]
                    ],
                    "providerInfo": b["providerDescription"] or None,
                }
                for b in batch
            ]
        )

        prompt = f"""You are a principal enterprise architect at a large enterprise company.
Categorise each IT vendor/product into EXACTLY ONE category from this list:
{categories_text}

Examples per category:
{examples_text}

IMPORTANT: Analyze linked Applications/ITComponents descriptions to understand vendor purpose
Only use "Other" if truly no category fits

Vendors ({i + 1}\u2013{batch_end} of {len(vendor_list)}):
{batch_input}

IMPORTANT:
- Return ONLY a valid complete JSON array. No markdown. No truncation.
- Every vendor in the input MUST have an entry in the output.
[{{"name":"...","category":"...","sub_category":"...","reasoning":"..."}},...]\
"""

        parsed = None
        try:
            result = await call_ai(db, prompt, output_tokens)
            parsed = parse_json(result["text"])
        except Exception as e:
            logger.warning("Batch %d\u2013%d failed: %s", i + 1, batch_end, e)

        # Fallback: single-vendor mode for missing vendors
        parsed_names = {p.get("name") for p in (parsed or [])}
        missing = [b for b in batch if b["name"] not in parsed_names]

        for vendor in missing:
            try:
                single_result = await _categorise_single(db, vendor)
                if parsed is None:
                    parsed = []
                parsed.append(single_result)
                await asyncio.sleep(0.2)
            except Exception:
                if parsed is None:
                    parsed = []
                parsed.append(
                    {
                        "name": vendor["name"],
                        "category": "Other",
                        "sub_category": "",
                        "reasoning": "Categorisation failed",
                    }
                )

        # Upsert results (using pre-loaded map to avoid N+1 queries)
        for item in parsed or []:
            d = vendor_map.get(item.get("name", ""))
            if not d:
                continue
            cat = item.get("category", "Other")
            if cat not in CATEGORIES:
                cat = "Other"

            existing = existing_vendor_map.get(item["name"])
            if existing:
                existing.category = cat
                existing.sub_category = item.get("sub_category", "")
                existing.reasoning = item.get("reasoning", "")
                existing.app_count = len(d["apps"])
                existing.total_cost = d["totalCost"]
                existing.app_list = d["apps"]
                existing.analysed_at = now
            else:
                new_obj = ArchLensVendorAnalysis(
                    vendor_name=item["name"],
                    category=cat,
                    sub_category=item.get("sub_category", ""),
                    reasoning=item.get("reasoning", ""),
                    app_count=len(d["apps"]),
                    total_cost=d["totalCost"],
                    app_list=d["apps"],
                    analysed_at=now,
                )
                db.add(new_obj)
                existing_vendor_map[item["name"]] = new_obj
            total_analysed += 1

        await db.flush()

    await db.commit()
    logger.info(
        "Vendor analysis complete: %d/%d vendors categorised",
        total_analysed,
        len(vendor_list),
    )
    return {"analysed": total_analysed, "total": len(vendor_list)}


async def _categorise_single(db: AsyncSession, vendor: dict[str, Any]) -> dict[str, Any]:
    """Fallback: categorise a single vendor."""
    app_context = (
        "\n".join(
            f"- {a['name']} ({a['type']}): {a.get('description', 'no description')}"
            for a in vendor.get("appDetails", [])
        )
        or "No linked applications"
    )

    prompt = f"""Categorise this IT vendor/product for an enterprise.
Vendor: "{vendor["name"]}"
{f"Provider description: {vendor['providerDescription']}" if vendor.get("providerDescription") else ""} # noqa: E501

Linked Applications/ITComponents:
{app_context}

Return ONLY a JSON object (no markdown):
{{"name":"{vendor["name"]}","category":"<one of: {" | ".join(CATEGORIES)}>","sub_category":"<specific type>","reasoning":"<one sentence>"}}"""  # noqa: E501

    result = await call_ai(db, prompt, 256)
    text = result["text"].replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON object found")
    parsed: dict[str, Any] = json.loads(match.group(0))
    return parsed


# ---------------------------------------------------------------------------
# Vendor Resolution (port of resolveVendorIdentities from resolution.js)
# ---------------------------------------------------------------------------


async def resolve_vendors(db: AsyncSession) -> dict[str, Any]:
    """Resolve vendor aliases into canonical hierarchy. Returns {saved, rawCount}."""
    rows, provider_rows = await _load_cards_with_vendors(db)

    # Collect all raw vendor names
    raw_names: set[str] = set()
    for row in rows:
        for v in row["vendors"]:
            if v.strip():
                raw_names.add(v.strip())
    for row in provider_rows:
        if row["name"].strip():
            raw_names.add(row["name"].strip())

    # Include names from existing vendor analysis
    va_result = await db.execute(select(ArchLensVendorAnalysis.vendor_name))
    for (name,) in va_result.all():
        if name and name.strip():
            raw_names.add(name.strip())

    names = sorted(raw_names)
    if not names:
        return {"saved": 0, "rawCount": 0}

    logger.info("Resolving %d raw vendor name variants", len(names))

    batch_sz = 60
    all_resolved: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    for i in range(0, len(names), batch_sz):
        batch = names[i : i + batch_sz]
        prompt = f"""You are a principal enterprise architect with deep knowledge of enterprise software vendors. # noqa: E501

Resolve these raw vendor/product names into a canonical vendor hierarchy.
Group aliases, product variants, and modules under their real canonical vendor.

RULES:
- "SAP", "SAP SE", "SAP AG", "SAP S4", "SAP S/4HANA" \u2192 vendor "SAP SE"
- "Microsoft", "MS Azure", "Azure", "Microsoft 365" \u2192 vendor "Microsoft"
- vendor_type: "vendor" (company), "product", "platform", "module"
- Set parent_canonical for products/modules
- confidence: 1.0 = certain, 0.5 = uncertain

Raw names ({i + 1}\u2013{min(i + batch_sz, len(names))} of {len(names)}): # noqa: E501
{json.dumps(batch)}

Return ONLY a JSON array:
[{{"raw_name":"<exact input>","canonical_name":"<clean name>","vendor_type":"vendor|product|platform|module|unknown","parent_canonical":"<parent or null>","confidence":0.9}}]"""  # noqa: E501

        try:
            result = await call_ai(
                db,
                prompt,
                3000,
                "You are an enterprise architect. Return only valid JSON arrays. No markdown.",
            )
            parsed = parse_json(result["text"])
            if isinstance(parsed, list):
                all_resolved.extend(parsed)
        except Exception as e:
            logger.warning("Resolution batch %d failed: %s", i, e)
            for n in batch:
                all_resolved.append(
                    {
                        "raw_name": n,
                        "canonical_name": n,
                        "vendor_type": "unknown",
                        "parent_canonical": None,
                        "confidence": 0.5,
                    }
                )

    # Build canonical map
    canonical_map: dict[str, dict[str, Any]] = {}
    for r in all_resolved:
        k = r.get("canonical_name") or r.get("raw_name", "")
        if k not in canonical_map:
            canonical_map[k] = {
                "canonical": k,
                "type": r.get("vendor_type", "vendor"),
                "parent": r.get("parent_canonical"),
                "aliases": [],
                "app_ids": set(),
                "itc_ids": set(),
                "cost": 0,
            }
        if r.get("raw_name") != k:
            canonical_map[k]["aliases"].append(r["raw_name"])

    # Build resolved lookup map (O(1) instead of O(n) per vendor)
    resolved_map = {r.get("raw_name"): r for r in all_resolved if r.get("raw_name")}

    # Enrich with actual counts from cards
    for row in rows:
        for v in row["vendors"]:
            resolved = resolved_map.get(v)
            k = resolved["canonical_name"] if resolved else v
            if k in canonical_map:
                canonical_map[k]["app_ids"].add(row["id"])
                canonical_map[k]["cost"] += float(row["annual_cost"] or 0)

    # Load existing vendor analysis for category info
    va_result = await db.execute(select(ArchLensVendorAnalysis))
    va_map: dict[str, ArchLensVendorAnalysis] = {}
    for _va in va_result.scalars().all():
        va_map[_va.vendor_name] = _va  # type: ignore[attr-defined,assignment]

    # Clear old hierarchy and persist new
    await db.execute(delete(ArchLensVendorHierarchy))
    await db.flush()

    # Build canonical -> resolved entries map for O(1) confidence lookup
    canonical_resolved: dict[str, list[dict[str, Any]]] = {}
    for r in all_resolved:
        cn = r.get("canonical_name", "")
        canonical_resolved.setdefault(cn, []).append(r)

    saved = 0
    for v in canonical_map.values():
        apps = list(v["app_ids"])
        itcs = list(v["itc_ids"])
        conf_entries = canonical_resolved.get(v["canonical"], [])
        avg_conf = (
            sum(r.get("confidence", 0.8) for r in conf_entries) / len(conf_entries)
            if conf_entries
            else 0.8
        )

        # Try to find category from vendor analysis
        va = va_map.get(v["canonical"])
        if not va:
            for alias in v["aliases"]:
                va = va_map.get(alias)
                if va:
                    break

        db.add(
            ArchLensVendorHierarchy(
                canonical_name=v["canonical"],
                vendor_type=v["type"] or "vendor",
                aliases=list(set(v["aliases"])),
                category=va.category if va else None,
                sub_category=va.sub_category if va else None,
                app_count=len(apps),
                itc_count=len(itcs),
                total_cost=v["cost"],
                linked_fs=[*apps, *itcs][:200],
                confidence=round(avg_conf, 2),
                analysed_at=now,
            )
        )
        saved += 1

    await db.commit()
    return {"saved": saved, "rawCount": len(names)}
