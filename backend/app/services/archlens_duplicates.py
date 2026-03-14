"""ArchLens Duplicate Detection + Modernization — ported from resolution.js.

Clusters cards by functional purpose using AI, then assesses modernization
opportunities for each card type.
"""

from __future__ import annotations

import json
import logging
import uuid as uuid_mod
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.archlens import (
    ArchLensDuplicateCluster,
    ArchLensModernization,
)
from app.models.card import Card
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.archlens_ai import call_ai, parse_json

logger = logging.getLogger("turboea.archlens.duplicates")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


async def _load_cards_by_type(
    db: AsyncSession, card_types: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """Load cards grouped by type with vendor info."""
    result = await db.execute(
        select(Card).where(Card.type.in_(card_types), Card.status != "ARCHIVED")
    )
    cards = result.scalars().all()

    # Load Provider relations for vendor context
    rt_result = await db.execute(
        select(RelationType.key).where(
            (RelationType.target_type_key == "Provider")
            | (RelationType.source_type_key == "Provider")
        )
    )
    provider_rel_keys = [r[0] for r in rt_result.all()]

    # Load Provider cards
    prov_result = await db.execute(
        select(Card).where(Card.type == "Provider", Card.status != "ARCHIVED")
    )
    providers = {str(p.id): p for p in prov_result.scalars().all()}

    # Build card -> vendors mapping
    card_vendors: dict[str, list[str]] = {}
    if provider_rel_keys:
        rels_result = await db.execute(
            select(Relation).where(Relation.relation_type_key.in_(provider_rel_keys))
        )
        for rel in rels_result.scalars().all():
            src_id = str(rel.source_id)
            tgt_id = str(rel.target_id)
            if tgt_id in providers:
                card_vendors.setdefault(src_id, []).append(providers[tgt_id].name)
            elif src_id in providers:
                card_vendors.setdefault(tgt_id, []).append(providers[src_id].name)

    type_map: dict[str, list[dict[str, Any]]] = {}
    for card in cards:
        attrs = card.attributes or {}
        lifecycle_data = card.lifecycle or {}
        lifecycle_phase = None
        if isinstance(lifecycle_data, list) and lifecycle_data:
            lifecycle_phase = lifecycle_data[-1].get("phase")
        elif isinstance(lifecycle_data, dict):
            lifecycle_phase = lifecycle_data.get("phase")

        item = {
            "id": str(card.id),
            "name": card.name,
            "description": (card.description or "")[:200],
            "vendors": card_vendors.get(str(card.id), []),
            "lifecycle": lifecycle_phase,
            "tech_fit": attrs.get("technicalFit"),
        }
        type_map.setdefault(card.type, []).append(item)

    return type_map


# ---------------------------------------------------------------------------
# Union-find merge for overlapping clusters
# ---------------------------------------------------------------------------


def _merge_overlapping_clusters(
    clusters: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge clusters sharing member IDs using union-find."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        if x not in parent:
            parent[x] = x
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    for c in clusters:
        ids = c.get("member_ids") or []
        for j in range(1, len(ids)):
            union(ids[0], ids[j])

    groups: dict[str, dict[str, Any]] = {}
    for c in clusters:
        ids = c.get("member_ids") or []
        if not ids:
            continue
        root = find(ids[0])
        if root not in groups:
            groups[root] = {
                **c,
                "member_ids": set(ids),
                "member_names": set(c.get("member_names") or []),
            }
        else:
            for mid in ids:
                groups[root]["member_ids"].add(mid)
            for mn in c.get("member_names") or []:
                groups[root]["member_names"].add(mn)

    return [
        {
            **g,
            "member_ids": list(g["member_ids"]),
            "member_names": list(g["member_names"]),
        }
        for g in groups.values()
    ]


# ---------------------------------------------------------------------------
# Duplicate Detection (port of detectDuplicates from resolution.js)
# ---------------------------------------------------------------------------


async def detect_duplicates(
    db: AsyncSession,
    card_types: list[str] | None = None,
) -> dict[str, Any]:
    """Detect functional duplicate cards using AI. Returns {clusters}."""
    target_types = card_types or ["Application", "ITComponent", "Interface"]
    type_map = await _load_cards_by_type(db, target_types)

    all_clusters: list[dict[str, Any]] = []
    batch_sz = 40

    for card_type in target_types:
        items = type_map.get(card_type, [])
        if not items:
            continue

        logger.info("Clustering %d %s cards", len(items), card_type)

        for i in range(0, len(items), batch_sz):
            batch = items[i : i + batch_sz]
            batch_input = json.dumps(
                [
                    {
                        "id": it["id"],
                        "name": it["name"],
                        "desc": it["description"],
                        "vendors": it["vendors"],
                        "lifecycle": it["lifecycle"],
                        "techFit": it["tech_fit"],
                    }
                    for it in batch
                ]
            )

            prompt = f"""You are a principal enterprise architect performing application portfolio rationalization. # noqa: E501

Analyse these {card_type} cards and identify FUNCTIONAL DUPLICATES \u2014 items that serve the same or overlapping business purpose. # noqa: E501

INSTRUCTIONS:
- Group items that do the same functional job
- Only group items with genuine functional overlap
- A cluster needs at least 2 members
- functional_domain: what they ALL do
- evidence: concrete reasons they are duplicates
- recommendation: which to KEEP and why, what to RETIRE

Items to analyse ({card_type}):
{batch_input}

Return ONLY a JSON array of clusters. Items with no duplicates should NOT appear:
[{{"cluster_name":"<name>","functional_domain":"<what they do>","member_ids":["<id1>","<id2>"],"member_names":["<name1>","<name2>"],"evidence":"<why duplicates>","recommendation":"<keep/retire>"}}] # noqa: E501
If no duplicates found, return: []"""

            try:
                result = await call_ai(
                    db,
                    prompt,
                    3000,
                    "You are an enterprise architect. Return only valid JSON. No markdown.",
                )
                parsed = parse_json(result["text"])
                clusters = parsed if isinstance(parsed, list) else []
                for c in clusters:
                    if len(c.get("member_ids", [])) >= 2:
                        all_clusters.append({**c, "card_type": card_type})
            except Exception as e:
                logger.warning("%s batch %d failed: %s", card_type, i, e)

    # Merge overlapping clusters
    merged = _merge_overlapping_clusters(all_clusters)

    # Clear old clusters and persist new
    await db.execute(delete(ArchLensDuplicateCluster))
    await db.flush()

    now = datetime.now(timezone.utc)
    for c in merged:
        db.add(
            ArchLensDuplicateCluster(
                cluster_name=c.get("cluster_name", ""),
                card_type=c.get("card_type", ""),
                functional_domain=c.get("functional_domain"),
                card_ids=c.get("member_ids"),
                card_names=c.get("member_names"),
                evidence=c.get("evidence", ""),
                recommendation=c.get("recommendation", ""),
                status="pending",
                analysed_at=now,
            )
        )

    await db.commit()
    return {"clusters": len(merged)}


# ---------------------------------------------------------------------------
# Modernization Assessment (port of assessModernization from resolution.js)
# ---------------------------------------------------------------------------


async def assess_modernization(
    db: AsyncSession,
    target_type: str,
    modernization_type: str = "general",
) -> dict[str, Any]:
    """Assess modernization opportunities for cards of a given type."""
    type_map = await _load_cards_by_type(db, [target_type])
    items = type_map.get(target_type, [])

    if not items:
        return {"assessments": 0, "targetType": target_type}

    year = datetime.now().year
    modern_context = {
        "Interface": f"Focus on: Event-driven architecture, API modernization (REST\u2192GraphQL, gRPC), AsyncAPI, Service Mesh. In {year} the trend is replacing synchronous integrations with event-driven patterns.",  # noqa: E501
        "Application": f"Focus on: Cloud-native migration, microservices, SaaS replacement, low-code/no-code platforms. In {year}: AI-native apps, composable architecture.",  # noqa: E501
        "ITComponent": f"Focus on: Cloud PaaS, managed Kubernetes, serverless, Infrastructure as Code, FinOps. In {year}: FinOps and platform engineering.",  # noqa: E501
    }.get(target_type, "Focus on current technology modernization trends.")

    batch_sz = 25
    all_assessments: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    for i in range(0, len(items), batch_sz):
        batch = items[i : i + batch_sz]
        batch_input = json.dumps(
            [
                {
                    "id": it["id"],
                    "name": it["name"],
                    "desc": it["description"],
                    "vendors": it["vendors"][:3],
                    "lifecycle": it["lifecycle"],
                    "techFit": it["tech_fit"],
                }
                for it in batch
            ]
        )

        prompt = f"""You are a principal enterprise architect performing modernization assessment in {year}. # noqa: E501

Assess these {target_type} cards for modernization opportunities.
Focus: {modernization_type}
Technology context: {modern_context}

For each item with a genuine modernization opportunity, provide an assessment.
Skip items that are already modern or have no clear opportunity.

Items:
{batch_input}

Return ONLY a JSON array (empty if no opportunities):
[{{"fs_id":"<id>","fs_name":"<name>","current_tech":"<current>","modernization_type":"<type>","recommendation":"<specific recommendation>","effort":"low|medium|high","priority":"critical|high|medium|low","rationale":"<why>"}}]"""  # noqa: E501

        try:
            result = await call_ai(
                db,
                prompt,
                3000,
                "You are a senior enterprise architect. Return only valid JSON. No markdown.",
            )
            parsed = parse_json(result["text"])
            if isinstance(parsed, list):
                all_assessments.extend(parsed)
        except Exception as e:
            logger.warning("Modernization batch %d failed: %s", i, e)

    # Clear old assessments for this type and persist
    await db.execute(
        delete(ArchLensModernization).where(ArchLensModernization.target_type == target_type)
    )
    await db.flush()

    for a in all_assessments:
        card_id = a.get("fs_id")
        # Validate card_id is a valid UUID
        try:
            uuid_mod.UUID(card_id)
        except (ValueError, TypeError):
            card_id = None

        db.add(
            ArchLensModernization(
                target_type=target_type,
                card_id=card_id,
                card_name=a.get("fs_name", ""),
                current_tech=a.get("current_tech", ""),
                modernization_type=a.get("modernization_type", ""),
                recommendation=a.get("recommendation", ""),
                effort=a.get("effort", "medium"),
                priority=a.get("priority", "medium"),
                status="pending",
                analysed_at=now,
            )
        )

    await db.commit()
    return {"assessments": len(all_assessments), "targetType": target_type}
