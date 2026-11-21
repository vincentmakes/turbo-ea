"""Centralized permission checking service. All route handlers should use this."""

from __future__ import annotations

import time
from collections.abc import Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import VIEW_COSTS_CARD_PERMISSION, type_cell_decision, view_denied
from app.models.card import Card
from app.models.card_type import CardType
from app.models.role import Role
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.user import User
from app.services.event_bus import request_impersonation


def effective_role_key(user: User) -> str:
    """Return the role key to use for app-level permission checks.

    When the request's JWT carries an ``impersonated_role`` claim the
    middleware in ``app.main`` stashes ``(impersonator_id, role)`` on the
    ``request_impersonation`` contextvar. We use the impersonated role for
    app-level lookups but only when the contextvar's impersonator id
    matches the current user — guards against the (impossible-in-practice)
    case where contextvars leak across requests. Stakeholder permissions
    are not affected; they're keyed by ``user.id`` and remain the
    impersonator's own.
    """
    impersonation = request_impersonation.get()
    if impersonation is not None:
        impersonator_id, impersonated_role = impersonation
        if impersonator_id == str(user.id):
            return impersonated_role
    return user.role


# Kept for the many call sites (and tests) that predate the public name.
_effective_role = effective_role_key


class PermissionService:
    """Centralized permission checking. All route handlers should use this."""

    # In-memory cache: key → (role_obj_dict, timestamp)
    _role_cache: dict[str, tuple[dict, float]] = {}
    CACHE_TTL = 300  # 5 minutes

    # Stakeholder role cache: (type_key, role_key) → (permissions_dict, timestamp)
    _srd_cache: dict[tuple[str, str], tuple[dict | None, float]] = {}

    # Per-card-type role overrides: type_key → (role_permissions_dict, timestamp)
    _type_perm_cache: dict[str, tuple[dict, float]] = {}

    # Every card type's overrides at once: (type_key → role_permissions, timestamp).
    # Read by the card read scope (which needs all of a role's cells per request)
    # and by ``type_permissions_for_role``. Cleared by any type invalidation.
    _all_type_perm_cache: tuple[dict[str, dict], float] | None = None

    @staticmethod
    async def load_role(db: AsyncSession, role_key: str) -> dict | None:
        """Load role permissions with caching."""
        now = time.time()
        cached = PermissionService._role_cache.get(role_key)
        if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
            return cached[0]

        result = await db.execute(select(Role).where(Role.key == role_key))
        role = result.scalar_one_or_none()
        if role:
            role_dict = {
                "label": role.label,
                "color": role.color,
                "permissions": dict(role.permissions or {}),
            }
            PermissionService._role_cache[role_key] = (role_dict, now)
            return role_dict
        return None

    @staticmethod
    async def load_type_role_permissions(db: AsyncSession, type_key: str) -> dict:
        """Load a card type's per-role permission overrides, with caching.

        Returns ``{}`` for an unknown type — an override map that does not
        exist simply means every role inherits its global grant. The empty
        result is cached too, so a hot path querying a since-deleted type
        does not hit the database on every request.
        """
        now = time.time()
        cached = PermissionService._type_perm_cache.get(type_key)
        if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
            return cached[0]

        result = await db.execute(select(CardType.role_permissions).where(CardType.key == type_key))
        raw = result.scalar_one_or_none()
        overrides: dict[str, dict] = dict(raw) if raw else {}
        PermissionService._type_perm_cache[type_key] = (overrides, now)
        return overrides

    @staticmethod
    async def load_all_type_role_permissions(db: AsyncSession) -> dict[str, dict]:
        """Every card type's per-role overrides, ``{type_key: {role_key: cells}}``.

        One query, cached like the per-type map. Types with no overrides are
        included with an empty dict so a caller can tell "no cells" from
        "unknown type".
        """
        now = time.time()
        cached = PermissionService._all_type_perm_cache
        if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
            return cached[0]
        rows = await db.execute(select(CardType.key, CardType.role_permissions))
        out = {key: dict(overrides or {}) for key, overrides in rows.all()}
        PermissionService._all_type_perm_cache = (out, now)
        return out

    @staticmethod
    async def has_app_permission(
        db: AsyncSession,
        user: User,
        permission: str,
        *,
        card_type_key: str | None = None,
        subtype: str | None = None,
    ) -> bool:
        """Check if user's app-level role grants the given permission.

        Uses ``_effective_role(user)`` so an active role-impersonation
        session is honoured — an admin impersonating "member" gets the
        member role's permission set here, not the admin wildcard.

        When ``card_type_key`` is given, the card type's per-role override cells
        are consulted through ``type_cell_decision``: an explicit View deny
        takes away *every* landscape-wide permission on that type (a role that
        may not see a type's cards holds no authority over them), a stored cell
        for one of the five type-scoped inventory permissions decides that
        permission either way, and an absent cell inherits. The admin wildcard
        short-circuits *before* the override lookup, so a wildcard role can
        never be locked out of a type.
        """
        role_key = effective_role_key(user)
        role_data = await PermissionService.load_role(db, role_key)
        if not role_data:
            return False
        perms = role_data["permissions"]
        if perms.get("*"):
            return True
        if card_type_key:
            overrides = await PermissionService.load_type_role_permissions(db, card_type_key)
            decision = type_cell_decision(overrides.get(role_key), permission, subtype)
            if decision is not None:
                return decision
        return bool(perms.get(permission))

    @staticmethod
    async def is_type_denied(
        db: AsyncSession,
        user: User,
        permission: str,
        type_key: str,
        *,
        subtype: str | None = None,
    ) -> bool:
        """True when the card type *explicitly* denies this role the permission.

        Distinct from ``not has_app_permission(...)``: this returns True only
        for a stored ``False`` cell, never for a role that simply lacks the
        global grant. Bulk edit uses it so that a type-level deny blocks the
        type while a type-level allow grants nothing extra — see
        ``bulk_update`` in ``api/v1/cards.py``. An explicit View deny counts as
        a deny of every permission on the type (``type_cell_decision``).
        """
        role_key = effective_role_key(user)
        role_data = await PermissionService.load_role(db, role_key)
        if not role_data:
            return False
        if role_data["permissions"].get("*"):
            return False
        overrides = await PermissionService.load_type_role_permissions(db, type_key)
        return type_cell_decision(overrides.get(role_key), permission, subtype) is False

    @staticmethod
    async def type_permissions_for_role(db: AsyncSession, role_key: str) -> dict[str, dict]:
        """Every card type's overrides for one role, for ``GET /auth/me``.

        Shape ``{type_key: {permission: bool}}``, carrying only the cells the
        admin actually set so the frontend can compute "may this role create
        this type?" without a round-trip per type. Empty for a wildcard role —
        admin is never overridden, so there is nothing to send.
        """
        role_data = await PermissionService.load_role(db, role_key)
        if not role_data or role_data["permissions"].get("*"):
            return {}
        all_overrides = await PermissionService.load_all_type_role_permissions(db)
        out: dict[str, dict] = {}
        for type_key, overrides in all_overrides.items():
            cells = (overrides or {}).get(role_key)
            if cells:
                # This summary has no subtype context (no specific card in
                # play), so a subtype-scoped cell can't be answered definitely
                # here — omit it, same as "not overridden" at this coarse
                # level. The real check at create/edit/archive/delete time
                # still applies the scoped rule correctly.
                unscoped = {k: v for k, v in cells.items() if not isinstance(v, dict)}
                if unscoped:
                    out[type_key] = unscoped
        return out

    @staticmethod
    async def _card_type_and_subtype(
        db: AsyncSession, card_id: UUID
    ) -> tuple[str | None, str | None]:
        """Resolve a card's type and subtype keys (used to apply per-type/subtype overrides)."""
        result = await db.execute(select(Card.type, Card.subtype).where(Card.id == card_id))
        row = result.one_or_none()
        return (row.type, row.subtype) if row else (None, None)

    @staticmethod
    async def _card_type_key(db: AsyncSession, card_id: UUID) -> str | None:
        """Resolve a card's type key alone, for a caller that needs no subtype."""
        type_key, _ = await PermissionService._card_type_and_subtype(db, card_id)
        return type_key

    @staticmethod
    async def has_card_permission(
        db: AsyncSession,
        user: User,
        card_id: UUID,
        permission: str,
        *,
        type_key: str | None = None,
    ) -> bool:
        """Check if user has permission on a specific card via stakeholder role.

        ``type_key`` lets a caller that has already resolved the card's type
        (``check_permission`` does, to apply per-type overrides) skip the
        lookup rather than querying the same row twice.
        """
        stakeholder_result = await db.execute(
            select(Stakeholder.role).where(
                Stakeholder.card_id == card_id,
                Stakeholder.user_id == user.id,
            )
        )
        if type_key is None:
            type_key, _ = await PermissionService._card_type_and_subtype(db, card_id)
        if not type_key:
            return False

        for (role_key,) in stakeholder_result.all():
            perms = await PermissionService.stakeholder_role_permissions(db, type_key, role_key)
            if perms and perms.get(permission):
                return True
        return False

    @staticmethod
    async def stakeholder_role_permissions(
        db: AsyncSession, type_key: str, role_key: str
    ) -> dict | None:
        """The card-level permission map of one stakeholder role on one type.

        ``None`` when the role is not defined for the type or is archived — an
        archived role grants nothing. Cached per ``(type, role)``; the card read
        scope reads through this too, so "which stakeholder roles grant
        ``card.view``" has exactly one answer.
        """
        now = time.time()
        cache_key = (type_key, role_key)
        cached = PermissionService._srd_cache.get(cache_key)
        if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
            return cached[0]
        srd = await db.execute(
            select(StakeholderRoleDefinition.permissions).where(
                StakeholderRoleDefinition.card_type_key == type_key,
                StakeholderRoleDefinition.key == role_key,
                StakeholderRoleDefinition.is_archived == False,  # noqa: E712
            )
        )
        perms = srd.scalar_one_or_none()
        PermissionService._srd_cache[cache_key] = (perms, now)
        return perms

    @staticmethod
    async def check_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        card_id: UUID | None = None,
        card_permission: str | None = None,
        *,
        card_type_key: str | None = None,
        subtype: str | None = None,
    ) -> bool:
        """Combined check: returns True if app-level OR card-level grants access.

        The app-level branch is per-card-type and per-subtype aware. When
        ``card_id`` is given and neither ``card_type_key`` nor ``subtype`` is
        supplied, both are resolved once here and reused for both branches, so
        an existing caller passing only ``card_id`` picks up type AND subtype
        overrides without any change at the call site. A caller that already
        knows the type (creation, where no card exists yet, or a batch that
        pre-resolved types itself) passes ``card_type_key``/``subtype``
        explicitly instead.

        Stakeholder grants are untouched by overrides: a type-level deny takes
        away the *landscape-wide* grant, never the authority someone holds as
        the owner of one specific card.
        """
        if card_id and card_type_key is None:
            card_type_key, subtype = await PermissionService._card_type_and_subtype(db, card_id)
        if await PermissionService.has_app_permission(
            db, user, app_permission, card_type_key=card_type_key, subtype=subtype
        ):
            return True
        if card_id and card_permission:
            return await PermissionService.has_card_permission(
                db, user, card_id, card_permission, type_key=card_type_key
            )
        return False

    @staticmethod
    async def require_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        card_id: UUID | None = None,
        card_permission: str | None = None,
        *,
        card_type_key: str | None = None,
        subtype: str | None = None,
    ) -> None:
        """Raise 403 if permission check fails."""
        if not await PermissionService.check_permission(
            db,
            user,
            app_permission,
            card_id,
            card_permission,
            card_type_key=card_type_key,
            subtype=subtype,
        ):
            raise HTTPException(403, "Insufficient permissions")

    @staticmethod
    async def view_denied_types(db: AsyncSession, user: User) -> frozenset[str]:
        """Card types whose View cell takes every landscape-wide grant away
        from this user's role (``view_denied``, the cell ``type_cell_decision``
        answers ``False`` on whatever the permission).

        Empty for the wildcard role and for a role with no such cell — the
        common case, answered from the role and type-cell caches.
        """
        role_key = effective_role_key(user)
        role_data = await PermissionService.load_role(db, role_key)
        if not role_data or role_data["permissions"].get("*"):
            return frozenset()
        overrides = await PermissionService.load_all_type_role_permissions(db)
        return frozenset(
            type_key for type_key, cells in overrides.items() if view_denied(cells.get(role_key))
        )

    @staticmethod
    async def sees_all_costs(db: AsyncSession, user: User) -> bool:
        """True when ``costs.view`` shows this user the costs of every card:
        the role holds it and no card type's View cell takes it away."""
        if not await PermissionService.has_app_permission(db, user, "costs.view"):
            return False
        return not await PermissionService.view_denied_types(db, user)

    @staticmethod
    async def is_stakeholder_of(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """Return whether the user holds any stakeholder role on this card."""
        result = await db.execute(
            select(Stakeholder.id)
            .where(Stakeholder.card_id == card_id, Stakeholder.user_id == user.id)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    @staticmethod
    async def _can_view_domain(db: AsyncSession, user: User, card_id: UUID, perm: str) -> bool:
        """View rule shared by costs and licenses: the app-level ``perm`` grants every
        card; otherwise any stakeholder role on the card grants that card."""
        if await PermissionService.has_app_permission(db, user, perm):
            return True
        return await PermissionService.is_stakeholder_of(db, user, card_id)

    @staticmethod
    async def _can_edit_domain(db: AsyncSession, user: User, card_id: UUID, perm: str) -> bool:
        """Edit rule shared by costs and licenses: the app-level ``perm``, or a stakeholder
        role on THIS card whose permissions give `card.edit` (Observer does not).
        App-level `inventory.edit` alone grants nothing here."""
        if await PermissionService.has_app_permission(db, user, perm):
            return True
        return await PermissionService.has_card_permission(db, user, card_id, "card.edit")

    @staticmethod
    async def _card_ids_with_domain_access(
        db: AsyncSession, user: User, candidate_card_ids: Iterable[UUID], perm: str
    ) -> set[UUID]:
        """Bulk variant of `_can_view_domain` for list endpoints: the subset of the candidate
        card IDs the user can see; all of them with the global ``perm``."""
        candidates = list({cid for cid in candidate_card_ids if cid is not None})
        if not candidates:
            return set()
        if await PermissionService.has_app_permission(db, user, perm):
            return set(candidates)
        result = await db.execute(
            select(Stakeholder.card_id).where(
                Stakeholder.user_id == user.id,
                Stakeholder.card_id.in_(candidates),
            )
        )
        return set(result.scalars().all())

    @staticmethod
    async def can_view_costs(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """Return True if the user may see and change cost fields on this card.

        ``costs.view`` shows them on every card whose type the role may view
        (a View deny on the type takes the grant away, as for every other
        landscape-wide permission). Without it, a stakeholder role on the card
        shows them only when the role grants ``card.view_costs`` — holding *a*
        role is not enough: anyone who can view a card may make themselves its
        Observer (``POST /cards/{id}/me/observe``), and that used to let every
        user past the permission (#1412).
        """
        return await PermissionService.check_permission(
            db, user, "costs.view", card_id, VIEW_COSTS_CARD_PERMISSION
        )

    @staticmethod
    async def card_ids_with_cost_access(
        db: AsyncSession, user: User, candidate_card_ids: Iterable[UUID | None]
    ) -> set[UUID]:
        """Bulk variant of `can_view_costs` for list endpoints.

        Returns the subset of candidate card IDs the user can see costs for:
        with ``costs.view``, every candidate whose type the role is not denied
        View on; for the rest, those on which the user holds a stakeholder
        role granting ``card.view_costs``. The role check reads through the
        same cached map as ``has_card_permission``, so an archived or
        undefined role grants nothing here either.

        A role with ``costs.view`` and no View deny gets its candidates back
        without a query — ids that name no card included, as before.
        """
        candidates = {cid for cid in candidate_card_ids if cid is not None}
        if not candidates:
            return set()
        allowed: set[UUID] = set()
        pending = candidates
        if await PermissionService.has_app_permission(db, user, "costs.view"):
            denied = await PermissionService.view_denied_types(db, user)
            if not denied:
                return candidates
            possible = await db.execute(
                select(Card.id, Card.type, Card.subtype).where(
                    Card.id.in_(candidates), Card.type.in_(denied)
                )
            )
            pending = set()
            for card_id, card_type, subtype in possible.all():
                if not await PermissionService.has_app_permission(
                    db, user, "costs.view", card_type_key=card_type, subtype=subtype
                ):
                    pending.add(card_id)
            allowed = candidates - pending
            if not pending:
                return allowed
        held = await db.execute(
            select(Stakeholder.card_id, Card.type, Stakeholder.role)
            .join(Card)
            .where(Stakeholder.user_id == user.id, Stakeholder.card_id.in_(pending))
        )
        for card_id, type_key, role_key in held.all():
            perms = await PermissionService.stakeholder_role_permissions(db, type_key, role_key)
            if perms and perms.get(VIEW_COSTS_CARD_PERMISSION):
                allowed.add(card_id)
        return allowed

    @staticmethod
    async def can_edit_costs(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """Edit cost items only where their values are visible."""
        return await PermissionService.can_view_costs(
            db, user, card_id
        ) and await PermissionService._can_edit_domain(db, user, card_id, "costs.edit")

    @staticmethod
    async def can_view_licenses(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """May the user see this card's licenses (`licenses.view` or a stakeholder)."""
        return await PermissionService._can_view_domain(db, user, card_id, "licenses.view")

    @staticmethod
    async def can_edit_licenses(db: AsyncSession, user: User, card_id: UUID) -> bool:
        """May the user edit this card's licenses (`licenses.edit` or a card.edit stakeholder)."""
        return await PermissionService._can_edit_domain(db, user, card_id, "licenses.edit")

    @staticmethod
    async def card_ids_with_license_access(
        db: AsyncSession, user: User, candidate_card_ids: Iterable[UUID]
    ) -> set[UUID]:
        """Bulk variant of `can_view_licenses` for list endpoints."""
        return await PermissionService._card_ids_with_domain_access(
            db, user, candidate_card_ids, "licenses.view"
        )

    @staticmethod
    async def get_effective_card_permissions(db: AsyncSession, user: User, card_id: UUID) -> dict:
        """Return the user's effective permissions on a specific card.

        Returns a dict with app_level, stakeholder_roles, card_level, and effective keys.
        """
        # Get user's app-level permissions (honours an active role-
        # impersonation session — see ``_effective_role`` doc).
        role_data = await PermissionService.load_role(db, _effective_role(user))
        app_perms = role_data["permissions"] if role_data else {}

        # Get card type and subtype
        type_key, subtype = await PermissionService._card_type_and_subtype(db, card_id)

        # Per-card-type overrides for this role. These shape the *app-level*
        # half of the effective permissions below; without this the buttons on
        # card detail would disagree with what the write routes actually allow.
        role_overrides: dict[str, bool] = {}
        if type_key:
            all_overrides = await PermissionService.load_type_role_permissions(db, type_key)
            role_overrides = all_overrides.get(_effective_role(user)) or {}

        # Get user stakeholder roles on this card
        stakeholder_result = await db.execute(
            select(Stakeholder.role).where(
                Stakeholder.card_id == card_id,
                Stakeholder.user_id == user.id,
            )
        )
        stakeholder_roles = [r for (r,) in stakeholder_result.all()]

        # Aggregate card-level permissions from all stakeholder roles
        card_level: dict[str, bool] = {}
        if type_key:
            for role_key in stakeholder_roles:
                perms = await PermissionService.stakeholder_role_permissions(db, type_key, role_key)
                if perms:
                    for k, v in perms.items():
                        if v:
                            card_level[k] = True

        # Compute effective permissions (union of app-level and card-level)
        is_admin = bool(app_perms.get("*"))

        def _app(key: str) -> bool:
            """The role's app-level grant for ``key``, after per-type/subtype overrides.

            Same rule as ``has_app_permission`` (``type_cell_decision``): an
            explicit View deny on this type takes every app-level grant away,
            a stored cell decides its own permission, anything else inherits.
            The card's own ``subtype`` is passed, so a subtype-scoped cell is
            applied here exactly as on the write paths — otherwise card detail
            would show buttons the write path then refuses.
            """
            decision = type_cell_decision(role_overrides, key, subtype)
            if decision is not None:
                return decision
            return bool(app_perms.get(key))

        effective = {
            "can_view": is_admin or _app("inventory.view") or card_level.get("card.view", False),
            "can_edit": is_admin or _app("inventory.edit") or card_level.get("card.edit", False),
            "can_archive": is_admin
            or _app("inventory.archive")
            or card_level.get("card.archive", False),
            "can_delete": is_admin
            or _app("inventory.delete")
            or card_level.get("card.delete", False),
            "can_approval_status": is_admin
            or _app("inventory.approval_status")
            or card_level.get("card.approval_status", False),
            "can_manage_stakeholders": is_admin
            or _app("stakeholders.manage")
            or card_level.get("card.manage_stakeholders", False),
            "can_manage_relations": is_admin
            or _app("relations.manage")
            or card_level.get("card.manage_relations", False),
            "can_manage_documents": is_admin
            or _app("documents.manage")
            or card_level.get("card.manage_documents", False),
            "can_manage_comments": is_admin
            or _app("comments.manage")
            or card_level.get("card.manage_comments", False),
            "can_create_comments": is_admin
            or _app("comments.create")
            or card_level.get("card.create_comments", False),
            "can_bpm_edit": is_admin or _app("bpm.edit") or card_level.get("card.bpm_edit", False),
            "can_bpm_manage_drafts": is_admin
            or _app("bpm.manage_drafts")
            or card_level.get("card.bpm_manage_drafts", False),
            "can_bpm_approve": is_admin
            or _app("bpm.approve_flows")
            or card_level.get("card.bpm_approve", False),
            "can_bpm_withdraw": is_admin
            or _app("bpm.withdraw_flows")
            or card_level.get("card.bpm_withdraw", False),
            "can_manage_adr_links": is_admin
            or _app("adr.manage")
            or card_level.get("card.manage_adr_links", False),
            "can_manage_diagram_links": is_admin
            or _app("diagrams.manage")
            or card_level.get("card.manage_diagram_links", False),
            # Only a role that grants the key, never merely holding a role:
            # see ``can_view_costs``.
            "can_view_costs": is_admin
            or _app("costs.view")
            or card_level.get(VIEW_COSTS_CARD_PERMISSION, False),
        }

        return {
            "app_level": {k: v for k, v in app_perms.items() if k != "*"}
            if not is_admin
            else {"*": True},
            "stakeholder_roles": stakeholder_roles,
            "card_level": card_level,
            "type_overrides": role_overrides,
            "effective": effective,
        }

    @staticmethod
    def invalidate_role_cache(role_key: str | None = None) -> None:
        """Invalidate role cache."""
        if role_key:
            PermissionService._role_cache.pop(role_key, None)
        else:
            PermissionService._role_cache.clear()

    @staticmethod
    def invalidate_type_permission_cache(type_key: str | None = None) -> None:
        """Invalidate the per-card-type role-override caches.

        The all-types map is always dropped, whatever ``type_key`` names: it
        holds every type's cells, so one type's edit makes all of it stale.
        """
        # Read only for truthiness, so any falsy value forces the reload.
        PermissionService._all_type_perm_cache = None  # pragma: no mutate, falsy is enough
        if type_key:
            PermissionService._type_perm_cache.pop(type_key, None)
        else:
            PermissionService._type_perm_cache.clear()

    @staticmethod
    def invalidate_srd_cache(type_key: str | None = None, role_key: str | None = None) -> None:
        """Invalidate stakeholder role definition cache."""
        if type_key and role_key:
            PermissionService._srd_cache.pop((type_key, role_key), None)
        elif type_key:
            keys_to_remove = [k for k in PermissionService._srd_cache if k[0] == type_key]
            for k in keys_to_remove:
                del PermissionService._srd_cache[k]
        else:
            PermissionService._srd_cache.clear()
