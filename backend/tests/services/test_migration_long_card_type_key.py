"""Regression test for the staged_records.card_type_key overflow.

``staged_records.card_type_key`` was a ``VARCHAR(100)`` that doubled as
the staging slot for both card type keys (short, controlled) and
relation type keys (free-form, derived from the source platform's
native name). Real source exports surface concatenated synthetic
relation names that exceed 100 chars and crash the import with a
``StringDataRightTruncationError``. Migration 097 widened the column
to TEXT — this test pins that.

The fixture string is source-agnostic in spirit (any future adapter
could produce a similarly long synthetic type name) but uses the same
LeanIX-style shape that surfaced the bug in production.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.migration import Migration, StagedRecord

# 220 chars — mirrors the overflowing relation type name from the real
# LeanIX snapshot that raised the bug.
_LONG_TYPE_KEY = (
    "proposedSolutionToAppApplicationToAppToProposedSolution"
    "ApplicationApplicationRelProposedSolutionToAppApplicationTo"
    "AppToProposedSolutionApplicationApplicationRel" + ("x" * 60)
)


@pytest.mark.asyncio
async def test_staged_record_accepts_long_card_type_key(db) -> None:
    assert len(_LONG_TYPE_KEY) > 100, "guard: relation type key must exceed legacy width"

    migration = Migration(
        name="snapshot.xlsx",
        source_type="leanix",
        file_hash="b" * 64,
        status="parsed",
    )
    db.add(migration)
    await db.flush()

    staged = StagedRecord(
        migration_id=migration.id,
        source_type="leanix",
        entity_kind="relation",
        source_id="462a2c92-56f9-4407-9c21-ee5e8f080101",
        card_type_key=_LONG_TYPE_KEY,
        action="create",
    )
    db.add(staged)
    await db.flush()

    fetched = (
        await db.execute(select(StagedRecord).where(StagedRecord.id == staged.id))
    ).scalar_one()
    assert fetched.card_type_key == _LONG_TYPE_KEY
