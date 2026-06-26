"""Unit tests for the canonical data-quality scorer.

Covers backward-compatibility (untuned == legacy behavior), per-field
exclusion/weighting, and the admin-tunable built-in contributor weights stored
under ``section_config.__dataQuality``.
"""

import pytest

from app.services.data_quality import calc_data_quality
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

pytestmark = pytest.mark.asyncio

# Two equally-weighted fields, both unfilled by default.
_SCHEMA = [
    {
        "section": "Details",
        "fields": [
            {"key": "a", "label": "A", "type": "text", "weight": 1},
            {"key": "b", "label": "B", "type": "text", "weight": 1},
        ],
    }
]


async def _type(db, **kwargs):
    return await create_card_type(db, key="Application", fields_schema=_SCHEMA, **kwargs)


async def test_untuned_matches_legacy_behavior(db):
    """No __dataQuality config: fields(2) + description(1) + lifecycle(1) = 4 slots."""
    await _type(db)
    card = await create_card(
        db,
        attributes={"a": "x"},  # 1 of 2 fields filled
        description="hello",  # description filled
        lifecycle={},  # lifecycle empty
    )
    # filled = a(1) + description(1) = 2 ; total = a+b+desc+lifecycle = 4
    assert await calc_data_quality(db, card) == 50.0


async def test_field_set_to_ignore_is_excluded(db):
    """Weight 0 ('Ignore') drops the field from both numerator and denominator."""
    schema = [
        {
            "section": "Details",
            "fields": [
                {"key": "a", "label": "A", "type": "text", "weight": 1},
                {"key": "b", "label": "B", "type": "text", "weight": 0},
            ],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=schema)
    # Exclude built-in buckets so only field 'a' counts.
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    card = await create_card(db, attributes={"a": "x"})
    assert await calc_data_quality(db, card) == 100.0


async def test_critical_weight_dominates(db):
    """A Critical (3) field outweighs a Normal (1) field 3:1."""
    schema = [
        {
            "section": "Details",
            "fields": [
                {"key": "a", "label": "A", "type": "text", "weight": 3},
                {"key": "b", "label": "B", "type": "text", "weight": 1},
            ],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=schema)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    # Only the critical field filled: 3 / (3+1) = 75%
    card = await create_card(db, attributes={"a": "x"})
    assert await calc_data_quality(db, card) == 75.0


async def test_description_bucket_excluded_at_zero(db):
    await _type(db)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    # Only the 2 fields count now; one filled → 50%.
    card = await create_card(db, attributes={"a": "x"}, description="ignored")
    assert await calc_data_quality(db, card) == 50.0


async def test_lifecycle_bucket_scaled(db):
    await _type(db)
    # Lifecycle weight 2, everything else off; lifecycle has a date → full marks.
    await _set_dq(db, description=0, lifecycle=2, relations=0, tags=0)
    # Fields still count (weight 1 each, unfilled). total = a+b+lifecycle(2)=4
    # filled = lifecycle(2) → 50%
    card = await create_card(db, attributes={}, lifecycle={"active": "2026-01-01"})
    assert await calc_data_quality(db, card) == 50.0


async def test_bad_dq_value_falls_back_to_one(db):
    """Non-numeric/garbage weights default to 1 instead of crashing."""
    await _type(db)
    await _set_dq(db, description="oops", lifecycle=None, relations=0, tags=0)
    card = await create_card(db, attributes={"a": "x", "b": "y"}, description="d")
    # description("oops"→1) filled, lifecycle(None→1) empty, both fields filled.
    # filled = a+b+desc = 3 ; total = a+b+desc+lifecycle = 4 → 75%
    assert await calc_data_quality(db, card) == 75.0


async def test_stakeholder_roles_contributor(db):
    """Each non-archived stakeholder role of the type is a completeness slot;
    a role is filled when a stakeholder holds it on the card."""
    from app.models.stakeholder import Stakeholder

    # Empty field schema + all other buckets off → only stakeholders count.
    await create_card_type(db, key="Application", fields_schema=[])
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0, stakeholders=1)
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="architect", label="Architect"
    )
    await create_role(db, key="member", label="Member", permissions={})
    user = await create_user(db, email="sh@test.com", role="member")
    card = await create_card(db, card_type="Application")

    # No stakeholders assigned → 0 of 2 roles → 0%.
    assert await calc_data_quality(db, card) == 0.0

    # One of two roles filled → 50%.
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="owner"))
    await db.flush()
    assert await calc_data_quality(db, card) == 50.0


async def test_stakeholders_bucket_excluded_when_zero(db):
    """Weight 0 drops the stakeholders bucket entirely (no slots added)."""
    await create_card_type(db, key="Application", fields_schema=_SCHEMA)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0, stakeholders=0)
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    card = await create_card(db, attributes={"a": "x", "b": "y"})  # both fields filled
    # Only the two fields count; stakeholders excluded → 100%.
    assert await calc_data_quality(db, card) == 100.0


async def _set_dq(db, **buckets):
    """Patch the Application card type's __dataQuality config."""
    from sqlalchemy import select

    from app.models.card_type import CardType

    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    cfg = dict(ct.section_config or {})
    cfg["__dataQuality"] = buckets
    ct.section_config = cfg
    await db.flush()
