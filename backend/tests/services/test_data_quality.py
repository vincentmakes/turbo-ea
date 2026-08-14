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


async def test_stakeholders_bucket_is_one_slot(db):
    """The stakeholders bucket is a single yes/no slot: one assignment in any
    counting role fills it, no matter how many roles the type defines.

    It used to award a slot *per role*, so a type with two roles and one
    stakeholder scored 50% — the defect behind #944, where a fully-populated
    Interface was capped at 90% for having no Observer named.
    """
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

    # Nobody assigned → the slot is in the denominator and unfilled → 0%.
    assert await calc_data_quality(db, card) == 0.0

    # One assignment fills the whole bucket, even with a second role defined.
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="owner"))
    await db.flush()
    assert await calc_data_quality(db, card) == 100.0


async def test_second_stakeholder_does_not_raise_the_score(db):
    """Filling a second role adds nothing — the bucket is already full."""
    from app.models.stakeholder import Stakeholder

    await create_card_type(db, key="Application", fields_schema=[])
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0, stakeholders=1)
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="architect", label="Architect"
    )
    await create_role(db, key="member", label="Member", permissions={})
    u1 = await create_user(db, email="one@test.com", role="member")
    u2 = await create_user(db, email="two@test.com", role="member")
    card = await create_card(db, card_type="Application")

    db.add(Stakeholder(card_id=card.id, user_id=u1.id, role="owner"))
    await db.flush()
    assert await calc_data_quality(db, card) == 100.0

    db.add(Stakeholder(card_id=card.id, user_id=u2.id, role="architect"))
    await db.flush()
    assert await calc_data_quality(db, card) == 100.0


async def test_non_counting_role_does_not_fill_the_bucket(db):
    """A role with ``counts_for_quality=False`` (the built-in observer) is
    passive: holding it must never stand in for owning the card."""
    from app.models.stakeholder import Stakeholder

    await create_card_type(db, key="Application", fields_schema=[])
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0, stakeholders=1)
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    await create_stakeholder_role_def(
        db,
        card_type_key="Application",
        key="observer",
        label="Observer",
        counts_for_quality=False,
    )
    await create_role(db, key="member", label="Member", permissions={})
    user = await create_user(db, email="watcher@test.com", role="member")
    card = await create_card(db, card_type="Application")

    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="observer"))
    await db.flush()
    assert await calc_data_quality(db, card) == 0.0

    # The counting role does fill it.
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="owner"))
    await db.flush()
    assert await calc_data_quality(db, card) == 100.0


async def test_type_with_only_non_counting_roles_adds_no_slot(db):
    """No counting roles → no slot at all, rather than one nobody can fill."""
    await create_card_type(db, key="Application", fields_schema=_SCHEMA)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0, stakeholders=1)
    await create_stakeholder_role_def(
        db,
        card_type_key="Application",
        key="observer",
        label="Observer",
        counts_for_quality=False,
    )
    card = await create_card(db, attributes={"a": "x", "b": "y"})
    # Only the two fields count → 100%, not 2 of 3.
    assert await calc_data_quality(db, card) == 100.0


async def test_stakeholder_in_archived_role_does_not_fill_the_bucket(db):
    """Archiving a role takes it out of the slot, so an assignment held under
    it stops counting — the card is incomplete again."""
    from app.models.stakeholder import Stakeholder

    await create_card_type(db, key="Application", fields_schema=[])
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0, stakeholders=1)
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    stale = await create_stakeholder_role_def(
        db, card_type_key="Application", key="legacy", label="Legacy"
    )
    await create_role(db, key="member", label="Member", permissions={})
    user = await create_user(db, email="legacy@test.com", role="member")
    card = await create_card(db, card_type="Application")

    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="legacy"))
    await db.flush()
    assert await calc_data_quality(db, card) == 100.0

    stale.is_archived = True
    await db.flush()
    assert await calc_data_quality(db, card) == 0.0


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


# ── Mandatory-field gate ────────────────────────────────────────────
# While any visible required field (boolean/readonly exempt) is empty, the
# score is pinned to 0; once all are filled, the regular calculation applies.

_REQ_SCHEMA = [
    {
        "section": "Details",
        "fields": [
            {"key": "a", "label": "A", "type": "text", "weight": 1, "required": True},
            {"key": "b", "label": "B", "type": "text", "weight": 1},
        ],
    }
]


async def test_empty_required_field_pins_score_to_zero(db):
    await create_card_type(db, key="Application", fields_schema=_REQ_SCHEMA)
    # Everything else filled — the empty required field still forces 0.
    card = await create_card(
        db,
        attributes={"b": "y"},
        description="hello",
        lifecycle={"active": "2026-01-01"},
    )
    assert await calc_data_quality(db, card) == 0.0


async def test_filled_required_field_restores_regular_score(db):
    await create_card_type(db, key="Application", fields_schema=_REQ_SCHEMA)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    card = await create_card(db, attributes={"a": "x"})
    # Required 'a' filled → gate lifts; regular math: 1 of 2 fields → 50%.
    assert await calc_data_quality(db, card) == 50.0


async def test_empty_list_counts_as_empty_for_required_gate(db):
    schema = [
        {
            "section": "Details",
            "fields": [
                {
                    "key": "m",
                    "label": "M",
                    "type": "multiple_select",
                    "weight": 1,
                    "required": True,
                    "options": [{"key": "x", "label": "X"}],
                },
            ],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=schema)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    card = await create_card(db, attributes={"m": []})
    assert await calc_data_quality(db, card) == 0.0
    card.attributes = {"m": ["x"]}
    await db.flush()
    assert await calc_data_quality(db, card) == 100.0


async def test_boolean_and_readonly_required_fields_do_not_gate(db):
    schema = [
        {
            "section": "Details",
            "fields": [
                {"key": "flag", "label": "Flag", "type": "boolean", "weight": 0, "required": True},
                {
                    "key": "calc",
                    "label": "Calc",
                    "type": "number",
                    "weight": 0,
                    "required": True,
                    "readonly": True,
                },
                {"key": "a", "label": "A", "type": "text", "weight": 1},
            ],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=schema)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    # Neither the boolean nor the readonly field is set — no gating.
    card = await create_card(db, attributes={"a": "x"})
    assert await calc_data_quality(db, card) == 100.0


async def test_required_field_hidden_by_subtype_does_not_gate(db):
    schema = [
        {
            "section": "Details",
            "fields": [
                {"key": "a", "label": "A", "type": "text", "weight": 1, "required": True},
                {"key": "b", "label": "B", "type": "text", "weight": 1},
            ],
        }
    ]
    await create_card_type(
        db,
        key="Application",
        fields_schema=schema,
        subtypes=[{"key": "micro", "label": "Micro", "hidden_fields": ["a"]}],
    )
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    card = await create_card(db, subtype="micro", attributes={"b": "y"})
    # 'a' is hidden for this subtype → no gate; only 'b' counts → 100%.
    assert await calc_data_quality(db, card) == 100.0


async def test_empty_multi_select_list_is_not_filled(db):
    """`[]` is an emptied multiple_select, not a value.

    The mandatory gate above and the app-wide `_is_empty_attr` predicate both
    read `[]` as empty; the scoring loop used to read it as filled, so clearing
    a multi-select left the card scoring as if it were still answered (#940).
    """
    schema = [
        {
            "section": "Details",
            "fields": [
                {"key": "a", "label": "A", "type": "text", "weight": 1},
                {
                    "key": "regions",
                    "label": "Regions",
                    "type": "multiple_select",
                    "weight": 1,
                    "options": [{"key": "emea", "label": "EMEA"}],
                },
            ],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=schema)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)

    emptied = await create_card(db, attributes={"a": "x", "regions": []})
    assert await calc_data_quality(db, emptied) == 50.0

    filled = await create_card(db, name="Filled", attributes={"a": "x", "regions": ["emea"]})
    assert await calc_data_quality(db, filled) == 100.0


async def test_zero_still_counts_as_filled(db):
    """Guard the neighbouring semantics: 0 is a real number a user chose."""
    schema = [
        {
            "section": "Details",
            "fields": [{"key": "seats", "label": "Seats", "type": "number", "weight": 1}],
        }
    ]
    await create_card_type(db, key="Application", fields_schema=schema)
    await _set_dq(db, description=0, lifecycle=0, relations=0, tags=0)
    card = await create_card(db, attributes={"seats": 0})
    assert await calc_data_quality(db, card) == 100.0
