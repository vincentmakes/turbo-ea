from sqlalchemy import select

from app.models.card import Card
from app.services.workspace_io import schema
from app.services.workspace_io.applier import apply_selected
from app.services.workspace_io.bundle import WorkspaceBundle
from tests.conftest import create_card, create_card_type, create_user

STAGES = [{"key": "testing", "label": "Testing", "color": "#4578bb"}]


async def test_old_bundle_preserves_current_stages(db):
    actor = await create_user(db)
    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = STAGES
    card = await create_card(db, name="Existing")
    card.lifecycle_stage = "testing"
    await db.flush()
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [{"key": "Application", "label": "Application"}],
            schema.SHEET_CARDS: [{"type": "Application", "name": "Existing"}],
        },
    )
    result = await apply_selected(
        db, bundle, actor, sheets={schema.SHEET_CARD_TYPES, schema.SHEET_CARDS}, dry_run=False
    )
    assert result.total_failed == 0
    assert card_type.lifecycle_stages == STAGES
    assert card.lifecycle_stage == "testing"


async def test_bundle_rejects_unknown_stage_and_in_use_stage_removal(db):
    actor = await create_user(db)
    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = STAGES
    card = await create_card(db, name="Existing")
    card.lifecycle_stage = "testing"
    await db.flush()
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [
                {"key": "Application", "label": "Application", "lifecycle_stages": []}
            ],
            schema.SHEET_CARDS: [
                {"type": "Application", "name": "New", "lifecycle_stage": "invalid"}
            ],
        },
    )
    result = await apply_selected(
        db, bundle, actor, sheets={schema.SHEET_CARD_TYPES, schema.SHEET_CARDS}, dry_run=False
    )
    assert result.total_failed == 2
    assert card_type.lifecycle_stages == STAGES
    assert await db.scalar(select(Card.id).where(Card.name == "New")) is None


async def test_validation_refreshes_a_stale_type_from_database(db):
    import pytest
    from fastapi import HTTPException
    from sqlalchemy import update

    from app.models.card_type import CardType
    from app.services.lifecycle_stages import validate_stage

    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = STAGES
    await db.flush()
    await db.execute(
        update(CardType)
        .where(CardType.id == card_type.id)
        .values(lifecycle_stages=[])
        .execution_options(synchronize_session=False)
    )
    with pytest.raises(HTTPException) as exc:
        await validate_stage(db, "Application", "testing")
    assert exc.value.status_code == 400


async def test_validation_reads_current_vocabulary_after_another_session_commits(test_engine):
    import uuid

    import pytest
    from fastapi import HTTPException
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.card_type import CardType
    from app.services.lifecycle_stages import validate_stage

    key = "Stage" + uuid.uuid4().hex
    async with AsyncSession(test_engine, expire_on_commit=False) as setup, setup.begin():
        card_type = await create_card_type(setup, key=key)
        card_type.lifecycle_stages = STAGES
    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as stale:
            loaded = await stale.get(CardType, card_type.id)
            assert loaded.lifecycle_stages == STAGES
            async with AsyncSession(test_engine) as writer, writer.begin():
                current = await writer.get(CardType, card_type.id)
                current.lifecycle_stages = []
            with pytest.raises(HTTPException) as exc:
                await validate_stage(stale, key, "testing")
            assert exc.value.status_code == 400
    finally:
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(delete(CardType).where(CardType.id == card_type.id))


async def test_independent_validations_can_hold_stage_locks_together(test_engine):
    import asyncio
    import uuid

    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.card_type import CardType
    from app.services.lifecycle_stages import validate_stage

    key = "Stage" + uuid.uuid4().hex
    async with AsyncSession(test_engine, expire_on_commit=False) as setup, setup.begin():
        card_type = await create_card_type(setup, key=key)
        card_type.lifecycle_stages = STAGES
    try:
        async with AsyncSession(test_engine) as first, AsyncSession(test_engine) as second:
            await validate_stage(first, key, "testing")
            await asyncio.wait_for(validate_stage(second, key, "testing"), timeout=2)
    finally:
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(delete(CardType).where(CardType.id == card_type.id))
