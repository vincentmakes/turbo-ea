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


async def test_a_card_whose_type_is_gone_scores_zero_and_has_no_breakdown(db):
    """No CardType row behind the card: nothing to score, and nothing to explain."""
    from app.services.data_quality import calc_data_quality_breakdown

    card = await create_card(db, card_type="GhostType", attributes={"a": "x"})
    assert await calc_data_quality_breakdown(db, card) is None
    assert await calc_data_quality(db, card) == 0.0


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


# ── Mandatory relations scoped per subtype (#1296) ──────────────────
# A side the card's subtype lists in `optional_relations` is not a slot at all
# for that card, exactly as a subtype's hidden fields drop out of the score.


async def test_relation_side_exempted_by_subtype_is_not_a_slot(db):
    from tests.conftest import create_relation_type

    await create_card_type(
        db,
        key="Application",
        fields_schema=_SCHEMA,
        subtypes=[
            {"key": "saas", "label": "SaaS", "optional_relations": ["relAppToOrg"]},
            {"key": "inhouse", "label": "In-house"},
        ],
    )
    await create_card_type(db, key="Organization")
    rt = await create_relation_type(
        db,
        key="relAppToOrg",
        label="is owned by",
        source_type_key="Application",
        target_type_key="Organization",
    )
    rt.source_mandatory = True
    await db.flush()
    await _set_dq(db, description=0, lifecycle=0, tags=0, stakeholders=0)

    saas = await create_card(db, name="CRM", subtype="saas", attributes={"a": "x", "b": "y"})
    inhouse = await create_card(db, name="ERP", subtype="inhouse", attributes={"a": "x", "b": "y"})
    # SaaS: two filled fields and no relation slot → 100%.
    assert await calc_data_quality(db, saas) == 100.0
    # In-house: the unmet mandatory relation is a third, empty slot → 2/3.
    assert await calc_data_quality(db, inhouse) == pytest.approx(200 / 3, abs=0.1)


# ── Batched rescoring ───────────────────────────────────────────────
# `rescore_card_type` runs after every scoring-config change (a weight moved,
# a stakeholder role toggled) over every active card of the type. It used to
# cost several statements per card — the type row, the mandatory relation
# types, one EXISTS per mandatory side, two per tag group, two for
# stakeholders — which on a remote database turned one Save into seconds. The
# per-type config is now loaded once and the per-card facts in one query per
# kind per chunk, so the statement count must not grow with the card count.


@pytest.fixture
def statements(db):
    """Every statement the session sends while the fixture is live."""
    from sqlalchemy import event as sa_event

    recorded: list[str] = []
    bind = db.sync_session.get_bind()

    def _record(conn, cursor, statement, parameters, context, executemany):
        recorded.append(statement)

    sa_event.listen(bind, "before_cursor_execute", _record)
    yield recorded
    sa_event.remove(bind, "before_cursor_execute", _record)


async def _scoring_env(db):
    """Application with two mandatory relation sides (one outgoing, one
    incoming), one mandatory tag group and one counting stakeholder role.

    Fields, description and lifecycle are switched off, so a card's score is
    exactly ``satisfied / 4`` over those four slots.
    """
    from app.models.tag import Tag, TagGroup
    from tests.conftest import create_relation_type

    await create_card_type(db, key="Application", fields_schema=[])
    await create_card_type(db, key="Organization", fields_schema=[])
    await create_card_type(db, key="Provider", fields_schema=[])
    await _set_dq(db, description=0, lifecycle=0, relations=1, tags=1, stakeholders=1)
    out_rt = await create_relation_type(
        db,
        key="relAppToOrg",
        label="is owned by",
        source_type_key="Application",
        target_type_key="Organization",
    )
    out_rt.source_mandatory = True
    in_rt = await create_relation_type(
        db,
        key="relProviderToApp",
        label="supplies",
        source_type_key="Provider",
        target_type_key="Application",
    )
    in_rt.target_mandatory = True
    group = TagGroup(name="Criticality", mandatory=True, restrict_to_types=["Application"])
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="High")
    db.add(tag)
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    await create_role(db, key="member", label="Member", permissions={})
    user = await create_user(db, email="owner@test.com", role="member")
    org = await create_card(db, card_type="Organization", name="Acme")
    provider = await create_card(db, card_type="Provider", name="Vendor")
    await db.flush()
    return {"tag": tag, "user": user, "org": org, "provider": provider}


def _expected(i: int) -> float:
    held = (i % 2 == 0) + (i % 3 == 0) + (i % 5 == 0) + (i % 7 == 0)
    return round(held / 4 * 100, 1)


async def _add_apps(db, env, start: int, stop: int) -> list:
    """Cards ``start..stop-1``; card ``i`` holds the outgoing side when i%2==0,
    the incoming side when i%3==0, the tag when i%5==0 and an owner when
    i%7==0 — so every combination of the four slots occurs."""
    from app.models.card import Card
    from app.models.relation import Relation
    from app.models.stakeholder import Stakeholder
    from app.models.tag import CardTag

    cards = [Card(type="Application", name=f"App {i}", status="ACTIVE") for i in range(start, stop)]
    db.add_all(cards)
    await db.flush()
    for i, card in zip(range(start, stop), cards):
        if i % 2 == 0:
            db.add(Relation(type="relAppToOrg", source_id=card.id, target_id=env["org"].id))
        if i % 3 == 0:
            db.add(
                Relation(type="relProviderToApp", source_id=env["provider"].id, target_id=card.id)
            )
        if i % 5 == 0:
            db.add(CardTag(card_id=card.id, tag_id=env["tag"].id))
        if i % 7 == 0:
            db.add(Stakeholder(card_id=card.id, user_id=env["user"].id, role="owner"))
    await db.flush()
    return cards


async def test_rescore_card_type_statement_count_does_not_grow_with_cards(db, statements):
    from app.services.data_quality import rescore_card_type

    env = await _scoring_env(db)
    cards = await _add_apps(db, env, 0, 10)

    statements.clear()
    assert await rescore_card_type(db, "Application") == sum(_expected(i) != 0 for i in range(10))
    ten = len(statements)

    cards += await _add_apps(db, env, 10, 100)
    await db.flush()
    statements.clear()
    await rescore_card_type(db, "Application")
    hundred = len(statements)

    assert hundred == ten
    assert hundred < 20
    for i, card in enumerate(cards):
        assert card.data_quality == _expected(i), f"App {i}"


async def test_rescore_matches_the_single_card_scorer(db):
    """The batched path and `calc_data_quality` are one definition."""
    from app.services.data_quality import rescore_card_type

    env = await _scoring_env(db)
    cards = await _add_apps(db, env, 0, 42)
    await rescore_card_type(db, "Application")
    for card in cards:
        assert card.data_quality == await calc_data_quality(db, card)
    # 0 and 42 hold everything, 1 holds nothing, 6 holds both relation sides.
    assert [cards[i].data_quality for i in (0, 1, 2, 3, 6, 35)] == [
        100.0,
        0.0,
        25.0,
        25.0,
        50.0,
        50.0,
    ]


async def test_rescore_cards_scores_several_types_in_one_call(db):
    """Rollback and bulk stakeholder changes hand `rescore_cards` ids of mixed
    types: each must be scored against its own type's config, across chunk
    boundaries, and a card of a type that no longer exists scores 0."""
    from app.services.data_quality import rescore_cards

    env = await _scoring_env(db)
    apps = await _add_apps(db, env, 0, 7)
    # Organization: only the description bucket counts.
    from sqlalchemy import select

    from app.models.card_type import CardType

    org_type = (
        await db.execute(select(CardType).where(CardType.key == "Organization"))
    ).scalar_one()
    org_type.section_config = {
        "__dataQuality": {
            "description": 1,
            "lifecycle": 0,
            "relations": 0,
            "tags": 0,
            "stakeholders": 0,
        }
    }
    described = await create_card(db, card_type="Organization", name="Desc", description="x")
    bare = await create_card(db, card_type="Organization", name="Bare", data_quality=50.0)
    orphan = await create_card(db, card_type="NoSuchType", name="Orphan", data_quality=80.0)
    await db.flush()

    ids = [apps[0].id, described.id, apps[1].id, orphan.id, bare.id, apps[2].id, apps[6].id]
    # Two cards per chunk: types interleave inside a chunk and across chunks.
    changed = await rescore_cards(db, ids + [apps[0].id], chunk_size=2)

    assert apps[0].data_quality == 100.0
    assert apps[1].data_quality == 0.0
    assert apps[2].data_quality == 25.0
    assert apps[6].data_quality == 50.0
    assert described.data_quality == 100.0
    assert bare.data_quality == 0.0
    assert orphan.data_quality == 0.0
    # apps[1] already stored 0.0; every other card moved. The duplicate id is
    # scored once.
    assert changed == 6


# ── The pure scorer and its context ─────────────────────────────────


def _ctx(**overrides):
    import uuid as _uuid

    from app.services.card_completeness import (
        MandatoryConfig,
        MandatorySide,
        MandatoryTagGroup,
    )
    from app.services.data_quality import ScoringContext

    group = _uuid.uuid4()
    base = {
        "fields_schema": [],
        "subtypes": [{"key": "saas", "label": "SaaS", "optional_relations": ["relA"]}],
        "dq_cfg": {"description": 0, "lifecycle": 0, "relations": 2, "tags": 1, "stakeholders": 3},
        "mandatory": MandatoryConfig(
            sides=(
                MandatorySide("relA", "owns", "source", "Organization", "relA"),
                MandatorySide("relB", "uses", "target", "Interface", "relB"),
            ),
            tag_groups=(MandatoryTagGroup(group, "Criticality"),),
        ),
        "counting_role_keys": ("owner",),
    }
    base.update(overrides)
    return ScoringContext(**base), group


class TestScoreCard:
    async def test_weights_each_bucket(self):
        from app.models.card import Card
        from app.services.card_completeness import LinkFacts
        from app.services.data_quality import CardFacts, score_card

        ctx, group = _ctx()
        card = Card(type="Application", name="X")
        links = LinkFacts(sides=frozenset({("relA", "source")}), tag_groups=frozenset({group}))
        # relations 2 sides × 2 + tags 1 × 1 + stakeholders 3 = 8 ; filled 2 + 1.
        assert score_card(card, ctx, CardFacts(links=links)) == 37.5
        held = CardFacts(links=links, holds_counting_stakeholder=True)
        assert score_card(card, ctx, held) == 75.0
        assert score_card(card, ctx, CardFacts()) == 0.0

    async def test_a_subtype_exempted_side_is_no_slot(self):
        from app.models.card import Card
        from app.services.data_quality import CardFacts, score_card

        ctx, group = _ctx()
        card = Card(type="Application", name="X", subtype="saas")
        # relB × 2 + tag + stakeholder(3) = 6 ; only the stakeholder is held.
        assert score_card(card, ctx, CardFacts(holds_counting_stakeholder=True)) == 50.0

    async def test_no_counting_roles_is_no_slot(self):
        from app.models.card import Card
        from app.services.card_completeness import LinkFacts
        from app.services.data_quality import CardFacts, score_card

        ctx, group = _ctx(counting_role_keys=())
        links = LinkFacts(sides=frozenset({("relB", "target")}))
        # 2 sides × 2 + 1 tag = 5 ; relB held.
        assert score_card(Card(type="Application", name="X"), ctx, CardFacts(links=links)) == 40.0

    async def test_no_mandatory_config_scores_fields_alone(self):
        from app.models.card import Card
        from app.services.data_quality import CardFacts, score_card

        ctx, _ = _ctx(mandatory=None, counting_role_keys=(), fields_schema=_SCHEMA)
        card = Card(type="Application", name="X", attributes={"a": "x"})
        assert score_card(card, ctx, CardFacts()) == 50.0

    async def test_nothing_to_score_is_zero(self):
        from app.models.card import Card
        from app.services.data_quality import CardFacts, score_card

        ctx, _ = _ctx(mandatory=None, counting_role_keys=())
        assert score_card(Card(type="Application", name="X"), ctx, CardFacts()) == 0.0


class TestLoadScoringContext:
    async def test_an_unknown_type_has_no_context(self, db):
        from app.services.data_quality import load_scoring_context

        assert await load_scoring_context(db, "NoSuchType") is None

    async def test_buckets_switched_off_load_nothing(self, db, statements):
        from app.services.data_quality import load_scoring_context

        await _type(db)
        await create_stakeholder_role_def(db, card_type_key="Application", key="owner")
        await _set_dq(db, relations=0, tags=0, stakeholders=0)
        statements.clear()
        ctx = await load_scoring_context(db, "Application")
        assert len(statements) == 1
        assert ctx.mandatory is None
        assert ctx.counting_role_keys == ()
        assert ctx.fields_schema == _SCHEMA
        assert ctx.dq_cfg == {"relations": 0, "tags": 0, "stakeholders": 0}

    async def test_one_mandatory_bucket_on_loads_the_config(self, db):
        from app.services.data_quality import load_scoring_context

        await _type(db, subtypes=[{"key": "s", "label": "S"}])
        await create_stakeholder_role_def(db, card_type_key="Application", key="owner")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", counts_for_quality=False
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="legacy", is_archived=True
        )
        await create_card_type(db, key="Organization")
        await create_stakeholder_role_def(db, card_type_key="Organization", key="lead")
        for buckets in ({"relations": 0}, {"tags": 0}):
            await _set_dq(db, **buckets)
            ctx = await load_scoring_context(db, "Application")
            assert ctx.mandatory is not None
            assert ctx.counting_role_keys == ("owner",)
            assert ctx.subtypes == [{"key": "s", "label": "S"}]

    async def test_facts_for_no_cards_are_empty(self, db, statements):
        from app.services.data_quality import load_scoring_context, load_scoring_facts

        await _type(db)
        await create_stakeholder_role_def(db, card_type_key="Application", key="owner")
        ctx = await load_scoring_context(db, "Application")
        statements.clear()
        assert await load_scoring_facts(db, ctx, []) == {}


# ── The breakdown behind the score (#1334) ──────────────────────────


_BREAKDOWN_SCHEMA = [
    {
        "section": "Details",
        "fields": [
            {"key": "a", "label": "A", "type": "text", "weight": 1, "required": True},
            {"key": "b", "label": "B", "type": "text", "weight": 2},
            {"key": "c", "label": "C", "type": "text", "weight": 0},
            {"key": "secret", "label": "Secret", "type": "text", "weight": 1},
        ],
    },
    {
        "section": "More",
        "fields": [
            {"key": "flag", "label": "Flag", "type": "boolean", "required": True},
            {"key": "calc", "label": "Calc", "type": "number", "required": True, "readonly": True},
        ],
    },
]


def _breakdown_ctx(**overrides):
    """Every bucket on. For a `saas` card: fields a 1 + b 2 + flag 1 + calc 1
    (c weighs 0, `secret` is hidden) + description 1 + lifecycle 1 + relations
    2 × relB (relA is exempt) + tags 1 + stakeholders 3 = 13."""
    subtypes = [
        {
            "key": "saas",
            "label": "SaaS",
            "optional_relations": ["relA"],
            "hidden_fields": ["secret"],
        }
    ]
    dq = {"description": 1, "lifecycle": 1, "relations": 2, "tags": 1, "stakeholders": 3}
    return _ctx(
        **{"fields_schema": _BREAKDOWN_SCHEMA, "subtypes": subtypes, "dq_cfg": dq, **overrides}
    )


class TestScoreBreakdown:
    def _card(self, **kwargs):
        from app.models.card import Card

        base = {"type": "Application", "name": "X", "subtype": "saas", "attributes": {"a": "x"}}
        base.update(kwargs)
        return Card(**base)

    async def test_lists_every_slot_with_its_weight_and_state(self):
        from app.services.card_completeness import LinkFacts
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, group = _breakdown_ctx()
        facts = CardFacts(links=LinkFacts(tag_groups=frozenset({group})))
        card = self._card(lifecycle={"active": "2024-01-01"})
        bd = score_breakdown(card, ctx, facts)

        rows = [(f.kind, f.key, f.weight, f.filled) for f in bd.factors]
        assert rows == [
            ("field", "a", 1, True),
            ("field", "b", 2, False),
            ("field", "flag", 1, False),
            ("field", "calc", 1, False),
            ("description", "description", 1.0, False),
            ("lifecycle", "lifecycle", 1.0, True),
            ("relation", "relB", 2.0, False),
            ("tag_group", str(group), 1.0, True),
            ("stakeholders", "stakeholders", 3.0, False),
        ]
        # The weights are the denominator, the filled ones the numerator.
        assert bd.total_weight == 13.0
        assert sum(f.weight for f in bd.factors) == bd.total_weight
        assert bd.filled_weight == 3.0
        assert sum(f.weight for f in bd.factors if f.filled) == bd.filled_weight
        assert bd.blocked_by_required == []
        assert bd.score == bd.ungated_score == 23.1

    async def test_carries_the_metamodel_detail_each_kind_needs(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, group = _breakdown_ctx()
        bd = score_breakdown(self._card(subtype=None), ctx, CardFacts())
        by_key = {f.key: f for f in bd.factors}
        assert by_key["a"].section == "Details"
        assert by_key["calc"].section == "More"
        rel_a, rel_b = by_key["relA"], by_key["relB"]
        assert (rel_a.side, rel_a.other_type_key, rel_a.label) == ("source", "Organization", "owns")
        assert (rel_b.side, rel_b.other_type_key, rel_b.label) == ("target", "Interface", "uses")
        assert by_key[str(group)].name == "Criticality"
        # A field slot carries no relation detail, and vice versa.
        assert by_key["a"].side is None and by_key["a"].name is None
        assert rel_a.section is None and rel_a.name is None

    async def test_a_hidden_field_and_an_exempt_side_are_no_slot(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx()
        keys = [f.key for f in score_breakdown(self._card(), ctx, CardFacts()).factors]
        assert "secret" not in keys
        assert "c" not in keys  # weight 0
        assert "relA" not in keys  # exempt for `saas`
        assert keys.count("relB") == 1
        # Without the subtype both come back.
        keys = [f.key for f in score_breakdown(self._card(subtype=None), ctx, CardFacts()).factors]
        assert "secret" in keys and "relA" in keys

    async def test_one_relation_slot_per_applicable_side(self):
        from app.services.card_completeness import LinkFacts
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx()
        links = LinkFacts(sides=frozenset({("relA", "source")}))
        bd = score_breakdown(self._card(subtype=None), ctx, CardFacts(links=links))
        rels = [(f.key, f.filled) for f in bd.factors if f.kind == "relation"]
        assert rels == [("relA", True), ("relB", False)]

    async def test_switched_off_buckets_add_no_slot(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx(
            dq_cfg={"description": 0, "lifecycle": 0, "relations": 0, "tags": 0, "stakeholders": 3}
        )
        kinds = {f.kind for f in score_breakdown(self._card(), ctx, CardFacts()).factors}
        assert kinds == {"field", "stakeholders"}

    async def test_stakeholders_slot_only_with_counting_roles(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx(counting_role_keys=())
        kinds = [f.kind for f in score_breakdown(self._card(), ctx, CardFacts()).factors]
        assert "stakeholders" not in kinds
        ctx, _ = _breakdown_ctx()
        held = CardFacts(holds_counting_stakeholder=True)
        (slot,) = [
            f for f in score_breakdown(self._card(), ctx, held).factors if f.kind == "stakeholders"
        ]
        assert slot.filled is True and slot.weight == 3.0

    async def test_the_required_gate_pins_the_score_but_keeps_the_breakdown(self):
        from app.services.data_quality import CardFacts, score_breakdown, score_card

        ctx, _ = _breakdown_ctx()
        card = self._card(attributes={"b": "y"}, description="Described")
        bd = score_breakdown(card, ctx, CardFacts())
        # `a` is required and empty; `flag` (boolean) and `calc` (readonly) are exempt.
        assert bd.blocked_by_required == ["a"]
        assert bd.score == 0.0
        assert score_card(card, ctx, CardFacts()) == 0.0
        # b 2 + description 1 of 13.
        assert bd.ungated_score == 23.1
        assert len(bd.factors) == 9
        # A hidden required field does not gate.
        ctx2, _ = _ctx(
            fields_schema=[
                {"section": "S", "fields": [{"key": "secret", "type": "text", "required": True}]}
            ],
            subtypes=[{"key": "saas", "hidden_fields": ["secret"]}],
        )
        assert (
            score_breakdown(self._card(attributes={}), ctx2, CardFacts()).blocked_by_required == []
        )

    async def test_lists_every_empty_required_field_in_schema_order(self):
        from app.services.data_quality import CardFacts, score_breakdown

        schema = [
            {
                "section": "S",
                "fields": [
                    {"key": "x", "type": "text", "required": True},
                    {"key": "y", "type": "multiple_select", "required": True},
                    {"key": "z", "type": "text", "required": True},
                ],
            }
        ]
        ctx, _ = _ctx(fields_schema=schema, mandatory=None, counting_role_keys=())
        card = self._card(subtype=None, attributes={"x": "", "y": [], "z": "set"})
        assert score_breakdown(card, ctx, CardFacts()).blocked_by_required == ["x", "y"]

    async def test_score_if_filled_adds_the_slot_to_the_ungated_ratio(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, group = _breakdown_ctx()
        bd = score_breakdown(self._card(lifecycle={"active": "2024-01-01"}), ctx, CardFacts())
        # filled a 1 + lifecycle 1 = 2 of 13.
        assert (bd.filled_weight, bd.total_weight) == (2.0, 13.0)
        gains = {f.key: bd.score_if_filled(f) for f in bd.factors if not f.filled}
        assert gains == {
            "b": 30.8,  # (2 + 2) / 13
            "flag": 23.1,  # (2 + 1) / 13
            "calc": 23.1,
            "description": 23.1,
            "relB": 30.8,  # (2 + 2) / 13
            str(group): 23.1,
            "stakeholders": 38.5,  # (2 + 3) / 13
        }

    async def test_score_if_filled_rounds_to_one_decimal(self):
        from app.services.data_quality import CardFacts, score_breakdown

        schema = [
            {
                "section": "S",
                "fields": [{"key": k, "type": "text"} for k in ("p", "q", "r")],
            }
        ]
        ctx, _ = _ctx(fields_schema=schema, mandatory=None, counting_role_keys=())
        card = self._card(subtype=None, attributes={"p": "set"})
        bd = score_breakdown(card, ctx, CardFacts())
        assert bd.ungated_score == 33.3
        (q, r) = [f for f in bd.factors if not f.filled]
        # 2 / 3 → 66.666… → 66.7, never truncated to 66.6 nor left unrounded.
        assert bd.score_if_filled(q) == 66.7
        assert bd.score_if_filled(r) == 66.7

    async def test_score_if_filled_with_nothing_to_score_is_zero(self):
        from app.services.data_quality import Factor, ScoreBreakdown

        empty = ScoreBreakdown(0.0, 0.0, 0.0, 0.0, [], [])
        assert empty.score_if_filled(Factor("field", "a", 1.0, False)) == 0.0
        assert empty.gain(Factor("field", "a", 1.0, False)) == 0.0

    async def test_gain_is_the_slot_weight_over_the_total(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx()
        bd = score_breakdown(self._card(), ctx, CardFacts())
        by_key = {f.key: f for f in bd.factors}
        # Of 13: b weighs 2, relB 2, stakeholders 3, a 1 — rounded to one decimal.
        assert bd.gain(by_key["b"]) == 15.4
        assert bd.gain(by_key["relB"]) == 15.4
        assert bd.gain(by_key["stakeholders"]) == 23.1
        assert bd.gain(by_key["a"]) == 7.7
        # Gain and target agree: filling b alone lands on ungated + gain (to rounding).
        assert (
            abs(bd.score_if_filled(by_key["b"]) - (bd.ungated_score + bd.gain(by_key["b"]))) < 0.11
        )

    async def test_nothing_to_score_is_an_empty_breakdown(self):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _ctx(mandatory=None, counting_role_keys=())
        bd = score_breakdown(self._card(subtype=None, attributes={}), ctx, CardFacts())
        assert bd.factors == []
        assert (bd.total_weight, bd.filled_weight) == (0.0, 0.0)
        assert (bd.ungated_score, bd.score) == (0.0, 0.0)
        assert bd.blocked_by_required == []

    @pytest.mark.parametrize("phase", ["plan", "phaseIn", "active", "phaseOut", "endOfLife"])
    async def test_any_one_lifecycle_phase_fills_the_slot(self, phase):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx()
        card = self._card(lifecycle={phase: "2025-01-01"})
        (slot,) = [
            f for f in score_breakdown(card, ctx, CardFacts()).factors if f.kind == "lifecycle"
        ]
        assert slot.filled is True

    @pytest.mark.parametrize(
        "lifecycle", [None, {}, {"foo": "2025-01-01"}, {"active": ""}, {"active": None}]
    )
    async def test_no_dated_phase_leaves_the_lifecycle_slot_empty(self, lifecycle):
        from app.services.data_quality import CardFacts, score_breakdown

        ctx, _ = _breakdown_ctx()
        card = self._card(lifecycle=lifecycle)
        (slot,) = [
            f for f in score_breakdown(card, ctx, CardFacts()).factors if f.kind == "lifecycle"
        ]
        assert slot.filled is False

    async def test_a_field_counts_on_zero_yes_and_no_but_not_on_blank_or_cleared(self):
        """An explicit No is a maintained yes/no field (three states since #1266): it
        counts, like 0; only None, "" and [] are empty."""
        from app.services.data_quality import CardFacts, score_breakdown

        keys = ("zero", "no", "yes", "blank", "cleared", "missing")
        schema = [
            {
                "section": "S",
                "fields": [
                    {"key": k, "type": "boolean" if k in ("no", "yes") else "text"} for k in keys
                ],
            }
        ]
        ctx, _ = _ctx(fields_schema=schema, mandatory=None, counting_role_keys=())
        card = self._card(
            subtype=None,
            attributes={"zero": 0, "no": False, "yes": True, "blank": "", "cleared": []},
        )
        bd = score_breakdown(card, ctx, CardFacts())
        assert {f.key: f.filled for f in bd.factors} == {
            "zero": True,
            "no": True,
            "yes": True,
            "blank": False,
            "cleared": False,
            "missing": False,
        }
        assert (bd.total_weight, bd.filled_weight, bd.score) == (6.0, 3.0, 50.0)
        # Setting the No delivers exactly the gain the breakdown promised for it.
        before = score_breakdown(
            self._card(subtype=None, attributes={"zero": 0, "yes": True}), ctx, CardFacts()
        )
        (slot,) = [f for f in before.factors if f.key == "no"]
        assert slot.filled is False
        assert before.score + before.gain(slot) == bd.score

    async def test_each_mandatory_tag_group_is_its_own_slot(self):
        import uuid as _uuid

        from app.services.card_completeness import LinkFacts, MandatoryConfig, MandatoryTagGroup
        from app.services.data_quality import CardFacts, score_breakdown

        g1, g2 = _uuid.uuid4(), _uuid.uuid4()
        ctx, _ = _ctx(
            mandatory=MandatoryConfig(
                sides=(),
                tag_groups=(MandatoryTagGroup(g1, "Criticality"), MandatoryTagGroup(g2, "Hosting")),
            ),
            counting_role_keys=(),
            dq_cfg={"description": 0, "lifecycle": 0, "relations": 0, "tags": 4, "stakeholders": 0},
        )
        facts = CardFacts(links=LinkFacts(tag_groups=frozenset({g2})))
        bd = score_breakdown(self._card(subtype=None), ctx, facts)
        assert [(f.key, f.name, f.weight, f.filled) for f in bd.factors] == [
            (str(g1), "Criticality", 4.0, False),
            (str(g2), "Hosting", 4.0, True),
        ]
        # Two groups × the bucket weight in the denominator, the held one in the numerator.
        assert (bd.total_weight, bd.filled_weight, bd.score) == (8.0, 4.0, 50.0)
        assert bd.score_if_filled(bd.factors[0]) == 100.0

    async def test_matches_score_card_on_every_existing_fixture(self):
        from app.models.card import Card
        from app.services.card_completeness import LinkFacts
        from app.services.data_quality import CardFacts, score_breakdown, score_card

        ctx, group = _ctx()
        links = LinkFacts(sides=frozenset({("relA", "source")}), tag_groups=frozenset({group}))
        cases = [
            (ctx, Card(type="Application", name="X"), CardFacts(links=links)),
            (ctx, Card(type="Application", name="X"), CardFacts(holds_counting_stakeholder=True)),
            (ctx, Card(type="Application", name="X", subtype="saas"), CardFacts()),
            (
                _ctx(mandatory=None, counting_role_keys=(), fields_schema=_SCHEMA)[0],
                Card(type="Application", name="X", attributes={"a": "x"}),
                CardFacts(),
            ),
            (_breakdown_ctx()[0], self._card(), CardFacts()),
            (_breakdown_ctx()[0], self._card(attributes={}), CardFacts()),
        ]
        expected = [37.5, 37.5, 0.0, 50.0, 7.7, 0.0]
        for (c, card, facts), want in zip(cases, expected, strict=True):
            assert score_breakdown(card, c, facts).score == score_card(card, c, facts) == want
