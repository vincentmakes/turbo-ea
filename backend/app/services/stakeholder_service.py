"""Stakeholder role assignment — helpers shared by the REST routes and the
SDK data bridge, so an extension assigning a role validates it against
exactly the definitions the app's own picker offers."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import DEFAULT_CARD_PERMISSIONS_BY_ROLE
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.data_quality import rescore_cards
from app.services.event_bus import event_bus

# The roles a card type gets when nobody names any: what a custom type is
# created with, and what the picker falls back to for a type without either.
DEFAULT_STAKEHOLDER_ROLES: tuple[dict, ...] = (
    {"key": "responsible", "label": "Responsible"},
    {"key": "observer", "label": "Observer"},
)

# Passive roles that never fill a card's data-quality stakeholders slot, as the
# seed defines the built-in ``observer``.
_NON_COUNTING_ROLES = frozenset({"observer"})


async def ensure_role_definitions(
    db: AsyncSession, type_key: str, roles: list[dict] | tuple[dict, ...]
) -> list[str]:
    """Give a card type a ``stakeholder_role_definitions`` row for each role.

    A role only grants permissions, and only stays in the picker once the type
    has any definition row, when it has a row of its own. A type created with
    its roles in the legacy ``card_types.stakeholder_roles`` list alone showed
    them through the picker's fallback and lost them all the moment an admin
    added a first role (#1437). Every path that creates a card type outside
    the seed calls this.

    Keys the type already has (archived included) are left alone; entries
    without a usable key are skipped. Flushes, never commits. Returns the keys
    it added.
    """
    existing = set(
        (
            await db.execute(
                select(StakeholderRoleDefinition.key).where(
                    StakeholderRoleDefinition.card_type_key == type_key
                )
            )
        ).scalars()
    )
    added: list[str] = []
    for idx, role in enumerate(roles):
        if not isinstance(role, dict):
            continue
        key = role.get("key")
        if not isinstance(key, str) or not key or len(key) > 50 or key in existing:
            continue
        label = role.get("label")
        label = label if isinstance(label, str) and label.strip() else key
        db.add(
            StakeholderRoleDefinition(
                card_type_key=type_key,
                key=key,
                label=label[:200],
                permissions=dict(DEFAULT_CARD_PERMISSIONS_BY_ROLE.get(key, {})),
                sort_order=idx,
                counts_for_quality=key not in _NON_COUNTING_ROLES,
                translations={},
            )
        )
        existing.add(key)
        added.append(key)
    if added:
        await db.flush()
    return added


def validate_role_order(current_keys: list[str], requested: list[str]) -> list[str]:
    """``requested`` when it lists every one of a type's role keys exactly once.

    A reorder may never drop or double a role (archived ones included), the
    rule the category order follows. Raises ``ValueError`` otherwise.
    """
    order = list(requested)
    if len(order) != len(set(order)):
        raise ValueError("The order lists a stakeholder role more than once")
    if set(order) != set(current_keys):
        raise ValueError("The order must list every stakeholder role of the type once")
    return order


async def roles_for_type(db: AsyncSession, type_key: str) -> list[dict]:
    """Active stakeholder roles of a card type, from
    ``stakeholder_role_definitions`` (falling back to the card type's legacy
    JSONB list, then to the two built-in defaults)."""
    result = await db.execute(
        select(StakeholderRoleDefinition)
        .where(
            StakeholderRoleDefinition.card_type_key == type_key,
            StakeholderRoleDefinition.is_archived == False,  # noqa: E712
        )
        .order_by(StakeholderRoleDefinition.sort_order)
    )
    srds = result.scalars().all()
    if srds:
        return [
            {
                "key": s.key,
                "label": s.label,
                "color": s.color,
                "description": s.description,
                "translations": s.translations or {},
                "counts_for_quality": s.counts_for_quality,
            }
            for s in srds
        ]
    legacy = await db.execute(select(CardType.stakeholder_roles).where(CardType.key == type_key))
    roles = legacy.scalar_one_or_none()
    fallback = list(roles) if roles else [dict(r) for r in DEFAULT_STAKEHOLDER_ROLES]
    # Rows with no definition carry no flag: treat them as the seed treats the
    # same keys, so a card still shows Observer apart from the owners.
    return [
        {**r, "counts_for_quality": r.get("key") not in _NON_COUNTING_ROLES}
        if isinstance(r, dict) and "counts_for_quality" not in r
        else r
        for r in fallback
    ]


def role_labels(roles: list[dict]) -> dict[str, str]:
    return {r["key"]: r["label"] for r in roles}


async def publish_stakeholder_event(
    db: AsyncSession,
    event_type: str,
    stakeholder: Stakeholder,
    *,
    role_label: str,
    user_display_name: str | None,
    actor_id: uuid.UUID | None,
    extra: dict | None = None,
) -> None:
    payload = {
        "stakeholder_id": str(stakeholder.id),
        "user_id": str(stakeholder.user_id),
        "user_display_name": user_display_name,
        "role": stakeholder.role,
        "role_label": role_label,
        "summary": f"{user_display_name or 'User'} · {role_label}",
    }
    if extra:
        payload.update(extra)
    await event_bus.publish(
        event_type,
        payload,
        db=db,
        card_id=stakeholder.card_id,
        user_id=actor_id,
    )


async def find_assignment(
    db: AsyncSession, card_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> Stakeholder | None:
    return (
        await db.execute(
            select(Stakeholder).where(
                Stakeholder.card_id == card_id,
                Stakeholder.user_id == user_id,
                Stakeholder.role == role,
            )
        )
    ).scalar_one_or_none()


async def rescore_after_stakeholder_change(db: AsyncSession, card_id: uuid.UUID) -> None:
    """Roles that count for quality move the score the moment they change."""
    await rescore_cards(db, [card_id])
