"""Which cards may this user read? One answer for every read surface.

A card type can deny (or allow) a role **View** through its per-role override
map (``card_types.role_permissions``, the Permissions tab in Admin → Metamodel).
A card of a type the role may not read does not exist for that user: it is left
out of every list, count, report, relation, graph and linked-card chip. The one
exception is a card on which the user holds a stakeholder role whose definition
grants ``card.view`` — a type deny removes the *landscape-wide* grant, never the
authority someone holds on one specific card (the same rule the four write
overrides follow).

Two modes, because two kinds of surface read cards:

``"inventory"``
    Surfaces that were gated on ``inventory.view`` (the inventory lists, card
    search, counts, the OData feed, card detail). A type is readable when its
    View cell allows it, or — with no cell — when the role holds the global
    ``inventory.view``. So a View *allow* lets a role without the global grant
    browse that one type.

``"module"``
    Everything else — surfaces gated by their own module permission
    (``reports.*``, ``bpm.view``, ``ppm.view``, ``risks.view``, ``adr.view``,
    ``diagrams.view``, ``turbolens.view``, ``inventory.export``…) and the few
    ungated ones (``GET /relations``). Only an explicit View *deny* subtracts;
    a role that lacks the global ``inventory.view`` keeps seeing what its
    module permission shows, exactly as before this scope existed.

For a role that holds the global ``inventory.view`` the two modes coincide.
When a role has no deny cell at all (every install until an admin sets one),
``clause`` returns ``None`` in module mode and the queries are unchanged.

Rules for callers:

- ``mode`` is a required keyword so every call site states which rule it
  follows: inventory mode only where the endpoint was gated on
  ``inventory.view``; module mode everywhere else.
- Filter relation edges on **both** ends, and give a paired ``count`` query
  the same clause as its item query.
- A write that replaces a whole set of links from client input
  (ADR/diagram card links, BPM organisation links) merges back the links the
  caller cannot see with ``keep_hidden`` — the client only ever saw the
  filtered set, so "what it sent" is not "what it wants removed".
- System and derived writes (calculations, data-quality rescoring, archive
  cascades, uniqueness checks) never go through a scope: they are not reads on
  anyone's behalf.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import ColumnElement, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.permissions import VIEW_PERMISSION
from app.models.card import Card
from app.models.event import Event
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.services.permission_service import PermissionService, effective_role_key

ReadMode = Literal["inventory", "module"]

_EMPTY: frozenset = frozenset()


@dataclass(frozen=True, slots=True)
class CardReadScope:
    """A user's card read rights, resolved once per request."""

    role_key: str
    wildcard: bool
    base_view: bool
    denied_types: frozenset[str]
    allowed_types: frozenset[str]
    # Cards the user may read through a stakeholder role granting `card.view`,
    # limited to those whose type is not already readable in inventory mode
    # (inventory-readable is a subset of module-readable, so this one set
    # serves both modes). Empty on the fast path.
    stakeholder_card_ids: frozenset[uuid.UUID]

    # ── Construction ──────────────────────────────────────────────────────

    @classmethod
    def everything(cls) -> CardReadScope:
        """A scope that reads every card — system callers, the admin wildcard."""
        return cls(
            role_key="*",
            wildcard=True,
            base_view=True,
            denied_types=_EMPTY,
            allowed_types=_EMPTY,
            stakeholder_card_ids=_EMPTY,
        )

    @classmethod
    async def load(cls, db: AsyncSession, user: User) -> CardReadScope:
        """Resolve the user's scope.

        Honours role impersonation (``effective_role_key``) for the role half;
        stakeholder rows stay keyed on ``user.id`` — the same split
        ``PermissionService.check_permission`` makes. Costs no SQL beyond the
        cached role and override maps unless the role actually has a View deny
        or lacks the global grant.
        """
        role_key = effective_role_key(user)
        role_data = await PermissionService.load_role(db, role_key)
        perms = (role_data or {}).get("permissions", {}) or {}
        if perms.get("*"):
            return cls.everything()
        base_view = bool(perms.get(VIEW_PERMISSION, False))

        denied: set[str] = set()
        allowed: set[str] = set()
        all_overrides = await PermissionService.load_all_type_role_permissions(db)
        for type_key, overrides in all_overrides.items():
            cell = ((overrides or {}).get(role_key) or {}).get(VIEW_PERMISSION)
            if cell is False:
                denied.add(type_key)
            elif cell is True:
                allowed.add(type_key)

        stakeholder_ids: frozenset[uuid.UUID] = _EMPTY
        if denied or not base_view:
            stakeholder_ids = await _stakeholder_readable_ids(
                db, user, base_view=base_view, denied=denied, allowed=allowed
            )
        return cls(
            role_key=role_key,
            wildcard=False,
            base_view=base_view,
            denied_types=frozenset(denied),
            allowed_types=frozenset(allowed),
            stakeholder_card_ids=stakeholder_ids,
        )

    # ── Questions ─────────────────────────────────────────────────────────

    def is_unrestricted(self, *, mode: ReadMode) -> bool:
        """True when this scope reads every card in ``mode`` — no filter needed."""
        if self.wildcard:
            return True
        if self.denied_types:
            return False
        return mode == "module" or self.base_view

    @property
    def can_browse_inventory(self) -> bool:
        """May the user open the inventory at all (the old global ``inventory.view``)?"""
        return self.wildcard or self.base_view or bool(self.allowed_types)

    def type_readable(self, type_key: str | None, *, mode: ReadMode) -> bool:
        """May the user read cards of this type landscape-wide (no stakeholder role)?"""
        if self.wildcard:
            return True
        if type_key in self.denied_types:
            return False
        if type_key in self.allowed_types:
            return True
        return mode == "module" or self.base_view

    def readable(
        self, card_id: uuid.UUID | str | None, type_key: str | None, *, mode: ReadMode
    ) -> bool:
        """Python twin of ``clause`` for rows that are already loaded."""
        if self.type_readable(type_key, mode=mode):
            return True
        if card_id is None or not self.stakeholder_card_ids:
            return False
        if isinstance(card_id, str):
            try:
                card_id = uuid.UUID(card_id)
            except ValueError:
                return False
        return card_id in self.stakeholder_card_ids

    def clause(self, card, *, mode: ReadMode) -> ColumnElement[bool] | None:
        """SQL predicate over ``card`` (``Card`` or an ``aliased(Card)``).

        ``None`` when the scope is unrestricted in ``mode`` — callers then add
        nothing, so an install without View overrides runs the same SQL as
        before. ``type NOT IN denied`` also admits types created after the
        scope was loaded, matching ``type_readable``.
        """
        if self.is_unrestricted(mode=mode):
            return None
        if mode == "module" or self.base_view:
            type_ok: ColumnElement[bool] = card.type.not_in(self.denied_types)
        elif self.allowed_types:
            type_ok = card.type.in_(self.allowed_types)
        else:
            type_ok = false()
        if self.stakeholder_card_ids:
            return or_(type_ok, card.id.in_(self.stakeholder_card_ids))
        return type_ok

    def ref_clause(self, type_expr, id_expr, *, mode: ReadMode) -> ColumnElement[bool] | None:
        """Predicate over a *reference* to a card stored as text, e.g. JSONB.

        For rows that name a card without a foreign key — an event's
        ``data->>'peer_type'`` / ``data->>'peer_id'``. A row whose type is
        NULL (it references no card) is kept: the NULL branch is written out
        explicitly, because ``NULL NOT IN (...)`` is NULL, not TRUE, and would
        silently drop every row that carries no reference at all.
        """
        if self.is_unrestricted(mode=mode):
            return None
        if mode == "module" or self.base_view:
            type_ok: ColumnElement[bool] = type_expr.not_in(self.denied_types)
        elif self.allowed_types:
            type_ok = type_expr.in_(self.allowed_types)
        else:
            type_ok = false()
        branches = [type_expr.is_(None), type_ok]
        if self.stakeholder_card_ids:
            branches.append(id_expr.in_([str(i) for i in self.stakeholder_card_ids]))
        return or_(*branches)

    def where(self, card, *, mode: ReadMode) -> tuple[ColumnElement[bool], ...]:
        """``q.where(*read_scope.where(Card, mode=...))`` — empty when unrestricted."""
        c = self.clause(card, mode=mode)
        return () if c is None else (c,)

    async def readable_card_ids(
        self, db: AsyncSession, ids: Iterable[uuid.UUID], *, mode: ReadMode
    ) -> set[uuid.UUID]:
        """The subset of ``ids`` this scope may read (unknown ids are dropped)."""
        id_set = {i for i in ids if i is not None}
        if not id_set:
            return set()
        if self.is_unrestricted(mode=mode):
            return id_set
        rows = await db.execute(select(Card.id, Card.type).where(Card.id.in_(id_set)))
        return {cid for cid, ctype in rows.all() if self.readable(cid, ctype, mode=mode)}

    async def hidden_card_ids(
        self, db: AsyncSession, ids: Iterable[uuid.UUID], *, mode: ReadMode
    ) -> set[uuid.UUID]:
        """The subset of ``ids`` that *exist* but this scope may not read.

        The complement of ``readable_card_ids`` among existing cards — an id of
        a deleted card is neither, which is what a "keep the link the caller
        was never shown" rule needs: a dangling link may still be cleared.
        """
        id_set = {i for i in ids if i is not None}
        if not id_set or self.is_unrestricted(mode=mode):
            return set()
        rows = await db.execute(select(Card.id, Card.type).where(Card.id.in_(id_set)))
        return {cid for cid, ctype in rows.all() if not self.readable(cid, ctype, mode=mode)}

    def keep_hidden(
        self,
        existing: Mapping[uuid.UUID, str],
        desired: Iterable[uuid.UUID],
        *,
        mode: ReadMode,
    ) -> set[uuid.UUID]:
        """Merge the links the caller cannot see back into a replace-set write.

        ``existing`` maps the currently linked card ids to their type. The
        client only ever saw the readable subset, so an id it did not send may
        be one it was never shown — keep those rather than unlinking them.
        """
        out = set(desired)
        for cid, ctype in existing.items():
            if not self.readable(cid, ctype, mode=mode):
                out.add(cid)
        return out


async def _stakeholder_readable_ids(
    db: AsyncSession,
    user: User,
    *,
    base_view: bool,
    denied: set[str],
    allowed: set[str],
) -> frozenset[uuid.UUID]:
    """Cards readable through a ``card.view`` stakeholder role.

    Only cards whose type is *not* already readable in inventory mode are
    returned — the rest need no carve-out. The role check reads through the
    same cached map as ``PermissionService.has_card_permission`` so archived
    roles and truthiness behave identically.
    """
    q = (
        select(Stakeholder.card_id, Card.type, Stakeholder.role)
        .join(Card, Card.id == Stakeholder.card_id)
        .where(Stakeholder.user_id == user.id)
    )
    if base_view:
        q = q.where(Card.type.in_(denied))
    elif allowed:
        q = q.where(Card.type.not_in(allowed))
    out: set[uuid.UUID] = set()
    for card_id, type_key, role in (await db.execute(q)).all():
        if card_id in out:
            continue
        perms = await PermissionService.stakeholder_role_permissions(db, type_key, role)
        if perms and perms.get("card.view"):
            out.add(card_id)
    return frozenset(out)


def event_read_filters(read_scope: CardReadScope) -> tuple[ColumnElement[bool], ...]:
    """Filters that keep an activity feed to events about readable cards.

    An event is dropped when its card is hidden from the reader, when the card
    it names in its payload (``data->>'type'`` / ``data->>'id'``, set on the
    events of since-deleted cards) is of a hidden type, or when it is a
    relation event whose peer (``peer_type`` / ``peer_id``) is hidden.
    Card-less events are kept. Empty when unrestricted (module mode).
    """
    if read_scope.is_unrestricted(mode="module"):
        return ()
    event_card = aliased(Card)
    card_ok = read_scope.clause(event_card, mode="module")
    filters: list[ColumnElement[bool]] = [
        or_(Event.card_id.is_(None), Event.card_id.in_(select(event_card.id).where(card_ok)))
    ]
    for type_key, id_key in (("type", "id"), ("peer_type", "peer_id")):
        clause = read_scope.ref_clause(
            Event.data[type_key].astext, Event.data[id_key].astext, mode="module"
        )
        if clause is not None:
            filters.append(clause)
    return tuple(filters)


def _id_keys(data: dict) -> list[str]:
    """Payload keys that carry card ids: ``*_card_id`` / ``*_card_ids`` and
    the archive-batch ``affected_*_ids`` lists."""
    return [
        k
        for k in data
        if k.endswith(("card_id", "card_ids")) or (k.startswith("affected_") and k.endswith("_ids"))
    ]


async def scrub_event_payloads(
    db: AsyncSession, read_scope: CardReadScope, payloads: Iterable[dict | None]
) -> list[dict | None]:
    """Copies of event ``data`` payloads with hidden card ids removed.

    An event about a readable card (or about no card) can still *name* other
    cards in its payload — an ADR's ``linked_card_ids``, an archive batch's
    ``affected_related_card_ids``. Ids of cards hidden from the reader are
    dropped from those lists (a single ``*card_id`` value becomes ``None``);
    everything else is returned as stored.
    """
    payloads = list(payloads)
    if read_scope.is_unrestricted(mode="module"):
        return payloads
    candidates: set[uuid.UUID] = set()
    for data in payloads:
        if not isinstance(data, dict):
            continue
        for key in _id_keys(data):
            values = data[key] if isinstance(data[key], list) else [data[key]]
            for v in values:
                try:
                    candidates.add(uuid.UUID(str(v)))
                except (ValueError, TypeError):
                    continue
    hidden = {str(i) for i in await read_scope.hidden_card_ids(db, candidates, mode="module")}
    if not hidden:
        return payloads
    out: list[dict | None] = []
    for data in payloads:
        if not isinstance(data, dict):
            out.append(data)
            continue
        clean = dict(data)
        for key in _id_keys(data):
            value = data[key]
            if isinstance(value, list):
                clean[key] = [v for v in value if str(v) not in hidden]
            elif str(value) in hidden:
                clean[key] = None
        out.append(clean)
    return out


# ── Route helpers ─────────────────────────────────────────────────────────


async def require_inventory_browse(db: AsyncSession, user: User) -> CardReadScope:
    """403 unless the user may browse the inventory; returns the scope.

    Replaces the old global ``inventory.view`` gate on list endpoints: a role
    without that grant but with a View *allow* on some type may now list those
    cards (and only those).
    """
    read_scope = await CardReadScope.load(db, user)
    if not read_scope.can_browse_inventory:
        raise HTTPException(403, "Insufficient permissions")
    return read_scope


async def is_card_readable(
    db: AsyncSession,
    user: User,
    card_id: uuid.UUID,
    *,
    mode: ReadMode,
    type_key: str | None = None,
) -> bool:
    """Single-card twin of the bulk scope, answered without loading it.

    Inventory mode is exactly the long-standing card read check
    (``inventory.view`` OR stakeholder ``card.view``), per-type aware. Module
    mode is "not explicitly View-denied OR stakeholder ``card.view``". An
    unknown card is not readable.
    """
    if type_key is None:
        type_key = await PermissionService._card_type_key(db, card_id)
    if type_key is None:
        return False
    if mode == "inventory":
        return await PermissionService.check_permission(
            db, user, VIEW_PERMISSION, card_id, "card.view", card_type_key=type_key
        )
    if not await PermissionService.is_type_denied(db, user, VIEW_PERMISSION, type_key):
        return True
    return await PermissionService.has_card_permission(
        db, user, card_id, "card.view", type_key=type_key
    )


async def require_card_readable(
    db: AsyncSession,
    user: User,
    card_id: uuid.UUID,
    *,
    mode: ReadMode,
    type_key: str | None = None,
) -> str:
    """404 unless the card exists and is readable; returns its type key.

    404 rather than 403 on purpose: a card hidden by a type deny does not exist
    for the user, and "forbidden" would confirm that it does.
    """
    if type_key is None:
        type_key = await PermissionService._card_type_key(db, card_id)
    if type_key is None or not await is_card_readable(
        db, user, card_id, mode=mode, type_key=type_key
    ):
        raise HTTPException(404, "Card not found")
    return type_key
