"""Cost values in event feeds: one place that strips them for readers without cost access."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.models.event import Event
from app.models.user import User
from app.services.audit_labels import cost_event_summaries, license_event_summaries
from app.services.card_costs import COST_EVENT, DERIVED_KEY
from app.services.card_licenses import LEGACY_KEYS, LICENSE_EVENT, LIST_KEY
from app.services.cost_field_filter import (
    COST_ITEMS_KEY,
    cost_field_keys_from_card_schema,
)
from app.services.cost_items_migration import LEGACY_ITEMS
from app.services.event_cost_scrub import scrub_event_costs, scrub_license_values
from app.services.permission_service import PermissionService


async def all_cost_keys(db: AsyncSession) -> frozenset[str]:
    """``costTotalAnnual``, every cost-typed field key of any card type, and the keys migration
    175 moved out of the schema (legacy + catalogue): old ``card.updated`` diffs still name them."""
    schemas = (await db.execute(select(CardType.fields_schema))).scalars().all()
    catalogue = (await db.execute(select(CostItemType.key))).scalars().all()
    legacy = {k for k, _ in LEGACY_ITEMS}
    return frozenset({DERIVED_KEY, *legacy, *catalogue}).union(
        *(cost_field_keys_from_card_schema(fs) for fs in schemas)
    )


# shortcut: field keys are not reserved, so an admin-created field named like a key below is
# hidden from diffs for readers without licenses.view; upgrade by reserving these keys in the
# field-key check.
LICENSE_KEYS: frozenset[str] = frozenset({*LEGACY_KEYS, LIST_KEY})


async def redact_cost_events(
    db: AsyncSession, user: User, events: Sequence[Event], payloads: Sequence[dict | None]
) -> list[dict | None]:
    """``payloads`` (parallel to ``events``) minus the values ``user`` may not read.

    Cost values go from cards without cost access, license values from cards without license
    access. One access query per domain for the whole list (the license one only when a payload
    names a license key). The event stays; only the values go.
    """
    payloads = await scrub_event_costs(
        db, user, [(event.card_id, payload) for event, payload in zip(events, payloads)]
    )
    return await scrub_license_values(
        db, user, [(event.card_id, payload) for event, payload in zip(events, payloads)]
    )


async def reader_drop_keys(db: AsyncSession, user: User) -> frozenset[str]:
    """The change keys a live stream drops for ``user``: landscape-wide grants only (a
    stakeholder-only reader is treated as without: no per-card lookup mid-stream)."""
    drop: frozenset[str] = frozenset()
    if not await PermissionService.sees_all_costs(db, user):
        drop |= await all_cost_keys(db) | {COST_ITEMS_KEY}
    if not await PermissionService.has_app_permission(
        db, user, "licenses.view"
    ) or await PermissionService.view_denied_types(db, user):
        drop |= LICENSE_KEYS
    return drop


async def add_cost_summaries(
    db: AsyncSession, card_name: str, events: Sequence[Event], payloads: Sequence[dict | None]
) -> list[dict | None]:
    """Copies of ``payloads`` with a person-readable ``summary`` on each cost / license event."""
    out = list(payloads)
    for event_type, summarise in (
        (COST_EVENT, cost_event_summaries),
        (LICENSE_EVENT, license_event_summaries),
    ):
        idx = [
            i
            for i, e in enumerate(events)
            if e.event_type == event_type and isinstance(payloads[i], dict)
        ]
        if not idx:
            continue
        for i, text in zip(idx, await summarise(db, card_name, [payloads[i] for i in idx])):
            out[i] = {**(payloads[i] or {}), "summary": text}
    return out
