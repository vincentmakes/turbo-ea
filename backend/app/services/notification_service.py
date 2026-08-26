"""Notification service — creates in-app notifications and queues email notifications."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import (
    DEFAULT_NOTIFICATION_PREFERENCES,
    NOTIFICATION_TYPE_SPECS,
    NOTIFICATION_TYPE_SPECS_BY_KEY,
    User,
)
from app.services.event_bus import event_bus
from app.services.extensions import notification_channels
from app.services.extensions.sdk import NotificationDelivery

logger = logging.getLogger(__name__)

#: Types that must never leave the bell, whatever a preference row says.
#:
#: ``app_updated`` fans out to *every* active user on every upgrade, so an
#: outbound channel would turn a patch release into a mass mailing. The UI
#: shows the email switch disabled for these; this set is what actually
#: enforces it, since preferences are also writable through the API. It covers
#: every channel other than the bell, extension-delivered ones included.
IN_APP_ONLY_TYPES = frozenset(spec.key for spec in NOTIFICATION_TYPE_SPECS if spec.in_app_only)


def _user_wants_notification(user: User, notif_type: str, channel: str) -> bool:
    """Check if a user has opted in to a notification type on a given channel.

    ``channel`` is ``"in_app"``, ``"email"``, or the key of a channel an
    extension registered. The fallback for a type the user's stored
    preferences say nothing about — the normal case for any type added after
    the account was created — comes from that type's
    :class:`~app.models.user.NotificationTypeSpec`, so a new type behaves the
    same for an existing account as for a fresh one.

    Extension channels are the exception: they default to **off** for every
    type and have no per-type default to raise that, so installing an
    extension can never start delivering on its own.
    """
    if channel != "in_app" and notif_type in IN_APP_ONLY_TYPES:
        return False
    spec = NOTIFICATION_TYPE_SPECS_BY_KEY.get(notif_type)
    if spec is not None and not spec.user_configurable and channel != "in_app":
        # Not offered in the dialog, so there is no switch to turn it on with.
        # ``ops_rescue_access`` reaches an inbox through its own direct send in
        # ``ops.py``, deliberately outside the opt-out system.
        return False
    if channel == "email" and spec is not None and spec.email_locked:
        return True
    prefs = user.notification_preferences or DEFAULT_NOTIFICATION_PREFERENCES
    if channel in ("in_app", "email"):
        stored = prefs.get(channel) or {}
        if spec is None:
            default = channel == "in_app"
        else:
            default = spec.in_app_default if channel == "in_app" else spec.email_default
    else:
        stored = (prefs.get("channels") or {}).get(channel) or {}
        default = False
    return stored.get(notif_type, default)


def _absolute_link(link: str | None) -> str | None:
    """Resolve an app-relative notification link against the instance URL.

    Same expression ``email_service`` uses to build the link in a
    notification email, kept private so extensions read the resolved ``url``
    off the payload rather than reaching for ``settings._app_base_url``,
    which is not SDK surface.
    """
    if not link:
        return None
    if link.startswith(("http://", "https://")):
        return link
    from app.config import settings

    base = getattr(settings, "_app_base_url", "") or "http://localhost:8920"
    return f"{base}{link}"


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
    """Deliver a notification to a user on whichever channels they want.

    Every channel is independent. Until 2.89 the bell was a *gate*: muting a
    type in-app silently suppressed its email too, so a user who wanted a type
    in their inbox and not in the bell got nothing at all. Each channel now
    stands on its own, which is also what makes a third channel possible.

    Returns the in-app row when one was created. ``None`` means **no bell
    entry** — not "nothing was delivered": an email may still have gone out.
    Callers use the return value only to count bell rows.

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

    wants_in_app = _user_wants_notification(user, notif_type, "in_app")
    wants_email = send_email and _user_wants_notification(user, notif_type, "email")
    channels = notification_channels.wanted_channels(user, notif_type)
    if not wants_in_app and not wants_email and not channels:
        return None

    notif: Notification | None = None
    if wants_in_app:
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

        # Publish real-time event for this specific user. Deliberately inside
        # the in-app branch: the bell must not light up for a delivery that
        # has no row behind it.
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

    if wants_email:
        from app.services.email_service import send_notification_email

        try:
            sent = await send_notification_email(
                to=user.email,
                title=title,
                message=message,
                link=link,
            )
            # Nothing to stamp when the user took this type by email only.
            if sent and notif is not None:
                notif.is_emailed = True
                await db.flush()
        except Exception:
            pass  # Email failure shouldn't block the notification

    if channels:
        # Enqueue-only: dispatch does no I/O and never awaits, so this is
        # safe with the caller's transaction still open. Guarded by
        # tests/services/test_db_session_holding.py.
        notification_channels.dispatch(
            NotificationDelivery(
                notification_id=str(notif.id) if notif is not None else None,
                user_id=str(user_id),
                type=notif_type,
                title=title,
                message=message,
                link=link,
                url=_absolute_link(link),
                data=dict(data or {}),
                created_at=datetime.now(UTC).isoformat(),
            ),
            channels,
        )

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
        emails: list[tuple[uuid.UUID | None, str, dict[str, Any]]] = []
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
                # Not gated on ``notif``: a recipient who muted this type in
                # the bell but kept it in their inbox still gets the email,
                # they just have no row to stamp ``is_emailed`` on.
                if recipient and _user_wants_notification(recipient, notif_type, "email"):
                    emails.append(
                        (
                            notif.id if notif else None,
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
                if await send_notification_email(to=to, **payload) and notif_id is not None:
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

    Its one caller announces ``app_updated``, which is in
    ``IN_APP_ONLY_TYPES`` — so no other channel, email or extension-delivered,
    can ever claim it and there is nothing here to fan out. Pinned by
    ``test_notify_all_users_never_dispatches``.

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
