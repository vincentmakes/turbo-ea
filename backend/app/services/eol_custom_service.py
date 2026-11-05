"""Custom EOL products: the organisation's own end-of-life data.

endoflife.date tracks popular software. A product it lacks — an in-house
platform, a niche vendor tool, an appliance — used to leave a card with only
its own ``lifecycle.endOfLife`` date. A custom product is defined once, with
release cycles, and linked from any number of cards through the very same two
attributes an endoflife.date link uses::

    attributes.eol_product = "custom:<key>"
    attributes.eol_cycle   = "<cycle>"

The ``custom:`` prefix is what tells the two apart. A ``:`` never occurs in an
endoflife.date slug, so the namespaces cannot collide, and the SSRF guard on
the upstream proxy (``^[a-zA-Z0-9._-]+$``) already refuses to send one out.
Because both keys are set, coverage (``card_flags.has_eol_link``) counts a
custom link as *linked* with no change, and the resolver
(``eol_service.resolve_eol_statuses``) classifies a custom cycle with the same
``eol_status`` an upstream cycle gets.

Everything here takes the caller's session and never commits it; the route
owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.eol_custom_cycle import EolCustomCycle
from app.models.eol_custom_product import EolCustomProduct
from app.models.user import User
from app.schemas.eol_custom import (
    MAX_CYCLES_PER_PRODUCT,
    EolCustomCycleCreate,
    EolCustomCycleUpdate,
    EolCustomProductCreate,
    EolCustomProductUpdate,
    product_key_from_title,
)
from app.services import audit_log
from app.services.card_flags import EOL_CYCLE_KEY, EOL_PRODUCT_KEY
from app.services.card_read_scope import CardReadScope
from app.services.event_bus import event_bus

CUSTOM_PREFIX = "custom:"

#: Cycle columns a PATCH may set, mapped to the field name the audit row shows.
_CYCLE_FIELDS = ("cycle", "release_date", "support", "eol", "latest", "latest_release_date")


def is_custom_product(product: Any) -> bool:
    """True for a card link that points at a custom product."""
    return isinstance(product, str) and product.startswith(CUSTOM_PREFIX)


def product_ref(key: str) -> str:
    """The value a card stores for the custom product ``key``."""
    return f"{CUSTOM_PREFIX}{key}"


def key_of(product: str) -> str:
    """The custom product key inside a ``custom:<key>`` link."""
    return product[len(CUSTOM_PREFIX) :]


def cycle_to_dict(c: EolCustomCycle) -> dict[str, Any]:
    """A cycle in endoflife.date's shape, so one classifier reads both."""
    return {
        "cycle": c.cycle,
        "releaseDate": c.release_date,
        "eol": c.eol,
        "support": c.support,
        "latest": c.latest,
        "latestReleaseDate": c.latest_release_date,
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def sorted_cycles(cycles: Iterable[EolCustomCycle]) -> list[EolCustomCycle]:
    """Cycles in display order: ``sort_order``, then newest release first."""
    by_date = sorted(cycles, key=lambda c: c.release_date or "", reverse=True)
    return sorted(by_date, key=lambda c: (c.sort_order, c.release_date is None))


async def load_custom_cycles(db: AsyncSession, products: Iterable[object]) -> dict[str, list[dict]]:
    """``{"custom:<key>": [cycle, ...]}`` for every custom link in ``products``.

    ``products`` are raw ``attributes.eol_product`` values, so anything goes:
    ``None``, a non-string, an upstream slug. One query whatever the number of
    products. Links to an upstream product are ignored, and a custom product
    that no longer exists is simply absent —
    the caller then classifies its cards as ``unknown``, the same as an
    upstream cycle that disappeared.
    """
    keys = {key_of(p) for p in products if isinstance(p, str) and is_custom_product(p)}
    if not keys:
        return {}
    rows = (
        (await db.execute(select(EolCustomCycle).where(EolCustomCycle.product_key.in_(keys))))
        .scalars()
        .all()
    )
    out: dict[str, list[dict]] = {product_ref(k): [] for k in keys}
    # The product's title names it wherever a card does (endoflife.date
    # products are named by their slug), and its link (a vendor policy or
    # release page) stands in for endoflife.date's per-cycle `link`.
    product_rows = await db.execute(
        select(EolCustomProduct.key, EolCustomProduct.title, EolCustomProduct.link).where(
            EolCustomProduct.key.in_(keys)
        )
    )
    products_by_key = {key: (title, link) for key, title, link in product_rows.all()}
    for c in sorted_cycles(rows):
        title, link = products_by_key.get(c.product_key, (None, None))
        out[product_ref(c.product_key)].append({**cycle_to_dict(c), "title": title, "link": link})
    return {ref: cycles for ref, cycles in out.items() if key_of(ref) in products_by_key}


async def linked_counts(
    db: AsyncSession, read_scope: CardReadScope | None
) -> dict[tuple[str, str], int]:
    """``{(product key, cycle): n}`` — cards linked to each custom cycle.

    A link with no cycle is counted under the cycle ``""`` (never a real
    cycle name), so a product's total still includes it.

    Counts what the caller may see (module mode, like the EOL report), so the
    number on a row agrees with the cards the caller can find. Archived cards
    are counted too: their link survives a restore, so deleting the cycle
    under them would still break it.
    """
    product_col = Card.attributes[EOL_PRODUCT_KEY].astext
    cycle_col = Card.attributes[EOL_CYCLE_KEY].astext
    stmt = (
        select(product_col, cycle_col, func.count())
        .where(product_col.like(f"{CUSTOM_PREFIX}%"))
        .group_by(product_col, cycle_col)
    )
    if read_scope is not None:
        stmt = stmt.where(*read_scope.where(Card, mode="module"))
    out: dict[tuple[str, str], int] = {}
    for product, cycle, count in (await db.execute(stmt)).all():
        slot = (key_of(product), cycle or "")
        out[slot] = out.get(slot, 0) + int(count)
    return out


def product_payload(
    product: EolCustomProduct,
    cycles: Iterable[EolCustomCycle],
    counts: Mapping[tuple[str, str], int],
) -> dict[str, Any]:
    """The admin grid's view of one product with its cycles and usage."""
    out_cycles = [
        {
            "id": str(c.id),
            "cycle": c.cycle,
            "release_date": c.release_date,
            "support": c.support,
            "eol": c.eol,
            "latest": c.latest,
            "latest_release_date": c.latest_release_date,
            "sort_order": c.sort_order,
            "linked_cards": counts.get((product.key, c.cycle), 0),
            "updated_at": _iso(c.updated_at),
        }
        for c in sorted_cycles(cycles)
    ]
    # Cards linked to a cycle that no longer exists still link the product.
    linked = sum(n for (k, _cycle), n in counts.items() if k == product.key)
    return {
        "id": str(product.id),
        "key": product.key,
        "product": product_ref(product.key),
        "title": product.title,
        "description": product.description,
        "link": product.link,
        "eol_category": product.eol_category,
        "release_policy_note": product.release_policy_note,
        "linked_cards": linked,
        "cycles": out_cycles,
        "updated_at": _iso(product.updated_at),
    }


async def list_products(db: AsyncSession, read_scope: CardReadScope | None) -> list[dict]:
    """Every custom product with its cycles and usage counts, by title."""
    products = (
        (await db.execute(select(EolCustomProduct).order_by(func.lower(EolCustomProduct.title))))
        .scalars()
        .all()
    )
    cycles = (await db.execute(select(EolCustomCycle))).scalars().all()
    by_product: dict[str, list[EolCustomCycle]] = {}
    for c in cycles:
        by_product.setdefault(c.product_key, []).append(c)
    counts = await linked_counts(db, read_scope)
    return [product_payload(p, by_product.get(p.key, []), counts) for p in products]


async def product_titles(db: AsyncSession) -> list[tuple[str, str]]:
    """``[(key, title)]`` — what the product search matches against."""
    rows = await db.execute(select(EolCustomProduct.key, EolCustomProduct.title))
    return [(k, t) for k, t in rows.all()]


async def get_product(db: AsyncSession, key: str) -> EolCustomProduct:
    product = (
        await db.execute(select(EolCustomProduct).where(EolCustomProduct.key == key))
    ).scalar_one_or_none()
    if product is None:
        raise HTTPException(404, "Custom EOL product not found")
    return product


async def _product_cycles(db: AsyncSession, key: str) -> list[EolCustomCycle]:
    return list(
        (await db.execute(select(EolCustomCycle).where(EolCustomCycle.product_key == key)))
        .scalars()
        .all()
    )


async def product_cycles(db: AsyncSession, key: str) -> list[dict]:
    """A product's cycles in endoflife.date's shape (404 when unknown)."""
    product = await get_product(db, key)
    return [
        {**cycle_to_dict(c), "title": product.title, "link": product.link}
        for c in sorted_cycles(await _product_cycles(db, key))
    ]


def _new_cycle(key: str, body: EolCustomCycleCreate, sort_order: int) -> EolCustomCycle:
    return EolCustomCycle(
        product_key=key,
        cycle=body.cycle,
        release_date=body.release_date,
        support=body.support,
        eol=body.eol,
        latest=body.latest,
        latest_release_date=body.latest_release_date,
        sort_order=body.sort_order if body.sort_order is not None else sort_order,
    )


def _target(product: EolCustomProduct) -> tuple[str, str, str]:
    return ("eol_custom_product", product.key, product.title)


async def create_product(
    db: AsyncSession, user: User, body: EolCustomProductCreate
) -> EolCustomProduct:
    """Create a product and its initial cycles in one step.

    The key is generated from the title unless the caller (the API, a
    workspace import) gives one: nobody types it, and two products may share
    a title, so a generated key that exists gets ``-2``, ``-3``, … An explicit
    key that exists is a 409.
    """
    if body.key is None:
        key = await _free_key(db, product_key_from_title(body.title) or "product")
    else:
        key = body.key
        taken = (
            await db.execute(select(EolCustomProduct.id).where(EolCustomProduct.key == key))
        ).scalar_one_or_none()
        if taken is not None:
            raise HTTPException(409, "A custom EOL product with this key already exists")
    product = EolCustomProduct(
        key=key,
        title=body.title,
        description=body.description,
        link=body.link,
        eol_category=body.eol_category,
        release_policy_note=body.release_policy_note,
        created_by=user.id,
    )
    db.add(product)
    await db.flush()
    for c in body.cycles:
        db.add(_new_cycle(key, c, 0))
    await db.flush()
    await audit_log.record(
        db,
        action="admin.eol_custom_product.created",
        category="admin",
        actor=user,
        target=_target(product),
        context={"key": product.key, "cycles": [c.cycle for c in body.cycles]},
    )
    return product


async def _free_key(db: AsyncSession, base: str) -> str:
    """``base``, or the first of ``base-2``, ``base-3``, … no product has."""
    taken = set(
        (
            await db.execute(
                select(EolCustomProduct.key).where(EolCustomProduct.key.like(f"{base}%"))
            )
        )
        .scalars()
        .all()
    )
    if base not in taken:
        return base
    n = 2
    while True:
        suffix = f"-{n}"
        candidate = f"{base[: 100 - len(suffix)]}{suffix}"
        if candidate not in taken:
            return candidate
        n += 1


async def update_product(
    db: AsyncSession, user: User, key: str, body: EolCustomProductUpdate
) -> EolCustomProduct:
    product = await get_product(db, key)
    changes: dict[str, dict[str, Any]] = {}
    for field in ("title", "description", "link", "eol_category", "release_policy_note"):
        if field not in body.model_fields_set:
            continue
        new = getattr(body, field)
        if field == "title" and new is None:
            continue  # a title can be changed, never cleared
        old = getattr(product, field)
        if old != new:
            changes[field] = {"old": old, "new": new}
            setattr(product, field, new)
    if changes:
        await db.flush()
        await audit_log.record(
            db,
            action="admin.eol_custom_product.updated",
            category="admin",
            actor=user,
            target=_target(product),
            changes=changes,
        )
    return product


async def _all_link_count(db: AsyncSession, key: str, cycle: str | None = None) -> int:
    """Every card linking the product (or one cycle), whoever may see it."""
    stmt = (
        select(func.count())
        .select_from(Card)
        .where(Card.attributes[EOL_PRODUCT_KEY].astext == product_ref(key))
    )
    if cycle is not None:
        stmt = stmt.where(Card.attributes[EOL_CYCLE_KEY].astext == cycle)
    return int((await db.execute(stmt)).scalar_one())


async def delete_product(
    db: AsyncSession, user: User, key: str, read_scope: CardReadScope | None
) -> None:
    """Delete a product nothing links to any more (409 ``cards_linked``).

    Any linked card blocks the delete, including one the caller cannot see:
    deleting would silently turn that card's status into "unknown". The 409
    reports only the visible count, so it never reveals a hidden card.
    """
    product = await get_product(db, key)
    if await _all_link_count(db, key):
        counts = await linked_counts(db, read_scope)
        visible = sum(n for (k, _c), n in counts.items() if k == key)
        raise HTTPException(
            409,
            {
                "code": "cards_linked",
                "count": visible,
                "message": "Cards are still linked to this product",
            },
        )
    await audit_log.record(
        db,
        action="admin.eol_custom_product.deleted",
        category="admin",
        actor=user,
        target=_target(product),
    )
    await db.execute(delete(EolCustomCycle).where(EolCustomCycle.product_key == key))
    await db.delete(product)
    await db.flush()


async def create_cycle(
    db: AsyncSession, user: User, key: str, body: EolCustomCycleCreate
) -> EolCustomCycle:
    product = await get_product(db, key)
    existing = await _product_cycles(db, key)
    if any(c.cycle == body.cycle for c in existing):
        raise HTTPException(409, "This product already has a cycle with that name")
    if len(existing) >= MAX_CYCLES_PER_PRODUCT:
        raise HTTPException(422, f"A product has at most {MAX_CYCLES_PER_PRODUCT} cycles")
    cycle = _new_cycle(key, body, 0)
    db.add(cycle)
    await db.flush()
    await audit_log.record(
        db,
        action="admin.eol_custom_cycle.created",
        category="admin",
        actor=user,
        target=_target(product),
        context={"cycle": cycle.cycle},
    )
    return cycle


async def _get_cycle(db: AsyncSession, key: str, cycle_id: str) -> EolCustomCycle:
    try:
        cycle = await db.get(EolCustomCycle, uuid.UUID(cycle_id))
    except ValueError:
        cycle = None
    if cycle is None or cycle.product_key != key:
        raise HTTPException(404, "Cycle not found")
    return cycle


async def update_cycle(
    db: AsyncSession, user: User, key: str, cycle_id: str, body: EolCustomCycleUpdate
) -> EolCustomCycle:
    """Patch one cycle — the admin grid's per-cell and drag-fill write.

    Renaming a cycle moves the cards linked to it along with it, so a typo
    fix never orphans a link (each card gets its own History entry).
    """
    product = await get_product(db, key)
    cycle = await _get_cycle(db, key, cycle_id)
    new_values = {f: getattr(body, f) for f in _CYCLE_FIELDS if f in body.model_fields_set}
    if new_values.get("cycle", cycle.cycle) is None:
        new_values.pop("cycle")  # a cycle can be renamed, never unnamed
    merged = {f: new_values.get(f, getattr(cycle, f)) for f in _CYCLE_FIELDS}
    try:
        EolCustomCycleCreate.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors()[0]["msg"]) from exc
    renamed_to = new_values.get("cycle")
    if renamed_to is not None and renamed_to != cycle.cycle:
        clash = (
            await db.execute(
                select(EolCustomCycle.id).where(
                    EolCustomCycle.product_key == key, EolCustomCycle.cycle == renamed_to
                )
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(409, "This product already has a cycle with that name")

    changes = {
        f: {"old": getattr(cycle, f), "new": v}
        for f, v in new_values.items()
        if getattr(cycle, f) != v
    }
    if (
        "sort_order" in body.model_fields_set
        and body.sort_order is not None
        and body.sort_order != cycle.sort_order
    ):
        changes["sort_order"] = {"old": cycle.sort_order, "new": body.sort_order}
    if not changes:
        await db.flush()
        return cycle
    old_name = cycle.cycle
    for f, change in changes.items():
        setattr(cycle, f, change["new"])
    await db.flush()
    if "cycle" in changes:
        await _relink(db, user, product_ref(key), {old_name: (product_ref(key), cycle.cycle)})
    await audit_log.record(
        db,
        action="admin.eol_custom_cycle.updated",
        category="admin",
        actor=user,
        target=_target(product),
        context={"cycle": cycle.cycle},
        changes=changes,
    )
    return cycle


async def delete_cycle(
    db: AsyncSession, user: User, key: str, cycle_id: str, read_scope: CardReadScope | None
) -> None:
    """Delete a cycle nothing links to any more (409 ``cards_linked``).

    Same rule as a product: a linked cycle could not be deleted without
    stranding its cards on a cycle that no longer exists, which neither a
    switch to endoflife.date nor the product delete could then resolve.
    Renaming the cycle moves its cards instead. The 409 counts only the
    cards the caller can see, so it never reveals a hidden one.
    """
    product = await get_product(db, key)
    cycle = await _get_cycle(db, key, cycle_id)
    if await _all_link_count(db, key, cycle.cycle):
        counts = await linked_counts(db, read_scope)
        raise HTTPException(
            409,
            {
                "code": "cards_linked",
                "count": counts.get((key, cycle.cycle), 0),
                "message": "Cards are still linked to this cycle",
            },
        )
    await audit_log.record(
        db,
        action="admin.eol_custom_cycle.deleted",
        category="admin",
        actor=user,
        target=_target(product),
        context={"cycle": cycle.cycle},
    )
    await db.delete(cycle)
    await db.flush()


async def _relink(
    db: AsyncSession,
    user: User,
    product: str,
    mapping: Mapping[str, tuple[str, str]],
    read_scope: CardReadScope | None = None,
    source: str = "eol_custom_rename",
) -> int:
    """Point every card linked to ``product`` + a mapped cycle at its new
    ``(product, cycle)``. Returns how many cards moved.

    Merges onto each card's own attributes and publishes one ``card.updated``
    event per card (with ``db=``), as the mass-link route does, so the move
    shows in History. With ``read_scope`` only cards the caller may read move.
    """
    if not mapping:
        return 0
    stmt = (
        select(Card)
        .where(Card.attributes[EOL_PRODUCT_KEY].astext == product)
        .where(Card.attributes[EOL_CYCLE_KEY].astext.in_(list(mapping)))
    )
    if read_scope is not None:
        stmt = stmt.where(*read_scope.where(Card, mode="module"))
    moved = 0
    for card in (await db.execute(stmt)).scalars().all():
        old_attrs = dict(card.attributes or {})
        new_product, new_cycle = mapping[str(old_attrs.get(EOL_CYCLE_KEY))]
        attrs = {**old_attrs, EOL_PRODUCT_KEY: new_product, EOL_CYCLE_KEY: new_cycle}
        card.attributes = attrs
        await event_bus.publish(
            "card.updated",
            {
                "id": str(card.id),
                "source": source,
                "changes": {"attributes": {"old": old_attrs, "new": attrs}},
            },
            db=db,
            card_id=card.id,
            user_id=user.id,
        )
        moved += 1
    await db.flush()
    return moved


def plan_switch(
    custom_cycles: Iterable[str],
    upstream_cycles: Iterable[dict],
    cycle_map: Mapping[str, str | None],
) -> dict[str, str]:
    """Validate a switch's cycle mapping; return ``{custom: upstream}`` for
    the cycles that move. Raises 422 on a cycle either side does not have."""
    custom = set(custom_cycles)
    upstream = {str(c.get("cycle")) for c in upstream_cycles}
    unknown_custom = sorted(k for k in cycle_map if k not in custom)
    if unknown_custom:
        raise HTTPException(422, f"Unknown custom cycle(s): {', '.join(unknown_custom)}")
    moves = {k: v for k, v in cycle_map.items() if v is not None}
    unknown_upstream = sorted(v for v in moves.values() if v not in upstream)
    if unknown_upstream:
        raise HTTPException(
            422, f"The target product has no cycle(s): {', '.join(unknown_upstream)}"
        )
    return moves


async def switch_to_upstream(
    db: AsyncSession,
    user: User,
    key: str,
    target_product: str,
    upstream_cycles: list[dict],
    cycle_map: Mapping[str, str | None],
    delete_when_unused: bool,
    read_scope: CardReadScope,
) -> dict[str, Any]:
    """Relink a custom product's cards to an endoflife.date product.

    ``upstream_cycles`` is fetched by the caller *before* this runs, so no
    session is held across the outbound call. Only cards the caller can read
    move; a hidden card keeps its custom link, and then the product is kept
    too, whatever ``delete_when_unused`` says.
    """
    product = await get_product(db, key)
    cycles = await _product_cycles(db, key)
    moves = plan_switch((c.cycle for c in cycles), upstream_cycles, cycle_map)
    relinked = await _relink(
        db,
        user,
        product_ref(key),
        {k: (target_product, v) for k, v in moves.items()},
        read_scope=read_scope,
        source="eol_custom_switch",
    )
    counts = await linked_counts(db, read_scope)
    kept = sum(n for (k, _c), n in counts.items() if k == key)
    deleted = False
    if delete_when_unused and await _all_link_count(db, key) == 0:
        await db.execute(delete(EolCustomCycle).where(EolCustomCycle.product_key == key))
        await db.delete(product)
        await db.flush()
        deleted = True
    await audit_log.record(
        db,
        action="admin.eol_custom_product.switched",
        category="admin",
        actor=user,
        target=_target(product),
        context={
            "target_product": target_product,
            "relinked_cards": relinked,
            "deleted": deleted,
        },
    )
    return {"relinked": relinked, "kept": kept, "deleted": deleted}
