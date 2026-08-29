"""Unit + DB tests for the demo workspace seeder.

The unit half pins the seeded portals against the rules the *route* enforces —
slug shape, a card type the metamodel actually defines, a view the API accepts,
and the `Initiative` card type the PPM view is pinned to. A portal that fails
any of those would be one an admin could never have created through the UI, and
in the PPM case one nobody could open.

The DB half covers the seeder's contract: it lands rows, it is idempotent, it
tolerates a partial-demo install, and the published diagram's slug is minted at
seed time rather than shipped as a constant.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import select

from app.api.v1.web_portals import (
    _ACCESS_MODES,
    _SLUG_RE,
    _VIEW_CARD_TYPES,
    _VIEWS,
    _bpm_enabled,
    _ppm_enabled,
)
from app.models.diagram import Diagram
from app.models.diagram_favorite import DiagramFavorite
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.user_favorite import UserFavorite
from app.models.web_portal import WebPortal
from app.services.seed import TYPES as META_TYPES
from app.services.seed_demo_extras import DIAGRAM_DEFS
from app.services.seed_demo_workspace import (
    DIAGRAM_GROUP_DEFS,
    FAVORITE_CARD_NAMES,
    FAVORITE_DIAGRAM_NAMES,
    PORTAL_DEFS,
    PUBLISHED_DIAGRAM_NAME,
    seed_workspace_demo_data,
)
from tests.conftest import create_card, create_user

_META_TYPE_KEYS = {t["key"] for t in META_TYPES}
_DEMO_DIAGRAM_NAMES = {d["name"] for d in DIAGRAM_DEFS}


def _fields_of(type_key: str) -> set[str]:
    t = next(t for t in META_TYPES if t["key"] == type_key)
    return {f["key"] for sec in t.get("fields_schema", []) for f in sec.get("fields", [])}


# ---------------------------------------------------------------------------
# Portals match what the route would accept — no DB required
# ---------------------------------------------------------------------------


def test_portal_slugs_are_unique_and_route_shaped() -> None:
    slugs = [p["slug"] for p in PORTAL_DEFS]
    assert len(slugs) == len(set(slugs)), f"duplicate portal slugs: {slugs}"
    bad = [s for s in slugs if not _SLUG_RE.match(s)]
    assert not bad, f"slugs the create route would reject: {bad}"


def test_portal_card_types_and_views_are_valid() -> None:
    for p in PORTAL_DEFS:
        assert p["card_type"] in _META_TYPE_KEYS, f"{p['slug']}: unknown card type"
        assert p["view"] in _VIEWS, f"{p['slug']}: unknown view '{p['view']}'"


def test_board_portals_pin_the_card_type_the_route_pins() -> None:
    """`_validate_view` overrides card_type for every non-"cards" view, so
    seeding a different one puts a value in the database the API can never
    produce. Driven off the route's own `_VIEW_CARD_TYPES` rather than a
    per-view constant, so a fourth board view is covered without editing this.
    """
    for p in PORTAL_DEFS:
        pinned = _VIEW_CARD_TYPES.get(p["view"])
        if pinned is not None:
            assert p["card_type"] == pinned, (
                f"{p['slug']}: the route pins {p['view']} to {pinned}, not {p['card_type']}"
            )


def test_every_board_view_has_a_demo_portal() -> None:
    """A view with no seeded portal looks switched off on a fresh demo — which
    is the gap this seeder exists to close, and the one a new view reopens."""
    seeded = {p["view"] for p in PORTAL_DEFS}
    missing = set(_VIEWS) - seeded
    assert not missing, f"portal views with no demo portal: {sorted(missing)}"


@pytest.mark.asyncio
async def test_declared_module_defaults_match_the_route(db) -> None:
    """The seeder mirrors the route's module gate instead of importing it (no
    service imports from `app.api.v1`), so pin the two against each other.

    The defaults are not cosmetic and differ per module: `ppmEnabled` is opt-in,
    `bpmEnabled` opt-out. Getting BPM's backwards would silently stop seeding
    the process portal on every install that never touched the toggle.
    """
    route_defaults = {"ppmEnabled": _ppm_enabled, "bpmEnabled": _bpm_enabled}
    # No settings row at all: each helper then returns its own default.
    for p in PORTAL_DEFS:
        requires = p.get("requires")
        if not requires:
            continue
        key, declared = requires
        helper = route_defaults.get(key)
        assert helper is not None, f"{p['slug']}: no route helper known for {key!r}"
        assert await helper(db) is declared, (
            f"{p['slug']}: declares {key}={declared} but the route defaults to the opposite"
        )


def test_portal_display_fields_exist_on_the_target_type() -> None:
    for p in PORTAL_DEFS:
        unknown = set(p["display_fields"] or []) - _fields_of(p["card_type"])
        assert not unknown, f"{p['slug']}: display_fields not on {p['card_type']}: {unknown}"


def test_portal_field_toggles_exist_on_the_target_type() -> None:
    """A `field:` toggle naming a field the type does not have renders nothing."""
    for p in PORTAL_DEFS:
        toggles = (p["card_config"] or {}).get("toggles", {})
        referenced = {k.split(":", 1)[1] for k in toggles if k.startswith("field:")}
        unknown = referenced - _fields_of(p["card_type"])
        assert not unknown, f"{p['slug']}: toggles name unknown fields: {unknown}"


def test_navigator_portal_is_not_subtype_scoped() -> None:
    """`ProcessScope.from_portal_filters` applies subtypes FLAT — a child of an
    in-scope process is not implicitly in scope. Scoping the demo house to
    `subtypes: ["process"]` would therefore drop every category, group and
    variant, Order to Cash among them — and that group is the only demo process
    carrying a published BPMN flow, so the portal would publish a hierarchy with
    nothing openable in it.
    """
    for p in PORTAL_DEFS:
        if p["view"] != "process_navigator":
            continue
        subtypes = (p["filters"] or {}).get("subtypes")
        assert not subtypes, (
            f"{p['slug']}: subtype-scoping the process house hides the groups "
            f"that carry the published flows"
        )


def test_navigator_portal_publishes_its_element_links() -> None:
    """`show_element_links` is off by default server-side, so the demo has to
    set it explicitly — it is what names Salesforce, SAP and Opcenter on the
    Order to Cash steps, and without it the published flow is anonymous boxes."""
    for p in PORTAL_DEFS:
        if p["view"] != "process_navigator":
            continue
        bpm = (p["card_config"] or {}).get("bpm", {})
        assert bpm.get("show_element_links") is True


def test_catalogue_portal_shows_logos() -> None:
    """The whole reason a card portal is in the demo: an anonymous visitor
    seeing the seeded logos. `show_logo: False` would quietly undo that."""
    cards_portals = [p for p in PORTAL_DEFS if p["view"] == "cards"]
    assert cards_portals, "the demo needs at least one card portal"
    for p in cards_portals:
        assert (p["card_config"] or {}).get("show_logo") is not False


# ---------------------------------------------------------------------------
# Diagram + card references resolve — no DB required
# ---------------------------------------------------------------------------


def test_every_referenced_diagram_exists_in_the_extras_seeder() -> None:
    referenced = {n for _, _, _, names in DIAGRAM_GROUP_DEFS for n in names}
    referenced |= set(FAVORITE_DIAGRAM_NAMES) | {PUBLISHED_DIAGRAM_NAME}
    missing = referenced - _DEMO_DIAGRAM_NAMES
    assert not missing, (
        f"seed_demo_workspace references diagrams seed_demo_extras does not create: "
        f"{sorted(missing)}"
    )


def test_every_favourite_card_exists_in_the_demo_set() -> None:
    from app.services.seed_demo import _ALL_CARDS

    names = {c["name"] for c in _ALL_CARDS}
    missing = set(FAVORITE_CARD_NAMES) - names
    assert not missing, f"favourite cards not in seed_demo.py: {sorted(missing)}"


def test_diagram_group_names_are_unique() -> None:
    names = [n for n, _, _, _ in DIAGRAM_GROUP_DEFS]
    assert len(names) == len(set(names)), f"duplicate group names: {names}"


def test_no_public_slug_is_hard_coded() -> None:
    """For a published diagram the URL *is* the capability, so a slug committed
    in source would be the same — and publicly known — on every install."""
    import inspect

    from app.services import seed_demo_workspace

    source = inspect.getsource(seed_demo_workspace)
    assert "token_urlsafe" in source, "the public slug must be generated at seed time"
    assert 'public_slug="' not in source, "a hard-coded public slug is a shared secret"


# ---------------------------------------------------------------------------
# DB-backed
# ---------------------------------------------------------------------------


async def _prepare(db, *, ppm_enabled: bool = True, bpm_enabled: bool | None = None) -> None:
    """Enough of a demo install for the workspace seeder to attach to.

    ``bpm_enabled=None`` leaves the key absent, which is the state every install
    that never touched the BPM toggle is in — and the one the process portal has
    to work in.
    """
    from app.models.app_settings import AppSettings

    await create_user(db, role="admin")
    for name in FAVORITE_CARD_NAMES:
        await create_card(db, name=name)
    for d in DIAGRAM_DEFS:
        db.add(Diagram(name=d["name"], description=d.get("description"), data={"xml": "<mxfile/>"}))
    general = {"ppmEnabled": ppm_enabled}
    if bpm_enabled is not None:
        general["bpmEnabled"] = bpm_enabled
    db.add(AppSettings(id="default", general_settings=general))
    await db.commit()


@pytest.mark.asyncio
async def test_seed_populates_the_workspace_and_is_idempotent(db) -> None:
    await _prepare(db)

    result = await seed_workspace_demo_data(db)
    assert result.get("skipped") is not True
    assert result["portals"] == len(PORTAL_DEFS)
    assert result["diagram_groups"] == len(DIAGRAM_GROUP_DEFS)
    assert result["published_diagrams"] == 1
    assert result["card_favorites"] == len(FAVORITE_CARD_NAMES)
    assert result["diagram_favorites"] == len(FAVORITE_DIAGRAM_NAMES)

    portals = (await db.execute(select(WebPortal))).scalars().all()
    assert {p.slug for p in portals} == {p["slug"] for p in PORTAL_DEFS}
    assert all(p.is_published and p.access_mode in _ACCESS_MODES for p in portals)

    groups = (await db.execute(select(DiagramGroup))).scalars().all()
    assert {g.name for g in groups} == {n for n, _, _, _ in DIAGRAM_GROUP_DEFS}
    members = (await db.execute(select(diagram_group_members))).all()
    assert len(members) == sum(len(names) for _, _, _, names in DIAGRAM_GROUP_DEFS)

    assert len((await db.execute(select(UserFavorite))).scalars().all()) == len(FAVORITE_CARD_NAMES)
    assert len((await db.execute(select(DiagramFavorite))).scalars().all()) == len(
        FAVORITE_DIAGRAM_NAMES
    )

    # Second run is a no-op — the durable marker is what keeps a deleted demo
    # portal deleted (discussion #905).
    result2 = await seed_workspace_demo_data(db)
    assert result2["skipped"] is True
    assert len((await db.execute(select(WebPortal))).scalars().all()) == len(PORTAL_DEFS)


@pytest.mark.asyncio
async def test_published_diagram_gets_a_generated_slug(db) -> None:
    await _prepare(db)
    await seed_workspace_demo_data(db)

    published = (
        (await db.execute(select(Diagram).where(Diagram.is_published.is_(True)))).scalars().all()
    )
    assert len(published) == 1, "exactly one demo diagram should be published"
    diagram = published[0]
    assert diagram.name == PUBLISHED_DIAGRAM_NAME
    assert diagram.access_mode == "public"
    # Unguessable, and not derived from the name — same shape the publish
    # endpoint mints with secrets.token_urlsafe(24).
    assert diagram.public_slug and len(diagram.public_slug) >= 24
    assert not re.search(r"application|landscape", diagram.public_slug, re.I)


@pytest.mark.asyncio
async def test_ppm_portal_is_skipped_when_ppm_is_off(db) -> None:
    """The route refuses a portfolio portal without PPM, so seeding one anyway
    would leave a portal in the gallery that nobody can open."""
    await _prepare(db, ppm_enabled=False)

    result = await seed_workspace_demo_data(db)
    slugs = {p.slug for p in (await db.execute(select(WebPortal))).scalars().all()}
    expected = {p["slug"] for p in PORTAL_DEFS if p["view"] != "ppm_portfolio"}
    assert slugs == expected
    assert result["portals"] == len(expected)


@pytest.mark.asyncio
async def test_process_portal_is_seeded_when_bpm_was_never_toggled(db) -> None:
    """BPM is opt-OUT, the mirror image of PPM: an absent `bpmEnabled` means on.

    Treating it like PPM's opt-in default would skip the process portal on every
    install whose admin never opened the BPM toggle — i.e. nearly all of them.
    """
    await _prepare(db, bpm_enabled=None)

    await seed_workspace_demo_data(db)
    slugs = {p.slug for p in (await db.execute(select(WebPortal))).scalars().all()}
    navigator = next(p["slug"] for p in PORTAL_DEFS if p["view"] == "process_navigator")
    assert navigator in slugs


@pytest.mark.asyncio
async def test_process_portal_is_skipped_when_bpm_is_explicitly_off(db) -> None:
    """Only an explicit `false` takes it out — matching what the route refuses."""
    await _prepare(db, bpm_enabled=False)

    result = await seed_workspace_demo_data(db)
    slugs = {p.slug for p in (await db.execute(select(WebPortal))).scalars().all()}
    expected = {p["slug"] for p in PORTAL_DEFS if p["view"] != "process_navigator"}
    assert slugs == expected
    assert result["portals"] == len(expected)


@pytest.mark.asyncio
async def test_seed_tolerates_missing_diagrams_and_cards(db) -> None:
    """A partial-demo install gets what it can, and no error for the rest."""
    from app.models.app_settings import AppSettings

    await create_user(db, role="admin")
    db.add(AppSettings(id="default", general_settings={"ppmEnabled": True}))
    await db.commit()

    result = await seed_workspace_demo_data(db)
    assert result.get("skipped") is not True
    assert result["portals"] == len(PORTAL_DEFS)
    assert result["published_diagrams"] == 0
    assert result["card_favorites"] == 0
    assert result["diagram_favorites"] == 0
    # Groups are still created; they simply have no members to attach.
    assert result["diagram_groups"] == len(DIAGRAM_GROUP_DEFS)
    assert (await db.execute(select(diagram_group_members))).all() == []
