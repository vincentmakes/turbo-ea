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


async def test_rescore_reruns_when_only_the_old_v1_marker_is_set(db):
    """Upgrading installs carry the pre-2.52 marker; the versioned key must
    re-arm the rescore so the mandatory-field zero-gate backfills stored
    scores (cards untouched since the upgrade otherwise keep stale values)."""
    user = await create_user(db, email="rescore-v2@test.com", role="admin")
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Details",
                "fields": [{"key": "a", "label": "A", "type": "text", "required": True}],
            }
        ],
    )
    card = await create_card(db, card_type="Application", name="Stale Gate", user_id=user.id)
    card.data_quality = 55.0  # stale pre-gate score; required 'a' is empty → canonical is 0
    db.add(AppSettings(id="default", general_settings={"dataQualityCanonicalRescoreDone": True}))
    await db.flush()

    changed = await run_dq_rescore_once(db)
    assert changed == 1

    refreshed = (await db.execute(select(Card).where(Card.id == card.id))).scalar_one()
    assert refreshed.data_quality == 0.0

    settings_row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one()
    assert settings_row.general_settings.get(_DQ_RESCORE_FLAG) is True
    # The legacy marker is left in place untouched.
    assert settings_row.general_settings.get("dataQualityCanonicalRescoreDone") is True


async def test_rescore_reruns_when_only_the_v2_marker_is_set(db):
    """Same contract one version on: an install that already ran the V2
    rescore must re-run once for the single-slot stakeholders bucket, or every
    card keeps the old per-role score until someone edits it."""
    from app.models.stakeholder import Stakeholder
    from tests.conftest import create_role, create_stakeholder_role_def

    await create_role(db, key="member", label="Member", permissions={})
    user = await create_user(db, email="rescore-v3@test.com", role="member")
    # Only the stakeholders bucket counts, so the assertion below is about the
    # bucket itself and not diluted by description/lifecycle.
    ct = await create_card_type(db, key="Application", label="Application", fields_schema=[])
    ct.section_config = {
        "__dataQuality": {
            "description": 0,
            "lifecycle": 0,
            "relations": 0,
            "tags": 0,
            "stakeholders": 1,
        }
    }
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="responsible", label="Responsible"
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", label="Observer"
    )
    card = await create_card(db, card_type="Application", name="Half Credit", user_id=user.id)
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="responsible"))
    # The old scorer gave 1 of 2 roles → 50%. Both roles count here, so the
    # single-slot scorer must lift this to 100%.
    card.data_quality = 50.0
    db.add(AppSettings(id="default", general_settings={"dataQualityCanonicalRescoreDoneV2": True}))
    await db.flush()

    assert await run_dq_rescore_once(db) == 1

    refreshed = (await db.execute(select(Card).where(Card.id == card.id))).scalar_one()
    assert refreshed.data_quality == 100.0

    settings_row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one()
    assert settings_row.general_settings.get(_DQ_RESCORE_FLAG) is True
    assert settings_row.general_settings.get("dataQualityCanonicalRescoreDoneV2") is True
