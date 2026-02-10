"""Hierarchy endpoints for Business Capabilities, Organizations, and other tree-structured fact sheets."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.models.fact_sheet import FactSheet, FactSheetStatus, FactSheetType
from app.models.relation import Relation, RelationType
from app.schemas.fact_sheet import FactSheetRead

router = APIRouter()


class TreeNode(FactSheetRead):
    children: list["TreeNode"] = []
    relation_count: int = 0


async def _build_tree(
    db: AsyncSession,
    fs_type: FactSheetType,
    root_id: uuid.UUID | None = None,
) -> list[TreeNode]:
    """Build a hierarchical tree for a given fact sheet type."""
    query = (
        select(FactSheet)
        .where(FactSheet.type == fs_type, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    result = await db.execute(query)
    all_items = list(result.scalars().all())

    # Count relations for each fact sheet
    rel_counts: dict[uuid.UUID, int] = {}
    if all_items:
        ids = [item.id for item in all_items]
        count_query = (
            select(Relation.to_fact_sheet_id, func.count(Relation.id))
            .where(Relation.to_fact_sheet_id.in_(ids))
            .group_by(Relation.to_fact_sheet_id)
        )
        count_result = await db.execute(count_query)
        for fs_id, cnt in count_result:
            rel_counts[fs_id] = cnt

        # Also count from-side relations
        count_query2 = (
            select(Relation.from_fact_sheet_id, func.count(Relation.id))
            .where(Relation.from_fact_sheet_id.in_(ids))
            .group_by(Relation.from_fact_sheet_id)
        )
        count_result2 = await db.execute(count_query2)
        for fs_id, cnt in count_result2:
            rel_counts[fs_id] = rel_counts.get(fs_id, 0) + cnt

    # Build lookup
    by_id: dict[uuid.UUID, TreeNode] = {}
    for item in all_items:
        node = TreeNode.model_validate(item)
        node.children = []
        node.relation_count = rel_counts.get(item.id, 0)
        by_id[item.id] = node

    # Assemble tree
    roots: list[TreeNode] = []
    for item in all_items:
        node = by_id[item.id]
        if item.parent_id and item.parent_id in by_id:
            by_id[item.parent_id].children.append(node)
        else:
            roots.append(node)

    if root_id and root_id in by_id:
        return [by_id[root_id]]

    return roots


@router.get("/business-capabilities", response_model=list[TreeNode])
async def get_capability_tree(
    root_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get business capabilities as a hierarchical tree (L1 -> L2 -> L3)."""
    return await _build_tree(db, FactSheetType.BUSINESS_CAPABILITY, root_id)


@router.get("/organizations", response_model=list[TreeNode])
async def get_organization_tree(
    root_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get organizations as a hierarchical tree."""
    return await _build_tree(db, FactSheetType.ORGANIZATION, root_id)


@router.get("/{fs_id}/children", response_model=list[FactSheetRead])
async def get_children(
    fs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get direct children of a fact sheet."""
    result = await db.execute(
        select(FactSheet)
        .where(FactSheet.parent_id == fs_id, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    return list(result.scalars().all())


@router.get("/{fs_id}/ancestors", response_model=list[FactSheetRead])
async def get_ancestors(
    fs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get ancestor chain from a fact sheet up to root."""
    ancestors: list[FactSheet] = []
    current_id = fs_id

    for _ in range(10):  # max depth safety
        result = await db.execute(select(FactSheet).where(FactSheet.id == current_id))
        fs = result.scalar_one_or_none()
        if fs is None:
            break
        if fs.id != fs_id:  # don't include self
            ancestors.append(fs)
        if fs.parent_id is None:
            break
        current_id = fs.parent_id

    ancestors.reverse()
    return ancestors
