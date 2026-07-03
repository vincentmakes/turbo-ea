"""One-shot canonical data-quality rescore on startup (discussion #667).

Existing installs may carry non-canonical scores (from the demo seed's old
approximation or from workspace imports made by older importer versions).
``run_dq_rescore_once`` heals the whole inventory exactly once, guarded by a
marker in ``app_settings.general_settings``.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.main import _DQ_RESCORE_FLAG, run_dq_rescore_once
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.services.data_quality import calc_data_quality
from tests.conftest import create_card, create_card_type, create_user

pytestmark = pytest.mark.asyncio


async def test_rescore_once_heals_scores_and_arms_marker(db):
    user = await create_user(db, email="rescore@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Stale App", user_id=user.id)
    canonical = await calc_data_quality(db, card)
    card.data_quality = 99.9  # simulate a stale, non-canonical stored score
    await db.flush()

    changed = await run_dq_rescore_once(db)
    assert changed == 1

    refreshed = (await db.execute(select(Card).where(Card.id == card.id))).scalar_one()
    assert refreshed.data_quality == canonical

    settings_row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one()
    assert settings_row.general_settings.get(_DQ_RESCORE_FLAG) is True

    # Second run is a guarded no-op, even if a score drifts again.
    refreshed.data_quality = 12.3
    await db.flush()
    assert await run_dq_rescore_once(db) is None
    still = (await db.execute(select(Card).where(Card.id == card.id))).scalar_one()
    assert still.data_quality == 12.3
