"""Survey targeting and activation — the one writer behind ``POST
/surveys/{id}/send`` and the extension surveys bridge.

B0-style extraction (the shape ``adr_service`` / ``risk_service`` set): every
function here flushes and never commits, so the caller — a request handler
or a bridge's audited batch — decides the transaction. What lives here:

* :func:`resolve_targets` — the survey's filters turned into the people to
  ask, one entry per (card, user).
* :func:`activate_survey` — the response rows, the recipient payloads the
  notifier delivers, the status flip, and one ``survey.sent`` event per
  matched card so a card's History tab shows it was surveyed and an audit
  batch can reverse the send (rollback closes the survey).
* :func:`expand_fields` — ``[{key, action}]`` → the stored ``Survey.fields``
  shape, resolved from the card type's ``fields_schema`` so a programmatic
  caller never hand-writes labels the builder would have looked up.

Delivery is deliberately NOT here: the notifications open an SMTP connection
each, so the caller hands ``ActivationResult.recipients`` to
``notification_service.deliver_notification_batch`` after its commit, with no
session open.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.tag import CardTag
from app.services.card_flags import not_updated_condition
from app.services.event_bus import event_bus

FIELD_ACTIONS = ("maintain", "confirm")


@dataclass
class ActivationResult:
    """What activating a survey produced, for the caller to report and deliver."""

    created: int
    #: One payload per recipient, in the shape ``deliver_notification_batch``
    #: takes — deliver AFTER the commit, with no session open.
    recipients: list[dict] = field(default_factory=list)
    card_ids: list[uuid.UUID] = field(default_factory=list)
    user_ids: list[uuid.UUID] = field(default_factory=list)


def notification_message(survey: Survey, card_count: int) -> str:
    """Body for the one notification a recipient gets for a survey.

    The author's own message leads, since that is what they wrote to explain
    the ask; the card count follows, because one notification now stands for
    however many cards that person was asked about.
    """
    noun = "card" if card_count == 1 else "cards"
    ask = f"You have been asked to review {card_count} {noun}."
    return f"{survey.message}\n\n{ask}" if survey.message else ask


async def resolve_targets(db: AsyncSession, survey: Survey) -> tuple[list[dict], list[Card]]:
    """Resolve survey filters into ``(targets, matched_cards)``.

    A survey can only reach a card through someone who holds one of its target
    roles on it, so a card that matches every filter but has no such stakeholder
    yields no target. Both halves are returned because the *difference* is what
    the builder needs to show: "5 cards" with no further explanation reads as a
    filter that is too narrow, when the real answer is usually that the other
    207 have nobody to ask.
    """
    filters = survey.target_filters or {}
    roles = survey.target_roles or []

    # Start with all active cards of the target type
    q = select(Card).where(
        Card.type == survey.target_type_key,
        Card.status == "ACTIVE",
    )

    # Specific cards filter — direct selection of target cards (intersected with type)
    card_ids = filters.get("card_ids") or []
    if card_ids:
        card_uuids = [uuid.UUID(c) for c in card_ids]
        q = q.where(Card.id.in_(card_uuids))

    # Tag filter
    tag_ids = filters.get("tag_ids") or []
    if tag_ids:
        tag_uuids = [uuid.UUID(t) for t in tag_ids]
        tagged_fs = select(CardTag.card_id).where(CardTag.tag_id.in_(tag_uuids))
        q = q.where(Card.id.in_(tagged_fs))

    # Related card filter — cards that have a Relation to/from one of these IDs.
    # ``relation_type_key`` narrows it to ONE relationship: several relation types
    # may connect the same pair of card types, so "owned by Acme" is a different
    # target set from "used by Acme". Absent = any relation, which is what every
    # survey written before the field existed means.
    related_ids = filters.get("related_ids") or []
    if related_ids:
        related_uuids = [uuid.UUID(r) for r in related_ids]
        rel_type_key = filters.get("relation_type_key")
        outgoing = select(Relation.source_id).where(Relation.target_id.in_(related_uuids))
        incoming = select(Relation.target_id).where(Relation.source_id.in_(related_uuids))
        if rel_type_key:
            outgoing = outgoing.where(Relation.type == rel_type_key)
            incoming = incoming.where(Relation.type == rel_type_key)
        # Find cards related to any of these IDs (as source or target)
        related_fs = outgoing.union(incoming)
        q = q.where(Card.id.in_(related_fs))

    # Attribute filters
    attr_filters = filters.get("attribute_filters") or []
    for af in attr_filters:
        key = af.get("key")
        op = af.get("op", "eq")
        value = af.get("value")

        if not key:
            continue

        col = Card.attributes[key].astext

        if op == "is_empty":
            # NULL or missing key in JSONB, or empty string
            q = q.where(
                (Card.attributes[key] == None)  # noqa: E711
                | (col == "")
            )
        elif op == "is_not_empty":
            q = q.where(
                Card.attributes[key] != None,  # noqa: E711
                col != "",
            )
        elif value is not None:
            str_val = str(value)
            if op == "eq":
                q = q.where(col == str_val)
            elif op == "ne":
                q = q.where(col != str_val)
            elif op in ("gt", "lt", "gte", "lte"):
                # Cast to numeric for comparisons
                num_col = Card.attributes[key].astext.cast(sqlalchemy.Numeric)
                try:
                    num_val = float(value)
                except (ValueError, TypeError):
                    continue
                if op == "gt":
                    q = q.where(num_col > num_val)
                elif op == "lt":
                    q = q.where(num_col < num_val)
                elif op == "gte":
                    q = q.where(num_col >= num_val)
                elif op == "lte":
                    q = q.where(num_col <= num_val)
            elif op == "contains":
                q = q.where(col.ilike(f"%{str_val}%"))

    # Staleness window — "only cards nobody has changed in the last N
    # days/months". Relative, resolved at send time rather than stored as a
    # date, so re-sending a survey next quarter re-reads the landscape as it
    # is then. A malformed window resolves to None and is skipped.
    not_updated = not_updated_condition(filters)
    if not_updated is not None:
        q = q.where(not_updated)

    result = await db.execute(q)
    cards = list(result.scalars().all())

    if not cards:
        return [], []

    # Find subscribers for these cards with matching roles
    card_ids = [card.id for card in cards]
    sub_q = (
        select(Stakeholder)
        .where(Stakeholder.card_id.in_(card_ids))
        .options(selectinload(Stakeholder.user))
    )
    if roles:
        sub_q = sub_q.where(Stakeholder.role.in_(roles))

    sub_result = await db.execute(sub_q)
    subs = sub_result.scalars().all()

    # Group subscribers by card, one entry per user carrying every role they
    # hold on that card. One entry per user is load-bearing, not cosmetic:
    # SurveyResponse has no role column and is unique on
    # (survey_id, card_id, user_id), so a second row for the same person would
    # violate uq_survey_response the moment the survey is sent.
    card_map = {card.id: card for card in cards}
    targets: dict[uuid.UUID, dict] = {}
    by_user: dict[tuple[uuid.UUID, str], dict] = {}
    for sub in subs:
        # Skip before creating the card's entry, or a card whose only
        # stakeholder row has no user would surface with an empty user list.
        if not sub.user:
            continue
        if sub.card_id not in targets:
            card = card_map[sub.card_id]
            targets[sub.card_id] = {
                "card_id": str(card.id),
                "card_name": card.name,
                "card_type": card.type,
                "users": [],
            }
        entry = by_user.get((sub.card_id, str(sub.user_id)))
        if entry is None:
            entry = {
                "user_id": str(sub.user_id),
                "display_name": sub.user.display_name,
                "email": sub.user.email,
                "roles": [],
            }
            by_user[(sub.card_id, str(sub.user_id))] = entry
            targets[sub.card_id]["users"].append(entry)
        if sub.role not in entry["roles"]:
            entry["roles"].append(sub.role)

    # The subscriber query has no ORDER BY, so sort rather than let the
    # database decide which of a user's roles the preview shows first.
    for target in targets.values():
        for entry in target["users"]:
            entry["roles"].sort()

    return list(targets.values()), cards


async def activate_survey(
    db: AsyncSession,
    survey: Survey,
    targets: list[dict],
    *,
    actor_id: uuid.UUID | None,
    event_extra: dict | None = None,
) -> ActivationResult:
    """Make a survey real: one ``SurveyResponse`` per (card, user), one
    notification payload per user, ``status="active"``. Flushes, never
    commits.

    One response row per (card, user) — that is the unit of work, and what
    My Surveys, the Todos tab and ``targets_created`` count. One
    *notification* per user, though: someone who owns forty applications
    needs one nudge saying so, not forty bell entries and forty emails.

    ``survey.sent`` is published once per matched card (with ``db=`` so it is
    persisted): the card's History tab shows it was surveyed, and a rollback
    of the batch that sent it closes the survey — the planner dedupes the
    per-card events on ``survey_id``. ``event_extra`` lets a bridge stamp its
    ``ext`` key so its own event handler filters the send out.
    """
    created = 0
    cards_by_user: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {}
    card_ids: list[uuid.UUID] = []
    for target in targets:
        card_id = uuid.UUID(target["card_id"])
        card_name = target["card_name"]
        card_ids.append(card_id)
        for u in target["users"]:
            u_id = uuid.UUID(u["user_id"])
            resp = SurveyResponse(
                survey_id=survey.id,
                card_id=card_id,
                user_id=u_id,
            )
            db.add(resp)
            created += 1
            cards_by_user.setdefault(u_id, []).append((card_id, card_name))

    recipients: list[dict] = [
        {
            "user_id": u_id,
            "title": f"Survey: {survey.name}",
            "message": notification_message(survey, len(cards)),
            # A person with a single card goes straight to it; anyone with
            # several lands on My Surveys, which lists them all.
            "link": (
                f"/surveys/{survey.id}/respond/{cards[0][0]}"
                if len(cards) == 1
                else "/todos?tab=surveys"
            ),
            "data": {"survey_id": str(survey.id), "card_count": len(cards)},
            # Emailed only: the mail names every card and links each one
            # straight to its response form, so a recipient can start from
            # their inbox. The bell entry stays a one-liner.
            "email_items": [
                {"label": name, "link": f"/surveys/{survey.id}/respond/{cid}"}
                for cid, name in cards
            ],
            "email_items_title": "Cards to review",
        }
        for u_id, cards in cards_by_user.items()
    ]

    survey.status = "active"
    survey.sent_at = datetime.now(timezone.utc)
    await db.flush()

    payload = {
        "survey_id": str(survey.id),
        "name": survey.name,
        "card_count": len(card_ids),
        "user_count": len(cards_by_user),
        **(event_extra or {}),
    }
    for card_id in card_ids:
        await event_bus.publish(
            "survey.sent", dict(payload), db=db, card_id=card_id, user_id=actor_id
        )

    return ActivationResult(
        created=created,
        recipients=recipients,
        card_ids=card_ids,
        user_ids=list(cards_by_user),
    )


async def expand_fields(
    db: AsyncSession, target_type_key: str, requested: list[dict]
) -> list[dict]:
    """``[{key, action}]`` → the stored ``Survey.fields`` rows
    (``{key, section, label, type, options?, action}``), looked up in the
    card type's ``fields_schema`` — the same rows the survey builder writes
    when a person ticks the field. Raises ``ValueError`` on an unknown
    type, an unknown or duplicate key, or an action outside
    :data:`FIELD_ACTIONS`."""
    ct = (
        await db.execute(select(CardType).where(CardType.key == target_type_key))
    ).scalar_one_or_none()
    if ct is None:
        raise ValueError(f"Unknown card type {target_type_key!r}")
    by_key: dict[str, dict] = {}
    for section in ct.fields_schema or []:
        for f in section.get("fields") or []:
            key = f.get("key")
            if key and key not in by_key:
                row = {
                    "key": key,
                    "section": section.get("section") or "",
                    "label": f.get("label") or key,
                    "type": f.get("type") or "text",
                }
                if f.get("options"):
                    row["options"] = list(f["options"])
                by_key[key] = row
    out: list[dict] = []
    seen: set[str] = set()
    for item in requested:
        if not isinstance(item, dict) or not item.get("key"):
            raise ValueError("Each survey field needs a key")
        key = str(item["key"])
        action = item.get("action") or "maintain"
        if action not in FIELD_ACTIONS:
            raise ValueError(f"Field {key!r}: action must be one of {', '.join(FIELD_ACTIONS)}")
        if key in seen:
            raise ValueError(f"Field {key!r} is listed twice")
        base = by_key.get(key)
        if base is None:
            raise ValueError(f"Field {key!r} does not exist on {target_type_key}")
        seen.add(key)
        out.append({**base, "action": action})
    return out
