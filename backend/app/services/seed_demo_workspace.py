"""NexaTech Industries demo — how the workspace is organised and shared.

Four features shipped with no demo footprint at all, so on a fresh
``SEED_DEMO=true`` boot each of them looked switched off rather than merely
unused: **web portals** (nothing to open), **diagram groups** and a
**published diagram** (a flat, entirely private gallery), and **favourites**
(an empty *My Workspace* on the dashboard). This seeder populates all four
against content the earlier seeders created.

Runs last, because it attaches to things the others make: cards from
``seed_demo``, diagrams from ``seed_demo_extras``, processes from
``seed_demo_bpm``, and the ``ppmEnabled`` setting the PPM seeder flips — a
``ppm_portfolio`` portal is refused without it.

Idempotent via the durable marker in ``app_settings.general_settings.demoSeeded``
(see ``seed_markers``), with a natural-key skip per section on top, so a
partial re-seed tops up rather than duplicating. A separate seeder key rather
than an addition to ``seed_demo_extras`` because extras is already marked
complete on every existing demo install and would never run again.
"""

from __future__ import annotations

import secrets
import uuid

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.diagram import Diagram
from app.models.diagram_favorite import DiagramFavorite
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.user import User
from app.models.user_favorite import UserFavorite
from app.models.web_portal import WebPortal
from app.services.seed_markers import demo_seed_completed, mark_demo_seed_completed

# ===================================================================
# WEB PORTALS
#
# One per view the product offers, so none of the three looks switched off on a
# fresh demo. Slugs must match the route's own `_SLUG_RE` (lowercase, digits,
# hyphens). All are published: an unpublished portal has nothing to show a
# visitor, which is the state the demo was already in.
#
# `requires` is the module flag the route's own `_validate_view` checks before
# it will create the view, as `(settings_key, default_when_absent)`. The default
# is not cosmetic and differs per module — `ppmEnabled` is opt-in, `bpmEnabled`
# is opt-out — so it is carried here rather than assumed, and pinned against the
# route's helpers by a test.
# ===================================================================
PORTAL_DEFS: list[dict] = [
    {
        "name": "Application Catalogue",
        "slug": "nexatech-application-catalogue",
        "description": (
            "Public catalogue of the applications NexaTech runs, for colleagues "
            "and partners who need to look one up without an account."
        ),
        "card_type": "Application",
        "view": "cards",
        "requires": None,
        # Only approved cards face outwards — a portal is the one surface where
        # half-finished inventory is visible to people who cannot fix it.
        "filters": {"approval_statuses": ["APPROVED"]},
        "display_fields": [
            "hostingType",
            "businessCriticality",
            "numberOfUsers",
            "productName",
        ],
        "card_config": {
            # The reason this portal is in the demo at all: it is where an
            # anonymous visitor sees the seeded card logos.
            "show_logo": True,
            "toggles": {
                "description": {"card": True, "detail": True},
                "lifecycle": {"card": True, "detail": True},
                "tags": {"card": True, "detail": True},
                "subscribers": {"card": False, "detail": False},
                "data_quality": {"card": False, "detail": False},
                "approval_status": {"card": False, "detail": False},
                "field:hostingType": {"card": True, "detail": True},
                "field:businessCriticality": {"card": True, "detail": True},
            },
        },
    },
    {
        "name": "Delivery Portfolio",
        "slug": "nexatech-delivery-portfolio",
        "description": (
            "Read-only view of the change portfolio for stakeholders who need "
            "delivery status but not an account."
        ),
        # `_validate_view` pins Initiative for this view; passing anything else
        # is a 400 through the API, so match it here rather than inventing one.
        "card_type": "Initiative",
        "view": "ppm_portfolio",
        "requires": ("ppmEnabled", False),
        "filters": None,
        "display_fields": [],
        "card_config": {
            "ppm": {
                "show_costs": True,
                "show_people": False,
                "show_report_narrative": True,
            }
        },
    },
    {
        "name": "Process House",
        "slug": "nexatech-process-house",
        "description": (
            "The NexaTech process house, published for new joiners, auditors "
            "and partners who need to read how the company works without a seat."
        ),
        # Pinned to BusinessProcess by `_validate_view`, same as the portfolio
        # portal is pinned to Initiative.
        "card_type": "BusinessProcess",
        "view": "process_navigator",
        # `bpmEnabled` is opt-OUT: absent means on, so unlike PPM there is no
        # setting for a seeder to flip. The portal is skipped only where an
        # admin has explicitly switched BPM off.
        "requires": ("bpmEnabled", True),
        # Deliberately unscoped. `ProcessScope.from_portal_filters` applies
        # subtypes FLAT — a child of an in-scope process is not implicitly in
        # scope — so the tempting `{"subtypes": ["process"]}` would drop every
        # category, group and variant, Order to Cash among them. That is the one
        # demo process carrying a published BPMN flow, so the filter would
        # publish a house with nothing openable in it.
        "filters": None,
        "display_fields": [],
        "card_config": {
            "bpm": {
                # Publishes the names of the systems behind each step. Off by
                # default in the product, on here: seven of the ten Order to
                # Cash steps link to Salesforce, SAP S/4HANA and Siemens
                # Opcenter, and naming them is what makes the published flow
                # worth opening. NexaTech is fictional, so there is nothing to
                # disclose.
                "show_element_links": True,
                # The state the house opens on — client-side only, and the same
                # values the admin form defaults to, so a seeded portal is
                # indistinguishable from a hand-made one.
                "default_level": 2,
                "default_overlay": "processType",
            },
            "show_logo": True,
        },
    },
]

# ===================================================================
# DIAGRAM GROUPS — (name, colour, sort order, diagram names)
# ===================================================================
DIAGRAM_GROUP_DEFS: list[tuple[str, str, int, list[str]]] = [
    ("Architecture Overviews", "#0f7eb5", 0, ["Application Landscape Overview"]),
    (
        "Integration & Platform",
        "#02afa4",
        1,
        ["Integration Architecture", "Cloud Infrastructure"],
    ),
]

# The diagram published for the demo. One, not all three: publishing is opt-in
# per diagram and the gallery should show both states side by side.
PUBLISHED_DIAGRAM_NAME = "Application Landscape Overview"

# Diagrams starred by the demo admin.
FAVORITE_DIAGRAM_NAMES: tuple[str, ...] = (
    "Application Landscape Overview",
    "Integration Architecture",
)

# Cards starred by the demo admin — the handful someone maintaining this
# landscape would actually return to, across several card types so the
# dashboard's My Favorites list is not one long column of Applications.
FAVORITE_CARD_NAMES: tuple[str, ...] = (
    "SAP S/4HANA",
    "NexaCloud IoT Platform",
    "Apache Kafka",
    "Salesforce Sales Cloud",
    "Azure Kubernetes Service",
    "Customer Relationship Management",
)


async def _module_enabled(db: AsyncSession, key: str, default: bool) -> bool:
    """Whether an optional module is switched on for this instance.

    Mirrors ``_module_enabled`` in ``app/api/v1/web_portals.py``, deliberately
    rather than importing it: no service in this codebase imports from
    ``app.api.v1`` and this seeder should not be the first. The duplication is
    held honest by a test that pins each portal's declared default against the
    route's own helpers — getting BPM's opt-out default backwards would silently
    stop seeding the process portal on every install that never touched the
    toggle.
    """
    row = await db.execute(select(AppSettings.general_settings).limit(1))
    general = row.scalar_one_or_none() or {}
    return bool(general.get(key, default))


# ===================================================================
# Public entry point
# ===================================================================
SEEDER_KEY = "workspace"


async def seed_workspace_demo_data(db: AsyncSession) -> dict:
    """Seed web portals, diagram groups, one published diagram and favourites.

    Everything is looked up by name and skipped when absent, so the seeder
    stays compatible with a partial-demo install.
    """
    if await demo_seed_completed(db, SEEDER_KEY):
        return {"skipped": True, "reason": "already seeded"}

    # Legacy guard for installs that seeded before this seeder existed:
    # portals are only created here or by hand, so any row means either we
    # already ran or an admin has built one — in both cases, keep out.
    existing = await db.execute(select(WebPortal.id).limit(1))
    if existing.scalar_one_or_none() is not None:
        await mark_demo_seed_completed(db, SEEDER_KEY)
        await db.commit()
        return {"skipped": True, "reason": "web portals already exist"}

    admin_result = await db.execute(select(User.id).where(User.role == "admin").limit(1))
    admin_id = admin_result.scalar_one_or_none()
    if admin_id is None:
        return {"skipped": True, "reason": "no admin user found"}

    # ----- Web portals -----
    existing_slugs = set((await db.execute(select(WebPortal.slug))).scalars().all())
    portal_count = 0
    for p in PORTAL_DEFS:
        if p["slug"] in existing_slugs:
            continue
        requires = p.get("requires")
        if requires and not await _module_enabled(db, *requires):
            # The route refuses a board view whose module is off; seeding one
            # anyway would leave a portal nobody can open.
            continue
        db.add(
            WebPortal(
                id=uuid.uuid4(),
                name=p["name"],
                slug=p["slug"],
                description=p["description"],
                card_type=p["card_type"],
                filters=p["filters"],
                display_fields=p["display_fields"],
                card_config=p["card_config"],
                is_published=True,
                view=p["view"],
                access_mode="public",
                created_by=admin_id,
            )
        )
        portal_count += 1

    # ----- Diagram groups + membership -----
    diagram_rows = (await db.execute(select(Diagram.id, Diagram.name))).all()
    diagram_by_name: dict[str, uuid.UUID] = {r.name: r.id for r in diagram_rows}
    existing_groups = set((await db.execute(select(DiagramGroup.name))).scalars().all())
    group_count = 0
    membership_rows: list[dict] = []
    for name, color, sort_order, diagram_names in DIAGRAM_GROUP_DEFS:
        if name in existing_groups:
            continue
        group_id = uuid.uuid4()
        db.add(
            DiagramGroup(
                id=group_id,
                name=name,
                color=color,
                sort_order=sort_order,
                created_by=admin_id,
            )
        )
        group_count += 1
        for diagram_name in diagram_names:
            diagram_id = diagram_by_name.get(diagram_name)
            if diagram_id:
                membership_rows.append({"diagram_id": diagram_id, "group_id": group_id})
    await db.flush()
    if membership_rows:
        await db.execute(insert(diagram_group_members).values(membership_rows))

    # ----- Publish one diagram -----
    published = 0
    target = diagram_by_name.get(PUBLISHED_DIAGRAM_NAME)
    if target:
        diagram = await db.get(Diagram, target)
        if diagram and not diagram.is_published:
            # Generated here, never a constant in this file. For a public
            # diagram the URL *is* the capability (see the note on
            # `Diagram.public_slug`), so a slug committed in source would be
            # identical — and publicly known — on every install that ever runs
            # SEED_DEMO. Same call the publish endpoint makes.
            diagram.public_slug = diagram.public_slug or secrets.token_urlsafe(24)
            diagram.is_published = True
            diagram.access_mode = "public"
            published = 1

    # ----- Favourites -----
    card_rows = (await db.execute(select(Card.id, Card.name))).all()
    card_by_name: dict[str, uuid.UUID] = {r.name: r.id for r in card_rows}
    existing_card_favs = set(
        (await db.execute(select(UserFavorite.card_id).where(UserFavorite.user_id == admin_id)))
        .scalars()
        .all()
    )
    card_fav_count = 0
    for card_name in FAVORITE_CARD_NAMES:
        card_id = card_by_name.get(card_name)
        if not card_id or card_id in existing_card_favs:
            continue
        db.add(UserFavorite(id=uuid.uuid4(), user_id=admin_id, card_id=card_id))
        card_fav_count += 1

    existing_diagram_favs = set(
        (
            await db.execute(
                select(DiagramFavorite.diagram_id).where(DiagramFavorite.user_id == admin_id)
            )
        )
        .scalars()
        .all()
    )
    diagram_fav_count = 0
    for diagram_name in FAVORITE_DIAGRAM_NAMES:
        diagram_id = diagram_by_name.get(diagram_name)
        if not diagram_id or diagram_id in existing_diagram_favs:
            continue
        db.add(DiagramFavorite(id=uuid.uuid4(), user_id=admin_id, diagram_id=diagram_id))
        diagram_fav_count += 1

    await db.flush()
    await mark_demo_seed_completed(db, SEEDER_KEY)
    await db.commit()
    return {
        "portals": portal_count,
        "diagram_groups": group_count,
        "published_diagrams": published,
        "card_favorites": card_fav_count,
        "diagram_favorites": diagram_fav_count,
    }
