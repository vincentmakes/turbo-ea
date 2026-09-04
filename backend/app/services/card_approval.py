"""The approval-break rule, and the record it owes.

An APPROVED card drops to BROKEN the moment one of its substantive fields
changes — that is the whole point of the state. Until 2.122 that flip lived in
four hand-rolled copies of the same rule and was, on every one of them,
completely silent:

* no ``approval_status`` key in the ``card.updated`` payload, so the card's
  **History** tab showed "description changed" and never the state change it
  caused — and ``rollback_service`` (which rebuilds its inverse ops straight
  from ``event.data.changes``) could not restore an approval it had never been
  told was lost;
* no notification, so the stakeholders who now owe a re-review found out by
  stumbling on the card in the Inventory.

Only the explicit ``POST /cards/{id}/approval-status`` action ever emitted
``approval_status_changed``. This module is the one home for both halves:

* :data:`STATUS_BREAKING_FIELDS` / :func:`break_approval` — the rule itself,
  imported by every write path rather than re-typed;
* :func:`approval_change_entry` — the ``changes`` fragment every emitter merges
  into its ``card.updated`` payload;
* :func:`build_approval_broken_recipients` + :func:`deliver_approval_broken` —
  the fan-out, **always** deduped one-per-person and aggregated when several of
  a person's cards broke at once;
* :func:`record_child_strategy_effects` — the archive/delete cascade, where
  children reparented out of the way were broken with no event *and* no
  notification at all.

Two design points worth keeping:

**It reuses the existing ``approval_status_changed`` type.** That type is
already registered (``models/user.py``), already has a bell icon, and already
has a switch in the preferences dialog in all ten locales — so an account that
has been asking for approval notifications all along starts receiving these
without touching a setting, and ``docs/guide/notifications.md``, which has
always advertised "approved, rejected, **broken**", becomes true.

**It never imports the card write layer.** ``card_write_service`` and
``card_lifecycle`` both import *this*; it sits below them, a sibling of
``notification_service``.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Any

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.stakeholder import Stakeholder
from app.services import notification_service
from app.services.event_bus import event_bus

if TYPE_CHECKING:  # pragma: no cover - typing only, would be an import cycle
    from app.services.card_lifecycle import ChildStrategyResult

#: The card columns whose change invalidates an approval.
#:
#: Lived in three copies (``card_write_service.update_card``,
#: ``cards.bulk_update``, and a declared-but-unused constant in
#: ``card_lifecycle``), which is exactly how ``turbolens.submit_ai_verdict``
#: came to carry a fourth, implicit one.
STATUS_BREAKING_FIELDS: frozenset[str] = frozenset(
    {"name", "description", "lifecycle", "attributes", "subtype", "alias", "parent_id"}
)

#: Where an aggregated notification sends the reader: the Inventory, filtered to
#: their own broken cards. Both parameters are already honoured by
#: ``InventoryPage`` — this is the same deep link the Dashboard uses.
APPROVAL_BROKEN_LINK = "/inventory?approval_status=BROKEN&mine=stakeholder"

#: The notification type carried. Deliberately the existing one — see module doc.
NOTIF_TYPE = "approval_status_changed"

#: How many cards an aggregated notification names. A mass edit can break
#: hundreds; the count stays exact in ``data["card_count"]`` while the listed
#: ids and the email's link list stay a readable length.
_MAX_LISTED_CARDS = 50


def approval_change_entry() -> dict[str, str]:
    """The ``changes`` value recording an APPROVED → BROKEN flip.

    Emitters merge ``{"approval_status": approval_change_entry()}`` into their
    ``card.updated`` payload. ``HistoryTab.parseChanges`` renders
    ``{field: {"old": …, "new": …}}`` and already carries a label for
    ``approval_status``, so this is all the History tab needs — and
    ``rollback_service`` reads the same shape to restore the old value.

    A function rather than a module constant because callers merge it into
    their own dicts; a shared literal would leak between event payloads.
    """
    return {"old": "APPROVED", "new": "BROKEN"}


def break_approval(card: Card, changed_fields: Iterable[str]) -> bool:
    """Flip an APPROVED card to BROKEN when a breaking field moved.

    Returns whether it actually flipped — which is what lets the caller record
    the change in its event payload and notify the people who now owe a
    re-review. A card that was DRAFT, REJECTED or already BROKEN is untouched.
    """
    if card.approval_status != "APPROVED":
        return False
    if not STATUS_BREAKING_FIELDS & set(changed_fields):
        return False
    card.approval_status = "BROKEN"
    return True


def _single_card_entry(card_id: uuid.UUID, name: str, actor_name: str) -> dict[str, Any]:
    return {
        "title": "Approval broken",
        "message": f'{actor_name} changed "{name}" — its approval is no longer valid',
        "link": f"/cards/{card_id}",
        "card_id": card_id,
        "data": {
            "approval_status": "BROKEN",
            "previous_approval_status": "APPROVED",
            "action": "broken",
            "card_count": 1,
            "card_ids": [str(card_id)],
        },
    }


async def build_approval_broken_recipients(
    db: AsyncSession,
    *,
    cards: Sequence[Card],
    actor_id: uuid.UUID | None,
    actor_display_name: str,
) -> list[dict[str, Any]]:
    """One recipient entry per person, however many of their cards broke.

    A mass edit over five hundred cards must not put five hundred bell entries
    on every stakeholder — the same reasoning that shaped the survey fan-out.
    Someone whose single card broke gets the one-card wording and a link
    straight to it; anyone with several gets a count and a link to the Inventory
    filtered to their broken cards.

    Two things this does that ``create_notifications_for_subscribers`` does not,
    and which are why even the single-card paths come through here: it **dedups
    by user** (a person holding two stakeholder roles on one card is one person
    needing one nudge), and it drops the actor up front rather than relying on
    ``create_notification`` to discard the row later.

    Returns ``[]`` when nothing broke, so the caller can skip delivery entirely.
    """
    if not cards:
        return []

    by_id = {card.id: card for card in cards}
    result = await db.execute(
        select(Stakeholder.card_id, Stakeholder.user_id).where(
            Stakeholder.card_id.in_(list(by_id.keys()))
        )
    )
    cards_by_user: dict[uuid.UUID, dict[uuid.UUID, Card]] = {}
    for card_id, user_id in result.all():
        if actor_id is not None and user_id == actor_id:
            continue
        card = by_id.get(card_id)
        if card is not None:
            cards_by_user.setdefault(user_id, {})[card.id] = card

    recipients: list[dict[str, Any]] = []
    for user_id, user_cards in cards_by_user.items():
        ordered = sorted(user_cards.values(), key=lambda c: c.name)
        if len(ordered) == 1:
            card = ordered[0]
            recipients.append(
                {"user_id": user_id, **_single_card_entry(card.id, card.name, actor_display_name)}
            )
            continue
        listed = ordered[:_MAX_LISTED_CARDS]
        recipients.append(
            {
                "user_id": user_id,
                "title": f"{len(ordered)} cards need re-approval",
                "message": (
                    f"{actor_display_name} changed {len(ordered)} cards you are a "
                    "stakeholder on — their approval is no longer valid"
                ),
                "link": APPROVAL_BROKEN_LINK,
                "data": {
                    "approval_status": "BROKEN",
                    "previous_approval_status": "APPROVED",
                    "action": "broken",
                    "card_count": len(ordered),
                    "card_ids": [str(c.id) for c in listed],
                },
                # Emailed only: the mail can afford to name every card and link
                # each one, while the bell entry stays a one-liner.
                "email_items": [{"label": c.name, "link": f"/cards/{c.id}"} for c in listed],
                "email_items_title": "Cards needing re-approval",
            }
        )
    return recipients


async def deliver_approval_broken(
    db: AsyncSession,
    recipients: list[dict[str, Any]],
    *,
    actor_id: uuid.UUID | None,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Deliver what :func:`build_approval_broken_recipients` produced.

    With a ``BackgroundTasks`` (every request path), delivery is deferred to
    ``deliver_notification_batch``, which keeps the per-recipient SMTP handshake
    off the request loop and out of the caller's transaction. Starlette runs
    those tasks only from ``response.background``, which FastAPI sets only when
    the endpoint returned normally — so an edit that failed to commit can never
    leave a "needs re-approval" notification behind, whether the task was
    scheduled before or after the commit.

    Without one — the extension bridge, which has no request — the rows are
    created inline on the caller's session instead. That path passes explicit
    keyword arguments rather than splatting the recipient dict:
    ``email_items`` / ``email_items_title`` are understood by
    ``deliver_notification_batch`` alone and would be a ``TypeError`` here.

    Referenced through the module attribute (``notification_service.…``) on
    purpose — a ``from … import`` would bind the function before the tests that
    intercept the fan-out can patch it.
    """
    if not recipients:
        return
    if background_tasks is not None:
        background_tasks.add_task(
            notification_service.deliver_notification_batch,
            recipients,
            notif_type=NOTIF_TYPE,
            actor_id=actor_id,
        )
        return
    for r in recipients:
        await notification_service.create_notification(
            db,
            user_id=r["user_id"],
            notif_type=NOTIF_TYPE,
            title=r["title"],
            message=r["message"],
            link=r.get("link"),
            data=r.get("data"),
            card_id=r.get("card_id"),
            actor_id=actor_id,
        )


async def notify_approval_broken(
    db: AsyncSession,
    *,
    card: Card,
    actor_id: uuid.UUID | None,
    actor_display_name: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Convenience wrapper for the single-card paths."""
    recipients = await build_approval_broken_recipients(
        db, cards=[card], actor_id=actor_id, actor_display_name=actor_display_name
    )
    await deliver_approval_broken(
        db, recipients, actor_id=actor_id, background_tasks=background_tasks
    )


async def record_child_strategy_effects(
    db: AsyncSession,
    *,
    results: Sequence[ChildStrategyResult],
    actor_id: uuid.UUID | None,
    actor_display_name: str,
    removed_ids: frozenset[uuid.UUID] = frozenset(),
    archived_ids: frozenset[uuid.UUID] = frozenset(),
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Record what a ``disconnect`` / ``reparent`` cascade did to the children.

    ``apply_child_strategy`` moves a child's ``parent_id`` and may break its
    approval, then returns — it deliberately does not publish or notify,
    because it cannot know whether its caller is about to archive or delete the
    very children it just touched. This is where the caller, which does know,
    settles up.

    Two exclusion sets, kept apart on purpose:

    * ``removed_ids`` — hard-deleted later in this same request. No event (the
      ``events.card_id`` FK is ``ON DELETE SET NULL``, but a row inserted for a
      card that is about to go is noise the card's own ``card.deleted`` already
      covers) and no notification.
    * ``archived_ids`` — archived later in this same request. The parent change
      is still a fact worth recording, so the event stands; the notification
      does not, because telling somebody to re-approve a card we just archived
      is exactly the sort of thing that teaches people to mute a bell.

    The ``select`` below autoflushes, so a child already flipped in place reads
    ``ARCHIVED`` here — the status guard and ``archived_ids`` agree rather than
    fight.
    """
    touched: set[uuid.UUID] = set()
    broken: set[uuid.UUID] = set()
    previous_parents: dict[uuid.UUID, uuid.UUID | None] = {}
    for result in results:
        touched.update(result.disconnected_ids)
        broken.update(result.approval_broken_ids)
        previous_parents.update(result.previous_parent_ids)
    touched -= removed_ids
    if not touched:
        return

    rows = await db.execute(select(Card).where(Card.id.in_(list(touched))))
    children = {c.id: c for c in rows.scalars().all()}

    for child_id in sorted(touched, key=str):
        child = children.get(child_id)
        if child is None:
            continue
        old_parent = previous_parents.get(child_id)
        changes: dict[str, Any] = {
            "parent_id": {
                "old": str(old_parent) if old_parent else None,
                "new": str(child.parent_id) if child.parent_id else None,
            }
        }
        if child_id in broken:
            changes["approval_status"] = approval_change_entry()
        await event_bus.publish(
            "card.updated",
            {"id": str(child_id), "changes": changes},
            db=db,
            card_id=child_id,
            user_id=actor_id,
        )

    notifiable = [
        children[cid]
        for cid in broken - removed_ids - archived_ids
        if cid in children and children[cid].status == "ACTIVE"
    ]
    recipients = await build_approval_broken_recipients(
        db, cards=notifiable, actor_id=actor_id, actor_display_name=actor_display_name
    )
    await deliver_approval_broken(
        db, recipients, actor_id=actor_id, background_tasks=background_tasks
    )
