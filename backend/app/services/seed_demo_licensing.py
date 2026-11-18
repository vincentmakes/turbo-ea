"""Demo licensing data: license types per metric and yearly license rows on a few demo cards.

Runs after the base demo seeder. Guarded by a durable ``seed_markers`` entry, never by
the rows it created, so deleting them never brings them back on a restart.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_license import CardLicense
from app.services import license_types
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from app.services.seed_markers import demo_seed_completed, mark_demo_seed_completed

SEEDER_KEY = "licensing"

# metric -> its types (key, label); the metrics are the two seeded defaults.
TYPES = {
    "users": (("business", "Business"), ("admin", "Admin")),
    "installations": (("prod", "Prod"), ("no_prod", "No-Prod")),
}

# card type -> name -> {metric: {type key: (licensed, actual this year)}}; actual None = no data.
# One card per status in the current year: compliant, over, approaching, no actual data.
DEMO: dict[tuple[str, str], dict[str, dict[str, tuple[int, int | None]]]] = {
    ("Application", "SAP S/4HANA"): {
        "users": {"admin": (50, 30), "business": (500, 300)},
        "installations": {"prod": (40, 22)},
    },
    ("Application", "SAP Ariba"): {"users": {"business": (200, 230), "admin": (10, 6)}},
    ("Application", "SAP SuccessFactors"): {"users": {"business": (1000, 900)}},
    ("Application", "Siemens Teamcenter"): {"users": {"business": (300, None)}},
    ("ITComponent", "PostgreSQL 16"): {"installations": {"prod": (20, 12), "no_prod": (4, 3)}},
    ("ITComponent", "Datadog"): {"installations": {"prod": (30, 28)}},
}
# The first year (relative to the current one) a pair has a cell; absent = every year.
# So a card's pairs differ by year.
SINCE: dict[tuple[str, str], dict[tuple[str, str], int]] = {
    ("Application", "SAP S/4HANA"): {("installations", "prod"): -1},
    ("Application", "SAP Ariba"): {("users", "admin"): 0},
    ("ITComponent", "PostgreSQL 16"): {("installations", "no_prod"): -1},
}
# Past years run a little smaller; the Forecast year carries the current licensed only.
PAST_SCALE = {2: 0.8, 1: 0.9}


def _items(
    rows: dict[str, dict[str, tuple[int, int | None]]],
    offset: int,
    since: dict[tuple[str, str], int],
) -> dict[str, dict[str, dict[str, int | None]]]:
    """``offset`` is the year relative to the current one (-2 ... +1)."""
    out: dict[str, dict[str, dict[str, int | None]]] = {}
    for metric, by_type in rows.items():
        for key, (licensed, actual) in by_type.items():
            if offset < since.get((metric, key), -2):
                continue
            if offset > 0:
                cell = {"licensed": licensed, "actual": None}
            elif offset == 0:
                cell = {"licensed": licensed, "actual": actual}
            else:
                scale = PAST_SCALE[-offset]
                cell = {
                    "licensed": round(licensed * scale),
                    "actual": None if actual is None else round(actual * scale),
                }
            out.setdefault(metric, {})[key] = cell
    return out


async def seed_licensing_demo_data(db: AsyncSession) -> dict:
    if await demo_seed_completed(db, SEEDER_KEY):
        return {"skipped": True, "reason": "already seeded"}

    names = {name for _, name in DEMO}
    cards = {
        (c.type, c.name): c
        for c in (await db.execute(select(Card).where(Card.name.in_(names)))).scalars()
        if (c.type, c.name) in DEMO and c.status == "ACTIVE"
    }
    if not cards:
        return {"skipped": True, "reason": "no demo cards"}

    await license_types.seed_default_metrics(db)
    for metric, types in TYPES.items():
        for key, label in types:
            if await license_types.get_item(db, metric, key) is None:
                await license_types.create_item(db, metric, key, label)

    year = current_fiscal_year(await get_fiscal_year_start(db))
    # Natural-key skip: a card that already has any licence row (migrated or entered) is left alone.
    licensed = set(
        (
            await db.execute(
                select(CardLicense.card_id).where(
                    CardLicense.card_id.in_([c.id for c in cards.values()])
                )
            )
        ).scalars()
    )
    for ident, card in cards.items():
        if card.id in licensed:
            continue
        for offset in (-2, -1, 0, 1):
            db.add(
                CardLicense(
                    card_id=card.id,
                    fiscal_year=year + offset,
                    items=_items(DEMO[ident], offset, SINCE.get(ident, {})),
                )
            )
    await mark_demo_seed_completed(db, SEEDER_KEY)
    await db.flush()
    return {"skipped": False, "cards": len(cards)}
