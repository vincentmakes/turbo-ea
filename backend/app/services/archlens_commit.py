"""ArchLens commit service — creates Initiative, cards, relations, and ADR
from a Phase 5 architecture assessment.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.archlens import ArchLensAnalysisRun, ArchLensAssessment
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType

logger = logging.getLogger("turboea.archlens.commit")

# Map card type key → relation type key for Initiative → card type
INITIATIVE_RELATION_MAP: dict[str, str] = {
    "Application": "relInitiativeToApp",
    "ITComponent": "relInitiativeToITC",
    "Interface": "relInitiativeToInterface",
    "DataObject": "relInitiativeToDataObj",
    "BusinessCapability": "relInitiativeToBC",
    "Platform": "relInitiativeToPlatform",
    "Objective": "relInitiativeToObjective",
}


async def _update_progress(db: AsyncSession, run_id: str, progress: dict[str, Any]) -> None:
    """Update the analysis run's results with current progress."""
    run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
    if run:
        run.results = {"progress": progress}
        flag_modified(run, "results")
        await db.commit()


async def _calc_data_quality(db: AsyncSession, card_type_key: str, card: Card) -> float:
    """Calculate data quality score for a card based on its type's field weights."""
    ct_result = await db.execute(select(CardType).where(CardType.key == card_type_key))
    card_type = ct_result.scalar_one_or_none()
    if not card_type or not card_type.fields_schema:
        return 0.0

    total_weight = 0.0
    filled_weight = 0.0
    attrs = card.attributes or {}

    for section in card_type.fields_schema:
        for field in section.get("fields", []):
            weight = field.get("weight", 1)
            if weight <= 0:
                continue
            total_weight += weight
            val = attrs.get(field["key"])
            if val is not None and val != "" and val is not False:
                filled_weight += weight

    # Description weight
    total_weight += 1
    if card.description:
        filled_weight += 1

    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


async def _generate_description(
    db: AsyncSession, name: str, type_key: str, subtype: str | None
) -> str | None:
    """Generate AI description for a card. Returns None on failure."""
    try:
        from app.core.encryption import decrypt_value
        from app.models.app_settings import AppSettings
        from app.services.ai_service import suggest_metadata

        result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        row = result.scalar_one_or_none()
        if not row or not row.general_settings:
            return None

        ai = row.general_settings.get("ai", {})
        if not ai.get("enabled"):
            return None

        provider_url = ai.get("providerUrl", "")
        model = ai.get("model", "")
        if not provider_url or not model:
            return None

        encrypted_key = ai.get("apiKey", "")
        api_key = decrypt_value(encrypted_key) if encrypted_key else ""
        provider_type = ai.get("providerType", "ollama")

        ct_result = await db.execute(select(CardType).where(CardType.key == type_key))
        card_type = ct_result.scalar_one_or_none()
        type_label = card_type.label if card_type else type_key

        result_data = await suggest_metadata(
            name=name,
            type_key=type_key,
            type_label=type_label,
            subtype=subtype,
            provider_url=provider_url,
            model=model,
            provider_type=provider_type,
            api_key=api_key,
            fields_schema=card_type.fields_schema if card_type else [],
        )
        suggestions = result_data.get("suggestions", {})
        desc_suggestion = suggestions.get("description", {})
        if isinstance(desc_suggestion, dict):
            return desc_suggestion.get("value")
        return None
    except Exception:
        logger.exception("AI description generation failed for %s", name)
        return None


async def _next_adr_reference(db: AsyncSession) -> str:
    """Generate the next ADR reference number."""
    result = await db.execute(select(func.max(ArchitectureDecision.reference_number)))
    max_ref = result.scalar_one_or_none()
    if max_ref:
        num = int(max_ref.replace("ADR-", "")) + 1
    else:
        num = 1
    return f"ADR-{num:03d}"


async def _validate_relation_type(db: AsyncSession, key: str) -> bool:
    """Check that a relation type key exists."""
    result = await db.execute(
        select(RelationType.key).where(RelationType.key == key, RelationType.is_hidden.is_(False))
    )
    return result.scalar_one_or_none() is not None


def _build_initiative_description(session_data: dict[str, Any]) -> str:
    """Build a rich initiative description from the assessment context."""
    parts: list[str] = []

    # Capability mapping summary (AI-generated analysis from Phase 5)
    cap_mapping = session_data.get("capabilityMapping", {})
    summary = cap_mapping.get("summary", "")
    if summary:
        parts.append(summary)

    # Selected approach
    arch_options = session_data.get("archOptions", [])
    selected_option_id = session_data.get("selectedOptionId")
    if arch_options and selected_option_id:
        for opt in arch_options:
            if isinstance(opt, dict) and opt.get("id") == selected_option_id:
                if opt.get("summary"):
                    parts.append(f"Approach: {opt['summary']}")
                break

    # Selected products/recommendations
    selected_recs = session_data.get("selectedRecommendations", [])
    if selected_recs:
        product_names = []
        for rec in selected_recs:
            if isinstance(rec, dict):
                name = rec.get("name", "")
                vendor = rec.get("vendor", "")
                if name:
                    product_names.append(f"{name} ({vendor})" if vendor else name)
        if product_names:
            parts.append("Key components: " + ", ".join(product_names) + ".")

    # Business requirement as context
    requirement = session_data.get("requirement", "")
    if requirement and not summary:
        # Only add requirement if we don't have a summary (which already captures it)
        parts.append(f"Business requirement: {requirement}")

    return "\n\n".join(parts) if parts else ""


async def execute_commit(db: AsyncSession, run_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Execute the full commit process: Initiative + cards + relations + ADR."""
    assessment_id = data["assessment_id"]
    initiative_name = data["initiative_name"]
    start_date = data["start_date"]
    end_date = data["end_date"]
    selected_card_ids = set(data["selected_card_ids"])
    selected_relation_indices = set(data["selected_relation_indices"])
    objective_ids = data.get("objective_ids", [])
    renamed_cards: dict[str, str] = data.get("renamed_cards") or {}
    user_id = uuid.UUID(data["user_id"])

    # Load assessment
    assessment = await db.get(ArchLensAssessment, uuid.UUID(assessment_id))
    if not assessment:
        raise ValueError("Assessment not found")

    session_data = assessment.session_data or {}
    cap_mapping = session_data.get("capabilityMapping", {})
    proposed_cards = cap_mapping.get("proposedCards", [])
    proposed_relations = cap_mapping.get("proposedRelations", [])
    arch_options = session_data.get("archOptions", [])
    selected_option_id = session_data.get("selectedOptionId")

    # Count total steps for progress tracking
    cards_to_create = [c for c in proposed_cards if c.get("isNew") and c["id"] in selected_card_ids]
    rels_to_create = [
        proposed_relations[i]
        for i in sorted(selected_relation_indices)
        if i < len(proposed_relations)
    ]
    total_steps = 1 + len(cards_to_create) + 1 + 1  # init + cards + rels + ADR
    current_step = 0

    # ID mapping: temp_id -> real UUID
    id_map: dict[str, uuid.UUID] = {}

    # Map existing card references from proposed_cards
    for pc in proposed_cards:
        if not pc.get("isNew") and pc.get("existingCardId"):
            id_map[pc["id"]] = uuid.UUID(pc["existingCardId"])

    # Map existing capabilities
    for cap in cap_mapping.get("capabilities", []):
        if not cap.get("isNew") and cap.get("existingCardId"):
            id_map[cap["id"]] = uuid.UUID(cap["existingCardId"])

    # ── Step 1: Create Initiative Card ────────────────────────────────────
    await _update_progress(
        db,
        run_id,
        {
            "step": "creating_initiative",
            "current": current_step,
            "total": total_steps,
        },
    )

    initiative_desc = _build_initiative_description(session_data)

    initiative = Card(
        id=uuid.uuid4(),
        type="Initiative",
        subtype="project",
        name=initiative_name,
        description=initiative_desc or "",
        attributes={"startDate": start_date, "endDate": end_date},
        lifecycle={},
        status="ACTIVE",
        approval_status="DRAFT",
        created_by=user_id,
        updated_by=user_id,
    )
    initiative.data_quality = await _calc_data_quality(db, "Initiative", initiative)
    db.add(initiative)
    await db.flush()
    current_step += 1

    # ── Step 2: Link Initiative → Objectives ─────────────────────────────
    for oid in objective_ids:
        try:
            obj_uuid = uuid.UUID(oid)
            obj = await db.get(Card, obj_uuid)
            if obj and obj.type == "Objective":
                rel = Relation(
                    id=uuid.uuid4(),
                    type="relInitiativeToObjective",
                    source_id=initiative.id,
                    target_id=obj_uuid,
                )
                db.add(rel)
        except (ValueError, TypeError):
            logger.warning("Invalid objective ID: %s", oid)
            continue

    # ── Step 3: Create Selected New Cards ─────────────────────────────────
    created_card_ids: list[str] = []
    for card_def in cards_to_create:
        current_step += 1
        await _update_progress(
            db,
            run_id,
            {
                "step": "creating_cards",
                "current": current_step,
                "total": total_steps,
                "initiative_id": str(initiative.id),
                "detail": card_def.get("name", ""),
            },
        )

        card_type_key = card_def.get("cardTypeKey", "Application")
        card_subtype = card_def.get("subtype")
        card_name = renamed_cards.get(card_def["id"]) or card_def.get("name", "Unnamed")

        # AI-generate description
        card_desc = await _generate_description(db, card_name, card_type_key, card_subtype)

        new_card = Card(
            id=uuid.uuid4(),
            type=card_type_key,
            subtype=card_subtype,
            name=card_name,
            description=card_desc or "",
            attributes={},
            lifecycle={"phaseIn": start_date, "active": end_date},
            status="ACTIVE",
            approval_status="DRAFT",
            created_by=user_id,
            updated_by=user_id,
        )
        new_card.data_quality = await _calc_data_quality(db, card_type_key, new_card)
        db.add(new_card)
        await db.flush()

        id_map[card_def["id"]] = new_card.id
        created_card_ids.append(str(new_card.id))

        # Link new card → Initiative
        rel_type_key = INITIATIVE_RELATION_MAP.get(card_type_key)
        if rel_type_key and await _validate_relation_type(db, rel_type_key):
            rel = Relation(
                id=uuid.uuid4(),
                type=rel_type_key,
                source_id=initiative.id,
                target_id=new_card.id,
            )
            db.add(rel)

    # ── Step 4: Create Selected Relations ────────────────────────────────
    current_step += 1
    await _update_progress(
        db,
        run_id,
        {
            "step": "creating_relations",
            "current": current_step,
            "total": total_steps,
            "initiative_id": str(initiative.id),
        },
    )

    relations_created = 0
    for rel_def in rels_to_create:
        source_id_str = rel_def.get("sourceId", "")
        target_id_str = rel_def.get("targetId", "")
        rel_type = rel_def.get("relationType", "")

        source_uuid = id_map.get(source_id_str)
        target_uuid = id_map.get(target_id_str)

        # Try parsing as UUID directly (existing cards)
        if not source_uuid:
            try:
                source_uuid = uuid.UUID(source_id_str)
            except (ValueError, TypeError):
                continue
        if not target_uuid:
            try:
                target_uuid = uuid.UUID(target_id_str)
            except (ValueError, TypeError):
                continue

        if not rel_type or not await _validate_relation_type(db, rel_type):
            continue

        rel = Relation(
            id=uuid.uuid4(),
            type=rel_type,
            source_id=source_uuid,
            target_id=target_uuid,
        )
        db.add(rel)
        relations_created += 1

    # ── Step 5: Create Draft ADR ─────────────────────────────────────────
    current_step += 1
    await _update_progress(
        db,
        run_id,
        {
            "step": "creating_adr",
            "current": current_step,
            "total": total_steps,
            "initiative_id": str(initiative.id),
        },
    )

    # Build ADR content from session data
    selected_option = None
    alternatives = []
    for opt in arch_options:
        if isinstance(opt, dict):
            if opt.get("id") == selected_option_id:
                selected_option = opt
            else:
                alternatives.append(opt)

    context_parts = []
    summary = cap_mapping.get("summary", "")
    if summary:
        context_parts.append(summary)
    requirement = session_data.get("requirement", "")
    if requirement:
        context_parts.append(f"Business Requirement: {requirement}")

    decision_parts = []
    if selected_option:
        decision_parts.append(
            f"Selected approach: {selected_option.get('title', '')} "
            f"({selected_option.get('approach', '')})"
        )
        if selected_option.get("summary"):
            decision_parts.append(selected_option["summary"])

    selected_recs = session_data.get("selectedRecommendations", [])
    if selected_recs:
        decision_parts.append("\nSelected products/recommendations:")
        for rec in selected_recs:
            if isinstance(rec, dict):
                name = rec.get("name", rec.get("recommendation", ""))
                vendor = rec.get("vendor", "N/A")
                capability = rec.get("capability", "")
                role = rec.get("role", "")
                suffix = f" for {capability}" if capability else ""
                role_tag = f" [{role}]" if role == "dependency" else ""
                decision_parts.append(f"- {name} ({vendor}){suffix}{role_tag}")

    alternatives_text = ""
    if alternatives:
        alt_parts = []
        for alt in alternatives:
            if isinstance(alt, dict):
                alt_parts.append(f"- {alt.get('title', '')}: {alt.get('summary', '')}")
        alternatives_text = "\n".join(alt_parts)

    consequences_parts = []
    if cards_to_create:
        consequences_parts.append(f"New cards introduced: {len(cards_to_create)}")
    if rels_to_create:
        consequences_parts.append(f"New relations created: {len(rels_to_create)}")
    for cap in cap_mapping.get("capabilities", []):
        if isinstance(cap, dict) and cap.get("isNew") and cap.get("rationale"):
            consequences_parts.append(f"New capability: {cap['rationale']}")

    ref_number = await _next_adr_reference(db)
    adr = ArchitectureDecision(
        id=uuid.uuid4(),
        reference_number=ref_number,
        title=f"Architecture Decision: {initiative_name}",
        status="draft",
        context="\n\n".join(context_parts) or None,
        decision="\n".join(decision_parts) or None,
        consequences="\n".join(consequences_parts) or None,
        alternatives_considered=alternatives_text or None,
        related_decisions=[{"type": "assessment", "id": assessment_id}],
        created_by=user_id,
    )
    db.add(adr)
    await db.flush()

    # Link ADR to Initiative
    db.add(
        ArchitectureDecisionCard(
            architecture_decision_id=adr.id,
            card_id=initiative.id,
        )
    )

    # Link ADR to all newly created cards
    for card_id_str in created_card_ids:
        db.add(
            ArchitectureDecisionCard(
                architecture_decision_id=adr.id,
                card_id=uuid.UUID(card_id_str),
            )
        )

    # ── Step 6: Update Assessment ────────────────────────────────────────
    assessment.status = "committed"
    assessment.initiative_id = initiative.id
    flag_modified(assessment, "status")

    await db.commit()

    return {
        "initiative_id": str(initiative.id),
        "initiative_name": initiative.name,
        "card_count": len(created_card_ids),
        "relation_count": relations_created,
        "adr_id": str(adr.id),
        "adr_reference": ref_number,
    }
