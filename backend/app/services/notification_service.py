"""Notification service — creates in-app notifications and queues email notifications."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES, User
from app.services.event_bus import event_bus


def _user_wants_notification(user: User, notif_type: str, channel: str) -> bool:
    """Check if a user has opted in to a notification type on a given channel."""
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
    fact_sheet_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
) -> Notification | None:
    """Create a notification for a user if their preferences allow it.

    Returns the Notification if created, None if the user has opted out.
    Also publishes to the event bus for real-time SSE delivery.
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
        "process_flow_approval_requested",
        "process_flow_approved",
        "process_flow_rejected",
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
        fact_sheet_id=fact_sheet_id,
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
    if _user_wants_notification(user, notif_type, "email"):
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


async def create_notifications_for_subscribers(
    db: AsyncSession,
    *,
    fact_sheet_id: uuid.UUID,
    notif_type: str,
    title: str,
    message: str = "",
    link: str | None = None,
    data: dict[str, Any] | None = None,
    actor_id: uuid.UUID | None = None,
) -> list[Notification]:
    """Create notifications for all subscribers of a fact sheet."""
    from app.models.subscription import Subscription

    result = await db.execute(
        select(Subscription).where(Subscription.fact_sheet_id == fact_sheet_id)
    )
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
            fact_sheet_id=fact_sheet_id,
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
