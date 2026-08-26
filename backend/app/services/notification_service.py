"""Notification service — creates in-app notifications and queues email notifications."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES, User
from app.services.event_bus import event_bus

logger = logging.getLogger(__name__)

#: Types that must never be emailed, whatever a preference row says.
#:
#: ``app_updated`` fans out to *every* active user on every upgrade, so an
#: email channel would turn a patch release into a mass mailing. The UI shows
#: the email switch disabled for these; this set is what actually enforces it,
#: since preferences are also writable through the API.
IN_APP_ONLY_TYPES = frozenset({"app_updated"})


def _user_wants_notification(user: User, notif_type: str, channel: str) -> bool:
    """Check if a user has opted in to a notification type on a given channel."""
    if channel == "email" and notif_type in IN_APP_ONLY_TYPES:
        return False
    prefs = user.notification_preferences or DEFAULT_NOTIFICATION_PREFERENCES
    channel_prefs = prefs.get(channel, {})
    # Default to True for in_app, False for email if pref not set
    default = channel == "in_app"
    return channel_prefs.get(notif_type, default)


async def create_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    notif_type: str,
    title: str,
    message: str = "",
    link: str | None = None,
    data: dict[str, Any] | None = None,
    card_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    send_email: bool = True,
) -> Notification | None:
    """Create a notification for a user if their preferences allow it.

    Returns the Notification if created, None if the user has opted out.
    Also publishes to the event bus for real-time SSE delivery.

    ``send_email=False`` skips the email leg entirely. That leg opens a fresh
    SMTP connection per message, so a caller creating notifications in bulk
    must not take it inline — use ``deliver_notification_batch``, which sends
    the emails with no database session held open.
    """
    # Load user to check preferences
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None

    # Don't notify the actor about their own action, except for types where
    # the actor is performing a batch/admin action (surveys, todo assignments).
    allow_self_types = {
        "survey_request",
        "todo_assigned",
        "task_assigned",
        "risk_assigned",
        "process_flow_approval_requested",
        "process_flow_approved",
        "process_flow_rejected",
        # A process owner withdrawing their own approval still needs the record.
        "process_flow_withdrawn",
    }
    if actor_id and actor_id == user_id and notif_type not in allow_self_types:
        return None

    if not _user_wants_notification(user, notif_type, "in_app"):
        return None

    notif = Notification(
        user_id=user_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
        data=data or {},
        card_id=card_id,
        actor_id=actor_id,
        is_emailed=False,
    )
    db.add(notif)
    await db.flush()

    # Publish real-time event for this specific user
    await event_bus.publish(
        event_type="notification.created",
        data={
            "id": str(notif.id),
            "user_id": str(user_id),
            "type": notif_type,
            "title": title,
            "message": message,
            "link": link,
        },
    )

    # Send email notification if user opted in
    if send_email and _user_wants_notification(user, notif_type, "email"):
        from app.services.email_service import send_notification_email

        try:
            sent = await send_notification_email(
                to=user.email,
                title=title,
                message=message,
                link=link,
            )
            if sent:
                notif.is_emailed = True
                await db.flush()
        except Exception:
            pass  # Email failure shouldn't block the notification

    return notif


async def deliver_notification_batch(
    recipients: list[dict[str, Any]],
    *,
    notif_type: str,
    actor_id: uuid.UUID | None = None,
) -> None:
    """Create and deliver a batch of notifications from a background task.

    ``create_notification`` holds the caller's session open across an SMTP
    round-trip per email — one fresh connect/TLS/auth handshake each. Fine for
    one notification on a request path; a survey send fanning out to dozens of
    recipients sat on that loop inline, which is why the Send button hung.

    Three phases, honouring the background-job session rule (a session must
    never be held across slow non-DB work):

    1. one short session — notification rows + SSE publishes, and note who
       wants an email;
    2. no session — the SMTP sends;
    3. one short session — stamp ``is_emailed`` on what actually went out.

    Runs detached, so it must never raise: a delivery problem is logged, and
    the survey (or whatever scheduled the batch) stays sent — the in-app lists
    driven by real rows are the source of truth, notifications are the nudge.

    Each recipient dict: ``{user_id, title, message, link?, data?, card_id?,
    email_items?, email_items_title?}``. The ``email_items`` pair is emailed
    only — a bell entry stays a one-liner, while the email can afford to name
    what the notification covers.
    """
    from app.database import async_session
    from app.services.email_service import send_notification_email

    try:
        emails: list[tuple[uuid.UUID, str, dict[str, Any]]] = []
        async with async_session() as db:
            user_ids = {r["user_id"] for r in recipients}
            result = await db.execute(select(User).where(User.id.in_(user_ids)))
            users = {u.id: u for u in result.scalars()}
            for r in recipients:
                notif = await create_notification(
                    db,
                    user_id=r["user_id"],
                    notif_type=notif_type,
                    title=r["title"],
                    message=r.get("message", ""),
                    link=r.get("link"),
                    data=r.get("data"),
                    card_id=r.get("card_id"),
                    actor_id=actor_id,
                    send_email=False,
                )
                recipient = users.get(r["user_id"])
                if notif and recipient and _user_wants_notification(recipient, notif_type, "email"):
                    emails.append(
                        (
                            notif.id,
                            recipient.email,
                            {
                                "title": r["title"],
                                "message": r.get("message", ""),
                                "link": r.get("link"),
                                "items": r.get("email_items"),
                                "items_title": r.get("email_items_title"),
                            },
                        )
                    )
            await db.commit()

        sent_ids: list[uuid.UUID] = []
        for notif_id, to, payload in emails:
            try:
                if await send_notification_email(to=to, **payload):
                    sent_ids.append(notif_id)
            except Exception:
                logger.exception("Failed to email notification to %s", to)

        if sent_ids:
            async with async_session() as db:
                await db.execute(
                    update(Notification)
                    .where(Notification.id.in_(sent_ids))
                    .values(is_emailed=True)
                )
                await db.commit()
    except Exception:
        logger.exception("Notification batch delivery failed (%s recipients)", len(recipients))


async def notify_all_users(
    db: AsyncSession,
    *,
    notif_type: str,
    title: str,
    message: str = "",
    link: str | None = None,
    data: dict[str, Any] | None = None,
) -> int:
    """Notify every active user in one pass. Returns how many were notified.

    ``create_notification`` is the right tool for a handful of recipients but
    the wrong one for the whole directory: it re-reads the user row per call
    and publishes an SSE event per call. This does one query for the users, one
    ``add_all`` for the rows, and deliberately skips **both** the email branch
    and the realtime publish.

    Skipping the publish is safe for the only current caller: the announcement
    runs during startup, so every client's stream has just dropped and its bell
    refetches the unread count when the page next mounts. Do not reuse this for
    something a user must see *without* reloading.

    Does not commit — the caller owns the transaction.
    """
    result = await db.execute(select(User).where(User.is_active == True))  # noqa: E712
    users = result.scalars().all()

    rows = [
        Notification(
            user_id=user.id,
            type=notif_type,
            title=title,
            message=message,
            link=link,
            data=data or {},
            is_emailed=False,
        )
        for user in users
        if _user_wants_notification(user, notif_type, "in_app")
    ]
    if rows:
        db.add_all(rows)
        await db.flush()
    return len(rows)


async def create_notifications_for_subscribers(
    db: AsyncSession,
    *,
    card_id: uuid.UUID,
    notif_type: str,
    title: str,
    message: str = "",
    link: str | None = None,
    data: dict[str, Any] | None = None,
    actor_id: uuid.UUID | None = None,
) -> list[Notification]:
    """Create notifications for all subscribers of a card."""
    from app.models.stakeholder import Stakeholder

    result = await db.execute(select(Stakeholder).where(Stakeholder.card_id == card_id))
    subs = result.scalars().all()

    notifications = []
    for sub in subs:
        notif = await create_notification(
            db,
            user_id=sub.user_id,
            notif_type=notif_type,
            title=title,
            message=message,
            link=link,
            data=data,
            card_id=card_id,
            actor_id=actor_id,
        )
        if notif:
            notifications.append(notif)

    return notifications


async def get_unread_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    return result.scalar() or 0


async def mark_as_read(db: AsyncSession, notification_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        return False
    notif.is_read = True
    await db.flush()
    return True


async def mark_all_as_read(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    notifications = result.scalars().all()
    for n in notifications:
        n.is_read = True
    await db.flush()
    return len(notifications)
