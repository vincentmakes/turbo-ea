"""Who may read the activity of decisions and Statements of Architecture Work.

A decision (``adr.*``) or SoAW (``soaw.*``) event names the document: its
reference, title, the person who signed or rejected it. An activity feed shows
such an event only to a reader who may open the document itself, so each feed
that lists them adds :func:`document_event_read_filters` to its query.

The permission is read from the role cache the route's own permission check
has already filled, so a reader who holds both view permissions costs the feed
no extra query and gets no extra clause.
"""

from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy import ColumnElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.user import User
from app.services.permission_service import PermissionService

# (event-type prefix, the permission that may read it)
DOCUMENT_EVENT_FAMILIES: tuple[tuple[str, str], ...] = (
    ("adr.", "adr.view"),
    ("soaw.", "soaw.view"),
)


def hidden_document_prefixes(granted: Mapping[str, bool]) -> list[str]:
    """The event-type prefixes a reader with ``granted`` may not see."""
    return [prefix for prefix, permission in DOCUMENT_EVENT_FAMILIES if not granted[permission]]


def document_event_filters(granted: Mapping[str, bool]) -> tuple[ColumnElement[bool], ...]:
    """``WHERE`` clauses dropping the document events ``granted`` does not cover."""
    return tuple(
        ~Event.event_type.startswith(prefix, autoescape=True)
        for prefix in hidden_document_prefixes(granted)
    )


async def document_event_read_filters(
    db: AsyncSession, user: User
) -> tuple[ColumnElement[bool], ...]:
    """:func:`document_event_filters` for ``user``'s app-level permissions."""
    granted = {
        permission: await PermissionService.has_app_permission(db, user, permission)
        for _, permission in DOCUMENT_EVENT_FAMILIES
    }
    return document_event_filters(granted)
