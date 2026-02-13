"""Transformation execution engine.

Applies the impacts of a transformation to the live architecture in a
defined sequence (see §4.3 of the spec):

 1. Create Fact Sheets
 2. Set fields
 3. Copy fields
 4. Create relations
 5. Set relation fields / validity
 6. Remove relations / remove all relations
 7. Add / Remove / Replace tags
 8. Archive Fact Sheets

The entire execution is wrapped in the caller's DB transaction so that
a failure in any step rolls back all changes (atomicity).
"""
from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fact_sheet import FactSheet
from app.models.impact import Impact
from app.models.relation import Relation


class ExecutionError(Exception):
    """Raised when impact execution fails."""


async def execute_transformation(
    db: AsyncSession,
    impacts: list[Impact],
    user_id: uuid.UUID | None = None,
) -> dict:
    """Execute all non-disabled impacts in order.

    Returns a summary dict with counts of each operation performed.
    """
    summary = {
        "fact_sheets_created": 0,
        "fact_sheets_archived": 0,
        "fields_set": 0,
        "relations_created": 0,
        "relations_removed": 0,
    }

    # Sort by execution_order then by id for determinism
    sorted_impacts = sorted(
        [i for i in impacts if not i.is_disabled],
        key=lambda i: (i.execution_order, str(i.id)),
    )

    # Track fact sheets created in this execution (for create_fact_sheet action)
    created_fs_map: dict[str, uuid.UUID] = {}

    for impact in sorted_impacts:
        action = impact.action

        if action == "create_fact_sheet":
            await _exec_create_fact_sheet(db, impact, created_fs_map, summary)
        elif action == "set_field":
            await _exec_set_field(db, impact, summary)
        elif action == "create_relation":
            await _exec_create_relation(db, impact, summary)
        elif action == "remove_relation":
            await _exec_remove_relation(db, impact, summary)
        elif action == "remove_all_relations":
            await _exec_remove_all_relations(db, impact, summary)
        elif action == "archive_fact_sheet":
            await _exec_archive_fact_sheet(db, impact, summary)
        # Other actions (copy_field, set_relation_field, etc.) can be
        # implemented in later phases

    return summary


async def _exec_create_fact_sheet(
    db: AsyncSession,
    impact: Impact,
    created_fs_map: dict[str, uuid.UUID],
    summary: dict,
) -> None:
    """Create a new fact sheet from the impact definition."""
    # The field_value may hold initial attributes like lifecycle
    lifecycle = None
    if isinstance(impact.field_value, dict) and "lifecycle" in impact.field_value:
        lifecycle = impact.field_value["lifecycle"]
    elif impact.field_name == "lifecycle" and isinstance(impact.field_value, dict):
        lifecycle = impact.field_value

    # Determine the name — use field_value.name or a generated name
    name = "New Fact Sheet"
    if isinstance(impact.field_value, dict):
        name = impact.field_value.get("name", name)

    # Determine type from relation_type hint or default
    fs_type = "Application"
    if isinstance(impact.field_value, dict):
        fs_type = impact.field_value.get("type", fs_type)

    fs = FactSheet(
        type=fs_type,
        name=name,
        status="ACTIVE",
        lifecycle=lifecycle or {},
        attributes={},
        quality_seal="DRAFT",
        completion=0.0,
    )
    db.add(fs)
    await db.flush()

    # Store mapping so later impacts can reference this FS
    created_fs_map[str(impact.id)] = fs.id

    # Update the impact's target to point to the newly created FS
    impact.target_fact_sheet_id = fs.id
    summary["fact_sheets_created"] += 1


async def _exec_set_field(
    db: AsyncSession,
    impact: Impact,
    summary: dict,
) -> None:
    """Set a field on a target fact sheet."""
    if not impact.target_fact_sheet_id:
        return

    result = await db.execute(
        select(FactSheet).where(FactSheet.id == impact.target_fact_sheet_id)
    )
    fs = result.scalar_one_or_none()
    if not fs:
        raise ExecutionError(
            f"Target fact sheet {impact.target_fact_sheet_id} not found"
        )

    if fs.status == "ARCHIVED":
        raise ExecutionError(
            f"Cannot modify archived fact sheet {fs.name}"
        )

    field = impact.field_name
    if not field:
        return

    if field == "lifecycle":
        # Merge lifecycle values
        current = fs.lifecycle or {}
        if isinstance(impact.field_value, dict):
            current.update(impact.field_value)
        fs.lifecycle = current
    else:
        # Set in attributes
        attrs = dict(fs.attributes or {})
        attrs[field] = impact.field_value
        fs.attributes = attrs

    summary["fields_set"] += 1


async def _exec_create_relation(
    db: AsyncSession,
    impact: Impact,
    summary: dict,
) -> None:
    """Create a relation between two fact sheets."""
    source_id = impact.source_fact_sheet_id
    target_id = impact.target_fact_sheet_id
    rel_type = impact.relation_type

    if not source_id or not target_id or not rel_type:
        return

    # Check for existing duplicate
    result = await db.execute(
        select(Relation).where(
            Relation.type == rel_type,
            Relation.source_id == source_id,
            Relation.target_id == target_id,
        )
    )
    if result.scalar_one_or_none():
        return  # Already exists

    rel = Relation(
        type=rel_type,
        source_id=source_id,
        target_id=target_id,
        attributes={},
    )
    db.add(rel)
    summary["relations_created"] += 1


async def _exec_remove_relation(
    db: AsyncSession,
    impact: Impact,
    summary: dict,
) -> None:
    """Remove a specific relation."""
    source_id = impact.source_fact_sheet_id
    target_id = impact.target_fact_sheet_id
    rel_type = impact.relation_type

    if not target_id or not rel_type:
        return

    q = delete(Relation).where(Relation.type == rel_type)
    if source_id:
        q = q.where(
            ((Relation.source_id == source_id) & (Relation.target_id == target_id))
            | ((Relation.source_id == target_id) & (Relation.target_id == source_id))
        )
    else:
        q = q.where(
            (Relation.source_id == target_id) | (Relation.target_id == target_id)
        )
    result = await db.execute(q)
    summary["relations_removed"] += result.rowcount


async def _exec_remove_all_relations(
    db: AsyncSession,
    impact: Impact,
    summary: dict,
) -> None:
    """Remove all relations of a given type (or all types) from a fact sheet."""
    target_id = impact.target_fact_sheet_id
    if not target_id:
        return

    q = delete(Relation).where(
        (Relation.source_id == target_id) | (Relation.target_id == target_id)
    )
    if impact.relation_type and impact.relation_type != "*":
        q = q.where(Relation.type == impact.relation_type)

    result = await db.execute(q)
    summary["relations_removed"] += result.rowcount


async def _exec_archive_fact_sheet(
    db: AsyncSession,
    impact: Impact,
    summary: dict,
) -> None:
    """Archive (soft-delete) a fact sheet."""
    if not impact.target_fact_sheet_id:
        return

    result = await db.execute(
        select(FactSheet).where(FactSheet.id == impact.target_fact_sheet_id)
    )
    fs = result.scalar_one_or_none()
    if not fs:
        return

    fs.status = "ARCHIVED"
    summary["fact_sheets_archived"] += 1
