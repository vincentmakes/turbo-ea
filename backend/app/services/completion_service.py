"""Compute completion percentage for fact sheets based on filled fields and relations."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fact_sheet import FactSheet, FactSheetType
from app.models.relation import Relation

# Define which fields matter per type for completion scoring
TYPE_FIELDS: dict[FactSheetType, list[str]] = {
    FactSheetType.APPLICATION: [
        "description",
        "lifecycle",
        "attributes.business_criticality",
        "attributes.technical_suitability",
    ],
    FactSheetType.BUSINESS_CAPABILITY: [
        "description",
    ],
    FactSheetType.IT_COMPONENT: [
        "description",
        "lifecycle",
        "attributes.category",
        "attributes.resource_classification",
    ],
    FactSheetType.ORGANIZATION: [
        "description",
    ],
    FactSheetType.PROVIDER: [
        "description",
    ],
    FactSheetType.INTERFACE: [
        "description",
        "attributes.frequency",
        "attributes.data_format",
        "attributes.transport_protocol",
    ],
    FactSheetType.INITIATIVE: [
        "description",
        "lifecycle",
        "attributes.initiative_type",
    ],
}

# Relations that contribute to completion per type
TYPE_RELATIONS: dict[FactSheetType, int] = {
    FactSheetType.APPLICATION: 1,  # Should have at least 1 relation
    FactSheetType.IT_COMPONENT: 1,
    FactSheetType.INTERFACE: 1,
}


async def compute_completion(db: AsyncSession, fs: FactSheet) -> float:
    """Compute completion as percentage (0-100) based on filled fields and relations."""
    fields = TYPE_FIELDS.get(fs.type, ["description"])
    min_relations = TYPE_RELATIONS.get(fs.type, 0)

    total_checks = len(fields) + (1 if min_relations > 0 else 0)
    if total_checks == 0:
        return 100.0

    filled = 0

    for field_path in fields:
        if "." in field_path:
            # Nested in attributes JSON
            parts = field_path.split(".", 1)
            attrs = fs.attributes or {}
            if attrs.get(parts[1]):
                filled += 1
        else:
            value = getattr(fs, field_path, None)
            if value:
                filled += 1

    if min_relations > 0:
        count_q = select(func.count(Relation.id)).where(
            (Relation.from_fact_sheet_id == fs.id) | (Relation.to_fact_sheet_id == fs.id)
        )
        rel_count = (await db.execute(count_q)).scalar_one()
        if rel_count >= min_relations:
            filled += 1

    return round((filled / total_checks) * 100, 1)


async def update_completion(db: AsyncSession, fs_id: uuid.UUID) -> None:
    """Recompute and persist completion for a fact sheet."""
    result = await db.execute(select(FactSheet).where(FactSheet.id == fs_id))
    fs = result.scalar_one_or_none()
    if fs is None:
        return

    new_completion = await compute_completion(db, fs)
    if fs.completion != new_completion:
        fs.completion = new_completion
        await db.flush()
