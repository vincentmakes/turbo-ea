"""Unit + DB tests for the demo card-logo seeder.

The pure-Python half is the one that earns its keep day to day: it pins every
card name against ``seed_demo.py`` and every brand-icon ref against the bundled
packs, so renaming a demo card — or a pack regeneration that drops a slug —
fails here rather than showing up as a demo install with missing logos that
nobody notices.

The DB half covers the seeder's contract: it lands rows, it is idempotent, it
tolerates a partial-demo install, and — the invariant that matters — it does not
re-date the cards it decorates.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.v1.card_logos import ALLOWED_CARD_LOGO_MIMES, MAX_CARD_LOGO_SIZE, sniff_image_mime
from app.models.card_logo import CardLogo
from app.services.brand_icons import parse_ref, resolve_brand_icon
from app.services.seed import TYPES as META_TYPES
from app.services.seed_demo import APPLICATIONS, IT_COMPONENTS
from app.services.seed_demo_logos import (
    BRAND_LOGOS,
    HOUSE_LOGO_MIME,
    HOUSE_LOGOS,
    house_logo_path,
    seed_logo_demo_data,
)
from tests.conftest import create_card, create_card_type, create_user

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _demo_cards_by_name() -> dict[str, str]:
    """Name → card type, for every Application + IT Component in the demo set."""
    return {a["name"]: "Application" for a in APPLICATIONS} | {
        c["name"]: "ITComponent" for c in IT_COMPONENTS
    }


def _logo_types() -> set[str]:
    """Card type keys the seeded metamodel lets carry a logo."""
    return {t["key"] for t in META_TYPES if t.get("allow_card_logo")}


# ---------------------------------------------------------------------------
# Card-name compatibility — no DB required
# ---------------------------------------------------------------------------


def test_every_logo_card_name_exists_in_demo_set() -> None:
    demo = _demo_cards_by_name()
    referenced = {name for name, _ in BRAND_LOGOS} | {name for name, _ in HOUSE_LOGOS}
    missing = referenced - demo.keys()
    assert not missing, (
        f"seed_demo_logos references card names that don't exist in seed_demo.py "
        f"Applications/ITComponents: {sorted(missing)}"
    )


def test_no_card_is_assigned_two_logos() -> None:
    """``card_logos.card_id`` is unique, so a duplicate would be a hard error."""
    names = [name for name, _ in BRAND_LOGOS] + [name for name, _ in HOUSE_LOGOS]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    assert not duplicates, f"cards assigned more than one logo: {duplicates}"


def test_every_logo_target_type_allows_logos() -> None:
    """A seeded row must be one the upload endpoint would itself have accepted.

    ``allow_card_logo`` is off for every type but Application and IT Component,
    and `card_logo_service` filters on it, so a logo on any other type would be
    a row that exists in the database and renders nowhere.
    """
    demo = _demo_cards_by_name()
    allowed = _logo_types()
    offenders = sorted(
        {
            f"{name} ({demo[name]})"
            for name, _ in (*BRAND_LOGOS, *HOUSE_LOGOS)
            if demo.get(name) not in allowed
        }
    )
    assert not offenders, f"logos assigned to card types that do not allow them: {offenders}"


# ---------------------------------------------------------------------------
# Brand refs resolve against the bundled packs — no DB required
# ---------------------------------------------------------------------------


def test_every_brand_ref_is_pack_pinned() -> None:
    """A bare slug would let the demo's appearance drift with `_PACKS` order."""
    bare = sorted({ref for _, ref in BRAND_LOGOS if (parse_ref(ref) or (None, ""))[0] is None})
    assert not bare, f"brand refs must name their pack (e.g. 'logos:sap'): {bare}"


def test_every_brand_ref_resolves_to_a_png() -> None:
    unknown: list[str] = []
    for name, ref in BRAND_LOGOS:
        resolved = resolve_brand_icon(ref)
        if resolved is None:
            unknown.append(f"{name} → {ref}")
            continue
        data, mime, _entry = resolved
        assert data.startswith(PNG_MAGIC), f"{ref} did not resolve to PNG bytes"
        assert mime in ALLOWED_CARD_LOGO_MIMES
        assert len(data) <= MAX_CARD_LOGO_SIZE
    assert not unknown, (
        f"brand refs the bundled packs do not carry: {unknown}. "
        f"Regenerate with `npm run gen:brand-icons` or pick another slug."
    )


# ---------------------------------------------------------------------------
# House marks are on disk and are valid images — no DB required
# ---------------------------------------------------------------------------


def test_every_house_mark_exists_and_is_a_valid_png() -> None:
    for name, stem in HOUSE_LOGOS:
        path = house_logo_path(stem)
        assert path.is_file(), (
            f"missing house mark for {name}: {path}. Run `npm run gen:demo-logos`."
        )
        data = path.read_bytes()
        assert data.startswith(PNG_MAGIC), f"{path} is not a PNG"
        assert 0 < len(data) <= MAX_CARD_LOGO_SIZE
        # The upload endpoint compares the sniffed type against the declared
        # one, so the seeder's hard-coded mime has to survive the same check.
        assert sniff_image_mime(data[:16]) == HOUSE_LOGO_MIME


# ---------------------------------------------------------------------------
# DB-backed: seeding, idempotency, missing cards, updated_at
# ---------------------------------------------------------------------------


async def _seed_metamodel_and_cards(db, names: list[str]) -> None:
    demo = _demo_cards_by_name()
    for key in sorted(_logo_types()):
        await create_card_type(db, key=key, label=key, allow_card_logo=True, built_in=True)
    await create_user(db, role="admin")
    for name in names:
        await create_card(db, card_type=demo[name], name=name)
    await db.commit()


@pytest.mark.asyncio
async def test_seed_inserts_logos_and_is_idempotent(db) -> None:
    names = [name for name, _ in BRAND_LOGOS] + [name for name, _ in HOUSE_LOGOS]
    await _seed_metamodel_and_cards(db, names)

    result = await seed_logo_demo_data(db)
    assert result.get("skipped") is not True
    assert result["brand_logos"] == len(BRAND_LOGOS)
    assert result["house_logos"] == len(HOUSE_LOGOS)

    rows = (await db.execute(select(CardLogo))).scalars().all()
    assert len(rows) == len(BRAND_LOGOS) + len(HOUSE_LOGOS)
    for row in rows:
        assert row.mime_type in ALLOWED_CARD_LOGO_MIMES
        assert row.size > 0
        assert row.created_by is not None

    # Second run is a no-op. Which of the two guards fires (durable marker or
    # the legacy row-presence inference) is deliberately not asserted — the
    # marker is what makes deleting a demo logo permanent (discussion #905).
    result2 = await seed_logo_demo_data(db)
    assert result2["skipped"] is True
    rows2 = (await db.execute(select(CardLogo))).scalars().all()
    assert len(rows2) == len(rows)


@pytest.mark.asyncio
async def test_seed_skips_logos_for_missing_cards(db) -> None:
    """A partial-demo install gets the logos it can and no error for the rest."""
    present = [BRAND_LOGOS[0][0], HOUSE_LOGOS[0][0]]
    await _seed_metamodel_and_cards(db, present)

    result = await seed_logo_demo_data(db)
    assert result["brand_logos"] == 1
    assert result["house_logos"] == 1
    rows = (await db.execute(select(CardLogo))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_seed_ignores_types_that_do_not_allow_logos(db) -> None:
    """An admin who switches a type off must not get seeded logos for it.

    `card_logo_service` filters on `allow_card_logo` on every rendering
    surface, so a row written for a switched-off type would exist in the
    database and appear nowhere — invisible clutter nobody can see to remove.
    The seeder applies the same filter itself.
    """
    demo = _demo_cards_by_name()
    allowed_type, blocked_type = "Application", "ITComponent"
    assert {allowed_type, blocked_type} <= _logo_types(), "test assumes both types ship logos on"
    await create_card_type(db, key=allowed_type, label=allowed_type, allow_card_logo=True)
    await create_card_type(db, key=blocked_type, label=blocked_type, allow_card_logo=False)
    await create_user(db, role="admin")

    allowed_name = next(n for n, _ in BRAND_LOGOS if demo[n] == allowed_type)
    blocked_name = next(n for n, _ in BRAND_LOGOS if demo[n] == blocked_type)
    allowed_card = await create_card(db, card_type=allowed_type, name=allowed_name)
    await create_card(db, card_type=blocked_type, name=blocked_name)
    await db.commit()

    result = await seed_logo_demo_data(db)
    assert result["brand_logos"] == 1

    rows = (await db.execute(select(CardLogo))).scalars().all()
    assert [r.card_id for r in rows] == [allowed_card.id], (
        f"expected a logo only on {allowed_name}, whose type allows them"
    )


@pytest.mark.asyncio
async def test_seeding_a_logo_does_not_re_date_the_card(db, card_update_sql) -> None:
    """The Inventory **Modified** column must keep meaning "content changed".

    ``card_logos`` is a side table precisely so a logo write cannot move
    ``cards.updated_at``; seeding fifty of them must not re-date fifty cards
    whose History tab would then be empty. Asserted on the emitted SQL, not on
    timestamps — ``now()`` is transaction-constant and the whole test runs in
    one transaction, so a before/after comparison passes vacuously.
    """
    name = BRAND_LOGOS[0][0]
    await _seed_metamodel_and_cards(db, [name])
    card_update_sql.clear()

    result = await seed_logo_demo_data(db)
    assert result["brand_logos"] == 1
    assert (await db.execute(select(CardLogo))).scalars().all(), "nothing was written"
    assert not card_update_sql.bumped(), (
        f"seeding a logo emitted an UPDATE that re-derived cards.updated_at: "
        f"{card_update_sql.statements}"
    )
