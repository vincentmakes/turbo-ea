"""The Data quality leaderboard widget: who keeps their cards complete.

``GET /dashboards/leaderboard`` ranks the people who hold a stakeholder role
on a card by the average data quality of those cards (``average_quality``) or
by how many cards they hold (``card_count``). Rules every result obeys:

- A card counts once per person, however many roles that person holds on it
  (``stakeholders`` has no unique constraint on ``(card_id, user_id)``).
- Only ACTIVE cards of a visible (not ``is_hidden``) card type count, and the
  caller's ``CardReadScope`` in **module** mode filters every card: a card the
  reader may not read neither adds to a person's count nor moves their
  average, so no figure reveals it.
- ``counting_roles_only`` keeps the roles whose definition fills the card's
  stakeholder slot (``counts_for_quality``, not archived) — a passive
  *observer* never earns a place; ``card_types`` / ``roles`` narrow by key.
- Someone appears from ``min_cards`` cards, so one perfect card does not top
  the board; deactivated accounts never appear.
- A person is ``{id, display_name}`` and nothing more — no email, no role.

The ranking itself is a plain function (``rank_rows``) so it carries a
mutation score; ``leaderboard`` only reads the database.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import Numeric, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.user import User
from app.schemas.dashboard import (
    LeaderboardParams,
    LeaderboardResponse,
    LeaderboardRow,
    LeaderboardUser,
)
from app.services.card_read_scope import CardReadScope


class LeaderboardError(ValueError):
    """A parameter the metamodel does not know; ``code`` becomes the 400."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def first_unknown(wanted: Iterable[str], known: Iterable[str]) -> str | None:
    """The first key of ``wanted`` that is not in ``known``, or ``None``."""
    allowed = set(known)
    return next((key for key in wanted if key not in allowed), None)


def rank_rows(rows: Sequence[Any], rank_by: str) -> list[LeaderboardRow]:
    """``rows`` (``user_id, display_name, cards, average``), already ordered,
    as ranked rows. Ties on the ranked figure share a rank and the next figure
    skips the shared places (1, 2, 2, 4), so equal work reads as equal."""
    ranked: list[LeaderboardRow] = []
    previous: Any = None
    rank = 0
    for position, (user_id, display_name, cards, average) in enumerate(rows, start=1):
        figure = average if rank_by == "average_quality" else cards
        if figure != previous:
            rank = position
            previous = figure
        ranked.append(
            LeaderboardRow(
                rank=rank,
                user=LeaderboardUser(id=str(user_id), display_name=display_name),
                cards=int(cards),
                average_quality=float(average),
            )
        )
    return ranked


async def _check_keys(db: AsyncSession, params: LeaderboardParams) -> None:
    """Every card type must be a visible type and every role the key of a live
    role definition — a typo would otherwise read as an empty board."""
    if params.card_types:
        visible = await db.execute(
            select(CardType.key).where(CardType.is_hidden == False)  # noqa: E712
        )
        if first_unknown(params.card_types, visible.scalars().all()) is not None:
            raise LeaderboardError("unknown_card_type")
    if params.roles:
        live = await db.execute(
            select(StakeholderRoleDefinition.key).where(
                StakeholderRoleDefinition.is_archived == False  # noqa: E712
            )
        )
        if first_unknown(params.roles, live.scalars().all()) is not None:
            raise LeaderboardError("unknown_role")


async def leaderboard(
    db: AsyncSession, scope: CardReadScope, params: LeaderboardParams
) -> LeaderboardResponse:
    """The ranked board for ``params``, through ``scope``. Raises
    ``LeaderboardError`` for an unknown card type or role key."""
    await _check_keys(db, params)
    hidden_types = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    # One row per (person, card) — DISTINCT folds several roles on one card.
    pairs = (
        select(
            Stakeholder.user_id.label("user_id"),
            Card.id.label("card_id"),
            Card.data_quality.label("quality"),
        )
        .join(Stakeholder, Stakeholder.card_id == Card.id)
        .where(
            Card.status == "ACTIVE",
            Card.type.not_in(hidden_types),
            *scope.where(Card, mode="module"),
        )
        .distinct()
    )
    if params.card_types:
        pairs = pairs.where(Card.type.in_(params.card_types))
    if params.roles:
        pairs = pairs.where(Stakeholder.role.in_(params.roles))
    if params.counting_roles_only:
        pairs = pairs.join(
            StakeholderRoleDefinition,
            and_(
                StakeholderRoleDefinition.card_type_key == Card.type,
                StakeholderRoleDefinition.key == Stakeholder.role,
                StakeholderRoleDefinition.is_archived == False,  # noqa: E712
                StakeholderRoleDefinition.counts_for_quality == True,  # noqa: E712
            ),
        )
    held = pairs.subquery()

    cards = func.count(held.c.card_id)
    average = func.round(cast(func.avg(held.c.quality), Numeric), 1)
    figure = average if params.rank_by == "average_quality" else cards
    board = (
        select(held.c.user_id, User.display_name, cards.label("cards"), average.label("average"))
        .join(User, User.id == held.c.user_id)
        .where(User.is_active == True)  # noqa: E712
        .group_by(held.c.user_id, User.display_name)
        .having(cards >= params.min_cards)
    )
    total = (await db.execute(select(func.count()).select_from(board.subquery()))).scalar_one()
    rows = (
        await db.execute(
            board.order_by(figure.desc(), func.lower(User.display_name), held.c.user_id).limit(
                params.top
            )
        )
    ).all()
    return LeaderboardResponse(
        rows=rank_rows(rows, params.rank_by),
        total_people=total,
        **params.model_dump(),
    )
