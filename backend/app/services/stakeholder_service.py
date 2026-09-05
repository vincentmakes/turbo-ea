"""Stakeholder role assignment — helpers shared by the REST routes and the
SDK data bridge, so an extension assigning a role validates it against
exactly the definitions the app's own picker offers."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.data_quality import rescore_cards
from app.services.event_bus import event_bus


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
                "translations": s.translations or {},
            }
            for s in srds
        ]
    result = await db.execute(select(CardType.stakeholder_roles).where(CardType.key == type_key))
    roles = result.scalar_one_or_none()
    if roles:
        return roles
    return [
        {"key": "responsible", "label": "Responsible"},
        {"key": "observer", "label": "Observer"},
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
