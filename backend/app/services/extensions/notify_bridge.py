"""The SDK notification bridge — an extension addressing named people
through core's own notification pipeline, SDK 1.9.

* **Grant-gated per call** on ``core.notifications.send``; honours the
  ``EXTENSION_WRITES_ENABLED`` kill switch (a notification is an outbound
  side effect an operator pausing extensions expects to stop too).
* **Core owns the type.** By default everything lands as
  ``extension_notice``, one of the types in ``NOTIFICATION_TYPE_SPECS``; since
  SDK 1.11 an extension may instead pass ``type=`` naming one of the types it
  declared under ``notifications.types`` in its manifest — a row of its own
  in every recipient's preferences, registered by core and live only while
  the extension is. Either way the recipient's matrix decides whether it
  reaches the bell, their inbox, or an extension channel — and can switch it
  off. An extension can address people; it can never invent a type nobody
  can mute, and never pick a channel.
* **Details in the app, on request.** ``detail=True`` stamps ``open:
  "detail"`` into ``data``, and the bell then opens the notification's own
  details (full text, the extension's ``notification.detail`` slot) instead
  of following ``link`` — for a message whose link only some recipients may
  open, such as an extension page behind its own permission. The link is
  still offered as a button to those who can.
* **No session across SMTP.** Delivery goes through
  ``deliver_notification_batch`` (rows in one short session, emails with
  none open, stamps in a third), never ``create_notification`` inline.
* **In-app links only.** ``link`` passes the same validator as a todo's
  link: a relative path inside the app, never an external URL.
* **Provenance.** ``data`` carries ``ext: {key}`` so the bell entry, the SSE
  event and any extension channel can tell who sent it. No actor — nobody
  did it in person, and the actor-equals-recipient suppression must not
  swallow a message a rule sends to the person who caused it.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.card import Card
from app.models.user import User
from app.services import notification_service
from app.services.extensions import notification_types
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtensionDataError,
    ExtensionPermissionError,
    NotifyBridge,
)
from app.services.todo_service import TodoValidationError, validated_link

GRANT = "core.notifications.send"
NOTIFICATION_TYPE = "extension_notice"
MAX_RECIPIENTS = 50
MAX_TITLE_LENGTH = 200
MAX_MESSAGE_LENGTH = 2000
#: ``data`` rides on every SSE frame and into JSONB — bounded so a digest that
#: names fifty cards fits and a runaway payload does not.
MAX_DATA_BYTES = 16 * 1024
#: Keys core stamps itself; a caller's value is dropped, never trusted.
RESERVED_DATA_KEYS = frozenset({"ext", "open"})
DETAIL_MARKER = "detail"


class ExtensionNotify(NotifyBridge):
    """Per-extension bridge instance attached to ``ExtensionContext.notify``."""

    def __init__(self, key: str):
        self._key = key

    def _require(self) -> None:
        if GRANT not in set(extension_registry.grants_for(self._key)):
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {GRANT} grant "
                "(and an enabled, licensed install) for this call"
            )
        if not settings.EXTENSION_WRITES_ENABLED:
            raise ExtensionPermissionError(
                "Extension writes are disabled on this instance (EXTENSION_WRITES_ENABLED=false)"
            )

    async def send(
        self,
        user_ids: Sequence[str],
        *,
        title: str,
        message: str = "",
        link: str | None = None,
        card_id: str | None = None,
        data: dict[str, Any] | None = None,
        type: str | None = None,  # noqa: A002 — the SDK's own vocabulary
        detail: bool = False,
    ) -> int:
        self._require()
        if type is None:
            notif_type = NOTIFICATION_TYPE
        else:
            if type not in notification_types.types_for_extension(self._key):
                raise ExtensionDataError(
                    f"Unknown notification type {type!r}: declare it under notifications.types "
                    f"in the manifest of {self._key}"
                )
            notif_type = type
        clean_title = str(title or "").strip()
        if not clean_title:
            raise ExtensionDataError("A notification needs a title")
        if len(clean_title) > MAX_TITLE_LENGTH:
            raise ExtensionDataError(f"Notification title exceeds {MAX_TITLE_LENGTH} characters")
        clean_message = str(message or "")
        if len(clean_message) > MAX_MESSAGE_LENGTH:
            raise ExtensionDataError(
                f"Notification message exceeds {MAX_MESSAGE_LENGTH} characters"
            )
        if data is not None and not isinstance(data, dict):
            raise ExtensionDataError("data must be a dict")
        payload = {k: v for k, v in (data or {}).items() if k not in RESERVED_DATA_KEYS}
        payload["ext"] = self._key
        if detail:
            payload["open"] = DETAIL_MARKER
        try:
            encoded = json.dumps(payload)
        except (TypeError, ValueError) as e:
            raise ExtensionDataError(f"data is not JSON-serialisable: {e}") from e
        if len(encoded.encode("utf-8")) > MAX_DATA_BYTES:
            raise ExtensionDataError(f"Notification data exceeds {MAX_DATA_BYTES} bytes")
        try:
            clean_link = validated_link(link)
        except (TodoValidationError, ValueError) as e:
            raise ExtensionDataError(str(e)) from e

        recipients: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for raw in user_ids:
            try:
                uid = uuid.UUID(str(raw))
            except (TypeError, ValueError) as e:
                raise ExtensionDataError(f"Invalid user id: {raw!r}") from e
            if uid not in seen:
                seen.add(uid)
                recipients.append(uid)
        if not recipients:
            return 0
        if len(recipients) > MAX_RECIPIENTS:
            raise ExtensionDataError(
                f"At most {MAX_RECIPIENTS} recipients per call (got {len(recipients)})"
            )
        cid: uuid.UUID | None = None
        if card_id is not None:
            try:
                cid = uuid.UUID(str(card_id))
            except (TypeError, ValueError) as e:
                raise ExtensionDataError(f"Invalid card id: {card_id!r}") from e

        async with async_session() as db:
            rows = await db.execute(
                select(User.id).where(User.id.in_(recipients), User.is_active.is_(True))
            )
            active = [row[0] for row in rows]
            if cid is not None:
                exists = (await db.execute(select(Card.id).where(Card.id == cid))).first()
                if exists is None:
                    raise ExtensionDataError(f"Card {card_id} not found")
        if not active:
            return 0

        await notification_service.deliver_notification_batch(
            [
                {
                    "user_id": uid,
                    "title": clean_title,
                    "message": clean_message,
                    "link": clean_link,
                    "data": payload,
                    "card_id": cid,
                }
                for uid in active
            ],
            notif_type=notif_type,
            actor_id=None,
        )
        return len(active)
