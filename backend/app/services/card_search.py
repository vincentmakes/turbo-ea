"""What a free-text card search matches, and how it ranks — one definition.

Six endpoints back a card search box: the inventory and global search
(``GET /cards``), a published portal's own filter, a saved view's OData feed,
the two TurboLens Architect pickers, and the extension data bridge. Each had
its own copy of ``or_(name, description)``, which is how ``alias`` — a real,
importable, exportable card column — ended up matched by none of them: a user
could import an alias, see it in the Excel export, and never find the card
again (#1108).

An alias **is** a name: the internal one a company calls the thing by
("CRM-v2", "ERP-Legacy"). So it joins ``name`` in the relevance ranking, while
``description`` stays filter-only — a term buried in a paragraph says nothing
about how good a match the row is.
"""

from __future__ import annotations

from sqlalchemy import func, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.card import Card
from app.services.search_rank import search_filter, search_rank

__all__ = ["card_search_filter", "card_search_rank"]


def card_search_filter(search: str) -> ColumnElement[bool]:
    """The three texts every card search box matches: name, description, alias."""
    return or_(
        search_filter(Card.name, search),
        search_filter(Card.description, search),
        search_filter(Card.alias, search),
    )


def card_search_rank(search: str) -> ColumnElement[int]:
    """Relevance over the two *name-like* columns — whichever ranks better.

    ``search_rank`` is NULL-safe (a NULL column falls through to its no-match
    tier), so a card carrying no alias ranks exactly where it did before this
    existed.
    """
    return func.least(
        search_rank(Card.name, search),
        search_rank(Card.alias, search),
    )
