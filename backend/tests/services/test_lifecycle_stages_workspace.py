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
