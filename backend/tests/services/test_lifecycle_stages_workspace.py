import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.card import Card
from app.services.lifecycle_stages import (
    ensure_stages_available,
    lock_type,
    update_stages,
    validate_stage,
)
from app.services.workspace_io import schema
from app.services.workspace_io.applier import apply_selected
from app.services.workspace_io.bundle import WorkspaceBundle
from tests.conftest import create_card, create_card_type, create_user

STAGES = [{"key": "testing", "label": "Testing", "color": "#4578bb"}]


async def test_stage_validation_errors_and_cross_type_usage(db):
    with pytest.raises(HTTPException) as missing:
        await lock_type(db, "Missing")
    assert (missing.value.status_code, missing.value.detail) == (404, "Card type not found")

    application = await create_card_type(db, key="Application")
    application.lifecycle_stages = STAGES
    other = await create_card_type(db, key="Other")
    other.lifecycle_stages = STAGES
    card = await create_card(db, card_type="Other")
    card.lifecycle_stage = "testing"
    await db.flush()
    with pytest.raises(HTTPException) as unknown:
        await validate_stage(db, "Application", "invalid")
    assert (unknown.value.status_code, unknown.value.detail) == (400, "Unknown lifecycle stage")
    assert await ensure_stages_available(db, "Application", []) is application
    with pytest.raises(HTTPException) as in_use:
        await ensure_stages_available(db, "Other", [])
    assert (in_use.value.status_code, in_use.value.detail) == (409, "Lifecycle stage is in use")


async def test_stage_metadata_can_change_while_key_is_in_use(db):
    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = STAGES
    card = await create_card(db)
    card.lifecycle_stage = "testing"
    await db.flush()
    replacement = [{"key": "testing", "label": "Trial", "color": "#123456"}]
    updated, previous = await update_stages(db, "Application", replacement)
    assert updated is card_type
    assert previous == STAGES
    assert updated.lifecycle_stages == replacement
    assert card.lifecycle_stage == "testing"


async def test_new_bundle_imports_stage_and_new_card(db):
    actor = await create_user(db)
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [
                {"key": "Application", "label": "Application", "lifecycle_stages": STAGES}
            ],
            schema.SHEET_CARDS: [
                {"type": "Application", "name": "New", "lifecycle_stage": "testing"}
            ],
        },
    )
    result = await apply_selected(
        db, bundle, actor, sheets={schema.SHEET_CARD_TYPES, schema.SHEET_CARDS}, dry_run=False
    )
    assert result.total_failed == 0
    card = await db.scalar(select(Card).where(Card.name == "New"))
    assert card is not None
    assert card.lifecycle_stage == "testing"


async def test_empty_stage_cell_clears_unused_vocabulary(db):
    actor = await create_user(db)
    card_type = await create_card_type(db, key="Application")
    card_type.lifecycle_stages = STAGES
    await db.flush()
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [
                {"key": "Application", "label": "Application", "lifecycle_stages": None},
            ]
        },
    )
    result = await apply_selected(
        db, bundle, actor, sheets={schema.SHEET_CARD_TYPES}, dry_run=False
    )
    assert result.total_failed == 0
    assert card_type.lifecycle_stages == []


async def test_invalid_type_rows_report_each_error_and_continue(db):
    actor = await create_user(db)
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [
                {"key": "BadOne", "label": "Bad", "lifecycle_stages": [{"key": ""}]},
                {"key": "BadTwo", "label": "Bad", "lifecycle_stages": [{"key": ""}]},
                {"key": "Good", "label": "Good", "lifecycle_stages": STAGES},
            ]
        },
    )
    result = await apply_selected(
        db, bundle, actor, sheets={schema.SHEET_CARD_TYPES}, dry_run=False
    )
    section = next(
        section for section in result.sections if section.sheet == schema.SHEET_CARD_TYPES
    )
    assert section.failed == 2
    assert len(section.errors) == 2
    assert "card type 'BadOne': invalid lifecycle stages:" in section.errors[0]
    assert "card type 'BadTwo': invalid lifecycle stages:" in section.errors[1]
    from app.models.card_type import CardType

    good = await db.scalar(select(CardType).where(CardType.key == "Good"))
    assert good is not None
    assert good.lifecycle_stages == STAGES


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


async def test_vocabulary_edit_waits_for_validation_lock(test_engine):
    import asyncio
    import uuid

    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.card_type import CardType

    key = "Stage" + uuid.uuid4().hex
    async with AsyncSession(test_engine, expire_on_commit=False) as setup, setup.begin():
        card_type = await create_card_type(setup, key=key)
        card_type.lifecycle_stages = STAGES
    try:
        async with AsyncSession(test_engine) as reader, AsyncSession(test_engine) as writer:
            await validate_stage(reader, key, "testing")
            edit = asyncio.create_task(ensure_stages_available(writer, key, []))
            try:
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(asyncio.shield(edit), timeout=0.2)
                await reader.rollback()
                assert (await asyncio.wait_for(edit, timeout=2)).key == key
            finally:
                if not edit.done():
                    edit.cancel()
                    await asyncio.gather(edit, return_exceptions=True)
    finally:
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(delete(CardType).where(CardType.id == card_type.id))
