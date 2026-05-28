"""Regression test for the relation-type / relation apply overflow.

Companion to ``test_migration_long_card_type_key.py``. Migration 097
widened the *staging* slot ``staged_records.card_type_key`` so the
import pipeline could carry long source-derived relation type names
past the staging layer. The apply layer downstream then hit the same
overflow on ``relation_types.key`` (VARCHAR(100)), and — even after
the metamodel row was created — every relation row of that type would
have overflowed ``relations.type`` (also VARCHAR(100)). Migration 098
widened all four columns to TEXT.

This test pins both pieces: a RelationType with a > 100-char key
persists, and a Relation row of that type persists too.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType

# 220 chars — mirrors the overflowing relation type name from the real
# LeanIX snapshot that raised the bug.
_LONG_KEY = (
    "proposedSolutionToAppApplicationToAppToProposedSolution"
    "ApplicationApplicationRelProposedSolutionToAppApplicationTo"
    "AppToProposedSolutionApplicationApplicationRel" + ("x" * 60)
)


@pytest.mark.asyncio
async def test_relation_type_and_relation_accept_long_key(db) -> None:
    assert len(_LONG_KEY) > 100, "guard: key must exceed legacy width"

    app_type = CardType(key="Application", label="Application", category="ApplicationAndData")
    db.add(app_type)
    await db.flush()

    rt = RelationType(
        key=_LONG_KEY,
        label=_LONG_KEY,
        reverse_label=_LONG_KEY,
        source_type_key="Application",
        target_type_key="Application",
        built_in=False,
    )
    db.add(rt)
    await db.flush()

    src = Card(type="Application", name="src")
    tgt = Card(type="Application", name="tgt")
    db.add_all([src, tgt])
    await db.flush()

    rel = Relation(
        id=uuid.uuid4(),
        type=_LONG_KEY,
        source_id=src.id,
        target_id=tgt.id,
    )
    db.add(rel)
    await db.flush()

    fetched_rt = (
        await db.execute(select(RelationType).where(RelationType.id == rt.id))
    ).scalar_one()
    assert fetched_rt.key == _LONG_KEY
    assert fetched_rt.label == _LONG_KEY
    assert fetched_rt.reverse_label == _LONG_KEY

    fetched_rel = (await db.execute(select(Relation).where(Relation.id == rel.id))).scalar_one()
    assert fetched_rel.type == _LONG_KEY
